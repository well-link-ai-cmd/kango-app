-- ============================================================
-- マイグレーション: 患者別To-Doリスト
--
-- Supabase ダッシュボード > SQL Editor で実行してください。
--
-- 次回訪問時にやるべきことを記録する「引き継ぎTo-Do」機能。
-- ============================================================

CREATE TABLE IF NOT EXISTS patient_todos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  is_done BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  done_at TIMESTAMPTZ,
  done_by UUID REFERENCES auth.users(id)
);

-- インデックス: 患者IDで高速検索
CREATE INDEX IF NOT EXISTS idx_patient_todos_patient_id ON patient_todos(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_todos_is_done ON patient_todos(patient_id, is_done);

-- RLS 有効化
ALTER TABLE patient_todos ENABLE ROW LEVEL SECURITY;

-- ポリシー: 認証済みユーザーは全操作可能（事業所内共有）
CREATE POLICY "Authenticated users can view patient_todos"
  ON patient_todos FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can insert patient_todos"
  ON patient_todos FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update patient_todos"
  ON patient_todos FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete patient_todos"
  ON patient_todos FOR DELETE
  USING (auth.role() = 'authenticated');
