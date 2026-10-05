/**
 * Spreadsheet保存層。列構成はschema由来（SurveyCore.questionColumns）で、設問を個別にベタ書きしない。
 *
 * 保存形式:
 *  - 単一選択: stable ID（例 portrait_interest = very_interested）
 *  - 複数選択: |baseball|soccer| 形式（Spreadsheet永続化専用。内部処理は配列）
 *  - matrix（Q27）: 行ごとに1列（intent_3m__get_portrait = definitely）
 *  - 「その他」自由記述: other_texts 列にJSON（選択値へは埋め込まない）
 *  - completion_status: complete（本番回答）/ test（E2E実送信テスト）
 */
var FIXED_HEAD_COLUMNS = ['timestamp', 'survey_version', 'schema_version', 'respondent_hash', 'completion_status', 'age_confirmed'];
var FIXED_TAIL_COLUMNS = ['other_texts', 'client_elapsed_ms', 'notification_status'];

function responseHeader_() {
  var questionKeys = SurveyCore.questionColumns(SURVEY_SCHEMA).map(function (col) { return col.key; });
  return FIXED_HEAD_COLUMNS.concat(questionKeys, FIXED_TAIL_COLUMNS);
}

function openSpreadsheet_() {
  var id = getProperty_(PROP_SPREADSHEET_ID);
  if (!id) throw new Error('not_configured');
  return SpreadsheetApp.openById(id);
}

function headerMatches_(sheet) {
  var expected = responseHeader_();
  if (sheet.getLastColumn() !== expected.length) return false;
  var actual = sheet.getRange(1, 1, 1, expected.length).getValues()[0];
  return expected.every(function (name, i) { return actual[i] === name; });
}

function getResponsesSheet_() {
  var sheet = openSpreadsheet_().getSheetByName(SHEET_RESPONSES);
  if (!sheet) throw new Error('responses_sheet_missing');
  if (!headerMatches_(sheet)) throw new Error('header_mismatch');
  return sheet;
}

/**
 * スプレッドシートの数式インジェクション対策。= + - @ や制御文字で始まる文字列は
 * 先頭に ' を付けて文字列として保存する（自由記述・other_texts に適用）。
 */
function sanitizeCell_(value) {
  if (typeof value !== 'string') return value;
  return /^[=+\-@\t\r]/.test(value) ? "'" + value : value;
}

function buildRow_(clean, hash, now, elapsedMs, completionStatus) {
  var answers = clean.answers;
  var cells = {
    timestamp: now,
    survey_version: SURVEY_SCHEMA.survey_version,
    schema_version: SURVEY_SCHEMA.schema_version,
    respondent_hash: hash,
    completion_status: completionStatus === 'test' ? 'test' : 'complete',
    age_confirmed: true,
    other_texts: sanitizeCell_(JSON.stringify(clean.other_texts)),
    client_elapsed_ms: elapsedMs,
    notification_status: 'none'
  };
  SurveyCore.questionColumns(SURVEY_SCHEMA).forEach(function (col) {
    var q = SurveyCore.getQuestion(SURVEY_SCHEMA, col.questionId);
    var value = answers[col.questionId];
    if (value === undefined) { cells[col.key] = ''; return; }
    if (q.type === 'multi') cells[col.key] = SurveyCore.encodeMulti(value);
    else if (q.type === 'matrix') cells[col.key] = value[col.rowId] || '';
    else if (q.type === 'text') cells[col.key] = sanitizeCell_(value);
    else cells[col.key] = value;
  });
  return responseHeader_().map(function (name) { return cells[name]; });
}

function hashColumnIndex_() { return responseHeader_().indexOf('respondent_hash') + 1; }

/** completionStatusを省略した場合は本番回答（complete）だけを重複判定対象にする。 */
function hasRespondentHash_(sheet, hash, completionStatus) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  var wantedStatus = completionStatus || 'complete';
  var hashCol = hashColumnIndex_();
  // respondent_hash と completion_status は固定ヘッダ上で隣接している。
  var values = sheet.getRange(2, hashCol, lastRow - 1, 2).getValues();
  for (var i = 0; i < values.length; i++) {
    if (values[i][0] === hash && values[i][1] === wantedStatus) return true;
  }
  return false;
}

/** 呼び出し元はScriptLockを保持していること。保存した行番号を返す。 */
function appendResponse_(sheet, values) {
  var row = sheet.getLastRow() + 1;
  sheet.getRange(row, 1, 1, values.length).setValues([values]);
  return row;
}

function updateNotificationStatus_(sheet, row, status) {
  var col = responseHeader_().indexOf('notification_status') + 1;
  sheet.getRange(row, col).setValue(status);
}

/** metaシート（key / value）。Admin GASが重複拒否数・確定状態を読む。 */
function getMetaSheet_(spreadsheet) {
  var sheet = spreadsheet.getSheetByName(SHEET_META);
  if (!sheet) throw new Error('meta_sheet_missing');
  return sheet;
}

function findMetaRow_(sheet, key) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 1) return 0;
  var keys = sheet.getRange(1, 1, lastRow, 1).getValues();
  for (var i = 0; i < keys.length; i++) {
    if (keys[i][0] === key) return i + 1;
  }
  return 0;
}

function setMeta_(sheet, key, value) {
  var row = findMetaRow_(sheet, key);
  if (!row) row = sheet.getLastRow() + 1;
  sheet.getRange(row, 1, 1, 2).setValues([[key, value]]);
}

function incrementMetaCounter_(spreadsheet, key) {
  var sheet = getMetaSheet_(spreadsheet);
  var row = findMetaRow_(sheet, key);
  var current = row ? Number(sheet.getRange(row, 2).getValue()) || 0 : 0;
  setMeta_(sheet, key, current + 1);
}
