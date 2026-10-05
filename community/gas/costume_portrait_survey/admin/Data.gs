/**
 * 読み取り専用のデータ層。Spreadsheetへの書き込み・削除は一切行わない
 * （tests/test_read_only_and_isolation.js が書き込み系APIの不在を静的検査する）。
 */
var SHEET_RESPONSES = 'responses';
var SHEET_META = 'meta';
var PROP_SPREADSHEET_ID = 'SPREADSHEET_ID';
var PROP_CLOSES_AT = 'SURVEY_CLOSES_AT';
/** 自由記述（text型）の列。schema由来。 */
function textColumns_() {
  return SURVEY_SCHEMA.questions.filter(function (q) { return q.type === 'text'; }).map(function (q) { return q.id; });
}

function openSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty(PROP_SPREADSHEET_ID);
  if (!id) throw new Error('not_configured');
  return SpreadsheetApp.openById(id);
}

/** Public GASが数式対策で付けた先頭の ' を戻す（= + - @ の直前のみ）。 */
function unsanitizeCell_(value) {
  return typeof value === 'string' ? value.replace(/^'(?=[=+\-@\t\r])/, '') : value;
}

function parseTimestamp_(value) {
  var time = value && typeof value.getTime === 'function' ? value.getTime() : Date.parse(String(value));
  return isNaN(time) ? null : time;
}

function parseDeadline_(text) {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(text.trim())) return null;
  var time = Date.parse(text.trim());
  return isNaN(time) ? null : time;
}

function parseOtherTexts_(cell) {
  try {
    var parsed = JSON.parse(unsanitizeCell_(String(cell || '{}')));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (ignored) { return {}; }
}

/** responsesを行オブジェクトで読み、内部表現(record)へデコードする。列順に依存しない。 */
function readResponses_(spreadsheet) {
  var sheet = spreadsheet.getSheetByName(SHEET_RESPONSES);
  if (!sheet) throw new Error('responses_sheet_missing');
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2) return [];
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var deadline = parseDeadline_(PropertiesService.getScriptProperties().getProperty(PROP_CLOSES_AT) || '');
  var rows = [];
  values.forEach(function (cells) {
    var obj = {};
    header.forEach(function (name, i) { obj[name] = cells[i]; });
    if (obj.timestamp === '' || obj.timestamp === null || obj.timestamp === undefined) return;
    textColumns_().forEach(function (key) { obj[key] = unsanitizeCell_(obj[key]); });
    var time = parseTimestamp_(obj.timestamp);
    var kind = time === null ? 'unparseable' : (deadline !== null && time > deadline ? 'late' : 'valid');
    rows.push({
      time: time,
      kind: kind,
      record: SurveyCore.decodeRecord(SURVEY_SCHEMA, obj),
      otherTexts: parseOtherTexts_(obj.other_texts)
    });
  });
  return rows;
}

/** metaシート（Public GASが書く key/value）。 */
function readMeta_(spreadsheet) {
  var meta = {};
  var sheet = spreadsheet.getSheetByName(SHEET_META);
  if (!sheet || sheet.getLastRow() < 1) return meta;
  sheet.getRange(1, 1, sheet.getLastRow(), 2).getValues().forEach(function (row) {
    if (row[0] !== '') meta[String(row[0])] = row[1];
  });
  return meta;
}
