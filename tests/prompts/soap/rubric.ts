/**
 * SOAP品質ルーブリック定義（v1）
 *
 * docs/SOAP品質ルーブリック設計_v1.md（2026-07-04 オーナー承認済み）の単一ソース実装。
 * judge.ts から参照される。観点の追加・基準変更はこのファイルだけを直し、
 * 変更時は CHANGELOG.md に1行記録すること。
 */

export interface RubricCriterion {
  id: string;
  name: string;
  /** judgeプロンプトに埋め込む判定基準（違反の定義を具体的に書く） */
  standard: string;
  /** 前回記録がないケースでは採点対象外になる観点か */
  requiresPreviousRecords: boolean;
}

export const RUBRIC_VERSION = "v2-2026-07-07";

export const RUBRIC_CRITERIA: RubricCriterion[] = [
  {
    id: "R1",
    name: "O純度",
    standard:
      "O欄が観察事実・数値・実施内容で構成されている（2026-07-07 事業所ルールで較正済み）。違反例: 根拠の書かれていない推測（「〜と思われる」）や明確なアセスメント文の混入、次回訪問予定等の単なる予定情報の混入（予定はP末尾が正）。合格扱い（違反にしないこと）: バイタル値・皮膚所見・実施したケアの記載／「バイタル安定」「排便良好」程度の慣用的な短い評価語（事業所の記録慣行として許容）／予定に関して当日実施した行為の記載（次回訪問日時をカレンダーへ記載した・本人へ説明した等）／「本人より〜との訴えあり」「家族より〜との報告あり」形式での発言の客観記載（設計仕様）。バイタルが漢字＋単位（体温36.9℃、血圧128/80mmHg等）で表記されていない場合は軽微な問題（1）とする。",
    requiresPreviousRecords: false,
  },
  {
    id: "R2",
    name: "S真正性",
    standard:
      "S欄が利用者・家族の言葉のみで構成され、S情報（看護師入力）の内容・話者ラベル（本人/妻/娘等）が保持されている。違反例: S情報にない発言の創作、複数話者の統合・ラベル削除、発言内容の大幅な簡略化・言い換え、訪問メモの地の文からの発言抽出。S情報が提供されていないケースではS欄が空であること。",
    requiresPreviousRecords: false,
  },
  {
    id: "R3",
    name: "A根拠性",
    standard:
      "A欄の評価・解釈が、S欄・O欄・入力素材に書かれた事実から導かれている。違反例: 入力のどこにも根拠がない病状評価の創作、事実から飛躍した重症度判断、入力にない検査値・既往への言及。事実の範囲内での妥当な看護アセスメント（例: 排便3日なし→便秘傾向の評価）は合格。",
    requiresPreviousRecords: false,
  },
  {
    id: "R4",
    name: "P接続性",
    standard:
      "P欄がA欄の課題・S情報の訴えに対応し、次回訪問で観察・実行可能な具体的計画になっている。違反例: 「継続」「経過観察」等の一語だけで何を継続・観察するか不明、Aで挙げた課題に対応する計画の欠落、S情報の訴え（痛み等）への対応計画の欠落。",
    requiresPreviousRecords: false,
  },
  {
    id: "R5",
    name: "監査耐性",
    standard:
      "実地指導・監査に耐える表現になっている。v1の判定範囲は次の2点のみ: (1) 断定的診断（医師権限）を書いていないこと。違反例:「肺炎である」「褥瘡はDESIGN-R d2」等の診断・点数の断定。「〜の可能性があり医師へ報告」等は合格。(2) 算定区分・加算等の制度判断を書いていないこと。この2点以外の表現品質はv1では採点しない。",
    requiresPreviousRecords: false,
  },
  {
    id: "R6",
    name: "継続性",
    standard:
      "前回記録のP（計画）に挙がった観察・ケア事項が、今回のO（観察結果）またはA（評価）で回収されている。違反例: 前回Pで「創部の観察を継続」とあるのに今回O/Aに創部への言及が一切ない（入力メモに材料がある場合）。入力メモ自体に前回P関連の情報がない場合は、記録生成側の責任ではないため1（軽微）までに留め、0は付けない。",
    requiresPreviousRecords: true,
  },
  {
    id: "R7",
    name: "冗長性",
    standard:
      "記録が簡潔で、読み手が「この利用者の何を見て、今後どうするか」を掴みやすい。違反例: 同じ事実の複数欄への二重記載（S欄の発言をOで言い換えて再掲・Oの事実をAでそのまま再掲）、根拠や情報を足さない定型文の水増し、入力素材の情報量に対して不釣り合いに長い出力、要点が長い羅列に埋もれて次にすべきことが読み取りにくい。合格扱い: 入力にある情報を漏らさず書くこと自体は違反ではない（問題は重複と水増し）／看護師が訪問メモに自分で書いた発言のOでの客観記載は設計仕様（S欄と重複しても違反にしない）／予定に関する当日の行為（O）と次回予定（P末尾）の日時の重なりは違反にしない。",
    requiresPreviousRecords: false,
  },
];

/** 採点尺度（judgeプロンプト用） */
export const SCORE_ANCHORS = `- 2 = 合格。明確な違反も軽微な問題もない
- 1 = 軽微な問題。意味は通り実害は小さいが、改善余地のあるグレーな箇所が1つ以上ある
- 0 = 明確な違反が1つ以上ある（違反箇所を原文引用できる場合のみ0を付けてよい）`;

/**
 * judge用 tool スキーマを構築する。
 * 設計どおり「violations（違反列挙）→ score → reason」の順に書かせて
 * 甘め判定を防ぐ（自己チェック・スキャフォルド構造）。
 */
export function buildJudgeTool(criteria: RubricCriterion[]) {
  const perCriterion = {
    type: "object" as const,
    properties: {
      violations: {
        type: "array",
        description:
          "違反・問題箇所の列挙。必ずscoreより先に埋める。なければ空配列。quoteは生成SOAPまたは入力素材からの原文引用",
        items: {
          type: "object",
          properties: {
            quote: { type: "string", description: "問題箇所の原文引用" },
            problem: { type: "string", description: "何が問題か（1文）" },
          },
          required: ["quote", "problem"],
        },
      },
      score: {
        type: "integer",
        enum: [0, 1, 2],
        description: "violationsを踏まえた採点。0はviolationsに原文引用がある場合のみ",
      },
      reason: { type: "string", description: "採点理由（1〜2文）" },
    },
    required: ["violations", "score", "reason"],
  };

  const properties: Record<string, unknown> = {};
  for (const c of criteria) {
    properties[c.id] = { ...perCriterion, description: `${c.name}: ${c.standard}` };
  }

  return {
    name: "submit_rubric_scores",
    description: "SOAP記録をルーブリック観点ごとに採点して提出する",
    input_schema: {
      type: "object" as const,
      properties,
      required: criteria.map((c) => c.id),
    },
  };
}
