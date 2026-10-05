/*
 * 管理ダッシュボードの接続先。どちらも秘密情報ではない（認可はGAS側のID token検証で行う）。
 *   endpoint       : Admin GAS Web App の /exec URL（Admin GASのデプロイ後に設定。README参照）
 *   googleClientId : Google Cloud の OAuth クライアントID（Webアプリケーション。Admin GASの ADMIN_GOOGLE_CLIENT_ID と同じ値）
 * どちらかが空の間は「未設定」を表示し、Googleログインも通信も行わない。
 */
window.COSTUME_PORTRAIT_ADMIN_CONFIG = {
  endpoint: '',
  googleClientId: ''
};
