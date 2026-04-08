# CLAUDE.md

## 次回セッションでやること（デプロイ手順）

### 1. Supabase ダッシュボードで設定

#### Google認証の有効化
- Authentication > Providers > **Google** を有効化
- Google Cloud Console で **OAuth 2.0 クライアントID** を作成
  - 承認済みリダイレクトURI: `https://<your-supabase-project>.supabase.co/auth/v1/callback`
- 取得した Client ID と Client Secret を Supabase の Google Provider 設定に入力

#### ユーザー作成
- Authentication > Users で**最初のユーザーを作成**（メール/パスワード）
- Google認証を使う場合は初回ログイン時に自動作成される

#### SQLマイグレーション実行
- SQL Editor で `supabase/migrations/001_add_user_id_and_rls.sql` を実行
- これにより全テーブルに user_id カラムが追加され、RLS（Row Level Security）が有効化される
- 認証済みスタッフ全員が全患者データを共有できる（未認証アクセスのみ拒否）

### 2. Vercel / GitHub
- `claude/nursing-record-s-info-xDjd9` ブランチをプレビューURLで動作確認
- 問題なければ **master にマージ** して本番デプロイ

### 3. 動作確認ポイント
- Googleアカウントでログインできるか
- 患者一覧が表示されるか（RLS有効化後）
- 記録作成フロー: S情報入力 → 訪問内容入力 → 確認質問 → SOAP生成 → 保存 → ケア内容更新
- ケア内容の抜け漏れチェック（確認質問にケア項目が反映されるか）
- ログアウトが動作するか

---

## ブランチ情報
- 開発ブランチ: `claude/nursing-record-s-info-xDjd9`
- このブランチの変更内容:
  - S情報の2段階入力フロー（S情報パススルー + OAP生成）
  - Aセクションの書き方改善（所見→判断の順）
  - 参考記録のフォーマット構造化
  - Supabase Auth（Google + メール/パスワード認証）
  - Row Level Security（事業所共有型）
  - 全APIルートに認証チェック
  - セキュリティヘッダー追加
  - AI送信データの最小化（年齢・介護度・主病名を削除）
  - ケア内容の確認質問連携
  - 記録保存後のケア内容自動更新
  - バグ修正・UX改善・AIコスト最適化
