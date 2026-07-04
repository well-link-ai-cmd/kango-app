-- =============================================================
-- R-1 暫定封じの切り戻し（002_access_control.sql の原文ポリシーを再作成）
-- R1_interim_lockdown.sql 適用後に旧方式（allowed_users 認証）へ戻す必要が
-- 生じた場合のみ実行する。
-- =============================================================

CREATE POLICY "Authenticated users can view allowed_users"
  ON allowed_users FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can view app_settings"
  ON app_settings FOR SELECT
  USING (auth.role() = 'authenticated');
