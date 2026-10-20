/**
 * Admin Web App（運営責任者1名専用。Issue #382）。
 *
 * アクセス制御は Apps Script の Web App 設定（appsscript.json）に一本化している:
 *   executeAs: USER_DEPLOYING / access: MYSELF
 * responses Spreadsheet は読み取り専用。回答の編集・削除・手動書き換えの UI は持たない。
 *
 *   GET /exec                       : Dashboard.html
 *   google.script.run.getAdminSummary()   : production 件数・除外件数・設問別 targetCount と公開条件・public preview・障壁/安心条件の比較
 *   google.script.run.getResponsesDiagnostics() : responses 列構成の安全な診断（個別回答値なし）
 *   google.script.run.getVersionDiagnostics() : version_mismatch の原因診断（version の型・分類・件数のみ。回答値なし）
 *   google.script.run.getSnapshot()      : privacy-safe snapshot（JSON）と更新判定
 *   google.script.run.getPublicSnapshotStatus() : Public GAS が保持している公開 snapshot の状態（readonly）と手動 preview との差
 *   google.script.run.confirmSnapshotPublished(generatedAt, exactTotal) : 公開済み snapshot の記録（Script Property のみ）
 *   google.script.run.getFreeText()       : 自由記述（運営者のみ。個票・集計とは別の操作）
 * Logger / console に回答内容・hash を出さない。
 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Dashboard')
    .setTitle('名古屋野球ユニ部アンケート｜Admin')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function getAdminSummary() {
  var now = new Date();
  return SurveyAggregate.buildAdminSummary(SURVEY_SCHEMA, classifyResponses_(), { now: now, previousSnapshot: getSnapshotState_() });
}

/** responses の列構成診断（列数・不一致列番号・ヘッダー列名のみ。回答値は返さない）。 */
function getResponsesDiagnostics() {
  return diagnoseResponses_();
}

/**
 * version_mismatch の原因診断（読み取りのみ）。Sheets API が返した version の型と分類、表示値との比較結果だけを返す。
 * 回答本文・自由記述・hash・timestamp・Spreadsheet ID は返さない。既存行は一切変更しない。
 */
function getVersionDiagnostics() {
  return diagnoseVersions_();
}

function getSnapshot() {
  return buildSnapshotResult_(new Date());
}

function getPublicSnapshotStatus() {
  return getPublicSnapshotStatus_(new Date());
}

function confirmSnapshotPublished(generatedAt, exactTotal) {
  return recordSnapshotPublished_(generatedAt, exactTotal);
}

function getFreeText() {
  return listFreeText_();
}
