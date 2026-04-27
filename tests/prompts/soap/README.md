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

## モデル並走モード（SOAPのみ）

環境変数 `MODEL` で実行モデルを切り替えられる。`questions` モードは従来通り Haiku 固定。

| 値 | 動作 |
|----|----|
| `haiku`（既定） | Claude Haiku 4.5 で実行 |
| `sonnet` | Claude Sonnet 4.6 で実行 |
| `both` | ケースごとに **Haiku → Sonnet** の順で両方実行し、出力を並べて表示 |

```bash
# Haiku で全ケース（従来動作）
npx tsx tests/prompts/soap/run.ts soap all

# Sonnet 単独
MODEL=sonnet npx tsx tests/prompts/soap/run.ts soap all

# Haiku/Sonnet 並走（H→S 順）
MODEL=both npx tsx tests/prompts/soap/run.ts soap all
```

各実行の末尾に `tokens: in=XXX out=XXX (cache_read=XXX) | 1234ms` が表示される。
`cache_read_input_tokens` は将来 Prompt Caching を導入したときに値が入る（現状は常に 0）。

## スナップショット保存（baseline 用）

環境変数 `OUTPUT_JSON=<path>` を指定すると、SOAP 出力を JSON で保存できる。
プロンプト改修前後の diff を取るベースラインとして使う。

```bash
# 改修前（A1 完了直後）の baseline を保存
OUTPUT_JSON=tests/prompts/soap/baseline-2026-04-27.json \
  npx tsx tests/prompts/soap/run.ts soap all
```

保存される JSON のスキーマ：

```json
{
  "ranAt": "2026-04-27T12:34:56.000Z",
  "modelMode": "haiku",
  "promptHash": "a1b2c3d4",
  "promptMeta": {
    "systemPromptChars": 0,
    "toolDescChars": 0,
    "fewshotChars": 0
  },
  "casesFileHash": "0123abcd",
  "caseFilter": "all",
  "cases": [
    {
      "id": "case-01-structured",
      "description": "...",
      "runs": [
        {
          "model": "haiku",
          "soap": { "extracted_facts": [...], "coverage_check": "...", "S": "...", "O": "...", "A": "...", "P": "..." },
          "rawText": "",
          "elapsedMs": 1234,
          "usage": { "input_tokens": 0, "output_tokens": 0, "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0 },
          "outputChars": { "extracted_facts": 0, "coverage_check": 0, "S": 0, "O": 0, "A": 0, "P": 0 }
        }
      ]
    }
  ]
}
```

- `promptHash`：systemPrompt + toolスキーマ の SHA-256 先頭8桁。改修すると変わる
- `promptMeta`：systemPrompt・tool description・Few-shot の文字数。改修によるトークン削減の目安
- `casesFileHash`：cases.json の SHA-256 先頭8桁。テストケース変更を検知
- `outputChars`：各フィールドの出力文字数。output token 削減効果の計測用

### Phase A→B→C の運用フロー

1. **A2: baseline スナップショット** — 改修前に Haiku で全ケース実行・保存
   ```bash
   OUTPUT_JSON=tests/prompts/soap/baseline-2026-04-27.json \
     npx tsx tests/prompts/soap/run.ts soap all
   ```
2. **B: プロンプト改修（重複削除・強調語整理など）**
3. **B 適用後の再計測** — 別ファイルに保存して baseline と diff
   ```bash
   OUTPUT_JSON=tests/prompts/soap/post-phase-b-2026-04-27.json \
     npx tsx tests/prompts/soap/run.ts soap all
   ```
4. promptHash が変わっていれば改修が反映済み。promptMeta と outputChars の差で削減効果を確認

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

`promptHash` はこの run.ts 上の systemPrompt + toolスキーマから算出する。
ルート側だけ更新して run.ts のミラーを忘れると、baseline と post-改修の
比較が成立しないので注意。
