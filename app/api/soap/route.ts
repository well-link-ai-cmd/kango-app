import { NextRequest, NextResponse } from "next/server";
import { generateAiResponse } from "@/lib/ai-client";
import { aiErrorResponse } from "@/lib/ai-error-response";
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
        // issues は NANDA形式 / freeform形式が混在し得る（migration 007 Phase 8 以降）
        // - NANDA: { no, format:'nanda', diagnosis_label, op[], tp[], ep[] }
        // - freeform: { no, issue } （format フィールドがない既存データもこちら扱い）
        const issues = (plan.issues as Array<Record<string, unknown>> | null) ?? [];
        const issuesText = issues.length > 0
          ? issues.map((i) => formatPlanIssue(i)).join("\n")
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

  // 過去の訪問記録（アプリ内の構造化記録のみ。文体手本＋前回P継続に使用）
  const allPrevRecords = (previousRecords ?? []).slice(0, 3);

  // 基礎情報の導入時SOAP（カイポケ等からの貼り付け生テキスト）：医療用語・言い回し・経過の参考のみ（judgment-only）。
  // SOAP構造の抽出元・S欄の流用元にはしない。
  const initialReferenceSection = initialSoapRecords && initialSoapRecords.length > 0
    ? "\n【過去記録の参考（導入時に貼り付けた記録。医療用語・言い回し・経過の参考に留める。ここから今回のSOAPの事実やS欄を抽出しない）】\n" +
      (initialSoapRecords as { text: string; visitDate?: string }[])
        .map((r, i) => `[参考${i + 1}${r.visitDate ? `（${r.visitDate}）` : ""}]\n${r.text}`)
        .join("\n\n") + "\n"
    : "";

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
  //   - alertAnswers / answersSection ラベルを「O/A/P に反映。S 欄には入れない」に明確化
  //   - S 厳格ルールに [AI回答][継続確認回答] 本文の S 流入禁止を追記
  // NOTE: tests/prompts/soap/run.ts と完全同期すること。promptHash 不整合防止
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
- 【過去記録】：文体の手本と、今日の事実に対する「前回からの変化」の判断材料。今日の入力（メモ・S情報・回答）に対応する事実がない項目のアセスメント・計画を過去記録から持ち込まない（未実施項目の継続確認は確認質問機能が担う）
- 【ケアプラン（旧欄）】：看護計画書がない場合のみ補助参照

参照優先順位：看護計画書（確定版） > 過去記録・メモ > 旧ケアプラン欄

# S（主観情報）出力欄の厳格ルール
S 欄は専用UI入力欄【S情報】の内容のみで構成する：
1. 【S情報】が提供されている場合：その内容を一字一句変えずに S に反映する（誤変換補正のみ。要約・簡略化・言い換え・語尾変更・方言の標準語化・発言の統合は一切しない）
   - 【S情報】内に複数の話者（「S:」=本人、「妻S:」「娘S:」「夫S:」等）がある場合、各話者を区別したまま全員分を S に保持する。家族の発言を省略したり本人の発言と統合したりしてはならない
   - 話者ラベルは読みやすく整えてよい（「妻S:」→「妻：」等）。ただし発言内容そのものは変えない
2. 【S情報】がない場合：S は必ず空文字列 ""。以下から S 欄を作ってはならない：
   - 訪問メモの「〜と言った」「〜と発言」「『…』」等の引用や発言らしき表現（本人・家族とも）
   - 過去記録の S 欄
   - 【AIからの確認質問への回答】【前回からの継続確認事項への回答】の本文（これらは O/A/P 専用）
   - 「特になし」「変わりなし」等のプレースホルダ
※ 訪問メモ内に出てくる本人・家族の発言は S に入れず、O に「本人より〜との訴えあり」「家族より〜との報告あり」と客観記載する。S に残したい発言は S情報欄に入力する運用とする
※ S情報（本人・家族の発言）を A/P の臨床判断材料に使うことは妨げない
- corrected_s_input フィールドには【S情報】の全文を、誤変換・明白な誤字の補正のみ行って入れる。補正は語単位の置き換えに限る（医療用語の誤変換と、文脈上明白な誤字・脱字が対象）。方言・話し言葉・語尾・句読点・話者ラベルは一字一句そのまま保持する（例：「痛うて」を「痛くて」に直すのは補正ではなく改変であり禁止）。削除・要約・簡略化はしない。【S情報】がなければ ""。S欄の最終内容はシステム側が決定するため、ここで書き換えてはならない

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
- 外装/外相→咳嗽（呼吸器症状文脈）
- 常用→上葉（呼吸器・肺野文脈。中葉・下葉も同音漢字から補正）
- 複雑音/服雑音→副雑音（呼吸音の「ふくざつおん」）
- 緊満感は必ず「緊満感」（緊張感・近満感・筋満感は誤り。腹部・乳房の張り）
- 「こうい」は衣服の着替え文脈では「更衣」
- 「せんぱつ」「先発」は「洗髪」
- 「ちょめい/ちょうめい」は医療文脈では「著明」（著明な浮腫・著明な改善）
- 併願→閉眼（目を閉じる・覚醒/意識レベル文脈）
- 肉毛→肉芽（創部・褥瘡・治癒過程文脈）
- 色/慰労/要ろう→胃瘻（経管栄養・腹部の造設口文脈）
- 関節痛は「関節の痛み」
- 医療文脈で意味が通らない漢字は、同音の医療用語に置き換える

# 各項目の書き方（O/A/P の役割を厳密に分ける）
S：上記Sルールに従う。【S情報】があれば話者を区別してそのまま（誤変換補正のみ）。なければ ""
O（客観的事実のみ）：観察した事実・測定値・実施したケアだけを書く。場面描写から時系列で。看護師の判断・解釈・推測（「〜と考える」「〜と思われる」「〜が必要」）は書かず A に回す。文末は「〜あり」「〜なし」「〜を実施」「〜であった」等の事実描写。AI回答・継続確認回答の客観情報もここに。次回訪問予定は末尾
A（看護師の評価・解釈）：今日の入力（メモ・S情報・回答）に根拠がある事実に対するアセスメントだけを書く。今日観察・実施していない項目の評価を過去記録から持ち込まない。事実の単純な再掲はしない。前回からの変化・臨床的な意味づけ・リスク評価を述べる。「全身状態は安定」等の総括的な評価を書く場合は、根拠となる今日の事実を同じ文に添える（根拠を示せない総括は書かない）。文末は「〜と考えられる」「〜と思われる」「〜の状態である」「〜が必要と考える」等の評価表現。今後の具体的行動（「〜していく」）は書かず P に回す
P（今後の計画・方針）：今日の事実・A の評価に対応する計画だけを書く。今日の入力に対応する事実がない前回プラン項目は書かない。「継続」「観察」「確認」の一語で終わらせず、何を観察・実施するかを必ず書く（「観察継続」ではなく「仙骨部の発赤と滲出液の有無を観察していく」）。文末は「〜していく」「〜を継続する」「〜を観察していく」「〜を検討する」で統一。評価・解釈（A の内容）は書かない。S情報や A で挙げた課題に対応する計画を必ず含める（例：S情報で疼痛増悪 → P でレスキュー使用検討・主治医相談・再評価）

# 出力長さ
入力メモの情報量に見合った長さで出力する。下記Few-shot例の長さに引きずられない（Beforeが豊富だったので長文になっただけ）。A・P は今日の事実に対応する分だけでよく、短くなって構わない（関係のない項目を足して長くしない）。
${SOAP_FEWSHOT_EXAMPLES}`;

  // --- userプロンプト（入力データのみ） ---
  // 過去記録は「文体の手本」として明確にラベリング
  const prevStyleSection = allPrevRecords.length > 0
    ? "【文体の手本（文末表現・文の長さを揃える。ただし医療用語の表記は補正リスト優先）】\n" +
      allPrevRecords.map((r: { visitDate?: string; S: string; O: string; A: string; P: string }, i: number) =>
        `[${i === 0 ? "前回" : i === 1 ? "前々回" : "3回前"}${r.visitDate ? `（${r.visitDate}）` : ""}]\nS: ${r.S}\nO: ${r.O}\nA: ${r.A}\nP: ${r.P}`
      ).join("\n\n") + "\n\n"
    : "";

  // 前回Pは「参考」として渡す（今日の入力に対応する事実がある項目のみ言及。全反映はさせない）
  const prevPlanSection = allPrevRecords.length > 0 && allPrevRecords[0].P
    ? `【前回プラン（参考）。今日のメモ・S情報・回答に対応する事実がある項目のみ A・P で言及し、対応する事実がない項目は A・P に書かない（未実施項目の継続確認は確認質問機能が担う）】\n${allPrevRecords[0].P}\n\n`
    : "";

  const prompt = hasSInput
    ? `${activeNursingCarePlanSection}${prevStyleSection}${prevPlanSection}${carePlanSection}${initialReferenceSection}${alertAnswersSection}${answersSection}【S情報（看護師入力済み・誤変換のみ補正してそのまま返す）】
${sInput}

【今回の訪問メモ（これをO・A・Pに変換する）】
${rawInput}`

    : `${activeNursingCarePlanSection}${prevStyleSection}${prevPlanSection}${carePlanSection}${initialReferenceSection}${alertAnswersSection}${answersSection}【今回の訪問メモ（これをS・O・A・Pに変換する）】
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
        corrected_s_input: {
          type: "string",
          description: "【S情報】がある場合のみ、その全文を医療用語の誤変換だけ補正して返す。削除・要約・簡略化・語尾変更・話者ラベルの除去は一切せず文字数をほぼ変えない。【S情報】がなければ空文字列",
        },
        S: { type: "string" },
        O: { type: "string" },
        A: { type: "string" },
        P: { type: "string" },
      },
      required: ["extracted_facts", "coverage_check", "corrected_s_input", "S", "O", "A", "P"],
    },
  };

  try {
    const response = await generateAiResponse(prompt, systemPrompt, {
      temperature: 0.2,
      tool: soapTool,
      // extracted_facts / coverage_check の分だけ余裕を持たせる
      maxTokens: 6144,
      // 固定 systemプロンプト（指示＋Few-shot 約13,000トークン）を1時間TTLでキャッシュし入力単価を1/10に。
      // 朝のまとめ書きで複数件・複数スタッフが近接時間に走るためヒット率が見込める（systemは患者非依存の完全固定）。
      cacheSystemTtl: "1h",
    });

    if (!response.toolInput) {
      return NextResponse.json({ error: "AIの応答を解析できませんでした。もう一度お試しください。" }, { status: 500 });
    }

    // 内部確認用フィールドは返さず、S/O/A/P のみ返す
    const ti = response.toolInput as { S: string; O: string; A: string; P: string; corrected_s_input?: string };
    const { O, A, P } = ti;
    // S は LLM の自由生成に任せず、看護師入力の【S情報】を機械的に採用する（簡略化・話者ラベル落ち防止）。
    // 誤変換補正版（corrected_s_input）は「語単位の誤字補正」の範囲でのみ採用し、
    // 簡略化・言い換え（文字差分が大きい）が疑われる場合は生の S情報をそのまま使ってデータ欠落・改変を防ぐ。
    let S = "";
    if (hasSInput) {
      const raw = (sInput as string).trim();
      const corrected = (ti.corrected_s_input ?? "").trim();
      // 補正版を採用する条件：
      // (1) 簡略化されていない（元の8割以上の長さ）
      // (2) 話者ラベル（S:/妻S:/娘S: 等）が入力と完全一致している
      // (3) 文字差分率が2割以下（誤字の語単位置換なら小さい。言い換え・書き直しなら大きくなる）
      // どれか崩れていれば、補正より「入力どおりのS（ラベル・内容の完全保持）」を優先して生のS情報を使う。
      const rawLabels = extractSLabels(raw);
      const corLabels = extractSLabels(corrected);
      const labelsPreserved =
        rawLabels.length === corLabels.length && rawLabels.every((l, i) => l === corLabels[i]);
      const diffOk = editDistance(raw, corrected) <= Math.max(8, Math.round(raw.length * 0.2));
      S = corrected.length >= raw.length * 0.8 && labelsPreserved && diffOk ? corrected : raw;
    }
    return NextResponse.json({ S, O, A, P });
  } catch (e) {
    return aiErrorResponse(e);
  }
}

/** レーベンシュタイン距離（文字単位）。S補正版が「語の置換」の範囲か「書き直し」かの判定に使う */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/** S情報テキストから行頭の話者ラベル（S: / 妻S: / 娘S: 等）を順に抽出する */
function extractSLabels(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.match(/^\s*(.{0,6}?S)[:：]/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => m[1].trim());
}

/**
 * 看護計画書の issue（JSONB の1要素）を SOAP プロンプト注入用テキストに整形。
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
  // freeform（format 未指定の既存データもこちら）
  const issue = (raw.issue as string) ?? "";
  return `  ${no}. ${issue}`;
}
