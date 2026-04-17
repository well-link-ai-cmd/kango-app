import { NextRequest, NextResponse } from "next/server";
import { generateAiResponse } from "@/lib/ai-client";
import { getAuthUser } from "@/lib/supabase-server";

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const body = await req.json();
  const { sInput, rawInput, carePlan, previousRecords, alertAnswers, questionAnswers, initialSoapRecords } = body;

  if (!rawInput?.trim()) {
    return NextResponse.json({ error: "訪問内容が入力されていません" }, { status: 400 });
  }

  // ケアプラン
  const carePlanSection = carePlan
    ? `\n【ケアプラン・担当者会議の方針】\n${carePlan}\n`
    : "";

  // 過去の訪問記録（アプリ内の記録 + 初期インポート記録を統合）
  const allPrevRecords = [
    ...(previousRecords ?? []),
    ...(initialSoapRecords ?? []),
  ].slice(0, 3);

  // 継続確認アラートへの回答（メモの記載漏れを補う事実 → 必ずSOAPに反映）
  const alertAnswersSection = alertAnswers && alertAnswers.length > 0
    ? "\n【前回からの継続確認事項への回答（今回の事実として必ずSOAPに反映）】\n" +
      alertAnswers
        .filter((qa: { question: string; answer: string }) => qa.answer.trim())
        .map((qa: { question: string; answer: string }) => `継続確認: ${qa.question}\n回答: ${qa.answer}`)
        .join("\n") + "\n"
    : "";

  // 確認質問への回答（メモの記載漏れを補う事実 → 必ずSOAPに反映）
  const answersSection = questionAnswers && questionAnswers.length > 0
    ? "\n【AIからの確認質問への回答（今回の事実として必ずSOAPに反映）】\n" +
      questionAnswers
        .filter((qa: { question: string; answer: string }) => qa.answer.trim())
        .map((qa: { question: string; answer: string }) => `Q: ${qa.question}\nA: ${qa.answer}`)
        .join("\n") + "\n"
    : "";

  // S情報が個別入力されている場合は、SはパススルーしてOAPのみ生成
  const hasSInput = sInput?.trim();

  // --- systemプロンプト（ロール定義・ルール・出力形式） ---
  // Haikuが確実に守れるよう、最重要ルールを短く明確に記述
  const systemPrompt = `あなたは訪問看護記録のSOAP作成AIである。看護師の話し言葉メモをSOAP形式に変換する。

# 事実ソース（すべて同等に扱う）
以下を「今回訪問の事実」として全て扱い、抽出・反映の対象とする：
- 【今回の訪問メモ】
- 【S情報】（提供されている場合）
- 【AIからの確認質問への回答】（提供されている場合）
- 【前回からの継続確認事項への回答】（提供されている場合）

特に重要：AI確認質問・継続確認への回答は「メモに記載漏れがあった事実を看護師が後から補足したもの」である。
空欄でなければ必ず S/O/A/P の適切な箇所に反映すること。回答を無視してはならない。

# 作業手順（必ず順番に実行）
1. extracted_facts：上記の全事実ソースから事実を1つ残らず抽出する（発言・観察・処置・時刻マーカー・次回予定など）。各事実の末尾に由来タグを付ける：[メモ] / [S情報] / [AI回答] / [継続確認回答]
2. coverage_check：抽出した各事実を S/O/A/P のどこに反映するかを1行ずつ確認する。[AI回答] [継続確認回答] タグの項目が SOAP 本文に含まれているかを特に厳しくチェックする
3. S・O・A・P：coverage_checkに従って記述する。extracted_factsにある事実は全て反映する

# 文体ルール（必ず守ること）
- 過去記録が提供されている場合、その文末表現・文の長さ・用語の書き方に合わせる
  - 過去記録が「〜みられる」なら「〜みられる」、「〜である」なら「〜である」を使う
  - 過去記録が短文なら短文、長文なら長文にする
- 過去記録がない場合は「〜みられる」「〜である」調の標準的な看護記録文体で書く
- 見出し（【】）・箇条書き（・や-）・番号リストは使わない。自然な文章で書く
- 事実ソース（メモ・S情報・各種回答）にない事実を創作しない

# 医療用語の補正（必ず実行）
音声入力では同音異義語の誤変換が頻発する。文脈から正しい医療用語に直すこと。
よくある誤変換：
- 朝蠕動音→腸蠕動音、超蠕動音→腸蠕動音（「ちょう」は「腸」）
- けつあつ→血圧、じょくそう→褥瘡、さんそ→酸素
- ばいたる→バイタル、えすぴーおーつー→SpO2
- 服部→腹部、配便→排便、官庁→浣腸、感聴→浣腸
- 円下→嚥下、角痰→喀痰、不種→浮腫、付種→浮腫
- 辱層→褥瘡、関節痛→間接的ではなく関節の痛み
- 複雑音→副雑音（呼吸音の「ふくざつおん」は必ず「副雑音」）
- 緊満感は必ず「緊満感」（緊張感・近満感・筋満感などは誤り。腹部・乳房の張りを指す）
- 「こうい」は衣服の着替え文脈では必ず「更衣」（行為・好意・合意などは誤り）
- 「せんぱつ」は必ず「洗髪」（先発・선발などは誤り）
- 「ちょめい」「ちょうめい」は医療文脈では必ず「著明」（著名・調名などは誤り。例：著明な浮腫、著明な改善）
- 医療文脈で意味が通らない漢字は、同音の医療用語に置き換える

# 各項目の書き方
S：利用者本人の言葉をそのまま書く。方言・口語を残す。間接話法（〜とのこと）にしない。家族発言は「妻S：」と分ける。
O：場面描写から始め、時系列で書く。バイタル・処置・観察所見を具体的に。次回訪問予定があれば末尾に書く。
A：所見から直接書き始め→臨床判断で締める。「〜に関しては」等の前置き不要。前回からの変化を含める。
P：今後のケア方針を3〜5文で書く。「〜していく」「〜を継続する」で統一。`;

  // --- userプロンプト（入力データのみ） ---
  // 過去記録は「文体の手本」として明確にラベリング
  const prevStyleSection = allPrevRecords.length > 0
    ? "【文体の手本（この記録と同じ文末表現・文の長さ・用語で書くこと）】\n" +
      allPrevRecords.map((r: { visitDate?: string; S: string; O: string; A: string; P: string }, i: number) =>
        `[${i === 0 ? "前回" : i === 1 ? "前々回" : "3回前"}${r.visitDate ? `（${r.visitDate}）` : ""}]\nS: ${r.S}\nO: ${r.O}\nA: ${r.A}\nP: ${r.P}`
      ).join("\n\n") + "\n\n"
    : "";

  // 前回Pからの継続事項を明示的に抽出してAIに渡す
  const prevPlanSection = allPrevRecords.length > 0 && allPrevRecords[0].P
    ? `【前回プランの継続事項（今回のA・Pに反映すること）】\n${allPrevRecords[0].P}\n\n`
    : "";

  const prompt = hasSInput
    ? `${prevStyleSection}${prevPlanSection}${carePlanSection}${alertAnswersSection}${answersSection}【S情報（看護師入力済み・誤変換のみ補正してそのまま返す）】
${sInput}

【今回の訪問メモ（これをO・A・Pに変換する）】
${rawInput}`

    : `${prevStyleSection}${prevPlanSection}${carePlanSection}${alertAnswersSection}${answersSection}【今回の訪問メモ（これをS・O・A・Pに変換する）】
${rawInput}`;

  // Tool use でJSON形式を強制。
  // extracted_facts と coverage_check を先に埋めさせることで、
  // Haikuに「抽出→反映チェック→SOAP記述」の順序を強制する（抜け漏れ対策）
  const soapTool = {
    name: "output_soap",
    description: "訪問看護記録をSOAP形式で出力する。必ず extracted_facts → coverage_check → S/O/A/P の順で全項目を埋めること。",
    input_schema: {
      type: "object" as const,
      properties: {
        extracted_facts: {
          type: "array",
          items: { type: "string" },
          description: "事実ソース（今回の訪問メモ・S情報・AI確認質問への回答・継続確認への回答）から抽出した全事実を箇条書きで列挙。各項目の末尾に由来タグを付ける：[メモ] / [S情報] / [AI回答] / [継続確認回答]。例：『右下腿浮腫2+ [メモ]』『排便昨日1回 [AI回答]』。内部確認用。",
        },
        coverage_check: {
          type: "string",
          description: "extracted_facts の各項目を S/O/A/P のどこに反映したかを1行ずつ列挙。特に [AI回答] [継続確認回答] タグの項目が必ず SOAP 本文に含まれているかを厳しくチェックする。例：『発言「膝が痛い」[メモ]→S』『排便昨日1回 [AI回答]→O』。内部確認用。",
        },
        S: { type: "string", description: "利用者本人の言葉（主観情報）。方言・口語をそのまま残す。家族発言は「妻S：」と分ける" },
        O: { type: "string", description: "客観情報。訪問時→バイタル→観察→処置→退室時/次回予定の時系列順。見出しは書かず自然な文章で" },
        A: { type: "string", description: "アセスメント。所見から直接書き始め、前回からの変化を含め、臨床判断で締める。前置き不要" },
        P: { type: "string", description: "今後のケア方針。3〜5文。「〜していく」「〜を継続する」で統一" },
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
