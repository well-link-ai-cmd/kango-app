import { NextRequest, NextResponse } from "next/server";
import { generateAiResponse } from "@/lib/ai-client";
import { getAuthUser } from "@/lib/supabase-server";
import type { InfoProvisionAddressee } from "@/lib/storage";

/**
 * 訪問看護情報提供書 AI生成API（4宛先対応）
 *
 * 様式: 別紙様式3 保医発0327第2号
 * 手順書: docs/報告書3様式_手順書.md
 *
 * 宛先別フィールド（カイポケ準拠）:
 *   市区町村: mainDisease / diseaseState / familyCaregiverInfo / nursingContent / welfareServices / otherNotes
 *   保健所長: mainDisease / familyCaregiverInfo / nursingContent / welfareServices / otherNotes
 *   学校: dailyLifeBasics / medicationStatus / familyStatus / mainDisease / diseaseProgress / nursingContent / medicalCareMethods / otherNotes
 *   医療機関: dailyLifeBasics / medicationStatus / familyStatus / mainDisease / pastHistory / nursingProblems / nursingContent / careMethodsContinuation / otherNotes
 *
 * AI禁止（看護師手入力 / 本APIで触らない）:
 *   - 宛先選定（市区町村/保健所長/学校/医療機関）
 *   - 算定区分（情報提供療養費1/2/3）
 *   - ADL点数判定
 *   - 訪問日数・回数（meta値・看護師入力）
 *
 * モデル: Claude Haiku 4.5
 */

const PROMPT_VERSION = "info-provision-v1.0.0";
const AI_MODEL = "claude-haiku-4-5-20251001";

export const maxDuration = 120;

interface PeriodSoapRecord {
  visitDate?: string;
  S: string;
  O: string;
  A: string;
  P: string;
}

interface InfoProvisionGenerateInput {
  addresseeType: InfoProvisionAddressee;
  patient: {
    age: number;
    diagnosis: string;
    careLevel: string;
  };
  periodStart?: string;       // YYYY-MM-DD
  periodEnd?: string;         // YYYY-MM-DD
  periodSoapRecords: PeriodSoapRecord[];
  nursingContentItems?: string[];
  activePlanSummary?: string;
}

// 宛先別 出力フィールド定義
type FieldKey =
  | "main_disease"
  | "disease_state"
  | "disease_progress"
  | "past_history"
  | "daily_life_basics"
  | "medication_status"
  | "family_status"
  | "family_caregiver_info"
  | "nursing_problems"
  | "nursing_content"
  | "care_methods_continuation"
  | "medical_care_methods"
  | "welfare_services"
  | "other_notes";

const FIELDS_BY_ADDRESSEE: Record<InfoProvisionAddressee, FieldKey[]> = {
  municipality: [
    "main_disease",
    "disease_state",
    "family_caregiver_info",
    "nursing_content",
    "welfare_services",
    "other_notes",
  ],
  health_center: [
    "main_disease",
    "family_caregiver_info",
    "nursing_content",
    "welfare_services",
    "other_notes",
  ],
  school: [
    "daily_life_basics",
    "medication_status",
    "family_status",
    "main_disease",
    "disease_progress",
    "nursing_content",
    "medical_care_methods",
    "other_notes",
  ],
  medical_institution: [
    "daily_life_basics",
    "medication_status",
    "family_status",
    "main_disease",
    "past_history",
    "nursing_problems",
    "nursing_content",
    "care_methods_continuation",
    "other_notes",
  ],
};

const FIELD_DESCRIPTIONS: Record<FieldKey, string> = {
  main_disease:
    "主傷病名（200〜500字）。主病名と病期・経過の概略。診断名コードや診断確定日付の記載は不要。",
  disease_state:
    "病状・障害等の状態（500〜1000字）。直近の病状推移、ADLレベル、医療管理が必要な状態（バイタル傾向・症状）を客観的に。点数判定はしない。",
  disease_progress:
    "傷病の経過（500〜1000字）。発症からこれまでの経過、現在の主な医療的問題、訪問看護開始からの推移。",
  past_history:
    "既往歴（200〜600字）。SOAP・患者情報に記載がある既往歴のみ列挙。手術歴・基礎疾患を含む。記載がない場合は「期間中の記録に明確な記載なし」と書く。",
  daily_life_basics:
    "食生活・清潔・排泄・睡眠・生活リズム等（500〜1000字）。【食生活】【清潔】【排泄】【睡眠】【生活リズム】等の小見出しで整理し、SOAPに記載のある事実のみ書く。",
  medication_status:
    "服薬等の状況（300〜800字）。服薬管理者・主な薬剤の傾向（病名と紐付くもの）・服薬遵守状況・問題（飲み忘れ・拒否・誤薬等）。商品名・成分名は記録にあるもののみ。",
  family_status:
    "家族・主な介護者等（300〜800字）。家族構成、キーパーソン、介護内容、家族の心身状態（記載があれば）、関係性の良好/緊張。",
  family_caregiver_info:
    "家族等及び主な介護者に係る情報（300〜800字）。家族構成、主介護者、介護内容と頻度、介護者の負担状況、インフォーマル支援。",
  nursing_problems:
    "看護上の問題等（500〜1000字）。在宅で継続して観察・対応している看護上の問題（栄養・褥瘡・疼痛・転倒・服薬等）を【問題タイトル】形式で複数列挙。各問題の現状と継続対応の必要性を簡潔に。",
  nursing_content:
    "看護の内容（500〜1000字）。実施した看護内容を【看護タイトル】＋実施・利用者反応の形式で複数項目。SOAPに記載のあるケアのみ書く。",
  care_methods_continuation:
    "ケア時の具体的方法・留意点・継続すべき看護（300〜800字）。引継ぎ先（医療機関）が在宅と同様のケアを継続できるよう、具体手技と留意点を箇条書き推奨。",
  medical_care_methods:
    "医療的ケア等の実施方法及び留意事項（300〜800字、学校宛）。学校生活で必要な医療的ケア（吸引・経管栄養・導尿等）の手技・タイミング・緊急時対応を学校看護師/養護教諭向けに記述。",
  welfare_services:
    "必要と考えられる保健福祉サービス（200〜600字）。現在利用中のサービス、追加検討が望ましいサービス（デイ・ショート・配食・福祉用具等）を列挙。具体支給決定の判断は書かない。",
  other_notes:
    "その他特筆すべき事項（200〜600字）。他欄に収まらない重要事項。連絡先選定や算定区分の判断は書かない。",
};

const ADDRESSEE_TONE: Record<InfoProvisionAddressee, string> = {
  municipality:
    "宛先は市区町村（情報提供療養費1）。**地域包括支援・福祉サービス連携・生活支援**の視点で書く。介護保険外のインフォーマル支援、独居リスク、経済的困窮等にも触れてよい（記録に記載がある範囲で）。専門用語は最小限。",
  health_center:
    "宛先は保健所長（情報提供療養費1）。**公衆衛生・難病/精神保健・医療的ケア児支援**の視点で書く。法令（難病法/精神保健福祉法）根拠を意識し、感染症・結核・難病医療費公費負担の文脈で必要な事実を整理する。",
  school:
    "宛先は学校（情報提供療養費2、医療的ケア児）。**小児・教育支援**の視点で書く。医療的ケアの内容（吸引/経管栄養等）、緊急時対応、体育/行事参加可否、投薬スケジュール、養護教諭/学校看護師との連携を意識する。利用者は18歳未満の医療的ケア児。",
  medical_institution:
    "宛先は医療機関・介護老人保健施設・介護医療院（情報提供療養費3）。**医療連携・看護申し送り**の視点で書く。在宅での経過・投薬・処置・看護上の問題点・継続必要ケアを、引継ぎ先の看護部門が読んで在宅同様のケアを継続できるよう具体的に。医師→医師の診療情報提供書とは別物（看護師→医療機関看護部門）。",
};

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const body = (await req.json()) as InfoProvisionGenerateInput;

  if (!body.patient || !body.addresseeType) {
    return NextResponse.json({ error: "宛先・患者情報が必要です" }, { status: 400 });
  }

  const fields = FIELDS_BY_ADDRESSEE[body.addresseeType];
  if (!fields) {
    return NextResponse.json({ error: "未対応の宛先タイプです" }, { status: 400 });
  }

  const recordCount = body.periodSoapRecords?.length ?? 0;
  if (recordCount === 0) {
    return NextResponse.json(
      { error: "対象期間のSOAP記録がありません。記録を作成するか期間を見直してください。" },
      { status: 400 }
    );
  }

  const systemPrompt = buildSystemPrompt(body.addresseeType);
  const userPrompt = buildUserPrompt(body, fields);

  // 宛先別の Tool input_schema を動的構築
  const properties: Record<string, { type: string; description: string }> = {};
  for (const f of fields) {
    properties[f] = { type: "string", description: FIELD_DESCRIPTIONS[f] };
  }

  const generateTool = {
    name: "output_info_provision",
    description: "訪問看護情報提供書の各欄をドラフト生成する。カイポケ等の電子カルテにそのまま貼付できる形式。",
    input_schema: {
      type: "object" as const,
      properties,
      required: fields,
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

    const result = response.toolInput as Record<string, string>;
    const output: Record<string, string> = {};
    for (const f of fields) {
      output[f] = appendAiNotice(result[f] ?? "");
    }

    return NextResponse.json({
      ...output,
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

function buildSystemPrompt(addressee: InfoProvisionAddressee): string {
  return `あなたは訪問看護情報提供書を作成する専門AIである。提供期間のSOAP記録から、指定された宛先の情報提供書 各欄のドラフトを生成する。

# 宛先別トーン
${ADDRESSEE_TONE[addressee]}

# 出力ルール
- Tool use の output_info_provision を必ず使用。前置き・コードブロック禁止
- input_schema の required に列挙された欄をすべて返すこと（記載なしの欄は「期間中の記録に明確な記載なし」と書く）
- 各欄は記載のあった事実のみ書く。SOAPにない情報の創作禁止
- 「概ね安定」「やや増加傾向」のような幅のある表現を活用し、断定（「改善した」「悪化した」）は避ける

# 絶対禁止（AI責任分界）
- 宛先の選定（市区町村/保健所長/学校/医療機関の判断）
- 算定区分（情報提供療養費1/2/3）の選定
- ADL点数判定（自立/一部介助/全介助）
- 主治医への依頼事項の判断（「〜薬の処方変更を依頼」等は禁止）
- 診断名・傷病名コードの付与
- 必要性判断（「頻回訪問が必要」「サービス追加が必要」等は事実列挙にとどめる）
- ドレッシング材・薬剤の商品名・成分名（記録にあるもののみ引用可）

# 医療用語の補正（全段階で適用）
副雑音(×複雑音 / ×服雑音) / 緊満感 / 更衣(×交衣) / 洗髪(×先発) / 著明(×著名) / 褥瘡(×辱層) / 浮腫(×不種) / 嚥下(×円下) / 疼痛(×等痛) / 排便(×配便) / 腹部(×服部) / 仰臥位(×仰が位) / 体動(×胎動 ※妊婦以外) / 性状(×正常 ※便・分泌物の文脈) / 刺入部(×侵入部 ※点滴・カテの文脈) / 咳嗽(×外装) / 上葉・中葉・下葉(×常用)

# 個人情報
- 氏名・住所・電話番号・「〜様」を出力しない
- 「利用者」「本人」を使用

# 各欄の文字数
- 各欄1000字以内。長くなる場合は重要事項を優先して圧縮する`;
}

function buildUserPrompt(input: InfoProvisionGenerateInput, fields: FieldKey[]): string {
  const { patient, addresseeType, periodStart, periodEnd, periodSoapRecords, nursingContentItems, activePlanSummary } = input;

  const periodSection = periodStart || periodEnd
    ? `【提供期間】${periodStart ?? "?"} 〜 ${periodEnd ?? "?"}`
    : "";

  const planSection = activePlanSummary && activePlanSummary.trim()
    ? `\n【現在有効な看護計画書のサマリ（参考）】\n${activePlanSummary.trim()}`
    : "";

  const nursingContentSection = nursingContentItems && nursingContentItems.length > 0
    ? `\n【登録済みケア内容（参考）】\n${nursingContentItems.map((item) => `・${item}`).join("\n")}`
    : "";

  const soapSection = "\n【期間内のSOAP記録（時系列・古い順）】\n" + [...periodSoapRecords]
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

【宛先】${addresseeType}
${periodSection}
【期間内SOAP記録】${periodSoapRecords.length}件
${planSection}
${nursingContentSection}
${soapSection}

上記情報から、宛先「${addresseeType}」用の情報提供書 各欄のドラフトを生成せよ。
Tool use の output_info_provision を必ず使い、required に列挙された全欄を返すこと（${fields.join(" / ")}）。`;
}
