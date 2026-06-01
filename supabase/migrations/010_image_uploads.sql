-- =============================================================
-- 010: 画像アップロード基盤
--   - ケアマネのケアプラン写真（patients.care_manager_plan）
--   - 褥瘡計画書の写真（pressure_ulcer_plans.photos）
--   - Supabase Storage の private バケット patient-files + RLS
-- 冪等（再実行可）に記述。Supabase ダッシュボード > SQL Editor で実行してください。
-- =============================================================

-- 1) Storage バケット（private）。ダッシュボードの Storage から作成してもよい。
insert into storage.buckets (id, name, public)
values ('patient-files', 'patient-files', false)
on conflict (id) do nothing;

-- 2) Storage RLS: 認証済みユーザーは patient-files バケットを読み書き可。
--    （既存の soap_records / patients などと同じ「事業所内共有」モデルに合わせる）
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

-- 3) 画像参照カラム（JSONB）。
--    care_manager_plan: { "images": [{ "path": "...", "uploadedAt": "...", "caption": "..." }], "text": "..." }
alter table patients
  add column if not exists care_manager_plan jsonb;

--    photos: [{ "path": "...", "uploadedAt": "...", "caption": "..." }]
alter table pressure_ulcer_plans
  add column if not exists photos jsonb default '[]'::jsonb;
