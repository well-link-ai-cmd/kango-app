import { NextRequest, NextResponse } from "next/server";
import { generateAiResponse } from "@/lib/ai-client";
import { aiErrorResponse } from "@/lib/ai-error-response";
import { getAuthUser } from "@/lib/supabase-server";

import { MEDICAL_TERM_CORRECTIONS_COMPACT } from "@/lib/medical-term-corrections";
import { logAiSend } from "@/lib/audit-server";
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

const PROMPT_VERSION = "nursing-care-plan-evaluate-v1.2.0";  // v1.2.0: Haiku 4.5 降格（要約系のためHaikuで十分）
const AI_MODEL = "claude-haiku-4-5-20251001";

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
    description: "各課題について、期間SOAPから自由文1ブロックの評価ドラフトを生成する（カイポケ・iBow等の評価欄にそのまま貼付できる形式）。",
    input_schema: {
      type: "object" as const,
      properties: {
        evaluations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              no: { type: "integer", description: "課題の行番号（入力と同じ）" },
              evaluation: {
                type: "string",
                description: "評価本文（300〜500字程度の自然な自由文・1ブロック）。書き方はsystem指示「評価本文の書き方」に従う。",
              },
            },
            required: ["no", "evaluation"],
          },
          description: "課題ごとの評価。入力 issues と同じ順序・件数。",
        },
      },
      required: ["evaluations"],
    },
  };

  try {
    // 医療情報のAI送信を監査記録（越境送信の記録・fire-and-forget）
    logAiSend("care_plan_evaluate", null);
    const response = await generateAiResponse(userPrompt, systemPrompt, {
      model: "haiku",
      maxTokens: 4096,
      timeoutMs: 60000,
      temperature: 0.2,
      tool: evaluateTool,
    });

    if (!response.toolInput) {
      return NextResponse.json({ error: "AIの応答を解析できませんでした。" }, { status: 500 });
    }

    const result = response.toolInput as {
      evaluations?: Array<{
        no: number;
        evaluation: string;
      }>;
    };

    // 評価本文（自由文1ブロック）。先頭に「【R元号年月日看護師評価】」プレフィックスを自動付与
    const todayPrefix = formatJapaneseEraDate(new Date());
    const formatted = (result.evaluations ?? []).map((ev) => {
      const body = (ev.evaluation ?? "").trim();
      const text = body.startsWith("【") ? body : `【${todayPrefix}看護師評価】${body}`;
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
    return aiErrorResponse(e);
  }
}

function appendAiNotice(text: string): string {
  if (!text?.trim()) return "";
  if (text.includes("※AI下書き")) return text;
  return `${text.trim()}\n\n※AI下書き。最終判定は看護師確認必須`;
}

/**
 * 日付を「R{元号年}.M.D」形式に整形（例：R8.4.30）。
 * 看護記録欄の慣習的なプレフィックス用。2019年5月以降は令和（R）固定。
 */
function formatJapaneseEraDate(d: Date): string {
  const y = d.getFullYear() - 2018;  // 2019=令和1
  return `R${y}.${d.getMonth() + 1}.${d.getDate()}`;
}

function buildSystemPrompt(): string {
  return `あなたは訪問看護の看護計画書の評価欄を作成する専門AIである。指定期間SOAPから各課題について自由文1ブロックの評価ドラフトを生成する。
カイポケ・iBow 等の電子カルテの評価欄にそのまま貼付できる形式で出力する。

# 出力ルール
- evaluations は入力 issues と同じ順序・同じ件数
- 各 evaluation は 300〜500字程度の自然な自由文1ブロック
- 見出し（【経過サマリ】【変化のポイント】等）は付けない
- 出力は Tool use の JSON のみ（前置き不要）

# 評価本文の書き方（300〜500字）
- 自然な文章で1ブロック。改行は段落の自然な区切りにとどめる
- 含めるべき要素（該当課題に関連する範囲で）：
  * バイタル傾向（「概ね安定」「血圧やや高め」等）
  * 主症状の経過（疼痛・呼吸器・循環器・排便・睡眠・精神症状など、課題に関連するもの）
  * ADL・活動量（端座位・歩行距離・外出頻度など）
  * 実施したケア（足浴・マッサージ・服薬管理・処置など）
  * 服薬状況（「内服継続できている」等。具体的な薬剤名は記録にあるもののみ引用）
  * 体重・摂取量等の数値（記録にあれば）
- 末尾の方針は1文。形式は本文の文体に揃える（事業所内で混在するため強制しない）：
  * 体言止め例：「継続する。」「達成とする。」「変更する。」「見直しを検討する。」「経過観察を継続する。」
  * 丁寧語例：「プラン継続します。」「終了します。」「変更します。」「計画変更を検討します。」
  * 本文を体言止めで書いたら末尾も体言止め、丁寧語で書いたら末尾も丁寧語に揃える
- 該当課題への期間内記載が乏しい場合は素直に「期間内の記録に該当課題への直接的言及は限定的」「継続観察と記録の充実が必要」等で短く

# 禁止事項
- 断定表現：「改善した」「悪化した」「治癒した」「効果があった」 → 「〜傾向で経過」「〜が維持されている」等に置き換え
- 認定語：「目標達成」「中止」「中止検討」（看護師判断領域）
- DESIGN-R / Barthel / GAF / 自立度の点数判定
- 診断名変更、薬剤の処方/変更/中止の提案（医師権限）
- ドレッシング材・薬剤の商品名・成分名（記録にあるもののみ引用）
- SOAPにない情報の創作

# 医療用語の補正
${MEDICAL_TERM_CORRECTIONS_COMPACT}

# 個人情報
氏名・住所・電話番号・「〜様」は出力しない。「利用者」「本人」を使用。

# 出力例（参考・実事業所サンプル）
"バイタルは概ね安定して経過。日中は端座位で過ごし、夜間も排尿後に再入眠でき睡眠状況は維持されている。食事・水分摂取は良好で、足浴・下腿マッサージを継続し浮腫悪化もなし。歩行は膝痛の影響で変動あるものの、中旬以降は散歩意欲が向上し気分の改善もみられている。排便は2日に1回でコントロール良好。内服も継続して服用できており、総じてADL維持に向けたリハビリが順調で、心身の安定が保たれている。継続する。"`;
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
