/**
 * AI Client - Claude Haiku 4.5 (訪問看護記録向け)
 *
 * .env.local に以下を設定:
 *   ANTHROPIC_API_KEY=xxx
 */

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
}

const MODEL_IDS: Record<NonNullable<GenerateOptions["model"]>, string> = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-6",
};

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

  const message = await Promise.race([
    client.messages.create({
      model: modelId,
      max_tokens: maxTokens,
      ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(systemPrompt ? { system: systemPrompt } : {}),
      ...(options?.tool ? {
        tools: [options.tool],
        tool_choice: { type: "tool" as const, name: options.tool.name },
      } : {}),
      messages: [{ role: "user", content: prompt }],
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`AI応答がタイムアウトしました（${Math.round(timeoutMs / 1000)}秒）。再度お試しください。`)), timeoutMs)
    ),
  ]);

  const usage = {
    input_tokens: message.usage?.input_tokens ?? 0,
    output_tokens: message.usage?.output_tokens ?? 0,
    cache_read_input_tokens: (message.usage as { cache_read_input_tokens?: number } | undefined)?.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: (message.usage as { cache_creation_input_tokens?: number } | undefined)?.cache_creation_input_tokens ?? 0,
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
      return { text: block.text, usage };
    }
  }
  return { text: "", usage };
}
