/**
 * SOAP品質 LLM-judge（v1）
 *
 * run.ts が保存したスナップショットJSONを読み、ケースごとに Sonnet で
 * ルーブリック6観点（rubric.ts）を採点する。
 *
 * 使い方:
 *   npx tsx tests/prompts/soap/judge.ts tests/prompts/soap/baseline-2026-07-04.json
 *   OUTPUT_JSON=tests/prompts/soap/judge-2026-07-04.json \
 *     npx tsx tests/prompts/soap/judge.ts tests/prompts/soap/baseline-2026-07-04.json
 *
 * 設計上の決め事（docs/SOAP品質ルーブリック設計_v1.md 承認済み）:
 * - judgeモデル: Sonnet（生成Haikuの一段上）、temperature 0
 * - judgeには生成用systemプロンプト・Few-shot例を見せない（入力素材＋生成SOAPのみ）
 * - violations（原文引用つき）→ score の順で書かせる
 * - R6（継続性）は previousRecords があるケースのみ採点
 * - judgeは回帰検知用。最終品質判断は看護師レビュー
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateAiResponse } from "../../../lib/ai-client";
import { RUBRIC_CRITERIA, RUBRIC_VERSION, SCORE_ANCHORS, buildJudgeTool } from "./rubric";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..", "..", "..");

// -------- .env.local 簡易ローダー（run.ts と同一方式） --------
function loadDotenv(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf-8");
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadDotenv(path.join(projectRoot, ".env.local"));

// -------- 型（run.ts のスナップショット形式・cases.json に対応） --------
interface PrevRecord {
  visitDate?: string;
  S: string;
  O: string;
  A: string;
  P: string;
}
interface CaseInput {
  rawInput: string;
  sInput?: string;
  carePlan?: string;
  previousRecords?: PrevRecord[];
  initialSoapRecords?: { text: string; visitDate?: string }[];
  intakeNotes?: string;
  nursingContentItems?: string[];
  alertAnswers?: { question: string; answer: string }[];
  questionAnswers?: { question: string; answer: string }[];
}
interface TestCase {
  id: string;
  description: string;
  input: CaseInput;
}
interface SnapshotRun {
  model: string;
  soap: { S: string; O: string; A: string; P: string } | null;
}
interface Snapshot {
  ranAt: string;
  promptHash: string;
  cases: Array<{ id: string; description: string; runs: SnapshotRun[] }>;
}

interface CriterionResult {
  violations: Array<{ quote: string; problem: string }>;
  score: 0 | 1 | 2;
  reason: string;
}
type JudgeScores = Record<string, CriterionResult>;

function sha256Short(input: string): string {
  return crypto.createHash("sha256").update(input, "utf-8").digest("hex").slice(0, 8);
}

// -------- judge プロンプト構築 --------
function buildJudgeSystemPrompt(criteriaIds: string[]): string {
  const criteria = RUBRIC_CRITERIA.filter((c) => criteriaIds.includes(c.id));
  const criteriaText = criteria.map((c) => `## ${c.id} ${c.name}\n${c.standard}`).join("\n\n");
  return `あなたは訪問看護記録の品質監査者です。入力素材と、そこからAIが生成したSOAP記録を照合し、下記ルーブリックの観点ごとに採点してください。

# 採点の原則
- 判定対象は「記録としての質」。文体の好みや表現の巧拙は採点しない
- 各観点で、まず violations（違反・問題箇所）を原文引用つきで列挙し、その後に score を付ける
- 引用できる違反がないのに 0 を付けてはならない
- 迷ったら 1（軽微）でなく、violations の有無で機械的に決める: 明確な違反あり=0 / グレーのみ=1 / なし=2

# 採点尺度
${SCORE_ANCHORS}

# ルーブリック
${criteriaText}`;
}

function formatInputMaterials(input: CaseInput): string {
  const parts: string[] = [];
  parts.push(`【訪問メモ（rawInput）】\n${input.rawInput}`);
  if (input.sInput) parts.push(`【S情報（看護師が入力した利用者・家族の発言）】\n${input.sInput}`);
  else parts.push(`【S情報】（提供なし → S欄は空であるべき）`);
  if (input.carePlan) parts.push(`【ケアプラン方針】\n${input.carePlan}`);
  if (input.intakeNotes) parts.push(`【導入時情報（退院前カンファレンス・申し送り等。A/Pの判断材料として生成AIに提供されている）】\n${input.intakeNotes}`);
  if (input.previousRecords?.length) {
    parts.push(
      `【前回までの記録】\n` +
        input.previousRecords
          .map(
            (r, i) =>
              `[前回${i + 1}${r.visitDate ? `（${r.visitDate}）` : ""}]\nS: ${r.S}\nO: ${r.O}\nA: ${r.A}\nP: ${r.P}`
          )
          .join("\n\n")
    );
  }
  if (input.initialSoapRecords?.length) {
    parts.push(
      `【導入時の過去記録（用語・言い回しの参考用。事実の抽出元ではない）】\n` +
        input.initialSoapRecords.map((r, i) => `[参考${i + 1}]\n${r.text}`).join("\n\n")
    );
  }
  if (input.alertAnswers?.length) {
    parts.push(
      `【継続確認事項への回答（今回の事実としてO/A/Pに反映されるべき）】\n` +
        input.alertAnswers.map((qa) => `Q: ${qa.question}\nA: ${qa.answer}`).join("\n")
    );
  }
  if (input.questionAnswers?.length) {
    parts.push(
      `【AI確認質問への回答（今回の事実としてO/A/Pに反映されるべき）】\n` +
        input.questionAnswers.map((qa) => `Q: ${qa.question}\nA: ${qa.answer}`).join("\n")
    );
  }
  return parts.join("\n\n");
}

// -------- メイン --------
async function main() {
  const snapshotArg = process.argv[2];
  if (!snapshotArg) {
    console.error("usage: npx tsx tests/prompts/soap/judge.ts <snapshot.json>");
    process.exit(1);
  }
  const snapshotPath = path.isAbsolute(snapshotArg) ? snapshotArg : path.join(projectRoot, snapshotArg);
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf-8")) as Snapshot;

  const casesPath = path.join(__dirname, "cases.json");
  const allCases = JSON.parse(fs.readFileSync(casesPath, "utf-8")) as TestCase[];
  const caseById = new Map(allCases.map((c) => [c.id, c]));

  const results: Array<{
    id: string;
    model: string;
    criteria: JudgeScores;
    total: number;
    max: number;
  }> = [];

  console.log(`judge: rubric=${RUBRIC_VERSION} model=sonnet(temp0) snapshot=${path.basename(snapshotPath)} promptHash=${snapshot.promptHash}`);

  for (const snapCase of snapshot.cases) {
    const tc = caseById.get(snapCase.id);
    if (!tc) {
      console.warn(`SKIP ${snapCase.id}: cases.json に該当なし（casesFileが変わった可能性）`);
      continue;
    }
    for (const run of snapCase.runs) {
      if (!run.soap) {
        console.warn(`SKIP ${snapCase.id} [${run.model}]: soap が null`);
        continue;
      }
      // R6 は前回記録があるケースのみ採点
      const applicable = RUBRIC_CRITERIA.filter(
        (c) => !c.requiresPreviousRecords || (tc.input.previousRecords?.length ?? 0) > 0
      );
      const systemPrompt = buildJudgeSystemPrompt(applicable.map((c) => c.id));
      const tool = buildJudgeTool(applicable);
      const userPrompt = `# 入力素材\n${formatInputMaterials(tc.input)}\n\n# 生成されたSOAP記録（採点対象）\nS: ${run.soap.S}\nO: ${run.soap.O}\nA: ${run.soap.A}\nP: ${run.soap.P}`;

      const started = Date.now();
      const res = await generateAiResponse(userPrompt, systemPrompt, {
        model: "sonnet",
        temperature: 0,
        tool,
        maxTokens: 3000,
        timeoutMs: 90000,
      });
      const elapsed = Date.now() - started;

      const scores = (res.toolInput ?? {}) as JudgeScores;
      const total = applicable.reduce((sum, c) => sum + (scores[c.id]?.score ?? 0), 0);
      const max = applicable.length * 2;
      results.push({ id: snapCase.id, model: run.model, criteria: scores, total, max });

      const line = applicable.map((c) => `${c.id}=${scores[c.id]?.score ?? "?"}`).join(" ");
      console.log(`${snapCase.id} [${run.model}] ${total}/${max}  ${line}  (${elapsed}ms)`);
      for (const c of applicable) {
        for (const v of scores[c.id]?.violations ?? []) {
          console.log(`    ${c.id} 違反: 「${v.quote}」 — ${v.problem}`);
        }
      }
    }
  }

  // 観点別平均（R6は対象ケースのみで平均）
  console.log("\n=== 観点別平均（2点満点） ===");
  for (const c of RUBRIC_CRITERIA) {
    const applied = results.filter((r) => r.criteria[c.id]);
    if (applied.length === 0) continue;
    const avg = applied.reduce((s, r) => s + r.criteria[c.id].score, 0) / applied.length;
    console.log(`${c.id} ${c.name}: ${avg.toFixed(2)} (n=${applied.length})`);
  }
  const totalPct = results.reduce((s, r) => s + r.total, 0) / results.reduce((s, r) => s + r.max, 0);
  console.log(`総合: ${(totalPct * 100).toFixed(1)}%`);

  // 結果保存
  const outRel = process.env.OUTPUT_JSON;
  if (outRel) {
    const outPath = path.isAbsolute(outRel) ? outRel : path.join(projectRoot, outRel);
    const judgeSystemHash = sha256Short(buildJudgeSystemPrompt(RUBRIC_CRITERIA.map((c) => c.id)));
    fs.writeFileSync(
      outPath,
      JSON.stringify(
        {
          ranAt: new Date().toISOString(),
          rubricVersion: RUBRIC_VERSION,
          judgeModel: "sonnet",
          judgeSystemHash,
          snapshotFile: path.basename(snapshotPath),
          snapshotPromptHash: snapshot.promptHash,
          results,
        },
        null,
        2
      ),
      "utf-8"
    );
    console.log(`\njudge結果保存: ${outPath}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
