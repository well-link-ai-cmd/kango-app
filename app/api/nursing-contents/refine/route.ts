import { NextRequest, NextResponse } from "next/server";
import { generateAiResponse } from "@/lib/ai-client";
import { getAuthUser } from "@/lib/supabase-server";

/**
 * ケア内容リスト 整え直しAPI
 *
 * 現在のケア内容リストを読み取り、以下の整理案を提示する：
 *   - 重複項目の統合
 *   - 文言の統一（語尾揃え）
 *   - 類似項目のグループ化
 *   - 任意でカテゴリ分類（観察 / 処置 / 援助・リハビリ / 教育）
 *
 * 結果はプレビュー表示 → 看護師承認で反映（破壊的変更防止）。
 *
 * プロンプトバージョン: v1.0.0 (2026-04-22)
 */

const PROMPT_VERSION = "nursing-contents-refine-v1.0.0";

interface RefineInput {
  currentItems: string[];
  enableCategorization?: boolean; // カテゴリ分類を希望するか（デフォルト true）
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const body = (await req.json()) as RefineInput;
  const currentItems = body.currentItems ?? [];
  const enableCategorization = body.enableCategorization ?? true;

  if (currentItems.length === 0) {
    return NextResponse.json(
      { error: "整え直す項目がありません。" },
      { status: 400 }
    );
  }

  const systemPrompt = `あなたは訪問看護のケア内容リストを整理するAIである。看護師が入力したケア項目リストを読み取り、以下の観点で整理案を提示する。

# 作業手順
1. duplicates_check：重複・類似項目を検出（同じケアを別表現で書いているもの）
2. refined_items：整理後のリストを作成
   - 重複は統合
   - 語尾・表記を揃える（例：「〜確認」「〜実施」など動詞形で統一）
   - 冗長な説明を削る
   - ${enableCategorization ? "カテゴリ（観察 / 処置 / 援助・リハビリ / 教育）を任意で付与（付けなくてもよい）" : "カテゴリ分類はしない"}

# 出力形式
Tool use（output_refined_contents）のJSONのみ。

# 重要な制約
- **項目を勝手に削除しない**：統合や表現の変更はOKだが、意図的に減らすのは重複統合時のみ
- **新規項目を創作しない**：入力にない項目を追加しない
- **医療行為の範囲を変えない**：「バイタル測定」を「血圧測定のみ」に限定するなど、範囲縮小は禁止
- 看護師が後で見て「これは重複しているから統合された」「これは語尾が揃えられた」と即座に理解できる変更のみ行う

# 削ってはいけない情報（50字制限より優先）
以下の要素は文字数を超えても絶対に保持すること。医療安全・指示条件に直結するため。
- 報告・エスカレーション条件：「〜時は主治医報告」「異常時は〜」「発熱時は〜」等
- 頻度・回数の指定：「週2回」「毎訪問時」「月1回」「1日3回」等
- 対象部位・範囲の限定：「両下肢」「仙骨部」「右上肢のみ」等
- 医師指示・家族指導の条件付き要素：「医師指示により〜」「家族同席時〜」等
- 数値基準：「SpO2 93%以下で〜」「収縮期160以上で〜」等

これらを含む項目は、多少長くなっても原文のニュアンスを保持する。語尾統一のために報告条件を削ってはならない。

# カテゴリ分類の指針（enableCategorization=trueの場合）
- 観察：バイタル、皮膚状態、排泄状態、症状の観察
- 処置：創部処置、カテーテル管理、服薬管理、医療機器管理
- 援助・リハビリ：清拭、更衣、ROM訓練、口腔ケア、体位変換
- 教育：家族指導、自己管理指導、服薬指導
- カテゴリ判定が曖昧な項目は「その他」or 未分類で可（無理に振り分けない）

# 文体ルール
- 語尾を「〜測定」「〜確認」「〜実施」「〜指導」など動詞形で揃える
- 丁寧語・敬語は使わない（記録用の簡潔表現）
- 50字以内を目安（長い説明は削る）`;

  const itemsJson = JSON.stringify(currentItems);
  const userPrompt = `【現在のケア内容リスト（${currentItems.length}件）】
${currentItems.map((item, i) => `${i + 1}. ${item}`).join("\n")}

上記のリストを整理せよ。項目を勝手に減らしたり、新規項目を追加してはならない（重複統合時のみ減少OK）。${enableCategorization ? "カテゴリ分類を任意で付与せよ。" : ""}
Tool use の output_refined_contents を必ず使うこと。`;

  const refineTool = {
    name: "output_refined_contents",
    description: "ケア内容リストの整理案を出力する。重複統合・語尾統一・カテゴリ分類（任意）を行う。",
    input_schema: {
      type: "object" as const,
      properties: {
        duplicates_check: {
          type: "array",
          items: { type: "string" },
          description: "重複・類似項目を検出した場合の記録。例：『「血圧測定」と「血圧チェック」を統合』。内部確認用。",
        },
        refined_items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text: { type: "string", description: "整理後の項目テキスト" },
              category: {
                type: "string",
                description: enableCategorization
                  ? "カテゴリ（観察 / 処置 / 援助・リハビリ / 教育 / その他）。未分類は空文字列で可"
                  : "空文字列固定（カテゴリ分類なし）",
              },
              origin: {
                type: "string",
                description: "整理元。『統合』『そのまま』『語尾整形』『カテゴリ付与』のいずれか",
              },
            },
            required: ["text", "category", "origin"],
          },
          description: "整理後のケア内容リスト。",
        },
        reason: {
          type: "string",
          description: "整理の概要（1-2文）。どんな変更を行ったか。",
        },
      },
      required: ["duplicates_check", "refined_items", "reason"],
    },
  };

  try {
    const response = await generateAiResponse(userPrompt, systemPrompt, {
      maxTokens: 4096,
      timeoutMs: 60000,
      temperature: 0.2,
      tool: refineTool,
    });

    if (!response.toolInput) {
      return NextResponse.json({ error: "AIの応答を解析できませんでした。" }, { status: 500 });
    }

    const result = response.toolInput as {
      duplicates_check?: string[];
      refined_items?: { text: string; category: string; origin: string }[];
      reason?: string;
    };

    return NextResponse.json({
      refined_items: result.refined_items ?? [],
      duplicates_check: result.duplicates_check ?? [],
      reason: result.reason ?? "",
      _ai_meta: {
        model: "claude-haiku-4-5-20251001",
        prompt_version: PROMPT_VERSION,
        generated_at: new Date().toISOString(),
      },
    });
  } catch (e) {
    console.error(e);
    const errorMessage = e instanceof Error ? e.message : "AI生成中にエラーが発生しました。";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
