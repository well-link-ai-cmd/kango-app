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

  const systemPrompt = `看護記録からケア項目を抽出するAI。JSON配列のみ出力。説明文不要。
["ケア項目1","ケア項目2",...]
- 記録に繰り返し登場する観察・処置・指導を抽出
- ケアプランの内容も反映
- 具体的に書く（✕「健康観察」→○「バイタル測定（血圧・脈拍・体温・SpO2）」）
- 重要度順。最大15項目`;

  const prompt = `${carePlanSection}
${recordsText}`;

  try {
    // 医療情報のAI送信を監査記録（越境送信の記録・fire-and-forget）
    logAiSend("nursing_contents_extract", null);
    const response = await generateAiResponse(prompt, systemPrompt, { temperature: 0.2 });
    const jsonMatch = response.text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return NextResponse.json({ error: "AIの応答を解析できませんでした" }, { status: 500 });
    }
    const items = JSON.parse(jsonMatch[0]);
    return NextResponse.json({ items });
  } catch (e) {
    return aiErrorResponse(e);
  }
}
