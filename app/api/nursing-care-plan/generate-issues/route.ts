import { NextRequest, NextResponse } from "next/server";
import { generateAiResponse } from "@/lib/ai-client";
import { getAuthUser, getServerSupabase } from "@/lib/supabase-server";

/**
 * 看護計画書 OP/TP/EP + 看護目標 一括生成API（Step 2: 詳細生成）
 *
 * suggest-labels で看護師が選択した課題ラベル群に対し、
 * 患者の議事録 / 直近1ヶ月SOAP / 患者基本情報 / 旧carePlan / active_plan / ケア内容
 * を踏まえて NANDAモードの OP（観察）/ TP（ケア）/ EP（指導）と看護目標を一発生成する。
 *
 * モデル: Sonnet 4.6（半年〜1年に1度の作成のため品質優先）
 * 再生成ボタンは UI に置かない方針（コスト爆発防止）。
 *   → 一発出し → 看護師が手動で微調整
 *
 * プロンプトバージョン: v1.0.0 (2026-05-05)
 */

const PROMPT_VERSION = "nursing-care-plan-generate-issues-v1.0.0";
const AI_MODEL = "claude-sonnet-4-6";

export const maxDuration = 300;

interface GenerateIssuesInput {
  patientId: string;
  patient: {
    age: number;
    diagnosis: string;
    careLevel: string;
  };
  labels: string[];                    // suggest-labels で選択されたラベル群
  conferenceMemo?: string;             // 議事録（任意）
  oldCarePlan?: string;                // 旧 carePlan（任意）
  nursingContentItems?: string[];      // 登録済みケア内容（参考、重複許容）
  planDate?: string;                   // 計画作成日 YYYY-MM-DD
}

interface GeneratedIssue {
  diagnosis_label: string;
  op: string[];
  tp: string[];
  ep: string[];
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const body = (await req.json()) as GenerateIssuesInput;
  if (!body.patient || !body.patientId) {
    return NextResponse.json({ error: "患者情報が入力されていません" }, { status: 400 });
  }
  if (!Array.isArray(body.labels) || body.labels.length === 0) {
    return NextResponse.json({ error: "ラベルが選択されていません" }, { status: 400 });
  }

  const planDate = body.planDate ?? new Date().toISOString().slice(0, 10);

  const { recentSoaps, activePlan } = await fetchContext(body.patientId);

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(body, recentSoaps, activePlan);

  const tool = {
    name: "generate_nursing_care_issues",
    description:
      "選択された課題ラベル群に対し、看護目標と各課題の OP/TP/EP を一括生成する。labels と同じ順序・件数で issues を返すこと。",
    input_schema: {
      type: "object" as const,
      properties: {
        extracted_facts: {
          type: "array",
          items: { type: "string" },
          description:
            "入力（議事録・SOAP・active_plan・ケア内容・旧carePlan・患者情報）から抽出した事実。由来タグ [議事録] [SOAP] [active_plan] [ケア内容] [旧carePlan] [患者情報] を付ける。誤変換補正済み。",
        },
        coverage_check: {
          type: "array",
          items: { type: "string" },
          description:
            "各事実を nursing_goal / 各 issue の OP/TP/EP のどこに反映するかの1行マッピング。",
        },
        nursing_goal: {
          type: "string",
          description:
            "看護・リハビリの目標（3000字以内、自然な文章）。患者の状態・選択された課題群を統合した上位目標。『〜を目標とする』『〜を目指す』『〜を継続していく』の語尾。末尾に『※AI下書き。看護師確認必須』を付与。",
        },
        issues: {
          type: "array",
          items: {
            type: "object",
            properties: {
              diagnosis_label: {
                type: "string",
                description: "課題ラベル。入力 labels と同じ文字列をそのまま使う（順序維持）。",
              },
              op: {
                type: "array",
                items: { type: "string" },
                description:
                  "観察計画（O-P）。3〜7項目。各項目は1行40〜80字程度。数値・頻度・条件を含める（『血圧130/80以上で再評価』『毎訪問時測定』等）。",
              },
              tp: {
                type: "array",
                items: { type: "string" },
                description:
                  "ケア計画（T-P）。3〜7項目。実際に訪問看護で実施できる範囲。医師指示が必要な侵襲的処置は提案しない。",
              },
              ep: {
                type: "array",
                items: { type: "string" },
                description:
                  "指導計画（E-P）。2〜5項目。本人・家族への指導内容。具体的に書く（『〜の方法を本人・家族に説明』）。",
              },
            },
            required: ["diagnosis_label", "op", "tp", "ep"],
          },
          description:
            "各課題の OP/TP/EP（labels と同じ順序・件数で返す）。冗長にしない。",
        },
      },
      required: ["extracted_facts", "coverage_check", "nursing_goal", "issues"],
    },
  };

  try {
    const response = await generateAiResponse(userPrompt, systemPrompt, {
      model: "sonnet",
      maxTokens: 8192,
      timeoutMs: 180000,  // Sonnet 4.6 構造化出力（複数課題のOP/TP/EP生成）に時間がかかるため 180秒
      temperature: 0.2,
      tool,
    });

    if (!response.toolInput) {
      return NextResponse.json({ error: "AIの応答を解析できませんでした。" }, { status: 500 });
    }

    const result = response.toolInput as {
      nursing_goal?: string;
      issues?: GeneratedIssue[];
    };

    const labels = body.labels;
    const generatedIssues = result.issues ?? [];

    // labels と generatedIssues の対応を取り、欠落分は空でフォールバック
    const aligned = labels.map((label, idx) => {
      const found = generatedIssues.find((g) => g.diagnosis_label === label) ?? generatedIssues[idx];
      return {
        no: idx + 1,
        date: planDate,
        format: "nanda" as const,
        diagnosis_label: label,
        op: found?.op ?? [],
        tp: found?.tp ?? [],
        ep: found?.ep ?? [],
        ai_generated: true,
        ai_model: AI_MODEL,
        ai_generated_at: new Date().toISOString(),
      };
    });

    return NextResponse.json({
      nursing_goal: appendAiNotice(result.nursing_goal ?? ""),
      issues: aligned,
      _ai_meta: {
        model: AI_MODEL,
        prompt_version: PROMPT_VERSION,
        generated_at: new Date().toISOString(),
        usage: response.usage,
      },
    });
  } catch (e) {
    console.error("generate-issues error:", e);
    const errorMessage = e instanceof Error ? e.message : "AI生成中にエラーが発生しました。";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

function appendAiNotice(text: string): string {
  if (!text?.trim()) return "";
  if (text.includes("※AI下書き")) return text;
  return `${text.trim()}\n\n※AI下書き。看護師確認必須`;
}

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
看護師が選択した課題ラベル群に対し、患者の実情に即した観察計画(OP)・ケア計画(TP)・指導計画(EP)、および統合的な看護目標を一発生成する。

# 作業手順（必ず順番に実行）
1. extracted_facts：入力から事実を列挙（由来タグ付き、誤変換補正済み）
2. coverage_check：各事実を nursing_goal / 各課題の OP/TP/EP のどこに反映するかマッピング
3. nursing_goal：看護・リハビリの目標を記述（選択課題群の上位目標として統合）
4. issues：各ラベルに対して OP/TP/EP を生成（labels と同じ順序・件数）

# 出力形式
Tool use（generate_nursing_care_issues）のJSONのみ。自然文の前置き・説明は不要。

# 参照優先順位（最重要）
1. 議事録（conference_memo）— 計画書作成の一次情報。退院前カンファレンス・サービス担当者会議等で合意された支援方針
2. 直近1ヶ月のSOAP記録 — 実際の問題発生状況・現状反応・症状の数値・頻度
3. 直前の確定計画書（active_plan）— 継続性・前回からの変化を意識
4. 患者基本情報（年齢・主病名・要介護度）
5. 登録済みケア内容 — 既に実施しているケア（**重複は許容。むしろ計画書からケアが抽出される関係なので、計画書側にも記載する**）

# SOAPがない場合の扱い
新規契約直後は SOAP がほぼないことが普通。議事録と基本情報から立案する。
SOAPがゼロでも議事録と基本情報があれば OP/TP/EP は組み立て可能。
推測で項目を増やさず、議事録と基本情報から導かれる範囲に限定する。

# OP（観察計画）の書き方
- 3〜7項目程度。冗長にしない
- 各項目は1行40〜80字
- 数値・頻度・条件を含める（『血圧130/80以上で報告』『毎訪問時測定』『呼吸困難時はSpO2測定』）
- SOAPに出てくる症状・観察項目を可能な限り取り込む
- 訪問看護で実際に観察できる範囲

# TP（ケア計画）の書き方
- 3〜7項目程度
- 訪問看護で実施できる範囲（医師指示が必要な侵襲的処置は提案しない）
- 既に実施しているケア（nursing_contents）と重複してよい
- ドレッシング材・薬剤の商品名・成分名は使わない（『医師指示に基づき適切な創傷被覆材を使用』等の抽象表現）

# EP（指導計画）の書き方
- 2〜5項目程度
- 本人・家族への指導内容
- 具体的に書く（『〜の方法を本人・家族に説明』『緊急時の連絡先・症状を説明』）
- 認知症・精神疾患等で本人指導が困難な場合は家族中心に

# nursing_goal の書き方
- 3000字以内、自然な文章（箇条書き禁止）
- 『〜を目標とする』『〜を目指す』『〜を継続していく』の語尾
- 選択された課題群を統合した上位目標として書く
- 患者の状態（主病名・要介護度・ADL）を踏まえた現実的な目標
- 家族支援・在宅療養継続の観点は、入力情報に該当があれば含める。独居など該当がなければ無理に入れない
- 末尾に『※AI下書き。看護師確認必須』を付与

# あなたがやらないこと（AI責任分界：違反厳禁）
- 診断名の確定・付与（看護師判断）
- 点数判定（DESIGN-R / Barthel / GAF / 自立度）
- 算定区分・宛先選定
- ドレッシング材・薬剤の商品名・成分名での言及
- 「〜を処方する」「〜薬を変更する」等の医師権限文言
- 具体的検査値の創作（記録にあるもののみ引用）
- 利用者の氏名・住所等を出力に含める（「利用者」「本人」「ご本人」を使う）
- 不確実な推論で項目を増やす（記録にない情報は推測で埋めない）

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
- 性状（× 正常、便・創部・分泌物の文脈で『〜の性状』）
- 刺入部（× 侵入部、点滴・カテーテルの文脈）
- 咳嗽（× 外装、呼吸器症状）

# 文体ルール
- 過去計画書（active_plan）があれば、文末表現・文の長さに合わせる
- ただし医療用語の正誤は補正リスト優先（過去計画に「複雑音」とあっても「副雑音」と書く）`;
}

function buildUserPrompt(
  input: GenerateIssuesInput,
  recentSoaps: { visitDate: string; S: string; O: string; A: string; P: string }[],
  activePlan: { planDate: string; nursingGoal?: string; issues?: unknown } | null
): string {
  const { patient, labels, conferenceMemo, oldCarePlan, nursingContentItems } = input;

  const labelsSection = `\n【選択された課題ラベル（${labels.length}件・順序維持）】\n` +
    labels.map((l, i) => `  ${i + 1}. ${l}`).join("\n") + "\n";

  const conferenceSection = conferenceMemo?.trim()
    ? `\n【議事録（退院前カンファレンス・サービス担当者会議等）】\n${conferenceMemo}\n`
    : "";

  const oldCarePlanSection = oldCarePlan?.trim()
    ? `\n【旧ケアプラン欄（過渡期の参考情報）】\n${oldCarePlan}\n`
    : "";

  const nursingContentSection = nursingContentItems && nursingContentItems.length > 0
    ? `\n【登録済みケア内容（重複許容）】\n${nursingContentItems.map((item) => `・${item}`).join("\n")}\n`
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
    : "";

  return `【患者情報】
- 年齢: ${patient.age}歳
- 主病名: ${patient.diagnosis}
- 要介護度: ${patient.careLevel}
${labelsSection}${conferenceSection}${oldCarePlanSection}${nursingContentSection}${soapSection}${activePlanSection}
上記情報から、選択された各課題ラベルに対し OP（観察）/ TP（ケア）/ EP（指導）を生成し、
全課題を統合した nursing_goal も記述せよ。
issues は labels と同じ順序・件数で返すこと。
Tool use の generate_nursing_care_issues を必ず使うこと。`;
}

function formatActivePlanIssues(issues: unknown): string {
  if (!Array.isArray(issues) || issues.length === 0) return "課題：（なし）";
  const lines: string[] = ["課題："];
  for (const i of issues) {
    if (i && typeof i === "object") {
      const o = i as Record<string, unknown>;
      const no = o.no ?? "?";
      if (o.format === "nanda" && typeof o.diagnosis_label === "string") {
        const op = Array.isArray(o.op) ? (o.op as string[]).join(" / ") : "";
        const tp = Array.isArray(o.tp) ? (o.tp as string[]).join(" / ") : "";
        const ep = Array.isArray(o.ep) ? (o.ep as string[]).join(" / ") : "";
        lines.push(`  ${no}. ${o.diagnosis_label}`);
        if (op) lines.push(`     OP: ${op}`);
        if (tp) lines.push(`     TP: ${tp}`);
        if (ep) lines.push(`     EP: ${ep}`);
      } else if (typeof o.issue === "string") {
        const summary = o.issue.length > 120 ? o.issue.slice(0, 120) + "…" : o.issue;
        lines.push(`  ${no}. ${summary}`);
      }
    }
  }
  return lines.join("\n");
}
