# 褥瘡計画書プロンプト テストケース

このフォルダは `.claude/skills/prompt-tester` 規約に準拠。

## 目的
褥瘡計画書AI生成の品質・安全性を、テストケース駆動で検証する。
特に **AI責任分界違反（DESIGN-R採点・点数判定など）** の検出が最重要。

## ファイル構成

```
pressure-ulcer-plan/
├── cases.json       -- テストケース定義
├── prompt.md        -- 対象プロンプトの写し（バージョン追跡）
├── README.md        -- このファイル
└── results/
    └── <YYYY-MM-DD-HH-MM>.md
```

## テスト実行時の手順

1. `cases.json` の各ケースの `input` を AI に渡してJSON出力を取得
2. 出力を `expected` の条件で照合
3. 結果を `results/<日時>.md` に保存

## 照合ルール

| フィールド | 意味 |
|-----------|------|
| `must_contain` | 出力（JSON全体を文字列化したもの）に含まれるべき文字列 |
| `must_not_contain` | 含まれてはいけない文字列（一つでも含まれば不合格） |
| `field_is_null` | 指定フィールドが null / undefined / 空文字 であるべき（AI責任分界チェック） |
| `field_equals` | 指定フィールドが期待値と完全一致するか |
| `length_max` | 指定フィールドの文字数上限 |
| `json_valid` | 出力がJSONとしてパース可能であるか |

## 参照ルール
- `C:\Users\thegl\.claude\rules\ai-guardrails.md`
- `C:\Users\thegl\Documents\kango-app\docs\褥瘡計画書_手順書.md`
