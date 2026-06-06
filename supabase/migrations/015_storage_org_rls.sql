-- =============================================================
-- 015: Storage(patient-files) を「事業所ごと」のRLSへ
--
-- 背景: migration 010 では patient-files バケットの RLS が
--   「authenticated なら誰でも read/write/delete 可」だった。
--   DBテーブルは 011 で org_id ＋ RLS により事業所分離済みなのに、
--   画像（ケアプラン写真・褥瘡創部写真など医療情報）だけが
--   テナント境界の外にあり、別事業所のユーザーでも理論上アクセスできた。
--
-- 本マイグレーションで、保存パスの先頭フォルダ＝org_id を使い、
--   「自分の所属事業所(current_org_ids())のフォルダ配下だけ」に限定する。
--   アプリ側（lib/storage.ts の uploadPatientImage）は保存パスを
--   `<org_id>/<prefix>/<uuid>.<ext>` 形式に変更済み。
--
-- ⚠️ 適用の前提（重要）:
--   既存オブジェクトが0件、または全て新パス形式（先頭=org_id）であること。
--   旧パス（先頭が care-manager-plan / pressure-ulcer 等）のオブジェクトが
--   残っていると、本ポリシー適用後は表示・取得できなくなる。
--   適用前に supabase/manual/015_verify.sql の件数チェックを必ず実行すること。
--   （ロールバックは supabase/manual/015_rollback.sql）
--
-- 冪等（再実行可）。Supabase ダッシュボード > SQL Editor で実行してください。
-- =============================================================

-- 旧（010）の「authenticated 全許可」ポリシーを撤去
drop policy if exists "patient-files authenticated select" on storage.objects;
drop policy if exists "patient-files authenticated insert" on storage.objects;
drop policy if exists "patient-files authenticated update" on storage.objects;
drop policy if exists "patient-files authenticated delete" on storage.objects;

-- 念のため新ポリシーも一旦落としてから作り直す（再実行時の冪等性）
drop policy if exists "patient-files org select" on storage.objects;
drop policy if exists "patient-files org insert" on storage.objects;
drop policy if exists "patient-files org update" on storage.objects;
drop policy if exists "patient-files org delete" on storage.objects;

-- 事業所スコープのポリシー。
--   (storage.foldername(name))[1] = パス先頭フォルダ（= org_id 文字列）。
--   current_org_ids()::text と突合（uuidキャストせず text 比較なので、
--   先頭が uuid でない不正パスはエラーにならず単に不一致＝拒否される）。
create policy "patient-files org select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'patient-files'
    and (storage.foldername(name))[1] in (select current_org_ids()::text)
  );

create policy "patient-files org insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'patient-files'
    and (storage.foldername(name))[1] in (select current_org_ids()::text)
  );

create policy "patient-files org update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'patient-files'
    and (storage.foldername(name))[1] in (select current_org_ids()::text)
  )
  with check (
    bucket_id = 'patient-files'
    and (storage.foldername(name))[1] in (select current_org_ids()::text)
  );

create policy "patient-files org delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'patient-files'
    and (storage.foldername(name))[1] in (select current_org_ids()::text)
  );
