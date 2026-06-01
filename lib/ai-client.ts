/**
 * AI Client - Claude Haiku 4.5 (訪問看護記録向け)
 *
 * .env.local に以下を設定:
 *   ANTHROPIC_API_KEY=xxx
 */

/**
 * AI呼び出しの失敗種別。ルート側で個別ハンドリングしたい時に使用。
 *   overloaded ... Claude 側の混雑（529 / overloaded_error）。1〜2分後にリトライ
 *   rate_limit ... 短時間リクエスト集中（429）。1分後にリトライ
 *   timeout    ... タイムアウト or ネットワーク不通
 *   auth       ... APIキー不正・権限不足（看護師側の操作では解決不能）
 *   bad_request... 入力不正（プロンプト側のバグ）
 *   other      ... 上記以外（5xx 全般など）
 */
export type AiErrorKind =
  | "overloaded"
  | "rate_limit"
  | "timeout"
  | "auth"
  | "bad_request"
  | "other";

/**
 * AI呼び出し失敗を分類した例外。`userMessage` にはアプリ画面にそのまま出して構わない、
 * 初めての利用者にも次の行動が伝わる文言が入る。
 */
export class AiError extends Error {
  readonly kind: AiErrorKind;
  readonly httpStatus: number;
  readonly userMessage: string;
  readonly retryable: boolean;

  constructor(kind: AiErrorKind, httpStatus: number, userMessage: string, cause?: unknown) {
    super(userMessage);
    this.name = "AiError";
    this.kind = kind;
    this.httpStatus = httpStatus;
    this.userMessage = userMessage;
    // overloaded / rate_limit のみ自動リトライ対象。
    // timeout は既に 30 秒待たせているので即時 fail させ、ユーザーに次の判断を委ねる。
    this.retryable = kind === "overloaded" || kind === "rate_limit";
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

/**
 * 任意の例外を AiError に分類する。Anthropic SDK の APIError、ネットワーク例外、
 * Promise.race のタイムアウト Error などをまとめて扱う。
 */
export function classifyAiError(e: unknown): AiError {
  if (e instanceof AiError) return e;

  const anyErr = e as {
    status?: number;
    error?: { error?: { type?: string; message?: string } };
    message?: string;
    code?: string;
    name?: string;
  };
  const status = typeof anyErr?.status === "number" ? anyErr.status : 0;
  const apiErrType = anyErr?.error?.error?.type;
  const msg = typeof anyErr?.message === "string" ? anyErr.message : "";
  const code = typeof anyErr?.code === "string" ? anyErr.code : "";

  // タイムアウト（Promise.race 側で投げた Error）
  if (msg.includes("タイムアウト")) {
    return new AiError(
      "timeout",
      504,
      "AIの応答に時間がかかりすぎたため、処理を中断しました。通信状況を確認のうえ、もう一度ボタンを押してお試しください。入力内容は自動保存されています。",
      e
    );
  }

  // 過負荷（529 or overloaded_error）
  if (status === 529 || apiErrType === "overloaded_error" || msg.toLowerCase().includes("overloaded")) {
    return new AiError(
      "overloaded",
      529,
      "ただいまAI（Claude）側が混み合っているため、応答できませんでした。1〜2分ほど待ってから、もう一度ボタンを押してお試しください。入力内容は自動保存されているので、入力し直しは不要です。",
      e
    );
  }

  // レート制限（429）
  if (status === 429 || apiErrType === "rate_limit_error") {
    return new AiError(
      "rate_limit",
      429,
      "短時間にAIへのリクエストが集中しました。1分ほど待ってから、もう一度ボタンを押してお試しください。入力内容は自動保存されています。",
      e
    );
  }

  // 認証・権限（401/403）
  if (status === 401 || status === 403) {
    return new AiError(
      "auth",
      status,
      "AIサービスへの接続認証に失敗しました。お手数ですが、管理者へご連絡ください（APIキーの設定確認が必要です）。",
      e
    );
  }

  // 入力不正（400/422）
  if (status === 400 || status === 422) {
    return new AiError(
      "bad_request",
      status,
      "AIへの入力内容に問題があったため、生成できませんでした。入力欄を見直して、もう一度お試しください。問題が続く場合は管理者へご連絡ください。",
      e
    );
  }

  // ゲートウェイ系（502/503/504）→ 過負荷と同じく時間置けば回復
  if (status === 502 || status === 503 || status === 504) {
    return new AiError(
      "overloaded",
      status,
      "AI（Claude）側のサービスが一時的に応答できない状態です。1〜2分ほど待ってから、もう一度ボタンを押してお試しください。入力内容は自動保存されています。",
      e
    );
  }

  // 内部エラー（500）
  if (status === 500) {
    return new AiError(
      "other",
      500,
      "AIサービス側で予期しないエラーが発生しました。少し時間を置いてから、もう一度お試しください。何度も失敗する場合は管理者へご連絡ください。",
      e
    );
  }

  // ネットワーク系
  if (
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    msg.includes("fetch failed") ||
    msg.toLowerCase().includes("network") ||
    anyErr?.name === "APIConnectionError" ||
    anyErr?.name === "APIConnectionTimeoutError"
  ) {
    return new AiError(
      "timeout",
      504,
      "通信が不安定なため、AIに接続できませんでした。Wi-Fi・電波状況をご確認のうえ、もう一度お試しください。入力内容は自動保存されています。",
      e
    );
  }

  // それ以外
  return new AiError(
    "other",
    500,
    "AIによる作成中にエラーが発生しました。少し時間を置いてから、もう一度お試しください。問題が続く場合は管理者へご連絡ください。",
    e
  );
}

interface AiResponse {
  text: string;
  /** tool_useで返された入力JSON。tool指定時のみセットされる */
  toolInput?: Record<string, unknown>;
  /** トークン使用量。プロンプト改修の効果計測に使用 */
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  };
}

interface AiTool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/** 画像入力（Claude vision）。base64 データと media_type を渡す。 */
export interface AiImageInput {
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  data: string; // base64（"data:..." プレフィックスは付けない）
}

/** ドキュメント入力。Claude はPDFを直接読める（document ブロック）。 */
export interface AiDocumentInput {
  mediaType: "application/pdf";
  data: string; // base64
}

interface GenerateOptions {
  /** 出力トークン上限。褥瘡計画書など長文出力時は8192等に増やす。未指定時は4096 */
  maxTokens?: number;
  /** タイムアウトms。未指定時は30秒 */
  timeoutMs?: number;
  /** サンプリング温度。医療記録など決定的な出力には 0〜0.3 を推奨。未指定時はSDK既定値 */
  temperature?: number;
  /** tool_useで構造化JSONを強制。指定するとClaudeは必ずこのスキーマに従ったJSONを返す */
  tool?: AiTool;
  /** モデル指定。未指定時は haiku（Claude Haiku 4.5）。テストハーネスでの並走計測用 */
  model?: "haiku" | "sonnet";
  /** systemプロンプトをPrompt Cacheする際のTTL。指定時のみ cache_control を付与する。
   *  高頻度ルート（SOAP生成・alerts）で "1h" 推奨。未指定ならキャッシュなし（従来どおり）。 */
  cacheSystemTtl?: "5m" | "1h";
  /** 画像入力（Claude vision）。指定するとユーザーメッセージ先頭に画像ブロックを付与する。 */
  images?: AiImageInput[];
  /** ドキュメント入力（PDF）。指定するとユーザーメッセージ先頭に document ブロックを付与する。 */
  documents?: AiDocumentInput[];
}

const MODEL_IDS: Record<NonNullable<GenerateOptions["model"]>, string> = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-6",
};

/**
 * systemプロンプトを Anthropic API に渡す形に整える。
 * ttl 指定時のみ Prompt Cache 用の cache_control を付けた配列形式で返す（精度には影響しないインフラマーカー）。
 * 未指定なら従来どおり文字列で返す（キャッシュなし）。
 */
function buildSystemParam(systemPrompt: string, ttl?: "5m" | "1h") {
  if (!ttl) return systemPrompt;
  return [
    {
      type: "text" as const,
      text: systemPrompt,
      cache_control: { type: "ephemeral" as const, ttl },
    },
  ];
}

/**
 * AI応答を生成する
 * @param prompt ユーザープロンプト（入力データ中心）
 * @param systemPrompt システムプロンプト（ロール定義・ルール・出力形式）
 * @param options 生成オプション（max_tokens等）
 */
export async function generateAiResponse(
  prompt: string,
  systemPrompt?: string,
  options?: GenerateOptions
): Promise<AiResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY が設定されていません。.env.local を確認してください。");
  }

  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey });

  const timeoutMs = options?.timeoutMs ?? 30000;
  const maxTokens = options?.maxTokens ?? 4096;

  const modelId = MODEL_IDS[options?.model ?? "haiku"];

  // 画像（vision）があればユーザーメッセージを「画像ブロック…＋テキスト」の配列にする。
  // 画像なしなら従来どおり文字列（後方互換）。
  const hasMedia =
    (options?.images?.length ?? 0) > 0 || (options?.documents?.length ?? 0) > 0;
  const userContent = hasMedia
    ? [
        ...(options?.documents ?? []).map((doc) => ({
          type: "document" as const,
          source: { type: "base64" as const, media_type: doc.mediaType, data: doc.data },
        })),
        ...(options?.images ?? []).map((img) => ({
          type: "image" as const,
          source: { type: "base64" as const, media_type: img.mediaType, data: img.data },
        })),
        { type: "text" as const, text: prompt },
      ]
    : prompt;

  // 一過性エラー（Claude 過負荷・レート制限・ネットワーク瞬断）は指数バックオフで自動リトライ。
  // 看護師は画面の前で待たされているので、リトライ回数は控えめ（合計3回試行＝2回までリトライ）に抑える。
  const maxRetries = 2;
  const baseDelayMs = 2000;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const message = await Promise.race([
        client.messages.create({
          model: modelId,
          max_tokens: maxTokens,
          ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
          ...(systemPrompt ? { system: buildSystemParam(systemPrompt, options?.cacheSystemTtl) } : {}),
          ...(options?.tool ? {
            tools: [options.tool],
            tool_choice: { type: "tool" as const, name: options.tool.name },
          } : {}),
          messages: [{ role: "user", content: userContent }],
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`AI応答がタイムアウトしました（${Math.round(timeoutMs / 1000)}秒）。再度お試しください。`)), timeoutMs)
        ),
      ]);
      return buildAiResponse(message);
    } catch (e) {
      lastError = e;
      const classified = classifyAiError(e);
      // リトライ対象外（認証失敗・入力不正など）は即時 throw
      if (!classified.retryable || attempt === maxRetries) {
        throw classified;
      }
      // 指数バックオフ（2s → 4s）。最終試行直前まで待つ
      const delayMs = baseDelayMs * Math.pow(2, attempt);
      console.warn(
        `[ai-client] retry ${attempt + 1}/${maxRetries} after ${delayMs}ms (kind=${classified.kind} status=${classified.httpStatus})`
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  // 到達不能だが型のため
  throw classifyAiError(lastError);
}

type RawMessage = {
  usage?: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  } | null;
  content: ReadonlyArray<{ type: string; text?: string; input?: unknown }>;
};

function buildAiResponse(message: RawMessage): AiResponse {
  const usage = {
    input_tokens: message.usage?.input_tokens ?? 0,
    output_tokens: message.usage?.output_tokens ?? 0,
    cache_read_input_tokens: message.usage?.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: message.usage?.cache_creation_input_tokens ?? 0,
  };

  // tool_use ブロックがあれば構造化出力を優先返却
  for (const block of message.content) {
    if (block.type === "tool_use") {
      return {
        text: JSON.stringify(block.input),
        toolInput: block.input as Record<string, unknown>,
        usage,
      };
    }
  }

  // フォールバック: textブロックを返す
  for (const block of message.content) {
    if (block.type === "text") {
      return { text: block.text ?? "", usage };
    }
  }
  return { text: "", usage };
}
