import { getSupabase } from "./supabase";

/**
 * 監査ログ（操作履歴）。3省2ガイドラインのアクセス・操作記録要件に向けた第一歩。
 *
 * 設計の前提と限界:
 *  - fire-and-forget。記録の失敗・遅延は本処理（保存・削除）に一切影響させない。
 *    監査ログが落ちても看護師の操作は止めない（握りつぶす）。
 *  - 現状はクライアント側からの INSERT。audit_logs は RLS で UPDATE/DELETE 不可
 *    （追記専用）だが、INSERT 自体はクライアント起点のため「改ざん耐性」は限定的。
 *    将来はサーバ側（API ルート / DB トリガ）での記録へ移行する想定。
 *  - AI への送信（医療情報の越境）記録（action: "ai_send"）は今後 API ルート側で付与。
 */
export type AuditAction = "save" | "delete" | "view" | "ai_send";

interface AuditContext {
  /** 呼び出し側が既に解決済みなら渡す（無ければ内部で解決） */
  orgId?: string | null;
  userId?: string | null;
  meta?: Record<string, unknown>;
}

/**
 * 監査ログを1件記録する。戻り値は無く、内部で非同期に実行する（待たない）。
 * 例外は全て内部で握りつぶすため、呼び出し側は `logAudit(...)` と書くだけでよい。
 */
export function logAudit(
  action: AuditAction,
  entity: string,
  entityId?: string | null,
  ctx: AuditContext = {},
): void {
  void (async () => {
    try {
      const supabase = getSupabase();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      let orgId = ctx.orgId ?? null;
      if (!orgId) {
        const { data } = await supabase
          .from("memberships")
          .select("org_id")
          .eq("user_id", user.id)
          .limit(1)
          .maybeSingle();
        orgId = (data?.org_id as string | undefined) ?? null;
      }
      if (!orgId) return; // 所属事業所が無ければ記録しない（RLSでも弾かれる）

      await supabase.from("audit_logs").insert({
        org_id: orgId,
        user_id: ctx.userId ?? user.id,
        user_email: user.email ?? null,
        action,
        entity,
        entity_id: entityId ?? null,
        meta: ctx.meta ?? null,
      });
    } catch {
      // 監査ログの失敗は本処理に影響させない
    }
  })();
}
