/**
 * responses シートの読み取り（read-only）。
 * 列は #380 の Public GAS と同じく schema 由来：
 *   persistenceSchema.systemFields + 全設問ID（schema順）+ other_texts
 * ヘッダーが完全一致しないシートは読まない（別 survey の Sheet を誤って集計しない）。
 */
function expectedHeader_() {
  var ids = SurveyCore.getQuestions(SURVEY_SCHEMA).map(function (q) { return q.id; });
  return SURVEY_SCHEMA.persistenceSchema.systemFields.concat(ids, [OTHER_TEXTS_COLUMN]);
}

/**
 * Admin は spreadsheets.readonly のみ。SpreadsheetApp.open* はフル spreadsheets scope を要求するため使わず、
 * Advanced Sheets サービス（Sheets API v4 の読み取り）で responses シートを取得する。
 * 書き込み系（values.update / append / clear / batchUpdate 等）は呼ばない。
 * 事前に Apps Script エディタの「サービス」で Sheets API を追加し、紐づく GCP project で Sheets API を有効にする。
 */
function getResponsesSpreadsheetId_() {
  var id = getProperty_(PROP_RESPONSES_SPREADSHEET_ID);
  if (!id) throw new Error('not_configured');
  return id;
}

function responsesSheetExists_(id) {
  var meta = Sheets.Spreadsheets.get(id, { fields: 'sheets.properties.title' });
  var sheets = (meta && meta.sheets) || [];
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].properties && sheets[i].properties.title === SHEET_RESPONSES) return true;
  }
  return false;
}

/** responses シート全体の値（行配列）。Sheets API は末尾の空セル・空行を省くため呼び出し側で補う。 */
function readResponsesValues_() {
  var id = getResponsesSpreadsheetId_();
  if (!responsesSheetExists_(id)) throw new Error('responses_sheet_missing');
  var range = "'" + SHEET_RESPONSES.replace(/'/g, "''") + "'";
  var result = Sheets.Spreadsheets.Values.get(id, range, {
    majorDimension: 'ROWS',
    valueRenderOption: 'UNFORMATTED_VALUE'
  });
  return (result && result.values) || [];
}

/** 行オブジェクト（列名 → セル値）の配列。ヘッダー不一致は例外。 */
function readRows_() {
  var values = readResponsesValues_();
  var header = expectedHeader_();
  if (!values.length) throw new Error('header_mismatch');
  var actual = values[0];
  var width = 0;
  for (var r = 0; r < values.length; r++) {
    if (values[r].length > width) width = values[r].length;
  }
  if (width !== header.length) throw new Error('header_mismatch');
  for (var i = 0; i < header.length; i++) {
    if (actual[i] !== header[i]) throw new Error('header_mismatch');
  }
  var rows = [];
  for (var n = 1; n < values.length; n++) {
    var line = values[n];
    var row = {};
    for (var c = 0; c < header.length; c++) row[header[c]] = line[c] === undefined ? '' : line[c];
    rows.push(row);
  }
  return rows;
}

function classifyResponses_() {
  return SurveyAggregate.classifyRows(SURVEY_SCHEMA, readRows_());
}
