-- =============================================================
-- R-1 暫定封じ: レガシーテーブルのテナント越境読取を停止
--（セキュリティ監査 2026-07-06 の 🔴R-1 対応・B案＝暫定封じ）
--
-- 問題: allowed_users / app_settings の SELECT が「認証済みなら誰でも」
--       のため、どの事業所のユーザーでも既定事業所のスタッフ氏名・メール・
--       role と org_password の scrypt ハッシュを読める。
--
-- 本SQLの効果: 両テーブルの広い SELECT ポリシーを削除する。
--   - 現行の実運用パス（membership方式・migration 011適用済み）には影響なし
--   - レガシー経路（AuthGateの011未適用フォールバック / admin/users 画面 /
--     check-access）は本番では未使用のため実害なし。ただし将来011未適用
--     環境でこのSQLを流すとログイン判定が壊れるので、必ず011適用済み環境のみで実行
--
-- 冪等: DROP POLICY IF EXISTS のみ。再実行可。
-- 切り戻し: 同フォルダの R1_interim_rollback.sql を実行（002の原文ポリシーを再作成）
--
-- ※ これは対症療法。恒久対応は「レガシー完全撤去」（導入判断メニュー R-1 A案）。
-- =============================================================

-- 実行前チェック（任意）: 011適用済み＝membershipsが存在し自分の行があること
-- select count(*) from memberships where user_id = auth.uid();

DROP POLICY IF EXISTS "Authenticated users can view allowed_users" ON allowed_users;
DROP POLICY IF EXISTS "Authenticated users can view app_settings" ON app_settings;

-- 動作確認（別事業所ユーザーで実行して0件になること）:
-- select count(*) from allowed_users;   -- 0
-- select count(*) from app_settings;    -- 0
