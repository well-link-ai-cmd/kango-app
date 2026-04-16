-- ============================================================
-- マイグレーション: 褥瘡計画書に「下書きフラグ」を追加
--
-- Supabase ダッシュボード > SQL Editor で実行してください。
--
-- 背景:
--   AI生成前に途中状態で保存したい場面がある（評価途中・途中中断）
--   確定版と区別するため is_draft カラムを追加する
-- ============================================================

ALTER TABLE pressure_ulcer_plans
  ADD COLUMN IF NOT EXISTS is_draft BOOLEAN NOT NULL DEFAULT FALSE;

-- 下書き絞り込み用インデックス
CREATE INDEX IF NOT EXISTS idx_pressure_ulcer_plans_is_draft
  ON pressure_ulcer_plans(patient_id, is_draft);
