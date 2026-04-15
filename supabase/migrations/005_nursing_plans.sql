-- ============================================================
-- マイグレーション: 看護計画・評価機能
--
-- Supabase ダッシュボード > SQL Editor で実行してください。
--
-- 目的:
--   現状 patients.care_plan に「訪問方針」「看護計画」が混在している。
--   看護計画を別テーブルに分離し、定期評価（デフォルト6ヶ月）と
--   AI支援による修正提案・承認フローを可能にする。
--
-- 設計方針:
--   - patients.care_plan は「訪問方針・ケアマネ連携事項」として残す
--     （SOAP生成プロンプトでは引き続き参照）
--   - nursing_plans を別テーブルで保持し、version で履歴を積み上げる
--   - 評価は patients.next_evaluation_date / evaluation_cycle_months で管理
--   - 評価結果と AI提案は nursing_plan_evaluations に保存
-- ============================================================

-- ------------------------------------------------------------
-- 1. patients テーブル: 評価スケジュール列を追加
-- ------------------------------------------------------------
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS next_evaluation_date DATE,
  ADD COLUMN IF NOT EXISTS evaluation_cycle_months INTEGER DEFAULT 6;

COMMENT ON COLUMN patients.next_evaluation_date IS
  '次回看護計画評価予定日。NULL の場合はアラート対象外。';
COMMENT ON COLUMN patients.evaluation_cycle_months IS
  '看護計画の評価周期（月）。デフォルト6。評価完了時に next_evaluation_date を自動更新する際に使用。';


-- ------------------------------------------------------------
-- 2. nursing_plans: 看護計画本体（世代管理）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nursing_plans (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),

  -- 問題リスト（構造化）
  -- [{ id, problem, goal, interventions: string[] }]
  problems JSONB NOT NULL DEFAULT '[]'::jsonb,

  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  note TEXT,  -- 計画全体の補足メモ（任意）

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  user_id UUID REFERENCES auth.users(id),

  -- 同一患者で active は原則1件（UIで制御するが、DB側でもpartial indexで保護）
  UNIQUE (patient_id, version)
);

CREATE INDEX IF NOT EXISTS idx_nursing_plans_patient_id ON nursing_plans(patient_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_nursing_plans_one_active_per_patient
  ON nursing_plans(patient_id) WHERE status = 'active';


-- ------------------------------------------------------------
-- 3. nursing_plan_evaluations: 評価記録
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nursing_plan_evaluations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_id UUID NOT NULL REFERENCES nursing_plans(id) ON DELETE CASCADE,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,

  evaluation_date DATE NOT NULL DEFAULT CURRENT_DATE,

  -- 評価対象のSOAP期間
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,

  -- 問題ごとの評価
  -- [{ problem_id, problem, achievement: 'achieved'|'partial'|'not_achieved',
  --    evidence: string, evidence_soap_ids?: string[] }]
  evaluations JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- AIが提案した次期計画の修正案（承認前）
  -- { problems: [...], overall_comment: string }
  ai_suggestions JSONB,

  -- 採用された場合、新しく作成された nursing_plans.id を指す
  adopted_plan_id UUID REFERENCES nursing_plans(id) ON DELETE SET NULL,

  -- 評価種別
  trigger_type TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (trigger_type IN ('scheduled', 'adhoc')),

  notes TEXT,  -- 看護師のコメント

  created_at TIMESTAMPTZ DEFAULT NOW(),
  user_id UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_nursing_plan_evaluations_patient_id
  ON nursing_plan_evaluations(patient_id);
CREATE INDEX IF NOT EXISTS idx_nursing_plan_evaluations_plan_id
  ON nursing_plan_evaluations(plan_id);


-- ------------------------------------------------------------
-- 4. RLS: 認証済みユーザーは全操作可能（事業所内共有モデル）
-- ------------------------------------------------------------
ALTER TABLE nursing_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE nursing_plan_evaluations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view nursing_plans"
  ON nursing_plans FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can insert nursing_plans"
  ON nursing_plans FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can update nursing_plans"
  ON nursing_plans FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can delete nursing_plans"
  ON nursing_plans FOR DELETE USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can view nursing_plan_evaluations"
  ON nursing_plan_evaluations FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can insert nursing_plan_evaluations"
  ON nursing_plan_evaluations FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can update nursing_plan_evaluations"
  ON nursing_plan_evaluations FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can delete nursing_plan_evaluations"
  ON nursing_plan_evaluations FOR DELETE USING (auth.role() = 'authenticated');
