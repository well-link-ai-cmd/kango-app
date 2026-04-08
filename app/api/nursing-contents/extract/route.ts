import { NextRequest, NextResponse } from "next/server";
import { generateAiResponse } from "@/lib/ai-client";
import { getAuthUser } from "@/lib/supabase-server";

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const body = await req.json();
  const { records, carePlan } = body;

  if (!records || records.length === 0) {
    return NextResponse.json({ error: "記録データがありません" }, { status: 400 });
  }

  const recordsText = records
    .map((r: { visitDate: string; S: string; O: string; A: string; P: string }, i: number) =>
      `【記録${i + 1}（${r.visitDate}）】\nS: ${r.S}\nO: ${r.O}\nA: ${r.A}\nP: ${r.P}`
    )
    .join("\n\n");

  const carePlanSection = carePlan ? `\n【ケアプラン】\n${carePlan}\n` : "";

  const prompt = `あなたは訪問看護の記録分析AIです。
以下の訪問看護記録とケアプラン情報から、この利用者に対して定期的に実施している看護内容・ケア項目を抽出してください。
${carePlanSection}
${recordsText}

【出力形式】
以下のJSON配列で出力してください。余分な説明は不要です。
項目は具体的かつ簡潔に（例：「バイタル測定（血圧・脈拍・体温・SpO2）」「褥瘡の観察・処置」「服薬確認・管理」）。
重要度が高い順に並べてください。

[
  "ケア項目1",
  "ケア項目2",
  ...
]

【注意事項】
・記録に繰り返し登場する観察・処置・指導を抽出する
・ケアプランに記載されている内容も反映する
・一般的すぎる項目（例：「健康観察」）は避け、具体的に書く
・最大15項目まで`;

  try {
    const response = await generateAiResponse(prompt);
    const jsonMatch = response.text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return NextResponse.json({ error: "AIの応答を解析できませんでした" }, { status: 500 });
    }
    const items = JSON.parse(jsonMatch[0]);
    return NextResponse.json({ items });
  } catch (e) {
    console.error(e);
    const errorMessage = e instanceof Error ? e.message : "AI処理中にエラーが発生しました";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
