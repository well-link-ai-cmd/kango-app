import { NextRequest, NextResponse } from "next/server";
import { generateAiResponse } from "@/lib/ai-client";
import { getAuthUser, getServerSupabase } from "@/lib/supabase-server";

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
  const { patientId, sInput, rawInput, previousRecords, carePlan, nursingContentItems, initialSoapRecords } = body as {
    patientId?: string;
    sInput?: string;
    rawInput: string;
    previousRecords: PreviousRecord[];
    carePlan?: string;
    nursingContentItems?: string[];
    initialSoapRecords?: PreviousRecord[];
  };

  // アプリ内記録 + 初期インポート記録を統合
  const allRecords = [
    ...(previousRecords ?? []),
    ...(initialSoapRecords ?? []),
  ].slice(0, 3);

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
        const issues = (plan.issues as { no: number; issue: string }[] | null) ?? [];
        const issuesText = issues.length > 0
          ? issues.map((i) => `  ${i.no}. ${i.issue}`).join("\n")
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

  const systemPrompt = `あなたは訪問看護の記録支援AIである。目的は2つある：
(A) 看護計画書（確定版の目標・課題）・過去記録・登録ケア内容で触れられていた項目が、今日のメモで漏れていないかを検出する（= alerts）
(B) 今日のメモに書かれている内容のうち、情報が曖昧・不足していて記録を充実させるため追加確認が必要な点を質問する（= questions）

参照優先順位：看護計画書（確定版） > 過去記録 > 旧ケアプラン欄（フォールバック）

alerts と questions は別の目的・別のソースである。同じトピックを両方に出してはならない。

メモは音声入力のため誤変換がある。文脈から正しい医療用語として読み取ること（例：朝蠕動音=腸蠕動音、服部=腹部、配便=排便）。

# 作業手順（必ず順番に実行）
1. memo_covers：今日のメモ（S情報含む）に既に書かれている内容を1つ残らず列挙する
2. expected_from_context：看護計画書の目標・課題、前回P・次回確認事項、登録済みケア内容から、今日確認または実施が期待される項目を列挙する
3. gaps：expected_from_context のうち memo_covers に該当がないものだけを抽出する → ここから alerts を作る
4. memo_ambiguities：memo_covers のうち情報が曖昧・具体性に欠ける項目を抽出する（例：「排便あり」だけで量/性状不明、「創部処置実施」だけで所見なし、「疼痛訴えあり」だけで部位/程度不明）→ ここから questions を作る
5. alerts は gaps からのみ、questions は memo_ambiguities からのみ生成する。

# 絶対ルール：alerts と questions のトピック重複禁止
同じ事項（例：「膣分泌物の経過観察」）について alerts と questions の両方に出してはならない。
alerts に入れたトピックは questions から除外する。alerts を優先する。

# 絶対ルール：questions は今日のメモにある内容を掘り下げる質問だけ
questions は「今日のメモに書かれているが情報が足りない項目」への追加確認である。
過去記録にあって今日のメモにない項目は alerts 側で扱うため、questions には出さない。
今日のメモにも過去記録にもない話題を新規に聞くのは禁止（医療安全・負担増のため）。

# 絶対ルール：memo_covers に十分書かれているものは聞かない
今日のメモに既に具体的に書かれている処置・観察・発言について「〜はどうでしたか？」と聞くのは禁止。
例：メモに「黄褐色軟便中等量あり」とあれば、便の性状は聞かない。
迷ったら出さない。

# 絶対ルール：時制
メモは「今日の訪問で行ったこと」である。今日行った処置の効果・結果はまだ出ていないので聞かない。
✕「眠剤を増やした」→「睡眠はどうですか？」（効果はまだ不明）
✕「来週オペ予定」→「術後の状態は？」（まだ手術していない）
○「前回〜した」「先週〜があった」→ その経過確認はOK

# バイタル
バイタルは別欄で入力されるため「バイタル記載がない」という汎用アラートは出さない。
病態上重要な特定項目（高血圧患者の血圧等）のみピンポイントで確認してよい。

# 件数の上限
- alerts：最大3件（前回P・次回確認事項・登録ケア内容で今日漏れているもの）
- questions：最大3件（今日のメモ内で情報不足な項目の掘り下げ）
- 本当に必要なものだけを出す。該当がなければ空配列でよい。無理に埋めない。`;

  // 過渡期：看護計画書があれば優先参照、なければ carePlan を補助参照
  const carePlanFallbackSection = !activeNursingCarePlanSection && carePlan
    ? `【ケアプラン・担当者会議の方針（旧欄・過渡期参照）】\n${carePlan}\n\n`
    : "";

  const prompt = `${activeNursingCarePlanSection}${carePlanFallbackSection}${nursingContentItems && nursingContentItems.length > 0 ? `【登録済みケア内容】\n${nursingContentItems.map(item => `・${item}`).join("\n")}\n\n` : ""}${prevText}

${sInput?.trim() ? `【今回のS情報】\n${sInput}\n\n` : ""}【今回の訪問メモ】
${rawInput}`;

  // Tool use で「抽出→照合→ギャップ検出→出力」の順序を強制。
  // alerts（過去→今日の漏れ）と questions（今日のメモ内の曖昧点）を別ソースから生成することで役割重複を防ぐ
  const questionsTool = {
    name: "output_gap_check",
    description: "今日のメモを2軸で点検する。(A) 過去記録・ケアプラン・登録ケア内容との差分 → alerts、(B) メモ内の曖昧点 → questions。必ず memo_covers → expected_from_context → gaps → memo_ambiguities → alerts/questions の順で埋めること。",
    input_schema: {
      type: "object" as const,
      properties: {
        memo_covers: {
          type: "array",
          items: { type: "string" },
          description: "今日の訪問メモ（S情報含む）に明示的に書かれている内容を箇条書きで列挙。処置・観察・発言・計画など、メモに出ているものは1つ残らず書き出す。十分に具体的に書かれているものは questions に出さない。内部確認用。",
        },
        expected_from_context: {
          type: "array",
          items: { type: "string" },
          description: "前回P・次回確認事項・ケアプラン・登録済みケア内容から、今日確認または実施が期待される項目を列挙。内部確認用。",
        },
        gaps: {
          type: "array",
          items: { type: "string" },
          description: "expected_from_context のうち memo_covers に該当がないもののみ。ここから alerts を生成する。内部確認用。",
        },
        memo_ambiguities: {
          type: "array",
          items: { type: "string" },
          description: "memo_covers のうち情報が曖昧・具体性不足で記録を充実させるために追加確認すべき項目。例：『排便あり（量・性状不明）』『疼痛訴えあり（部位・程度不明）』。gaps と重複するトピックは除外する（alerts 優先）。ここから questions を生成する。内部確認用。",
        },
        alerts: {
          type: "array",
          items: { type: "string" },
          description: "gaps のうち前回P・次回確認事項・登録ケア内容に該当するもの。最大3件。『前回P継続：〜が記載されていない』『登録ケア内容：〜の実施記載がない』形式。questions と絶対にトピックを重複させない。該当なしは空配列。",
        },
        questions: {
          type: "array",
          items: { type: "string" },
          description: "memo_ambiguities のうち記録の充実のために聞くべきもの。『〜はどうでしたか？』『〜の量/性状/程度を教えてください』形式。最大3件。alerts に入れたトピックは絶対に含めない。過去記録由来の項目は questions に出さない（alerts 側で扱う）。該当なしは空配列。",
        },
      },
      required: ["memo_covers", "expected_from_context", "gaps", "memo_ambiguities", "alerts", "questions"],
    },
  };

  try {
    const response = await generateAiResponse(prompt, systemPrompt, {
      temperature: 0.2,
      tool: questionsTool,
    });

    if (!response.toolInput) {
      return NextResponse.json({ questions: [], alerts: [] });
    }
    const result = response.toolInput as { alerts?: string[]; questions?: string[] };
    return NextResponse.json({
      questions: result.questions ?? [],
      alerts: result.alerts ?? [],
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ questions: [], alerts: [] });
  }
}
