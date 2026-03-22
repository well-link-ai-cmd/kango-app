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
  const geminiKey = process.env.GEMINI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (geminiKey) {
    return generateWithGemini(geminiKey, prompt);
  }

  if (anthropicKey) {
    return generateWithClaude(anthropicKey, prompt);
  }

  throw new Error("APIキーが設定されていません。.env.local に GEMINI_API_KEY または ANTHROPIC_API_KEY を設定してください。");
}

async function generateWithGemini(apiKey: string, prompt: string): Promise<AiResponse> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  return { text };
}

async function generateWithClaude(apiKey: string, prompt: string): Promise<AiResponse> {
  // Dynamic import to avoid build errors when only using Gemini
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey });

  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const text = message.content[0].type === "text" ? message.content[0].text : "";
  return { text };
}

export function getAiProvider(): "gemini" | "claude" | "none" {
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.ANTHROPIC_API_KEY) return "claude";
  return "none";
}
