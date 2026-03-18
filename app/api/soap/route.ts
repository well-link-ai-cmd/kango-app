import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "APIキーが設定されていません。.env.localを確認してください。" }, { status: 500 });
  }

  const body = await req.json();
  const { rawInput, age, careLevel, diagnosis, carePlan } = body;

  if (!rawInput?.trim()) {
    return NextResponse.json({ error: "訪問内容が入力されていません" }, { status: 400 });
  }

  // ★ 個人情報（氏名・住所等）はAIに送らず、匿名化した情報のみ使用
  const carePlanSection = carePlan
    ? `\n【ケアプラン・担当者会議の方針】\n${carePlan}\n`
    : "";

  const prompt = `あなたは訪問看護師の記録作成を支援するAIです。
以下の利用者情報と訪問内容から、SOAP形式の看護記録を作成してください。

【利用者情報（匿名）】
年齢：${age}歳
介護度：${careLevel}
主病名：${diagnosis}
${carePlanSection}
【訪問時の内容（看護師のメモ）】
${rawInput}

【出力形式】
以下のJSON形式で出力してください。余分な説明は不要です。
{
  "S": "主観的情報（利用者・家族の言葉や訴え）",
  "O": "客観的情報（バイタル・観察所見・処置内容を具体的に）",
  "A": "アセスメント（状態の評価・判断・問題点）",
  "P": "プラン（今後のケア方針・継続観察事項・医師報告の必要性など）"
}

【注意事項】
・看護師が入力した内容を整理・補完するが、勝手に事実を追加しない
・医療・看護の専門用語を適切に使用する
・SOAPの各項目は具体的かつ簡潔に記載する
・プランには次回訪問時の観察ポイントを含める`;

  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const text = message.content[0].type === "text" ? message.content[0].text : "";

    // JSONを抽出
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: "AIの応答を解析できませんでした。もう一度お試しください。" }, { status: 500 });
    }

    const soap = JSON.parse(jsonMatch[0]);
    return NextResponse.json(soap);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "AI変換中にエラーが発生しました。しばらく待ってから再試行してください。" }, { status: 500 });
  }
}
