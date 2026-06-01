-- =============================================================
-- 011 のロールバック（緊急用・手動実行）
-- pre-011 の「authenticated 全許可」RLS に戻す。
-- ※ これは forward migration ではない（manual フォルダに分離）。
--
-- 既定では organizations / memberships / org_id 列は「残す」安全側。
--   → 新コードのままでも動作する（org_id は無害に書かれるだけ）。
--   → 再度 011 を当て直すのも容易。
-- 完全撤去したい場合のみ、末尾のコメントブロックを実行する（通常は不要）。
-- =============================================================

do $$
declare
  pol record;
  t text;
  tables text[] := array[
    'patients','soap_records','nursing_contents','patient_todos',
    'pressure_ulcer_plans','nursing_care_plans','visit_reports','info_provisions'
  ];
begin
  -- org スコープのポリシーを含む既存ポリシーを全削除
  for pol in
    select policyname, tablename from pg_policies
    where schemaname = 'public' and tablename = any(tables)
  loop
    execute format('drop policy if exists %I on public.%I', pol.policyname, pol.tablename);
  end loop;

  -- pre-011 と同じ「ログイン済みなら全データ可」ポリシーを復元
  foreach t in array tables loop
    execute format('create policy %I on public.%I for select using (auth.role() = ''authenticated'')', t||'_auth_select', t);
    execute format('create policy %I on public.%I for insert with check (auth.role() = ''authenticated'')', t||'_auth_insert', t);
    execute format('create policy %I on public.%I for update using (auth.role() = ''authenticated'')', t||'_auth_update', t);
    execute format('create policy %I on public.%I for delete using (auth.role() = ''authenticated'')', t||'_auth_delete', t);
  end loop;
end $$;

-- ここまでで「事業所分離は無効・全員が全データ閲覧可（＝pre-011 の挙動）」に戻る。

-- -------------------------------------------------------------
-- ★ 完全撤去（構造ごと削除）したい場合のみ、以下を実行（通常は不要）
-- -------------------------------------------------------------
-- do $$ declare t text; begin
--   foreach t in array array[
--     'patients','soap_records','nursing_contents','patient_todos',
--     'pressure_ulcer_plans','nursing_care_plans','visit_reports','info_provisions'
--   ] loop
--     execute format('alter table public.%I drop column if exists org_id', t);
--   end loop;
-- end $$;
-- drop function if exists join_organization(text);
-- drop function if exists create_organization(text);
-- drop function if exists is_org_admin(uuid);
-- drop function if exists current_org_ids();
-- drop table if exists memberships;
-- drop table if exists organizations;
