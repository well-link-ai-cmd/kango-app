/**
 * SOAP / questions プロンプトの挙動確認ランナー
 *
 * 使い方:
 *   ANTHROPIC_API_KEY=xxx npx tsx tests/prompts/soap/run.ts soap all
 *   ANTHROPIC_API_KEY=xxx npx tsx tests/prompts/soap/run.ts soap case-02-rambling
 *   ANTHROPIC_API_KEY=xxx npx tsx tests/prompts/soap/run.ts questions all
 *   ANTHROPIC_API_KEY=xxx npx tsx tests/prompts/soap/run.ts all all
 *
 *   # SOAP のモデル並走（H→S 順、ケースごと）
 *   MODEL=both npx tsx tests/prompts/soap/run.ts soap all
 *   MODEL=sonnet npx tsx tests/prompts/soap/run.ts soap all
 *
 *   # baseline スナップショット保存（A2 用）
 *   OUTPUT_JSON=tests/prompts/soap/baseline-2026-04-27.json \
 *     npx tsx tests/prompts/soap/run.ts soap all
 *
 * .env.local に ANTHROPIC_API_KEY があれば自動で読み込むので上記プレフィックス不要。
 *
 * NOTE: プロンプト組み立てロジックは app/api/soap/route.ts と
 *       app/api/soap/questions/route.ts からコピーしたもの。
 *       ルート側を変更したらここも同期すること。
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateAiResponse } from "../../../lib/ai-client";
import { SOAP_FEWSHOT_EXAMPLES } from "../../../lib/soap-fewshot";

type ModelKey = "haiku" | "sonnet";
type ModelMode = "haiku" | "sonnet" | "both";

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input, "utf-8").digest("hex");
}
function shortHash(input: string): string {
  return sha256Hex(input).slice(0, 8);
}

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
    ? "\n【前回からの継続確認事項への回答（今回の事実として必ず O/A/P に反映。S 欄には入れない）】\n" +
      alertAnswers
        .filter((qa) => qa.answer.trim())
        .map((qa) => `継続確認: ${qa.question}\n回答: ${qa.answer}`)
        .join("\n") + "\n"
    : "";

  const answersSection = questionAnswers && questionAnswers.length > 0
    ? "\n【AIからの確認質問への回答（今回の事実として必ず O/A/P に反映。S 欄には入れない）】\n" +
      questionAnswers
        .filter((qa) => qa.answer.trim())
        .map((qa) => `Q: ${qa.question}\nA: ${qa.answer}`)
        .join("\n") + "\n"
    : "";

  const hasSInput = sInput?.trim();

  // Phase B 改修（2026-04-27）: route.ts と同期。promptHash 不整合防止のため必ず route.ts と同じ内容を保つ。
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

  const prevStyleSection = allPrevRecords.length > 0
    ? "【文体の手本（文末表現・文の長さを揃える。ただし医療用語の表記は補正リスト優先）】\n" +
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

interface SoapToolOutput {
  extracted_facts?: string[];
  coverage_check?: string;
  S: string;
  O: string;
  A: string;
  P: string;
}
interface SoapRunResult {
  model: ModelKey;
  toolInput: SoapToolOutput | null;
  rawText: string;
  elapsedMs: number;
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number };
  outputChars: { extracted_facts: number; coverage_check: number; S: number; O: number; A: number; P: number };
}

function computeOutputChars(r: SoapToolOutput | null): SoapRunResult["outputChars"] {
  if (!r) return { extracted_facts: 0, coverage_check: 0, S: 0, O: 0, A: 0, P: 0 };
  return {
    extracted_facts: (r.extracted_facts ?? []).reduce((sum, s) => sum + s.length, 0),
    coverage_check: (r.coverage_check ?? "").length,
    S: (r.S ?? "").length,
    O: (r.O ?? "").length,
    A: (r.A ?? "").length,
    P: (r.P ?? "").length,
  };
}

async function callSoapOnce(
  prompt: string,
  systemPrompt: string,
  soapTool: ReturnType<typeof buildSoapRequest>["soapTool"],
  model: ModelKey
): Promise<SoapRunResult> {
  const started = Date.now();
  const response = await generateAiResponse(prompt, systemPrompt, {
    temperature: 0.2,
    tool: soapTool,
    maxTokens: 6144,
    model,
  });
  const elapsedMs = Date.now() - started;
  const toolInput = (response.toolInput as SoapToolOutput | undefined) ?? null;
  return {
    model,
    toolInput,
    rawText: response.text,
    elapsedMs,
    usage: response.usage ?? { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    outputChars: computeOutputChars(toolInput),
  };
}

function printSoapResult(result: SoapRunResult) {
  const tag = `[${result.model}]`;
  if (!result.toolInput) {
    console.log(`\n${tag} ❌ tool_use が返ってこなかった`);
    console.log(`${tag} text:`, result.rawText);
  } else {
    const r = result.toolInput;
    printSection(`${tag} 抽出（内部）`, r.extracted_facts ?? []);
    printSection(`${tag} 反映チェック（内部）`, r.coverage_check ?? "");
    printSection(`${tag} S`, r.S);
    printSection(`${tag} O`, r.O);
    printSection(`${tag} A`, r.A);
    printSection(`${tag} P`, r.P);
  }
  const u = result.usage;
  console.log(
    `\n${tag} tokens: in=${u.input_tokens} out=${u.output_tokens} (cache_read=${u.cache_read_input_tokens}) | ${result.elapsedMs}ms`
  );
}

async function runSoap(tc: TestCase, modelMode: ModelMode): Promise<SoapRunResult[]> {
  printHeader(`[SOAP] ${tc.id}: ${tc.description}`);
  printSection("入力メモ", tc.input.rawInput);

  const { prompt, systemPrompt, soapTool } = buildSoapRequest(tc.input);
  const models: ModelKey[] = modelMode === "both" ? ["haiku", "sonnet"] : [modelMode];

  const results: SoapRunResult[] = [];
  for (const model of models) {
    const result = await callSoapOnce(prompt, systemPrompt, soapTool, model);
    printSoapResult(result);
    results.push(result);
  }
  if (tc.expectations?.soap) printSection("期待する挙動", tc.expectations.soap);
  return results;
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

  // 環境変数: MODEL=haiku(既定) | sonnet | both （SOAPモードでのみ使用）
  const rawModel = (process.env.MODEL ?? "haiku").toLowerCase();
  if (!["haiku", "sonnet", "both"].includes(rawModel)) {
    console.error(`MODEL は haiku | sonnet | both のいずれか。受け取った値: ${rawModel}`);
    process.exit(1);
  }
  const modelMode = rawModel as ModelMode;

  // 環境変数: OUTPUT_JSON=<path> 指定時、SOAP の結果を JSON で保存（A2 baseline 用）
  const outputJsonRel = process.env.OUTPUT_JSON;
  const outputJsonPath = outputJsonRel
    ? path.isAbsolute(outputJsonRel)
      ? outputJsonRel
      : path.join(projectRoot, outputJsonRel)
    : null;

  const casesPath = path.join(__dirname, "cases.json");
  const casesRaw = fs.readFileSync(casesPath, "utf-8");
  const allCases = JSON.parse(casesRaw) as TestCase[];
  const cases = caseFilter === "all" ? allCases : allCases.filter((c) => c.id === caseFilter);

  if (cases.length === 0) {
    console.error(`case-id「${caseFilter}」に該当するケースが無い。cases.jsonを確認。`);
    process.exit(1);
  }

  // プロンプトメタを計測（プロンプト本体は入力依存で揺れるため、systemPrompt + tool スキーマでハッシュを取る）
  const sample = buildSoapRequest(cases[0].input);
  const toolDescStr = JSON.stringify(sample.soapTool);
  const promptHash = shortHash(sample.systemPrompt + " " + toolDescStr);
  const promptMeta = {
    systemPromptChars: sample.systemPrompt.length,
    toolDescChars: toolDescStr.length,
    fewshotChars: SOAP_FEWSHOT_EXAMPLES.length,
  };
  const casesFileHash = shortHash(casesRaw);

  if (mode === "soap" || mode === "all") {
    console.log(`\nMODEL=${modelMode} | promptHash=${promptHash} | casesFileHash=${casesFileHash}`);
    console.log(`promptMeta: systemPromptChars=${promptMeta.systemPromptChars} toolDescChars=${promptMeta.toolDescChars} fewshotChars=${promptMeta.fewshotChars}`);
  }

  const soapJsonCases: Array<{
    id: string;
    description: string;
    runs: Array<{
      model: ModelKey;
      soap: SoapToolOutput | null;
      rawText: string;
      elapsedMs: number;
      usage: SoapRunResult["usage"];
      outputChars: SoapRunResult["outputChars"];
    }>;
  }> = [];

  for (const tc of cases) {
    if (mode === "soap" || mode === "all") {
      const results = await runSoap(tc, modelMode);
      if (outputJsonPath) {
        soapJsonCases.push({
          id: tc.id,
          description: tc.description,
          runs: results.map((r) => ({
            model: r.model,
            soap: r.toolInput,
            rawText: r.toolInput ? "" : r.rawText,
            elapsedMs: r.elapsedMs,
            usage: r.usage,
            outputChars: r.outputChars,
          })),
        });
      }
    }
    if (mode === "questions" || mode === "all") await runQuestions(tc);
  }

  if (outputJsonPath && (mode === "soap" || mode === "all")) {
    const snapshot = {
      ranAt: new Date().toISOString(),
      modelMode,
      promptHash,
      promptMeta,
      casesFileHash,
      caseFilter,
      cases: soapJsonCases,
    };
    fs.mkdirSync(path.dirname(outputJsonPath), { recursive: true });
    fs.writeFileSync(outputJsonPath, JSON.stringify(snapshot, null, 2), "utf-8");
    console.log(`\nスナップショット保存: ${outputJsonPath}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
