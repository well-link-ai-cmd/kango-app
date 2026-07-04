-- =============================================================
-- 018: 参加コードの総当たり耐性強化（セキュリティ監査 2026-07-06 指摘 Y-1①）
--
-- 背景: join_code は8桁（16^8 ≒ 43億通り）で、join_organization RPC に
--       レート制限がない。事業所数が増えるほど総当たりでどこかに当たる
--       確率が上がる（誕生日問題）。16桁（16^16 ≒ 1.8e19通り）へ延長する。
--
-- 影響: 新規発行分（新規事業所作成・コード再発行）のみ16桁になる。
--       既存事業所の8桁コードはそのまま有効（無効化しない＝適用時の影響ゼロ）。
--       既存コードも強化したい場合は、適用後に管理画面の「参加コード再発行」を実行する。
--
-- 内容: 011 の create_organization / 012 の regenerate_join_code を
--       「コード長 8→16」のみ変更して置換（他のロジックは原文どおり）。
-- 冪等: CREATE OR REPLACE のみ。再実行可。
-- 切り戻し: 011_multi_tenant.sql / 012_org_member_admin.sql の同名関数定義を再実行。
--
-- Supabase ダッシュボード > SQL Editor で実行してください。
-- =============================================================

-- 事業所の新規作成（011 原文の「from 1 for 8」→「from 1 for 16」のみ変更）
create or replace function create_organization(org_name text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare new_org uuid; code text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if org_name is null or btrim(org_name) = '' then raise exception 'name_required'; end if;
  -- 衝突しにくい16桁の参加コードを生成
  loop
    code := upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 16));
    exit when not exists (select 1 from organizations where join_code = code);
  end loop;
  insert into organizations (name, join_code, created_by)
  values (btrim(org_name), code, auth.uid())
  returning id into new_org;
  insert into memberships (org_id, user_id, role)
  values (new_org, auth.uid(), 'admin');
  return new_org;
end $$;

-- 参加コードの再発行（012 原文の「from 1 for 8」→「from 1 for 16」のみ変更）
create or replace function regenerate_join_code()
returns text language plpgsql security definer set search_path = public as $$
declare my_org uuid; code text;
begin
  select org_id into my_org from memberships where user_id = auth.uid() and role = 'admin' limit 1;
  if my_org is null then raise exception 'not_admin'; end if;
  loop
    code := upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 16));
    exit when not exists (select 1 from organizations where join_code = code);
  end loop;
  update organizations set join_code = code where id = my_org;
  return code;
end $$;
