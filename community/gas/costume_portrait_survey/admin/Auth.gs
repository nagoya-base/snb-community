/**
 * Admin認証・ロール判定（Googleアカウント単位 / 個人Gmail可）。
 *
 * Web App は access=ANYONE_ANONYMOUS・executeAs=USER_DEPLOYING。URLへ到達できる誰にでも doPost は届くが、
 * 本人確認の根拠は「Google が署名した ID token」だけで、毎リクエスト検証する（IdToken.gs）。
 *   verifyGoogleIdToken_(idToken)         署名・iss・aud・exp・email_verified を検証（IdToken.gs）
 *   getAdminIdentity_(idToken)            検証済み identity { email, sub }
 *   getAdminRoleFromIdentity_(identity)   OWNER → VIEWER → forbidden（両方にあれば OWNER 優先。trim + lowercase）
 *   assertAdminToken_(idToken)            { email, sub, role }。失敗は Error('unauthenticated' | 'forbidden' | 'not_configured')
 * クライアントが送る email / role は一切使わない。Session.getActiveUser() も使わない（個人Gmailでは取得が保証されない）。
 *   ADMIN_OWNER_EMAILS  : フル権限（カンマ区切り）
 *   ADMIN_VIEWER_EMAILS : 閲覧専用の限定権限（カンマ区切り。未設定でもよい）
 * 未設定・空は常に forbidden（fail closed）。旧 ADMIN_ALLOWED_EMAILS は読まない。
 * Public GASには管理機能を置かない（別プロジェクト）。
 */
var PROP_ADMIN_OWNER_EMAILS = 'ADMIN_OWNER_EMAILS';
var PROP_ADMIN_VIEWER_EMAILS = 'ADMIN_VIEWER_EMAILS';
var ADMIN_ROLE_OWNER = 'owner';
var ADMIN_ROLE_VIEWER = 'viewer';

function normalizeEmail_(value) { return String(value || '').trim().toLowerCase(); }

function parseEmailList_(text) {
  return String(text || '').split(',').map(normalizeEmail_).filter(Boolean);
}

function getAdminIdentity_(idToken) {
  var verified = verifyGoogleIdToken_(idToken);
  return { email: normalizeEmail_(verified.email), sub: verified.sub };
}

/** 'owner' | 'viewer'。未登録は Error('forbidden')。 */
function getAdminRoleFromIdentity_(identity) {
  var email = normalizeEmail_(identity && identity.email);
  if (!email) throw new Error('forbidden');
  var props = PropertiesService.getScriptProperties();
  if (parseEmailList_(props.getProperty(PROP_ADMIN_OWNER_EMAILS)).indexOf(email) !== -1) return ADMIN_ROLE_OWNER;
  if (parseEmailList_(props.getProperty(PROP_ADMIN_VIEWER_EMAILS)).indexOf(email) !== -1) return ADMIN_ROLE_VIEWER;
  throw new Error('forbidden');
}

function assertAdminToken_(idToken) {
  var identity = getAdminIdentity_(idToken);
  return { email: identity.email, sub: identity.sub, role: getAdminRoleFromIdentity_(identity) };
}
