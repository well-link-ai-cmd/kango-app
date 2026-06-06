/**
 * 問い合わせ通知 GAS（Google Apps Script）
 * AI訪問看護記録アシスト /contact から送られた問い合わせを Gmail で通知する。
 *
 * 【これは何】
 *  - Web App として公開し、アプリのサーバ(/api/contact-notify)から POST される。
 *  - 受け取ったら (a) 運営宛に通知メール (b) 送信者宛に自動受付返信 を Gmail で送る。
 *  - Gmail から送るので独自ドメインのSPF/DKIM設定は不要・完全無料。
 *
 * 【セットアップ手順】
 *  1. https://script.google.com で「well-link-ai@05company.com」のアカウントから新規プロジェクト作成
 *  2. このファイルの中身を貼り付け
 *  3. プロジェクトの設定 > スクリプト プロパティ に以下を追加:
 *       TOKEN      … アプリと共有する秘密の文字列（推測されない長いランダム値）
 *       NOTIFY_TO  … 通知先メール（例: well-link-ai@05company.com）
 *       GEMINI_API_KEY … （任意）Gemini APIキー。設定すると問い合わせを
 *                        自動で「分類・要約・返信下書き」して運営通知に添える。
 *                        未設定なら従来どおり通知＋自動受付返信のみ（無影響）。
 *                        ※ 返信下書きは送信前に人間が確認して送る運用（自動送信しない）。
 *                        ※ 無料Geminiは入力がモデル改善に使われ得るため、問い合わせ本文に
 *                           患者個人情報を書かない運用＋規約への明記が前提。
 *  4. 「デプロイ > 新しいデプロイ > 種類: ウェブアプリ」
 *       - 次のユーザーとして実行: 自分
 *       - アクセスできるユーザー: 全員
 *     → 発行された「ウェブアプリのURL」を控える
 *  5. Vercel の環境変数(Production/Preview)に:
 *       CONTACT_GAS_URL   = 上記ウェブアプリURL
 *       CONTACT_GAS_TOKEN = 手順3の TOKEN と同じ値
 *  6. 初回デプロイ時に Gmail 送信の権限承認を求められるので許可
 *
 * ※ TOKEN 検証により、URLを知られても第三者が勝手に送信できないようにしている。
 */

function doPost(e) {
  try {
    var props = PropertiesService.getScriptProperties();
    var expectedToken = props.getProperty('TOKEN');
    var notifyTo = props.getProperty('NOTIFY_TO');

    var data = JSON.parse(e.postData.contents);

    if (!expectedToken || data.token !== expectedToken) {
      return _json({ ok: false, error: 'unauthorized' });
    }

    var categoryLabel = data.categoryLabel || data.category || '問い合わせ';
    var orgName = data.orgName || '(不明な事業所)';
    var replyTo = data.replyTo || '';
    var body = data.body || '';

    // Gemini による自動整理（分類・要約・返信下書き）。未設定/失敗時は null。
    var aiAnalysis = _analyzeWithGemini(categoryLabel, body);

    // (a) 運営への通知
    if (notifyTo) {
      var adminBody =
        '訪問看護アプリに問い合わせが届きました。\n\n' +
        '■ 種別: ' + categoryLabel + '\n' +
        '■ 事業所: ' + orgName + '\n' +
        '■ 送信者: ' + replyTo + '\n' +
        '------------------------------\n' +
        body + '\n' +
        '------------------------------\n';
      if (aiAnalysis) {
        adminBody +=
          '\n===== AIによる整理（Gemini／送信前に必ず人間が確認） =====\n' +
          aiAnalysis + '\n' +
          '====================================================\n';
      }
      adminBody +=
        '\n※ 返信下書きはAIの下書きです。そのまま送らず内容を確認してから返信してください。\n' +
        '※ 詳細・他の問い合わせは管理画面/DB(inquiries)で確認できます。\n' +
        '※ 患者個人情報が本文に含まれていないかご確認ください。';
      MailApp.sendEmail({
        to: notifyTo,
        subject: '[訪問看護アプリ 問い合わせ] ' + categoryLabel + '（' + orgName + '）',
        body: adminBody,
        replyTo: replyTo || undefined,
      });
    }

    // (b) 送信者への自動受付返信
    if (replyTo) {
      var ackBody =
        'お問い合わせありがとうございます。以下の内容で受け付けました。\n\n' +
        '■ 種別: ' + categoryLabel + '\n' +
        '------------------------------\n' +
        body + '\n' +
        '------------------------------\n\n' +
        '内容を確認のうえ、必要に応じてご連絡いたします。\n' +
        '※ 本メールは自動送信です。\n\n' +
        'AI訪問看護記録アシスト / Well-Link AI';
      MailApp.sendEmail({
        to: replyTo,
        subject: 'お問い合わせを受け付けました（AI訪問看護記録アシスト）',
        body: ackBody,
      });
    }

    return _json({ ok: true });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Gemini で問い合わせを「分類・緊急度・要約・返信下書き」に整理して返す。
 * GEMINI_API_KEY 未設定・API失敗時は null（その場合はAI欄なしで通知する）。
 * ※ あくまで運営向けの下書き。送信者へ自動送信はしない（人間が確認して返信）。
 */
function _analyzeWithGemini(categoryLabel, body) {
  var key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) return null;

  // 無料枠で使えるモデル。必要に応じて 'gemini-2.0-flash' 等へ変更可。
  var model = 'gemini-2.0-flash';
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
    model + ':generateContent?key=' + encodeURIComponent(key);

  var prompt =
    'あなたは訪問看護記録アプリ「AI訪問看護記録アシスト」のサポート担当を補助するアシスタントです。\n' +
    '以下の問い合わせを読み、運営担当者が素早く対応できるよう日本語で整理してください。\n' +
    '医療的な助言や確定的な回答は避け、確認・案内にとどめた返信下書きにすること。\n' +
    '患者の個人情報が含まれていても、それを繰り返し記載しないこと。\n\n' +
    '【種別(送信者選択)】' + categoryLabel + '\n' +
    '【本文】\n' + body + '\n\n' +
    '次の形式で簡潔に出力してください:\n' +
    '■AI判定種別: (不具合/要望/質問/その他)\n' +
    '■緊急度: (高/中/低) ＋ 理由を一言\n' +
    '■要約: 2〜3行\n' +
    '■返信下書き(送信前に人間が確認):\n(本文)';

  var payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 700 }
  };

  try {
    var res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) return null;
    var json = JSON.parse(res.getContentText());
    var cand = json && json.candidates && json.candidates[0];
    var text = cand && cand.content && cand.content.parts && cand.content.parts[0] && cand.content.parts[0].text;
    return text || null;
  } catch (err) {
    return null;
  }
}
