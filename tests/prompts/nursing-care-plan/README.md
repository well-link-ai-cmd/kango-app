# 看護計画書 プロンプトテストハーネス

カイポケ「訪問看護計画書」フォーマット準拠の generate（目標・課題下書き）と evaluate（期間SOAPからの評価下書き）の挙動確認用。

## 使い方

```bash
# .env.local に ANTHROPIC_API_KEY を設定

# 全ケース・両モード実行（約$0.10未満）
npx tsx tests/prompts/nursing-care-plan/run.ts all all

# generate のみ全ケース
npx tsx tests/prompts/nursing-care-plan/run.ts generate all

# 特定ケース
npx tsx tests/prompts/nursing-care-plan/run.ts generate case-01-generate-standard
npx tsx tests/prompts/nursing-care-plan/run.ts evaluate case-06-evaluate-bulk
```

## ファイル

| ファイル | 用途 |
|---|---|
| `cases.json` | テストケース定義（入力・期待挙動） |
| `run.ts` | ランナー（route.ts のプロンプトをミラー） |

## プロンプト同期ルール（重要）

`run.ts` は以下のroute.tsをコピー（ミラー）したものです。本番プロンプトを変更したらここも**必ず同期**してください。

- `app/api/nursing-care-plan/generate/route.ts`
- `app/api/nursing-care-plan/evaluate/route.ts`

同期漏れがあるとテスト結果が本番挙動と乖離します。

## ケース一覧

| ID | モード | 内容 |
|---|---|---|
| case-01-generate-standard | generate | 標準ケース（脳梗塞後・複数課題） |
| case-02-generate-psychiatric | generate | 精神科（統合失調症） |
| case-03-generate-terminal | generate | 終末期（疼痛コントロール） |
| case-04-generate-refine-mode | generate | refineモード（既存保持＋改善） |
| case-05-generate-ai-禁止領域 | generate | AI禁止領域の遵守確認（DESIGN-R/商品名） |
| case-06-evaluate-bulk | evaluate | 一括評価（課題3件・3ヶ月SOAP） |
| case-07-evaluate-少ない記録 | evaluate | 境界条件（3件ちょうど） |

## レビュー観点

各ケースの `expectations` フィールドはレビュー観点リスト。自動検証ではなく、人間が出力を見て判断するためのチェックリスト。

### generate の主要観点

- SOAP にない情報を創作していないか
- DESIGN-R・Barthel・GAF の点数を勝手に付けていないか
- ドレッシング材・薬剤の商品名が出ていないか
- 医師権限文言（処方・変更）を使っていないか
- 末尾に「※AI下書き。看護師確認必須」マーカー
- refineモードで既存内容が保持されているか

### evaluate の主要観点

- course_summary が時系列順（日付明記）になっているか
- change_points が期間対比になっているか
- finding_draft が断定を避け「〜傾向」「〜と考えられる」になっているか
- 入力 issues と同じ順序・件数の evaluations が返っているか
- 末尾に「※AI下書き。最終判定は看護師確認必須」マーカー

## コスト目安

Claude Haiku 4.5 で：
- generate 5ケース ≒ $0.03
- evaluate 2ケース ≒ $0.04
- 全体で約$0.07

実運用前に繰り返し回してもコスト問題なし。

## 次のステップ

1. Few-shot例を `lib/nursing-care-plan-fewshot.ts` に追加（現状プレースホルダー）
2. 現場の実記録 → Sonnet逆生成 → 看護師レビューの流れで3〜5件整備
3. 整備後、run.ts にも Few-shot 組み込み（本番と同期）
