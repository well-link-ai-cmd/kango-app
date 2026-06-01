-- =============================================================
-- 014: 看護計画の評価周期（事業所ごとに設定）
--
-- organizations に care_plan_review_months（既定6）を追加し、管理者が設定できる
-- RPC を用意する。アプリ側で「最終評価日（作成日 or 課題評価日）＋この月数」を
-- 過ぎた有効計画を「評価時期」としてアラート表示する。
--
-- スキーマ追加＋関数のみ（既存データ・RLSは変更なし）。冪等。
-- Supabase ダッシュボード > SQL Editor で実行してください。
-- =============================================================

alter table organizations
  add column if not exists care_plan_review_months integer not null default 6;

-- 管理者が自事業所の評価周期（月）を設定（1〜60ヶ月）
create or replace function set_care_plan_review_months(months integer)
returns void language plpgsql security definer set search_path = public as $$
declare my_org uuid;
begin
  if months is null or months < 1 or months > 60 then raise exception 'invalid_months'; end if;
  select org_id into my_org from memberships where user_id = auth.uid() and role = 'admin' limit 1;
  if my_org is null then raise exception 'not_admin'; end if;
  update organizations set care_plan_review_months = months where id = my_org;
end $$;
