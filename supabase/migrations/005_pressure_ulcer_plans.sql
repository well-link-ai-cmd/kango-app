-- ============================================================
-- マイグレーション: 褥瘡計画書（褥瘡対策に関する看護計画書）
--
-- Supabase ダッシュボード > SQL Editor で実行してください。
--
-- 厚労省通知「保発0305第12号（令和6年3月5日）」別紙様式に準拠。
-- 訪問看護の専門管理加算（2024年新設・月250単位）算定要件対応。
--
-- AI責任分界ルール:
--   - DESIGN-Rの採点は看護師手入力（AIは採点しない）
--   - 危険因子評価・日常生活自立度も看護師判断
--   - 看護計画の5軸はAI下書き → 看護師確認必須
-- ============================================================

CREATE TABLE IF NOT EXISTS pressure_ulcer_plans (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,

  -- 監査情報
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  user_id UUID REFERENCES auth.users(id),  -- 最終更新者

  -- 基本情報
  plan_date DATE NOT NULL,                  -- 計画作成日
  next_review_date DATE,                    -- 次回評価日（作成日+2週間想定）
  staff_name TEXT,                          -- 記入看護師名
  staff_title TEXT,                         -- 肩書き

  -- 日常生活自立度（J1 / J2 / A1 / A2 / B1 / B2 / C1 / C2）
  -- A2以下は作成不要、B1以上で必須（看護師判断）
  daily_life_level TEXT CHECK (daily_life_level IN ('J1','J2','A1','A2','B1','B2','C1','C2')),

  -- 危険因子評価（7項目・看護師判断／JSON）
  -- 例: {"basic_mobility_bed":"できない","basic_mobility_chair":"できる",
  --      "bony_prominence":"あり","contracture":"なし","nutrition":"あり",
  --      "moisture":"なし","fragile_skin":"あり"}
  risk_factors JSONB DEFAULT '{}'::jsonb,

  -- リスクアセスメント
  oh_scale_score INTEGER CHECK (oh_scale_score BETWEEN 0 AND 10),  -- OHスケール 0-10点

  -- 現在の褥瘡
  has_current_ulcer BOOLEAN NOT NULL DEFAULT FALSE,
  current_locations JSONB DEFAULT '[]'::jsonb,  -- ["仙骨部","踵部"] 等
  current_onset_date DATE,

  -- 過去の褥瘡
  has_past_ulcer BOOLEAN NOT NULL DEFAULT FALSE,
  past_locations JSONB DEFAULT '[]'::jsonb,
  past_healed_date DATE,

  -- DESIGN-R®2020 採点（看護師手入力・AI禁止）
  -- 例: {"d":"d2","e":"e1","s":"s6","i":"i0","g":"g3","n":"n0","p":"p0","total":10}
  design_r JSONB DEFAULT '{}'::jsonb,

  -- 看護計画（各1000字以内、AI下書き→看護師修正）
  plan_bed TEXT,         -- ① 圧迫・ズレ力：ベッド上
  plan_chair TEXT,       -- ② 圧迫・ズレ力：イス上
  plan_skincare TEXT,    -- ③ スキンケア
  plan_nutrition TEXT,   -- ④ 栄養状態改善
  plan_rehab TEXT,       -- ⑤ リハビリテーション

  -- 評価記録（自由記述）
  evaluation_notes TEXT,

  -- AI生成メタ情報（監査用）
  ai_model TEXT,           -- 生成時のモデル名（例: claude-haiku-4-5-20251001）
  ai_prompt_version TEXT,  -- プロンプトバージョン
  ai_generated_at TIMESTAMPTZ
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_pressure_ulcer_plans_patient_id
  ON pressure_ulcer_plans(patient_id);
CREATE INDEX IF NOT EXISTS idx_pressure_ulcer_plans_patient_date
  ON pressure_ulcer_plans(patient_id, plan_date DESC);
CREATE INDEX IF NOT EXISTS idx_pressure_ulcer_plans_review
  ON pressure_ulcer_plans(next_review_date)
  WHERE next_review_date IS NOT NULL;

-- updated_at 自動更新トリガー
CREATE OR REPLACE FUNCTION update_pressure_ulcer_plans_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pressure_ulcer_plans_updated_at ON pressure_ulcer_plans;
CREATE TRIGGER trg_pressure_ulcer_plans_updated_at
  BEFORE UPDATE ON pressure_ulcer_plans
  FOR EACH ROW
  EXECUTE FUNCTION update_pressure_ulcer_plans_updated_at();

-- RLS 有効化
ALTER TABLE pressure_ulcer_plans ENABLE ROW LEVEL SECURITY;

-- ポリシー: 認証済みユーザーは全操作可能（事業所内共有）
CREATE POLICY "Authenticated users can view pressure_ulcer_plans"
  ON pressure_ulcer_plans FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can insert pressure_ulcer_plans"
  ON pressure_ulcer_plans FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update pressure_ulcer_plans"
  ON pressure_ulcer_plans FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete pressure_ulcer_plans"
  ON pressure_ulcer_plans FOR DELETE
  USING (auth.role() = 'authenticated');
