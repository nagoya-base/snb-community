/**
 * Admin Web App（OWNER 1名専用の管理ダッシュボード。Issue #363）。
 *
 * 認証・アクセス制御は Apps Script の Web App 設定に一本化している（appsscript.json）:
 *   executeAs: USER_DEPLOYING  Spreadsheet はデプロイ者（OWNER）の権限で読む。他ユーザーへは共有しない。
 *   access:    MYSELF          デプロイ者本人（Googleログイン済み）以外は /exec を開けない。URLを知っていても利用不可。
 * そのため独自のパスワード・URLトークン・OAuth Client ID・ID token検証・VIEWER分岐は持たない。
 *
 *   GET /exec                         : 管理ダッシュボード（Dashboard.html）を返す。
 *   google.script.run.getDashboardData() / getCrosstabData(rowKey, colKey) : HTML内から呼ぶ。
 * Spreadsheetは読み取り専用。Logger / console は使わない。
 */
function doGet() {
  return HtmlService.createTemplateFromFile('Dashboard').evaluate()
    .setTitle('衣装・ポートレート意識調査｜管理ダッシュボード')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/** Dashboard.html の <?!= include('...') ?> から使う。 */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

function getDashboardData() {
  var spreadsheet = openSpreadsheet_();
  return buildDashboard_(readResponses_(spreadsheet), readMeta_(spreadsheet));
}

/** 汎用クロス集計。軸は schema 由来のキー（設問ID または 設問ID:行ID）のみ。 */
function getCrosstabData(rowKey, colKey) {
  var rows = readResponses_(openSpreadsheet_());
  var records = rows.filter(function (r) { return r.kind === 'valid'; }).map(function (r) { return r.record; });
  return buildCrosstab_(String(rowKey), String(colKey), records);
}
