import { NextRequest, NextResponse } from "next/server";
import { generateAiResponse } from "@/lib/ai-client";
import { getAuthUser, getServerSupabase } from "@/lib/supabase-server";
import { SOAP_FEWSHOT_EXAMPLES } from "@/lib/soap-fewshot";

/**
 * 参照コンテキストの優先順位（過渡期）：
 *   1. 看護計画書（is_draft=false の最新 plan_date）← あればこれを優先参照
 *   2. carePlan（旧欄、過渡期のみ）← 看護計画書がない場合の補助参照
 *   3. ケア内容リスト ← 常に参照（別経路）
 * 看護計画書feature完全移行後に carePlan カラムを drop する想定。
 */
export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const body = await req.json();
  const { patientId, sInput, rawInput, carePlan, previousRecords, alertAnswers, questionAnswers, initialSoapRecords } = body;

  if (!rawInput?.trim()) {
    return NextResponse.json({ error: "訪問内容が入力されていません" }, { status: 400 });
  }

  // 看護計画書（確定版）の取得：最優先コンテキスト
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
        activeNursingCarePlanSection = `\n【看護計画書（確定版・最優先コンテキスト、作成日 ${plan.plan_date}）】\n目標：${plan.nursing_goal ?? "（未記入）"}\n療養上の課題：\n${issuesText}\n`;
      }
    } catch (e) {
      // 看護計画書取得失敗は致命的でないので握りつぶす（carePlanにフォールバック）
      console.error("active nursing care plan fetch error:", e);
    }
  }

  // 旧 carePlan（過渡期フォールバック）：看護計画書がなければ補助参照
  const carePlanSection = activeNursingCarePlanSection
    ? "" // 看護計画書があれば carePlan は参照しない
    : carePlan
      ? `\n【ケアプラン・担当者会議の方針（旧欄・過渡期参照）】\n${carePlan}\n`
      : "";

  // 過去の訪問記録（アプリ内の記録 + 初期インポート記録を統合）
  const allPrevRecords = [
    ...(previousRecords ?? []),
    ...(initialSoapRecords ?? []),
  ].slice(0, 3);

  // 継続確認アラートへの回答（メモの記載漏れを補う事実 → 必ず O/A/P に反映。S 欄には入れない）
  const alertAnswersSection = alertAnswers && alertAnswers.length > 0
    ? "\n【前回からの継続確認事項への回答（今回の事実として必ず O/A/P に反映。S 欄には入れない）】\n" +
      alertAnswers
        .filter((qa: { question: string; answer: string }) => qa.answer.trim())
        .map((qa: { question: string; answer: string }) => `継続確認: ${qa.question}\n回答: ${qa.answer}`)
        .join("\n") + "\n"
    : "";

  // 確認質問への回答（メモの記載漏れを補う事実 → 必ず O/A/P に反映。S 欄には入れない）
  const answersSection = questionAnswers && questionAnswers.length > 0
    ? "\n【AIからの確認質問への回答（今回の事実として必ず O/A/P に反映。S 欄には入れない）】\n" +
      questionAnswers
        .filter((qa: { question: string; answer: string }) => qa.answer.trim())
        .map((qa: { question: string; answer: string }) => `Q: ${qa.question}\nA: ${qa.answer}`)
        .join("\n") + "\n"
    : "";

  // S情報が個別入力されている場合は、SはパススルーしてOAPのみ生成
  const hasSInput = sInput?.trim();

  // --- systemプロンプト（ロール定義・ルール・出力形式） ---
  // Phase B 改修（2026-04-27）：
  //   - 強調語を最重要3項目（推測禁止／補正リスト優先／全段階補正）に集中
  //   - 重複した指示を統合（旧「特に重要：」と「禁止事項」のブロックを削除）
  //   - 誤変換リストに音声特性の追加パターンを反映
  //   - 「過去記録の用語表記が補正リストの誤変換と一致する場合は補正後の用語で書く」を明示
  const systemPrompt = `あなたは訪問看護記録のSOAP作成AIである。看護師の話し言葉メモをSOAP形式に変換する。

# 特に重要（最優先で守る3項目）
1. 事実ソースにない情報を推測で創作しない。記載がなければ「未評価」等で残す
2. 過去記録は文体（文末・文の長さ）の手本。医療用語の正誤は補正リスト優先。過去記録に「複雑音」「常用」とあっても、補正リストに従い「副雑音」「上葉」と書く
3. 音声誤変換は extracted_facts の段階から補正する（出力段階で直すのでは遅い）

# 事実ソース（出力材料 / 判断材料の区別）
- 【看護計画書（確定版）】：最優先コンテキスト。目標・課題は A・P の判断材料
- 【今回の訪問メモ】：O への直接記載、A・P の判断材料
- 【S情報】：S への passthrough、A・P の判断材料（本人の訴えとして臨床判断に反映。例「痛みが増した」→ A で疼痛増悪評価、P でレスキュー検討）
- 【AIからの確認質問への回答】【前回からの継続確認事項への回答】：メモの記載漏れを補う事実。空欄でなければ O/A/P に反映する（S 欄には入れない）
- 【過去記録】：文体・継続事項の参考。A では前回からの変化、P では継続/変更の判断材料
- 【ケアプラン（旧欄）】：看護計画書がない場合のみ補助参照

参照優先順位：看護計画書（確定版） > 過去記録・メモ > 旧ケアプラン欄

# S（主観情報）出力欄の厳格ルール
S 欄は専用UI入力欄（看護師の明示入力）のみで構成する：
1. 【S情報】が提供されている場合：そのまま S に反映する（誤変換補正のみ。言い換え・要約・編集はしない）
2. 【S情報】がない場合：S は必ず空文字列 ""。以下のいずれからも S 欄を作ってはならない：
   - 訪問メモの「〜と言った」「〜と発言」「『…』」等の引用や本人発言らしき表現
   - メモ中の家族・関係者の発言
   - 過去記録の S 欄
   - 【AIからの確認質問への回答】【前回からの継続確認事項への回答】の本文（これらは O/A/P 専用）
   - 「特になし」「変わりなし」等のプレースホルダ
※ S情報を A/P の判断材料に使うことは妨げない

# 作業手順
1. extracted_facts：全事実ソースから事実を抽出する。1事実=1要素で配列に入れる（複数事実を1要素に詰めない）。各要素の末尾に由来タグを付ける：[メモ] / [S情報] / [AI回答] / [継続確認回答]
2. coverage_check：各事実を S/O/A/P のどこに反映するかを確認する。[AI回答] [継続確認回答] タグの項目が本文に含まれているかを厳しくチェック
3. S・O・A・P：coverage_check に従って記述。extracted_facts の事実を全て反映する

# 文体ルール
- 過去記録があれば、文末表現・文の長さに合わせる（語尾「〜みられる」「〜である」、短文/長文）
- 過去記録がない場合は「〜みられる」「〜である」調の標準的な看護記録文体
- 見出し・箇条書き・番号リストは使わない。自然な文章で書く
- 事実ソースにない事実を創作しない
- 過去記録の医療用語の表記が補正リストの誤変換と一致する場合は、補正後の用語で書く（過去記録に揃えない）

# 医療用語の補正（全段階で実行）
音声入力では同音異義語の誤変換が頻発する。extracted_facts の段階から補正済みの用語で書く（例「配便は昨日あり」→「排便は昨日あり」）。
よくある誤変換：
- 朝蠕動音/超蠕動音→腸蠕動音、けつあつ→血圧、じょくそう→褥瘡、さんそ→酸素
- ばいたる→バイタル、えすぴーおーつー→SpO2
- 服部→腹部、配便→排便、官庁/感聴→浣腸、円下→嚥下、角痰→喀痰
- 不種/付種→浮腫、辱層→褥瘡、胎動→体動（呼吸・体位文脈）
- 〜の正常→〜の性状（便・創部・分泌物等の文脈）
- 侵入部→刺入部（点滴・カテーテル文脈）
- 外装→咳嗽（呼吸器症状文脈）
- 常用→上葉（呼吸器・肺野文脈。中葉・下葉も同音漢字から補正）
- 複雑音/服雑音→副雑音（呼吸音の「ふくざつおん」）
- 緊満感は必ず「緊満感」（緊張感・近満感・筋満感は誤り。腹部・乳房の張り）
- 「こうい」は衣服の着替え文脈では「更衣」
- 「せんぱつ」は「洗髪」
- 「ちょめい/ちょうめい」は医療文脈では「著明」（著明な浮腫・著明な改善）
- 関節痛は「関節の痛み」
- 医療文脈で意味が通らない漢字は、同音の医療用語に置き換える

# 各項目の書き方
S：【S情報】があればそのまま（誤変換補正のみ）。なければ ""。訪問メモ・過去記録から引き出さない
O：場面描写から始め時系列で。バイタル・処置・観察所見を具体的に。AI回答・継続確認回答の客観情報もここに。次回訪問予定は末尾
A：所見から直接書き始め、前回からの変化を含め、臨床判断で締める。前置き不要
P：今後のケア方針を3〜5文。「〜していく」「〜を継続する」で統一

# 出力長さ
入力メモの情報量に見合った長さで出力する。下記Few-shot例の長さに引きずられない（Beforeが豊富だったので長文になっただけ）。
${SOAP_FEWSHOT_EXAMPLES}`;

  // --- userプロンプト（入力データのみ） ---
  // 過去記録は「文体の手本」として明確にラベリング
  const prevStyleSection = allPrevRecords.length > 0
    ? "【文体の手本（文末表現・文の長さを揃える。ただし医療用語の表記は補正リスト優先）】\n" +
      allPrevRecords.map((r: { visitDate?: string; S: string; O: string; A: string; P: string }, i: number) =>
        `[${i === 0 ? "前回" : i === 1 ? "前々回" : "3回前"}${r.visitDate ? `（${r.visitDate}）` : ""}]\nS: ${r.S}\nO: ${r.O}\nA: ${r.A}\nP: ${r.P}`
      ).join("\n\n") + "\n\n"
    : "";

  // 前回Pからの継続事項を明示的に抽出してAIに渡す
  const prevPlanSection = allPrevRecords.length > 0 && allPrevRecords[0].P
    ? `【前回プランの継続事項（今回のA・Pに反映すること）】\n${allPrevRecords[0].P}\n\n`
    : "";

  const prompt = hasSInput
    ? `${activeNursingCarePlanSection}${prevStyleSection}${prevPlanSection}${carePlanSection}${alertAnswersSection}${answersSection}【S情報（看護師入力済み・誤変換のみ補正してそのまま返す）】
${sInput}

【今回の訪問メモ（これをO・A・Pに変換する）】
${rawInput}`

    : `${activeNursingCarePlanSection}${prevStyleSection}${prevPlanSection}${carePlanSection}${alertAnswersSection}${answersSection}【今回の訪問メモ（これをS・O・A・Pに変換する）】
${rawInput}`;

  // Tool use でJSON形式を強制。
  // Phase B 改修：tool description はフィールド名+型+1行説明のみに簡素化。
  // 詳細指示は systemPrompt に集約し、重複を排除（落とし穴8 対応）。
  const soapTool = {
    name: "output_soap",
    description: "訪問看護のSOAP記録を構造化して返す。",
    input_schema: {
      type: "object" as const,
      properties: {
        extracted_facts: {
          type: "array",
          items: { type: "string" },
          description: "事実の箇条書き。1事実1要素。各要素末尾に由来タグ [メモ]/[S情報]/[AI回答]/[継続確認回答] を付ける",
        },
        coverage_check: {
          type: "string",
          description: "各事実の反映先メモ（S/O/A/P のどこに入れたか）",
        },
        S: { type: "string" },
        O: { type: "string" },
        A: { type: "string" },
        P: { type: "string" },
      },
      required: ["extracted_facts", "coverage_check", "S", "O", "A", "P"],
    },
  };

  try {
    const response = await generateAiResponse(prompt, systemPrompt, {
      temperature: 0.2,
      tool: soapTool,
      // extracted_facts / coverage_check の分だけ余裕を持たせる
      maxTokens: 6144,
    });

    if (!response.toolInput) {
      return NextResponse.json({ error: "AIの応答を解析できませんでした。もう一度お試しください。" }, { status: 500 });
    }

    // 内部確認用フィールドは返さず、S/O/A/P のみ返す
    const { S, O, A, P } = response.toolInput as { S: string; O: string; A: string; P: string };
    return NextResponse.json({ S, O, A, P });
  } catch (e) {
    console.error(e);
    const errorMessage = e instanceof Error ? e.message : "AI変換中にエラーが発生しました。";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
