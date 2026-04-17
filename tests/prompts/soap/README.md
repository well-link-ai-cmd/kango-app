# SOAP / questions プロンプト検証テストハーネス

訪問看護記録の SOAP 生成（`/api/soap`）と記載漏れ検出（`/api/soap/questions`）の
挙動を、実際に Claude Haiku 4.5 を呼び出して確認するためのテスト環境。

## 前提

- `.env.local` に `ANTHROPIC_API_KEY=xxx` が設定されていること
- Node.js 20+ が利用できること
- `npx tsx` が使えること（初回は自動ダウンロード・インストール不要）

## 実行方法

プロジェクトルート（`kango-app/`）で：

```bash
# 全ケース × 両方（SOAP + questions）
npx tsx tests/prompts/soap/run.ts all all

# SOAP だけ全ケース
npx tsx tests/prompts/soap/run.ts soap all

# questions だけ全ケース
npx tsx tests/prompts/soap/run.ts questions all

# 特定ケースだけ
npx tsx tests/prompts/soap/run.ts soap case-02-rambling
npx tsx tests/prompts/soap/run.ts questions case-04-already-covered
```

API キーが環境変数に無ければ `.env.local` から自動ロード。
キーを明示する場合：

```bash
ANTHROPIC_API_KEY=sk-ant-xxx npx tsx tests/prompts/soap/run.ts soap all
```

## 出力の見方

SOAPモード：
- `抽出（内部）`：Haiku がメモから拾い上げた事実リスト（内部ステップ）
- `反映チェック（内部）`：各事実を S/O/A/P のどこに反映したか（内部ステップ）
- `S`, `O`, `A`, `P`：最終的にユーザーに返される本体
- `期待する挙動`：`cases.json` の `expectations.soap` を参照表示

questionsモード：
- `memo_covers（内部）`：Haiku が「今日のメモに既に書かれている」と認識した内容
- `expected_from_context（内部）`：前回P・ケアプランから期待される項目
- `gaps（内部）`：上の差分
- `alerts` / `questions`：最終的にユーザーに返される本体
- `期待する挙動`：`cases.json` の `expectations.questions` を参照表示

**内部ステップを見ることで、Haikuの認識ミスが「抽出段階」か「分類段階」かを切り分けできる。**

## ケース

| ID | 主眼 |
|----|------|
| `case-01-structured` | ベースライン：整ったメモがきれいなSOAPになるか |
| `case-02-rambling`   | まとまりのないメモ（話が飛ぶ・時系列逆転・自己訂正）でも情報が拾えるか |
| `case-03-voice-errors` | 音声誤変換の補正が効くか |
| `case-04-already-covered` | questions で既出質問が出ないか（最重要） |
| `case-05-gaps`       | questions で記載漏れを検出できるか |

## ケースの追加方法

`cases.json` に要素を追加するだけ。スキーマは他ケースを参照。

## プロンプト同期の注意

`run.ts` のプロンプト組み立ては `app/api/soap/route.ts` と
`app/api/soap/questions/route.ts` からコピーしたもの。
ルート側のプロンプトを変更したら、このファイルのプロンプトも
同じ内容に更新すること（現状は手動同期）。
