-- =============================================================
-- 011: マルチテナント基盤（事業所ごとのデータ分離）
--
-- これまでは「ログイン済みなら全データ閲覧可（RLS = authenticated）」で、
-- 1デプロイ＝1事業所が構造的な前提だった。本マイグレーションで:
--   - organizations（事業所）/ memberships（ユーザー⇔事業所）を新設
--   - 全データテーブルに org_id を付与
--   - RLS を「自分の所属事業所の行だけ」に全面書き換え
--   - 既存データは「既定の事業所」に移行（後方互換・DB再構築不要）
--   - セルフ登録用の RPC（create_organization / join_organization）を用意
-- これにより 1つのデプロイで複数事業所を完全分離して運用できる。
--
-- ※ 重要: org_id を書き込む新アプリコードとセットで適用すること。
--   旧コードのままだと org_id 未設定で書き込みが弾かれる。
--   低トラフィック時間に実行し、可能なら Supabase Branching で先に検証する。
-- 冪等（再実行可）。Supabase ダッシュボード > SQL Editor で実行してください。
-- =============================================================

-- 対象データテーブル（org_id を持たせて分離する 8テーブル）。
-- ※ allowed_users / app_settings は事業所横断の認証設定なので対象外（別RLS維持）。

-- ============================================================
-- STEP 1: organizations / memberships テーブル
-- ============================================================
create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  join_code text not null unique,          -- スタッフが参加に使う合言葉
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

create table if not exists memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'user' check (role in ('admin', 'user')),
  created_at timestamptz default now(),
  unique (org_id, user_id)
);

create index if not exists idx_memberships_user on memberships(user_id);
create index if not exists idx_memberships_org on memberships(org_id);

-- ============================================================
-- STEP 2: 全データテーブルに org_id を追加（最初は NULL 許可）+ インデックス
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array[
    'patients','soap_records','nursing_contents','patient_todos',
    'pressure_ulcer_plans','nursing_care_plans','visit_reports','info_provisions'
  ] loop
    execute format('alter table public.%I add column if not exists org_id uuid references organizations(id)', t);
    execute format('create index if not exists %I on public.%I(org_id)', 'idx_'||t||'_org', t);
  end loop;
end $$;

-- ============================================================
-- STEP 3: ヘルパー関数
--   SECURITY DEFINER（= postgres 権限で実行 → RLS をバイパス）にすることで、
--   memberships を参照する RLS ポリシーの無限再帰を防ぐ。
-- ============================================================

-- 現在のユーザーが所属する事業所ID群
create or replace function current_org_ids()
returns setof uuid
language sql stable security definer set search_path = public as $$
  select org_id from memberships where user_id = auth.uid()
$$;

-- 指定事業所の管理者かどうか
create or replace function is_org_admin(target_org uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from memberships
    where user_id = auth.uid() and org_id = target_org and role = 'admin'
  )
$$;

-- 事業所を新規作成し、作成者を管理者として登録（セルフ登録: 1人目）
create or replace function create_organization(org_name text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare new_org uuid; code text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if org_name is null or btrim(org_name) = '' then raise exception 'name_required'; end if;
  -- 衝突しにくい8桁の参加コードを生成
  loop
    code := upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 8));
    exit when not exists (select 1 from organizations where join_code = code);
  end loop;
  insert into organizations (name, join_code, created_by)
  values (btrim(org_name), code, auth.uid())
  returning id into new_org;
  insert into memberships (org_id, user_id, role)
  values (new_org, auth.uid(), 'admin');
  return new_org;
end $$;

-- 参加コードで既存の事業所に参加（セルフ登録: 2人目以降）
create or replace function join_organization(code text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare target_org uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select id into target_org from organizations
  where upper(join_code) = upper(btrim(coalesce(code, '')));
  if target_org is null then raise exception 'invalid_code'; end if;
  insert into memberships (org_id, user_id, role)
  values (target_org, auth.uid(), 'user')
  on conflict (org_id, user_id) do nothing;
  return target_org;
end $$;

-- ============================================================
-- STEP 4: 既存データを「既定の事業所」へ移行（後方互換）
-- ============================================================
do $$
declare default_org uuid; t text;
begin
  -- 既定事業所（再実行時は最古の組織を流用）
  select id into default_org from organizations order by created_at asc limit 1;
  if default_org is null then
    insert into organizations (name, join_code, created_by)
    values (
      '既定の事業所',
      upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 8)),
      null
    )
    returning id into default_org;
  end if;

  -- 既存の許可ユーザー（allowed_users）のうち、ログイン済み（auth.users に存在）の
  -- ユーザーを default_org のメンバーとして登録する。email で突合。
  insert into memberships (org_id, user_id, role)
  select default_org, u.id, coalesce(au.role, 'user')
  from allowed_users au
  join auth.users u on lower(u.email) = lower(au.email)
  on conflict (org_id, user_id) do nothing;

  -- org_id 未設定の既存行をすべて default_org に割り当て
  foreach t in array array[
    'patients','soap_records','nursing_contents','patient_todos',
    'pressure_ulcer_plans','nursing_care_plans','visit_reports','info_provisions'
  ] loop
    execute format('update public.%I set org_id = %L where org_id is null', t, default_org);
  end loop;
end $$;

-- ============================================================
-- STEP 5: org_id を NOT NULL 化（移行後）
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array[
    'patients','soap_records','nursing_contents','patient_todos',
    'pressure_ulcer_plans','nursing_care_plans','visit_reports','info_provisions'
  ] loop
    execute format('alter table public.%I alter column org_id set not null', t);
  end loop;
end $$;

-- ============================================================
-- STEP 6: organizations / memberships の RLS
-- ============================================================
alter table organizations enable row level security;
alter table memberships enable row level security;

drop policy if exists "org members can view org" on organizations;
create policy "org members can view org"
  on organizations for select
  using (id in (select current_org_ids()));

drop policy if exists "org admins can update org" on organizations;
create policy "org admins can update org"
  on organizations for update
  using (is_org_admin(id))
  with check (is_org_admin(id));
-- organizations への insert/delete は create_organization() 経由のみ（直接ポリシー無し＝拒否）

drop policy if exists "members can view org memberships" on memberships;
create policy "members can view org memberships"
  on memberships for select
  using (org_id in (select current_org_ids()));

drop policy if exists "admins can add memberships" on memberships;
create policy "admins can add memberships"
  on memberships for insert
  with check (is_org_admin(org_id));
-- 本人によるセルフ参加は join_organization() 経由（SECURITY DEFINER）で実施

drop policy if exists "admins can update memberships" on memberships;
create policy "admins can update memberships"
  on memberships for update
  using (is_org_admin(org_id))
  with check (is_org_admin(org_id));

drop policy if exists "admins or self can remove memberships" on memberships;
create policy "admins or self can remove memberships"
  on memberships for delete
  using (is_org_admin(org_id) or user_id = auth.uid());

-- ============================================================
-- STEP 7: データテーブルの RLS を org スコープへ全面書き換え
--   既存の「authenticated 全許可」ポリシーを名前に依存せず一括削除し、
--   org_id ベースの4ポリシー（select/insert/update/delete）を作り直す。
-- ============================================================
do $$
declare
  pol record;
  t text;
  tables text[] := array[
    'patients','soap_records','nursing_contents','patient_todos',
    'pressure_ulcer_plans','nursing_care_plans','visit_reports','info_provisions'
  ];
begin
  -- 既存ポリシーを全削除
  for pol in
    select policyname, tablename from pg_policies
    where schemaname = 'public' and tablename = any(tables)
  loop
    execute format('drop policy if exists %I on public.%I', pol.policyname, pol.tablename);
  end loop;

  -- RLS 有効化（保険）＋ org スコープのポリシーを作成
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using (org_id in (select current_org_ids()))', t||'_org_select', t);
    execute format('create policy %I on public.%I for insert with check (org_id in (select current_org_ids()))', t||'_org_insert', t);
    execute format('create policy %I on public.%I for update using (org_id in (select current_org_ids())) with check (org_id in (select current_org_ids()))', t||'_org_update', t);
    execute format('create policy %I on public.%I for delete using (org_id in (select current_org_ids()))', t||'_org_delete', t);
  end loop;
end $$;
