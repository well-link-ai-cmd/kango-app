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

  const systemPrompt = `あなたは訪問看護の記録支援AIである。目的は「今日のメモに記載漏れがないかを、過去記録・ケアプラン・登録済みケア内容と照合して検出すること」である。
メモは音声入力のため誤変換がある。文脈から正しい医療用語として読み取ること（例：朝蠕動音=腸蠕動音、服部=腹部、配便=排便）。

# 作業手順（必ず順番に実行）
1. memo_covers：今日のメモ（S情報含む）に既に書かれている内容を1つ残らず列挙する
2. expected_from_context：前回P・ケアプラン・登録済みケア内容から、今日確認または実施が期待される項目を列挙する
3. gaps：expected_from_context のうち memo_covers に該当がないものだけを抽出する
4. alerts / questions：gaps からのみ生成する。memo_covers に書かれている内容は絶対に出さない

# 絶対ルール：memo_covers にあるものは聞かない
今日のメモに既に書かれている処置・観察・発言について「〜はどうでしたか？」「〜を教えてください」と聞くのは禁止。
例：メモに「更衣介助実施」とあれば、「更衣はされましたか？」は絶対NG。
迷ったら出さない。

# 絶対ルール：時制
メモは「今日の訪問で行ったこと」である。今日行った処置の効果・結果はまだ出ていないので聞かない。
✕「眠剤を増やした」→「睡眠はどうですか？」（効果はまだ不明）
✕「来週オペ予定」→「術後の状態は？」（まだ手術していない）
○「前回〜した」「先週〜があった」→ その経過確認はOK

# バイタル
バイタルは別欄で入力されるため「バイタル記載がない」という汎用アラートは出さない。
病態上重要な特定項目（高血圧患者の血圧等）のみピンポイントで確認してよい。

# 件数の上限
- alerts：最大3件（前回Pの継続事項・登録ケア内容で言及漏れのもの）
- questions：最大4件（gapsを補完する具体的な質問）
- 本当に必要なものだけを出す。該当がなければ空配列でよい。無理に埋めない。`;

  const prompt = `${carePlan ? `【ケアプラン】\n${carePlan}\n\n` : ""}${nursingContentItems && nursingContentItems.length > 0 ? `【登録済みケア内容】\n${nursingContentItems.map(item => `・${item}`).join("\n")}\n\n` : ""}${prevText}

${sInput?.trim() ? `【今回のS情報】\n${sInput}\n\n` : ""}【今回の訪問メモ】
${rawInput}`;

  // Tool use で「抽出→照合→ギャップ検出→出力」の順序を強制。
  // memo_covers を先に埋めさせることで、既出内容を質問してしまう問題を構造的に防ぐ
  const questionsTool = {
    name: "output_gap_check",
    description: "今日のメモと過去文脈を照合して記載漏れを検出する。必ず memo_covers → expected_from_context → gaps → alerts/questions の順で埋めること。",
    input_schema: {
      type: "object" as const,
      properties: {
        memo_covers: {
          type: "array",
          items: { type: "string" },
          description: "今日の訪問メモ（S情報含む）に明示的に書かれている内容を箇条書きで列挙。処置・観察・発言・計画など、メモに出ているものは1つ残らず書き出す。ここに書かれている内容は alerts / questions には絶対含めない。内部確認用。",
        },
        expected_from_context: {
          type: "array",
          items: { type: "string" },
          description: "前回P・ケアプラン・登録済みケア内容から、今日確認または実施が期待される項目を列挙。内部確認用。",
        },
        gaps: {
          type: "array",
          items: { type: "string" },
          description: "expected_from_context のうち memo_covers に該当がないもののみ。ここから alerts / questions を生成する。内部確認用。",
        },
        alerts: {
          type: "array",
          items: { type: "string" },
          description: "gaps のうち前回Pの継続事項・登録ケア内容に該当するもの。最大3件。memo_covers にある内容は絶対含めない。該当なしは空配列。",
        },
        questions: {
          type: "array",
          items: { type: "string" },
          description: "gaps を補完する確認質問。『〜はどうでしたか？』『〜は確認しましたか？』形式。最大4件。memo_covers にある内容は絶対に質問しない。該当なしは空配列。",
        },
      },
      required: ["memo_covers", "expected_from_context", "gaps", "alerts", "questions"],
    },
  };

  try {
    const response = await generateAiResponse(prompt, systemPrompt, {
      temperature: 0.2,
      tool: questionsTool,
    });

    if (!response.toolInput) {
      return NextResponse.json({ questions: [], alerts: [] });
    }
    const result = response.toolInput as { alerts?: string[]; questions?: string[] };
    return NextResponse.json({
      questions: result.questions ?? [],
      alerts: result.alerts ?? [],
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ questions: [], alerts: [] });
  }
}
