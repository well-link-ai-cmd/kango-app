# SOAP プロンプト改修ログ

ai-record-tools-design.md の運用に従い、改修ごとに「いつ・何を変えて・何が変わったか」を1行で記録する。

## 2026-04-27 — Phase B（コスト削減＋過去記録の誤変換引きずり対策）

- 変更ファイル: `app/api/soap/route.ts`, `tests/prompts/soap/run.ts`, `tests/prompts/soap/cases.json`
- promptHash 変遷: `593f9cb0`(baseline) → `514643d7`(v1) → `c4222273`(v2) → `96040783`(**v3 採用**)
- casesFileHash: `24ef49c2` → `d1958e12`
- 改修内容:
  - **B1**: tool description 簡素化（663char → 473char、-28.7%）。詳細指示は systemPrompt に集約
  - **B2**: 強調語整理。「特に重要（最優先で守る3項目）」を「推測禁止／補正リスト優先／全段階補正」の3点に集中。旧「特に重要：」「禁止事項」ブロックを統合削除
  - **B3**: 冗長表現精査（systemPromptChars 10838 → 10234、-5.6%）
  - **B4**: extracted_facts 「1事実=1要素」を作業手順に明記
  - **誤変換リスト追加**: 胎動→体動／〜の正常→〜の性状／侵入部→刺入部／外装→咳嗽／常用→上葉／服雑音→副雑音
  - **過去記録 vs 補正リスト優先順位**: 「過去記録の医療用語の表記が補正リストの誤変換と一致する場合は、補正後の用語で書く」を文体ルールに追加
  - **case-03b-voice-errors-extended** 追加: 新誤変換パターンの回帰検出
  - **case-03c-corrupted-history** 追加: 過去記録に汚染データがあるケースで補正リスト優先になるかの検証
- 計測結果（baseline 7ケース vs post-B v3 共通7ケース）:
  - input_tokens 合計: -5,688
  - output_tokens 合計: -950
  - コスト削減率: 8.73%（¥18.53 → ¥16.91）
  - 1ケース平均: ¥2.65 → ¥2.42

- v1→v2→v3 の追加修正:
  - **v2**: S 欄禁止ルールに具体例（本人発言・家族発言・過去記録S・プレースホルダ）を復元。case-05 で S=空 に復帰したが、case-06 のみ S="痛みは楽" が残る
  - **v3 (採用)**: 原因は alertAnswersSection / answersSection のラベル「必ずSOAPに反映」が S 欄まで含むと解釈されたこと。ラベルを「必ず O/A/P に反映。S 欄には入れない」に変更し、S 厳格ルールにも「[AI回答][継続確認回答] の本文は S に入れない」を追加。case-06 で S=空 達成

- 採用した出力品質（v3）:
  - case-03 / case-03b / case-03c: 誤変換補正・過去記録優先順位 全て期待通り
  - case-06: S=空、A/P で AI回答（NRS2/レスキュー/ショートステイ）反映済み
  - case-07: S情報passthrough、A で疼痛増悪・睡眠障害、P で疼痛管理見直し（baselineより改善）
  - 残課題: case-01 で S="膝は昨日より楽になった" が出る。これは baseline からの既存挙動で Phase B では未解決
- やっていないこと:
  - Few-shot 改変（C のスコープ）
  - Sonnet 全面昇格（feedback_optimization_timing.md 違反）
  - Prompt Caching 導入（実運用フィードバック後に再判断）

## 2026-04-20 — Few-shot例3件組み込み（master）

- 変更ファイル: `lib/soap-fewshot.ts`
- 責任者提供の実記録3件（ターミナル・認知症・終末期）を Sonnet 4.6 で逆生成 → 看護師レビュー → 静的埋込
- S情報ポリシー明確化、誤変換補正を全段階適用、tool_use × XML タグ競合を解消（XML→平文ラベル）

## 2026-04-17 — SOAP/questions 精度改善（master）

- Tool use で JSON 強制 + temperature 0.2、Gemini 経路削除、自己チェック機構（extracted_facts / coverage_check）
- テストハーネス `tests/prompts/soap/` 追加（cases.json 7件・run.ts ランナー・README）
