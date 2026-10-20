/*
 * 本アンケートのPublic GAS Web App（/exec URL）。GASの初回デプロイ後に設定する（README参照）。
 * 空の間は「準備中」を表示し、送信・状態確認を一切行わない。
 * 受付状態（open / not_open / closed / not_configured）は必ず status API から取得する（Frontendで受付期間を判断しない）。
 */
window.BASEBALL_UNIFORM_SURVEY_CONFIG = {
  endpoint: 'https://script.google.com/macros/s/AKfycbzhaG7ReF1-uTdWJv9djP1evmWnA3YUHwuJtGKBo3L_pjyh9sKHMxGoCI3g9G1akfzq2w/exec'
};
