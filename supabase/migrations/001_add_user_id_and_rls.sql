-- ============================================================
-- マイグレーション: ユーザー認証 & Row Level Security (RLS)
--
-- Supabase ダッシュボード > SQL Editor で実行してください。
--
-- このマイグレーションは以下を行います：
-- 1. 全テーブルに user_id カラムを追加
-- 2. RLS を有効化
-- 3. 認証済みユーザーが自分のデータのみアクセスできるポリシーを作成
-- ============================================================

-- ============================================================
-- STEP 1: user_id カラムを追加
-- ============================================================

-- patients テーブル
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

-- soap_records テーブル
ALTER TABLE soap_records
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

-- nursing_contents テーブル
ALTER TABLE nursing_contents
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

-- ============================================================
-- STEP 2: 既存データに user_id を設定
--
-- ⚠ 重要: 以下の行の 'YOUR_USER_UUID' を、
--   Supabase ダッシュボード > Authentication > Users で
--   作成したユーザーの UUID に置き換えてから実行してください。
--
-- 例: UPDATE patients SET user_id = 'a1b2c3d4-e5f6-...' WHERE user_id IS NULL;
-- ============================================================

-- UPDATE patients SET user_id = 'YOUR_USER_UUID' WHERE user_id IS NULL;
-- UPDATE soap_records SET user_id = 'YOUR_USER_UUID' WHERE user_id IS NULL;
-- UPDATE nursing_contents SET user_id = 'YOUR_USER_UUID' WHERE user_id IS NULL;

-- ============================================================
-- STEP 3: RLS 有効化
-- ============================================================

ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE soap_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE nursing_contents ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- STEP 4: RLS ポリシー作成
-- 認証済みユーザーは自分の user_id のデータのみ操作可能
-- ============================================================

-- patients ポリシー
CREATE POLICY "Users can view own patients"
  ON patients FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own patients"
  ON patients FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own patients"
  ON patients FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own patients"
  ON patients FOR DELETE
  USING (auth.uid() = user_id);

-- soap_records ポリシー
CREATE POLICY "Users can view own records"
  ON soap_records FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own records"
  ON soap_records FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own records"
  ON soap_records FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own records"
  ON soap_records FOR DELETE
  USING (auth.uid() = user_id);

-- nursing_contents ポリシー
CREATE POLICY "Users can view own nursing contents"
  ON nursing_contents FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own nursing contents"
  ON nursing_contents FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own nursing contents"
  ON nursing_contents FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own nursing contents"
  ON nursing_contents FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================
-- STEP 5 (任意): user_id NOT NULL 制約を追加
--
-- ⚠ STEP 2 で既存データに user_id を設定した後に実行してください。
--   先にこれを実行すると既存データでエラーになります。
-- ============================================================

-- ALTER TABLE patients ALTER COLUMN user_id SET NOT NULL;
-- ALTER TABLE soap_records ALTER COLUMN user_id SET NOT NULL;
-- ALTER TABLE nursing_contents ALTER COLUMN user_id SET NOT NULL;
