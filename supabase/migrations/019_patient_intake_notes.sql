-- =============================================================
-- 019: 利用者の導入時情報（退院前カンファレンス・申し送り等）
--
-- 背景: 退院前カンファレンスの内容が看護計画ページ（nursing_care_plans.
--       conference_memo）にしか入力できず、①導線が分かりにくい
--       ②計画未作成だと置き場がない ③初回SOAP生成の参考にできない。
-- 対応: patients に intake_notes（自由テキスト）を追加し、基礎情報で
--       入力 → SOAP生成の判断材料＋看護計画のカンファ欄プリフィルに使う。
--
-- 影響: 列追加のみ（nullable）。既存データ・既存挙動への影響なし。
-- 冪等: IF NOT EXISTS。再実行可。
-- 切り戻し: alter table patients drop column if exists intake_notes;
--
-- ⚠️ 適用順序: 本SQLを先に適用してからコードをデプロイすること
--（コードが先だと patients 保存時に列不存在エラーになる）。
-- =============================================================

alter table patients add column if not exists intake_notes text;

comment on column patients.intake_notes is
  '導入時情報（退院前カンファレンス・申し送り・サマリ等の自由テキスト）。SOAP生成の判断材料・看護計画カンファ欄のプリフィルに使用';
