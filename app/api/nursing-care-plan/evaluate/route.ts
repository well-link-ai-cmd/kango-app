import { NextRequest, NextResponse } from "next/server";
import { generateAiResponse } from "@/lib/ai-client";
import { getAuthUser } from "@/lib/supabase-server";

/**
 * 看護計画書 評価AI生成API
 *
 * 手順書: docs/看護計画書_手順書.md
 *
 * 指定期間のSOAP記録から、課題ごとの総合評価下書きを生成する。
 * 一括評価モード（複数課題を一度に評価）がデフォルト。
 *
 * AI責任分界:
 *   - AI下書き可: 経過サマリ、変化のポイント、継続/改善/達成/見直し候補の所見文言
 *   - 看護師確認必須: 最終的な「改善」「悪化」「継続」等の医学的判定
 *
 * 利用条件:
 *   - 指定期間内のSOAP記録が3件未満の場合、評価不可としてエラー返却
 *
 * プロンプトバージョン: v1.0.0 (2026-04-22)
 */

const PROMPT_VERSION = "nursing-care-plan-evaluate-v1.0.0";

interface PeriodSoapRecord {
  visitDate?: string;
  S: string;
  O: string;
  A: string;
  P: string;
}

interface EvaluateIssueInput {
  no: number;
  issue: string;              // 評価対象の課題文
}

interface NursingCarePlanEvaluateInput {
  patient: {
    age: number;
    diagnosis: string;
    careLevel: string;
  };
  issues: EvaluateIssueInput[];          // 一括評価対象（1件のみ指定で個別評価）
  periodStart: string;                   // 評価期間開始日 YYYY-MM-DD
  periodEnd: string;                     // 評価期間終了日 YYYY-MM-DD
  periodSoapRecords: PeriodSoapRecord[]; // 期間内のSOAP記録（時系列順）
  nursingContentItems?: string[];        // 登録済みケア内容（参考）
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const body = (await req.json()) as NursingCarePlanEvaluateInput;

  if (!body.patient || !body.issues || body.issues.length === 0) {
    return NextResponse.json(
      { error: "患者情報と評価対象の課題が必要です" },
      { status: 400 }
    );
  }

  // 利用条件チェック：期間内SOAPが3件未満なら評価不可
  const recordCount = body.periodSoapRecords?.length ?? 0;
  if (recordCount < 3) {
    return NextResponse.json(
      {
        error: `評価には期間内のSOAP記録が3件以上必要です（現在 ${recordCount} 件）。記録が貯まってから再度お試しください。`,
        _min_records: 3,
        _current_records: recordCount,
      },
      { status: 400 }
    );
  }

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(body);

  const evaluateTool = {
    name: "output_issue_evaluations",
    description:
      "各課題について、期間内SOAPから経過・変化・所見下書きを生成する。必ず extracted_facts → per_issue_coverage → evaluations の順で埋めること。",
    input_schema: {
      type: "object" as const,
      properties: {
        extracted_facts: {
          type: "array",
          items: { type: "string" },
          description:
            "期間内SOAPから抽出した事実。由来タグ [日付-S] [日付-O] [日付-A] [日付-P] を付ける。誤変換補正済み。内部確認用。",
        },
        per_issue_coverage: {
          type: "array",
          items: { type: "string" },
          description:
            "各課題ごとに、関連する事実を列挙したマッピング。例：『課題#1:〇〇 → [4/1-O] [4/8-A] [4/15-P]』。内部確認用。",
        },
        evaluations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              no: { type: "integer", description: "課題の行番号（入力と同じ）" },
              course_summary: {
                type: "string",
                description:
                  "期間内の経過サマリ（1000字以内）。いつ何が起きたかを時系列で整理。",
              },
              change_points: {
                type: "string",
                description:
                  "変化のポイント（500字以内）。期間開始時と終了時の状態変化、ADL/症状/バイタル傾向の変化。",
              },
              finding_draft: {
                type: "string",
                description:
                  "所見下書き（500字以内）。『継続』『改善傾向』『悪化傾向』『目標達成』『見直し必要』等の候補文言を、根拠とともに提示。末尾に『※AI下書き。最終判定は看護師確認必須』を付与。",
              },
            },
            required: ["no", "course_summary", "change_points", "finding_draft"],
          },
          description:
            "課題ごとの評価。入力の issues 配列と同じ順序・件数で返すこと。",
        },
      },
      required: ["extracted_facts", "per_issue_coverage", "evaluations"],
    },
  };

  try {
    const response = await generateAiResponse(userPrompt, systemPrompt, {
      maxTokens: 8192,
      timeoutMs: 90000,
      temperature: 0.2,
      tool: evaluateTool,
    });

    if (!response.toolInput) {
      return NextResponse.json({ error: "AIの応答を解析できませんでした。" }, { status: 500 });
    }

    const result = response.toolInput as {
      evaluations?: Array<{
        no: number;
        course_summary: string;
        change_points: string;
        finding_draft: string;
      }>;
    };

    // 評価テキストを組み立て（カイポケ評価欄への単一テキストとしてフォーマット）
    const formatted = (result.evaluations ?? []).map((ev) => {
      const text = [
        `【経過サマリ】\n${ev.course_summary}`,
        `【変化のポイント】\n${ev.change_points}`,
        `【所見（下書き）】\n${ev.finding_draft}`,
      ].join("\n\n");
      return {
        no: ev.no,
        evaluation: appendAiNotice(text),
        evaluated_at: new Date().toISOString(),
      };
    });

    return NextResponse.json({
      evaluations: formatted,
      period: {
        start: body.periodStart,
        end: body.periodEnd,
        record_count: recordCount,
      },
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

function appendAiNotice(text: string): string {
  if (!text?.trim()) return "";
  if (text.includes("※AI下書き")) return text;
  return `${text.trim()}\n\n※AI下書き。最終判定は看護師確認必須`;
}

function buildSystemPrompt(): string {
  return `あなたは訪問看護の看護計画書の評価欄を作成する専門AIである。指定期間内のSOAP記録を読み取り、各課題について「経過サマリ・変化のポイント・所見下書き」の3構造で評価ドラフトを生成する。

# 作業手順（必ず順番に実行）
1. extracted_facts：期間内SOAPから事実を抽出（由来タグ [日付-S/O/A/P] 付き、誤変換補正済み）
2. per_issue_coverage：各課題について、関連する事実をマッピング
3. evaluations：課題ごとに3構造（course_summary / change_points / finding_draft）で評価を記述

# 出力形式
Tool use（output_issue_evaluations）のJSONのみ。前置き・説明は不要。
evaluations は入力の issues 配列と**同じ順序・同じ件数**で返すこと。

# あなたがやらないこと（AI責任分界：違反厳禁）
- 医学的な最終判定を断定しない
  - 禁止表現：「改善した」「悪化した」「治癒した」「効果があった」（断定）
  - 代わりに：「改善傾向と考えられる」「悪化傾向が見られる」「継続観察が必要」（下書き）
- DESIGN-R、Barthel、GAF、自立度ランクの点数判定・変更
- 診断名の変更・新規付与
- 薬剤の処方・変更・中止の提案（医師権限）
- ドレッシング材・外用薬の商品名・成分名の言及
- 具体的検査値の創作（記録にあるもののみ引用）

# 医療用語の正しい表記（誤変換補正・全段階で徹底）
- 副雑音（× 複雑音）
- 緊満感（× 緊満・緊張感）
- 更衣（× 交衣・交依・好意）
- 洗髪（× 先発）
- 著明（× 著名）
- 褥瘡（× 辱層）
- 浮腫（× 不種）
- 嚥下（× 円下）
- 疼痛（× 等痛）
- 腸蠕動音（× 朝蠕動音）
- 腹部（× 服部）
- 排便（× 配便）

# course_summary（経過サマリ）の書き方
- 1000字以内
- 期間内の出来事を**時系列順**で整理
- 日付を明記：「4/1の訪問では〜。4/8には〜。4/15時点で〜。」
- 該当課題に関連する事象のみ記述（他の課題の話を混ぜない）
- SOAPにない情報を創作しない

# change_points（変化のポイント）の書き方
- 500字以内
- 期間開始時と終了時の状態を対比
- ADL / 症状 / バイタル / 服薬 / 家族支援 の観点から変化を拾う
- 「〜だった状態から、〜へ変化している」形式
- 変化がなければ「大きな変化は見られない」で可

# finding_draft（所見下書き）の書き方
- 500字以内
- 候補文言：「継続」「改善傾向」「悪化傾向」「目標達成」「見直し必要」「中止検討」
- 根拠となる期間内の事実を1〜2点挙げる
- 断定せず「〜と考えられる」「〜傾向が見られる」の語尾
- 末尾に「※AI下書き。最終判定は看護師確認必須」を付与（Tool schemaレベルで自動付与されるため、本文内では省略可）

# 期間内に該当課題への言及が乏しい場合
- course_summary：「本期間のSOAPに該当課題への直接的言及は限定的。〜の記録のみ確認」等
- change_points：「大きな変化を追跡できる情報が限定的」
- finding_draft：「継続観察とし、次回評価までに記録充実を図る」等の下書き

# 個人情報
- 利用者の氏名・住所・電話番号・「〜様」を含めない
- 「利用者」「本人」の表現を使う`;
}

function buildUserPrompt(input: NursingCarePlanEvaluateInput): string {
  const { patient, issues, periodStart, periodEnd, periodSoapRecords, nursingContentItems } = input;

  const nursingContentSection = nursingContentItems && nursingContentItems.length > 0
    ? `\n【登録済みケア内容（参考）】\n${nursingContentItems.map((item) => `・${item}`).join("\n")}`
    : "";

  const soapSection = "\n【期間内のSOAP記録】\n" + periodSoapRecords
    .map(
      (r, i) =>
        `[${i + 1}${r.visitDate ? `（${r.visitDate}）` : ""}]\nS: ${r.S}\nO: ${r.O}\nA: ${r.A}\nP: ${r.P}`
    )
    .join("\n\n");

  const issuesSection = "\n【評価対象の課題】\n" + issues
    .map((i) => `No.${i.no}: ${i.issue}`)
    .join("\n");

  return `【患者情報】
- 年齢: ${patient.age}歳
- 主病名: ${patient.diagnosis}
- 要介護度: ${patient.careLevel}

【評価期間】${periodStart} 〜 ${periodEnd}
（期間内SOAP記録: ${periodSoapRecords.length}件）
${nursingContentSection}
${issuesSection}
${soapSection}

上記情報から、各課題の評価ドラフトを生成せよ。
Tool use の output_issue_evaluations を必ず使い、issues と同じ順序・件数で evaluations を返すこと。`;
}
