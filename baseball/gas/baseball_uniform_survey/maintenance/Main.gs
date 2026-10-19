/**
 * maintenance Web App（運営責任者1名専用。Issue #383）。公開しない。
 *
 * アクセス制御は Apps Script の Web App 設定（appsscript.json）に一本化している:
 *   executeAs: USER_DEPLOYING / access: MYSELF
 * doPost・回答受付 endpoint・回答の編集/削除UI（1件ずつ）は持たない。production submit の受付可否は #380 Public GAS の責務。
 *
 *   GET /exec                                       : Maintenance.html
 *   google.script.run.getRetentionStatus()          : retention 設定状態・storage inventory・launch_ready
 *   google.script.run.finalizePreflight()           : finalize の事前確認（書き込みなし）
 *   google.script.run.finalizeSurvey(confirmation)  : finalize 実行（explicit confirmation 必須）
 *   google.script.run.getFinalizedStatus()          : finalized marker と保存済み snapshot の整合
 *   google.script.run.getFinalSnapshot()            : final snapshot JSON（GitHub へは確認後に PR で反映。自動 commit しない）
 *   google.script.run.cleanupDryRun()               : cleanup の dry-run（書き込みなし）
 *   google.script.run.cleanupExecute(confirmation)  : cleanup 実行（explicit confirmation 必須）
 *   google.script.run.confirmManualCleanup(id)      : manual_required の完了記録
 * Logger / console に回答内容・hash を出さない。
 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Maintenance')
    .setTitle('名古屋野球ユニ部アンケート｜Maintenance')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function getRetentionStatus() { return getRetentionStatus_(); }
function finalizePreflight() { return finalizePreflight_(); }
function finalizeSurvey(confirmation) { return finalizeSurvey_(confirmation); }
function getFinalizedStatus() { return getFinalizedStatus_(); }
function getFinalSnapshot() { return getFinalSnapshot_(); }
function cleanupDryRun() { return cleanupDryRun_(); }
function cleanupExecute(confirmation) { return cleanupExecute_(confirmation); }
function confirmManualCleanup(storageId) { return confirmManualCleanup_(storageId); }
