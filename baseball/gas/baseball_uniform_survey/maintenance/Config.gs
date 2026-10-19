/**
 * 名古屋野球ユニ部アンケート（Issue #383）maintenance GAS：設定。
 *
 * maintenance は Public GAS（#380）・Admin GAS（#382）とは別 project・別 Script ID・別 Script Properties。
 * 通常の閲覧・回答受付経路からは呼ばれない（doPost / 回答受付 endpoint を持たない）。
 * production submit の受付可否（opens_at / closes_at）は #380 Public GAS が唯一の権威で、
 * ここでは finalize を締切前に実行しないための precondition としてだけ closes_at を参照する。
 *
 * 書込み権限（OAuth scope: spreadsheets）が必要なのはこの project だけ。Public / Admin の scope は広げない。
 *
 * 必要な Script Property（手動設定。値はリポジトリ・ログに出さない）:
 *   RESPONSES_SPREADSHEET_ID  #380 の Public GAS が書き込む responses Spreadsheet の ID
 * この project が自分で書く Script Property（件数・日時・digest のみ。個票・自由記述・hash・UUID・salt・token は入れない）:
 *   FINALIZED_MARKER / MANUAL_CLEANUP_DONE / CLEANUP_AUDIT
 */
var PROP_RESPONSES_SPREADSHEET_ID = 'RESPONSES_SPREADSHEET_ID';
var PROP_FINALIZED_MARKER = 'FINALIZED_MARKER';
var PROP_MANUAL_CLEANUP_DONE = 'MANUAL_CLEANUP_DONE';
var PROP_CLEANUP_AUDIT = 'CLEANUP_AUDIT';

var SHEET_RESPONSES = 'responses';
var SHEET_FINAL_SNAPSHOT = 'final_snapshot';
var SHEET_RESPONSES_VALID = 'responses_valid';
var OTHER_TEXTS_COLUMN = 'other_texts';

var LOCK_WAIT_MS = 20000;
/* final snapshot は Script Properties に入れず、Sheet のセル上限（50,000 文字）に収まる大きさに分割して保存する。 */
var SNAPSHOT_CHUNK_SIZE = 40000;
var SNAPSHOT_CHUNK_PREFIX = 'c:';

function getProperty_(key) {
  var value = PropertiesService.getScriptProperties().getProperty(key);
  return typeof value === 'string' ? value : '';
}

function setProperty_(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, value);
}

function currentTime_() {
  return new Date();
}

function sha256Hex_(text) {
  return SurveyMaintenance.bytesToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8));
}

/** finalize / cleanup / 手動完了記録の多重実行を防ぐ。 */
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_WAIT_MS);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/** 回答内容・自由記述・hash は出さない。イベント名と件数・状態だけを記録する。 */
function logEvent_(event, fields) {
  console.log(JSON.stringify(Object.assign({ event: event }, fields || {})));
}
