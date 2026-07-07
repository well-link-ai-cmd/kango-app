import fs from "node:fs";
type Run = { soap: { S: string; O: string; A: string; P: string } | null; model: string };
type Snap = { cases: Array<{ id: string; runs: Run[] }> };
const file = process.argv[2];
if (!file) {
  console.error("usage: tsx quality-gate.ts <snapshot.json>");
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(file, "utf-8")) as Snap;
const checks: Array<{ id: string; pass: boolean; reason: string }> = [];
for (const c of data.cases) {
  const raw = c.runs[0]?.soap;
  if (!raw) { checks.push({ id: c.id, pass: false, reason: "soap null" }); continue; }
  // 途中停止でフィールドが undefined のことがあるため空文字に正規化してからチェックする
  const r = { S: raw.S ?? "", O: raw.O ?? "", A: raw.A ?? "", P: raw.P ?? "" };
  let pass = true;
  let reason = "OK";
  // 全ケース共通: 生成の途中停止による O/A/P 欠落を検出（2026-07-07 case-05/10で間欠発生を確認）
  if (!r.O.trim() || !r.A.trim() || !r.P.trim()) { pass = false; reason = "O/A/P欠落（生成途中停止の疑い）"; }
  if (c.id === "case-06-answers-reflected" && r.S.length > 0) { pass = false; reason = "S 流入: " + r.S; }
  if (c.id === "case-05-gaps" && r.S.length > 0) { pass = false; reason = "S 流入: " + r.S; }
  if (c.id === "case-03c-corrupted-history") {
    const all = r.S + r.O + r.A + r.P;
    const corrupted = ["常用", "複雑音", "辱層", "著名"].filter((x) => all.includes(x));
    if (corrupted.length > 0) { pass = false; reason = "汚染データ流入: " + corrupted.join(","); }
  }
  if (c.id === "case-03b-voice-errors-extended") {
    const all = r.O + r.A + r.P;
    const wrong = ["胎動", "服雑音", "外装", "侵入部"].filter((x) => all.includes(x));
    if (wrong.length > 0) { pass = false; reason = "誤変換残存: " + wrong.join(","); }
  }
  if (c.id === "case-07-sinfo-influences-ap") {
    if (!r.S.includes("背中の痛み")) { pass = false; reason = "S情報passthrough失敗"; }
  }
  if (c.id === "case-10-next-visit-calendar") {
    // 予定に関する当日の行為（カレンダー記載）はOに、予定情報はPの末尾に
    if (!r.O.includes("カレンダー")) { pass = false; reason = "Oにカレンダー記載行為なし"; }
    else if (!r.P.includes("次回")) { pass = false; reason = "Pに次回訪問予定なし"; }
    else if (r.S.length > 0) { pass = false; reason = "S流入: " + r.S; }
  }
  if (c.id === "case-09-intake-notes-first-visit") {
    // カンファ由来の過去エピソードをOに創作しない／方針（転倒・服薬）はA/Pに考慮される
    if (r.O.includes("入院中") || r.O.includes("カンファ")) { pass = false; reason = "Oにカンファ由来エピソード混入: " + r.O.slice(0, 40); }
    else if (!(r.A + r.P).includes("転倒")) { pass = false; reason = "A/Pに転倒リスクの考慮なし"; }
    else if (r.S.length > 0) { pass = false; reason = "S流入: " + r.S; }
  }
  checks.push({ id: c.id, pass, reason });
}
const passed = checks.filter((x) => x.pass).length;
console.log("合格: " + passed + "/" + checks.length);
for (const c of checks) console.log((c.pass ? "OK " : "NG ") + c.id + " " + c.reason);
