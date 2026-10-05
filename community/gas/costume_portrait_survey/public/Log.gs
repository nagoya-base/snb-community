/**
 * 運用ログ。センシティブな回答・自由記述本文・UUID・hash・メールアドレスは絶対に出力しない。
 * 出力するのはイベント名と、設問ID・エラーコード・件数だけ。
 * event: accepted / duplicate / invalid / closed / schema_mismatch / notification_failed / finalize / error
 */
var LOG_ALLOWED_FIELDS = ['code', 'fields', 'count', 'reason', 'stats', 'already'];

function logEvent_(event, details) {
  var entry = { event: event };
  if (details) {
    LOG_ALLOWED_FIELDS.forEach(function (key) {
      if (details[key] !== undefined) entry[key] = details[key];
    });
  }
  try {
    console.log(JSON.stringify(entry));
  } catch (ignored) { /* ログ失敗で処理を止めない */ }
}
