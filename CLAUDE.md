# kango-app — AI訪問看護記録アシスト

## 引き継ぎ（最終更新: 2026-04-27 SOAP Phase B 完了）

### 完了（2026-04-27）

#### SOAP プロンプト Phase B 改修（master マージ済・PR #7）
- B1: tool description 簡素化（663→473char、-28.7%）
- B2: 強調語整理。最優先3項目に集中（推測禁止／補正リスト優先／全段階補正）
- B3: 冗長表現精査（systemPromptChars 10838→10432）
- B4: extracted_facts「1事実=1要素」を明記
- 誤変換リスト追加6パターン：胎動→体動／〜の正常→〜の性状／侵入部→刺入部／外装→咳嗽／常用→上葉／服雑音→副雑音
- 過去記録の医療用語が補正リストの誤変換と一致したら補正後の用語で書く（過去記録に揃えない）
- alertAnswers/answers ラベルを「O/A/P に反映。S 欄には入れない」に明確化
- ai-client.ts に model（haiku/sonnet）/usage パラメータ追加
- cases.json 拡張（case-03b/case-03c）9ケース化
- テストハーネス整備：summarize-baseline / diff-snapshot / compare-s / show-review / show-case06-v3 / quality-gate
- 計測：1ケース ¥2.65→¥2.42（-8.73%）。9ケース全合格。promptHash 593f9cb0→96040783
- preview実環境で全要件クリア確認済み（誤変換補正・過去記録優先・S=空・[AI回答]反映・S情報passthrough）

### 進行中タスク（次回再開時）

#### 看護計画書feature（Phase D 着手待機中）
- ブランチ: `feat/nursing-care-plan`（PR #6 draft 化）
- 現状コードはカイポケフォーマット非互換（`#1 (観察)(ケア)(指導)` の構造化なし、issue が単一文字列）
- ユーザー要望：旧carePlan欄の内容を新規計画書にそのまま引き継げる導線、カイポケフォーマット踏襲
- リサーチ結果（memory/project_kango_nanda.md）：
  - ユーザー言及の「#1 (観察)(ケア)(指導)」= NANDA 診断ラベル + OP/TP/EP
  - 訪問看護でのNANDA普及1割。カイポケ運用が現場慣習
  - 推奨：カイポケ互換+OP/TP/EP+NANDA任意項目のハイブリッド
- Phase D 着手時の選択肢：
  1. master 上で `feat/nursing-care-plan-v2` を新規作成（フレッシュスタート）
  2. `feat/nursing-care-plan` を master に rebase で conflict 解消（route.ts/run.ts conflict 確認済み）
- どちらを取るかは Phase D 着手時に再判断（Phase B 改修込みの大幅改修になるため、フレッシュスタートが筋が良い可能性大）

### 実運用フィードバック収集（最優先）
SOAP Phase B が master 反映済み。明日から実運用で数日試して以下を収集：
1. AI出力に「追記」「修正」した箇所をメモ（どんな情報が抜けたか、どんな表現が不自然か）
2. まだ補正されない音声誤変換パターン
3. 事業所特有の言い回し・方言への対応度
4. 他スタッフに試してもらった時の反応（書き癖の違い耐性）

フィードバック内容に応じて次の手を決定：
- 誤変換パターン追加 → systemPrompt の補正ルール追記
- 特定疾患・職種で弱い → Few-shot追加（PT・精神科・小児など）
- コストが気になる → Prompt Caching 導入（複数スタッフ集中利用パターンが見えた段階）
- さらに精度欲しい → Sonnet昇格 or 2段階生成

テスト実行：
```bash
# 全ケース計測 + スナップショット保存
OUTPUT_JSON=tests/prompts/soap/post-XXX-YYYY-MM-DD.json npx tsx tests/prompts/soap/run.ts soap all

# baseline と diff
npx tsx tests/prompts/soap/diff-snapshot.ts tests/prompts/soap/baseline-2026-04-27.json tests/prompts/soap/post-XXX-YYYY-MM-DD.json

# 9ケース合格判定
npx tsx tests/prompts/soap/quality-gate.ts tests/prompts/soap/post-XXX-YYYY-MM-DD.json
```

---

## 引き継ぎ（過去分: 2026-04-16）

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
