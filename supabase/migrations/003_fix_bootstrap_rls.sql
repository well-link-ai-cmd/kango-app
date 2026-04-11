-- ============================================================
-- Fix: 初期セットアップ時のRLS問題を修正
--
-- 問題: allowed_users への INSERT は is_admin() が必要だが、
-- 初期セットアップ時は管理者が誰もいないためブートストラップができない
--
-- 解決: allowed_users が空の場合はINSERTを許可する
-- ============================================================

-- 既存のINSERTポリシーを削除
DROP POLICY IF EXISTS "Admins can insert allowed_users" ON allowed_users;

-- 新しいINSERTポリシー: 管理者 OR テーブルが空の場合
CREATE POLICY "Admins or bootstrap can insert allowed_users"
  ON allowed_users FOR INSERT
  WITH CHECK (
    is_admin()
    OR NOT EXISTS (SELECT 1 FROM allowed_users)
  );
