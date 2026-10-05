/**
 * Admin認証（二重防御）。
 *  1. Web Appのデプロイ設定「アクセスできるユーザー：自分のみ（MYSELF）」。CIはこの値を検証し、違えばデプロイしない。
 *  2. 実行時にも Session のメールアドレスが Script Property ADMIN_ALLOWED_EMAILS（カンマ区切り）に
 *     含まれることを確認する。未設定・不一致・取得不能はすべて拒否（fail closed）。
 * Public GASには管理機能を置かない（別プロジェクト）。
 */
var PROP_ADMIN_ALLOWED_EMAILS = 'ADMIN_ALLOWED_EMAILS';

function assertAdmin_() {
  var allowed = (PropertiesService.getScriptProperties().getProperty(PROP_ADMIN_ALLOWED_EMAILS) || '')
    .split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
  var email = '';
  try {
    email = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  } catch (ignored) { email = ''; }
  if (!allowed.length || !email || allowed.indexOf(email) === -1) throw new Error('forbidden');
}
