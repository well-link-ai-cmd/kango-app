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
  const { sInput, rawInput, previousRecords, carePlan, nursingContentItems, initialSoapRecords } = body as {
    sInput?: string;
    rawInput: string;
    previousRecords: PreviousRecord[];
    carePlan?: string;
    nursingContentItems?: string[];
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

${carePlan ? `【ケアプラン】\n${carePlan}\n` : ""}${nursingContentItems && nursingContentItems.length > 0 ? `【登録済みケア内容】\n${nursingContentItems.map(item => `・${item}`).join("\n")}\n` : ""}
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
★最重要★ 時制・文脈を正確に読み取ること：
- このメモは「今日の訪問で行ったこと・観察したこと」である。今日行った変更や処置の"結果"はまだ出ていないので、その効果や経過を尋ねてはいけない
  例：「眠剤を1錠から2錠に増やした」→ ✕「睡眠状況はどうでしたか？」（増やした効果はまだわからない）
  例：「来週眼科オペ予定」→ ✕「手術後の症状はありましたか？」（まだオペしていない）
- 「〜に変更した」「〜を開始した」「〜を増やした」「様子を見る」等は今日行った介入であり、結果確認は次回以降の話
- 「前回〜した」「先週〜があった」など過去の記述がある場合のみ、その経過を確認してよい

★重要★ バイタルサインについて：
- バイタルサイン（血圧・脈拍・体温・SpO2等）は別の記録欄で入力されるため、メモに記載がなくても汎用的な「バイタルサインの記載がありません」というアラートは出さない
- ただし、患者の病態・ケアプラン・過去記録から特定のバイタルが臨床的に重要な場合（例：高血圧管理中の患者で血圧の言及がない、呼吸器疾患でSpO2の言及がない）は、その特定のバイタル項目のみピンポイントで確認してよい
- 登録済みケア内容に「バイタル測定」等の一般的なバイタル項目がある場合も、上記ルールに従い汎用アラートは出さない

alertsのルール：
- 前回・前々回のP（プラン）に記載された継続観察事項・フォローアップ事項のうち、今回のメモに言及がないものを抽出する
- 登録済みケア内容が提供されている場合、そのケア項目のうち今回のメモに言及がないものもalertsに含める（例：「褥瘡処置について記載がありません」）
- ただしバイタル関連の汎用アラートは上記ルールにより除外する

questionsのルール：
- 今回のメモの内容を補完する具体的な確認質問にする（症状・処置・生活状況など）
- 今回のメモに既に書かれていることは質問しない
- メモの内容を正確に理解した上で、文脈に沿った質問のみ出す
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
