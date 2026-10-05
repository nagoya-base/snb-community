/**
 * 【使い捨て診断】Admin のID token認証が Apps Script の実機（V8）で動くかを、成功/失敗だけで確認する。
 *
 * ⚠ 本番の Admin GAS プロジェクトには入れない（CI のデプロイ対象 admin/ に含まれない別置きファイル）。
 *   確認用に新規作成した「空の Apps Script プロジェクト」へ、次の2ファイルだけを貼って使い、確認後はプロジェクトごと削除する。
 *     1. admin/IdToken.gs（本番と同一の検証コード。変更しない）
 *     2. 本ファイル
 *   手順・判定は README「本番deploy前チェックリスト」を参照。
 *
 * 出力: Logger に PASS / FAIL と分類だけを書く。ID token・email・sub・公開鍵の中身は一切出力しない。
 * Spreadsheet・メール・本番 Script Properties には触れない（本診断の Properties は DIAG_ID_TOKEN のみ）。
 */
var DIAG_PROP_TOKEN = 'DIAG_ID_TOKEN';

/** 公開情報のみのテストベクタ（使い捨てRSA鍵の公開鍵と署名。秘密鍵は破棄済み）。V8 上の BigInt RSA 検証の既知解テスト。 */
var DIAG_VECTOR = {
  input: 'admin-auth-diagnostic.v1',
  jwk: { kty: 'RSA', n: 'iFziVYJ4bq1srOlvoHU5ZJc2ewHDWJWHJXj11jeF0I7L7HLcp8b612kBDIoKbolxtWHkPerIV1Pe6uw8xjIRKgFd9jF87-Rxwkn_ZYTqw17-qMiiLgRYXa6QHnGtSLOJHQ7RH_vFg9UtPHypnxJARo01JRgUXYVclzFeG3eEPC29aFEOo1NWjp36oUCND7KEmxl4WKLecfoFGnuDVAaWDiyLlmHdx04o8FCcum4VLM9u8KN3ZAxegJm6GYLb0STgJ5X02kbEDJXq37EQrLyJHNVveEblgPTfubd7EYoD9Dk-Vq5ebPpfuRHcdfYA8mWdpshL9qU7-pPYwZTXOOmsIQ', e: 'AQAB' },
  signature: 'ailrSFg0U9bq7rju7xiTHkTgnHOS49p2RmJWjfNoYr2K6NR_dM5laCsHnoPqIKFmqLb3qAlgJUwD6y7l1k418FEfXLWDrjEp5G4Lk8g-gfjYND048_gC5QR_xb2G5s4RurtYxYqQ6WvCbuPaE6mTinjcs5oRlUsmKjpnImH7esl1uQ3rDufJ2c8JecN_1_nMlXhyj3xOA-Diqo0YwBKJtVuqoY4AGLfH902r1H94M67pil0_ifuXFjsPB_2_gjZ7oMsCuoYPdLXnyL0qNei345L74cQwa6dA-r39vsX8iYtIU-kUxgOlY51v3JbzYSOZ4h1AqCSA71SvD9XFPFN-zg'
};

function diagLog_(name, ok, note) {
  Logger.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (note ? ' (' + note + ')' : ''));
  return ok;
}

function diagRefuseInProduction_() {
  // 本番Adminのコード（doPost 等）が入っているプロジェクトでは実行しない（診断の入口を本番に残さないため）。
  if (typeof doPost === 'function' || typeof getDashboardData === 'function' || typeof openSpreadsheet_ === 'function') {
    throw new Error('refusing to run: this project contains the Admin API. Use a separate scratch project.');
  }
}

/** 1) V8 で BigInt が使え、IdToken.gs の RSA 検証（modPow / PKCS#1 v1.5 / SHA-256）が既知解で正しく動く。 */
function diagBigIntAndRsa() {
  diagRefuseInProduction_();
  var results = [];
  results.push(diagLog_('BigInt is available', typeof BigInt === 'function'));
  var small = false;
  try { small = modPow_(BigInt(7), BigInt(560), BigInt(561)) === BigInt(1); } catch (e) { small = false; }
  results.push(diagLog_('modPow_ (BigInt) known answer', small));
  var valid = false;
  var tampered = true;
  try {
    var sig = base64UrlToBytes_(DIAG_VECTOR.signature);
    valid = verifyRs256_(DIAG_VECTOR.input, sig, DIAG_VECTOR.jwk) === true;
    sig[sig.length - 1] ^= 1;
    tampered = verifyRs256_(DIAG_VECTOR.input, sig, DIAG_VECTOR.jwk) === true;
  } catch (e) { valid = false; }
  results.push(diagLog_('RS256 verify: valid signature accepted', valid));
  results.push(diagLog_('RS256 verify: tampered signature rejected', !tampered));
  return results.every(Boolean);
}

/** 2) UrlFetchApp で Google の公開鍵（JWKS）を取得でき、IdToken.gs が鍵を取り出せる。 */
function diagJwksFetch() {
  diagRefuseInProduction_();
  var keys = fetchGoogleJwks_();
  var okFetch = Array.isArray(keys) && keys.length > 0;
  var shaped = okFetch && keys.every(function (k) { return k && typeof k.kid === 'string' && k.kty === 'RSA' && typeof k.n === 'string' && typeof k.e === 'string'; });
  var found = shaped && !!getGoogleSigningKey_(keys[0].kid);
  return [diagLog_('JWKS fetched via UrlFetchApp', okFetch, okFetch ? keys.length + ' keys' : ''),
    diagLog_('JWKS keys are RSA with kid/n/e', !!shaped),
    diagLog_('getGoogleSigningKey_ resolves a kid', !!found)].every(Boolean);
}

/**
 * 3) 実際のGoogle ID token を verifyGoogleIdToken_() が検証できる。
 *    事前に Script Properties（このスクリプト専用の使い捨てプロジェクト）へ
 *      ADMIN_GOOGLE_CLIENT_ID = そのtokenを発行したOAuthクライアントID
 *      DIAG_ID_TOKEN          = 実際のID token（確認後に diagClearToken を実行して削除）
 *    を設定しておく。tokenは変数に取るだけで、出力・保存しない。
 */
function diagVerifyRealToken() {
  diagRefuseInProduction_();
  var token = PropertiesService.getScriptProperties().getProperty(DIAG_PROP_TOKEN);
  if (!token) return diagLog_('real ID token verified', false, 'DIAG_ID_TOKEN is not set');
  try {
    var verified = verifyGoogleIdToken_(token);
    token = null;
    var minutes = Math.floor((verified.exp * 1000 - nowMs_()) / 60000);
    return diagLog_('real ID token verified (signature, iss, aud, exp, email_verified)', true, 'expires in ' + minutes + ' min');
  } catch (e) {
    token = null;
    // 'unauthenticated' = 検証失敗（期限切れ・aud不一致・署名不正など）/ 'not_configured' = ADMIN_GOOGLE_CLIENT_ID 未設定
    return diagLog_('real ID token verified', false, String(e && e.message));
  }
}

/** 診断が終わったら実行: 保存したID tokenを削除する。 */
function diagClearToken() {
  diagRefuseInProduction_();
  PropertiesService.getScriptProperties().deleteProperty(DIAG_PROP_TOKEN);
  Logger.log('DIAG_ID_TOKEN removed');
}

/** まとめて実行（token検証は DIAG_ID_TOKEN が設定されている場合のみ）。 */
function runAdminAuthDiagnostics() {
  diagRefuseInProduction_();
  var ok = diagBigIntAndRsa();
  ok = diagJwksFetch() && ok;
  if (PropertiesService.getScriptProperties().getProperty(DIAG_PROP_TOKEN)) ok = diagVerifyRealToken() && ok;
  else Logger.log('SKIP real ID token verification (DIAG_ID_TOKEN not set)');
  Logger.log(ok ? 'ALL PASS' : 'SOME FAILED');
  return ok;
}
