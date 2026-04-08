-- ============================================================
-- マイグレーション: ユーザー認証 & Row Level Security (RLS)
--
-- Supabase ダッシュボード > SQL Editor で実行してください。
--
-- このマイグレーションは以下を行います：
-- 1. 全テーブルに user_id カラムを追加（作成者の記録用）
-- 2. RLS を有効化
-- 3. 認証済みユーザーなら全データにアクセスできるポリシーを作成
--
-- ※ user_id は「誰が作成したか」の監査記録用です。
--   同じ事業所のスタッフ全員が全患者データを共有できます。
-- ============================================================

-- ============================================================
-- STEP 1: user_id カラムを追加（作成者の記録用・NULLable）
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
-- STEP 2: RLS 有効化
-- ============================================================

ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE soap_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE nursing_contents ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- STEP 3: RLS ポリシー作成
--
-- 認証済みユーザー（ログイン済み）であれば全データの
-- 閲覧・作成・編集・削除が可能。
-- 未認証（ログインしていない）アクセスは全て拒否。
--
-- → 同じ事業所のスタッフ全員が患者データを共有できます。
-- ============================================================

-- patients ポリシー
CREATE POLICY "Authenticated users can view all patients"
  ON patients FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can insert patients"
  ON patients FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update patients"
  ON patients FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete patients"
  ON patients FOR DELETE
  USING (auth.role() = 'authenticated');

-- soap_records ポリシー
CREATE POLICY "Authenticated users can view all records"
  ON soap_records FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can insert records"
  ON soap_records FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update records"
  ON soap_records FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete records"
  ON soap_records FOR DELETE
  USING (auth.role() = 'authenticated');

-- nursing_contents ポリシー
CREATE POLICY "Authenticated users can view all nursing contents"
  ON nursing_contents FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can insert nursing contents"
  ON nursing_contents FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update nursing contents"
  ON nursing_contents FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete nursing contents"
  ON nursing_contents FOR DELETE
  USING (auth.role() = 'authenticated');
