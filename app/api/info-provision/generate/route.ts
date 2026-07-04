import { NextRequest, NextResponse } from "next/server";
import { generateAiResponse } from "@/lib/ai-client";
import { aiErrorResponse } from "@/lib/ai-error-response";
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

const PROMPT_VERSION = "info-provision-v2.0.0"; // 2026-07-04 事業所カスタムGPTの書き方（です・ます調/簡潔/3段落構成）に準拠
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
    "主傷病名。入力情報にある主傷病名を簡潔に記載する。推測で診断名を追加しない。診断名コード・診断確定日は不要。経過や治療詳細は他欄で書く。",
  disease_state:
    "病状・障害等の状態（400〜900字）。直近の病状推移・ADLレベル・医療管理が必要な状態（バイタル傾向・症状）を客観的に。点数判定はしない。看護の内容欄でケア詳細を書くため、本欄は『現在の状態像』に絞る。",
  disease_progress:
    "傷病の経過（400〜900字）。発症からこれまでの経過・現在の主な医療的問題・訪問看護開始からの推移。看護の内容欄で実施ケアを詳述するため、本欄は『経過の流れ』に絞る。",
  past_history:
    "既往歴。SOAP・患者情報に記載がある既往歴のみを簡潔に列挙する（手術歴・基礎疾患）。推測で追加しない。記載がない場合は「期間中の記録に明確な記載なし」とのみ書く。",
  daily_life_basics:
    "食生活、清潔、排泄、睡眠、生活リズム等（3〜4文程度で簡潔に）。食事・水分・排泄・失禁・清潔保持・睡眠・ADL・移動・転倒リスクを生活状況として記載する。小見出しは使わず自然な文章で。服薬・酸素流量・詳細な呼吸状態・家族支援は原則として他欄へ記載する。",
  medication_status:
    "服薬等の状況（2〜3文程度で簡潔に）。薬剤名の羅列は避け、内服管理者・自己管理の可否・飲み忘れ・頓用使用・外用薬・管理上の注意を記載する。薬剤の詳細が不明または多数の場合は「内服薬の詳細はお薬手帳参照」と記載してよい。在宅酸素・吸入・インスリン・処置等は本欄に記載せず、記録にある場合は看護の内容またはケア時の欄に必ず記載する（欄を移すだけで、省略は禁止）。",
  family_status:
    "家族、主な介護者等（2〜3文程度で簡潔に）。主介護者・家族の支援内容・家族の不安・介護負担・利用サービスを記載する。介護者への看護師の関わり方は看護の内容欄で書く。",
  family_caregiver_info:
    "家族等及び主な介護者に係る情報（2〜3文程度で簡潔に）。家族構成・主介護者・介護内容と頻度・介護者の負担状況・インフォーマル支援を記載する。家族支援の具体ケアは看護の内容欄で書く。",
  nursing_problems:
    "看護上の問題等。看護計画書サマリにある看護問題のタイトルのみを、1行ずつそのまま記載する。詳細説明・補足はしない。記録内容から新たな看護問題を作成しない。看護計画書の情報がない場合は「期間中の記録に明確な記載なし」とのみ書く。",
  nursing_content:
    "★看護の内容（本様式の最重要欄。3段落構成・全体で250〜450字程度を目安）。"
    + "訪問看護の実施内容の羅列ではなく、受入先の看護師が受け入れ後の看護を具体的にイメージできるようにまとめる。"
    + "第1段落：在宅での療養状況・症状・ADLへの影響・有効だった対応。"
    + "第2段落：直近の病状変化と受診/入院に至る前の経過（発熱・呼吸状態・疼痛・摂取量・排泄・意識状態・脱水や感染徴候等、受け入れ初期に確認すべき情報）。"
    + "第3段落：本人・家族の意向・不安・理解度・説明時の反応・関わり方として有効だった方法。主治医への報告・往診・受診調整等の連携状況もここに含める。"
    + "SOAPに記載のある事実のみ書く。",
  care_methods_continuation:
    "ケア時の具体的な方法や留意点、継続すべき看護等（2段落程度・150〜250字程度を目安）。受入先の看護師への実践的な申し送りとして、症状観察のポイント・介助時の注意・本人への接し方・説明方法・家族への配慮を中心に記載する。看護上の問題の説明を繰り返さない。",
  medical_care_methods:
    "医療的ケアの実施方法・留意事項（300〜700字、学校宛）。学校生活で必要な医療的ケア（吸引・経管栄養・導尿等）の手技・タイミング・緊急時対応を養護教諭/学校看護師向けに記述。看護の内容欄と重複する手技は要点だけ。",
  welfare_services:
    "必要と考えられる保健福祉サービス（200〜500字）。現在利用中のサービス・追加検討が望ましいサービス（デイ・ショート・配食・福祉用具等）を列挙。具体支給決定の判断は書かない。",
  other_notes:
    "その他（2〜4文程度）。本人・家族の療養意向、ACP、告知状況、DNAR、退院前カンファレンス等の受入先への依頼事項を優先して記載する。記録にないACP・DNAR・告知状況は推測で補わない。依頼事項は記録・看護計画に明示があるもののみ記載し、記録にない依頼を作成しない。連絡先選定や算定区分の判断は書かない。",
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
    return aiErrorResponse(e);
  }
}

function appendAiNotice(text: string): string {
  if (!text?.trim()) return "";
  if (text.includes("※AI下書き")) return text;
  return `${text.trim()}\n\n※AI下書き。看護師確認必須`;
}

function buildSystemPrompt(addressee: InfoProvisionAddressee): string {
  return `あなたは訪問看護ステーションで使用する「訪問看護情報提供書」を作成する専門AIである。提供期間のSOAP記録から、指定された宛先の情報提供書 各欄のドラフトを生成する。

# 位置づけ（最優先の考え方）
これは訪問看護の実施報告書ではない。利用者が入院・転院・受診・施設入所等を行う際、受入先の職員が在宅療養中の生活状況・病状経過・本人や家族の思い・継続すべき看護を理解できるようにするための引継ぎ資料である。受入先の職員が受け入れ後の看護を具体的にイメージできることを最優先とする。日々の訪問記録をそのまま貼り付けず、受入先で必要な情報に要約する。

# 宛先別トーン
${ADDRESSEE_TONE[addressee]}

# 文体ルール
- 全欄を自然なです・ます調で記載する。文末は「です」「ます」「されています」「認められています」等で統一する
- 「である」「認める」「要する」「実施していた」などの記録調は使用しない
  - 「注意を要する」→「注意が必要です」／「確認していた」→「確認していました」／「継続していた」→「継続されていました」／「認めた」→「認めました」
- 「〜である」「〜された」「〜していた」で終わる文が続かないよう調整する
- 主語を明確にし、長文を避ける。丁寧かつ簡潔に表現する
- 本人や家族の発言は、必要に応じて要約して記載してよい
- 数字は半角数字を使用する。特殊文字・丸数字・機種依存文字・矢印・半角カナは使用しない

# 重複回避ルール
- 同じ内容を複数欄に重複して記載しない。**最も該当する1欄でのみ記載**し、他欄では必要な場合のみ1文の概略にとどめる
- 例: 「家族等」欄で介護内容を書いたら、「看護の内容」では家族との関わりの要点だけ書く
- 冗長な表現・訪問看護業務の単なる列挙・同一内容の繰り返しは避ける
- 例外: ACP・DNAR・告知状況・アレルギー・感染症は重複回避の対象外とし、該当欄すべてに記載してよい（記録にあれば「その他」欄には必ず記載）

# 看護の内容欄について（最重要欄）
- **「看護の内容」欄は本様式の中核**。ただし長さではなく「受入先が看護をイメージできること」を優先し、3段落構成・全体250〜450字程度でまとめる
- 第1段落：在宅での療養状況・症状・ADLへの影響・有効だった対応
- 第2段落：直近の病状変化と経過（受け入れ初期に確認すべき情報）
- 第3段落：本人・家族の意向・不安・理解度・有効だった関わり方・医療連携の状況

# 出力ルール
- Tool use の output_info_provision を必ず使用。前置き・コードブロック禁止
- input_schema の required に列挙された欄をすべて返すこと（記載なしの欄は「期間中の記録に明確な記載なし」と書く。無理に埋めない）
- 各欄は記録に記載のあった事実のみ書く。SOAPにない情報を推測で補わない。記録にない診断名を追加しない
- 記録にある事実（解熱した・消失した等）はそのまま書いてよい。記録にない変化の断定・推測はしない
- 医療安全に関わる情報は省略しない。特に以下は記録にあれば文量目安を超えてでも必ずいずれかの欄に記載する：アレルギー（薬剤・食物）／感染症情報／DNAR・ACP・告知状況／在宅酸素流量・インスリン等の医療処置／転倒・誤嚥・褥瘡リスク／麻薬・抗凝固薬等のハイリスク薬
- ACP・告知状況・DNAR・終末期の意向が記録にある場合は「その他」欄に優先して記載する

# 絶対禁止（AI責任分界）
- 宛先の選定（市区町村/保健所長/学校/医療機関の判断）
- 算定区分（情報提供療養費1/2/3）の選定
- ADL点数判定（自立/一部介助/全介助）
- 主治医への依頼事項の判断（「〜薬の処方変更を依頼」等は禁止）
- 診断名・傷病名コードの付与
- 必要性判断（「頻回訪問が必要」「サービス追加が必要」等は事実列挙にとどめる）
- ドレッシング材・薬剤の商品名・成分名（記録にあるもののみ引用可）

# 医療用語の補正（全段階で適用）
副雑音(×複雑音 / ×服雑音) / 緊満感 / 更衣(×交衣) / 洗髪(×先発) / 著明(×著名) / 褥瘡(×辱層) / 浮腫(×不種) / 嚥下(×円下) / 疼痛(×等痛) / 排便(×配便) / 腹部(×服部) / 仰臥位(×仰が位) / 体動(×胎動 ※妊婦以外) / 性状(×正常 ※便・分泌物の文脈) / 刺入部(×侵入部 ※点滴・カテの文脈) / 咳嗽(×外装 / ×外相) / 上葉・中葉・下葉(×常用) / 閉眼(×併願) / 肉芽(×肉毛) / 胃瘻(×色 / ×慰労 / ×要ろう)

# 個人情報
- 氏名・住所・電話番号・「〜様」を出力しない
- 「利用者」「本人」を使用

# 各欄の文量
- 各欄の文量目安は欄ごとの指示（description）に従う。長くなる場合は重要事項を優先して圧縮する`;
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
