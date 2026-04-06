import { NextRequest, NextResponse } from "next/server";
import { generateAiResponse } from "@/lib/ai-client";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { rawInput, age, careLevel, diagnosis, carePlan, previousRecords, alertAnswers, questionAnswers, initialSoapRecords } = body;

  if (!rawInput?.trim()) {
    return NextResponse.json({ error: "訪問内容が入力されていません" }, { status: 400 });
  }

  // ケアプラン
  const carePlanSection = carePlan
    ? `\n【ケアプラン・担当者会議の方針】\n${carePlan}\n`
    : "";

  // 過去の訪問記録（アプリ内の記録 + 初期インポート記録を統合）
  const allPrevRecords = [
    ...(previousRecords ?? []),
    ...(initialSoapRecords ?? []),
  ].slice(0, 3);

  const prevSection = allPrevRecords.length > 0
    ? "\n【過去の訪問記録（参考）】\n" +
      allPrevRecords.map((r: { visitDate?: string; S: string; O: string; A: string; P: string }, i: number) =>
        `${i === 0 ? "前回" : i === 1 ? "前々回" : "3回前"}${r.visitDate ? `（${r.visitDate}）` : ""}: S:${r.S} / O:${r.O} / A:${r.A} / P:${r.P}`
      ).join("\n") + "\n"
    : "";

  // 継続確認アラートへの回答
  const alertAnswersSection = alertAnswers && alertAnswers.length > 0
    ? "\n【前回からの継続確認事項への回答】\n" +
      alertAnswers
        .filter((qa: { question: string; answer: string }) => qa.answer.trim())
        .map((qa: { question: string; answer: string }) => `継続確認: ${qa.question}\n回答: ${qa.answer}`)
        .join("\n") + "\n"
    : "";

  // 確認質問への回答
  const answersSection = questionAnswers && questionAnswers.length > 0
    ? "\n【AIからの確認質問への回答】\n" +
      questionAnswers
        .filter((qa: { question: string; answer: string }) => qa.answer.trim())
        .map((qa: { question: string; answer: string }) => `Q: ${qa.question}\nA: ${qa.answer}`)
        .join("\n") + "\n"
    : "";

  const prompt = `あなたは訪問看護師の記録作成を支援するAIです。
以下の利用者情報と訪問内容から、SOAP形式の看護記録を作成してください。

【利用者情報（匿名）】
年齢：${age}歳
介護度：${careLevel}
主病名：${diagnosis}
${carePlanSection}${prevSection}
【訪問時の内容（看護師のメモ）】
${rawInput}
${alertAnswersSection}${answersSection}
【出力形式】
以下のJSON形式で出力してください。余分な説明は不要です。
{
  "S": "主観的情報（利用者・家族の言葉や訴え）",
  "O": "客観的情報（バイタル・観察所見・処置内容を具体的に）",
  "A": "アセスメント（状態の評価・判断・問題点）",
  "P": "プラン（今後のケア方針・継続観察事項・医師報告の必要性など）"
}

【Sの書き方】最重要
・Sは利用者・家族が実際に話した言葉をそのまま記載する。看護師が要約・書き換えしてはいけない
・方言・口語・くだけた表現はそのまま残す（例：「いらんのちゃうかなぁ」「寝れた感じはしないです」「もういつものことやから」）
・敬語化・書き言葉化は絶対にしない。「お変わりなく過ごしています」ではなく「体調は変わりないです」のように本人の口調で書く
・Sに看護師の観察や判断を混ぜない。Sは利用者・家族の言葉のみで構成する

【O/A/Pの書き方】
・看護師が入力した内容・継続確認への回答・確認質問への回答を統合して整理する。勝手に事実を追加しない
・前回記録のプランに記載された継続事項を今回のA・Pに反映させる
・継続確認事項への回答がある場合は、その内容を必ずOまたはAに含める
・医療・看護の専門用語を適切に使用する
・Pは自然な文章で書く。①②③のような番号付きリストや【見出し】のような括弧付き見出しは使わない
・過去の記録が提供されている場合は、そのトーン・文体・詳細度を参考にして同じスタイルで書く

【音声入力の誤変換補正】
・入力テキストは音声入力で作成されている可能性が高い
・医療用語の誤変換を自動的に正しい医療用語に補正して出力すること
・例：「じょくそう」→「褥瘡」、「ふしゅ」→「浮腫」、「けつあつ」→「血圧」、「たんきゅう」→「痰吸引」
・ひらがなのまま入力された医療用語も適切な漢字・専門用語に変換する
・O/A/Pの略語や口語表現は看護記録にふさわしい表現に整える（Sは除く。Sは話し言葉のまま）`;

  try {
    const response = await generateAiResponse(prompt);

    // JSONを抽出
    const jsonMatch = response.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: "AIの応答を解析できませんでした。もう一度お試しください。" }, { status: 500 });
    }

    const soap = JSON.parse(jsonMatch[0]);
    return NextResponse.json(soap);
  } catch (e) {
    console.error(e);
    const errorMessage = e instanceof Error ? e.message : "AI変換中にエラーが発生しました。";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
