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

export async function generateAiResponse(prompt: string): Promise<AiResponse> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  if (anthropicKey) {
    return generateWithClaude(anthropicKey, prompt);
  }

  if (geminiKey) {
    return generateWithGemini(geminiKey, prompt);
  }

  throw new Error("APIキーが設定されていません。.env.local に ANTHROPIC_API_KEY または GEMINI_API_KEY を設定してください。");
}

async function generateWithGemini(apiKey: string, prompt: string): Promise<AiResponse> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const timeoutMs = 30000;
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

async function generateWithClaude(apiKey: string, prompt: string): Promise<AiResponse> {
  // Dynamic import to avoid build errors when only using Gemini
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey });

  const timeoutMs = 30000;
  const message = await Promise.race([
    client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("AI応答がタイムアウトしました（30秒）。再度お試しください。")), timeoutMs)
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
