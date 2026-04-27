import fs from "node:fs";
const v1 = JSON.parse(fs.readFileSync("tests/prompts/soap/post-phase-b-2026-04-27.json", "utf8"));
const v2 = JSON.parse(fs.readFileSync("tests/prompts/soap/post-phase-b-v2-2026-04-27.json", "utf8"));
const v3 = JSON.parse(fs.readFileSync("tests/prompts/soap/post-phase-b-v3-2026-04-27.json", "utf8"));
const baseline = JSON.parse(fs.readFileSync("tests/prompts/soap/baseline-2026-04-27.json", "utf8"));
const ids = [
  "case-01-structured",
  "case-02-rambling",
  "case-03-voice-errors",
  "case-03b-voice-errors-extended",
  "case-03c-corrupted-history",
  "case-04-already-covered",
  "case-05-gaps",
  "case-06-answers-reflected",
  "case-07-sinfo-influences-ap",
];
type Run = { model: string; soap: { S: string; O: string; A: string; P: string } | null };
type Snap = { cases: Array<{ id: string; runs: Run[] }> };
const find = (s: Snap, id: string) => s.cases.find((c) => c.id === id)?.runs.find((r) => r.model === "haiku")?.soap ?? null;
console.log("S欄の差分（baseline / v1 / v2）");
for (const id of ids) {
  const b = find(baseline as Snap, id);
  const a = find(v1 as Snap, id);
  const c = find(v2 as Snap, id);
  const d = find(v3 as Snap, id);
  console.log("\n=== " + id + " ===");
  console.log("baseline S: [" + (b?.S ?? "(なし)") + "]");
  console.log("post v1  S: [" + (a?.S ?? "(なし)") + "]");
  console.log("post v2  S: [" + (c?.S ?? "(なし)") + "]");
  console.log("post v3  S: [" + (d?.S ?? "(なし)") + "]");
}
