/**
 * baseline JSON を集計するユーティリティ。
 * 使い方: npx tsx tests/prompts/soap/summarize-baseline.ts tests/prompts/soap/baseline-2026-04-27.json
 */
import fs from "node:fs";
import path from "node:path";

interface Run {
  model: string;
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number };
  outputChars: { extracted_facts: number; coverage_check: number; S: number; O: number; A: number; P: number };
  elapsedMs: number;
}
interface Snapshot {
  ranAt: string;
  modelMode: string;
  promptHash: string;
  promptMeta: { systemPromptChars: number; toolDescChars: number; fewshotChars: number };
  casesFileHash: string;
  caseFilter: string;
  cases: Array<{ id: string; description: string; runs: Run[] }>;
}

const arg = process.argv[2];
if (!arg) {
  console.error("usage: tsx summarize-baseline.ts <path-to-snapshot.json>");
  process.exit(1);
}
const file = path.isAbsolute(arg) ? arg : path.join(process.cwd(), arg);
const data = JSON.parse(fs.readFileSync(file, "utf-8")) as Snapshot;

console.log("=== メタ情報 ===");
console.log("ranAt:", data.ranAt);
console.log("modelMode:", data.modelMode);
console.log("promptHash:", data.promptHash);
console.log("promptMeta:", JSON.stringify(data.promptMeta));
console.log("casesFileHash:", data.casesFileHash);
console.log("caseFilter:", data.caseFilter);
console.log("cases数:", data.cases.length);

// Haiku 4.5 価格（USD per Mtok）：input $1.0 / output $5.0
const HAIKU_IN = 1.0;
const HAIKU_OUT = 5.0;
const JPY_PER_USD = 155;

let totalIn = 0;
let totalOut = 0;
let totalUSD = 0;

console.log("\n=== ケースごとの token / outputChars ===");
console.log(["id".padEnd(35), "model".padEnd(7), "in".padStart(7), "out".padStart(6), "sumChars".padStart(9), "ms".padStart(6)].join(" "));
for (const c of data.cases) {
  for (const r of c.runs) {
    const u = r.usage;
    const oc = r.outputChars;
    const sumChars = oc.extracted_facts + oc.coverage_check + oc.S + oc.O + oc.A + oc.P;
    const cost = (u.input_tokens / 1_000_000) * HAIKU_IN + (u.output_tokens / 1_000_000) * HAIKU_OUT;
    if (r.model === "haiku") {
      totalIn += u.input_tokens;
      totalOut += u.output_tokens;
      totalUSD += cost;
    }
    console.log([
      c.id.padEnd(35),
      r.model.padEnd(7),
      String(u.input_tokens).padStart(7),
      String(u.output_tokens).padStart(6),
      String(sumChars).padStart(9),
      String(r.elapsedMs).padStart(6),
    ].join(" "));
  }
}

console.log("\n=== Haiku 集計（cache無し前提）===");
console.log("合計 input_tokens :", totalIn);
console.log("合計 output_tokens:", totalOut);
console.log("合計 USD          : $" + totalUSD.toFixed(4));
console.log("合計 JPY (155円)  : ¥" + (totalUSD * JPY_PER_USD).toFixed(2));
console.log("1ケースあたり JPY: ¥" + ((totalUSD * JPY_PER_USD) / data.cases.length).toFixed(2));
console.log("out / in 比率     :", ((totalOut / totalIn) * 100).toFixed(1) + "%");

console.log("\n=== systemPrompt 構造（promptMeta） ===");
const m = data.promptMeta;
console.log("systemPromptChars:", m.systemPromptChars);
console.log("  うち fewshotChars:", m.fewshotChars, "(" + ((m.fewshotChars / m.systemPromptChars) * 100).toFixed(1) + "%)");
console.log("  非fewshot部分    :", m.systemPromptChars - m.fewshotChars, "(" + (((m.systemPromptChars - m.fewshotChars) / m.systemPromptChars) * 100).toFixed(1) + "%)");
console.log("toolDescChars    :", m.toolDescChars);

console.log("\n=== input_tokens 分解の推定（1tok≈3.5char換算）===");
const sysApprox = Math.round(m.systemPromptChars / 3.5);
const toolApprox = Math.round(m.toolDescChars / 3.5);
const fixedApprox = sysApprox + toolApprox;
const avgIn = Math.round(totalIn / data.cases.length);
console.log("systemPrompt(approx tokens)  :", sysApprox);
console.log("toolDesc    (approx tokens)  :", toolApprox);
console.log("固定部分 (sys+tool, approx)   :", fixedApprox);
console.log("ケース平均 input_tokens       :", avgIn);
console.log("ケース入力依存 (平均)         :", avgIn - fixedApprox, "(approx)");
