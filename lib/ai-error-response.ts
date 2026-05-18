import { NextResponse } from "next/server";
import { classifyAiError } from "./ai-client";

/**
 * AI ルートの catch から呼ぶ統一ヘルパ。
 * 例外を AiError に分類し、ユーザー向け文言・HTTP ステータス・retry 可否を含む
 * NextResponse を返す。クライアント側は `data.error` をそのまま画面表示するだけで、
 * 初めての利用者にも次の一手（少し待って再試行・管理者連絡・通信確認）が伝わる。
 */
export function aiErrorResponse(e: unknown): NextResponse {
  const aiErr = classifyAiError(e);
  console.error(`[AiError] kind=${aiErr.kind} status=${aiErr.httpStatus}`, e);
  return NextResponse.json(
    {
      error: aiErr.userMessage,
      kind: aiErr.kind,
      retryable: aiErr.retryable,
    },
    { status: aiErr.httpStatus }
  );
}
