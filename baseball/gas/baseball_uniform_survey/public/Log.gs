/**
 * 運用ログ。回答・自由記述本文・UUID・hash・test token・メールアドレスは絶対に出力しない。
 * 出力するのはイベント名と、設問ID・エラーコード・件数だけ。
 * 18歳未満の拒否は件数に数えず、イベント名 ineligible だけを技術ログに残す（survey回答件数には含めない）。
 */
var LOG_ALLOWED_FIELDS = ['code', 'fields', 'count', 'reason'];

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
