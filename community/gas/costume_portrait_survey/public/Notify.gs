/**
 * Q30（応援・激励メッセージ）通知。本調査のみ、Q30本文をメール本文へ載せることを意図的に許可する。
 *  - 通常回答では送信しない。trim後に内容がある場合のみ1通。
 *  - text/plain。HTMLメールにしない。全回答内容は載せない（Q30本文と回答日時のみ）。
 *  - 宛先はScript Property。
 *  - 回答保存の「後」に呼ぶ。送信失敗でもsubmit失敗にしない（例外を外へ出さない）。
 */
function getCheerMessage_(clean) {
  var text = clean && clean.answers ? clean.answers.cheer_message : '';
  return typeof text === 'string' && text.trim() ? text : '';
}

function buildNotificationBody_(message, now) {
  var stamp = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
  return [
    '「男性の衣装・ポートレート撮影に関する意識調査」に',
    '応援・激励メッセージが届きました。',
    '',
    '回答日時：',
    stamp,
    '',
    'メッセージ：',
    message
  ].join('\n');
}

/** @return {'sent'|'failed'|'none'} notification_status 列へ保存する値 */
function notifyCheerMessage_(clean, now) {
  var message = getCheerMessage_(clean);
  if (!message) return 'none';
  try {
    var recipient = getProperty_(PROP_NOTIFICATION_EMAIL).trim();
    if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(recipient)) throw new Error('recipient_not_configured');
    MailApp.sendEmail({ to: recipient, subject: NOTIFICATION_SUBJECT, body: buildNotificationBody_(message, now) });
    return 'sent';
  } catch (error) {
    // 本文・宛先は出力しない。原因の種別のみ記録する。
    logEvent_('notification_failed', { reason: error && error.message === 'recipient_not_configured' ? 'recipient_not_configured' : 'send_error' });
    return 'failed';
  }
}
