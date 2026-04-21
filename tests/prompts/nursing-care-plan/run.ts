/**
 * 看護計画書 generate / evaluate プロンプト挙動確認ランナー
 *
 * 使い方:
 *   npx tsx tests/prompts/nursing-care-plan/run.ts generate all
 *   npx tsx tests/prompts/nursing-care-plan/run.ts generate case-01-generate-standard
 *   npx tsx tests/prompts/nursing-care-plan/run.ts evaluate all
 *   npx tsx tests/prompts/nursing-care-plan/run.ts all all
 *
 * .env.local に ANTHROPIC_API_KEY があれば自動で読み込む。
 *
 * NOTE: プロンプト組み立てロジックは
 *   app/api/nursing-care-plan/generate/route.ts
 *   app/api/nursing-care-plan/evaluate/route.ts
 * からコピー（ミラー）したもの。ルート側を変更したらここも同期すること。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateAiResponse } from "../../../lib/ai-client";

// -------- .env.local 簡易ローダー --------
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

// -------- 型 --------
interface PrevRecord {
  visitDate?: string;
  S: string;
  O: string;
  A: string;
  P: string;
}
interface GenerateInput {
  patient: { age: number; diagnosis: string; careLevel: string };
  planDate?: string;
  nursingContentItems?: string[];
  carePlan?: string;
  recentSoapRecords?: PrevRecord[];
  previousPlan?: { nursingGoal?: string; issues?: { no: number; issue: string }[] };
  mode?: "from_scratch" | "refine";
  existingGoal?: string;
  existingIssues?: { no: number; issue: string }[];
}
interface EvaluateInput {
  patient: { age: number; diagnosis: string; careLevel: string };
  issues: { no: number; issue: string }[];
  periodStart: string;
  periodEnd: string;
  periodSoapRecords: PrevRecord[];
  nursingContentItems?: string[];
}
interface TestCase {
  id: string;
  mode: "generate" | "evaluate";
  description: string;
  input: GenerateInput | EvaluateInput;
  expectations?: Record<string, unknown>;
}

// -------- generate プロンプト構築（app/api/nursing-care-plan/generate/route.ts をミラー） --------
function buildGenerateRequest(input: GenerateInput) {
  const planDate = input.planDate ?? new Date().toISOString().slice(0, 10);
  const mode = input.mode ?? "from_scratch";

  const modeRule = mode === "refine"
    ? `# 生成モード：refine（現在の内容を改善）
既存の nursing_goal / issues を入力として受け取る。完全に書き換えるのではなく、
不足している観点の追加・文言の整備・誤変換補正のみ行い、看護師が書いた内容は最大限保持すること。`
    : `# 生成モード：from_scratch（ゼロから生成）
患者情報・SOAP・ケア内容から新規に目標・課題を組み立てる。`;

  const systemPrompt = `あなたは訪問看護の看護計画書を作成する専門AIである。カイポケ「訪問看護計画書」フォーマットに準拠した目標・課題のドラフトを生成する。

${modeRule}

# 作業手順（必ず順番に実行）
1. extracted_facts：入力から事実を列挙（由来タグ付き、誤変換補正済み）
2. coverage_check：各事実を nursing_goal / issues のどこに反映するかマッピング
3. nursing_goal：看護・リハビリの目標を記述
4. issues：療養上の課題・支援内容を最大5行

# 出力形式
Tool use（output_nursing_care_plan）のJSONのみ。

# あなたがやらないこと
- plan_type・plan_title・evaluation・衛生材料・作成者情報の生成
- DESIGN-R、Barthel、GAF、自立度ランクの判定
- 診断名の変更、ドレッシング材・薬剤の商品名/成分名の言及
- 「〜を処方する」等の医師権限文言
- 具体的検査値の創作

# 医療用語の正しい表記
副雑音 / 緊満感 / 更衣 / 洗髪 / 著明 / 褥瘡 / 浮腫 / 嚥下 / 疼痛 / 腸蠕動音 / 腹部 / 排便

# nursing_goal の書き方
3000字以内、自然な文章、「〜を目標とする」「〜を継続していく」、家族支援を1-2文。

# issues の書き方
最大5行、各2500字以内、優先順位順、「〜の課題あり。〜の支援を行う」、SOAPにない課題を創作しない、末尾にAI下書きマーカー。

# 個人情報
氏名・住所・電話・「〜様」を出力しない。「利用者」「本人」を使用。`;

  const nursingContentSection = input.nursingContentItems && input.nursingContentItems.length > 0
    ? `\n【登録済みケア内容】\n${input.nursingContentItems.map((item) => `・${item}`).join("\n")}`
    : "";

  const carePlanSection = input.carePlan?.trim()
    ? `\n【旧ケアプラン欄（過渡期の参考情報）】\n${input.carePlan}`
    : "";

  const soapSection = input.recentSoapRecords && input.recentSoapRecords.length > 0
    ? "\n【直近のSOAP記録】\n" + input.recentSoapRecords
        .slice(0, 5)
        .map((r, i) => `[${i + 1}${r.visitDate ? `（${r.visitDate}）` : ""}]\nS: ${r.S}\nO: ${r.O}\nA: ${r.A}\nP: ${r.P}`)
        .join("\n\n")
    : "\n【直近のSOAP記録】\n  （なし）";

  const previousSection = input.previousPlan
    ? `\n【前回の看護計画書】\n目標：${input.previousPlan.nursingGoal ?? "（なし）"}\n課題：\n${(input.previousPlan.issues ?? []).map((i) => `  ${i.no}. ${i.issue}`).join("\n") || "  （なし）"}`
    : "";

  const refineSection = mode === "refine"
    ? `\n【現在の内容（改善対象）】\n目標：${input.existingGoal ?? "（未入力）"}\n課題：\n${(input.existingIssues ?? []).map((i) => `  ${i.no}. ${i.issue}`).join("\n") || "  （未入力）"}\n\n既存内容を保持しつつ、不足観点の追加・文言整備・誤変換補正のみ行うこと。`
    : "";

  const prompt = `【患者情報】
- 年齢: ${input.patient.age}歳
- 主病名: ${input.patient.diagnosis}
- 要介護度: ${input.patient.careLevel}

【計画作成日】${planDate}
${nursingContentSection}
${carePlanSection}
${soapSection}
${previousSection}
${refineSection}

上記情報から、看護計画書の nursing_goal（目標）と issues（療養上の課題・支援内容）のドラフトを生成せよ。`;

  const tool = {
    name: "output_nursing_care_plan",
    description: "看護計画書の目標・課題を生成する。",
    input_schema: {
      type: "object" as const,
      properties: {
        extracted_facts: { type: "array", items: { type: "string" } },
        coverage_check: { type: "array", items: { type: "string" } },
        nursing_goal: { type: "string" },
        issues: {
          type: "array",
          items: {
            type: "object",
            properties: {
              no: { type: "integer" },
              issue: { type: "string" },
            },
            required: ["no", "issue"],
          },
        },
        remarks: { type: "string" },
      },
      required: ["extracted_facts", "coverage_check", "nursing_goal", "issues", "remarks"],
    },
  };

  return { prompt, systemPrompt, tool };
}

// -------- evaluate プロンプト構築 --------
function buildEvaluateRequest(input: EvaluateInput) {
  const systemPrompt = `あなたは訪問看護の看護計画書の評価欄を作成する専門AIである。指定期間内のSOAP記録を読み取り、各課題について「経過サマリ・変化のポイント・所見下書き」の3構造で評価ドラフトを生成する。

# 作業手順
1. extracted_facts：期間内SOAPから事実を抽出（由来タグ付き、誤変換補正済み）
2. per_issue_coverage：各課題について、関連する事実をマッピング
3. evaluations：課題ごとに3構造で記述（issues と同じ順序・件数）

# 出力形式
Tool use（output_issue_evaluations）のJSONのみ。

# あなたがやらないこと
- 医学的最終判定を断定しない（「改善した」「悪化した」等は禁止、「改善傾向」「〜と考えられる」形式で）
- DESIGN-R、Barthel、GAF、自立度ランクの判定
- 診断名変更、薬剤の処方・変更・中止の提案
- ドレッシング材・薬剤の商品名・成分名
- 具体的検査値の創作

# 医療用語の正しい表記
副雑音 / 緊満感 / 更衣 / 洗髪 / 著明 / 褥瘡 / 浮腫 / 嚥下 / 疼痛 / 腸蠕動音 / 腹部 / 排便

# course_summary
1000字以内、時系列順で日付明記、該当課題に関連する事象のみ、創作禁止。

# change_points
500字以内、期間開始と終了の対比、ADL/症状/バイタル/服薬/家族の観点。

# finding_draft
500字以内、候補：継続/改善傾向/悪化傾向/目標達成/見直し必要/中止検討、根拠を1-2点挙げ、「〜と考えられる」語尾。`;

  const nursingContentSection = input.nursingContentItems && input.nursingContentItems.length > 0
    ? `\n【登録済みケア内容（参考）】\n${input.nursingContentItems.map((item) => `・${item}`).join("\n")}`
    : "";

  const soapSection = "\n【期間内のSOAP記録】\n" + input.periodSoapRecords
    .map((r, i) => `[${i + 1}${r.visitDate ? `（${r.visitDate}）` : ""}]\nS: ${r.S}\nO: ${r.O}\nA: ${r.A}\nP: ${r.P}`)
    .join("\n\n");

  const issuesSection = "\n【評価対象の課題】\n" + input.issues
    .map((i) => `No.${i.no}: ${i.issue}`)
    .join("\n");

  const prompt = `【患者情報】
- 年齢: ${input.patient.age}歳
- 主病名: ${input.patient.diagnosis}
- 要介護度: ${input.patient.careLevel}

【評価期間】${input.periodStart} 〜 ${input.periodEnd}
（期間内SOAP記録: ${input.periodSoapRecords.length}件）
${nursingContentSection}
${issuesSection}
${soapSection}

各課題の評価ドラフトを生成せよ。issues と同じ順序・件数で evaluations を返すこと。`;

  const tool = {
    name: "output_issue_evaluations",
    description: "課題ごとの評価を生成する。",
    input_schema: {
      type: "object" as const,
      properties: {
        extracted_facts: { type: "array", items: { type: "string" } },
        per_issue_coverage: { type: "array", items: { type: "string" } },
        evaluations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              no: { type: "integer" },
              course_summary: { type: "string" },
              change_points: { type: "string" },
              finding_draft: { type: "string" },
            },
            required: ["no", "course_summary", "change_points", "finding_draft"],
          },
        },
      },
      required: ["extracted_facts", "per_issue_coverage", "evaluations"],
    },
  };

  return { prompt, systemPrompt, tool };
}

// -------- 実行 --------
function printHeader(text: string) {
  const line = "=".repeat(Math.max(60, text.length + 4));
  console.log(`\n${line}\n  ${text}\n${line}`);
}

function printSection(title: string, items: string[]) {
  console.log(`\n▼ ${title}`);
  if (items.length === 0) {
    console.log("  （なし）");
  } else {
    for (const item of items) {
      console.log(`  ・${item}`);
    }
  }
}

async function runGenerate(tc: TestCase) {
  printHeader(`[generate] ${tc.id} - ${tc.description}`);
  const { prompt, systemPrompt, tool } = buildGenerateRequest(tc.input as GenerateInput);

  const response = await generateAiResponse(prompt, systemPrompt, {
    maxTokens: 8192,
    timeoutMs: 60000,
    temperature: 0.2,
    tool,
  });

  if (!response.toolInput) {
    console.log("⚠️  toolInput なし");
    return;
  }

  const r = response.toolInput as {
    extracted_facts?: string[];
    coverage_check?: string[];
    nursing_goal?: string;
    issues?: { no: number; issue: string }[];
    remarks?: string;
  };

  printSection("extracted_facts（内部）", r.extracted_facts ?? []);
  printSection("coverage_check（内部）", r.coverage_check ?? []);
  console.log(`\n▼ nursing_goal\n${r.nursing_goal ?? "（なし）"}`);
  console.log(`\n▼ issues`);
  for (const issue of r.issues ?? []) {
    console.log(`  ${issue.no}. ${issue.issue}`);
  }
  console.log(`\n▼ remarks\n${r.remarks ?? "（なし）"}`);
  if (tc.expectations) {
    console.log(`\n▼ 期待する挙動`);
    for (const [k, v] of Object.entries(tc.expectations)) {
      console.log(`  [${k}]`);
      if (Array.isArray(v)) v.forEach((item) => console.log(`    ・${item}`));
    }
  }
}

async function runEvaluate(tc: TestCase) {
  printHeader(`[evaluate] ${tc.id} - ${tc.description}`);
  const { prompt, systemPrompt, tool } = buildEvaluateRequest(tc.input as EvaluateInput);

  const response = await generateAiResponse(prompt, systemPrompt, {
    maxTokens: 8192,
    timeoutMs: 90000,
    temperature: 0.2,
    tool,
  });

  if (!response.toolInput) {
    console.log("⚠️  toolInput なし");
    return;
  }

  const r = response.toolInput as {
    extracted_facts?: string[];
    per_issue_coverage?: string[];
    evaluations?: Array<{
      no: number;
      course_summary: string;
      change_points: string;
      finding_draft: string;
    }>;
  };

  printSection("extracted_facts（内部）", r.extracted_facts ?? []);
  printSection("per_issue_coverage（内部）", r.per_issue_coverage ?? []);
  console.log(`\n▼ evaluations（${r.evaluations?.length ?? 0}件）`);
  for (const ev of r.evaluations ?? []) {
    console.log(`\n  === No.${ev.no} ===`);
    console.log(`  【経過サマリ】\n${indent(ev.course_summary, 4)}`);
    console.log(`  【変化のポイント】\n${indent(ev.change_points, 4)}`);
    console.log(`  【所見下書き】\n${indent(ev.finding_draft, 4)}`);
  }
  if (tc.expectations) {
    console.log(`\n▼ 期待する挙動`);
    for (const [k, v] of Object.entries(tc.expectations)) {
      console.log(`  [${k}]`);
      if (Array.isArray(v)) v.forEach((item) => console.log(`    ・${item}`));
    }
  }
}

function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text.split("\n").map((l) => pad + l).join("\n");
}

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const projectRoot = path.resolve(__dirname, "../../..");
  loadDotenv(path.join(projectRoot, ".env.local"));

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY が設定されていません。.env.local を確認してください。");
    process.exit(1);
  }

  const mode = (process.argv[2] ?? "all").toLowerCase(); // generate | evaluate | all
  const filter = (process.argv[3] ?? "all").toLowerCase();

  const casesPath = path.join(__dirname, "cases.json");
  const cases = JSON.parse(fs.readFileSync(casesPath, "utf-8")) as TestCase[];

  const filtered = filter === "all" ? cases : cases.filter((c) => c.id === filter);
  if (filtered.length === 0) {
    console.error(`ケースが見つかりません: ${filter}`);
    process.exit(1);
  }

  for (const tc of filtered) {
    if ((mode === "generate" || mode === "all") && tc.mode === "generate") {
      await runGenerate(tc);
    }
    if ((mode === "evaluate" || mode === "all") && tc.mode === "evaluate") {
      await runEvaluate(tc);
    }
  }

  console.log("\n完了。");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
