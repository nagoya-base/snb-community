/*
 * 本調査のPublic GAS Web App（/exec URL）。GASの初回デプロイ後に設定する（README参照）。
 * 空の間は「準備中」を表示し、送信・状態確認を一切行わない。
 * 締切や受付状態はここへ書かず、必ずstatus APIから取得する（Frontendで締切を判断しない）。
 */
window.COSTUME_PORTRAIT_CONFIG = {
  endpoint: 'https://script.google.com/macros/s/AKfycbyVgAxFlWO-3Lfq3oDx-MWO-T3g_gtYZatxIQZwLkRX5-yGSQsJoXee2ZhMvvPZrD0r/exec'
};
