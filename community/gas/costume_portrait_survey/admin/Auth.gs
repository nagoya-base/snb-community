/**
 * Admin認証（二重防御）+ OWNER / VIEWER ロール判定。
 *  1. Web Appのデプロイ設定は access=ANYONE（ログイン済みのGoogleアカウントのみ。匿名=ANYONE_ANONYMOUSは不可）、
 *     executeAs=USER_DEPLOYING（Spreadsheetはデプロイ者のみが読む）。CIはこの値を検証し、違えばデプロイしない。
 *     MYSELFでは別アカウントのOWNER/VIEWERがここへ到達できないため使わない。
 *  2. 実行時にも Session のメールアドレスを Script Properties と照合してロールを決める。
 *       ADMIN_OWNER_EMAILS  : フル権限（カンマ区切り）
 *       ADMIN_VIEWER_EMAILS : 閲覧専用の限定権限（カンマ区切り。未設定でもよい）
 *     判定順は OWNER → VIEWER → forbidden（両方にあれば OWNER 優先）。比較は trim + lowercase。
 *     未設定・空・Sessionメール取得不能はすべて拒否（fail closed）。
 *     注意: executeAs=USER_DEPLOYING では getActiveUser().getEmail() はデプロイ者と同じGoogle Workspaceドメインの
 *     アカウントでのみ取得できる。別ドメイン・個人Gmailは空文字になり forbidden となる（README参照）。
 *  旧 ADMIN_ALLOWED_EMAILS は意図的に読まない（自動fallbackしない。移行はREADME参照）。
 *  ロールは常にサーバー側で Session から決める。クライアントからの指定は受け付けない。
 * Public GASには管理機能を置かない（別プロジェクト）。
 */
var PROP_ADMIN_OWNER_EMAILS = 'ADMIN_OWNER_EMAILS';
var PROP_ADMIN_VIEWER_EMAILS = 'ADMIN_VIEWER_EMAILS';
var ADMIN_ROLE_OWNER = 'owner';
var ADMIN_ROLE_VIEWER = 'viewer';

function parseEmailList_(text) {
  return String(text || '').split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
}

/** 'owner' | 'viewer' を返す。許可されないユーザーは Error('forbidden')。 */
function getAdminRole_() {
  var props = PropertiesService.getScriptProperties();
  var email = '';
  try {
    email = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  } catch (ignored) { email = ''; }
  if (!email) throw new Error('forbidden');
  if (parseEmailList_(props.getProperty(PROP_ADMIN_OWNER_EMAILS)).indexOf(email) !== -1) return ADMIN_ROLE_OWNER;
  if (parseEmailList_(props.getProperty(PROP_ADMIN_VIEWER_EMAILS)).indexOf(email) !== -1) return ADMIN_ROLE_VIEWER;
  throw new Error('forbidden');
}

/** 許可された管理者（owner / viewer）であることを確認し、ロールを返す。既存呼び出し互換。 */
function assertAdmin_() {
  return getAdminRole_();
}

/** 指定ロール以外は forbidden。 */
function assertAdminRole_(allowedRoles) {
  var role = getAdminRole_();
  if (allowedRoles.indexOf(role) === -1) throw new Error('forbidden');
  return role;
}
