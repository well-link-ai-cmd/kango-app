# kango-app 引き継ぎアーカイブ（〜2026-05-08）

> CLAUDE.md から退避した過去の引き継ぎ履歴。2026-06-08にコンテキスト軽量化のため移動。最新の引き継ぎはCLAUDE.md本体を参照。

## 過去引き継ぎ

### 月次報告書 + 情報提供書 + プロンプトv1.1（2026-05-08 — 4PR master投入完了）

#### PR #11（commit 3d6f574）— レポートプロンプト v1.1
- 情報提供書（info-provision-v1.1.0）と月次報告書（visit-report-v1.1.0）の両APIで同方針改修
- **重複回避ルール**：同じ事実は最も該当する1欄でのみ詳述、他欄は1〜2文の概略。同表現の3回以上繰り返し禁止
- **「看護の内容」を最重要欄に格上げ**：800〜1500字（報告書レベル）、5〜8項目の【看護タイトル】形式
- **文体ガイド明文化**：冒頭に訪問体制 → 問題ごとに段落分け → 各段落「観察→現状→看護師介入」の3部構成
- **字数調整**：主傷病/既往歴 100〜300字、状態系 400〜900字、食生活/家族/服薬 300〜700字、特記 150〜400字
- ユーザー提供の実サンプル（化学療法ケース）から「理想形」を抽出して反映

#### PR #8（commit 5cf93c6）— UI改善
- `getPatients()` で `nameKana` 優先（フォールバック name）の `localeCompare("ja-JP")` ソート
- 利用者一覧トップ・あ行/か行などのグループ内も自動的にあいうえお順
- 看護計画書/褥瘡計画書/利用者編集の各サブページ（一覧/新規/編集）のヘッダー右側にホームボタン追加（`/patients` 行き）

#### PR #9（commit 842d3ab）— 月次訪問看護報告書 Phase 1
- 別紙様式2（通常）/ 別紙様式4（精神科） 保医発0327第2号
- 通常/精神科の様式切替、対象月選択、SOAP集約からの4欄AIドラフト生成（Haiku 4.5）
- リハ別添（Barthel全10項目・合計100点表示）/ GAF入力（精神科）
- migration 008（visit_reports + RLS）idempotent 化済 → **本番DB実行済**
- API: `/api/visit-report/generate`（v1.0.0）

#### PR #10（commit 923c57e）— 訪問看護情報提供書（4宛先）Phase 1
- 別紙様式3 保医発0327第2号 / カイポケ準拠の4宛先（市区町村/保健所長/学校/医療機関）対応
- 宛先別フィールド構成（最小14欄）を `INFO_PROVISION_FIELDS` で動的に表示切替
- 宛先別トーン分岐（市区町村=福祉/保健所長=公衆衛生/学校=小児教育/医療機関=医療連携）
- API: `/api/info-provision/generate`（v1.0.0、Haiku 4.5、宛先別 Tool schema 動的構築）
- 各欄1000字制限・文字数カウンタ表示・「※AI下書き。看護師確認必須」自動付与
- 患者詳細ページに「情報提供書（4宛先）」リンク追加
- migration 009（info_provisions + RLS）idempotent 化済 → **本番DB実行済**

#### AI責任分界（情報提供書）
- ❌ 宛先選定・算定区分（療養費1/2/3）・ADL点数判定 → 看護師手入力
- ✅ 本文ドラフト（主傷病・看護内容・家族介護・サービス等）

---

### 月次報告書 Phase 1（2026-05-05 — PR #9 で master 投入完了）
詳細メモ: `~/.claude/projects/C--Users-thegl-Documents-kango-app/memory/project_visit_reports_phase1.md`

### モデル戦略（2026-05-05 確定）
| 用途 | モデル | 根拠 |
|---|---|---|
| **創造系**（推論・新規生成） | Sonnet 4.6 | suggest-labels（議事録→課題推論）、generate-issues（OP/TP/EP創造） |
| **要約・整形系** | Haiku 4.5 | SOAP生成・alerts・看護計画 評価・褥瘡計画書・ケア内容refine、月次報告書（予定）、情報提供書（予定） |

**重要**: 評価系（要約・整形）は Haiku で品質十分（褥瘡計画書・看護計画書評価で実証済み）。
月次報告書・情報提供書も Haiku 路線で実装する方針確定。

### Prompt Caching の TTL 仕様（重要メモ）
- デフォルト: 5分TTL
- 拡張オプション: **1時間 TTL**（料金は通常キャッシュ書き込みの2倍だが、ヒット率が大幅向上）
- 将来 Caching 試算時は 1時間 TTL 想定でヒット率 80%以上で計算する
- 現在は単独利用のため未導入。複数スタッフ利用開始時に着手

### 完了（2026-05-05 — 看護計画書 Phase 8 + 周辺最適化）

#### マージ済み
- PR #6 → master squash merge（commit b02ead9）
- 後続：questions廃止（commit e6a106b）、evaluate Haiku降格（commit 12f1133）

#### NANDA形式の2段階AI生成・議事録対応・統合textareaUI

#### NANDA形式の2段階AI生成・議事録対応・統合textareaUI
- migration 007: `issue_format` ('nanda'|'freeform') カラム追加、`conference_memo` カラム追加（Supabase本番実行済）
- storage.ts: `NursingCarePlanIssue` を Discriminated Union 化（NANDA / freeform）
  - メタ情報（aiGenerated/aiModel/imported/importedAt）追加
  - `issueToBodyText` / `parseBodyText` ヘルパー（OP/TP/EP整形と自由テキスト→構造化のパース）
- 新規API `/nursing-care-plan/suggest-labels`（Sonnet 4.6）：
  議事録+直近1ヶ月SOAP+active_planから課題ラベル候補MAX5提示・rationale必須・継続課題判定
- 新規API `/nursing-care-plan/generate-issues`（Sonnet 4.6）：
  選択ラベル群→OP/TP/EP+統合nursing_goal一括生成・既実施ケアと重複許容明記
- 既存 `/nursing-care-plan/generate` `/evaluate` を Sonnet 4.6 昇格（v1.1.0）
- `app/api/soap/route.ts` `questions/route.ts`: 看護計画書 issues 注入を NANDA/freeform 両対応（NANDA時は OP/TP/EP 構造化注入）
- NursingCarePlanForm.tsx UI 改修：
  - 課題の記述形式（NANDA/freeform）切替
  - 議事録入力（任意・推奨）
  - NANDAフロー Step 1（候補提示）→ Step 2（一括生成）の2段階UI
  - 課題1件は「ラベル(input) + 内容(大textarea)」の統合UI（カイポケコピペしやすさ優先）
  - 編集中は parseBodyText で構造化保存、表示は issueToBodyText で整形
  - コピペ取り込み（AI整形なし、imported メタ付き freeform issue）
- preview E2E 動作確認済（NANDAフロー / コピペ / 評価 / 保存）

#### Phase 8.1 — 周辺最適化
- **questions API 廃止 → alerts のみに集約**（commit e6a106b）
  - 「もう少し詳しく書けますか」系の掘り下げは実運用で意味なかったため
  - output トークン削減（約47%）、看護師UX改善
- **evaluate API を Haiku 4.5 に降格**（commit 12f1133）
  - 期間SOAP→評価ドラフトは要約・整形作業のため Haiku で十分（実機検証済み）
  - 1課題コスト ¥10 → ¥2（80%削減）
- **evaluate 出力を自由文1ブロックに変更**（カイポケ・iBow両対応）
  - 3ブロック構造（経過/変化/所見）→ 1ブロック自然文
  - 末尾は体言止め/丁寧語の両方許容（実評価サンプル分析より）
  - 「【R元号年月日看護師評価】」プレフィックス自動付与
- **Sonnet 4.6 ルートに `maxDuration = 300` 設定**（Vercel関数の実行時間上限引き上げ）
- **suggest-labels / generate-issues / generate / evaluate の出力字数圧縮**
  - extracted_facts / coverage_check 等の自己チェックフィールド削除
  - 各フィールドの目安字数を半減〜1/3に圧縮
  - 生成時間を90秒タイムアウト → 5〜15秒に改善

#### Phase 8 — NANDA形式の2段階AI生成・議事録対応・統合textareaUI

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


---

# 追加退避（2026-07-12・コンテキスト軽量化第2弾）

> 2026-05-15〜2026-07-06 の完了済み引き継ぎ詳細を CLAUDE.md から退避。「次回タスク」と未完了の確認事項は CLAUDE.md 本体に残置。プロンプト改修の正本: tests/prompts/soap/CHANGELOG.md、意思決定の正本: docs/ 配下の各ドキュメント。

## 引き継ぎ（最終更新: 2026-07-04 — Fable確定事項転記・APIコスト実測完了・ルーブリック設計提示）

### このセッションで完了（2026-07-04）
- **①確定事項転記**: 上記「事業確定事項」セクションを新設
- **②APIコスト実測**: `docs/APIコスト実測レポート_2026-07-04.md` 作成。SOAP生成1コール=ヒット時約1.0円/ミス時約5.0円（実測）。月間試算=5人全員利用で約1,300〜2,400円。**結論: APIコストは価格の制約にならない（価値ベース価格設定が可能）**
  - 注: 引き継ぎ書の「feat/soap-prompt-caching完了」は**既に完了済みだった**（2026-05-29 commit 3445836でmaster投入・本実測で全コールcache_read=14,097を確認）
- **③ルーブリック設計**: `docs/SOAP品質ルーブリック設計_v1.md` 作成（6観点・3段階採点・Sonnet judge・2層構成）。**オーナー承認待ち → 承認後に rubric.ts / judge.ts 実装**

### 同日追記（judge実装完了・承認1〜3消化）
- ルーブリック設計承認 → **judge実装完了**（`tests/prompts/soap/rubric.ts` / `judge.ts`）。初回ベースライン: quality-gate 10/10・judge総合64.2%（詳細は `tests/prompts/soap/CHANGELOG.md` 2026-07-04）
- 低スコア観点: R1 O純度0.30（O欄への評価語「安定/良好/異常なし」・次回訪問予定の混入）/ R4 P接続性0.90（「継続」一語止まり）→ **プロンプト反映は職場SOAPフォーマット受領後にプラン提示**
- 旧メモリ `project_kango_prompt_caching_pr.md` 削除済み

### 同日追記2（実運用FB反映のプロンプト改修 promptHash=408f69b0）
- オーナーFB「S誤字が直らない/原文改変」「前回P由来の未実施項目がA/Pに混入し削除作業が発生」を受け改修（S補正強化＋文字差分ゲート／A/P今日の事実限定／P一語止まり禁止・A根拠添え）。judge 64.2%→65.8%・R2満点化。詳細: `tests/prompts/soap/CHANGELOG.md` 2026-07-04
- **本番デプロイ後の確認**: 実運用で①S欄の誤字補正と原文保持 ②A/Pから関係ない項目が消えて削除作業が減ったか ③SOAPが短くなったことへの違和感有無、を1週間程度収集

### 同日追記3（alerts改修＋情報提供書v2.0.0・医療レビュー済み）
- **alerts（確認質問）**: 過去3回分の継続記載事項の検出を明文化・バイタルは値の漏れアラート禁止（紐づく処置の漏れは対象）・run.tsミラーの旧版乖離を再同期。検証: case-04=0件/case-05=3件検出/バイタルアラート0件
- **情報提供書 v2.0.0**: 事業所カスタムGPTの書き方に準拠（です・ます調/記録調禁止/簡潔化/看護の内容=3段落250〜450字/看護上の問題=タイトルのみ/服薬欄から酸素・インスリン除外）。医療レビュアー条件付き合格→指摘6件全反映（酸素等の移動先必須化・省略禁止リスト明文化・ACP/DNAR重複回避例外・依頼事項は記録明示のみ・バイタル紐づき処置例外・description同期）
- **本番確認**: 次回の情報提供書作成時に文体・文量・3段落構成が事業所様式に合っているか実物で確認。学校・市区町村宛は文体のみ共通適用（構成は現行のまま）

### 2026-07-05 プロンプト効率化P1+P2（全12ルート調査→実装）
- 6月実績突合完了（月2,170円・ヒット率73%・実効6.3円/記録→価格制約なし確定・レポート§6）
- 効率化実装: S二重生成廃止／scaffold簡潔化／死指示削除／temperature明示／system↔desc重複解消／**補正リスト共通化（`lib/medical-term-corrections.ts`・今後の誤変換追加はここだけ直す）**
- 効果: 出力-12.2%・応答約1.5秒短縮・**judge 65.8%→71.7%**（品質向上）。詳細: `tests/prompts/soap/CHANGELOG.md` 2026-07-05

### 2026-07-06 夜間自律作業（branch: feat/readiness-security-2026-07・未push・オーナー判断待ち）
- **6月レディネス5コミットを本ブランチに統合**（コンフリクト解消・tsc✅）＋Fable包括セキュリティ監査を実施
- 監査結果: 基盤堅牢・**展開ブロッカーは🔴R-1のみ**（allowed_users/app_settingsの越境SELECT→スタッフ氏名・メール・旧PWハッシュ漏洩）
- 夜間実装（可逆・挙動不変のみ）: 全AIルートにai_send監査ログ／パスワード最小長8＋定数時間比較／CSP Report-Only／migration 018（参加コード16桁）ドラフト／R-1暫定封じSQL＋切り戻しSQL
- **意思決定は `docs/導入判断メニュー_2026-07-06.md` に集約**（A:マージで反映可4件／B:SQL実行だけ5件／C:承認後実装4件／D:人間側4件＋推奨順序）
- 不可逆操作ゼロ（push・DB変更・削除なし）。ブランチ削除で全て巻き戻し可能

### 2026-07-06 午前追記（レディネス一式 本番デプロイ完了・SQL適用は中断中）
- 導入判断メニューA+B一式をオーナー承認 → 法務文書のプレースホルダ整備 → **masterマージ＆本番デプロイ完了**（コミット4f3d476・READY確認済み）。マージ済みfeatブランチは削除済み
- 副産物: vercel.json ignoreCommand の欠陥修正（FFマージ末尾がdocsコミットだと全変更スキップ→前回デプロイSHA基準に）
- **✅ SQL適用5ステップ完了（2026-07-05夜・オーナー実施）**: ①R-1封じ ②016 ③017 ④018 ⑤verify(0件確認)→015。実機確認3点合格: audit_logsに `ai_send`＋`save` 記録あり／写真登録・表示OK／問い合わせ送信→inquiries保存OK（storage.objectsポリシーも `patient-files org 〜` 4本に置換確認済み）
- 残メモ: 問い合わせのメール通知は未設定（GAS・導入判断メニューD-3・15分作業）。それまで問い合わせ確認はSQL（`select category, body, user_email, status, created_at from inquiries order by created_at desc;`）
- 有料契約のタイミング方針（オーナー合意）: Supabase Proは「他事業所の実データを預かる前日」まで／つなぎに無料の自前エクスポート機能（解約時データ返却と兼用）を今後実装／Stripeは2〜3件目から／Sentryは売り出し準備期に無料枠

### 2026-07-05深夜 追加改修（カンファ導線・本番反映済み）
- **導入時情報（退院前カンファ・申し送り）を基礎情報に移設**: migration 019適用済み＋本番デプロイ済み（c08276c）。基礎情報の新規/編集に入力欄／初回〜過去記録3件未満のSOAP生成でA/P判断材料として注入（Oへの事実創作はガード・case-09で検証）／看護計画カンファ欄へ自動プリフィル
- judge.tsのバグ修正（intakeNotes素材の渡し忘れ→誤採点。教訓: judgeと生成AIには同じ材料を見せる）
- 実機確認待ち: 新規利用者登録時にカンファ欄へ議事録を貼る→初回SOAP生成でA/Pに方針が反映されるか（次の新規契約時に確認）

## 引き継ぎ（2026-06-06 — 他事業所展開レディネス評価＋S1 Storage分離 実装。※2026-07-05にfeat/readiness-security-2026-07へ統合）

### このセッションで進行中（branch: `claude/nursing-app-readiness-assessment-ArGxL`）
- **他事業所展開レディネス評価**を実コード根拠で作成：`docs/展開レディネス評価_2026-06-06.md`。総合は「マルチテナント土台は良質／外部商用展開には4つの展開ブロッカー（①Storage分離 ②監査ログ ③規約・同意・越境送信 ④バックアップ/BCP）」。Phase 2完了・Phase 3着手前。
- 方針：**今のアプリ挙動に影響なく・無料**で対応できる所から順番に整える。優先順 S1→監査ログ→セキュリティヘッダ→規約ページ雛形→問い合わせフォーム。
- **S1（写真Storageのテナント分離）コード実装済み・DB適用待ち**（既存画像0件をユーザー確認済みのため無影響でクリーンに塞げる）：
  - `lib/storage.ts uploadPatientImage`：保存パスを `<org_id>/<prefix>/<uuid>.<ext>` へ（呼び出し側 ImageUploader 等は無改修）。orgId 取得不可なら明示エラー。
  - `supabase/migrations/015_storage_org_rls.sql`：`patient-files` バケットの RLS を 010 の「authenticated 全許可」→「先頭フォルダ=org_id が `current_org_ids()` に一致」へ。text比較で不正パスはエラーにせず拒否。
  - 運用SQL：`supabase/manual/015_verify.sql`（適用前にバケット0件＆旧パス検出を確認）/ `015_rollback.sql`。
  - 🔜 **本番反映手順**：015_verify で0件確認 → 015 を SQL Editor 適用 → 実機で写真登録/表示が従来通り動くか確認。検証：`tsc --noEmit` パス・lint 0。
- **②監査ログ 実装済み・DB適用待ち**：`lib/audit.ts logAudit()`（fire-and-forget・例外握りつぶし）。`migrations/016 audit_logs`（org スコープRLS・閲覧は管理者・INSERT専用＝追記専用）。`lib/storage.ts` の患者/SOAP/看護内容/褥瘡/看護計画/報告書/情報提供書の save・delete に記録フックを注入（保存本体は止めない）。限界：クライアント発行のため改ざん耐性は限定的→将来サーバ側化。AI送信ログ(action `ai_send`)は今後APIルートで付与。
- **③セキュリティヘッダ 実装済み**：`next.config.ts` に `Permissions-Policy`（camera/microphone=self で写真・音声入力は維持／geolocation/payment/usb等は無効化）。CSPはインラインstyle多用のため未導入（壊さない判断・将来Report-Onlyで計測）。
- **④規約/プライバシー 実装済み**：`/terms`・`/privacy`（ログイン不要で閲覧可：AuthGate に PUBLIC_PATHS バイパス追加。既存ルートの認証挙動は不変）。本文は `docs/legal/利用規約.md`・`プライバシーポリシー.md`（**法務確認前ドラフト雛形・〔 〕プレースホルダ未記入**）。ログイン画面下部にリンク。
- **⑤問い合わせフォーム 実装済み・DB適用待ち**：`/contact`（`lib/storage.ts saveInquiry`：事業所/送信者/コンテキスト自動付与）。`migrations/017 inquiries`（org スコープRLS・閲覧は管理者）。ホームヘッダに「問い合わせ」リンク。
- **⑤+ メール通知（GAS方式）実装済み・GASデプロイ待ち**：Resendではなく **GAS（Google Apps Script）で well-link-ai@05company.com のGmailから送信**（独自ドメイン認証不要・完全無料）。`integrations/gas/contact-notify.gs`（doPost・TOKEN検証・運営通知＋送信者へ自動受付返信）。`app/api/contact-notify/route.ts`（サーバ経由でGASへPOST・`CONTACT_GAS_URL`/`CONTACT_GAS_TOKEN` 未設定ならスキップ＝無影響）。`/contact` は保存後に fire-and-forget で通知。セットアップ手順は `docs/本番反映TODO_2026-06-06.md` B-5。患者個人情報はメール本文に書かない運用。
- **⑤++ 問い合わせのAI自動整理（GAS+Gemini）実装済み・APIキー設定待ち**：ユーザー選択は「分類＋要約＋返信下書き（人間確認）」。`contact-notify.gs` に `_analyzeWithGemini()` 追加（`GEMINI_API_KEY` 未設定ならスキップ＝無影響）。Gemini で問い合わせを分類・緊急度・要約・返信下書き化し**運営通知メールに添える**。送信者へは定型受付返信のまま（AI文の自動送信はしない）。委託先にGoogle(Gemini/Gmail)を追加（プライバシーポリシー4項）。無料Geminiは学習利用の可能性ありのため本文に患者個人情報を書かない運用が前提。完全自動返信は医療リスクで非採用。
- 🔜 **人間側の作業は `docs/本番反映TODO_2026-06-06.md` に集約**：master反映＋migration 015/016/017 を順に適用（015は適用前にバケット0件確認）／法務文面の〔 〕記入＋専門家レビュー／Anthropic越境送信(ZDR・同意)の整理／（有料）Supabase Pro でバックアップ・Sentry・Stripe。
- 検証：`tsc --noEmit` パス・lint エラー0（既存の userRole 未使用 warning のみ）。本番ビルドのフォント取得エラーはサンドボックスのネット制限で無関係。

## 引き継ぎ（2026-06-05 — ケアプランPDFの個人情報対策・本番投入済み）

### このセッションで完了（PR #28 merged）
- **ケアプランの個人情報をAIに送らない方針へ変更**（背景：ケアマネのケアプランPDFには利用者の氏名・住所・生年月日が含まれ、AI生成時にそのまま Anthropic へ送信されていた。アプリのテキスト側は「年齢・主病名・要介護度」だけに絞っているのに、PDF/画像添付だけが防御を素通りしていた）：
  - **ケアプラン添付を「写真のみ」に変更**（基礎情報の新規 `app/patients/new`・編集 `app/patients/[id]/edit`）。`ImageUploader` の `allowFiles` を外し、PDF/Excelのファイル添付を廃止。`accept="image/*"` なのでスマホはカメラ起動/フォトライブラリ両対応。紙でもPDFでも「個人情報を隠して写真に撮って登録」する運用に統一（ITリテラシー低い利用者向けに「打つ or 撮る」の2択へ単純化）。
  - **登録UIに赤枠の注意書き追加**：「氏名・住所・生年月日が写らないように撮影/マスクしてください。AIが読むのは課題・援助目標・サービス内容だけ。PDFで届いた場合も画面表示して隠した状態で写真に撮って登録」。
  - **`lib/care-plan-images.ts` の `loadCarePlanAttachments` はPDFをAIに渡さない**（保存・閲覧のみ。Excelと同じ扱い）。既存のレガシーPDFも送信されない（多重防御）。`documents` は後方互換で常に空配列を返す。
  - **看護計画3ルートの添付画像判定を画像拡張子ベースに変更**（`generate`/`generate-issues`/`suggest-labels` の `hasCarePlanImage`）。PDFのみ登録の患者にAIが「添付画像を読め」と誤指示しないように。
  - 検証：`tsc --noEmit` パス・lintエラー0。
- ⚠️ **未対応（運用判断として残る）**：アプリは元々SOAP・主病名等の医療情報をClaudeに送る設計。医療情報の越境送信そのものの扱い（Anthropicの非学習・最大30日保持の規約確認、必要に応じ ZDR 契約、利用者・家族の同意）は本PR対象外。他事業所展開時に要検討。
- 🔜 **本番デプロイ後の確認**：実機で「個人情報を隠して撮影→登録→看護計画生成」が今まで通り動くか。`document` ブロック廃止で AI が画像のみ参照になっている点も確認。

## 引き継ぎ（最終更新: 2026-06-01 — マルチテナント化＋周辺機能 一通り完了・本番投入済み）

### このセッションで完了（PR #17〜#26 merged・migration 011〜014 本番適用＆検証済み）
- **マルチテナント化（事業所ごとデータ分離）**：
  - migration 011: `organizations` / `memberships` 新設、全8データテーブルに `org_id`、RLSを「authenticated全許可」→「自分の所属事業所(`current_org_ids()`)だけ」へ全面書換、既存データを「既定の事業所」へ自動移行、セルフ登録RPC（`create_organization`/`join_organization`）。SECURITY DEFINER ヘルパー(`current_org_ids`/`is_org_admin`)で再帰回避。
  - `lib/storage.ts`: 書き込み系すべてに `org_id` 注入（`getCurrentUserAndOrg`）。reads は RLS 任せ。
  - `components/AuthGate.tsx`: membership ベースのアクセス判定。未所属→オンボーディング（事業所作成 / 参加コード参加 / メール招待の自動参加）。011未適用時は旧 allowed_users 方式へフォールバック。
  - 本番検証：別Googleアカウントで新事業所作成→患者0件（＝分離成功）を確認済み。
- **migration 012 + 管理画面刷新**（`app/admin/page.tsx`）：membershipベース（メンバー一覧・権限変更・削除・参加コード表示＋再発行）。最後の管理者は降格/削除不可。RPC: `list_org_members`/`set_member_role`/`remove_member`/`regenerate_join_code`。
- **migration 013 + メール招待**：`org_invites`、`invite_member`/`accept_invites`。ログイン時に自分宛て招待を消化して自動参加。旧 allowed_users の未参加メールを招待へ一括移行（今回きり）。
- **migration 014 + 評価リマインダ**：`organizations.care_plan_review_months`（既定6）＋`set_care_plan_review_months`。管理画面で評価周期(1/3/6/12/カスタム月)を設定→「最終評価日（作成日 or 課題評価日の新しい方）＋周期」を過ぎた有効計画に、看護計画書ページのバナー＋利用者一覧の「評価時期」バッジ。`isCarePlanReviewDue`/`getCarePlanReviewMonths`/`getPatientsNeedingPlanReview`。※周期は事業所一律。
- **画像自動圧縮**（`compressImage`）：長辺2000px・JPEG化（2〜4MB→200〜600KB）。EXIF除去の副次効果。
- **ケアプランの PDF/Excel 添付**：`ImageUploader` の `allowFiles`、`care-plan-images.ts` の `loadCarePlanAttachments`（画像=vision / PDF=document を Claude へ）。看護計画3ルート反映。`ai-client.ts` に `AiDocumentInput`(PDF) 追加。**Excelは保存・閲覧のみ（AI読込は未対応）**。
  - ⚠️ **2026-06-05（PR #28）で方針変更**：個人情報対策のため、ケアプラン添付は**写真のみ**に変更し、PDFはAIに渡さなくなった（保存・閲覧のみ）。`allowFiles` は外し、`loadCarePlanAttachments` の PDF→document 経路は廃止。最新の扱いは冒頭 2026-06-05 の引き継ぎを参照。`ai-client.ts` の `AiDocumentInput` 自体は残置（将来用）。
- **アプリ内 使い方ガイド**：`docs/使い方ガイド.md`（単一ソース）を `/guide` で react-markdown 表示。画像は `public/guide/`。ホームヘッダに「使い方」リンク。実スクショ16枚配置済（ログイン〜記録〜各書類〜管理）。編集者向け記述は削除済。
- **🔴 保存失敗のUI通知**：`savePatient`/`saveNursingContents` を boolean 返却化し、各呼び出しで `SAVE_FAIL_MESSAGE` を表示（成功時のみ遷移/反映）。新規/編集・看護内容リスト・記録後の候補反映・やること・旧欄削除に適用。書類4フォームは元から表示済。
- **旧ケアプラン欄の削除ボタン**：看護計画書ページの移行バナーに「この旧欄を削除する」追加（`carePlan` をクリア）。
- 機能別レビュー: `docs/レビュー_機能別_2026-06-01.md`。運用補助SQL: `supabase/manual/011_verify.sql`・`011_rollback.sql`。

### 次回再開時タスク（バックログ）
- 🆕 **問い合わせフォーム**（他事業所展開時に必要・後日）：看護師からの問い合わせ窓口。送信先・通知方法（メール/Slack 等）と、事業所/送信者の自動付与を要検討。
- **Excel の AI 読込**：現状は保存・閲覧のみ。SheetJS 等でテキスト化→プロンプト注入。
- **Storage の org 分離仕上げ（Stage 3b）**：写真パスを `org_id` プレフィックス化＋`storage.objects` RLS＋既存ファイル移行。※現状もDB行（パス置き場）はorg分離済みで実害は出ない設計。
- **レガシー撤去**：`app/api/admin/users`・`app/api/admin/password`（UI不使用）、`app_settings.org_password`、`allowed_users`。`check-access`/`setup` は AuthGate のフォールバックで残す。
- **任意の片付け**：テスト用「テスト事業所」削除（患者0件なら `delete from organizations where id='...'`）／`docs/` 直下の未使用予備スクショ12枚の整理。
- **見送り中**：看護計画書画面から基礎情報ケアプランを開くショートカット（ユーザー指示）／利用者ごとの評価周期の個別上書き（要望が出たら）。

## 引き継ぎ（最終更新: 2026-05-29 — SOAP品質改善・Prompt Caching・過去SOAP参考化 master投入完了）

### 次回再開時の最優先タスク
1. **本番動作確認（2026-05-29 デプロイ分）**：
   - **Prompt Caching**：本番で `cache_read_input_tokens` が発生しているか Anthropic Console で確認。朝の集中時間帯でヒット率が出る想定。1時間TTL・SOAP生成のみ対象（questions/alerts は system が Haiku キャッシュ最小2048トークン未満で対象外）
   - **過去SOAP参考化**：基礎情報ページで過去SOAPを書式自由・コロン不要で貼り付け→保存→SOAP生成で「過去記録の参考」として使われるか
   - **既存患者の後方互換**：旧形式（S/O/A/P）の initialSoapRecords が getPatient の normalizeInitialSoap で生テキストに正しく変換・表示されるか
2. **不要ブランチ削除**：`feat/soap-output-refine`・`feat/soap-prompt-caching`・`feat/initial-soap-freetext`（いずれも master マージ済み）
3. **古いmemory整理**：`project_kango_prompt_caching_pr.md`（「PR #5 merge待ち」記載／実際は 3445836 で別実装・完了済み）を削除

### 完了（2026-05-29 セッション — 3改修 master投入）
- **0395364**：SOAP品質改善。O=事実／A=評価／P=計画 の役割を厳密化、S話者分類（本人/妻/娘をラベル保持）、`corrected_s_input`＋ラベル一致・8割長さフォールバックで S情報の完全保持（簡略化・ラベル落ち解消）、Few-shot 例1/2の A純化・P計画文化、S情報あり例4追加。P欄が S情報・A課題に対応する計画を含むように改善
- **3445836**：Prompt Caching（1時間TTL）。`ai-client.ts` に `cacheSystemTtl` オプション追加、`soap/route.ts` の固定system（約14,000トークン）をキャッシュ。実測（run.ts soap all）で 2件目以降 cache_read=14,097、入力コスト約66%削減
- **1e7527c**：過去SOAP生テキスト参考化。`initialSoapRecords` を `{S,O,A,P}`→`{text,visitDate}` に、`getPatient` で後方互換変換（DBマイグレーション不要）、SOAP生成では「用語・言い回しの参考」（judgment-only）に分離
- 検証: `tests/prompts/soap/baseline-2026-05-29.json` / `post-oap-sspeaker-2026-05-29.json`、詳細は `tests/prompts/soap/CHANGELOG.md`
- 関連相談: 当初の「トークン使いすぎ」は Prompt Caching で解決（5月実コスト $8.46≒約1,300円、定常運用で月約2,300円・全員利用で約3,000〜3,400円の試算）

---

## 引き継ぎ（最終更新: 2026-05-18 — 529過負荷エラー対策 + 横断スキル化 master投入完了）

### 他端末（Windows）でセットアップする時にやること
- このリポジトリには `.claude/skills/external-api-resilience/SKILL.md` という横断スキルが入っている
- **初回 pull 後に `C:\Users\thegl\.claude\skills\external-api-resilience\` へコピー**（または `mklink /D` でシンボリックリンク）すると、kango-app 以外のプロジェクトでも同じ「外部APIエラー耐性パターン」が呼び出される
- 中身は「外部API呼び出しで 5xx/429/timeout 等が画面に出たら、分類 → 自動リトライ → ユーザー向け文言」の手順書。次に別アプリで同じ症状を踏んだ時に Claude が自動的に参照する
- 更新があればこのリポジトリ側で編集 → `~/.claude/skills/` 側に再コピー（あるいは事前にシンボリックリンクにしておけば同期不要）

### 次回再開時の最優先タスク
1. **529 エラー対策の実運用検証（PR #14 改修後）**：本番で確認
   - 過負荷エラー時に画面の文言が「ただいまAI（Claude）側が混み合っているため…1〜2分ほど待ってから〜入力内容は自動保存されている」になっているか
   - 自動リトライで救済されて画面エラーが出ないケースが増えたか
   - 通常SOAP生成・看護計画書生成・褥瘡計画書生成・月次報告書・情報提供書がいずれも今まで通り動くか
2. **看護ケアリストUIの実運用FB（PR #12 改修後）**：本番で追加・削除候補の動作確認
   - 追加候補：採用 / 却下 / 編集してから採用 の3アクションが期待どおり動くか
   - 削除候補：削除 / 却下（リストに残す）/ 編集して残す の3アクションが期待どおり動くか
   - リアルタイムに候補が画面から消える挙動が違和感ないか
   - 「AIで整え直す」が消えたことで操作が分かりやすくなったか
3. **実運用フィードバック収集（PR #11 改修後の品質チェック）**：何件か作ってみて以下を確認
   - 看護の内容欄が報告書レベルで詳細に書けているか（800〜1500字目安）
   - 他欄が簡潔になり、重複が減っているか
   - 文体: 訪問体制冒頭明示・問題ごと段落分け・観察→現状→介入の3部構成になっているか
   - サンプルとの粒度比較（化学療法ケース：`memory/project_info_provision_sample.md` ※あれば）
4. **音声誤変換FB（PR #13 反映後）**：併願→閉眼／肉毛→肉芽／色・慰労・要ろう→胃瘻／外相→咳嗽 が補正されているか実運用で確認。新たな誤変換パターンがあれば次回まとめて追加
5. **改善判断**：実運用FBで品質に納得いかなければ Few-shot 化を検討
   - **Few-shot コスト試算**: Haiku で 1ペア +¥0.5/呼び出し、3ペアで +¥1.5/呼び出し（月100件で +¥150）
   - **判断基準**: システムプロンプト改修だけで十分なら現状維持 / 文体・粒度が安定しないなら Few-shot 1〜3ペア追加
   - **Few-shot 化時の注意**: 固有名詞引きずり対策（「Few-shot は文体例、固有名詞は実SOAPからのみ」を強調）／領域分散（化学療法・慢性疾患安定期・認知症など2〜3ケース）／個人情報マスキング判断

### 次フェーズ候補
1. **褥瘡計画書 写真登録機能**：`memory/project_pressure_ulcer_photo.md` 参照
2. **Few-shot例の領域分散**：月次報告書/情報提供書は現在 Few-shot 未使用。実記録ベースで分散追加検討
3. **計画評価機能**（半年ごと、記録からの修正提案）
4. **PT用SOAPプロンプト追加**（30分・分岐のみ）
5. **Next.js 16 対応**：`middleware.ts` → `proxy.ts` 移行（deprecation警告対応）

### 完了（2026-05-18 セッション — 過負荷エラー対策 master投入）

#### PR #14（commit cea0b43）— 529過負荷エラーの自動リトライ＋利用者向けエラー文言
- **背景**：本番で「SOAPを生成する」を押した際、画面に生のJSON `529 {"type":"error","error":{"type":"overloaded_error",...}}` が表示され、初めての利用者が対処方法が分からない状態だった。原因は Anthropic 側の一時過負荷（HTTP 529）。
- **lib/ai-client.ts**：`AiError` 例外クラスと `classifyAiError` 分類関数を新設。
  - 種別：`overloaded` / `rate_limit` / `timeout` / `auth` / `bad_request` / `other` の6種
  - 529 / 503 / 502 / 504 / 429 / ネットワーク瞬断は指数バックオフ（2s→4s）で最大2回まで自動リトライ
  - timeout は既に30秒待たせているので即時 fail（ユーザー判断に委ねる）
  - Anthropic は失敗リクエスト非課金なのでリトライ回数によるトークン消費ゼロ
- **lib/ai-error-response.ts（新規）**：`aiErrorResponse(e)` ヘルパ。種別ごとに「次の一手」が伝わる日本語文言を返す。
  - 過負荷：「ただいまAI（Claude）側が混み合っているため…1〜2分ほど待ってから、もう一度ボタンを押してお試しください。入力内容は自動保存されているので、入力し直しは不要です。」
  - レート制限：「短時間にAIへのリクエストが集中しました。1分ほど待って〜」
  - タイムアウト：「通信状況を確認のうえ〜」
  - 認証：「管理者へご連絡ください」
- **対象ルート**：AIを呼ぶ 11 ルート全部に統一適用
  - `soap/route.ts` / `visit-report/generate/route.ts` / `info-provision/generate/route.ts`
  - `pressure-ulcer-plan/route.ts`
  - `nursing-care-plan/{generate,evaluate,suggest-labels,generate-issues}/route.ts`
  - `nursing-contents/{extract,appointments,diff}/route.ts`
- **意図的に除外**：`soap/questions/route.ts` はサイレント fallback（記録作成を止めない既存設計）のため維持

#### 横断スキル化 — `.claude/skills/external-api-resilience/SKILL.md`
- 外部API（Anthropic / OpenAI / Supabase / Stripe など）の 5xx・429・timeout 等が画面に出た時の標準対応パターンを skill 化
- 起動条件：「画面に生のAPIエラーが見えている screenshot」「エラー対応どうする？」「新規外部API呼び出し追加」
- 手順：分類 → 自動リトライ（overloaded/rate_limit のみ） → メッセージ3要素（何が起きた・何をすべき・何が安全か） → ヘルパ集約 → 全ルートに横展開
- 他プロジェクトでも使えるように汎用化。kango-app PR #14 を参考実装としてリンク
- Windows ローカル使用時：`~/.claude/skills/` にコピー or symlink すること（CLAUDE.md 冒頭に記載）

---

### 完了（2026-05-15 セッション — 2PR master投入）

#### PR #12（commit 0ccbccb）— 看護内容UI改修：対話的な追加・削除候補に統合
- **背景**：看護ケアリストページに2つのAI機能（UI A「AIで記録を分析する」/ UI B「AIで整え直す」）が並列していて使い分けが分かりづらかった
  - UI B（refine）は全置き換え前提で、個別に「残す/捨てる」ができず実運用で使い物にならなかった
  - UI A（diff）は候補に「採用」しかなく、不要な候補を捨てたり文言を直してから採用したりできなかった
- **変更**：
  - UI B（refine）を完全削除：カード・state・API route (`/api/nursing-contents/refine`) ごと
  - UI A の追加・削除候補に以下のアクションを追加：
    - 追加候補：✓採用 / ✏️編集してから採用 / ✗却下
    - 削除候補：🗑️削除 / ✏️編集して残す / ✗却下（リスト残留）
  - 採用・却下した候補はリアルタイムに画面から消える
- **対象**：`app/patients/[id]/nursing-contents/page.tsx`、`app/api/nursing-contents/refine/`（削除）

#### PR #13（commit 233367d）— 音声誤変換補正リスト追加
- 実運用FBで頻出していた誤変換パターンを3プロンプトに反映：
  - 併願 → 閉眼（覚醒・意識レベル文脈）
  - 肉毛 → 肉芽（創部・褥瘡文脈）
  - 色 / 慰労 / 要ろう → 胃瘻（経管栄養文脈）
  - 外相 → 咳嗽（既存「外装→咳嗽」と並列）
  - 先発 → 洗髪（SOAPプロンプトにも明示。visit-report / info-provision には既存）
- **対象**：`app/api/soap/route.ts`（マークダウン箇条書き形式）/ `app/api/visit-report/generate/route.ts`（1行スラッシュ区切り）/ `app/api/info-provision/generate/route.ts`（同上）

---

