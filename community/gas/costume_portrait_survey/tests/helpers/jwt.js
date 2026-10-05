'use strict';
// テスト専用の偽Google IdP。実行時にメモリ上でRSA鍵を生成してRS256のJWTに署名する（実token・秘密鍵はコミットしない）。
const crypto = require('crypto');

const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
const b64u = (value) => Buffer.from(value).toString('base64url');

function makeKey(kid) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { kid, privateKey, jwk: Object.assign(publicKey.export({ format: 'jwk' }), { kid, alg: 'RS256', use: 'sig' }) };
}
// 鍵生成は重いのでプロセス内で1回だけ。attacker は JWKS に載らない別鍵（偽造署名用）。
const GOOGLE_KEY = makeKey('google-test-key-1');
const ATTACKER_KEY = makeKey('google-test-key-1');

function sign(claims, { key = GOOGLE_KEY, header = {}, signingKey = key.privateKey } = {}) {
  const head = Object.assign({ alg: 'RS256', kid: key.kid, typ: 'JWT' }, header);
  const input = b64u(JSON.stringify(head)) + '.' + b64u(JSON.stringify(claims));
  const signature = crypto.sign('RSA-SHA256', Buffer.from(input), signingKey);
  return input + '.' + b64u(signature);
}

/** 有効な標準claim。overrides の undefined は項目を削除する。 */
function claimsFor(email, overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const claims = Object.assign({
    iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: 'sub-' + email, email, email_verified: true,
    iat: now - 10, exp: now + 3600
  }, overrides);
  Object.keys(claims).forEach((k) => { if (claims[k] === undefined) delete claims[k]; });
  return claims;
}

const token = (email, overrides, options) => sign(claimsFor(email, overrides), options);

module.exports = { CLIENT_ID, GOOGLE_KEY, ATTACKER_KEY, sign, claimsFor, token, b64u };
