import { getServerSupabase } from "./supabase-server";

/**
 * サーバ側（APIルート）用の監査ログ。
 *
 * 用途: 医療情報のAI送信（越境送信）の記録（action: "ai_send"）。
 * lib/audit.ts はブラウザクライアント前提のためAPIルートでは使えない。
 * 本関数は getServerSupabase()（認証Cookie由来のユーザーセッション）で
 * audit_logs に INSERT する。RLS（migration 016）はそのまま適用される。
 *
 * 設計はクライアント版と同じ fire-and-forget:
 *  - 記録の失敗・遅延は AI 生成処理に一切影響させない（例外は握りつぶす）
 *  - migration 016 が未適用の環境ではテーブル不存在で失敗するが、無害に無視される
 */
export function logAiSend(
  entity: string,
  entityId?: string | null,
  meta?: Record<string, unknown>,
): void {
  void (async () => {
    try {
      const supabase = await getServerSupabase();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from("memberships")
        .select("org_id")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();
      const orgId = (data?.org_id as string | undefined) ?? null;
      if (!orgId) return;

      await supabase.from("audit_logs").insert({
        org_id: orgId,
        user_id: user.id,
        user_email: user.email ?? null,
        action: "ai_send",
        entity,
        entity_id: entityId ?? null,
        meta: meta ?? null,
      });
    } catch {
      // 監査ログの失敗で本処理を止めない
    }
  })();
}
