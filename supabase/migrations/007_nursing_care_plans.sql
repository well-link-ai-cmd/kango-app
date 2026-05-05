-- ============================================================
-- マイグレーション: 訪問看護計画書
--
-- Supabase ダッシュボード > SQL Editor で実行してください。
--
-- カイポケ「訪問看護計画書」フォーマットに準拠。
-- 手順書: docs/看護計画書_手順書.md
--
-- AI責任分界ルール:
--   - 計画書タイプ（介護/医療）・タイトル（共通/看護/リハ）は看護師手入力
--   - 衛生材料の種類・サイズ・必要量は看護師手入力（AIは触らない）
--   - 看護・リハビリの目標、療養上の課題・支援内容、評価、備考はAI下書き可
--   - 評価は期間SOAPから総合評価下書き → 看護師最終確認
--
-- 課題の記述形式（issue_format）:
--   - 'nanda':    課題ラベル + OP（観察）/ TP（ケア）/ EP（指導）の構造化
--   - 'freeform': 自由文1ブロック（既存実装互換）
--   コピペ取り込み（imported=true）は freeform 扱い
-- ============================================================

CREATE TABLE IF NOT EXISTS nursing_care_plans (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,

  -- 監査情報
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  user_id UUID REFERENCES auth.users(id),  -- 最終更新者

  -- 基本情報
  plan_date DATE NOT NULL,                                          -- 作成年月日
  plan_type TEXT CHECK (plan_type IN ('介護','医療')) DEFAULT '介護',
  plan_title TEXT CHECK (plan_title IN ('共通','看護','リハ')) DEFAULT '共通',
  is_draft BOOLEAN DEFAULT TRUE,                                    -- 下書き/確定

  -- 課題の記述形式（NANDA構造化 / 自由記載）
  issue_format TEXT CHECK (issue_format IN ('nanda','freeform')) DEFAULT 'nanda',

  -- 作成者（職員氏名・署名印字項目）
  author_name TEXT,
  author_title TEXT,
  author2_name TEXT,
  author2_title TEXT,

  -- 看護・リハビリの目標（3000字、AI下書き可）
  nursing_goal TEXT,

  -- 療養上の課題・支援内容（複数行、JSON配列）
  --
  -- format='nanda' の場合:
  --   {
  --     no: 1, date: "2026-05-01", format: "nanda",
  --     diagnosis_label: "不安感増強に伴う日常生活への支障リスク",
  --     op: ["バイタル測定...", "..."],   // 観察計画
  --     tp: ["不安傾聴...", "..."],       // ケア計画
  --     ep: ["休息の取り方説明...", "..."], // 指導計画
  --     ai_generated: true, ai_model: "claude-sonnet-4-6", ai_generated_at: "...",
  --     imported: false,
  --     evaluation: "...", evaluated_at: "..."
  --   }
  --
  -- format='freeform' の場合（既存互換 + コピペ取り込み）:
  --   {
  --     no: 1, date: "2026-05-01", format: "freeform",
  --     issue: "(自由文)",
  --     ai_generated: false,
  --     imported: true, imported_at: "...",  // コピペ取り込みの場合のみ
  --     evaluation: "...", evaluated_at: "..."
  --   }
  --
  -- format フィールドが欠落している既存データは freeform 扱い（後方互換）
  issues JSONB DEFAULT '[]'::jsonb,

  -- 衛生材料の情報（看護師手入力、AI禁止）
  has_supplies BOOLEAN DEFAULT FALSE,
  supply_procedure TEXT,       -- 処置の内容（3000字）
  supply_materials TEXT,       -- 衛生材料（種類・サイズ）等（3000字）
  supply_quantity TEXT,        -- 必要量（3000字）

  -- 備考（3000字、AI補助可）
  remarks TEXT,

  -- 議事録（任意・AI生成時の参照ソース・3000字想定）
  -- 退院前カンファレンス・サービス担当者会議等の貼付テキスト
  conference_memo TEXT,

  -- AI生成メタ情報（監査用）
  ai_model TEXT,
  ai_prompt_version TEXT,
  ai_generated_at TIMESTAMPTZ
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_nursing_care_plans_patient_id
  ON nursing_care_plans(patient_id);
CREATE INDEX IF NOT EXISTS idx_nursing_care_plans_patient_date
  ON nursing_care_plans(patient_id, plan_date DESC);
-- 「現在有効な計画書」検索用（is_draft=false の最新）
CREATE INDEX IF NOT EXISTS idx_nursing_care_plans_active
  ON nursing_care_plans(patient_id, plan_date DESC)
  WHERE is_draft = FALSE;

-- updated_at 自動更新トリガー
CREATE OR REPLACE FUNCTION update_nursing_care_plans_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_nursing_care_plans_updated_at ON nursing_care_plans;
CREATE TRIGGER trg_nursing_care_plans_updated_at
  BEFORE UPDATE ON nursing_care_plans
  FOR EACH ROW
  EXECUTE FUNCTION update_nursing_care_plans_updated_at();

-- RLS 有効化
ALTER TABLE nursing_care_plans ENABLE ROW LEVEL SECURITY;

-- ポリシー: 認証済みユーザーは全操作可能（事業所内共有）
CREATE POLICY "Authenticated users can view nursing_care_plans"
  ON nursing_care_plans FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can insert nursing_care_plans"
  ON nursing_care_plans FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update nursing_care_plans"
  ON nursing_care_plans FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete nursing_care_plans"
  ON nursing_care_plans FOR DELETE
  USING (auth.role() = 'authenticated');
