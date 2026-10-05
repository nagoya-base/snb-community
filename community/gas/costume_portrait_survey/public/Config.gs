/**
 * 男性の衣装・ポートレート意識調査（Issue #334）Public GAS：設定・締切判定。
 * 秘密値（salt・通知先・締切・Spreadsheet ID）はすべてScript Propertyで管理し、リポジトリへ入れない。
 *
 * 必要なScript Property（初回に手動設定。README参照）:
 *   SPREADSHEET_ID      本調査専用Spreadsheetの ID
 *   RESPONDENT_SALT     setupScriptProperties() で自動生成（上書きしない）
 *   SURVEY_CLOSES_AT    締切（タイムゾーン付きISO 8601。例 2026-11-15T23:59:59+09:00）
 *   NOTIFICATION_EMAIL  Q30通知の宛先
 *
 * 任意のScript Property:
 *   LIVE_TEST_ENABLED   E2E実送信テストを許可する間だけ true。未設定/false は拒否（既定）。
 */

var PROP_SPREADSHEET_ID = 'SPREADSHEET_ID';
var PROP_SALT = 'RESPONDENT_SALT';
var PROP_CLOSES_AT = 'SURVEY_CLOSES_AT';
var PROP_NOTIFICATION_EMAIL = 'NOTIFICATION_EMAIL';
var PROP_LIVE_TEST_ENABLED = 'LIVE_TEST_ENABLED';

var SHEET_RESPONSES = 'responses';
var SHEET_META = 'meta';

var MIN_SALT_LENGTH = 16;
var LOCK_WAIT_MS = 20000;

var NOTIFICATION_SUBJECT = '【衣装・ポートレート意識調査】応援メッセージが届きました';

function getProperty_(key) {
  var value = PropertiesService.getScriptProperties().getProperty(key);
  return typeof value === 'string' ? value : '';
}

/** E2E実送信テストは明示的に true の間だけ許可。未設定・他の値はすべて無効。 */
function isLiveTestEnabled_() {
  return getProperty_(PROP_LIVE_TEST_ENABLED).trim().toLowerCase() === 'true';
}

/**
 * 締切文字列を厳密に解釈する。タイムゾーン付きISO 8601のみ受理し、
 * 未設定・不正値・parse不能・存在しない日付は null（= 締切扱い / fail closed）。
 */
function parseCloseTime_(text) {
  if (typeof text !== 'string') return null;
  var trimmed = text.trim();
  var match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.exec(trimmed);
  if (!match) return null;
  var month = Number(match[2]);
  var day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || Number(match[4]) > 23 ||
      Number(match[5]) > 59 || Number(match[6] || 0) > 59) return null;
  var time = Date.parse(trimmed);
  if (isNaN(time)) return null;
  // 2/30 のような存在しない日付を丸め込まない。
  var utc = new Date(Date.UTC(Number(match[1]), month - 1, day));
  if (utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
  return time;
}

/** 受付中か。締切時刻ちょうど（now == 締切）は受付中、1ミリ秒でも超えたら締切。 */
function isSurveyOpen_(now) {
  var closesAt = parseCloseTime_(getProperty_(PROP_CLOSES_AT));
  if (closesAt === null) return false;
  return now.getTime() <= closesAt;
}

/** UTF-8でのバイト数（V8にTextEncoderが無いため自前で数える）。 */
function utf8ByteLength_(text) {
  var bytes = 0;
  for (var i = 0; i < text.length; i++) {
    var code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xD800 && code <= 0xDBFF) { bytes += 4; i++; }
    else bytes += 3;
  }
  return bytes;
}
