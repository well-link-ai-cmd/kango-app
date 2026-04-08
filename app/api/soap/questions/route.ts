import { NextRequest, NextResponse } from "next/server";
import { generateAiResponse } from "@/lib/ai-client";
import { getAuthUser } from "@/lib/supabase-server";

interface PreviousRecord {
  visitDate: string;
  S: string;
  O: string;
  A: string;
  P: string;
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const body = await req.json();
  const { sInput, rawInput, previousRecords, carePlan, initialSoapRecords } = body as {
    sInput?: string;
    rawInput: string;
    previousRecords: PreviousRecord[];
    carePlan?: string;
    initialSoapRecords?: PreviousRecord[];
  };

  // アプリ内記録 + 初期インポート記録を統合
  const allRecords = [
    ...(previousRecords ?? []),
    ...(initialSoapRecords ?? []),
  ].slice(0, 3);

  if (allRecords.length === 0) {
    return NextResponse.json({ questions: [], alerts: [] });
  }

  const prevText = allRecords
    .map(
      (r, i) =>
        `【${i === 0 ? "前回" : i === 1 ? "前々回" : "3回前"}の記録${r.visitDate ? `（${r.visitDate}）` : ""}】\n` +
        `S: ${r.S}\nO: ${r.O}\nA: ${r.A}\nP: ${r.P}`
    )
    .join("\n\n");

  const prompt = `あなたは訪問看護の記録支援AIです。
過去の記録と今回の訪問メモを読み、看護師が記録に追記すべき確認事項を抽出してください。

${carePlan ? `【ケアプラン】\n${carePlan}\n` : ""}
${prevText}

${sInput?.trim() ? `【今回のS情報（利用者の発言）】\n${sInput}\n\n` : ""}【今回の訪問メモ（未整理）】
${rawInput}

以下のJSON形式で出力してください。余分な説明は不要です。
{
  "alerts": [
    "（前回Pランから引き継いだ観察・確認事項で、今回のメモに言及がないもの。最大3件）"
  ],
  "questions": [
    "（今回のメモをより充実させるために看護師に確認したい質問。最大4件）"
  ]
}

【ルール】
- alertsは前回・前々回のP（プラン）に記載された継続観察事項・フォローアップ事項のうち、今回のメモに言及がないものを抽出する
- questionsは今回のメモの内容を補完する具体的な確認質問にする（バイタル・症状・処置・生活状況など）
- 今回のメモに既に書かれていることは質問しない
- 質問は「〜はどうでしたか？」「〜は確認しましたか？」の形式で簡潔に
- 全体で7件以内に収める`;

  try {
    const response = await generateAiResponse(prompt);

    const jsonMatch = response.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ questions: [], alerts: [] });
    }
    const result = JSON.parse(jsonMatch[0]);
    return NextResponse.json({
      questions: result.questions ?? [],
      alerts: result.alerts ?? [],
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ questions: [], alerts: [] });
  }
}
