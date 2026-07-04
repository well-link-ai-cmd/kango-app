import { NextRequest, NextResponse } from "next/server";
import { generateAiResponse } from "@/lib/ai-client";
import { getAuthUser, getServerSupabase } from "@/lib/supabase-server";

import { logAiSend } from "@/lib/audit-server";
interface PreviousRecord {
  visitDate: string;
  S: string;
  O: string;
  A: string;
  P: string;
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const body = await req.json();
  const { patientId, sInput, rawInput, previousRecords, carePlan, nursingContentItems } = body as {
    patientId?: string;
    sInput?: string;
    rawInput: string;
    previousRecords: PreviousRecord[];
    carePlan?: string;
    nursingContentItems?: string[];
  };

  // アプリ内の構造化記録のみを alerts 検出のソースにする。
  // 導入時の貼り付け記録（initialSoapRecords）は生テキストの用語参考用途のため alerts には使わない。
  const allRecords = (previousRecords ?? []).slice(0, 3);

  // 看護計画書（確定版・最優先コンテキスト）の取得
  let activeNursingCarePlanSection = "";
  if (patientId) {
    try {
      const supabase = await getServerSupabase();
      const { data: plan } = await supabase
        .from("nursing_care_plans")
        .select("plan_date, nursing_goal, issues")
        .eq("patient_id", patientId)
        .eq("is_draft", false)
        .order("plan_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (plan) {
        const issues = (plan.issues as Array<Record<string, unknown>> | null) ?? [];
        const issuesText = issues.length > 0
          ? issues.map((i) => formatPlanIssue(i)).join("\n")
          : "  （なし）";
        activeNursingCarePlanSection = `【看護計画書（確定版・最優先コンテキスト、作成日 ${plan.plan_date}）】\n目標：${plan.nursing_goal ?? "（未記入）"}\n療養上の課題：\n${issuesText}\n\n`;
      }
    } catch (e) {
      console.error("active nursing care plan fetch error:", e);
    }
  }

  // 看護計画書もなく過去記録もなければ、チェックすべき内容なしで終了
  if (allRecords.length === 0 && !activeNursingCarePlanSection) {
    return NextResponse.json({ questions: [], alerts: [] });
  }

  const prevText = allRecords
    .map(
      (r, i) =>
        `【${i === 0 ? "前回" : i === 1 ? "前々回" : "3回前"}の記録${r.visitDate ? `（${r.visitDate}）` : ""}】\n` +
        `S: ${r.S}\nO: ${r.O}\nA: ${r.A}\nP: ${r.P}`
    )
    .join("\n\n");

  const systemPrompt = `あなたは訪問看護の記録支援AIである。目的は1つ：
看護計画書（確定版の目標・課題）・過去記録・登録ケア内容で触れられていた項目が、今日のメモで漏れていないかを検出する（= alerts）。

参照優先順位：看護計画書（確定版） > 過去記録 > 旧ケアプラン欄（フォールバック）

メモは音声入力のため誤変換がある。文脈から正しい医療用語として読み取ること（例：朝蠕動音=腸蠕動音、服部=腹部、配便=排便）。

# 作業手順
1. memo_covers：今日のメモ（S情報含む）に既に書かれている内容を列挙する
2. expected_from_context：以下の3ソースから、今日確認または実施が期待される項目を列挙する
   (a) 看護計画書の目標・課題
   (b) 過去3回分の記録で継続的に記載されている症状・観察・処置（前回Pの計画事項だけでなく、S/O/Aに繰り返し出てくる事項も対象。例：3回分とも創部の記載があるのに今日ない）
   (c) 登録済みケア内容のうち、実施記載が期待される項目
3. gaps：expected_from_context のうち memo_covers に該当がないものだけを抽出する → ここから alerts を作る

# 絶対ルール
- alerts は過去記録（看護計画書・過去3回の記録・登録ケア内容）由来の項目のみ。今日のメモが曖昧な点を掘り下げる質問は出さない（看護師の負担になるため）
- 今日のメモに既に書かれている内容を再確認させない
- 時制：今日行った処置の効果・結果はまだ出ていないので聞かない。「前回〜した」「先週〜があった」の経過確認のみOK

# バイタル
バイタル値（体温・血圧・脈拍・SpO2・呼吸数）は別欄で入力されるため、値の記載漏れアラートは出さない（「血圧の記載がない」等は不可）。
ただしバイタルに紐づく処置・対応（酸素流量の調整、発熱時対応、頓用薬の使用等）が前回Pや看護計画にある場合、その実施記載の漏れはアラート対象とする。

# 件数
- alerts：最大3件。本当に必要なものだけ。該当なしは空配列。無理に埋めない。`;
  // 過渡期：看護計画書があれば優先参照、なければ carePlan を補助参照
  const carePlanFallbackSection = !activeNursingCarePlanSection && carePlan
    ? `【ケアプラン・担当者会議の方針（旧欄・過渡期参照）】\n${carePlan}\n\n`
    : "";

  const prompt = `${activeNursingCarePlanSection}${carePlanFallbackSection}${nursingContentItems && nursingContentItems.length > 0 ? `【登録済みケア内容】\n${nursingContentItems.map(item => `・${item}`).join("\n")}\n\n` : ""}${prevText}

${sInput?.trim() ? `【今回のS情報】\n${sInput}\n\n` : ""}【今回の訪問メモ】
${rawInput}`;

  // alerts のみ生成。questions（メモ内曖昧点の掘り下げ）は廃止
  // （実運用で「もっと詳しく書けますか？」系の質問はほぼ不要だったため・出力トークン削減）
  const questionsTool = {
    name: "output_gap_check",
    description: "今日のメモを過去記録・看護計画書・登録ケア内容と照合し、漏れている項目を alerts として返す。",
    input_schema: {
      type: "object" as const,
      properties: {
        memo_covers: {
          type: "array",
          items: { type: "string" },
          description: "今日の訪問メモ（S情報含む）に明示的に書かれている内容を25字以内の短句で列挙。内部確認用なので簡潔に。",
        },
        expected_from_context: {
          type: "array",
          items: { type: "string" },
          description: "看護計画書・過去3回分の継続記載事項・登録ケア内容から、今日確認/実施が期待される項目を25字以内の短句で列挙。内部確認用なので簡潔に。",
        },
        alerts: {
          type: "array",
          items: { type: "string" },
          description: "expected_from_context のうち memo_covers に該当がないもの。最大3件。『前回P継続：〜が記載されていない』『過去記録継続：〜の記載が今日ない』『登録ケア内容：〜の実施記載がない』形式。該当なしは空配列。",
        },
      },
      required: ["memo_covers", "expected_from_context", "alerts"],
    },
  };

  try {
    // 医療情報のAI送信を監査記録（越境送信の記録・fire-and-forget）
    logAiSend("soap_alerts", patientId ?? null);
    const response = await generateAiResponse(prompt, systemPrompt, {
      temperature: 0.2,
      tool: questionsTool,
    });

    if (!response.toolInput) {
      return NextResponse.json({ questions: [], alerts: [] });
    }
    const result = response.toolInput as { alerts?: string[] };
    // questions はクライアント互換のため空配列で返却（将来的にクライアント側からも削除予定）
    return NextResponse.json({
      questions: [],
      alerts: result.alerts ?? [],
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ questions: [], alerts: [] });
  }
}

/**
 * 看護計画書の issue（JSONB の1要素）を プロンプト注入用テキストに整形。
 * NANDA形式と freeform形式の両対応。
 */
function formatPlanIssue(raw: Record<string, unknown>): string {
  const no = raw.no ?? "?";
  if (raw.format === "nanda") {
    const label = (raw.diagnosis_label as string) ?? "";
    const op = Array.isArray(raw.op) ? (raw.op as string[]) : [];
    const tp = Array.isArray(raw.tp) ? (raw.tp as string[]) : [];
    const ep = Array.isArray(raw.ep) ? (raw.ep as string[]) : [];
    const lines = [`  ${no}. ${label}`];
    if (op.length > 0) lines.push(`     OP: ${op.join(" / ")}`);
    if (tp.length > 0) lines.push(`     TP: ${tp.join(" / ")}`);
    if (ep.length > 0) lines.push(`     EP: ${ep.join(" / ")}`);
    return lines.join("\n");
  }
  const issue = (raw.issue as string) ?? "";
  return `  ${no}. ${issue}`;
}
