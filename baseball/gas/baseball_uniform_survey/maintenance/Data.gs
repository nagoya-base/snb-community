/**
 * responses Spreadsheet の読み書き（maintenance 専用）。
 *
 * 列は #380 の Public GAS と同じく schema 由来：
 *   persistenceSchema.systemFields + 全設問ID（schema順）+ other_texts
 * ヘッダーが完全一致しないシートは読まない・削除しない（別 survey の Sheet を誤って触らない）。
 * 行の値は snapshot 生成（SurveyAggregate.classifyRows）にだけ渡し、返り値・ログ・audit には出さない。
 */
function expectedHeader_() {
  var ids = SurveyCore.getQuestions(SURVEY_SCHEMA).map(function (q) { return q.id; });
  return SURVEY_SCHEMA.persistenceSchema.systemFields.concat(ids, [OTHER_TEXTS_COLUMN]);
}

function openSpreadsheet_() {
  var id = getProperty_(PROP_RESPONSES_SPREADSHEET_ID);
  if (!id) throw new Error('not_configured');
  return SpreadsheetApp.openById(id);
}

/** responses シート。無ければ null。ヘッダーが schema と一致しなければ例外。 */
function openResponsesSheet_() {
  var sheet = openSpreadsheet_().getSheetByName(SHEET_RESPONSES);
  if (!sheet) return null;
  var header = expectedHeader_();
  if (sheet.getLastColumn() !== header.length) throw new Error('header_mismatch');
  var actual = sheet.getRange(1, 1, 1, header.length).getValues()[0];
  for (var i = 0; i < header.length; i++) {
    if (actual[i] !== header[i]) throw new Error('header_mismatch');
  }
  return sheet;
}

/** 行オブジェクト（列名 → セル値）の配列（read-only）。シートが無ければ例外。 */
function readRows_() {
  var sheet = openResponsesSheet_();
  if (!sheet) throw new Error('responses_sheet_missing');
  var header = expectedHeader_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var values = sheet.getRange(2, 1, lastRow - 1, header.length).getValues();
  return values.map(function (line) {
    var row = {};
    for (var c = 0; c < header.length; c++) row[header[c]] = line[c];
    return row;
  });
}

/** 'production' | 'test' | 'unclassified'（production / test 以外・空は fail closed で unclassified）。 */
function responseClassOf_(mode) {
  if (SurveyCore.isProductionResponseMode(mode)) return 'production';
  if (mode === 'test') return 'test';
  return 'unclassified';
}

function responseModeColumn_() {
  return expectedHeader_().indexOf('response_mode') + 1;
}

function responseClasses_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, responseModeColumn_(), lastRow - 1, 1).getValues().map(function (line) { return responseClassOf_(line[0]); });
}

function sheetExists_(name) {
  return openSpreadsheet_().getSheetByName(name) !== null;
}

/** 保存先ごとの件数（行数 / 派生 Sheet の有無 0・1）。回答の値は読まない。 */
function countStorages_() {
  var counts = { responses_production: 0, responses_test: 0, responses_unclassified: 0 };
  var sheet = openResponsesSheet_();
  if (sheet) {
    responseClasses_(sheet).forEach(function (cls) { counts['responses_' + cls]++; });
  }
  counts.responses_valid_sheet = sheetExists_(SHEET_RESPONSES_VALID) ? 1 : 0;
  counts.final_snapshot_sheet = sheetExists_(SHEET_FINAL_SNAPSHOT) ? 1 : 0;
  return counts;
}

/** 指定区分の行を下から削除する（行番号がずれない）。ヘッダー行は削除しない。削除件数を返す。 */
function deleteResponseRows_(cls) {
  var sheet = openResponsesSheet_();
  if (!sheet) return 0;
  var targets = [];
  responseClasses_(sheet).forEach(function (c, i) { if (c === cls) targets.push(i + 2); });
  var deleted = 0;
  var end = targets.length - 1;
  while (end >= 0) {
    var start = end;
    while (start > 0 && targets[start - 1] === targets[start] - 1) start--;
    sheet.deleteRows(targets[start], end - start + 1);
    deleted += end - start + 1;
    end = start - 1;
  }
  return deleted;
}

function deleteSheetIfExists_(name) {
  var spreadsheet = openSpreadsheet_();
  var sheet = spreadsheet.getSheetByName(name);
  if (!sheet) return 0;
  spreadsheet.deleteSheet(sheet);
  return 1;
}

/** cleanup 対象 storage の削除。削除件数を返す。maintenance が扱えない storage は例外。 */
function deleteStorage_(id) {
  if (id === 'responses_production') return deleteResponseRows_('production');
  if (id === 'responses_test') return deleteResponseRows_('test');
  if (id === 'responses_unclassified') return deleteResponseRows_('unclassified');
  if (id === 'responses_valid_sheet') return deleteSheetIfExists_(SHEET_RESPONSES_VALID);
  if (id === 'final_snapshot_sheet') return deleteSheetIfExists_(SHEET_FINAL_SNAPSHOT);
  throw new Error('unsupported_storage');
}
