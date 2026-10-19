/**
 * 運営者向け通知（Issue #380）。有効/無効は survey.config.json の notification.enabled で明示する。
 *  - productionの有効回答を保存した後だけ呼ぶ（test mode・18歳未満・検証失敗・重複では呼ばない）。
 *  - 「新規有効回答1件」と本番累計件数・受信日時だけを text/plain で送る。個票・自由記述本文・UUID・hashは載せない。
 *  - 宛先はScript Property。送信失敗でも例外を外へ出さず、保存済み回答を失敗扱いにしない。
 */
function buildNotificationBody_(total, now) {
  var stamp = Utilities.formatDate(now, REQUIRED_TIMEZONE, 'yyyy/MM/dd HH:mm');
  return [
    '名古屋野球ユニ部アンケートに、新規の有効回答が1件ありました。',
    '',
    '受信日時：' + stamp,
    '本番の有効回答数（累計）：' + (total === null ? '取得できませんでした' : total + '件'),
    '',
    '回答内容はこのメールには含まれません。'
  ].join('\n');
}

/** @return {'sent'|'failed'} notification_status 列へ保存する値 */
function notifyNewResponse_(sheet, now) {
  try {
    var recipient = getProperty_(PROP_NOTIFICATION_EMAIL).trim();
    if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(recipient)) throw new Error('recipient_not_configured');
    var total = null;
    try { total = countProductionResponses_(sheet); } catch (ignored) { /* 件数が取れなくても通知は送る */ }
    MailApp.sendEmail({ to: recipient, subject: SURVEY_CONFIG.notification.subject, body: buildNotificationBody_(total, now) });
    return 'sent';
  } catch (error) {
    // 本文・宛先は出力しない。原因の種別のみ記録する。
    logEvent_('notification_failed', { reason: error && error.message === 'recipient_not_configured' ? 'recipient_not_configured' : 'send_error' });
    return 'failed';
  }
}
