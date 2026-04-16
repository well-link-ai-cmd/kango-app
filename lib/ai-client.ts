/**
 * AI Client - Gemini (テスト用) / Claude (本番用) 切り替え
 *
 * .env.local に以下のどちらかを設定:
 *   GEMINI_API_KEY=xxx    → Gemini (Google AI Studio 無料テスト用)
 *   ANTHROPIC_API_KEY=xxx → Claude (本番用)
 *
 * 両方設定されている場合は GEMINI_API_KEY を優先（テストモード）
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

interface AiResponse {
  text: string;
}

interface GenerateOptions {
  /** 出力トークン上限。褥瘡計画書など長文出力時は8192等に増やす。未指定時は4096 */
  maxTokens?: number;
  /** タイムアウトms。未指定時は30秒 */
  timeoutMs?: number;
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
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  if (anthropicKey) {
    return generateWithClaude(anthropicKey, prompt, systemPrompt, options);
  }

  if (geminiKey) {
    return generateWithGemini(geminiKey, prompt, systemPrompt, options);
  }

  throw new Error("APIキーが設定されていません。.env.local に ANTHROPIC_API_KEY または GEMINI_API_KEY を設定してください。");
}

async function generateWithGemini(apiKey: string, prompt: string, systemPrompt?: string, options?: GenerateOptions): Promise<AiResponse> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    ...(systemPrompt ? { systemInstruction: systemPrompt } : {}),
    ...(options?.maxTokens ? { generationConfig: { maxOutputTokens: options.maxTokens } } : {}),
  });

  const timeoutMs = options?.timeoutMs ?? 30000;
  try {
    const result = await Promise.race([
      model.generateContent(prompt),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("AI応答がタイムアウトしました（30秒）。再度お試しください。")), timeoutMs)
      ),
    ]);
    const text = result.response.text();
    return { text };
  } catch (e: unknown) {
    const err = e as Error;
    if (err.message?.includes("API_KEY") || err.message?.includes("permission")) {
      throw new Error("Gemini APIキーが無効です。Google AI Studio でAPIキーを確認してください。");
    }
    if (err.message?.includes("not found") || err.message?.includes("model")) {
      throw new Error("Geminiモデルが利用できません。APIキーの無料枠を確認してください。");
    }
    throw e;
  }
}

async function generateWithClaude(apiKey: string, prompt: string, systemPrompt?: string, options?: GenerateOptions): Promise<AiResponse> {
  // Dynamic import to avoid build errors when only using Gemini
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey });

  const timeoutMs = options?.timeoutMs ?? 30000;
  const maxTokens = options?.maxTokens ?? 4096;
  const message = await Promise.race([
    client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: maxTokens,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: [{ role: "user", content: prompt }],
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`AI応答がタイムアウトしました（${Math.round(timeoutMs / 1000)}秒）。再度お試しください。`)), timeoutMs)
    ),
  ]);

  const text = message.content[0].type === "text" ? message.content[0].text : "";
  return { text };
}

export function getAiProvider(): "gemini" | "claude" | "none" {
  if (process.env.ANTHROPIC_API_KEY) return "claude";
  if (process.env.GEMINI_API_KEY) return "gemini";
  return "none";
}
