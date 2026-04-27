import fs from "node:fs";
const v3 = JSON.parse(fs.readFileSync("tests/prompts/soap/post-phase-b-v3-2026-04-27.json", "utf8"));
const c = v3.cases.find((x: { id: string }) => x.id === "case-06-answers-reflected").runs[0].soap;
console.log("=== case-06 v3 ===");
console.log("S:", JSON.stringify(c.S));
console.log("\nO:\n" + c.O);
console.log("\nA:\n" + c.A);
console.log("\nP:\n" + c.P);
