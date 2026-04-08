import { NextRequest, NextResponse } from "next/server";
import { generateAiResponse } from "@/lib/ai-client";
import { getAuthUser } from "@/lib/supabase-server";

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const body = await req.json();
  const { sInput, rawInput, carePlan, previousRecords, alertAnswers, questionAnswers, initialSoapRecords } = body;

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
    ? "\n【過去の訪問記録（参考・文体や構成を模倣すること）】\n" +
      allPrevRecords.map((r: { visitDate?: string; S: string; O: string; A: string; P: string }, i: number) =>
        `--- ${i === 0 ? "前回" : i === 1 ? "前々回" : "3回前"}${r.visitDate ? `（${r.visitDate}）` : ""} ---\nS: ${r.S}\nO: ${r.O}\nA: ${r.A}\nP: ${r.P}`
      ).join("\n\n") + "\n"
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

  // S情報が個別入力されている場合は、SはパススルーしてOAPのみ生成
  const hasSInput = sInput?.trim();

  const prompt = hasSInput
    ? `あなたは訪問看護師の記録作成を支援するAIです。
S情報（利用者の発言）は看護師が既に記録済みです。看護師が話し言葉で伝えた訪問内容から、O・A・Pを生成してください。
${carePlanSection}${prevSection}
【S情報（看護師が記録済み・参考情報として参照）】
${sInput}

【訪問時の内容（看護師のメモ・O/A/P生成用）】
${rawInput}
${alertAnswersSection}${answersSection}
【出力形式】
以下のJSON形式で出力してください。余分な説明は不要です。
{
  "S": "（看護師が入力したS情報をそのまま返す。医療用語の誤字・誤変換のみ補正。文体や表現は一切変えない）",
  "O": "客観的情報",
  "A": "アセスメント",
  "P": "プラン"
}

【Sの書き方】
・看護師が入力した以下のS情報をそのまま返す。文体・表現・話し言葉は一切変更しない
・修正して良いのは、音声入力による医療用語の誤変換のみ（例：「けつあつ」→「血圧」、「じょくそう」→「褥瘡」）
・間接話法（「〜とのこと」「〜と言っていた」「〜と話される」）への変換は絶対にしない
・家族の発言が含まれている場合はそのまま残す

【O/A/Pの書き方】
O：訪問の場面描写から始め、時系列に沿って自然な文章で書く。バイタル・処置・観察所見を具体的に。見出し（【】）や箇条書きは使わない。次回訪問予定があれば末尾に記載する。
A：観察所見や症状から直接書き始め、臨床的な判断で締める。「〜に関しては」「〜について」のような問題名の前置きは使わない。例：「呼吸困難感や水泡音、呼吸促迫、下肢の浮腫等ないため、心不全兆候は見られていない」のように、所見→判断の順で簡潔に記述する。前回からの変化があれば含める。番号リストは使わない。
P：今後のケア方針を自然な文章で3〜5文にまとめる。「〜していく」「〜を継続する」の語尾で統一。番号リスト・見出しは使わない。

【重要】
・メモから要点を抽出して整理する。勝手に事実を追加しない
・前回記録のプランに記載された継続事項を今回のA・Pに反映する
・★最重要★ 過去の訪問記録が提供されている場合は、そのS/O/A/Pの文体・構成・詳細度・文章量を忠実に模倣する
・音声入力の誤変換は正しい医療用語に補正する
・S情報は看護師の入力をほぼそのまま返す。内容の追加・削除・言い換えはしない`

    : `あなたは訪問看護師の記録作成を支援するAIです。
看護師が話し言葉でバーッと書き込んだメモから、要点を抽出してSOAP形式の看護記録に成形してください。
${carePlanSection}${prevSection}
【訪問時の内容（看護師のメモ）】
${rawInput}
${alertAnswersSection}${answersSection}
【出力形式】
以下のJSON形式で出力してください。余分な説明は不要です。
{
  "S": "主観的情報",
  "O": "客観的情報",
  "A": "アセスメント",
  "P": "プラン"
}

【各項目の書き方】
S：利用者本人の一人称の言葉で書く。方言・口語はそのまま残す。看護師の間接話法（「〜とのこと」「〜されていた」）では書かない。家族の発言は「妻S：」のように話者を分ける。
O：訪問の場面描写から始め、時系列に沿って自然な文章で書く。バイタル・処置・観察所見を具体的に。見出し（【】）や箇条書きは使わない。次回訪問予定があれば末尾に記載する。
A：観察所見や症状から直接書き始め、臨床的な判断で締める。「〜に関しては」「〜について」のような問題名の前置きは使わない。例：「呼吸困難感や水泡音、呼吸促迫、下肢の浮腫等ないため、心不全兆候は見られていない」のように、所見→判断の順で簡潔に記述する。前回からの変化があれば含める。番号リストは使わない。
P：今後のケア方針を自然な文章で3〜5文にまとめる。「〜していく」「〜を継続する」の語尾で統一。番号リスト・見出しは使わない。

【重要】
・メモから要点を抽出して整理する。勝手に事実を追加しない
・前回記録のプランに記載された継続事項を今回のA・Pに反映する
・★最重要★ 過去の訪問記録が提供されている場合は、そのS/O/A/Pの文体・構成・詳細度・文章量を忠実に模倣する
・音声入力の誤変換は正しい医療用語に補正する（O/A/Pのみ。Sは話し言葉のまま）`;

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
