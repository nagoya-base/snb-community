/**
 * Spreadsheet保存層。列構成は schema 由来で、設問を個別にベタ書きしない。
 *   列 = persistenceSchema.systemFields（唯一の正本。Public GAS側で別名を増やさない）
 *      + 全設問ID（schema順）+ other_texts
 *
 * 保存形式:
 *  - 保存する回答値は validateAnswers(...).clean のみ（受信payloadそのものは保存しない）。
 *  - 単一選択・scale: stable ID（scale は文字列 "1"〜"5" / notApplicable.id）
 *  - 複数選択: |baseball|soccer| 形式（Spreadsheet永続化専用）
 *  - 「その他」自由記述: other_texts 列にJSON（選択値へは埋め込まない）
 *  - response_mode: production / test。completion_status: complete（保存した回答は全て完了済み）
 */
var OTHER_TEXTS_COLUMN = 'other_texts';

function questionList_() { return SurveyCore.getQuestions(SURVEY_SCHEMA); }

function responseHeader_() {
  var questionKeys = questionList_().map(function (q) { return q.id; });
  return SURVEY_SCHEMA.persistenceSchema.systemFields.concat(questionKeys, [OTHER_TEXTS_COLUMN]);
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

/** ヘッダーがschemaと完全一致するシートだけを返す（既存surveyのSheetなど、別構成のシートへは書かない）。 */
function getResponsesSheet_() {
  var sheet = openSpreadsheet_().getSheetByName(SHEET_RESPONSES);
  if (!sheet) throw new Error('responses_sheet_missing');
  if (!headerMatches_(sheet)) throw new Error('header_mismatch');
  return sheet;
}

function columnNumber_(name) { return responseHeader_().indexOf(name) + 1; }

/**
 * スプレッドシートの数式インジェクション対策。= + - @ や制御文字で始まる文字列は
 * 先頭に ' を付けて文字列として保存する（全ての文字列セルに適用）。
 */
function sanitizeCell_(value) {
  if (typeof value !== 'string') return value;
  return /^[=+\-@\t\r]/.test(value) ? "'" + value : value;
}

function encodeMultiple_(ids) { return ids.length ? '|' + ids.join('|') + '|' : ''; }

/** Sheetsが "1" を数値へ、"12345e6" 風のhashを指数表記へ変換しないよう、自由記述以外の列は書式を '@'（文字列）にする。 */
function textFormatColumns_() {
  var names = ['respondent_hash', 'test_run_id'];
  questionList_().forEach(function (q) { if (q.type !== 'text') names.push(q.id); });
  return names;
}

function buildRow_(validation, mode, hash, now, notificationStatus) {
  var answers = validation.clean.answers;
  var cells = {
    timestamp: now,
    survey_version: SURVEY_SCHEMA.survey_version,
    schema_version: SURVEY_SCHEMA.schema_version,
    design_version: SURVEY_SCHEMA.design_version,
    response_mode: mode.responseMode,
    test_run_id: mode.testRunId,
    respondent_hash: hash,
    completion_status: 'complete',
    source_channel: validation.sourceChannel,
    client_elapsed_ms: validation.elapsedMs,
    notification_status: notificationStatus
  };
  cells[OTHER_TEXTS_COLUMN] = JSON.stringify(validation.clean.other_texts);
  questionList_().forEach(function (q) {
    var value = answers[q.id];
    if (value === undefined) cells[q.id] = '';
    else if (q.type === 'multiple') cells[q.id] = encodeMultiple_(value);
    else cells[q.id] = value;
  });
  return responseHeader_().map(function (name) { return sanitizeCell_(cells[name]); });
}

function hasRespondentHash_(sheet, hash) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  var values = sheet.getRange(2, columnNumber_('respondent_hash'), lastRow - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    if (values[i][0] === hash) return true;
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
  sheet.getRange(row, columnNumber_('notification_status')).setValue(status);
}

/** 本番（response_mode=production）の保存済み回答数。testは数えない。 */
function countProductionResponses_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  var values = sheet.getRange(2, columnNumber_('response_mode'), lastRow - 1, 1).getValues();
  var count = 0;
  for (var i = 0; i < values.length; i++) {
    if (values[i][0] === 'production') count++;
  }
  return count;
}
