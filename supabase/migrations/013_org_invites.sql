-- =============================================================
-- 013: メール招待（事前登録）
--
-- 「こちらで先にメールを登録 → 本人が初回ログインした瞬間、参加コード不要で
--   指定権限のまま自動参加」を実現する。旧 allowed_users の運用を新システムへ移植。
--
--   - org_invites テーブル（招待中のメール＋権限）
--   - invite_member()   … 管理者がメール招待を追加（権限指定可）
--   - accept_invites()  … ログイン時に自分宛て招待を消化してメンバー化（SECURITY DEFINER）
--   - 旧 allowed_users のうち未参加のメールを org_invites へ一括移行（今回きりの再登録）
--
-- スキーマ追加＋関数のみ。既存データ・RLSは変更しない。冪等。
-- Supabase ダッシュボード > SQL Editor で実行してください。
-- =============================================================

-- ============================================================
-- STEP 1: org_invites テーブル
-- ============================================================
create table if not exists org_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  email text not null,                       -- 小文字で保存
  role text not null default 'user' check (role in ('admin', 'user')),
  invited_by uuid references auth.users(id),
  created_at timestamptz default now(),
  unique (org_id, email)
);
create index if not exists idx_org_invites_email on org_invites(email);

alter table org_invites enable row level security;

-- 管理者は自事業所の招待を閲覧・取消できる（追加は invite_member 経由）
drop policy if exists "org admins view invites" on org_invites;
create policy "org admins view invites"
  on org_invites for select using (is_org_admin(org_id));

drop policy if exists "org admins delete invites" on org_invites;
create policy "org admins delete invites"
  on org_invites for delete using (is_org_admin(org_id));

-- ============================================================
-- STEP 2: 関数
-- ============================================================

-- 管理者がメール招待を追加（同一メールは権限を上書き）
create or replace function invite_member(invite_email text, invite_role text default 'user')
returns void language plpgsql security definer set search_path = public as $$
declare my_org uuid; norm_email text;
begin
  if invite_role not in ('admin', 'user') then raise exception 'invalid_role'; end if;
  select org_id into my_org from memberships where user_id = auth.uid() and role = 'admin' limit 1;
  if my_org is null then raise exception 'not_admin'; end if;
  norm_email := lower(btrim(coalesce(invite_email, '')));
  if norm_email = '' or position('@' in norm_email) = 0 then raise exception 'invalid_email'; end if;
  insert into org_invites (org_id, email, role, invited_by)
  values (my_org, norm_email, invite_role, auth.uid())
  on conflict (org_id, email) do update set role = excluded.role;
end $$;

-- ログイン中ユーザー宛ての招待を消化してメンバー化。作成件数を返す。
create or replace function accept_invites()
returns int language plpgsql security definer set search_path = public as $$
declare my_email text; cnt int := 0;
begin
  if auth.uid() is null then return 0; end if;
  select lower(email) into my_email from auth.users where id = auth.uid();
  if my_email is null then return 0; end if;

  insert into memberships (org_id, user_id, role)
  select oi.org_id, auth.uid(), oi.role
  from org_invites oi
  where oi.email = my_email
  on conflict (org_id, user_id) do nothing;
  get diagnostics cnt = row_count;

  -- 消費した招待は削除
  delete from org_invites where email = my_email;
  return cnt;
end $$;

-- ============================================================
-- STEP 3: 旧 allowed_users の未参加メールを招待へ一括移行（今回きりの再登録）
--   既にメンバーの人は除外。権限(role)はそのまま引き継ぐ。
-- ============================================================
do $$
declare default_org uuid;
begin
  select id into default_org from organizations order by created_at asc limit 1;
  if default_org is null then return; end if;

  insert into org_invites (org_id, email, role)
  select default_org, lower(au.email), coalesce(au.role, 'user')
  from allowed_users au
  where not exists (
    select 1
    from auth.users u
    join memberships m on m.user_id = u.id and m.org_id = default_org
    where lower(u.email) = lower(au.email)
  )
  on conflict (org_id, email) do nothing;
end $$;
