# kango-app — AI訪問看護記録アシスト

## 引き継ぎ（最終更新: 2026-04-09）

### 完了
- Supabase: Google認証 + RLS + SQLマイグレーション
- Vercel: masterマージ → 本番デプロイ
- Googleログイン・患者一覧・ログアウト動作確認OK

### 未完了
- [ ] SOAP生成の実運用テスト（S情報の2段階入力フロー）
- [ ] ケア内容の確認質問・自動更新の動作確認
- [ ] 統合アプリ化（診療報酬レーダー・ほうかんナビ・人脈マップと統合）

### 次回やること
1. SOAPの実運用テスト → 品質に問題あればプロンプト調整
2. ケア内容連携の動作確認

## 技術情報
- デプロイ: https://kango-app.vercel.app
- 認証: Google OAuth（Supabase Auth）
- DB: Supabase（patients, soap_records, nursing_contents）
- AI: Claude Haiku 4.5
