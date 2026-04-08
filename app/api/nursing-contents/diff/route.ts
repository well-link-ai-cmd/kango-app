import { NextRequest, NextResponse } from "next/server";
import { generateAiResponse } from "@/lib/ai-client";
import { getAuthUser } from "@/lib/supabase-server";

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const body = await req.json();
  const { currentItems, records, carePlan } = body;

  if (!records || records.length === 0) {
    return NextResponse.json({ error: "記録データがありません" }, { status: 400 });
  }

  const recordsText = records
    .map((r: { visitDate: string; S: string; O: string; A: string; P: string }, i: number) =>
      `【記録${i + 1}（${r.visitDate}）】\nS: ${r.S}\nO: ${r.O}\nA: ${r.A}\nP: ${r.P}`
    )
    .join("\n\n");

  const currentItemsText = currentItems && currentItems.length > 0
    ? `\n【現在の看護内容リスト】\n${currentItems.map((item: string, i: number) => `${i + 1}. ${item}`).join("\n")}\n`
    : "";

  const carePlanSection = carePlan ? `\n【ケアプラン】\n${carePlan}\n` : "";

  const prompt = `あなたは訪問看護の記録分析AIです。
現在登録されている看護内容リストと最新の訪問看護記録を比較し、追加すべき項目と削除候補を提案してください。
${carePlanSection}${currentItemsText}
${recordsText}

【出力形式】
以下のJSON形式で出力してください。余分な説明は不要です。

{
  "additions": ["追加すべきケア項目1", "追加すべきケア項目2"],
  "removals": ["削除候補のケア項目（現在のリストに含まれるもの）"],
  "reason": "変更理由の簡潔な説明"
}

【注意事項】
・追加候補は現在のリストに含まれていない新しい項目のみ
・削除候補は記録に最近登場しなくなった項目のみ
・変更がない場合は空配列で返す`;

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
