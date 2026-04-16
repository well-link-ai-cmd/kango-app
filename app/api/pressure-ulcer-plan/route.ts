import { NextRequest, NextResponse } from "next/server";
import { generateAiResponse } from "@/lib/ai-client";
import { getAuthUser } from "@/lib/supabase-server";

/**
 * 褥瘡計画書 AI生成API
 *
 * AI責任分界:
 *  - 看護師が入力する項目（DESIGN-R / 危険因子 / 日常生活自立度 / OHスケール点数）は
 *    AIは判定せず、入力値をそのまま返す（または未指定なら null）
 *  - AIが生成するのは看護計画5軸のドラフトのみ
 *
 * プロンプトバージョン: v1.0.0 (2026-04-16)
 */

const PROMPT_VERSION = "pressure-ulcer-plan-v1.0.2";

interface PressureUlcerPlanInput {
  patient: {
    age: number;
    diagnosis: string;
    care_level: string;
  };
  plan_date?: string;
  daily_life_level?: string;
  has_current_ulcer: boolean;
  current_locations: string[];
  oh_scale_score?: number;
  risk_factors: Record<string, string>;
  design_r: Record<string, string | number>;
  recent_soap_records?: Array<{
    visit_date?: string;
    S: string;
    O: string;
    A: string;
    P: string;
  }>;
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const body = (await req.json()) as PressureUlcerPlanInput;

  if (!body.patient) {
    return NextResponse.json({ error: "患者情報が入力されていません" }, { status: 400 });
  }

  // 医療安全ガード: 看護師判定項目が未入力の状態で計画生成を走らせない
  if (!body.daily_life_level) {
    return NextResponse.json({
      error: "日常生活自立度が未入力です。看護師判定を先に完了してください（J1〜C2のいずれかを選択）。",
    }, { status: 400 });
  }
  if (body.oh_scale_score === undefined || body.oh_scale_score === null) {
    return NextResponse.json({
      error: "OHスケール点数が未入力です。看護師判定を先に完了してください（0〜10点）。",
    }, { status: 400 });
  }

  // 日常生活自立度 A2以下は計画立案不要 → AIを呼ばずに即応答
  const notApplicableLevels = new Set(["J1", "J2", "A1", "A2"]);
  if (notApplicableLevels.has(body.daily_life_level)) {
    return NextResponse.json({
      not_applicable: true,
      reason: `日常生活自立度が${body.daily_life_level}のため褥瘡計画書の作成不要です。B1以上で作成必須となります。`,
      daily_life_level: body.daily_life_level,
      plan_bed: null,
      plan_chair: null,
      plan_skincare: null,
      plan_nutrition: null,
      plan_rehab: null,
      ai_notice: "※AI判定。看護師確認必須",
      _ai_meta: {
        model: "rule-based",
        prompt_version: PROMPT_VERSION,
        generated_at: new Date().toISOString(),
      },
    });
  }

  // 計画作成日・次回評価日
  const planDate = body.plan_date ?? new Date().toISOString().slice(0, 10);
  const reviewDate = addDays(planDate, 14);

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(body, planDate, reviewDate);

  try {
    // 5軸×各1000字=最大5000字の日本語出力が想定されるため、max_tokens=8192で余裕を持たせる
    const response = await generateAiResponse(userPrompt, systemPrompt, { maxTokens: 8192, timeoutMs: 60000 });

    const jsonMatch = response.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: "AIの応答を解析できませんでした。" }, { status: 500 });
    }

    const plan = JSON.parse(jsonMatch[0]);

    // AI責任分界の強制: ホワイトリスト方式で5軸＋日付のみ抽出
    // （AIが risk_summary 等の未許可キーを返しても物理的に遮断する）
    const sanitized = {
      plan_bed: plan.plan_bed ?? null,
      plan_chair: plan.plan_chair ?? null,
      plan_skincare: plan.plan_skincare ?? null,
      plan_nutrition: plan.plan_nutrition ?? null,
      plan_rehab: plan.plan_rehab ?? null,
      next_review_date: plan.next_review_date ?? reviewDate,
      // 看護師判定項目は入力値をエコーバック（AIは関与できない）
      daily_life_level: body.daily_life_level ?? null,
      risk_factors: body.risk_factors ?? {},
      oh_scale_score: body.oh_scale_score ?? null,
      design_r: body.design_r ?? {},
      has_current_ulcer: body.has_current_ulcer,
      current_locations: body.current_locations ?? [],
      plan_date: planDate,
      ai_notice: "※AI下書き。看護師確認必須",
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

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function buildSystemPrompt(): string {
  return `あなたは訪問看護の褥瘡計画書を作成する専門AIである。厚労省「褥瘡対策に関する看護計画書」様式・日本褥瘡学会ガイドライン第5版・カイポケ4カテゴリに準拠した看護計画ドラフトを生成する。

# 出力形式（厳守）
JSONのみ出力。前置き・説明・コードブロック記法は一切不要。
{
  "plan_bed": "圧迫・ズレ力：ベッド上のケア計画（1000字以内）",
  "plan_chair": "圧迫・ズレ力：イス上のケア計画（1000字以内）",
  "plan_skincare": "スキンケア計画（1000字以内）",
  "plan_nutrition": "栄養状態改善計画（1000字以内）",
  "plan_rehab": "リハビリテーション計画（1000字以内）",
  "next_review_date": "YYYY-MM-DD"
}

上記以外のキーは出力しない。特に入力値の要約・再解釈（risk_summary 等）は禁止。

# あなたがやらないこと（AI責任分界：違反厳禁）
以下の判定・採点・選定・命名は絶対に出力しない。入力値をそのまま保持するだけ。
- DESIGN-R®2020の採点（d/e/s/i/g/n/p の各記号、DDTI、I3C、合計点）
- 日常生活自立度（J1〜C2）の判定変更
- 危険因子7項目の評価・書き換え
- OHスケール点数の変更・再計算
- ドレッシング材・外用薬の **商品名・成分名** での言及
  - 禁止例: ハイドロコロイド、ポリウレタンフォーム、アルギン酸塩、ハイドロファイバー、カデキソマー、ヨウ素、銀含有ドレッシング等
  - 代わりに「医師指示に基づき適切な創傷被覆材を選定していく」等の抽象表現のみ使用
- 「〜を処方する」「〜を投与する」「〜薬を変更する」「〜を中止する」等の医師権限の文言
- 具体的な検査値の断定（例: Alb 3.5 g/dL、BMI 18、MNA-SF 0点 等 → 創作禁止）

# 医療用語の正しい表記（誤変換禁止・両記形式）
左側が正しい表記、右側が誤変換例。出力には必ず左側を使うこと。
- 副雑音（× 複雑音）
- 緊満感（× 緊満・緊張感・近満感）
- 更衣（× 交衣・交依・好意・合意）
- 洗髪（× 先発・선발）
- 著明（× 著名・調名）
- 褥瘡（× 辱層）
- 浮腫（× 不種・付種）
- 嚥下（× 円下）
- 喀痰（× 角痰）
- 間欠（× 間隔 — 時間的文脈では間欠）
- 疼痛（× 等痛 — 痛みの記載では疼痛）

# 各計画カテゴリの書き方ルール

## 共通原則
- 300〜600字程度を目安（1000字以内、箇条書き禁止、自然な文章）
- 「〜していく」「〜を継続する」「〜を指導する」の語尾
- 具体性：頻度・場面・担当（看護師／家族）を明示
- 家族指導は独立項目にせず、各カテゴリの文末に1〜2文で織り込む
- 記録にない情報は推測で埋めない。未記載は「訪問時観察に基づき追加評価していく」等の汎用表現で
- **特定のAlb値・BMI値・具体的な検査値を創作しない**

## ① plan_bed（圧迫・ズレ力：ベッド上）
- OHスケール点数に連動：7点以上なら「エアマットレス／体圧分散マットレス」「30度側臥位」「スモールチェンジ」「4時間を超えない体位変換」を含める
- 病的骨突出ありなら部位保護（踵部・仙骨部）を明示
- 家族指導：体位変換手技・除圧タイミングの指導を文末に織り込む

## ② plan_chair（圧迫・ズレ力：イス上）
- 車椅子・座位時の15分ごとプッシュアップ（家族代行含む）
- 座圧分散クッション選定、ずれ防止、姿勢保持
- 家族指導：座位時の観察・声かけを文末に織り込む

## ③ plan_skincare（スキンケア）
- 弱酸性洗浄剤、愛護的洗浄（擦らない）
- 保湿（ヘパリン類似物質等）、IAD予防、スキン-テア予防
- 皮膚湿潤ありなら撥水性クリーム、尿便失禁対応を含める
- 家族指導：清拭・入浴時の観察ポイント（発赤持続・水疱）を文末に

## ④ plan_nutrition（栄養状態改善）
- MNA-SFによる栄養評価を看護師・管理栄養士に依頼する文を含める（※点数は記載しない、ツール名のみ言及可）
- 「治癒期目標：30 kcal/kg/日・たんぱく質1.0 g/kg/日以上」は一般論として可（患者固有の数値は創作しない）
- 亜鉛・アルギニン・ビタミンC補給（医師・管理栄養士と連携）
- 家族指導：食事量・水分量の記録方法を文末に

## ⑤ plan_rehab（リハビリテーション）
- 関節可動域訓練、座位耐性、離床プログラム
- PT/OT/STとの連携
- 関節拘縮ありなら拘縮進行予防を重点
- 家族指導：日常での可動域維持の工夫を文末に

# 個人情報
- 出力に利用者の氏名・住所・電話番号・「〜様」を含めない
- 「利用者」「本人」「ご本人」の表現を使う

# 評価サイクル
- next_review_date は計画作成日の2週間後（入力で指定されていればそれを優先）`;
}

function buildUserPrompt(
  input: PressureUlcerPlanInput,
  planDate: string,
  reviewDate: string
): string {
  const { patient, daily_life_level, has_current_ulcer, current_locations, oh_scale_score, risk_factors, recent_soap_records } = input;

  const riskLines = Object.entries(risk_factors ?? {})
    .map(([k, v]) => `  - ${k}: ${v}`)
    .join("\n") || "  （未評価）";

  const ulcerSection = has_current_ulcer
    ? `現在の褥瘡: あり（部位: ${current_locations.join("、") || "未指定"}）`
    : "現在の褥瘡: なし";

  const soapSection = recent_soap_records && recent_soap_records.length > 0
    ? "\n【最近のSOAP記録（参考情報）】\n" + recent_soap_records
        .slice(0, 5)
        .map((r, i) => `[${i + 1}${r.visit_date ? `（${r.visit_date}）` : ""}]\nS: ${r.S}\nO: ${r.O}\nA: ${r.A}\nP: ${r.P}`)
        .join("\n\n")
    : "\n【最近のSOAP記録】\n  （参考情報なし。一般的なエビデンスに基づいて計画を立てること）";

  return `【患者情報】
- 年齢: ${patient.age}歳
- 主病名: ${patient.diagnosis}
- 要介護度: ${patient.care_level}

【看護師による判定（AIが変更してはいけない項目）】
- 日常生活自立度: ${daily_life_level ?? "未指定"}
- OHスケール点数: ${oh_scale_score ?? "未指定"}点（0-10）
- ${ulcerSection}

【危険因子評価（看護師入力）】
${riskLines}

【計画作成日】${planDate}
【次回評価日の目安】${reviewDate}（2週間後）
${soapSection}

上記情報から、褥瘡計画書の看護計画5軸（ベッド上／イス上／スキンケア／栄養／リハ）のドラフトを生成せよ。
JSONのみで出力し、DESIGN-Rの採点や日常生活自立度の判定は行わないこと。`;
}
