/**
 * baseline と post-改修 の差分を表示する。
 * 使い方: npx tsx tests/prompts/soap/diff-snapshot.ts <baseline.json> <post.json>
 */
import fs from "node:fs";
import path from "node:path";

interface Run {
  model: string;
  usage: { input_tokens: number; output_tokens: number };
  outputChars: { extracted_facts: number; coverage_check: number; S: number; O: number; A: number; P: number };
  elapsedMs: number;
}
interface Snapshot {
  ranAt: string;
  promptHash: string;
  promptMeta: { systemPromptChars: number; toolDescChars: number; fewshotChars: number };
  casesFileHash: string;
  cases: Array<{ id: string; description: string; runs: Run[] }>;
}

const [aPath, bPath] = process.argv.slice(2);
if (!aPath || !bPath) {
  console.error("usage: tsx diff-snapshot.ts <baseline.json> <post.json>");
  process.exit(1);
}
const a = JSON.parse(fs.readFileSync(path.isAbsolute(aPath) ? aPath : path.join(process.cwd(), aPath), "utf-8")) as Snapshot;
const b = JSON.parse(fs.readFileSync(path.isAbsolute(bPath) ? bPath : path.join(process.cwd(), bPath), "utf-8")) as Snapshot;

console.log("=== Snapshot diff ===");
console.log("baseline:", aPath, "promptHash=" + a.promptHash, "casesFileHash=" + a.casesFileHash);
console.log("post   :", bPath, "promptHash=" + b.promptHash, "casesFileHash=" + b.casesFileHash);
console.log("promptHash 変化:", a.promptHash !== b.promptHash ? "✅ 変更検知" : "❌ 同一（プロンプト未変更？）");

console.log("\n=== promptMeta 差分 ===");
const fields = ["systemPromptChars", "toolDescChars", "fewshotChars"] as const;
for (const f of fields) {
  const av = a.promptMeta[f];
  const bv = b.promptMeta[f];
  const d = bv - av;
  const sign = d === 0 ? "" : d < 0 ? `(${d})` : `(+${d})`;
  console.log(`${f.padEnd(20)} ${String(av).padStart(7)} → ${String(bv).padStart(7)} ${sign}`);
}

console.log("\n=== ケースごとの差分（共通idのみ）===");
const aMap = new Map(a.cases.map((c) => [c.id, c]));
const commonIds = b.cases.filter((c) => aMap.has(c.id)).map((c) => c.id);

console.log(["id".padEnd(35), "in_diff".padStart(8), "out_diff".padStart(9), "sum_diff".padStart(9)].join(" "));
let totalInDiff = 0;
let totalOutDiff = 0;
for (const id of commonIds) {
  const aCase = aMap.get(id)!;
  const bCase = b.cases.find((c) => c.id === id)!;
  const aRun = aCase.runs.find((r) => r.model === "haiku");
  const bRun = bCase.runs.find((r) => r.model === "haiku");
  if (!aRun || !bRun) continue;
  const inDiff = bRun.usage.input_tokens - aRun.usage.input_tokens;
  const outDiff = bRun.usage.output_tokens - aRun.usage.output_tokens;
  const aSum = Object.values(aRun.outputChars).reduce((s, n) => s + n, 0);
  const bSum = Object.values(bRun.outputChars).reduce((s, n) => s + n, 0);
  const sumDiff = bSum - aSum;
  totalInDiff += inDiff;
  totalOutDiff += outDiff;
  console.log([
    id.padEnd(35),
    (inDiff >= 0 ? "+" + inDiff : String(inDiff)).padStart(8),
    (outDiff >= 0 ? "+" + outDiff : String(outDiff)).padStart(9),
    (sumDiff >= 0 ? "+" + sumDiff : String(sumDiff)).padStart(9),
  ].join(" "));
}

console.log("\n=== 共通ケース合計 ===");
console.log("input_tokens 差分 :", totalInDiff >= 0 ? "+" + totalInDiff : totalInDiff);
console.log("output_tokens 差分:", totalOutDiff >= 0 ? "+" + totalOutDiff : totalOutDiff);

const aCommonIn = commonIds.reduce((s, id) => s + (aMap.get(id)!.runs.find((r) => r.model === "haiku")?.usage.input_tokens ?? 0), 0);
const aCommonOut = commonIds.reduce((s, id) => s + (aMap.get(id)!.runs.find((r) => r.model === "haiku")?.usage.output_tokens ?? 0), 0);
const bCommonIn = commonIds.reduce((s, id) => s + (b.cases.find((c) => c.id === id)!.runs.find((r) => r.model === "haiku")?.usage.input_tokens ?? 0), 0);
const bCommonOut = commonIds.reduce((s, id) => s + (b.cases.find((c) => c.id === id)!.runs.find((r) => r.model === "haiku")?.usage.output_tokens ?? 0), 0);

const HAIKU_IN = 1.0;
const HAIKU_OUT = 5.0;
const aCost = (aCommonIn / 1_000_000) * HAIKU_IN + (aCommonOut / 1_000_000) * HAIKU_OUT;
const bCost = (bCommonIn / 1_000_000) * HAIKU_IN + (bCommonOut / 1_000_000) * HAIKU_OUT;
console.log("\n=== 共通ケース合計コスト（USD / JPY155円換算）===");
console.log("baseline:", "$" + aCost.toFixed(4), "(¥" + (aCost * 155).toFixed(2) + ")");
console.log("post    :", "$" + bCost.toFixed(4), "(¥" + (bCost * 155).toFixed(2) + ")");
console.log("差分    :", "$" + (bCost - aCost).toFixed(4), "(¥" + ((bCost - aCost) * 155).toFixed(2) + ")");
console.log("削減率   :", (((aCost - bCost) / aCost) * 100).toFixed(2) + "%");

const newIds = b.cases.filter((c) => !aMap.has(c.id)).map((c) => c.id);
if (newIds.length > 0) {
  console.log("\n=== post に追加されたケース ===");
  for (const id of newIds) console.log(" -", id);
}
