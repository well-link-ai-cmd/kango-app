-- =============================================================
-- 012: 事業所メンバー管理（新・管理画面用のRPC）
--
-- 旧 allowed_users / app_settings.org_password 方式に代わり、membership ベースの
-- メンバー管理を提供する。スキーマ・RLSは変更せず、関数の追加のみ（冪等・低リスク）。
--
--   - list_org_members():        自分の所属事業所のメンバー一覧（email付き）
--   - set_member_role():         管理者がメンバーの権限を変更（最後の管理者は降格不可）
--   - remove_member():           管理者がメンバーを事業所から削除（最後の管理者は削除不可）
--   - regenerate_join_code():    管理者が参加コードを再発行（漏えい時用）
--
-- Supabase ダッシュボード > SQL Editor で実行してください。
-- =============================================================

-- 所属事業所のメンバーを email 付きで返す（同じ事業所のメンバーなら閲覧可）。
-- email は auth.users から取るため SECURITY DEFINER。
create or replace function list_org_members()
returns table (user_id uuid, email text, display_name text, role text, joined_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.user_id,
         u.email::text as email,
         coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name') as display_name,
         m.role,
         m.created_at as joined_at
  from memberships m
  join auth.users u on u.id = m.user_id
  where m.org_id in (select org_id from memberships where user_id = auth.uid())
  order by (m.role = 'admin') desc, m.created_at asc
$$;

-- メンバーの権限を変更（呼び出し者が管理者の事業所内のみ）。
create or replace function set_member_role(target_user uuid, new_role text)
returns void language plpgsql security definer set search_path = public as $$
declare my_org uuid;
begin
  if new_role not in ('admin', 'user') then raise exception 'invalid_role'; end if;
  select org_id into my_org from memberships
   where user_id = auth.uid() and role = 'admin' limit 1;
  if my_org is null then raise exception 'not_admin'; end if;
  if not exists (select 1 from memberships where org_id = my_org and user_id = target_user) then
    raise exception 'not_a_member';
  end if;
  -- 最後の管理者を一般に降格させない
  if new_role = 'user'
     and exists (select 1 from memberships where org_id = my_org and user_id = target_user and role = 'admin')
     and (select count(*) from memberships where org_id = my_org and role = 'admin') <= 1 then
    raise exception 'last_admin';
  end if;
  update memberships set role = new_role where org_id = my_org and user_id = target_user;
end $$;

-- メンバーを事業所から削除（呼び出し者が管理者の事業所内のみ）。
create or replace function remove_member(target_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare my_org uuid;
begin
  select org_id into my_org from memberships
   where user_id = auth.uid() and role = 'admin' limit 1;
  if my_org is null then raise exception 'not_admin'; end if;
  -- 最後の管理者は削除不可
  if exists (select 1 from memberships where org_id = my_org and user_id = target_user and role = 'admin')
     and (select count(*) from memberships where org_id = my_org and role = 'admin') <= 1 then
    raise exception 'last_admin';
  end if;
  delete from memberships where org_id = my_org and user_id = target_user;
end $$;

-- 参加コードを再発行（管理者のみ）。漏えい時に旧コードを無効化できる。
create or replace function regenerate_join_code()
returns text language plpgsql security definer set search_path = public as $$
declare my_org uuid; code text;
begin
  select org_id into my_org from memberships where user_id = auth.uid() and role = 'admin' limit 1;
  if my_org is null then raise exception 'not_admin'; end if;
  loop
    code := upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 8));
    exit when not exists (select 1 from organizations where join_code = code);
  end loop;
  update organizations set join_code = code where id = my_org;
  return code;
end $$;
