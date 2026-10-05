/**
 * 初回セットアップ（Apps Scriptエディタから手動実行）。Web Appからは呼べない（doGet/doPostで公開しない）。
 *   1. Script Property に SPREADSHEET_ID / SURVEY_CLOSES_AT / NOTIFICATION_EMAIL を手動で設定する。
 *   2. setupScriptProperties() を実行（RESPONDENT_SALT が無い場合のみ生成。既存値は絶対に上書きしない）。
 *   3. setupSpreadsheet() を実行（responses / meta シートとヘッダーを作成。回答が入ったシートは変更しない）。
 */
function setupScriptProperties() {
  var properties = PropertiesService.getScriptProperties();
  if (properties.getProperty(PROP_SALT)) return 'RESPONDENT_SALT は設定済みのため変更しません。';
  properties.setProperty(PROP_SALT, Utilities.getUuid() + '-' + Utilities.getUuid() + '-' + Utilities.getUuid());
  return 'RESPONDENT_SALT を生成しました。';
}

function setupSpreadsheet() {
  var spreadsheet = openSpreadsheet_();
  var header = responseHeader_();
  var sheet = spreadsheet.getSheetByName(SHEET_RESPONSES);
  if (!sheet) sheet = spreadsheet.insertSheet(SHEET_RESPONSES);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, header.length).setValues([header]);
    sheet.setFrozenRows(1);
  } else if (!headerMatches_(sheet)) {
    throw new Error('responses シートに既存データがあり、ヘッダーがschemaと一致しません。手動で確認してください。');
  }
  if (!spreadsheet.getSheetByName(SHEET_META)) {
    spreadsheet.insertSheet(SHEET_META).getRange(1, 1, 1, 2).setValues([['duplicate_rejects', 0]]);
  }
  return 'ok';
}
