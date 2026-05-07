-- ============================================================
-- マイグレーション: 訪問看護情報提供書（4宛先）
--
-- Supabase ダッシュボード > SQL Editor で実行してください。
--
-- 様式の根拠:
--   - 別紙様式3 = 訪問看護情報提供書  保医発0327第2号
--   - 4宛先（市区町村 / 保健所長 / 学校 / 医療機関）でフィールド構成が異なる
-- 手順書: docs/報告書3様式_手順書.md
--
-- AI責任分界:
--   - 宛先選定・算定区分（情報提供療養費1/2/3）→ 看護師手入力（AI禁止）
--   - ADL点数判定 → 看護師手入力（AIは触らない・本テーブルでは保存しない）
--   - 主傷病・看護内容・家族介護・サービス・本文系 → AI下書き可
--   - 個人情報（氏名・住所・電話）はカイポケ側で管理。本テーブルは"中身（コピペ用本文）"のみ保持
-- ============================================================

CREATE TABLE IF NOT EXISTS info_provisions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,

  -- 監査情報
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  user_id UUID REFERENCES auth.users(id),

  -- 宛先・区分
  addressee_type TEXT NOT NULL
    CHECK (addressee_type IN ('municipality','health_center','school','medical_institution')),

  -- 期間（AI生成元のSOAP集約期間）
  target_period_start DATE,
  target_period_end DATE,
  issued_date DATE,                                 -- 作成年月日

  is_draft BOOLEAN DEFAULT TRUE,

  -- ===== 全宛先共通（4宛先で表示）=====
  main_disease TEXT,                                -- 主傷病名
  nursing_content TEXT,                             -- 看護の内容
  other_notes TEXT,                                 -- その他特筆すべき事項

  -- ===== 訪問日数（市区町村・保健所長・学校で表示）=====
  monthly_visit_month TEXT,                         -- サ提供月 YYYY-MM
  monthly_visit_days INTEGER,                       -- 訪問日数
  monthly_visit_count INTEGER,                      -- 訪問回数

  -- ===== 市区町村・保健所長 =====
  family_caregiver_info TEXT,                       -- 家族等及び主な介護者に係る情報
  welfare_services TEXT,                            -- 必要と考えられる保健福祉サービス

  -- ===== 市区町村のみ =====
  disease_state TEXT,                               -- 病状・障害等の状態

  -- ===== 学校・医療機関で表示 =====
  daily_life_basics TEXT,                           -- 食生活・清潔・排泄・睡眠・生活リズム等
  medication_status TEXT,                           -- 服薬等の状況
  family_status TEXT,                               -- 家族等について／家族・主な介護者等

  -- ===== 学校のみ =====
  disease_progress TEXT,                            -- 傷病の経過
  medical_care_methods TEXT,                        -- 医療的ケア等の実施方法及び留意事項

  -- ===== 医療機関のみ =====
  past_history TEXT,                                -- 既往歴
  nursing_problems TEXT,                            -- 看護上の問題等
  care_methods_continuation TEXT,                   -- ケア時の具体的方法・留意点・継続すべき看護

  -- AI生成メタ情報
  ai_model TEXT,
  ai_prompt_version TEXT,
  ai_generated_at TIMESTAMPTZ
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_info_provisions_patient_id
  ON info_provisions(patient_id);
CREATE INDEX IF NOT EXISTS idx_info_provisions_patient_addressee
  ON info_provisions(patient_id, addressee_type, issued_date DESC);

-- updated_at 自動更新トリガー
CREATE OR REPLACE FUNCTION update_info_provisions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_info_provisions_updated_at ON info_provisions;
CREATE TRIGGER trg_info_provisions_updated_at
  BEFORE UPDATE ON info_provisions
  FOR EACH ROW
  EXECUTE FUNCTION update_info_provisions_updated_at();

-- RLS 有効化
ALTER TABLE info_provisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view info_provisions" ON info_provisions;
CREATE POLICY "Authenticated users can view info_provisions"
  ON info_provisions FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can insert info_provisions" ON info_provisions;
CREATE POLICY "Authenticated users can insert info_provisions"
  ON info_provisions FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can update info_provisions" ON info_provisions;
CREATE POLICY "Authenticated users can update info_provisions"
  ON info_provisions FOR UPDATE
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can delete info_provisions" ON info_provisions;
CREATE POLICY "Authenticated users can delete info_provisions"
  ON info_provisions FOR DELETE
  USING (auth.role() = 'authenticated');
