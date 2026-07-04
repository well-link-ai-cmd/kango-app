import { NextRequest, NextResponse } from "next/server";
import { generateAiResponse } from "@/lib/ai-client";
import { aiErrorResponse } from "@/lib/ai-error-response";
import { getAuthUser } from "@/lib/supabase-server";

import { MEDICAL_TERM_CORRECTIONS_COMPACT } from "@/lib/medical-term-corrections";
import { logAiSend } from "@/lib/audit-server";
/**
 * 訪問看護報告書（通常 / 精神科）AI生成API
 *
 * 様式: 別紙様式2（通常） / 別紙様式4（精神科）
 * 手順書: docs/報告書3様式_手順書.md
 *
 * 生成対象（AIドラフト可）:
 *   - disease_progress（病状の経過）
 *   - nursing_content（看護・リハの内容、箇条書き推奨）
 *   - family_care（通常: 家庭での介護状況 / 精神科: 家族等との関係）
 *   - special_notes（特記すべき事項）
 *
 * AI禁止（看護師手入力・本APIではエコーバックのみ）:
 *   - GAF点数（精神科）
 *   - Barthel点数・自立度ランク（リハ別添）
 *   - 頻回訪問の必要性判断
 *   - 衛生材料の種類・量（別欄で看護師入力）
 *
 * モデル: Claude Haiku 4.5（要約系のため Haiku で十分。評価機能で実証済み）
 */

const PROMPT_VERSION = "visit-report-v1.1.0";
const AI_MODEL = "claude-haiku-4-5-20251001";

export const maxDuration = 120;

interface PeriodSoapRecord {
  visitDate?: string;
  S: string;
  O: string;
  A: string;
  P: string;
}

interface VisitReportGenerateInput {
  reportType: "normal" | "psychiatric";
  targetMonth: string;                       // YYYY-MM
  patient: {
    age: number;
    diagnosis: string;
    careLevel: string;
  };
  periodSoapRecords: PeriodSoapRecord[];
  nursingContentItems?: string[];            // 登録済みケア内容（参考）
  activePlanSummary?: string;                // 現在有効な看護計画書のサマリ（任意）
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const body = (await req.json()) as VisitReportGenerateInput;

  if (!body.patient || !body.targetMonth || !body.reportType) {
    return NextResponse.json({ error: "報告書種別・対象月・患者情報が必要です" }, { status: 400 });
  }

  const recordCount = body.periodSoapRecords?.length ?? 0;
  if (recordCount === 0) {
    return NextResponse.json(
      { error: "対象月のSOAP記録がありません。記録を作成してから報告書を生成してください。" },
      { status: 400 }
    );
  }

  const isPsych = body.reportType === "psychiatric";

  const systemPrompt = buildSystemPrompt(isPsych);
  const userPrompt = buildUserPrompt(body, isPsych);

  const generateTool = {
    name: "output_visit_report",
    description: "訪問看護報告書の本文4欄をドラフト生成する。各欄はカイポケ・iBow等の電子カルテにそのまま貼付できる形式で出力する。",
    input_schema: {
      type: "object" as const,
      properties: {
        disease_progress: {
          type: "string",
          description: "病状の経過（500〜1000字目安）。書き方はsystem指示「病状の経過 — 詳細」に従う。",
        },
        nursing_content: {
          type: "string",
          description: "★看護・リハの内容（800〜1500字目安、本様式の最重要欄）。書き方・構成はsystem指示「看護の内容欄について」「看護内容 — 詳細」に従う。",
        },
        family_care: {
          type: "string",
          description: isPsych
            ? "家族等との関係（300〜600字目安）。書き方はsystem指示「家族等との関係 — 詳細」に従う。"
            : "家庭での介護の状況（300〜600字目安）。書き方はsystem指示「家庭での介護の状況 — 詳細」に従う。",
        },
        special_notes: {
          type: "string",
          description: "特記すべき事項（150〜500字目安）。書き方はsystem指示「特記事項 — 詳細」に従う。",
        },
      },
      required: ["disease_progress", "nursing_content", "family_care", "special_notes"],
    },
  };

  try {
    // 医療情報のAI送信を監査記録（越境送信の記録・fire-and-forget）
    logAiSend("visit_report", null);
    const response = await generateAiResponse(userPrompt, systemPrompt, {
      model: "haiku",
      maxTokens: 4096,
      timeoutMs: 90000,
      temperature: 0.2,
      tool: generateTool,
    });

    if (!response.toolInput) {
      return NextResponse.json({ error: "AIの応答を解析できませんでした。" }, { status: 500 });
    }

    const result = response.toolInput as {
      disease_progress?: string;
      nursing_content?: string;
      family_care?: string;
      special_notes?: string;
    };

    return NextResponse.json({
      disease_progress: appendAiNotice(result.disease_progress ?? ""),
      nursing_content: appendAiNotice(result.nursing_content ?? ""),
      family_care: appendAiNotice(result.family_care ?? ""),
      special_notes: appendAiNotice(result.special_notes ?? ""),
      _ai_meta: {
        model: AI_MODEL,
        prompt_version: PROMPT_VERSION,
        generated_at: new Date().toISOString(),
      },
    });
  } catch (e) {
    return aiErrorResponse(e);
  }
}

function appendAiNotice(text: string): string {
  if (!text?.trim()) return "";
  if (text.includes("※AI下書き")) return text;
  return `${text.trim()}\n\n※AI下書き。看護師確認必須`;
}

function buildSystemPrompt(isPsych: boolean): string {
  const base = `あなたは訪問看護の月次報告書を作成する専門AIである。指定月のSOAP記録から${isPsych ? "精神科" : "通常"}訪問看護報告書の本文4欄（病状の経過 / 看護内容 / ${isPsych ? "家族等との関係" : "家庭での介護の状況"} / 特記事項）のドラフトを生成する。

# 重複回避ルール（最優先・読みやすさ最優先）
- 同じ事実を複数欄で詳述しない。**最も該当する1欄でのみ詳述**し、他欄では1〜2文の概略にとどめる
- 例: 「家族／家庭での介護」欄で介護内容を書いたら、「看護の内容」では家族との関わりを概略でOK
- 同じ表現・同じ事実を3回以上繰り返すのは禁止
- 各欄を読み比べて重複箇所が目立つ場合は、サブの欄を簡潔化する

# 看護の内容欄について（最重要欄）
- **「看護の内容」欄は本様式の中核**。報告書レベルで詳細に書く（800〜1500字目安）
- 他欄より長く詳細でよい
- 文体ガイド:
  - 冒頭に訪問頻度・訪問体制を明示（例: 「看護師は週○回訪問し、体調管理・バイタル測定・〜を行っています」）
  - 観察・対応している問題ごとに段落を分け、段落間に空行を入れる
  - 各段落の構造: 「○○については、〜の有無を確認しています。〜の状況を観察し、〜を実施しています。」
  - 観察項目は具体的に列挙（バイタル・便回数/性状・腹痛・症状の有無・推移）
  - 看護師の介入は段落末に書く（例: 「〜を促し医療機関につなげました」「〜を傾聴しています」）
- 他欄で既に書いた事実は再度詳述せず、「看護師として何を観察しどう介入したか」を中心に詳述する

# 他の欄の文体ガイド
- 病状の経過: 段落感ある文章で、月初〜月末の流れを時系列で。看護の内容欄でケア手技を詳述するため、本欄は経過と評価に絞る
- 家族／介護の状況: 1〜3文の簡潔な事実列挙でよい（例: 「夫が主たる介護者で外出や入浴などを介助しています」）
- 特記事項: 他欄に収まらない重要事項のみ。150〜500字程度で十分

# 出力ルール
- Tool use の output_visit_report を必ず使用。前置き・コードブロック禁止
- 各欄は記載のあった事実のみ書く。SOAPにない情報の創作禁止
- 「不明」「未評価」と書くべき箇所を埋めない（その場合は何も書かない or 「期間中の記録に明確な記載なし」と明記）
- 「概ね安定」「やや増加傾向」のような幅のある表現を活用し、断定（「改善した」「悪化した」）は避ける

# 絶対禁止（AI責任分界）
- GAF尺度の点数判定（精神科で必須項目だが、AIは点数を出さない）
- Barthel Index・自立度（J1-C2 / 自立-M）・認知症自立度の判定
- 算定区分（管理療養費1/2、基本療養費Ⅰ/Ⅲ）の選定
- 主治医への依頼事項の判断（「〜薬の処方変更を依頼」等は禁止）
- 頻回訪問の必要性判断（事実列挙のみ）
- 診断名・傷病名コードの付与
- 衛生材料の種類・量・過不足判断（別欄で看護師が入力）
- ドレッシング材・薬剤の商品名・成分名（記録にあるもののみ引用可）

# 医療用語の補正（全段階で適用）
${MEDICAL_TERM_CORRECTIONS_COMPACT}

# 個人情報
- 氏名・住所・電話番号・「〜様」を出力しない
- 「利用者」「本人」を使用

# 病状の経過 — 詳細
- 月初〜月末の流れを時系列で。問題点 → 経過・対応 → 評価 の順
- バイタル傾向・主症状の経過・ADL/活動量・服薬状況を含める
- 計画目標への進捗評価（達成度）に1〜2文触れる（断定はしない）
- ケア手技の詳細は「看護の内容」欄で詳述するため、本欄では繰り返さない

# 看護内容 — 詳細
${isPsych
  ? `- 精神科特有の関わり（服薬支援・症状モニタリング・生活リズム支援・SST・家族支援）を中心に
- 商品名・成分名はSOAPに記載があるもののみ`
  : `- 1問題 = 1段落で詳述。手技名は具体的に書くが、商品名・成分名はSOAPに記載があるもののみ
- 訪問頻度・所要時間にSOAP記載事実があれば冒頭に添える`}

# ${isPsych ? "家族等との関係" : "家庭での介護の状況"} — 詳細
${isPsych
  ? `- 家族構成・キーパーソン・関係性・家族の疾病理解・家族支援の要否を1〜3文で簡潔に
- 看護師の家族支援ケアは「看護の内容」欄で書くため、本欄は『家族の状況』に絞る`
  : `- 主介護者を特定し、介護内容・時間・負担を1〜3文で簡潔に（例: 「夫が主たる介護者で外出や入浴などを介助しています」）
- 介護者の心身状態・インフォーマル支援・フォーマルサービス利用状況にSOAP記載があれば反映
- 看護師の家族支援ケアは「看護の内容」欄で書くため、本欄は『介護の状況』に絞る`}

# 特記事項 — 詳細
- 他3欄に収まらない重要事項のみ。他欄で既に詳述した内容の繰り返しは禁止
- 頻回訪問・緊急訪問: 「○月○日 緊急訪問で〜実施」等の事実列挙のみ
${isPsych ? "- 希死念慮・自傷他害リスク等の記載がSOAPにあれば客観的に明示" : "- 状態急変・入院/退院があれば日付付きで明示"}
- 関係機関連携（保健所・市町村・医療機関等）の事実があれば記述`;

  return base;
}

function buildUserPrompt(input: VisitReportGenerateInput, isPsych: boolean): string {
  const { patient, targetMonth, periodSoapRecords, nursingContentItems, activePlanSummary } = input;

  const planSection = activePlanSummary && activePlanSummary.trim()
    ? `\n【現在有効な看護計画書のサマリ（参考）】\n${activePlanSummary.trim()}`
    : "";

  const nursingContentSection = nursingContentItems && nursingContentItems.length > 0
    ? `\n【登録済みケア内容（参考）】\n${nursingContentItems.map((item) => `・${item}`).join("\n")}`
    : "";

  const soapSection = "\n【対象月のSOAP記録（時系列・古い順）】\n" + [...periodSoapRecords]
    .sort((a, b) => (a.visitDate ?? "").localeCompare(b.visitDate ?? ""))
    .map(
      (r, i) =>
        `[${i + 1}${r.visitDate ? `（${r.visitDate}）` : ""}]\nS: ${r.S}\nO: ${r.O}\nA: ${r.A}\nP: ${r.P}`
    )
    .join("\n\n");

  return `【患者情報】
- 年齢: ${patient.age}歳
- 主病名: ${patient.diagnosis}
- 要介護度: ${patient.careLevel}

【対象月】${targetMonth}
【様式】${isPsych ? "精神科訪問看護報告書（別紙様式4）" : "訪問看護報告書（別紙様式2）"}
【期間内SOAP記録】${periodSoapRecords.length}件
${planSection}
${nursingContentSection}
${soapSection}

上記情報から、報告書本文4欄のドラフトを生成せよ。
Tool use の output_visit_report を必ず使い、disease_progress / nursing_content / family_care / special_notes をすべて返すこと。`;
}
