# kango-app — AI訪問看護記録アシスト

## 引き継ぎ（最終更新: 2026-04-22 夜間自動進行）

### 2026-04-22 完了（feat/nursing-care-plan ブランチに push、Phase 1-7 全完了）
- **看護計画書feature Phase 1-7 すべて実装＋医療レビュー反映済み**
  - `docs/看護計画書_手順書.md`：カイポケフォーマット準拠・責任分界（評価AI化含む）・DB設計・過渡期carePlan扱い
  - `supabase/migrations/007_nursing_care_plans.sql`：テーブル・RLS・インデックス・トリガー（**未実行 — 朝ダッシュボードで手動実行**）
  - `lib/storage.ts`：`NursingCarePlan` 型・CRUD・`getActiveNursingCarePlan`（確定版の最新取得）
  - AI生成API：`nursing-care-plan/generate`（目標・課題）、`nursing-care-plan/evaluate`（期間SOAP評価）、`nursing-contents/refine`（ケア内容整理）
  - `lib/nursing-care-plan-fewshot.ts`：プレースホルダー（**実記録ベースの例は看護師レビュー後に差し替え**）
  - `tests/prompts/nursing-care-plan/`：cases.json 7件 + run.ts ランナー + README
  - **SOAP / questions プロンプトの参照優先順位更新**：看護計画書（確定版） > carePlan（旧） > 推論。route.ts + run.ts ミラー同期済
  - クライアント（records/new/page.tsx）から `patientId` を送るよう更新
  - **看護計画書UI（Phase 5）**：一覧・新規・編集・複製ページ、共通フォームコンポーネント、AI下書きバッジ／看護師記入バッジ／安全上AI禁止バッジの3種、2モード生成（from_scratch / refine）、一括評価、カイポケコピペ、旧carePlan移行バナー
  - **ケア内容リスト改善（Phase 7）**：複数行一括追加・インライン編集・「AIで整え直す」機能（プレビュー→承認→1回のみ元に戻す）、患者新規/編集フォームからの入力導線
  - **medical-reviewer 品質ゲート（Phase 6）通過**：中リスク3件 + 低リスク3件の指摘を反映
    - evaluate の finding_draft 候補から「目標達成」「中止検討」削除（看護師判定領域）
    - 衛生材料セクションに赤系「AI下書き禁止領域」バッジ＋説明文追加
    - refine プロンプトに「報告条件・頻度・部位限定・数値基準は削らない」制約追加
    - 誤変換補正に関節・仰臥位追加、nursing_goal の家族支援を条件付き化、evaluate のフォールバック表現を下書き形に

### AI確認質問の役割分離 + 保存ボタン保存中UI（2026-04-22 夜 push済）
- `app/api/soap/questions/route.ts`：alerts（過去→今日の漏れ）と questions（今日のメモの曖昧点）を別ソース（gaps vs memo_ambiguities）から生成するよう再設計、トピック重複禁止を明記
- `app/patients/[id]/records/new/page.tsx`：保存ボタンに `loadingSave` ステート、「保存中...」表示、二重送信ガード

### 完了
- Supabase: Google認証 + RLS + SQLマイグレーション
- Vercel: masterマージ → 本番デプロイ
- Googleログイン・患者一覧・ログアウト動作確認OK
- **SOAP誤変換対策**：副雑音・緊満感・更衣・洗髪・著明の補正ルールをプロンプトに追加（2026-04-13 push済）
- **Homeボタン追加**：訪問記録作成・看護内容リストのヘッダーに「患者一覧へ戻る」ボタン追加（push済）
- **褥瘡計画書の手順書作成**：`docs/褥瘡計画書_手順書.md`（カイポケ4カテゴリ対応・B1以上ルール・DESIGN-R責任分界・DB設計含む）
- **カイポケ報告書3様式のフォーマット把握**（通常報告書・精神科報告書・情報提供書）

### 朝やってほしいこと（引き継ぎ）
1. **手順書の責任者レビュー**：`docs/看護計画書_手順書.md` を責任者に共有
2. **migration 007 の手動実行**：Supabase ダッシュボード > SQL Editor で `007_nursing_care_plans.sql` を実行（テーブル作成がないとSOAPプロンプトが看護計画書を参照できないだけで、本番影響はない）
3. **feat/nursing-care-plan ブランチのPR確認**：preview環境で動作確認
4. **Few-shot例の実記録**：看護師レビュー済みの実記録3〜5件を元に `lib/nursing-care-plan-fewshot.ts` の本文を作成
5. **テストハーネス実行**：`npx tsx tests/prompts/nursing-care-plan/run.ts all all`（約$0.07、看護師レビュー用のサンプル出力を得る）

### 残タスク
- **Phase 5: 看護計画UI**（new/edit/copy + 患者詳細統合 + 評価UI + コピペ導線 + 移行ウィザード）— 2日、朝着手
- **Phase 6: medical-reviewer 品質ゲート**
- **Phase 7: ケア内容リスト改善**（複数項目一括追加、インライン編集、AIで整え直す、患者新規作成からの入力導線）
- **carePlan UI 撤去**（Phase 5 の中で実施：新規作成フォームから削除、既存は読み取り専用、移行ボタン設置、最終的にカラム drop）

### 責任者からの追加要望（2026-04-13）
1. 月ごとのSOAP記録一括コピー機能（月別フォルダ分け）
2. 褥瘡計画書の自動生成（**最優先**、リスクアセスメントから立てれていない課題を解決）
3. 訪問看護報告書（通常／精神科）の月次自動生成
4. 訪問看護情報提供書の自動生成（宛先4種：市町村/保健所長/学校/医療機関）
5. 看護計画の半年評価・記録からの修正提案
- 出力形式：カイポケに項目別コピペできるテキスト（PDFは後回し）

### 完了（2026-04-14追加）
- **報告書3様式のリサーチ完了**（リサーチャーエージェント再実行で成功）
- **`docs/報告書3様式_手順書.md` 作成完了**（厚労省保医発0327第2号・2024年改定対応・Barthel/GAF/ADL詳細・4宛先書き分け・DB設計含む）

### 完了（2026-04-16追加）
- **褥瘡計画書機能 v1**（Phase 1-3 完了、本番デプロイ済）

### 完了
- Supabase: Google認証 + RLS + SQLマイグレーション
- Vercel: masterマージ → 本番デプロイ
- Googleログイン・患者一覧・ログアウト動作確認OK
- **SOAP誤変換対策**：副雑音・緊満感・更衣・洗髪・著明の補正ルールをプロンプトに追加（2026-04-13 push済）
- **Homeボタン追加**：訪問記録作成・看護内容リストのヘッダーに「患者一覧へ戻る」ボタン追加（push済）
- **褥瘡計画書の手順書作成**：`docs/褥瘡計画書_手順書.md`（カイポケ4カテゴリ対応・B1以上ルール・DESIGN-R責任分界・DB設計含む）
- **カイポケ報告書3様式のフォーマット把握**（通常報告書・精神科報告書・情報提供書）

### 責任者からの追加要望（2026-04-13）
1. 月ごとのSOAP記録一括コピー機能（月別フォルダ分け）
2. 褥瘡計画書の自動生成（**最優先**、リスクアセスメントから立てれていない課題を解決）
3. 訪問看護報告書（通常／精神科）の月次自動生成
4. 訪問看護情報提供書の自動生成（宛先4種：市町村/保健所長/学校/医療機関）
5. 看護計画の半年評価・記録からの修正提案
- 出力形式：カイポケに項目別コピペできるテキスト（PDFは後回し）

### 完了（2026-04-14追加）
- **報告書3様式のリサーチ完了**（リサーチャーエージェント再実行で成功）
- **`docs/報告書3様式_手順書.md` 作成完了**（厚労省保医発0327第2号・2024年改定対応・Barthel/GAF/ADL詳細・4宛先書き分け・DB設計含む）

### 完了（2026-04-16追加）
- **褥瘡計画書機能 v1**（Phase 1-3 完了、本番デプロイ済）
  - 入力フォーム（自立度・OHスケール・危険因子・褥瘡有無・DESIGN-R）
  - AI生成API（プロンプト v1.0.2、医療レビュアー2段階品質ゲート済）
  - 一覧・編集・複製ページ
  - 下書き保存／確定保存の2段階
  - 判定基準ヘルプ・OHスケール自動計算機・危険因子ヒント
  - 「その他」部位の自由記述対応
  - migration 005（pressure_ulcer_plans）+ migration 006（is_draft）
- **共通コンポーネント化**：`_components/PressureUlcerPlanForm.tsx`
  new / edit / copy の3モードをpropsで切替。報告書3様式等で再利用可能
- **横断ハーネス整備**（ai-skills リポジトリ）
  ai-guardrails / medical-reviewer / prompt-tester
- **Vercel preview環境の環境変数** Preview スコープ対応済み

### 完了（2026-04-17追加）
- **SOAP/questions プロンプト精度改善（master マージ済）**
  - Tool use でJSON強制＋temperature 0.2
  - Gemini経路削除、SOAPに自己チェック機構（extracted_facts / coverage_check）、questions を memo_covers → expected → gaps の4段構造に再構成
  - テストハーネス `tests/prompts/soap/` 追加（cases.json 7件・run.ts ランナー・README）

### 完了（2026-04-20追加）
- **SOAP Few-shot例3件組み込み（master マージ済）**
  - 責任者提供の実記録（ターミナル・認知症・終末期）をSonnet 4.6で話し言葉逆生成→看護師レビュー→ `lib/soap-fewshot.ts` に静的埋込み
  - S情報ポリシー明確化：sInput がある時のみ S 欄に passthrough（誤変換補正のみ）。sInput なしなら S=""。口頭メモ・過去記録からの S 抽出を禁止
  - ただし S情報は A/P の臨床判断材料としては必ず考慮（例：「痛みが増した」なら A で疼痛増悪評価、P でレスキュー検討）
  - 誤変換補正を全段階（extracted_facts含む）で適用するよう強化
  - 家族発言・本人発言を O に「〜より〜との報告/訴えあり」形式で客観記載
  - tool_use と Few-shot XML タグの競合により出力崩壊が発生した → XML→平文ラベル形式に修正
  - case-07 追加（S情報→A/P反映検証）。全7ケース合格

### 未完了
- [ ] **褥瘡計画書の実運用テスト**（自ステーションで実データ運用→AI出力の品質フィードバック）
- [ ] 責任者に手順書レビュー依頼（褥瘡計画書・報告書3様式）
- [ ] **報告書3様式の実装**：プロンプト設計→UI→DB migration→実装
  （共通コンポーネント `PressureUlcerPlanForm` のパターンを流用）
- [x] ~~月次一括コピー機能~~（実装済：`app/patients/[id]/page.tsx` の `handleCopyMonth`、月別フォルダUI完備）
- [ ] 計画評価機能（半年ごと、記録からの修正提案）
- [ ] SOAP生成の実運用テスト（従来のSOAPも継続）
- [ ] PT用SOAPプロンプト追加（30分・分岐のみ）
- [ ] 勤怠機能（King of Time自作）統合 — memory/project_kango_kintai.md
- [ ] 統合アプリ化（診療報酬レーダー・ほうかんナビ・人脈マップ）
- [ ] Next.js 16 対応：`middleware.ts` → `proxy.ts` へ移行（deprecation警告対応）

### 次回やること（2026-04-17以降）— **他端末から再開するとき用**

**最優先：実運用フィードバック収集（2026-04-21〜）**
  SOAPプロンプト改善は master 投入済み。明日から実運用で数日試して以下を収集：
  1. AI出力に「追記」「修正」した箇所をメモ（どんな情報が抜けたか、どんな表現が不自然か）
  2. まだ補正されない音声誤変換パターン
  3. 事業所特有の言い回し・方言への対応度
  4. 他スタッフに試してもらった時の反応（書き癖の違い耐性）

  フィードバック内容に応じて次の手を決定：
  - 誤変換パターン追加 → systemPrompt の補正ルール追記
  - 特定疾患・職種で弱い → Few-shot追加（PT・精神科・小児など）
  - コストが気になる → Prompt Caching 導入（入力トークン40-50%削減）
  - さらに精度欲しい → 2段階生成（抽出→整形の完全分離）

  テスト実行手順（ローカル）：
  - `.env.local` に `ANTHROPIC_API_KEY` 設定
  - `npx tsx tests/prompts/soap/run.ts all all`（全7ケース・$0.05未満）
  - 個別ケース：`npx tsx tests/prompts/soap/run.ts soap case-07-sinfo-influences-ap`

**その次：看護計画の作成・修正機能（新規）**
  褥瘡計画書（実装済）とは別に、一般的な看護計画書（ADL・問題リスト・目標・介入）の作成機能を追加する
  - カイポケの「看護計画書」フォーマットの確認が必要（責任者からスクショ受領必要）
  - 既存の共通コンポーネント `_components/PressureUlcerPlanForm.tsx` のパターンを踏襲
  - 入力→AI生成→編集→保存→一覧→編集/複製 の一貫フローを再利用
  - 次回セッション冒頭で「看護計画の続き」と言われたら、まずカイポケのフォーマット確認から

**その他の継続課題（順不同）**
- 褥瘡計画書を実データで運用→AI出力品質・使い勝手のフィードバック収集
- 看護計画の半年評価・記録からの修正提案機能（計画評価）
- 報告書3様式の実装（通常/精神科/情報提供書）：共通コンポーネントのパターン踏襲
- PT用SOAPプロンプト追加（30分・分岐のみ）
- Next.js 16 対応：`middleware.ts` → `proxy.ts` 移行

## 重要ドキュメント
- `docs/褥瘡計画書_手順書.md`：厚労省様式・日本褥瘡学会ガイドライン準拠・カイポケ4カテゴリマッピング済
- `docs/報告書3様式_手順書.md`：保医発0327第2号・2024年改定対応・Barthel/GAF/ADL詳細・4宛先書き分け・DB設計含む
- カイポケのスクショ（褥瘡計画書・通常報告書・精神科報告書・情報提供書）は責任者から受領済

## 重要な2024年改定ポイント
- 訪問看護管理療養費が「1」「2」に区分
- 指示書に「傷病名コード」欄追加
- **精神科訪問看護はGAF尺度の記載が必須化**（記載漏れは返戻リスク）

## AI責任分界（報告書3様式）
- ❌ AI禁止：Barthel点数・GAF点数・自立度ランク判定、宛先選定、算定区分選定
- ✅ AI可：SOAP集約要約・箇条書き化・文字数調整・宛先別トーン変換

## 技術情報
- デプロイ: https://kango-app.vercel.app
- 認証: Google OAuth（Supabase Auth）
- DB: Supabase（patients, soap_records, nursing_contents, pressure_ulcer_plans, patient_todos）
- AI: Claude Haiku 4.5
- ローカル: `C:\Users\thegl\Documents\kango-app`
- GitHub: `https://github.com/well-link-ai-cmd/kango-app`（master）

## 開発ワークフロー
- 大きな変更は `feat/*` ブランチ → preview確認 → master merge
- Supabase migrationは手動実行（ダッシュボード > SQL Editor）
- Vercel環境変数は Production / Preview 両方にセット必須

## 横断ハーネス（参照先）
- `C:\Users\thegl\.claude\rules\ai-guardrails.md`：AI責任分界ルール
- `C:\Users\thegl\.claude\agents\medical-reviewer.md`：医療ドメインレビュアー
- `C:\Users\thegl\.claude\skills\prompt-tester\SKILL.md`：プロンプト品質検証
