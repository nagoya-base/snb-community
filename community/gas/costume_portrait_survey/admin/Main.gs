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

/** google.script.run から呼ばれる。ロールはSessionのメールからサーバー側で決め、ロール別に別個のレスポンスを組み立てる。 */
function getDashboardData() {
  var role = assertAdmin_();
  return role === ADMIN_ROLE_OWNER ? getOwnerDashboardData_() : getViewerDashboardData_();
}

function getOwnerDashboardData_() {
  var spreadsheet = openSpreadsheet_();
  var data = buildDashboard_(readResponses_(spreadsheet), readMeta_(spreadsheet));
  data.role = ADMIN_ROLE_OWNER;
  return data;
}

/** VIEWER用。自由記述・非allowlist設問・内部メタはここで組み立てる時点で含めない。 */
function getViewerDashboardData_() {
  var data = buildViewerDashboard_(readResponses_(openSpreadsheet_()));
  data.role = ADMIN_ROLE_VIEWER;
  return data;
}

/** 汎用クロス集計。軸は schema 由来のキー（設問ID または 設問ID:行ID）のみ受け付ける。VIEWERは許可済みの組み合わせのみ。 */
function getCrosstabData(rowKey, colKey) {
  var role = assertAdmin_();
  if (role === ADMIN_ROLE_VIEWER && !isViewerCrosstab_(String(rowKey), String(colKey))) throw new Error('forbidden');
  var rows = readResponses_(openSpreadsheet_());
  var records = rows.filter(function (r) { return r.kind === 'valid'; }).map(function (r) { return r.record; });
  return buildCrosstab_(String(rowKey), String(colKey), records);
}
