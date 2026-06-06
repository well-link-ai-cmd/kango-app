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

    // (a) 運営への通知
    if (notifyTo) {
      var adminBody =
        '訪問看護アプリに問い合わせが届きました。\n\n' +
        '■ 種別: ' + categoryLabel + '\n' +
        '■ 事業所: ' + orgName + '\n' +
        '■ 送信者: ' + replyTo + '\n' +
        '------------------------------\n' +
        body + '\n' +
        '------------------------------\n\n' +
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
