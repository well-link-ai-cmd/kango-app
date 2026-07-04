-- =============================================================
-- 016: 監査ログ（操作履歴）audit_logs
--
-- 3省2ガイドライン（医療情報の安全管理）が求める「誰が・いつ・何を」した
-- かの記録に向けた基盤。まずはデータの保存/削除など書き込み操作を記録する。
--
-- 方針:
--   - 事業所スコープの RLS（自分の所属事業所の行のみ）。
--   - 閲覧は管理者(is_org_admin)に限定。
--   - INSERT のみ許可し、UPDATE/DELETE ポリシーは作らない＝追記専用（改ざん防止）。
--   - アプリ側 lib/audit.ts が fire-and-forget で INSERT する（本処理を止めない）。
--
-- 冪等（再実行可）。Supabase ダッシュボード > SQL Editor で実行してください。
-- ※ migration 011（organizations / current_org_ids / is_org_admin）適用済みが前提。
-- =============================================================

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid references auth.users(id),
  user_email text,
  action text not null,          -- save / delete / view / ai_send
  entity text not null,          -- patient / soap_record / nursing_contents / pressure_ulcer_plan / ...
  entity_id text,
  meta jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_logs_org_created on audit_logs(org_id, created_at desc);
create index if not exists idx_audit_logs_entity on audit_logs(entity, entity_id);

alter table audit_logs enable row level security;

-- 閲覧: 自分の所属事業所、かつ管理者のみ
drop policy if exists audit_logs_select on audit_logs;
create policy audit_logs_select on audit_logs for select
  using (org_id in (select current_org_ids()) and is_org_admin(org_id));

-- 追加: 自分の所属事業所の行のみ
drop policy if exists audit_logs_insert on audit_logs;
create policy audit_logs_insert on audit_logs for insert
  with check (org_id in (select current_org_ids()));

-- UPDATE / DELETE ポリシーは作らない = 追記専用（改ざん・消去を拒否）
