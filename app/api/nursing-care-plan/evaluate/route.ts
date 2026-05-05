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

const PROMPT_VERSION = "nursing-care-plan-evaluate-v1.1.0";  // v1.1.0: Sonnet 4.6 昇格
const AI_MODEL = "claude-sonnet-4-6";

// Vercel Functions の実行時間上限（Sonnet 4.6 で複数課題評価のため長めに確保）
export const maxDuration = 300;

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
    description: "各課題について、期間SOAPから簡潔な評価ドラフトを生成する。",
    input_schema: {
      type: "object" as const,
      properties: {
        evaluations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              no: { type: "integer", description: "課題の行番号（入力と同じ）" },
              course_summary: {
                type: "string",
                description: "期間内の経過サマリ（300字程度）。日付を入れて時系列で簡潔に。",
              },
              change_points: {
                type: "string",
                description: "変化のポイント（200字程度）。期間開始/終了の対比。",
              },
              finding_draft: {
                type: "string",
                description: "所見下書き（200字程度）。『継続』『改善傾向』『悪化傾向』『見直しの余地あり』等の観察表現を根拠とともに。『目標達成』『中止』禁止。",
              },
            },
            required: ["no", "course_summary", "change_points", "finding_draft"],
          },
          description: "課題ごとの評価。入力 issues と同じ順序・件数。",
        },
      },
      required: ["evaluations"],
    },
  };

  try {
    const response = await generateAiResponse(userPrompt, systemPrompt, {
      model: "sonnet",
      maxTokens: 4096,
      timeoutMs: 120000,
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
  return `${text.trim()}\n\n※AI下書き。最終判定は看護師確認必須`;
}

function buildSystemPrompt(): string {
  return `あなたは訪問看護の看護計画書の評価欄を作成する専門AIである。指定期間SOAPから各課題について簡潔な評価ドラフトを生成する。

# 出力ルール
- evaluations は入力 issues と同じ順序・同じ件数
- 各フィールドは指定字数を厳守し、簡潔に書く
- 出力は Tool use の JSON のみ（前置き不要）

# 各フィールドの書き方
- course_summary（300字程度）：時系列で簡潔に。日付明記（「4/1〜」「4/15時点で〜」）。該当課題に関連する事象のみ。
- change_points（200字程度）：期間開始/終了の対比。「〜から〜へ変化」形式。変化なしなら「大きな変化なし」で可。
- finding_draft（200字程度）：「継続」「改善傾向」「悪化傾向」「達成傾向が見られる」「見直しの余地あり」を根拠1〜2点で。語尾は「〜と考えられる」「〜傾向が見られる」。

# 禁止事項
- 断定表現：「改善した」「悪化した」「治癒した」「効果があった」 → 「〜傾向と考えられる」に置き換え
- 認定語：「目標達成」「中止」「中止検討」（看護師判断領域）
- DESIGN-R / Barthel / GAF / 自立度の点数判定
- 診断名変更、薬剤の処方/変更/中止の提案（医師権限）
- ドレッシング材・薬剤の商品名・成分名
- SOAPにない情報の創作

# 医療用語の補正
副雑音(×複雑音) / 緊満感(×緊張感) / 更衣(×交衣) / 洗髪(×先発) / 著明(×著名) / 褥瘡(×辱層) / 浮腫(×不種) / 嚥下(×円下) / 疼痛(×等痛) / 腸蠕動音(×朝蠕動音) / 腹部(×服部) / 排便(×配便) / 関節(×間接) / 仰臥位(×仰が位)

# 言及が乏しい場合
「該当課題への直接的言及は限定的」「継続観察と記録の充実が必要と考えられる」等の下書き表現で書く。

# 個人情報
氏名・住所・電話番号・「〜様」は出力しない。「利用者」「本人」を使用。`;
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
