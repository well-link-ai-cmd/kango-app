# kango-app — AI訪問看護記録アシスト

Well-Link AI が提供する訪問看護師向けSOAP記録作成支援アプリ。看護師が話し言葉で入力したメモをAI（Claude Haiku 4.5）がSOAP形式の看護記録に変換する。

## 技術スタック

| カテゴリ | 技術 |
|---------|------|
| フレームワーク | Next.js 16.1.7（App Router） |
| 言語 | TypeScript 5（strict mode） |
| UI | React 19, Tailwind CSS v4, Lucide React（アイコン） |
| DB | Supabase（PostgreSQL + RLS） |
| 認証 | Supabase Auth（Google OAuth）+ 事業所パスワード |
| AI | Claude Haiku 4.5（本番）/ Gemini 1.5 Flash（テスト用フォールバック） |
| デプロイ | Vercel（master → 自動デプロイ） |
| Node | 22.x |

## ディレクトリ構成

```
kango-app/
├── app/                          # Next.js App Router
│   ├── layout.tsx                # RootLayout（AuthGate でラップ）
│   ├── page.tsx                  # / → /patients へリダイレクト
│   ├── globals.css               # Tailwind + カスタムCSS変数・コンポーネント
│   ├── patients/
│   │   ├── page.tsx              # 利用者一覧（あかさたなグループ・検索・クイックアクション）
│   │   ├── new/page.tsx          # 利用者新規登録
│   │   └── [id]/
│   │       ├── page.tsx          # 利用者詳細（月別SOAP記録フォルダ）
│   │       ├── edit/page.tsx     # 利用者情報編集
│   │       ├── nursing-contents/page.tsx  # 看護内容リスト管理
│   │       └── records/new/page.tsx       # SOAP記録作成（多段階フロー）
│   ├── admin/page.tsx            # 管理者画面（ユーザー・パスワード管理）
│   └── api/
│       ├── auth/
│       │   ├── route.ts          # 旧認証（廃止・410を返す）
│       │   ├── check-access/route.ts  # アクセス権チェック
│       │   └── setup/route.ts    # 初期セットアップ（初回管理者登録）
│       ├── admin/
│       │   ├── users/route.ts    # ユーザー管理 CRUD（管理者のみ）
│       │   └── password/route.ts # 事業所パスワード変更
│       ├── soap/
│       │   ├── route.ts          # SOAP生成（Claude API呼び出し）
│       │   └── questions/route.ts # 確認アラート・質問生成
│       └── nursing-contents/
│           ├── extract/route.ts  # ケア項目AI抽出
│           ├── diff/route.ts     # ケアリスト差分分析
│           └── appointments/route.ts  # 受診予定AI抽出
├── components/
│   └── AuthGate.tsx              # 認証ゲート（ログイン→アクセスチェック→パスワード→アプリ）
├── lib/
│   ├── supabase.ts               # ブラウザ用Supabaseクライアント（シングルトン）
│   ├── supabase-server.ts        # サーバー用Supabaseクライアント（APIルート向け）
│   ├── storage.ts                # データ型定義 + Supabase CRUDヘルパー
│   ├── ai-client.ts              # AI抽象化レイヤー（Claude/Gemini切り替え）
│   └── password.ts               # パスワードハッシュ（scrypt）
├── supabase/migrations/          # SQLマイグレーション（手動実行）
│   ├── 001_add_user_id_and_rls.sql   # user_idカラム + RLS
│   ├── 002_access_control.sql        # allowed_users + app_settings
│   ├── 003_fix_bootstrap_rls.sql     # 初期登録時のRLS修正
│   └── 004_patient_todos.sql         # 患者別To-Do
├── middleware.ts                  # Supabase SSR セッション管理
├── next.config.ts                # セキュリティヘッダー設定
└── public/                       # 静的ファイル（SVGアイコン等）
```

## データベーススキーマ

全テーブルでRLS有効。認証済みユーザーは全データを共有（事業所単位）。

### patients（利用者）
| カラム | 型 | 説明 |
|--------|------|------|
| id | TEXT PK | |
| name, name_kana | TEXT | 名前・ふりがな（あかさたな分類用） |
| age | INTEGER | |
| care_level | TEXT | なし / 要支援1-2 / 要介護1-5 |
| diagnosis | TEXT | 主病名 |
| nurse_in_charge | TEXT | 担当看護師 |
| doctors | JSONB | [{name, hospital, address?, phone?}] |
| care_managers | JSONB | [{name, office, address?, phone?}] |
| care_plan | TEXT | ケアプラン・担当者会議の方針 |
| initial_soap_records | JSONB | 導入時の過去SOAP（AI精度向上用） |
| user_id | UUID FK | 作成者 |

### soap_records（SOAP記録）
| カラム | 型 | 説明 |
|--------|------|------|
| id | TEXT PK | |
| patient_id | TEXT FK | patients.id |
| visit_date | TEXT | YYYY-MM-DD |
| raw_input | TEXT | 看護師の入力メモ（原文） |
| s_text, o_text, a_text, p_text | TEXT | SOAP各項目 |
| user_id | UUID FK | 作成者 |

### nursing_contents（看護内容リスト）
| カラム | 型 | 説明 |
|--------|------|------|
| patient_id | TEXT PK FK | patients.id |
| items | JSONB | [{id, text, isActive, source: "manual"\|"ai", addedAt}] |
| last_analyzed_at | TIMESTAMPTZ | |

### patient_todos（引き継ぎTo-Do）
| カラム | 型 | 説明 |
|--------|------|------|
| id | UUID PK | |
| patient_id | TEXT FK | CASCADE削除 |
| content | TEXT | |
| is_done | BOOLEAN | |
| done_at | TIMESTAMPTZ | 完了後7日で自動削除 |

### allowed_users（許可ユーザー）
| カラム | 型 | 説明 |
|--------|------|------|
| email | TEXT UNIQUE | |
| role | TEXT | "admin" \| "user" |

### app_settings（アプリ設定）
| カラム | 型 | 説明 |
|--------|------|------|
| key | TEXT PK | 例: "org_password" |
| value | TEXT | ハッシュ済みパスワード等 |

## コーディング規約

### 命名規則
- **TypeScript**: camelCase（変数・関数）、PascalCase（型・コンポーネント）
- **DB カラム**: snake_case（`lib/storage.ts` で camelCase に変換）
- **ファイル名**: ページは `page.tsx`（App Router規約）、APIは `route.ts`
- **ハンドラ**: `handle*` プレフィックス（例: `handleDelete`, `handleAddTodo`）

### コンポーネントパターン
- ページコンポーネントは全て `"use client"` のクライアントコンポーネント
- 状態管理は `useState` + `useEffect`（外部ライブラリなし）
- データ取得は `lib/storage.ts` のヘルパー関数経由
- モーダルはページ内にインラインで実装（Bottom Sheet スタイル）
- アイコンは全て Lucide React から import

### スタイリング
- Tailwind CSS v4 ユーティリティクラス + `globals.css` のカスタムクラスを併用
- CSS変数で色・グラデーション・影を定義（`--accent-cyan`, `--bg-primary` 等）
- カスタムクラス: `.card`, `.btn-primary`, `.btn-outline`, `.btn-save`, `.input-field`, `.badge-*`, `.soap-*`, `.modal-*`
- インラインの `style={}` で CSS変数を参照するパターンが多い
- レスポンシブ: `max-w-2xl mx-auto` で中央寄せ、モバイルファースト

### API ルートパターン
- 全APIルートで先頭に `getAuthUser()` による認証チェック
- 管理者APIは `checkAdmin()` ヘルパーで権限チェック
- AI呼び出しは `generateAiResponse(prompt)` で抽象化
- AI応答は JSON を `response.text.match(/\{[\s\S]*\}/)` で抽出してパース
- エラーメッセージは日本語

### データアクセス
- **ブラウザ**: `lib/supabase.ts` の `getSupabase()` → `lib/storage.ts` のヘルパー
- **サーバー**: `lib/supabase-server.ts` の `getServerSupabase()` / `getAuthUser()`
- snake_case ↔ camelCase 変換は `lib/storage.ts` の `patientToRow()` / `rowToPatient()` 等で実施
- ID生成: `Date.now().toString(36) + Math.random().toString(36).slice(2, 7)`

## 開発コマンド

```bash
npm run dev      # 開発サーバー起動
npm run build    # 本番ビルド
npm run start    # 本番サーバー起動
npm run lint     # ESLint
```

## 環境変数

`.env.local` に設定（.gitignore 対象）:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
ANTHROPIC_API_KEY=sk-ant-...       # 本番（優先）
GEMINI_API_KEY=AI...               # テスト用フォールバック
```

`ANTHROPIC_API_KEY` があれば Claude を使用。なければ `GEMINI_API_KEY` にフォールバック。

## デプロイ

- **本番**: https://kango-app.vercel.app
- **トリガー**: `master` ブランチへのマージで Vercel が自動デプロイ
- **ブランチ命名**: `claude/<feature-description>-<hash>`

## 認証フロー

1. Google OAuth でログイン（Supabase Auth）
2. `allowed_users` テーブルでメールアドレスを照合
3. テーブルが空なら初期セットアップ（最初のユーザーが admin になる）
4. 事業所パスワードが設定されていれば入力を求める
5. `sessionStorage` に `access_verified`（メール）と `user_role`（admin/user）を保存

## AI（SOAP生成）の仕組み

### SOAP記録作成フロー（`/patients/[id]/records/new`）
1. 看護師がS情報（利用者の発言）と訪問メモを入力
2. `/api/soap/questions` でAIが確認アラート・質問を生成（過去記録ベース）
3. 看護師が質問に回答
4. `/api/soap` でAIがSOAP形式に変換
5. 看護師が内容を確認・編集して保存
6. 看護内容リストの差分更新を提案

### プロンプト設計の要点
- S（主観）は看護師の入力をほぼそのまま返す（医療用語の誤変換のみ補正）
- O/A/P は見出し・箇条書きを使わず自然な文章で記述
- 過去記録がある場合は文体・構成・詳細度を模倣
- 事実の追加は禁止、メモからの要点抽出のみ

## マイグレーション

SQLファイルは `supabase/migrations/` に格納。Supabase ダッシュボードの SQL Editor で手動実行する。番号順に実行すること。

## 引き継ぎ（最終更新: 2026-04-12）

### 完了
- Supabase: Google認証 + RLS + SQLマイグレーション
- Vercel: masterマージ → 本番デプロイ
- Googleログイン・患者一覧・ログアウト動作確認OK
- アクセス制御（allowed_users + 事業所パスワード）
- 利用者一覧（あかさたなグループ・検索・クイックアクション）
- SOAP記録作成（2段階入力フロー + 確認質問）
- 看護内容リスト（AI抽出・差分分析）
- 患者別To-Do（引き継ぎメモ・7日自動削除）
- 受診予定AI抽出
- 管理者画面（ユーザー追加/削除・パスワード変更）
- localStorage → Supabase 自動移行

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
