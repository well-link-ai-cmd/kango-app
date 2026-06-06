-- =============================================================
-- 015_verify: migration 015（Storage 事業所スコープRLS）の適用前後チェック
-- Supabase ダッシュボード > SQL Editor で1つずつ実行してください。
-- =============================================================

-- 【適用前・最重要】patient-files バケットの既存オブジェクト件数。
--   0 であれば移行不要・無影響で 015 を適用できる。
--   1以上の場合は、各 name の先頭フォルダが全て org_id（uuid）になっているかを
--   下の「旧パス検出」で確認してから適用すること（旧パスは適用後に見えなくなる）。
select count(*) as total_objects
from storage.objects
where bucket_id = 'patient-files';

-- 旧パス（先頭フォルダが org_id=uuid ではない）の検出。
--   ここで 0 行ならすべて新パス形式。1行でも出たら 015 適用で不可視になる。
select name, (storage.foldername(name))[1] as first_folder
from storage.objects
where bucket_id = 'patient-files'
  and (storage.foldername(name))[1] !~ '^[0-9a-fA-F-]{36}$'
limit 50;

-- 【適用後】ポリシーが org スコープに置き換わっているか確認。
--   "patient-files org select/insert/update/delete" の4本が出ればOK。
--   旧 "patient-files authenticated *" が消えていることも確認。
select policyname, cmd
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and policyname like 'patient-files%'
order by policyname;
