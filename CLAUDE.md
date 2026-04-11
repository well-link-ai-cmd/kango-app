# kango-app — AI訪問看護記録アシスト

## 引き継ぎ（最終更新: 2026-04-12）

### 完了
- Supabase: Google認証 + RLS + SQLマイグレーション
- Vercel: masterマージ → 本番デプロイ
- Googleログイン・患者一覧・ログアウト動作確認OK

### 未完了
- [ ] SOAP生成の実運用テスト（S情報の2段階入力フロー）
- [ ] ケア内容の確認質問・自動更新の動作確認
- [ ] **PT用SOAPプロンプト追加**（最小版30分・DB変更なし・プロンプト分岐のみ）
- [ ] **勤怠機能（King of Time自作）統合** — 詳細は memory/project_kango_kintai.md
  - トップメニュー形式で「看護記録」「勤怠」を選べるUIに変更
  - 打刻は出退勤のみ（休憩・GPSなし）、シンプル2ボタン
  - スタッフ9名（看護師7・PT2）、管理者のみ打刻修正可（スタッフ許可トグル付）
  - 社労士提出CSVの列構成は未確認 → 汎用フォーマットで先行実装
- [ ] 統合アプリ化（診療報酬レーダー・ほうかんナビ・人脈マップと統合）

### 次回やること
1. 勤怠機能の実装着手（Day1: DB+スタッフ登録+打刻画面）
2. PT用SOAPプロンプト追加（ついでに30分で）
3. SOAPの実運用テスト → 品質に問題あればプロンプト調整

## 技術情報
- デプロイ: https://kango-app.vercel.app
- 認証: Google OAuth（Supabase Auth）
- DB: Supabase（patients, soap_records, nursing_contents）
- AI: Claude Haiku 4.5
