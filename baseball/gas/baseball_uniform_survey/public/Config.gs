/**
 * 名古屋野球ユニ部アンケート（Issue #380）Public GAS：設定・受付可否の判定。
 *
 * 設定の正本:
 *  - 受付期間（opens_at / closes_at / timezone）・最短回答時間・通知の有効/無効 → survey.config.json（SURVEY_CONFIG として生成）
 *  - 保存列・source_channel allowlist・test mode 定義 → survey.schema.json（SURVEY_SCHEMA として生成）
 *  - Script Properties には秘密値だけを置く（受付期間は置かない）。
 *
 * 必要なScript Property（初回に手動設定。README参照）:
 *   SPREADSHEET_ID      本調査専用の新規Spreadsheet の ID（既存surveyのSheetは使わない）
 *   RESPONDENT_SALT     setupScriptProperties() で自動生成（上書きしない）
 *   TEST_TOKEN          submit_excluded 用のtest token（未設定ならtest送信は全て拒否 = fail closed）
 *   NOTIFICATION_EMAIL  運営者向け通知の宛先（notification.enabled=true のとき必須）
 */

var PROP_SPREADSHEET_ID = 'SPREADSHEET_ID';
var PROP_SALT = 'RESPONDENT_SALT';
var PROP_TEST_TOKEN = 'TEST_TOKEN';
var PROP_NOTIFICATION_EMAIL = 'NOTIFICATION_EMAIL';

var SHEET_RESPONSES = 'responses';

var MIN_SALT_LENGTH = 32;
var MIN_TEST_TOKEN_LENGTH = 24;
var LOCK_WAIT_MS = 20000;
var REQUIRED_TIMEZONE = 'Asia/Tokyo';
var RETENTION_BLOCKING_STATUS = 'must_set_before_launch';

function getProperty_(key) {
  var value = PropertiesService.getScriptProperties().getProperty(key);
  return typeof value === 'string' ? value : '';
}

/**
 * 受付日時を厳密に解釈する。「+09:00」付きISO 8601（秒まで必須）だけを受理し、
 * 未設定・不正値・存在しない日付・他のoffsetは null（= 受付不可 / fail closed）。
 */
function parseReceptionTime_(text) {
  if (typeof text !== 'string') return null;
  var match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\+09:00$/.exec(text);
  if (!match) return null;
  var month = Number(match[2]);
  var day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || Number(match[4]) > 23 ||
      Number(match[5]) > 59 || Number(match[6]) > 59) return null;
  // 2/30 のような存在しない日付を丸め込まない。
  var utc = new Date(Date.UTC(Number(match[1]), month - 1, day));
  if (utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
  var time = Date.parse(text);
  return isNaN(time) ? null : time;
}

/**
 * production の受付状態（受付可否の唯一の判定。#383 は再実装しない）。
 *  - 'not_configured' : opens_at / closes_at / timezone が未設定・不正、opens_at >= closes_at、
 *                       または保持期限が未確定（respondentNotice.retention.status = must_set_before_launch）。
 *  - 'not_open'       : opens_at より前
 *  - 'open'           : opens_at <= now <= closes_at（両端を含む）
 *  - 'closed'         : closes_at を1ミリ秒でも超えた
 */
function receptionState_(now) {
  var reception = SURVEY_CONFIG && SURVEY_CONFIG.reception;
  if (!reception || reception.timezone !== REQUIRED_TIMEZONE) return 'not_configured';
  var opensAt = parseReceptionTime_(reception.opens_at);
  var closesAt = parseReceptionTime_(reception.closes_at);
  if (opensAt === null || closesAt === null || opensAt >= closesAt) return 'not_configured';
  var retention = SURVEY_SCHEMA.respondentNotice && SURVEY_SCHEMA.respondentNotice.retention;
  if (!retention || retention.status === RETENTION_BLOCKING_STATUS) return 'not_configured';
  var time = now.getTime();
  if (time < opensAt) return 'not_open';
  if (time > closesAt) return 'closed';
  return 'open';
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
