# kango-app — AI訪問看護記録アシスト

## 引き継ぎ（最終更新: 2026-04-15 夕方）

### 🔴 帰宅後の再開ポイント（次セッション冒頭でこれを読むこと）

**作業中ブランチ**: `claude/nursing-plan-evaluation-ZeAUi`（push済・masterにはまだマージしていない）

**やっていたこと**: 看護計画の分離 + 定期評価機能の実装。責任者合意済みの設計方針で進行中。

**次にやる作業**: 下記「未完了」の ④〜⑥ を実装する。着手順は **④ → ⑤ → ⑥**。  
ユーザー判断待ち：「A案（④だけ先にコミット→確認→⑤⑥）」か「B案（④⑤⑥まとめて）」。冒頭で確認すること。

**重要**: migration 005 はまだ Supabase に適用していない。責任者レビュー後に適用する。④以降の実装は該当テーブル/カラムを前提に書いてよいとユーザー合意済み。

---

### このセッション（2026-04-15）で合意した設計方針

#### 看護計画の分離
- 現状の `patients.care_plan`（全部入り1フィールド）は **残す**（ケアマネ会議方針・訪問方針として。SOAP生成プロンプトでも引き続き参照）
- 看護計画は別テーブル `nursing_plans` に分離（問題リスト構造化・version世代管理）
- 評価は `nursing_plan_evaluations` に保存（AI提案 → 看護師承認で新version作成）
- **評価周期は患者ごとにバラバラなので** `patients.next_evaluation_date` + `evaluation_cycle_months` で管理
- デフォルト周期 **6ヶ月**（3/6/12から選択可）
- 看護師判断でいつでも評価起動可能（`trigger_type='adhoc'`）

#### アーカイブ仕様（ユーザー指示）
- 履歴は全て残す（`nursing_plans.status='archived'`）
- 表示は「active計画のみ」がデフォルト
- 「過去履歴を見る」ボタンで archived を展開表示

#### 評価対象期間（ユーザー指示で柔軟化）
- デフォルト「前回評価日〜今日」
- プリセット「過去3ヶ月 / 過去6ヶ月」
- カスタム日付指定可
- 期間内SOAP件数プレビュー表示
- **100件超なら要約フォールバック**（AIで先にSOAP要約→評価にかける、ユーザー同意済み）

#### SOAP整形の省略抑制（ユーザーからの2番目の要望）
- プロンプトに「情報保持ルール（最重要）」を追加済（commit `6bffe08`）
- 「短文なら短文」ルールを緩和（語彙のみ合わせ、長さはメモ情報量に従う）
- Pの「3〜5文固定」を「3〜6文目安・必要なら以上も可」に緩和
- **実運用でのフィードバック待ち**（ユーザーが使ってみて効果確認する）

#### 容量試算（問題なし・確認済）
- 年間増加 40MB前後。Supabase Free 500MB で10年以上持つ
- 本番はPro推奨（7日アイドル停止回避）
- AI APIコストは年$100以内

---

### このセッションでpush済のコミット（ブランチ `claude/nursing-plan-evaluation-ZeAUi`）

1. **`6bffe08`** `prompt: SOAP整形時の情報省略を抑制`
   - `app/api/soap/route.ts` のsystemPrompt改修
2. **`511963f`** `migration: 看護計画テーブルと評価スケジュール列を追加`
   - `supabase/migrations/005_nursing_plans.sql` 新規作成
   - nursing_plans / nursing_plan_evaluations / patients列追加
3. **`5898434`** `feat(patient): 評価スケジュール入力欄を登録・編集画面に追加`
   - `lib/storage.ts` に nextEvaluationDate / evaluationCycleMonths
   - `app/patients/new/page.tsx` と `app/patients/[id]/edit/page.tsx` にUI追加

### 完了（以前）
- Supabase: Google認証 + RLS + SQLマイグレーション
- Vercel: masterマージ → 本番デプロイ
- Googleログイン・患者一覧・ログアウト動作確認OK
- SOAP誤変換対策：副雑音・緊満感・更衣・洗髪・著明の補正ルール（2026-04-13 push済）
- Homeボタン追加（訪問記録作成・看護内容リスト）
- 褥瘡計画書の手順書作成：`docs/褥瘡計画書_手順書.md`
- 報告書3様式のリサーチ完了・`docs/報告書3様式_手順書.md` 作成
- **月次一括コピー機能は実装済だった**（`app/patients/[id]/page.tsx` の月別Accordion + 月まとめコピー。要望1は完了扱いでOK）

### 責任者からの要望（2026-04-13受領・優先順）
1. 月ごとのSOAP記録一括コピー機能 → **既に実装済みで完了**
2. 褥瘡計画書の自動生成（**最優先**）
3. 訪問看護報告書（通常／精神科）の月次自動生成
4. 訪問看護情報提供書の自動生成（宛先4種）
5. 看護計画の半年評価・記録からの修正提案 ← **今これをやっている**

出力形式：カイポケに項目別コピペできるテキスト（PDFは後回し）

### 未完了

#### 看護計画評価機能（現在進行中、このブランチで完結させる）
- [ ] **④ 看護計画CRUD UI**（問題リスト入力・active/archived表示・過去履歴ビュー）
  - 患者詳細画面（`app/patients/[id]/page.tsx`）に「看護計画」タブまたはセクション追加
  - 問題ごとにカード表示（問題／目標／介入リスト）
  - `lib/storage.ts` に nursing_plans 操作関数（getNursingPlan, saveNursingPlan, archivePlan）を追加
  - 「過去履歴を見る」ボタンで archived を展開
- [ ] **⑤ 評価フロー実装**
  - 期間選択ダイアログ（デフォルト/3ヶ月/6ヶ月/カスタム、件数プレビュー）
  - `app/api/nursing-plan-evaluation/route.ts` 新規作成（AI評価API）
  - 100件超時の要約フォールバック
  - diff承認UI（AI提案と現行計画を並べて表示、問題単位で採用/却下）
  - 承認時に新 version 作成・`next_evaluation_date` を `evaluation_date + cycle_months` で更新
  - 「今すぐ評価する」ボタン（`trigger_type='adhoc'`）
  - SOAP生成プロンプト（`app/api/soap/route.ts`）に **active な nursing_plan を渡す** 追加改修（計画参照しながらアセスメント生成）
- [ ] **⑥ 評価時期アラートバッジ**
  - 患者一覧（`app/patients/page.tsx`）で当月・翌月評価予定の患者にバッジ
  - 患者詳細画面でも評価時期バナー

#### マージ・本番適用
- [ ] Supabase SQLエディタで `005_nursing_plans.sql` 実行（責任者レビュー後）
- [ ] PR作成 → masterマージ → Vercel本番反映
- [ ] 既存患者への影響確認（care_planを看護計画テーブルに手動転記するかは各事業所判断。自動分割はしない）

#### 別機能（別ブランチで対応）
- [ ] 褥瘡計画書：プロンプト設計→UI→DB migration→実装
- [ ] 報告書3様式：プロンプト設計→UI→DB migration→実装
- [ ] SOAP生成の実運用テスト（プロンプト改修の効果確認含む）
- [ ] PT用SOAPプロンプト追加
- [ ] 勤怠機能（King of Time自作）統合 — memory/project_kango_kintai.md
- [ ] 統合アプリ化（診療報酬レーダー・ほうかんナビ・人脈マップ）

### 次回やること（2026-04-15 夜・帰宅後 以降）
1. **最優先**: このブランチの④⑤⑥を完成させる（まずA案/B案をユーザーに確認）
2. 責任者に2つの手順書レビュー依頼（`docs/褥瘡計画書_手順書.md`・`docs/報告書3様式_手順書.md`）
3. 看護計画機能の責任者レビュー依頼（特に migration 005 を実行前に見せる）
4. その後：褥瘡計画書プロンプト設計着手

## 重要ドキュメント
- `docs/褥瘡計画書_手順書.md`：厚労省様式・日本褥瘡学会ガイドライン準拠・カイポケ4カテゴリマッピング済
- `docs/報告書3様式_手順書.md`：保医発0327第2号・2024年改定対応・Barthel/GAF/ADL詳細・4宛先書き分け・DB設計含む
- `supabase/migrations/005_nursing_plans.sql`：看護計画テーブル（責任者レビュー後にSupabaseで実行）
- カイポケのスクショ（褥瘡計画書・通常報告書・精神科報告書・情報提供書）は責任者から受領済

## 重要な2024年改定ポイント
- 訪問看護管理療養費が「1」「2」に区分
- 指示書に「傷病名コード」欄追加
- **精神科訪問看護はGAF尺度の記載が必須化**（記載漏れは返戻リスク）

## AI責任分界
### 報告書3様式
- ❌ AI禁止：Barthel点数・GAF点数・自立度ランク判定、宛先選定、算定区分選定
- ✅ AI可：SOAP集約要約・箇条書き化・文字数調整・宛先別トーン変換

### 看護計画評価
- ❌ AI禁止：計画の最終確定（必ず看護師承認）
- ✅ AI可：期間内SOAPから問題ごとの達成度評価案・次期計画の修正案・根拠SOAPの引用

## 技術情報
- デプロイ: https://kango-app.vercel.app
- 認証: Google OAuth（Supabase Auth）
- DB: Supabase（patients, soap_records, nursing_contents, patient_todos, 追加予定: nursing_plans, nursing_plan_evaluations）
- AI: Claude Haiku 4.5（`claude-haiku-4-5-20251001`、`lib/ai-client.ts:74`）
- ローカル: `C:\Users\thegl\Documents\kango-app`
- GitHub: `https://github.com/well-link-ai-cmd/kango-app`（master）
- 現在の作業ブランチ: `claude/nursing-plan-evaluation-ZeAUi`
- 利用規模: 利用者約100人、スタッフ5人が平日各6件訪問、土日1人6件
