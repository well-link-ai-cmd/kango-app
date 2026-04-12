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

  const systemPrompt = `あなたは訪問看護の記録支援AIである。過去記録と今回のメモを比較し、確認事項を抽出する。
メモは音声入力のため誤変換がある。文脈から正しい医療用語として読み取ること（例：朝蠕動音=腸蠕動音、服部=腹部、配便=排便）。

# 出力形式
JSONのみ出力。説明文は不要。
{"alerts":["..."],"questions":["..."]}

# 絶対ルール：時制
メモは「今日の訪問で行ったこと」である。今日行った処置の効果・結果はまだ出ていないので聞かない。
✕「眠剤を増やした」→「睡眠はどうですか？」（効果はまだ不明）
✕「来週オペ予定」→「術後の状態は？」（まだ手術していない）
○「前回〜した」「先週〜があった」→ その経過確認はOK

# バイタル
バイタルは別欄で入力されるため「バイタル記載がない」という汎用アラートは出さない。
病態上重要な特定項目（高血圧患者の血圧等）のみピンポイントで確認してよい。

# alerts（最大3件）
前回Pの継続事項で、今回メモに言及がないものを抽出する。
登録済みケア内容で、今回メモに言及がないものも含める。

# questions（最大4件）
メモの内容を補完する具体的な質問。既に書かれていることは聞かない。
「〜はどうでしたか？」「〜は確認しましたか？」形式で簡潔に。`;

  const prompt = `${carePlan ? `【ケアプラン】\n${carePlan}\n\n` : ""}${nursingContentItems && nursingContentItems.length > 0 ? `【登録済みケア内容】\n${nursingContentItems.map(item => `・${item}`).join("\n")}\n\n` : ""}${prevText}

${sInput?.trim() ? `【今回のS情報】\n${sInput}\n\n` : ""}【今回の訪問メモ】
${rawInput}`;

  try {
    const response = await generateAiResponse(prompt, systemPrompt);

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
