/**
 * post-B レビュー用：見るべきケースを順に表示する。
 * 使い方: npx tsx tests/prompts/soap/show-review.ts
 */
import fs from "node:fs";
import path from "node:path";

interface Run {
  model: string;
  soap: { extracted_facts?: string[]; coverage_check?: string; S: string; O: string; A: string; P: string } | null;
  usage: { input_tokens: number; output_tokens: number };
  elapsedMs: number;
}
interface Snapshot {
  cases: Array<{ id: string; description: string; runs: Run[] }>;
}

const baselinePath = path.join(process.cwd(), "tests/prompts/soap/baseline-2026-04-27.json");
const postPath = path.join(process.cwd(), "tests/prompts/soap/post-phase-b-2026-04-27.json");
const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf-8")) as Snapshot;
const post = JSON.parse(fs.readFileSync(postPath, "utf-8")) as Snapshot;

const REVIEW_TARGETS = [
  { id: "case-03-voice-errors", focus: "既存誤変換補正の回帰なし確認", compareBaseline: true },
  { id: "case-03b-voice-errors-extended", focus: "新6パターン（胎動/正常→性状/侵入部/外装/常用/服雑音）が補正されたか", compareBaseline: false },
  { id: "case-03c-corrupted-history", focus: "過去記録に汚染データあり。出力は補正後の用語に揃っているか", compareBaseline: false },
  { id: "case-06-answers-reflected", focus: "[AI回答]/[継続確認回答] が SOAP 本文に反映されているか", compareBaseline: true },
  { id: "case-07-sinfo-influences-ap", focus: "S情報が S 欄にそのまま、かつ A/P の判断にも反映されているか", compareBaseline: true },
  { id: "case-01-structured", focus: "文末/文長が過去記録と揃っているか（最も基準ケース）", compareBaseline: true },
];

function findCase(snap: Snapshot, id: string) {
  return snap.cases.find((c) => c.id === id);
}
function getRun(c: { runs: Run[] } | undefined): Run | null {
  return c?.runs.find((r) => r.model === "haiku") ?? null;
}

function show(label: string, run: Run | null) {
  if (!run || !run.soap) {
    console.log(`【${label}】 (該当なし)`);
    return;
  }
  const r = run.soap;
  console.log(`\n【${label}】 in=${run.usage.input_tokens} out=${run.usage.output_tokens}`);
  console.log("--- extracted_facts ---");
  for (const f of r.extracted_facts ?? []) console.log("  ・" + f);
  console.log("--- coverage_check ---");
  console.log("  " + (r.coverage_check ?? ""));
  console.log("--- S ---\n" + (r.S || "(空)"));
  console.log("--- O ---\n" + r.O);
  console.log("--- A ---\n" + r.A);
  console.log("--- P ---\n" + r.P);
}

let idx = 1;
for (const t of REVIEW_TARGETS) {
  const sep = "=".repeat(80);
  console.log("\n" + sep);
  console.log(`[${idx}/${REVIEW_TARGETS.length}] ${t.id}`);
  console.log(`観点: ${t.focus}`);
  console.log(sep);

  const postCase = findCase(post, t.id);
  const postRun = getRun(postCase);

  if (t.compareBaseline) {
    const baseCase = findCase(baseline, t.id);
    const baseRun = getRun(baseCase);
    show("baseline (改修前)", baseRun);
    show("post-B (改修後)", postRun);
  } else {
    show("post-B (新規ケース、改修後のみ)", postRun);
  }
  idx++;
}

console.log("\n=== レビューチェックリスト ===");
console.log("□ case-03: 既存補正（服部→腹部 等）が引き続き機能（劣化なし）");
console.log("□ case-03b: 胎動→体動 / 〜の正常→〜の性状 / 侵入部→刺入部 / 外装→咳嗽 / 常用→上葉 / 服雑音→副雑音 が全て補正された");
console.log("□ case-03c: 出力に『常用/複雑音/辱層/著名』が含まれず『上葉/副雑音/褥瘡/著明』に揃っている");
console.log("□ case-06: NRS2 / レスキュー1回 / ショートステイ予約 が O または A/P に明記");
console.log("□ case-07: S欄にsInputが passthrough、A で疼痛増悪・睡眠障害、P でレスキュー検討");
console.log("□ case-01: 過去記録の文末『〜』に揃っているか、メモにない情報を創作していないか");
