/**
 * 名古屋野球ユニ部アンケート（Issue #382）Admin GAS：設定。
 *
 * Admin は responses Spreadsheet を読み取り専用（OAuth scope: spreadsheets.readonly）で読む。
 * 回答の編集・削除・書き換えは行わない。書き込みは自分自身の Script Property（SNAPSHOT_STATE）だけで、
 * 「最後に公開した snapshot の生成時刻と件数」を記録する（回答データではない）。
 *
 * 必要な Script Property（手動設定。値はリポジトリ・ログに出さない）:
 *   RESPONSES_SPREADSHEET_ID  #380 の Public GAS が書き込む responses Spreadsheet の ID
 */
var PROP_RESPONSES_SPREADSHEET_ID = 'RESPONSES_SPREADSHEET_ID';
var PROP_SNAPSHOT_STATE = 'SNAPSHOT_STATE';

var SHEET_RESPONSES = 'responses';
var OTHER_TEXTS_COLUMN = 'other_texts';

function getProperty_(key) {
  var value = PropertiesService.getScriptProperties().getProperty(key);
  return typeof value === 'string' ? value : '';
}
