import { NextRequest, NextResponse } from "next/server";
import { generateAiResponse } from "@/lib/ai-client";
import { aiErrorResponse } from "@/lib/ai-error-response";
import { getAuthUser } from "@/lib/supabase-server";

import { logAiSend } from "@/lib/audit-server";
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



  const systemPrompt = `訪問看護記録から、利用者本人の「外来受診」「往診・訪問診療」「検査」の予定だけを抽出するAI。JSONのみ出力。説明文不要。
{"appointments":[{"date":"日付or未定","type":"外来受診/往診/訪問診療/検査/予約","detail":"内容（診療科・医療機関・時間など分かる範囲で）","source":"記録N（記録日）"}],"notes":"補足"}

【抽出する】
- 病院・クリニックへの外来受診・通院・診察の予定
- 医師の往診・訪問診療の予定
- 採血・レントゲン・CT・MRI・エコー等の検査、医療機関の予約

【抽出しない（重要）】
- 訪問看護師自身の次回訪問予定（例:「明日15時ごろ訪問予定」「次回訪問」「次回◯曜日訪問」「次回△△が訪問」）は受診予定ではないので必ず除外する
- リハビリ・入浴・服薬・処置など日常ケアの予定

【日付】
- 記録日（【記録N（YYYY-MM-DD）】）を基準に「明日」「来週月曜」等を実際の日付 YYYY-MM-DD に変換。特定できなければ "未定"

該当する予定がなければ appointments を空配列で返す。`;

  const prompt = recordsText;

  try {
    // 医療情報のAI送信を監査記録（越境送信の記録・fire-and-forget）
    logAiSend("nursing_contents_appointments", null);
    const response = await generateAiResponse(prompt, systemPrompt, { temperature: 0.2 });
    const jsonMatch = response.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: "AIの応答を解析できませんでした" }, { status: 500 });
    }
    const result = JSON.parse(jsonMatch[0]);
    return NextResponse.json(result);
  } catch (e) {
    return aiErrorResponse(e);
  }
}
