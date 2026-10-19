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

function openResponsesSheet_() {
  var id = getProperty_(PROP_RESPONSES_SPREADSHEET_ID);
  if (!id) throw new Error('not_configured');
  var sheet = SpreadsheetApp.openById(id).getSheetByName(SHEET_RESPONSES);
  if (!sheet) throw new Error('responses_sheet_missing');
  return sheet;
}

/** 行オブジェクト（列名 → セル値）の配列。ヘッダー不一致は例外。 */
function readRows_() {
  var sheet = openResponsesSheet_();
  var header = expectedHeader_();
  var lastRow = sheet.getLastRow();
  if (sheet.getLastColumn() !== header.length) throw new Error('header_mismatch');
  var actual = sheet.getRange(1, 1, 1, header.length).getValues()[0];
  for (var i = 0; i < header.length; i++) {
    if (actual[i] !== header[i]) throw new Error('header_mismatch');
  }
  if (lastRow < 2) return [];
  var values = sheet.getRange(2, 1, lastRow - 1, header.length).getValues();
  return values.map(function (line) {
    var row = {};
    for (var c = 0; c < header.length; c++) row[header[c]] = line[c];
    return row;
  });
}

function classifyResponses_() {
  return SurveyAggregate.classifyRows(SURVEY_SCHEMA, readRows_());
}
