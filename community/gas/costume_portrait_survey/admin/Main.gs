/** Admin Web App。管理者専用（Auth.gs）。Spreadsheetは読み取り専用。 */
function doGet() {
  assertAdmin_();
  return HtmlService.createTemplateFromFile('Dashboard').evaluate()
    .setTitle('衣装・ポートレート意識調査｜管理ダッシュボード')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/** google.script.run から呼ばれる。 */
function getDashboardData() {
  assertAdmin_();
  var spreadsheet = openSpreadsheet_();
  return buildDashboard_(readResponses_(spreadsheet), readMeta_(spreadsheet));
}

/** 汎用クロス集計。軸は schema 由来のキー（設問ID または 設問ID:行ID）のみ受け付ける。 */
function getCrosstabData(rowKey, colKey) {
  assertAdmin_();
  var rows = readResponses_(openSpreadsheet_());
  var records = rows.filter(function (r) { return r.kind === 'valid'; }).map(function (r) { return r.record; });
  return buildCrosstab_(String(rowKey), String(colKey), records);
}
