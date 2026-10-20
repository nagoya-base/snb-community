/**
 * 運営者向け通知（Issue #380 / #390）。有効/無効は survey.config.json の notification.enabled で明示する。
 *  - 通知条件: production && 有効回答 && 保存成功 && notification.enabled && support_message が空白以外（呼び出し側で判定）。
 *    通常の回答・feedback・「その他」自由記述だけでは送らない。test mode・18歳未満・検証失敗・重複では呼ばない。
 *  - 本文は 受信日時・本番累計件数・support_message 本文だけを text/plain で送る。他の回答・自由記述・UUID・hashは載せない。
 *  - 宛先はScript Property。送信失敗でも例外を外へ出さず、保存済み回答を失敗扱いにしない。
 */
function hasSupportMessage_(validation) {
  var message = validation && validation.clean && validation.clean.answers ? validation.clean.answers.support_message : undefined;
  return typeof message === 'string' && message.trim() !== '';
}

function buildNotificationBody_(supportMessage, total, now) {
  var stamp = Utilities.formatDate(now, REQUIRED_TIMEZONE, 'yyyy/MM/dd HH:mm');
  return [
    '名古屋野球ユニ部アンケートに、運営への応援・激励メッセージが届きました。',
    '',
    '受信日時：' + stamp,
    '本番の有効回答数（累計）：' + (total === null ? '取得できませんでした' : total + '件'),
    '',
    '「運営への応援・激励メッセージ」',
    supportMessage,
    '',
    'このメールにはメッセージ本文以外の回答内容は含まれません。'
  ].join('\n');
}

/** @return {'sent'|'failed'} notification_status 列へ保存する値 */
function notifySupportMessage_(sheet, supportMessage, now) {
  try {
    var recipient = getProperty_(PROP_NOTIFICATION_EMAIL).trim();
    if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(recipient)) throw new Error('recipient_not_configured');
    var total = null;
    try { total = countProductionResponses_(sheet); } catch (ignored) { /* 件数が取れなくても通知は送る */ }
    MailApp.sendEmail({ to: recipient, subject: SURVEY_CONFIG.notification.subject, body: buildNotificationBody_(supportMessage, total, now) });
    return 'sent';
  } catch (error) {
    // 本文・宛先は出力しない。原因の種別のみ記録する。
    logEvent_('notification_failed', { reason: error && error.message === 'recipient_not_configured' ? 'recipient_not_configured' : 'send_error' });
    return 'failed';
  }
}
