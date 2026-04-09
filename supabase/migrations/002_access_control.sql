-- ============================================================
-- マイグレーション: アクセス制御（許可ユーザー管理）
--
-- Supabase ダッシュボード > SQL Editor で実行してください。
--
-- このマイグレーションは以下を行います：
-- 1. allowed_users テーブル作成（許可メールアドレス管理）
-- 2. app_settings テーブル作成（事業所パスワード等の設定）
-- 3. RLS ポリシー設定
-- 4. 管理者判定用の関数作成
-- ============================================================

-- ============================================================
-- STEP 1: allowed_users テーブル（許可ユーザー管理）
-- ============================================================

CREATE TABLE IF NOT EXISTS allowed_users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  display_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- STEP 2: app_settings テーブル（アプリ設定）
-- ============================================================

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- STEP 3: 管理者判定用の関数
-- ============================================================

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM allowed_users
    WHERE email = (auth.jwt() ->> 'email')
    AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- STEP 4: RLS 有効化 & ポリシー
-- ============================================================

ALTER TABLE allowed_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- allowed_users: 認証済みユーザーは閲覧可能（ログイン時のチェック用）
CREATE POLICY "Authenticated users can view allowed_users"
  ON allowed_users FOR SELECT
  USING (auth.role() = 'authenticated');

-- allowed_users: 管理者のみ追加・編集・削除可能
CREATE POLICY "Admins can insert allowed_users"
  ON allowed_users FOR INSERT
  WITH CHECK (is_admin());

CREATE POLICY "Admins can update allowed_users"
  ON allowed_users FOR UPDATE
  USING (is_admin());

CREATE POLICY "Admins can delete allowed_users"
  ON allowed_users FOR DELETE
  USING (is_admin());

-- app_settings: 認証済みユーザーは閲覧可能（パスワード検証用）
CREATE POLICY "Authenticated users can view app_settings"
  ON app_settings FOR SELECT
  USING (auth.role() = 'authenticated');

-- app_settings: 管理者のみ変更可能
CREATE POLICY "Admins can insert app_settings"
  ON app_settings FOR INSERT
  WITH CHECK (is_admin());

CREATE POLICY "Admins can update app_settings"
  ON app_settings FOR UPDATE
  USING (is_admin());
