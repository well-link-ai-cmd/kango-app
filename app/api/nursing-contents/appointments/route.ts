import { NextRequest, NextResponse } from "next/server";
import { generateAiResponse } from "@/lib/ai-client";
import { getAuthUser } from "@/lib/supabase-server";

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const body = await req.json();
  const { records } = body;

  if (!records || records.length === 0) {
    return NextResponse.json({ error: "記録データがありません" }, { status: 400 });
  }

  const recordsText = records
    .map((r: { visitDate: string; S: string; O: string; A: string; P: string }, i: number) =>
      `【記録${i + 1}（${r.visitDate}）】\nS: ${r.S}\nO: ${r.O}\nA: ${r.A}\nP: ${r.P}`
    )
    .join("\n\n");



  const prompt = `あなたは訪問看護の記録分析AIです。
以下の訪問看護記録から、次回の受診予定・検査予定・予約情報を抽出してください。

${recordsText}

【出力形式】
以下のJSON形式で出力してください。余分な説明は不要です。

{
  "appointments": [
    {
      "date": "日付（記録に記載があれば。不明なら「未定」）",
      "type": "受診/検査/予約など",
      "detail": "内容（例：○○科受診、血液検査など）",
      "source": "どの記録から抽出したか（例：2026-03-15の記録）"
    }
  ],
  "notes": "受診に関する補足事項（あれば）"
}

【注意事項】
・P（プラン）やS（主観）に含まれる受診予定・検査予定を漏れなく抽出する
・「次回受診は○月○日」「来月検査予定」などの表現を探す
・該当がない場合は appointments を空配列で返す`;

  try {
    const response = await generateAiResponse(prompt);
    const jsonMatch = response.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: "AIの応答を解析できませんでした" }, { status: 500 });
    }
    const result = JSON.parse(jsonMatch[0]);
    return NextResponse.json(result);
  } catch (e) {
    console.error(e);
    const errorMessage = e instanceof Error ? e.message : "AI処理中にエラーが発生しました";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
