-- =============================================================
-- 011 適用後の検証クエリ（手動実行・読み取りのみ）
-- Supabase ダッシュボード > SQL Editor に貼って実行し、結果を確認する。
-- ※ これは forward migration ではない（manual フォルダに分離）。
-- =============================================================

-- 1) org_id が NULL の行が無いこと（全テーブル 0 件であるべき）
select 'patients'             as t, count(*) as null_org from patients              where org_id is null
union all select 'soap_records',          count(*) from soap_records          where org_id is null
union all select 'nursing_contents',      count(*) from nursing_contents      where org_id is null
union all select 'patient_todos',         count(*) from patient_todos         where org_id is null
union all select 'pressure_ulcer_plans',  count(*) from pressure_ulcer_plans  where org_id is null
union all select 'nursing_care_plans',    count(*) from nursing_care_plans    where org_id is null
union all select 'visit_reports',         count(*) from visit_reports         where org_id is null
union all select 'info_provisions',       count(*) from info_provisions       where org_id is null;
-- 期待: 全行 null_org = 0

-- 2) 事業所とメンバー数（既存ユーザーが「既定の事業所」に入っているか）
select o.id, o.name, o.join_code, count(m.user_id) as members
from organizations o
left join memberships m on m.org_id = o.id
group by o.id, o.name, o.join_code;
-- 期待: 「既定の事業所」が1件、members = これまでログイン済みの許可ユーザー数

-- 3) 各データテーブルに org スコープのRLSポリシーが4つずつあるか
select tablename, count(*) as policies
from pg_policies
where schemaname = 'public'
  and tablename in ('patients','soap_records','nursing_contents','patient_todos',
                    'pressure_ulcer_plans','nursing_care_plans','visit_reports','info_provisions')
group by tablename
order by tablename;
-- 期待: 各テーブル policies = 4

-- 4) ヘルパー関数が揃っているか
select proname
from pg_proc
where proname in ('current_org_ids','is_org_admin','create_organization','join_organization')
order by proname;
-- 期待: 4関数すべて表示される
