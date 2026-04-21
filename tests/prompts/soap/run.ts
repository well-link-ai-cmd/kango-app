/**
 * SOAP / questions プロンプトの挙動確認ランナー
 *
 * 使い方:
 *   ANTHROPIC_API_KEY=xxx npx tsx tests/prompts/soap/run.ts soap all
 *   ANTHROPIC_API_KEY=xxx npx tsx tests/prompts/soap/run.ts soap case-02-rambling
 *   ANTHROPIC_API_KEY=xxx npx tsx tests/prompts/soap/run.ts questions all
 *   ANTHROPIC_API_KEY=xxx npx tsx tests/prompts/soap/run.ts all all
 *
 * .env.local に ANTHROPIC_API_KEY があれば自動で読み込むので上記プレフィックス不要。
 *
 * NOTE: プロンプト組み立てロジックは app/api/soap/route.ts と
 *       app/api/soap/questions/route.ts からコピーしたもの。
 *       ルート側を変更したらここも同期すること。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateAiResponse } from "../../../lib/ai-client";
import { SOAP_FEWSHOT_EXAMPLES } from "../../../lib/soap-fewshot";

// -------- .env.local 簡易ローダー（dotenv 依存を避けるため自前） --------
function loadDotenv(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf-8");
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

// -------- 型定義 --------
interface PrevRecord {
  visitDate?: string;
  S: string;
  O: string;
  A: string;
  P: string;
}
interface CaseInput {
  rawInput: string;
  sInput?: string;
  carePlan?: string;
  previousRecords?: PrevRecord[];
  initialSoapRecords?: PrevRecord[];
  nursingContentItems?: string[];
  alertAnswers?: { question: string; answer: string }[];
  questionAnswers?: { question: string; answer: string }[];
}
interface TestCase {
  id: string;
  description: string;
  input: CaseInput;
  expectations?: Record<string, unknown>;
}

// -------- SOAP プロンプト構築（app/api/soap/route.ts をミラー） --------
function buildSoapRequest(input: CaseInput) {
  const { sInput, rawInput, carePlan, previousRecords, alertAnswers, questionAnswers, initialSoapRecords } = input;

  // NOTE: テストハーネスでは看護計画書の参照は行わない（実DBアクセスを避けるため）
  // 本番（app/api/soap/route.ts）では patientId から nursing_care_plans を取得して最優先コンテキストとして注入する
  const carePlanSection = carePlan ? `\n【ケアプラン・担当者会議の方針（旧欄・過渡期参照）】\n${carePlan}\n` : "";
  const allPrevRecords = [...(previousRecords ?? []), ...(initialSoapRecords ?? [])].slice(0, 3);

  const alertAnswersSection = alertAnswers && alertAnswers.length > 0
    ? "\n【前回からの継続確認事項への回答（今回の事実として必ずSOAPに反映）】\n" +
      alertAnswers
        .filter((qa) => qa.answer.trim())
        .map((qa) => `継続確認: ${qa.question}\n回答: ${qa.answer}`)
        .join("\n") + "\n"
    : "";

  const answersSection = questionAnswers && questionAnswers.length > 0
    ? "\n【AIからの確認質問への回答（今回の事実として必ずSOAPに反映）】\n" +
      questionAnswers
        .filter((qa) => qa.answer.trim())
        .map((qa) => `Q: ${qa.question}\nA: ${qa.answer}`)
        .join("\n") + "\n"
    : "";

  const hasSInput = sInput?.trim();

  const systemPrompt = `あなたは訪問看護記録のSOAP作成AIである。看護師の話し言葉メモをSOAP形式に変換する。

# 事実ソース（各項目の「出力材料」と「判断材料」の区別が重要）
- 【看護計画書（確定版）】（提供されている場合）：**最優先のコンテキスト**。目標・療養上の課題を A・P の判断材料として必ず考慮する
- 【今回の訪問メモ】：O への直接記載、および A・P の判断材料
- 【S情報】（提供されている場合）：S への passthrough、および A・P の判断材料（本人の訴え・感情・要望として臨床判断に必ず反映）
- 【AIからの確認質問への回答】（提供されている場合）：O への直接記載、および A・P の判断材料
- 【前回からの継続確認事項への回答】（提供されている場合）：O への直接記載、および A・P の判断材料
- 【過去記録】：文体・継続事項の参考。A では前回からの変化を、P では継続/変更の判断材料として使う
- 【ケアプラン・担当者会議の方針（旧欄・過渡期参照）】（提供されている場合）：看護計画書が未作成の場合のみ補助参照

参照優先順位：看護計画書（確定版） > 過去記録・メモ > 旧ケアプラン欄（フォールバック）

特に重要：
- AI確認質問・継続確認への回答は「メモに記載漏れがあった事実を看護師が後から補足したもの」である。空欄でなければ必ず O/A/P の適切な箇所に反映すること。回答を無視してはならない
- 【S情報】は S にそのまま反映するだけでなく、A・P の作成時にも「本人の主観」として必ず考慮する。例：S情報に「痛みが増してきた」とあれば A で疼痛増悪を評価し、P でレスキュー使用や主治医相談を検討する

# S（主観情報）出力欄の厳格ルール
Sの出力欄そのものは看護師の明示入力のみで構成する（UIに専用入力欄がある）：
1. 【S情報】が提供されている場合：その内容をそのまま S に反映する。医療用語の誤変換のみ補正する。言い換え・要約・編集は一切しない
2. 【S情報】が提供されていない（空・未指定）場合：Sは空文字列 "" にする。訪問メモの発言らしき表現、過去記録のS、家族発言など、どのソースからも S 欄への文章生成はしない

禁止事項（S出力欄に関して）：
- 訪問メモの「〜と言った」「〜と発言」等から S 欄の文章を作らない
- 過去記録の S を今回のS欄に流用しない
- メモ中の家族発言を S 欄に入れない
- 「特になし」「変わりなし」等のプレースホルダを勝手に埋めない

※ただし上記は S 出力欄への記載ルールであり、【S情報】の内容を A/P の判断で使うこと自体は歓迎される

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

# 医療用語の補正（全段階で必ず実行）
音声入力では同音異義語の誤変換が頻発する。extracted_facts の抽出段階・coverage_check・最終 S/O/A/P の全段階で、文脈から正しい医療用語に直すこと。extracted_facts にも補正済みの用語で書く（例：「配便は昨日あり」ではなく「排便は昨日あり」と抽出する）。
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
S：【S情報】が提供されていればその内容をそのまま（誤変換補正のみ）。【S情報】がなければ空文字列 ""。訪問メモや過去記録からは絶対に引き出さない
O：場面描写から始め、時系列で書く。バイタル・処置・観察所見を具体的に。AI回答・継続確認回答の客観情報もここに入れる。次回訪問予定があれば末尾に書く。
A：所見から直接書き始め→臨床判断で締める。「〜に関しては」等の前置き不要。前回からの変化を含める。
P：今後のケア方針を3〜5文で書く。「〜していく」「〜を継続する」で統一。

# 出力長さの原則
入力メモの情報量に見合った長さで出力する。入力が短ければ出力も短く、入力が詳細なら出力も詳細に。下記Few-shot例のAfterが長文なのは、元のBeforeが豊富な情報を含んでいたためであり、長さを真似する必要はない。
${SOAP_FEWSHOT_EXAMPLES}`;

  const prevStyleSection = allPrevRecords.length > 0
    ? "【文体の手本（この記録と同じ文末表現・文の長さ・用語で書くこと）】\n" +
      allPrevRecords.map((r, i) =>
        `[${i === 0 ? "前回" : i === 1 ? "前々回" : "3回前"}${r.visitDate ? `（${r.visitDate}）` : ""}]\nS: ${r.S}\nO: ${r.O}\nA: ${r.A}\nP: ${r.P}`
      ).join("\n\n") + "\n\n"
    : "";

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

  const soapTool = {
    name: "output_soap",
    description: "訪問看護記録をSOAP形式で出力する。必ず extracted_facts → coverage_check → S/O/A/P の順で全項目を埋めること。",
    input_schema: {
      type: "object" as const,
      properties: {
        extracted_facts: {
          type: "array",
          items: { type: "string" },
          description: "事実ソース（今回の訪問メモ・S情報・AI確認質問への回答・継続確認への回答）から抽出した全事実を箇条書きで列挙。各項目の末尾に由来タグ [メモ] / [S情報] / [AI回答] / [継続確認回答] を付ける。内部確認用。",
        },
        coverage_check: {
          type: "string",
          description: "extracted_facts の各項目を S/O/A/P のどこに反映したかを1行ずつ列挙。[AI回答] [継続確認回答] タグの項目が必ず SOAP 本文に含まれているかを厳しくチェックする。内部確認用。",
        },
        S: { type: "string" },
        O: { type: "string" },
        A: { type: "string" },
        P: { type: "string" },
      },
      required: ["extracted_facts", "coverage_check", "S", "O", "A", "P"],
    },
  };

  return { prompt, systemPrompt, soapTool };
}

// -------- questions プロンプト構築（app/api/soap/questions/route.ts をミラー） --------
function buildQuestionsRequest(input: CaseInput) {
  const { sInput, rawInput, previousRecords, carePlan, nursingContentItems, initialSoapRecords } = input;

  const allRecords = [...(previousRecords ?? []), ...(initialSoapRecords ?? [])].slice(0, 3);

  if (allRecords.length === 0) return null;

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

  const prompt = `${carePlan ? `【ケアプラン】\n${carePlan}\n\n` : ""}${nursingContentItems && nursingContentItems.length > 0 ? `【登録済みケア内容】\n${nursingContentItems.map((item) => `・${item}`).join("\n")}\n\n` : ""}${prevText}

${sInput?.trim() ? `【今回のS情報】\n${sInput}\n\n` : ""}【今回の訪問メモ】
${rawInput}`;

  const questionsTool = {
    name: "output_gap_check",
    description: "今日のメモを2軸で点検する。(A) 過去記録・ケアプラン・登録ケア内容との差分 → alerts、(B) メモ内の曖昧点 → questions。必ず memo_covers → expected_from_context → gaps → memo_ambiguities → alerts/questions の順で埋めること。",
    input_schema: {
      type: "object" as const,
      properties: {
        memo_covers: { type: "array", items: { type: "string" } },
        expected_from_context: { type: "array", items: { type: "string" } },
        gaps: { type: "array", items: { type: "string" } },
        memo_ambiguities: { type: "array", items: { type: "string" } },
        alerts: { type: "array", items: { type: "string" } },
        questions: { type: "array", items: { type: "string" } },
      },
      required: ["memo_covers", "expected_from_context", "gaps", "memo_ambiguities", "alerts", "questions"],
    },
  };

  return { prompt, systemPrompt, questionsTool };
}

// -------- 実行 --------
function printHeader(text: string) {
  const line = "=".repeat(Math.max(60, text.length + 4));
  console.log(`\n${line}\n  ${text}\n${line}`);
}

function printSection(label: string, body: unknown) {
  console.log(`\n--- ${label} ---`);
  if (typeof body === "string") console.log(body);
  else console.log(JSON.stringify(body, null, 2));
}

async function runSoap(tc: TestCase) {
  printHeader(`[SOAP] ${tc.id}: ${tc.description}`);
  printSection("入力メモ", tc.input.rawInput);

  const { prompt, systemPrompt, soapTool } = buildSoapRequest(tc.input);
  const started = Date.now();
  const response = await generateAiResponse(prompt, systemPrompt, {
    temperature: 0.2,
    tool: soapTool,
    maxTokens: 6144,
  });
  const elapsed = Date.now() - started;

  if (!response.toolInput) {
    console.log("\n❌ tool_use が返ってこなかった");
    console.log("text:", response.text);
    return;
  }
  const r = response.toolInput as {
    extracted_facts?: string[];
    coverage_check?: string;
    S: string;
    O: string;
    A: string;
    P: string;
  };

  printSection("抽出（内部）", r.extracted_facts ?? []);
  printSection("反映チェック（内部）", r.coverage_check ?? "");
  printSection("S", r.S);
  printSection("O", r.O);
  printSection("A", r.A);
  printSection("P", r.P);
  if (tc.expectations?.soap) printSection("期待する挙動", tc.expectations.soap);
  console.log(`\n(${elapsed}ms)`);
}

async function runQuestions(tc: TestCase) {
  printHeader(`[QUESTIONS] ${tc.id}: ${tc.description}`);
  printSection("入力メモ", tc.input.rawInput);

  const built = buildQuestionsRequest(tc.input);
  if (!built) {
    console.log("\n(過去記録なしのためスキップ)");
    return;
  }
  const { prompt, systemPrompt, questionsTool } = built;
  const started = Date.now();
  const response = await generateAiResponse(prompt, systemPrompt, {
    temperature: 0.2,
    tool: questionsTool,
    maxTokens: 4096,
  });
  const elapsed = Date.now() - started;

  if (!response.toolInput) {
    console.log("\n❌ tool_use が返ってこなかった");
    console.log("text:", response.text);
    return;
  }
  const r = response.toolInput as {
    memo_covers?: string[];
    expected_from_context?: string[];
    gaps?: string[];
    memo_ambiguities?: string[];
    alerts?: string[];
    questions?: string[];
  };

  printSection("memo_covers（内部）", r.memo_covers ?? []);
  printSection("expected_from_context（内部）", r.expected_from_context ?? []);
  printSection("gaps（内部・alerts元）", r.gaps ?? []);
  printSection("memo_ambiguities（内部・questions元）", r.memo_ambiguities ?? []);
  printSection("alerts（ユーザー表示）", r.alerts ?? []);
  printSection("questions（ユーザー表示）", r.questions ?? []);
  if (tc.expectations?.questions) printSection("期待する挙動", tc.expectations.questions);
  console.log(`\n(${elapsed}ms)`);
}

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const projectRoot = path.resolve(__dirname, "../../..");

  loadDotenv(path.join(projectRoot, ".env.local"));
  loadDotenv(path.join(projectRoot, ".env"));

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY が見つかりません。.env.local に設定するか環境変数で渡してください。");
    process.exit(1);
  }

  const mode = (process.argv[2] ?? "all").toLowerCase(); // soap | questions | all
  const caseFilter = process.argv[3] ?? "all";           // case-id | all

  const casesPath = path.join(__dirname, "cases.json");
  const allCases = JSON.parse(fs.readFileSync(casesPath, "utf-8")) as TestCase[];
  const cases = caseFilter === "all" ? allCases : allCases.filter((c) => c.id === caseFilter);

  if (cases.length === 0) {
    console.error(`case-id「${caseFilter}」に該当するケースが無い。cases.jsonを確認。`);
    process.exit(1);
  }

  for (const tc of cases) {
    if (mode === "soap" || mode === "all") await runSoap(tc);
    if (mode === "questions" || mode === "all") await runQuestions(tc);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
