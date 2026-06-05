import { NextRequest, NextResponse } from "next/server";
import { generateAiResponse } from "@/lib/ai-client";
import { loadCarePlanAttachments } from "@/lib/care-plan-images";
import { aiErrorResponse } from "@/lib/ai-error-response";
import { getAuthUser, getServerSupabase } from "@/lib/supabase-server";

/**
 * 看護計画書 課題ラベル候補提示API（Step 1: ラベル抽出）
 *
 * 議事録（退院前カンファレンス・サービス担当者会議等）+ 直近1ヶ月SOAP +
 * 患者基本情報 + 旧carePlan + 直前の確定計画書（active_plan）から、
 * 「この患者に立てるべき看護課題」のラベル候補を MAX 5 件提示する。
 *
 * NANDA-I 公式ラベルには依存しない（自院・他事業所の言い回しを尊重）。
 *
 * 後続フロー: /api/nursing-care-plan/generate-issues に選択ラベルを渡し、
 *            OP/TP/EP + 看護目標を一括生成する。
 *
 * モデル: Sonnet 4.6（半年〜1年に1度の作成のため品質優先）
 * プロンプトバージョン: v1.0.0 (2026-05-05)
 */

const PROMPT_VERSION = "nursing-care-plan-suggest-labels-v1.0.0";
const AI_MODEL = "claude-sonnet-4-6";
const MAX_LABELS = 5;

export const maxDuration = 300;

interface SuggestLabelsInput {
  patientId: string;                       // SOAP/active_plan を Supabase から取得するため必須
  patient: {
    age: number;
    diagnosis: string;
    careLevel: string;
  };
  conferenceMemo?: string;                 // 議事録（推奨・任意）
  oldCarePlan?: string;                    // 旧 carePlan 欄（過渡期参照・任意）
  careManagerPlanImagePaths?: string[];    // ケアマネのケアプラン写真（patient-files のパス）
  careManagerPlanText?: string;            // ケアマネのケアプラン補足テキスト
}

interface LabelCandidate {
  label: string;
  rationale: string;
  priority: "high" | "medium" | "low";
  is_continuation: boolean;
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const body = (await req.json()) as SuggestLabelsInput;
  if (!body.patient || !body.patientId) {
    return NextResponse.json({ error: "患者情報が入力されていません" }, { status: 400 });
  }

  // 直近1ヶ月SOAP（最大10件）と active_plan を Supabase から取得
  const { recentSoaps, activePlan } = await fetchContext(body.patientId);
  // ケアマネのケアプラン写真を Claude vision 用に取得（最優先資料）
  const carePlanAttachments = await loadCarePlanAttachments(body.careManagerPlanImagePaths);

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(body, recentSoaps, activePlan);

  const tool = {
    name: "suggest_nursing_care_labels",
    description:
      "看護課題のラベル候補をMAX5件提案する。各候補に rationale（議事録/SOAP/旧計画書のどの記述から導いたか）を必ず付ける。",
    input_schema: {
      type: "object" as const,
      properties: {
        candidates: {
          type: "array",
          maxItems: MAX_LABELS,
          items: {
            type: "object",
            properties: {
              label: {
                type: "string",
                description: "課題ラベル。自院/事業所の現場慣習に近い言い回し。例：『不安感増強に伴う日常生活への支障リスク』『転倒リスク』",
              },
              rationale: {
                type: "string",
                description: "根拠（1〜2文・100字以内）。議事録/SOAP/旧計画書のどの記述から導いたか。",
              },
              priority: {
                type: "string",
                enum: ["high", "medium", "low"],
                description: "優先度。生命・機能=high、生活機能/予防=medium、その他=low",
              },
              is_continuation: {
                type: "boolean",
                description: "active_plan に同等の課題がある場合 true（継続）。新規は false",
              },
            },
            required: ["label", "rationale", "priority", "is_continuation"],
          },
          description: `課題ラベル候補（最大${MAX_LABELS}件）。情報が乏しい場合は2〜3件でも可。無理に5件埋めない。`,
        },
      },
      required: ["candidates"],
    },
  };

  try {
    const response = await generateAiResponse(userPrompt, systemPrompt, {
      model: "sonnet",
      maxTokens: 2048,
      timeoutMs: 90000,
      temperature: 0.2,
      tool,
      images: carePlanAttachments.images,
      documents: carePlanAttachments.documents,
    });

    if (!response.toolInput) {
      return NextResponse.json({ error: "AIの応答を解析できませんでした。" }, { status: 500 });
    }

    const result = response.toolInput as {
      candidates?: LabelCandidate[];
    };

    const candidates = (result.candidates ?? []).slice(0, MAX_LABELS);

    return NextResponse.json({
      candidates,
      _ai_meta: {
        model: AI_MODEL,
        prompt_version: PROMPT_VERSION,
        generated_at: new Date().toISOString(),
        usage: response.usage,
      },
    });
  } catch (e) {
    return aiErrorResponse(e);
  }
}

/**
 * 直近1ヶ月SOAP（最大10件）と直前の確定計画書をDBから取得。
 * 議事録AI生成時のコンテキストとして使う。
 */
async function fetchContext(patientId: string): Promise<{
  recentSoaps: { visitDate: string; S: string; O: string; A: string; P: string }[];
  activePlan: { planDate: string; nursingGoal?: string; issues?: unknown } | null;
}> {
  const supabase = await getServerSupabase();

  const oneMonthAgo = new Date();
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
  const since = oneMonthAgo.toISOString().slice(0, 10);

  const { data: soapRows } = await supabase
    .from("soap_records")
    .select("visit_date, s_text, o_text, a_text, p_text")
    .eq("patient_id", patientId)
    .gte("visit_date", since)
    .order("visit_date", { ascending: false })
    .limit(10);

  const recentSoaps = (soapRows ?? []).map((r) => ({
    visitDate: r.visit_date,
    S: r.s_text ?? "",
    O: r.o_text ?? "",
    A: r.a_text ?? "",
    P: r.p_text ?? "",
  }));

  const { data: planRow } = await supabase
    .from("nursing_care_plans")
    .select("plan_date, nursing_goal, issues")
    .eq("patient_id", patientId)
    .eq("is_draft", false)
    .order("plan_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const activePlan = planRow
    ? { planDate: planRow.plan_date, nursingGoal: planRow.nursing_goal ?? undefined, issues: planRow.issues }
    : null;

  return { recentSoaps, activePlan };
}

function buildSystemPrompt(): string {
  return `あなたは訪問看護の看護計画書作成を支援するAIである。
入力された議事録・直近SOAP・患者情報・直前の計画書から、この患者に立てるべき看護課題のラベル候補を提案する。

# 作業手順（必ず順番に実行）
1. extracted_facts：入力から事実を列挙（由来タグ付き、誤変換補正済み）
2. candidates：課題ラベル候補を最大${MAX_LABELS}件提案

# 出力形式
Tool use（suggest_nursing_care_labels）のJSONのみ。自然文の前置き・説明は不要。

# ラベル抽出の優先順位
1. ケアマネのケアプラン（添付画像／補足テキスト）— 介護保険では看護計画の起点。生活全般の解決すべき課題・援助目標・サービス内容を最優先で読み取り反映する
2. 議事録（conference_memo）— 退院前カンファレンス・サービス担当者会議等で合意された問題点
3. 直近1ヶ月のSOAP — 実際の問題発生状況・現状反応
4. 直前の確定計画書（active_plan）— 継続課題として優先表示（is_continuation=true）
5. 患者基本情報（年齢・主病名・要介護度）

# SOAPがない場合の扱い
新規契約直後は SOAP がほぼないことが普通。議事録と基本情報から立案する。
SOAPがゼロでも議事録があれば候補生成は可能。
情報が乏しい場合は無理に5件埋めず、2〜3件でもよい。

# ラベルの書き方
- NANDA-I 公式診断名にこだわらない。自院・現場で使われる言い回しで自然に書く
- 例：「不安感増強に伴う日常生活への支障リスク」「転倒リスク」「服薬管理困難」「皮膚統合性障害リスク」「介護負担増大リスク」
- 抽象的すぎるラベルは避ける（「健康問題」「QOL低下」など曖昧なものは却下）
- 議事録に登場した具体的な問題を活かしたラベルにする

# rationale（根拠）の書き方
- 議事録/SOAP/旧計画書の具体的な記述を引用または要約
- 1〜2文程度。長すぎず、看護師がどの情報源から導かれたか追跡できること

# 継続課題の判定（is_continuation）
- active_plan の課題ラベル（diagnosis_label / issue 文字列）と意味的に同等のものは true
- 新規発生課題は false
- 過去計画にあった課題でも、現在は解決済みなら提案しない

# あなたがやらないこと（AI責任分界）
- 診断名の付与・確定（看護師判断）
- 点数判定（DESIGN-R / Barthel / GAF / 自立度）
- 算定区分・宛先選定
- 不確実な推論で候補を増やす（推測で埋めず、根拠のあるものだけ）
- 利用者の氏名・住所等を出力に含める

# 医療用語の正しい表記（誤変換補正・全段階で徹底）
extracted_facts の抽出段階から正しい用語で書くこと。
- 副雑音（× 複雑音・服雑音）
- 緊満感（× 緊張感・近満感）
- 更衣（× 交衣・交依）
- 洗髪（× 先発）
- 著明（× 著名）
- 褥瘡（× 辱層）
- 浮腫（× 不種）
- 嚥下（× 円下）
- 喀痰（× 角痰）
- 疼痛（× 等痛）
- 腸蠕動音（× 朝蠕動音）
- 腹部（× 服部）
- 排便（× 配便）
- 関節（× 間接・関接）
- 仰臥位（× 仰が位）
- 上葉（× 常用、肺野の文脈で）
- 体動（× 胎動、呼吸・体位の文脈）
- 性状（× 正常、便・創部・分泌物の文脈で「〜の性状」）
- 刺入部（× 侵入部、点滴・カテーテルの文脈）
- 咳嗽（× 外装、呼吸器症状）`;
}

function buildUserPrompt(
  input: SuggestLabelsInput,
  recentSoaps: { visitDate: string; S: string; O: string; A: string; P: string }[],
  activePlan: { planDate: string; nursingGoal?: string; issues?: unknown } | null
): string {
  const { patient, conferenceMemo, oldCarePlan, careManagerPlanText } = input;

  // 画像のみAIに送られる（PDF等は送らない）ため、添付画像の有無は画像拡張子で判定する
  const hasCarePlanImage = (input.careManagerPlanImagePaths ?? []).some((p) => /\.(jpe?g|png|webp|gif)$/i.test(p));
  const careManagerPlanSection =
    hasCarePlanImage || careManagerPlanText?.trim()
      ? `\n【ケアマネのケアプラン（最優先で参照）】\n${
          hasCarePlanImage
            ? "※添付画像はケアマネが作成したケアプランです。生活全般の解決すべき課題・援助目標・サービス内容を最優先で読み取り、訪問看護の課題に反映すること。\n"
            : ""
        }${careManagerPlanText?.trim() ? `補足テキスト：\n${careManagerPlanText.trim()}\n` : ""}`
      : "";

  const conferenceSection = conferenceMemo?.trim()
    ? `\n【議事録（退院前カンファレンス・サービス担当者会議等）】\n${conferenceMemo}\n`
    : "\n【議事録】\n  （未入力）\n";

  const oldCarePlanSection = oldCarePlan?.trim()
    ? `\n【旧ケアプラン欄（過渡期の参考情報）】\n${oldCarePlan}\n`
    : "";

  const soapSection = recentSoaps.length > 0
    ? `\n【直近1ヶ月のSOAP記録（${recentSoaps.length}件）】\n` + recentSoaps
        .map(
          (r, i) =>
            `[${i + 1}（${r.visitDate}）]\nS: ${r.S}\nO: ${r.O}\nA: ${r.A}\nP: ${r.P}`
        )
        .join("\n\n") + "\n"
    : "\n【直近1ヶ月のSOAP記録】\n  （なし。新規契約直後または初回計画立案。議事録と基本情報から判断すること）\n";

  const activePlanSection = activePlan
    ? `\n【直前の確定計画書（${activePlan.planDate}）】\n目標：${activePlan.nursingGoal ?? "（なし）"}\n${formatActivePlanIssues(activePlan.issues)}\n`
    : "\n【直前の確定計画書】\n  （なし。初回作成）\n";

  return `【患者情報】
- 年齢: ${patient.age}歳
- 主病名: ${patient.diagnosis}
- 要介護度: ${patient.careLevel}
${careManagerPlanSection}${conferenceSection}${oldCarePlanSection}${soapSection}${activePlanSection}
上記情報から、この患者に立てるべき看護課題のラベル候補を最大${MAX_LABELS}件提案せよ。
Tool use の suggest_nursing_care_labels を必ず使うこと。`;
}

/** active_plan.issues（JSONB）を表示用テキスト化 */
function formatActivePlanIssues(issues: unknown): string {
  if (!Array.isArray(issues) || issues.length === 0) return "課題：（なし）";
  const lines: string[] = ["課題："];
  for (const i of issues) {
    if (i && typeof i === "object") {
      const o = i as Record<string, unknown>;
      const no = o.no ?? "?";
      if (o.format === "nanda" && typeof o.diagnosis_label === "string") {
        lines.push(`  ${no}. ${o.diagnosis_label}`);
      } else if (typeof o.issue === "string") {
        // freeform: 先頭60字まで
        const summary = o.issue.length > 60 ? o.issue.slice(0, 60) + "…" : o.issue;
        lines.push(`  ${no}. ${summary}`);
      }
    }
  }
  return lines.join("\n");
}
