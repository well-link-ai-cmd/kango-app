-- ============================================================
-- マイグレーション: 訪問看護報告書（通常 / 精神科）
--
-- Supabase ダッシュボード > SQL Editor で実行してください。
--
-- 様式の根拠:
--   - 別紙様式2 = 訪問看護報告書（通常）  保医発0327第2号
--   - 別紙様式4 = 訪問看護報告書（精神科）保医発0327第2号
-- 手順書: docs/報告書3様式_手順書.md
--
-- AI責任分界:
--   - GAF点数・Barthel点数・自立度ランク → 看護師手入力（AI禁止）
--   - 頻回訪問の必要性判断・主治医への依頼事項 → 看護師手入力
--   - 病状の経過・看護内容・家族介護(家族関係)・特記事項 → AI下書き可
--   - 衛生材料の種類・量 → 看護師手入力
-- ============================================================

CREATE TABLE IF NOT EXISTS visit_reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,

  -- 監査情報
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  user_id UUID REFERENCES auth.users(id),

  -- 基本情報
  report_type TEXT CHECK (report_type IN ('normal','psychiatric')) NOT NULL,
  target_month TEXT NOT NULL,                     -- YYYY-MM（対象月）
  is_draft BOOLEAN DEFAULT TRUE,

  -- 作成者
  author_name TEXT,
  author_title TEXT,                              -- 例: 看護師 / 准看護師 / 保健師

  -- 本文（AI下書き可、各3000字想定）
  disease_progress TEXT,                          -- 病状の経過
  nursing_content TEXT,                           -- 看護・リハの内容（箇条書き推奨）
  family_care TEXT,                               -- 通常: 家庭での介護の状況 / 精神科: 家族等との関係
  special_notes TEXT,                             -- 特記すべき事項

  -- 衛生材料（看護師手入力・AI禁止、JSON）
  -- {items: [{name, quantity, status}], request_to_doctor}
  hygiene_material JSONB DEFAULT '{}'::jsonb,

  -- 訪問日暦（JSON）: [{date: "2026-04-03", symbol: "○|◇|△"}]
  -- ○=看護師、◇=PT/OT/ST、△=特別指示書
  visit_calendar JSONB DEFAULT '[]'::jsonb,

  -- リハ別添（通常のみ・看護師手入力 + コミュニケーション欄のみAI下書き可）
  -- {
  --   daily_life_level: "J1..C2",
  --   dementia_level: "自立|Ⅰ|Ⅱa|Ⅱb|Ⅲa|Ⅲb|Ⅳ|M",
  --   barthel_index: { feeding, transfer, grooming, toilet, bathing, walking, stairs, dressing, bowel, bladder },
  --   barthel_total: 0-100,
  --   communication: "..."
  -- }
  rehab_attachment JSONB,

  -- GAF（精神科のみ・看護師手入力・AI禁止）
  gaf_score INTEGER,                              -- 0-100
  gaf_judge_date DATE,                            -- 判定日（月初日訪問日）
  gaf_unavailable BOOLEAN DEFAULT FALSE,          -- 家族のみ訪問でGAF判定不可

  -- AI生成メタ情報
  ai_model TEXT,
  ai_prompt_version TEXT,
  ai_generated_at TIMESTAMPTZ,

  -- 整合性: 同一患者・同一対象月・同一様式は1件
  UNIQUE (patient_id, target_month, report_type)
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_visit_reports_patient_id
  ON visit_reports(patient_id);
CREATE INDEX IF NOT EXISTS idx_visit_reports_patient_month
  ON visit_reports(patient_id, target_month DESC);

-- updated_at 自動更新トリガー
CREATE OR REPLACE FUNCTION update_visit_reports_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_visit_reports_updated_at ON visit_reports;
CREATE TRIGGER trg_visit_reports_updated_at
  BEFORE UPDATE ON visit_reports
  FOR EACH ROW
  EXECUTE FUNCTION update_visit_reports_updated_at();

-- RLS 有効化
ALTER TABLE visit_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view visit_reports" ON visit_reports;
CREATE POLICY "Authenticated users can view visit_reports"
  ON visit_reports FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can insert visit_reports" ON visit_reports;
CREATE POLICY "Authenticated users can insert visit_reports"
  ON visit_reports FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can update visit_reports" ON visit_reports;
CREATE POLICY "Authenticated users can update visit_reports"
  ON visit_reports FOR UPDATE
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can delete visit_reports" ON visit_reports;
CREATE POLICY "Authenticated users can delete visit_reports"
  ON visit_reports FOR DELETE
  USING (auth.role() = 'authenticated');
