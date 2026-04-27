import { NextRequest, NextResponse } from "next/server";
import { generateAiResponse } from "@/lib/ai-client";
import { getAuthUser } from "@/lib/supabase-server";

/**
 * 看護計画書 AI生成API（目標・課題の下書き）
 *
 * 手順書: docs/看護計画書_手順書.md
 *
 * AI責任分界:
 *   - AI生成対象: nursing_goal（看護・リハビリの目標）、issues[].issue（課題・支援内容）、remarks（備考）
 *   - AI禁止: plan_type（介護/医療）、plan_title（共通/看護/リハ）、supply_* （衛生材料）、
 *            作成者情報、主治医・ケアマネ情報
 *
 * 生成モード:
 *   - mode="from_scratch": ゼロから生成
 *   - mode="refine": 既存内容（existingGoal / existingIssues）を改善
 *
 * プロンプトバージョン: v1.0.0 (2026-04-22)
 */

const PROMPT_VERSION = "nursing-care-plan-generate-v1.0.0";

interface PreviousRecord {
  visitDate?: string;
  S: string;
  O: string;
  A: string;
  P: string;
}

interface NursingCarePlanGenerateInput {
  patient: {
    age: number;
    diagnosis: string;
    careLevel: string;
  };
  planDate?: string;                     // 作成年月日 YYYY-MM-DD（未指定なら今日）
  nursingContentItems?: string[];        // 登録済みケア内容リスト
  carePlan?: string;                     // 旧 carePlan（過渡期参照・任意）
  recentSoapRecords?: PreviousRecord[];  // 直近SOAP 5件程度
  previousPlan?: {                       // 前回計画書を複製する場合の前回内容（任意）
    nursingGoal?: string;
    issues?: { no: number; issue: string }[];
  };
  mode?: "from_scratch" | "refine";      // 生成モード
  // refineモード時の既存内容
  existingGoal?: string;
  existingIssues?: { no: number; issue: string }[];
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const body = (await req.json()) as NursingCarePlanGenerateInput;
  if (!body.patient) {
    return NextResponse.json({ error: "患者情報が入力されていません" }, { status: 400 });
  }

  const planDate = body.planDate ?? new Date().toISOString().slice(0, 10);
  const mode = body.mode ?? "from_scratch";

  const systemPrompt = buildSystemPrompt(mode);
  const userPrompt = buildUserPrompt(body, planDate, mode);

  const generateTool = {
    name: "output_nursing_care_plan",
    description:
      "看護計画書の目標・課題を生成する。必ず extracted_facts → coverage_check → nursing_goal / issues の順で埋めること。",
    input_schema: {
      type: "object" as const,
      properties: {
        extracted_facts: {
          type: "array",
          items: { type: "string" },
          description:
            "入力（患者情報・SOAP記録・ケア内容・旧carePlan・前回計画書）から抽出した事実を列挙。由来タグ [患者情報] [SOAP] [ケア内容] [旧carePlan] [前回計画] を付けること。誤変換補正済みの用語で書く。内部確認用。",
        },
        coverage_check: {
          type: "array",
          items: { type: "string" },
          description:
            "各事実を nursing_goal / issues のどこに反映するかの1行マッピング。内部確認用。",
        },
        nursing_goal: {
          type: "string",
          description:
            "看護・リハビリの目標（3000字以内、自然な文章）。患者の状態・ケア内容・SOAPから妥当な目標を記述。『〜を目標とする』『〜を目指す』の語尾。末尾に『※AI下書き。看護師確認必須』を付与。",
        },
        issues: {
          type: "array",
          items: {
            type: "object",
            properties: {
              no: { type: "integer", description: "行番号（1から開始）" },
              issue: {
                type: "string",
                description:
                  "課題・支援内容（2500字以内）。SOAPから抽出した課題と、それに対する支援内容を記述。『〜の課題あり。〜の支援を行う』等。",
              },
            },
            required: ["no", "issue"],
          },
          description:
            "療養上の課題・支援内容（最大5行）。SOAPやケア内容から抽出した主要課題を優先順位順に並べる。evaluation（評価）は生成しない（別API で期間SOAPから後日生成）。",
        },
        remarks: {
          type: "string",
          description:
            "備考（任意・3000字以内）。特記事項があれば記載。なければ空文字列で可。",
        },
      },
      required: ["extracted_facts", "coverage_check", "nursing_goal", "issues", "remarks"],
    },
  };

  try {
    const response = await generateAiResponse(userPrompt, systemPrompt, {
      maxTokens: 8192,
      timeoutMs: 60000,
      temperature: 0.2,
      tool: generateTool,
    });

    if (!response.toolInput) {
      return NextResponse.json({ error: "AIの応答を解析できませんでした。" }, { status: 500 });
    }

    const result = response.toolInput as {
      nursing_goal?: string;
      issues?: { no: number; issue: string }[];
      remarks?: string;
    };

    // AI責任分界：ホワイトリスト方式で返却フィールドを制限
    const sanitized = {
      nursing_goal: appendAiNotice(result.nursing_goal ?? ""),
      issues: (result.issues ?? []).map((i) => ({
        no: i.no,
        date: planDate,
        issue: appendAiNotice(i.issue),
      })),
      remarks: result.remarks ?? "",
      _ai_meta: {
        model: "claude-haiku-4-5-20251001",
        prompt_version: PROMPT_VERSION,
        generated_at: new Date().toISOString(),
      },
    };

    return NextResponse.json(sanitized);
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

function buildSystemPrompt(mode: "from_scratch" | "refine"): string {
  const modeRule =
    mode === "refine"
      ? `# 生成モード：refine（現在の内容を改善）
既存の nursing_goal / issues を入力として受け取る。完全に書き換えるのではなく、
不足している観点の追加・文言の整備・誤変換補正のみ行い、看護師が書いた内容は最大限保持すること。`
      : `# 生成モード：from_scratch（ゼロから生成）
患者情報・SOAP・ケア内容から新規に目標・課題を組み立てる。`;

  return `あなたは訪問看護の看護計画書を作成する専門AIである。カイポケ「訪問看護計画書」フォーマットに準拠した目標・課題のドラフトを生成する。

${modeRule}

# 作業手順（必ず順番に実行）
1. extracted_facts：入力から事実を列挙（由来タグ付き、誤変換補正済み）
2. coverage_check：各事実を nursing_goal / issues のどこに反映するかマッピング
3. nursing_goal：看護・リハビリの目標を記述
4. issues：療養上の課題・支援内容を最大5行

# 出力形式
Tool use（output_nursing_care_plan）のJSONのみ。自然文の前置き・説明は不要。

# あなたがやらないこと（AI責任分界：違反厳禁）
- plan_type（介護/医療）・plan_title（共通/看護/リハ）の判定 → 入力値をそのまま使う
- evaluation（評価）列の生成 → 別APIで期間SOAPから後日生成するため、今回は触らない
- 衛生材料の種類・サイズ・必要量の提案 → 看護師判断
- 作成者情報・主治医情報・ケアマネ情報の作成
- DESIGN-R、Barthel、GAF、自立度ランクの判定
- 診断名・傷病名コードの付与・変更
- ドレッシング材・外用薬の商品名・成分名での言及
  - 禁止例: ハイドロコロイド、ポリウレタンフォーム、アルギン酸塩等の商品名
  - 代わりに「医師指示に基づき適切な創傷被覆材を選定」等の抽象表現
- 「〜を処方する」「〜薬を変更する」等の医師権限の文言
- 具体的な検査値の創作（Alb、BMI、MNA-SF点数等は記録にあるもののみ引用、創作禁止）

# 医療用語の正しい表記（誤変換補正・全段階で徹底）
extracted_facts の抽出段階から正しい用語で書くこと。
- 副雑音（× 複雑音）
- 緊満感（× 緊満・緊張感・近満感）
- 更衣（× 交衣・交依・好意・合意）
- 洗髪（× 先発）
- 著明（× 著名・調名）
- 褥瘡（× 辱層）
- 浮腫（× 不種）
- 嚥下（× 円下）
- 喀痰（× 角痰）
- 疼痛（× 等痛）
- 腸蠕動音（× 朝蠕動音）
- 腹部（× 服部）
- 排便（× 配便）
- 関節（× 間接・関接、可動域・拘縮・リウマチ等の文脈では必ず関節）
- 仰臥位（× 仰が位）

# nursing_goal の書き方ルール
- 3000字以内、自然な文章（箇条書き禁止）
- 「〜を目標とする」「〜を目指す」「〜を継続していく」の語尾
- 患者の状態（主病名・要介護度・ADL）を踏まえた現実的な目標
- 家族支援・在宅療養継続の観点は、入力情報（患者情報・SOAP・ケア内容）に該当があれば1〜2文含める。独居など該当がなければ無理に入れない
- 記録にない情報は推測で埋めない。未記載は「訪問時観察に基づき追加評価していく」等の汎用表現

# issues の書き方ルール
- 最大5行（本当に必要なものだけ）
- 各行 2500字以内、1つの課題につき「課題・支援内容」をセットで記述
- 優先順位順（生命・機能・生活の順で並べる）
- 「〜の課題あり。〜の観察・支援を行う」形式
- SOAPに出ていない課題を創作しない
- 末尾に「※AI下書き。看護師確認必須」を付与

# 個人情報
- 出力に利用者の氏名・住所・電話番号・「〜様」を含めない
- 「利用者」「本人」「ご本人」の表現を使う

# 音声入力の現場特性
SOAP記録は音声入力由来のため以下の特徴がある。読み取り時に考慮：
- フィラー・自己訂正・時系列逆転
- 同音異義語の誤変換
- 家族発言の地の文混入
- 話題の飛び・往復`;
}

function buildUserPrompt(
  input: NursingCarePlanGenerateInput,
  planDate: string,
  mode: "from_scratch" | "refine"
): string {
  const { patient, nursingContentItems, carePlan, recentSoapRecords, previousPlan, existingGoal, existingIssues } = input;

  const nursingContentSection = nursingContentItems && nursingContentItems.length > 0
    ? `\n【登録済みケア内容】\n${nursingContentItems.map((item) => `・${item}`).join("\n")}`
    : "";

  const carePlanSection = carePlan?.trim()
    ? `\n【旧ケアプラン欄（過渡期の参考情報）】\n${carePlan}`
    : "";

  const soapSection = recentSoapRecords && recentSoapRecords.length > 0
    ? "\n【直近のSOAP記録】\n" + recentSoapRecords
        .slice(0, 5)
        .map(
          (r, i) =>
            `[${i + 1}${r.visitDate ? `（${r.visitDate}）` : ""}]\nS: ${r.S}\nO: ${r.O}\nA: ${r.A}\nP: ${r.P}`
        )
        .join("\n\n")
    : "\n【直近のSOAP記録】\n  （なし。患者情報とケア内容のみから下書きを生成すること）";

  const previousSection = previousPlan
    ? `\n【前回の看護計画書（複製元・参考）】\n目標：${previousPlan.nursingGoal ?? "（なし）"}\n課題：\n${(previousPlan.issues ?? []).map((i) => `  ${i.no}. ${i.issue}`).join("\n") || "  （なし）"}`
    : "";

  const refineSection = mode === "refine"
    ? `\n【現在の内容（改善対象）】\n目標：${existingGoal ?? "（未入力）"}\n課題：\n${(existingIssues ?? []).map((i) => `  ${i.no}. ${i.issue}`).join("\n") || "  （未入力）"}\n\n上記の内容を保持しつつ、不足観点の追加・文言整備・誤変換補正のみ行うこと。`
    : "";

  return `【患者情報】
- 年齢: ${patient.age}歳
- 主病名: ${patient.diagnosis}
- 要介護度: ${patient.careLevel}

【計画作成日】${planDate}
${nursingContentSection}
${carePlanSection}
${soapSection}
${previousSection}
${refineSection}

上記情報から、看護計画書の nursing_goal（目標）と issues（療養上の課題・支援内容）のドラフトを生成せよ。
Tool use の output_nursing_care_plan を必ず使うこと。`;
}
