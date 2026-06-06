-- =============================================================
-- 015_rollback: migration 015 を元（010 の authenticated 全許可）へ戻す。
--   ※ org スコープが外れ、認証済みなら全事業所の画像にアクセス可能な
--     状態に戻る点に注意（テナント境界が再び開く）。緊急時のみ使用。
-- Supabase ダッシュボード > SQL Editor で実行してください。
-- =============================================================

-- 015 の org スコープポリシーを撤去
drop policy if exists "patient-files org select" on storage.objects;
drop policy if exists "patient-files org insert" on storage.objects;
drop policy if exists "patient-files org update" on storage.objects;
drop policy if exists "patient-files org delete" on storage.objects;

-- 010 の authenticated 全許可ポリシーを復元
drop policy if exists "patient-files authenticated select" on storage.objects;
create policy "patient-files authenticated select"
  on storage.objects for select to authenticated
  using (bucket_id = 'patient-files');

drop policy if exists "patient-files authenticated insert" on storage.objects;
create policy "patient-files authenticated insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'patient-files');

drop policy if exists "patient-files authenticated update" on storage.objects;
create policy "patient-files authenticated update"
  on storage.objects for update to authenticated
  using (bucket_id = 'patient-files')
  with check (bucket_id = 'patient-files');

drop policy if exists "patient-files authenticated delete" on storage.objects;
create policy "patient-files authenticated delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'patient-files');
