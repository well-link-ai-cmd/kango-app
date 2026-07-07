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

import { MEDICAL_TERM_CORRECTIONS_DETAILED } from "../../../lib/medical-term-corrections";
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

// -------- レーベンシュタイン距離（route.ts と同期。S補正版の採用判定用） --------
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

// -------- S情報の話者ラベル抽出（route.ts と同期） --------
function extractSLabels(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.match(/^\s*(.{0,6}?S)[:：]/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => m[1].trim());
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
  initialSoapRecords?: { text: string; visitDate?: string }[];
  intakeNotes?: string;
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
  const { sInput, rawInput, carePlan, previousRecords, alertAnswers, questionAnswers, initialSoapRecords, intakeNotes } = input;

  // NOTE: テストハーネスでは看護計画書の参照は行わない（実DBアクセスを避けるため）
  // 本番（app/api/soap/route.ts）では patientId から nursing_care_plans を取得して最優先コンテキストとして注入する
  const carePlanSection = carePlan ? `\n【ケアプラン・担当者会議の方針（旧欄・過渡期参照）】\n${carePlan}\n` : "";
  const allPrevRecords = (previousRecords ?? []).slice(0, 3);

  // 導入時SOAP（生テキスト）：医療用語・言い回し・経過の参考のみ（route.ts ミラー）
  const initialReferenceSection = initialSoapRecords && initialSoapRecords.length > 0
    ? "\n【過去記録の参考（導入時に貼り付けた記録。医療用語・言い回し・経過の参考に留める。ここから今回のSOAPの事実やS欄を抽出しない）】\n" +
      initialSoapRecords
        .map((r, i) => `[参考${i + 1}${r.visitDate ? `（${r.visitDate}）` : ""}]\n${r.text}`)
        .join("\n\n") + "\n"
    : "";

  // 導入時情報（退院前カンファレンス・申し送り等）：経過・方針の判断材料（route.ts ミラー）
  const intakeNotesSection = intakeNotes && String(intakeNotes).trim()
    ? `\n【導入時情報（退院前カンファレンス・申し送り等。経過・方針の判断材料）】\n${String(intakeNotes).trim()}\n`
    : "";

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
- 【S情報】：corrected_s_input への passthrough、A・P の判断材料（本人の訴えとして臨床判断に反映。例「痛みが増した」→ A で疼痛増悪評価、P でレスキュー検討）。【S情報】だけにある発言を O に持ち込まない
- 【AIからの確認質問への回答】【前回からの継続確認事項への回答】：メモの記載漏れを補う事実。空欄でなければ O/A/P に反映する（S 欄には入れない）
- 【過去記録】：文体の手本と、今日の事実に対する「前回からの変化」の判断材料。今日の入力（メモ・S情報・回答）に対応する事実がない項目のアセスメント・計画を過去記録から持ち込まない（未実施項目の継続確認は確認質問機能が担う）
- 【導入時情報】：退院前カンファレンス・申し送り等。病状経過・療養方針・注意点を A・P の判断材料として考慮してよい（例：カンファで転倒リスクの指摘 → P で転倒予防の観察を計画）。ここから今日の事実（O）を作らない・発言を corrected_s_input に入れない
- 【ケアプラン（旧欄）】：看護計画書がない場合のみ補助参照

参照優先順位：看護計画書（確定版） > 過去記録・メモ > 旧ケアプラン欄

# S情報の取り扱い（S欄は出力しない。システムが corrected_s_input と【S情報】から機械決定する）
1. corrected_s_input には【S情報】の全文を、誤変換・明白な誤字の補正のみ行って入れる。補正は語単位の置き換えに限る（医療用語の誤変換と、文脈上明白な誤字・脱字が対象）。方言・話し言葉・語尾・句読点・話者ラベル（「S:」=本人、「妻S:」「娘S:」等）は一字一句そのまま保持する（例：「痛うて」を「痛くて」に直すのは補正ではなく改変であり禁止）。削除・要約・簡略化・発言の統合・話者ラベルの除去は一切しない。【S情報】がなければ ""
2. 訪問メモ内に出てくる本人・家族の発言は corrected_s_input に入れず、O に「本人より〜との訴えあり」「家族より〜との報告あり」と客観記載する。看護師がメモに自分で書いた発言は【S情報】と同内容でも O に残してよい（書き手の意図を尊重する）
3. 【S情報】だけにあり訪問メモに出てこない発言は O に転記しない。「本人より〜との報告あり」等への言い換え・要約による転記も不可（S欄が正。AIの判断で S の内容を O へ複製すると記録が二重に長くなる）
4. 過去記録の S 欄・【AIからの確認質問への回答】【前回からの継続確認事項への回答】の本文・「特になし」等のプレースホルダを corrected_s_input に混ぜてはならない
5. 【S情報】（本人・家族の発言）は A/P の臨床判断材料として必ず考慮する（例「痛みが増した」→ A で疼痛増悪評価、P でレスキュー検討）
※ Few-shot例の出力にある「S情報:」行は corrected_s_input に対応する

# 作業手順
1. extracted_facts：全事実ソースから事実を抽出する。1事実=1要素・25字以内の短句で配列に入れる（内部確認用なので簡潔に。複数事実を1要素に詰めない）。各要素の末尾に由来タグを付ける：[メモ] / [S情報] / [AI回答] / [継続確認回答]
2. coverage_check：各事実の反映先（O/A/P。S情報は corrected_s_input）を「事実→欄」の短い対応で確認する。[AI回答] [継続確認回答] タグの項目が本文に含まれているかを厳しくチェック
3. O・A・P：coverage_check に従って記述。[S情報] タグ以外の事実を全て反映する（[S情報] の事実は corrected_s_input に反映済みのため O に再掲せず、A・P の判断材料にのみ使う。S欄は出力しない）

# 文体ルール
- 過去記録があれば、文末表現・文の長さに合わせる（語尾「〜みられる」「〜である」、短文/長文）
- 過去記録がない場合は「〜みられる」「〜である」調の標準的な看護記録文体
- 見出し・箇条書き・番号リストは使わない。自然な文章で書く
- 事実ソースにない事実を創作しない
- 過去記録の医療用語の表記が補正リストの誤変換と一致する場合は、補正後の用語で書く（過去記録に揃えない）

# 医療用語の補正（全段階で実行）
音声入力では同音異義語の誤変換が頻発する。extracted_facts の段階から補正済みの用語で書く（例「配便は昨日あり」→「排便は昨日あり」）。
よくある誤変換：
${MEDICAL_TERM_CORRECTIONS_DETAILED}

# 各項目の書き方（O/A/P の役割を厳密に分ける）
O（客観的事実のみ）：観察した事実・測定値・実施したケアだけを書く。場面描写から時系列で。看護師の判断・解釈・推測（「〜と考える」「〜と思われる」「〜が必要」）は書かず A に回す（「バイタル安定」「排便良好」程度の慣用的な短い評価語は可）。バイタルは漢字＋単位で統一する（例：体温36.9℃、血圧128/80mmHg、脈拍76/分、SpO2 96%、呼吸数18/分）。文末は「〜あり」「〜なし」「〜を実施」「〜であった」等の事実描写。AI回答・継続確認回答の客観情報もここに。次回訪問予定は O に書かず P の末尾へ。ただし予定に関して当日行った行為（次回訪問日時を忘れないようカレンダーへ記載した・本人や家族へ説明した等）は実施したケアとして O に書く
A（看護師の評価・解釈）：今日の入力（メモ・S情報・回答）に根拠がある事実に対するアセスメントだけを書く。今日観察・実施していない項目の評価を過去記録から持ち込まない。事実の単純な再掲はしない。前回からの変化・臨床的な意味づけ・リスク評価を述べる。「全身状態は安定」等の総括的な評価を書く場合は、根拠となる今日の事実を同じ文に添える（根拠を示せない総括は書かない）。文末は「〜と考えられる」「〜と思われる」「〜の状態である」「〜が必要と考える」等の評価表現。今後の具体的行動（「〜していく」）は書かず P に回す
P（今後の計画・方針）：今日の事実・A の評価に対応する計画だけを書く。今日の入力に対応する事実がない前回プラン項目は書かない。「継続」「観察」「確認」の一語で終わらせず、何を観察・実施するかを必ず書く（「観察継続」ではなく「仙骨部の発赤と滲出液の有無を観察していく」）。文末は「〜していく」「〜を継続する」「〜を観察していく」「〜を検討する」で統一。評価・解釈（A の内容）は書かない。S情報や A で挙げた課題に対応する計画を必ず含める（例：S情報で疼痛増悪 → P でレスキュー使用検討・主治医相談・再評価）。次回訪問予定・次回実施予定の事項は P の末尾に書く（例：「次回訪問（金曜10時）で排便状況を確認していく」）

# 出力長さ
入力メモの情報量に見合った長さで出力する。下記Few-shot例の長さに引きずられない（Beforeが豊富だったので長文になっただけ）。A・P は今日の事実に対応する分だけでよく、短くなって構わない（関係のない項目を足して長くしない）。同じ事実を複数欄に重複して書かない。読み手が「何を見て、今後どうするか」を掴めることを優先し、冗長な言い回しを避ける。
${SOAP_FEWSHOT_EXAMPLES}`;

  const prevStyleSection = allPrevRecords.length > 0
    ? "【文体の手本（文末表現・文の長さを揃える。ただし医療用語の表記は補正リスト優先）】\n" +
      allPrevRecords.map((r, i) =>
        `[${i === 0 ? "前回" : i === 1 ? "前々回" : "3回前"}${r.visitDate ? `（${r.visitDate}）` : ""}]\nS: ${r.S}\nO: ${r.O}\nA: ${r.A}\nP: ${r.P}`
      ).join("\n\n") + "\n\n"
    : "";

  const prevPlanSection = allPrevRecords.length > 0 && allPrevRecords[0].P
    ? `【前回プラン（参考）。今日のメモ・S情報・回答に対応する事実がある項目のみ A・P で言及し、対応する事実がない項目は A・P に書かない（未実施項目の継続確認は確認質問機能が担う）】\n${allPrevRecords[0].P}\n\n`
    : "";

  const prompt = hasSInput
    ? `${prevStyleSection}${prevPlanSection}${carePlanSection}${initialReferenceSection}${intakeNotesSection}${alertAnswersSection}${answersSection}【S情報（看護師入力済み・誤変換のみ補正してそのまま返す）】
${sInput}

【今回の訪問メモ（これをO・A・Pに変換する）】
${rawInput}`
    : `${prevStyleSection}${prevPlanSection}${carePlanSection}${initialReferenceSection}${intakeNotesSection}${alertAnswersSection}${answersSection}【今回の訪問メモ（これをS・O・A・Pに変換する）】
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
          description: "事実の箇条書き（内部確認用）。1事実1要素・25字以内の短句。各要素末尾に由来タグ [メモ]/[S情報]/[AI回答]/[継続確認回答] を付ける",
        },
        coverage_check: {
          type: "string",
          description: "各事実の反映先（内部確認用）。「事実→欄」の短い対応表のみ",
        },
        corrected_s_input: {
          type: "string",
          description: "【S情報】の全文を誤字のみ語単位で補正して返す（詳細ルールはsystem指示に従う）。【S情報】がなければ空文字列",
        },
        O: { type: "string" },
        A: { type: "string" },
        P: { type: "string" },
      },
      required: ["extracted_facts", "coverage_check", "corrected_s_input", "O", "A", "P"],
    },
  };

  return { prompt, systemPrompt, soapTool };
}

// -------- questions プロンプト構築（app/api/soap/questions/route.ts をミラー） --------
function buildQuestionsRequest(input: CaseInput) {
  const { sInput, rawInput, previousRecords, carePlan, nursingContentItems } = input;

  const allRecords = (previousRecords ?? []).slice(0, 3);

  if (allRecords.length === 0) return null;

  const prevText = allRecords
    .map(
      (r, i) =>
        `【${i === 0 ? "前回" : i === 1 ? "前々回" : "3回前"}の記録${r.visitDate ? `（${r.visitDate}）` : ""}】\n` +
        `S: ${r.S}\nO: ${r.O}\nA: ${r.A}\nP: ${r.P}`
    )
    .join("\n\n");

  // NOTE: テストハーネスでは看護計画書のDB参照は行わない（route.ts では patientId から取得して注入する）
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

  const prompt = `${carePlan ? `【ケアプラン・担当者会議の方針（旧欄・過渡期参照）】\n${carePlan}\n\n` : ""}${nursingContentItems && nursingContentItems.length > 0 ? `【登録済みケア内容】\n${nursingContentItems.map((item) => `・${item}`).join("\n")}\n\n` : ""}${prevText}

${sInput?.trim() ? `【今回のS情報】\n${sInput}\n\n` : ""}【今回の訪問メモ】
${rawInput}`;

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
  corrected_s_input?: string;
  /** LLM出力からは廃止済み。runSoap が route.ts のS欄決定ロジックを再現して注入する（snapshot/judge用） */
  S?: string;
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
    cacheSystemTtl: "1h",
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
    printSection(`${tag} corrected_s_input（内部・誤変換補正版）`, r.corrected_s_input ?? "");
    printSection(`${tag} O`, r.O);
    printSection(`${tag} A`, r.A);
    printSection(`${tag} P`, r.P);
  }
  const u = result.usage;
  console.log(
    `\n${tag} tokens: in=${u.input_tokens} out=${u.output_tokens} (cache_read=${u.cache_read_input_tokens} cache_creation=${u.cache_creation_input_tokens}) | ${result.elapsedMs}ms`
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
    // 本番 route.ts の S 欄決定ロジックを再現し、snapshot/judge 用に toolInput.S へ注入する
    // （S欄はLLM出力から廃止済み。評価対象は「実効SOAP」= 機械決定されたS）
    if (result.toolInput) {
      const sRaw = tc.input.sInput?.trim();
      let finalS = "";
      if (sRaw) {
        const corrected = (result.toolInput.corrected_s_input ?? "").trim();
        const rawLabels = extractSLabels(sRaw);
        const corLabels = extractSLabels(corrected);
        const labelsPreserved =
          rawLabels.length === corLabels.length && rawLabels.every((l, i) => l === corLabels[i]);
        const diffOk = editDistance(sRaw, corrected) <= Math.max(8, Math.round(sRaw.length * 0.2));
        finalS = corrected.length >= sRaw.length * 0.8 && labelsPreserved && diffOk ? corrected : sRaw;
        printSection(`[${result.model}] 本番S欄（route.ts再現）`, finalS);
      }
      result.toolInput.S = finalS;
    }
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
    alerts?: string[];
  };

  printSection("memo_covers（内部）", r.memo_covers ?? []);
  printSection("expected_from_context（内部）", r.expected_from_context ?? []);
  printSection("alerts（ユーザー表示）", r.alerts ?? []);
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
