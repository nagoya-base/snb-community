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

function isEmptyCell_(v) { return v === undefined || v === null || v === ''; }

/**
 * responses の列構成を回答値に触れず診断する。ヘッダー照合とデータ行幅（余分な非空列）は別々に判定する。
 * Sheets API は末尾の空セルを省くため、ヘッダー・データ行とも末尾の空セルは無いものとして扱う（不足は '' 補完）。
 * 返すのは列数・列番号・列名（ヘッダー行のみ）・真偽だけ。個別行の値は含めない。
 */
function analyzeResponsesLayout_(values, header) {
  var actual = (values && values.length ? values[0] : []).slice();
  while (actual.length && isEmptyCell_(actual[actual.length - 1])) actual.pop();
  var maxWidth = 0;
  var extraNonEmpty = false;
  for (var r = 1; r < (values ? values.length : 0); r++) {
    var line = values[r];
    var width = line.length;
    while (width && isEmptyCell_(line[width - 1])) width--;
    if (width > maxWidth) maxWidth = width;
    if (width > header.length) extraNonEmpty = true;
  }
  var mismatch = -1;
  var limit = Math.max(actual.length, header.length);
  for (var i = 0; i < limit; i++) {
    if (actual[i] !== header[i]) { mismatch = i; break; }
  }
  var headerOk = mismatch === -1;
  return {
    status: !headerOk ? 'header_mismatch' : extraNonEmpty ? 'unexpected_extra_data_columns' : 'ok',
    expectedColumnCount: header.length,
    actualHeaderColumnCount: actual.length,
    dataRowMaxWidth: maxWidth,
    firstMismatchColumn: headerOk ? null : mismatch + 1,
    expectedColumnName: headerOk || mismatch >= header.length ? null : header[mismatch],
    actualHeaderColumnName: headerOk || mismatch >= actual.length ? null : String(actual[mismatch]),
    extraNonEmptyDataColumns: extraNonEmpty
  };
}

/** 行オブジェクト（列名 → セル値）の配列。ヘッダー不一致は header_mismatch、期待列より右の実データは unexpected_extra_data_columns（fail-closed。自動修復しない）。 */
function readRows_() {
  var values = readResponsesValues_();
  var header = expectedHeader_();
  var layout = analyzeResponsesLayout_(values, header);
  if (layout.status !== 'ok') throw new Error(layout.status);
  var rows = [];
  for (var n = 1; n < values.length; n++) {
    var line = values[n];
    var row = {};
    for (var c = 0; c < header.length; c++) row[header[c]] = line[c] === undefined ? '' : line[c];
    rows.push(row);
  }
  return rows;
}

/** Admin 向けの安全な列構成診断（読み取りのみ）。Spreadsheet ID・回答値・hash は返さない。 */
function diagnoseResponses_() {
  try {
    return analyzeResponsesLayout_(readResponsesValues_(), expectedHeader_());
  } catch (e) {
    var message = e && e.message ? String(e.message) : '';
    if (message === 'not_configured' || message === 'responses_sheet_missing') return { status: message };
    throw e;
  }
}

function classifyResponses_() {
  return SurveyAggregate.classifyRows(SURVEY_SCHEMA, readRows_());
}
