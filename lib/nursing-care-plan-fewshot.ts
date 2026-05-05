/**
 * 看護計画書 AI生成 Few-shot 例
 *
 * ⚠️ このファイルは雛形（プレースホルダー）です。
 * 実運用前に看護師レビューを経た実記録ベースの例に差し替えること。
 *
 * 現状の運用：
 * - Few-shotなしで先に動作検証し、責任者から実記録ベースのサンプルを受領後に本物に差し替える
 * - 差し替え時は tests/prompts/nursing-care-plan/run.ts と同期すること
 *
 * 差し替え手順（ai-record-tools-design.md 参照）：
 * 1. 現場の実記録（看護師が「これは良い記録」と判断したもの）を3〜5件選定
 * 2. Sonnet で話し言葉逆生成 → 看護師レビュー
 * 3. 確定した Before/After ペアをこのファイルに埋め込み
 * 4. tests/prompts/nursing-care-plan/run.ts で効果測定
 */

export interface NursingCarePlanFewshot {
  description: string;
  input: {
    patient: { age: number; diagnosis: string; careLevel: string };
    nursingContentItems?: string[];
    recentSoapRecords?: { visitDate?: string; S: string; O: string; A: string; P: string }[];
  };
  output: {
    nursing_goal: string;
    issues: { no: number; issue: string }[];
  };
}

/**
 * TODO（看護師レビュー待ち）: 実記録ベースの例 3〜5件をここに追加する
 */
export const NURSING_CARE_PLAN_FEWSHOTS: NursingCarePlanFewshot[] = [
  // プレースホルダー - 看護師レビュー済みの実例に差し替えること
];

/**
 * Few-shot例をシステムプロンプト末尾に注入するための整形関数。
 * まだ例が空の場合は空文字を返す（Few-shotなしで動作）。
 */
export function formatNursingCarePlanFewshots(): string {
  if (NURSING_CARE_PLAN_FEWSHOTS.length === 0) return "";

  const examples = NURSING_CARE_PLAN_FEWSHOTS.map((ex, i) => {
    const soapPart = ex.input.recentSoapRecords?.map(
      (r, j) => `[SOAP${j + 1}${r.visitDate ? `（${r.visitDate}）` : ""}]\nS: ${r.S}\nO: ${r.O}\nA: ${r.A}\nP: ${r.P}`
    ).join("\n\n") ?? "（なし）";

    const issuesPart = ex.output.issues.map((issue) => `  ${issue.no}. ${issue.issue}`).join("\n");

    return `## 例${i + 1}: ${ex.description}
【入力】
患者: ${ex.input.patient.age}歳 / ${ex.input.patient.diagnosis} / ${ex.input.patient.careLevel}
SOAP:
${soapPart}

【出力】
nursing_goal: ${ex.output.nursing_goal}
issues:
${issuesPart}`;
  }).join("\n\n---\n\n");

  return `\n\n# Few-shot 例（実記録ベース・看護師レビュー済み）\n以下の例の粒度・文体・構造を参考にすること。\n\n${examples}`;
}
