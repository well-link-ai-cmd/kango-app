import { NextRequest, NextResponse } from "next/server";
import { generateAiResponse } from "@/lib/ai-client";
import { getAuthUser } from "@/lib/supabase-server";

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

const PROMPT_VERSION = "visit-report-v1.0.0";
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
          description: "病状の経過（700〜1500字程度）。バイタル変化・症状変動・治療反応・ADL変化・計画目標に対する評価を時系列で。冗長化禁止、問題点と解決策を具体的に。",
        },
        nursing_content: {
          type: "string",
          description: "看護・リハの内容（300〜800字程度、箇条書き推奨）。実施したケア（清潔ケア・服薬管理・創傷処置・症状モニタリング等）を簡潔に。" + (isPsych ? "精神科は服薬支援・症状モニタリング・生活リズム支援・SST等を中心に。" : ""),
        },
        family_care: {
          type: "string",
          description: isPsych
            ? "家族等との関係（300〜800字程度）。家族構成・キーパーソン、関係性の良好/緊張、家族の疾病理解、家族支援の要否。SOAPに記載がある事実のみ書く。"
            : "家庭での介護の状況（300〜800字程度）。誰が・どのように介護しているか、介護者の心身状態・介護負担の安定性。キーパーソンを明記。",
        },
        special_notes: {
          type: "string",
          description: "特記すべき事項（200〜800字程度）。他欄に収まらない重要事項。頻回訪問の理由は『SOAPに記載された事実』のみ列挙し、必要性の判断や訪問頻度の提案は行わない。" + (isPsych ? "精神科では希死念慮等のリスクがSOAPに記載されている場合は事実として明示。" : ""),
        },
      },
      required: ["disease_progress", "nursing_content", "family_care", "special_notes"],
    },
  };

  try {
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
    console.error(e);
    const errorMessage = e instanceof Error ? e.message : "AI生成中にエラーが発生しました。";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

function appendAiNotice(text: string): string {
  if (!text?.trim()) return "";
  if (text.includes("※AI下書き")) return text;
  return `${text.trim()}\n\n※AI下書き。看護師確認必須`;
}

function buildSystemPrompt(isPsych: boolean): string {
  const base = `あなたは訪問看護の月次報告書を作成する専門AIである。指定月のSOAP記録から${isPsych ? "精神科" : "通常"}訪問看護報告書の本文4欄（病状の経過 / 看護内容 / ${isPsych ? "家族等との関係" : "家庭での介護の状況"} / 特記事項）のドラフトを生成する。

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
副雑音(×複雑音 / ×服雑音) / 緊満感 / 更衣(×交衣) / 洗髪(×先発) / 著明(×著名) / 褥瘡(×辱層) / 浮腫(×不種) / 嚥下(×円下) / 疼痛(×等痛) / 排便(×配便) / 腹部(×服部) / 仰臥位(×仰が位) / 体動(×胎動 ※妊婦以外) / 性状(×正常 ※便・分泌物の文脈) / 刺入部(×侵入部 ※点滴・カテの文脈) / 咳嗽(×外装) / 上葉・中葉・下葉(×常用)

# 個人情報
- 氏名・住所・電話番号・「〜様」を出力しない
- 「利用者」「本人」を使用

# 病状の経過 — 書き方
- 月初〜月末の流れを時系列で。問題点 → 経過・対応 → 評価 の順
- バイタル傾向（「概ね安定」「血圧やや高め」等）、主症状の経過、ADL・活動量、服薬状況を含める
- 計画目標への進捗評価（達成度）に1〜2文触れる（断定はしない）

# 看護内容 — 書き方
- 実施したケアを簡潔に箇条書き推奨（「・バイタル測定」「・服薬管理」「・創部処置（医師指示に基づく被覆材交換）」等）
- 1ケア = 1行。具体的な手技名は使うが、商品名・成分名はSOAPに記載があるもののみ
${isPsych ? "- 精神科特有: 服薬支援、症状モニタリング、生活リズム支援、SST、家族支援" : "- 訪問頻度・所要時間に関するSOAP記載事実があれば1行添える"}

# ${isPsych ? "家族等との関係" : "家庭での介護の状況"} — 書き方
${isPsych
  ? `- 家族構成、キーパーソン、関係性（良好/緊張）、家族の疾病理解、家族支援の要否
- 「家族から〜と訴えあり」「家族関係に〜の変化あり」等の客観的記述
- 関係性の評価は SOAPに記載された範囲内で。推測禁止`
  : `- 主介護者を特定（「妻が主介護」「長女が主介護」等）し、介護内容・時間・負担を記述
- 介護者の心身状態（疲労感・睡眠状況等）はSOAPに記載があれば反映
- インフォーマル支援（近隣・友人）、フォーマルサービス（デイ・ショート等）の利用状況`
}

# 特記事項 — 書き方
- 他3欄に収まらない重要事項のみ
- 頻回訪問・緊急訪問が発生した場合: 「○月○日 緊急訪問で〜実施」等の事実列挙のみ。必要性の判断や訪問頻度の評価は書かない
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
