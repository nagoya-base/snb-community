/**
 * Google ID token（Google Identity Services が発行する JWT）のサーバー側検証。
 *
 * 方針:
 *  - payload を base64 デコードしただけでは信用しない。Google の公開鍵（JWKS）で RS256 署名を検証してから claim を見る。
 *  - tokeninfo endpoint は公式が debugging 向けとしているため使わない。JWKS は CacheService にキャッシュする。
 *  - 検証する claim: iss / aud（= ADMIN_GOOGLE_CLIENT_ID）/ exp / iat / email / email_verified=true / sub。
 *  - どの失敗も Error('unauthenticated')（理由は返さない・ログに出さない）。token をログ・Spreadsheet・Propertiesへ書かない。
 *  - 外部通信は Google の公開鍵取得（GET）のみ（script.external_request scope）。
 * 時刻・鍵取得は nowMs_() / fetchGoogleJwks_() に分離している（テストで差し替え可能）。
 */
var PROP_ADMIN_GOOGLE_CLIENT_ID = 'ADMIN_GOOGLE_CLIENT_ID';
var GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
var GOOGLE_JWKS_CACHE_KEY = 'admin_google_jwks_v1';
var GOOGLE_JWKS_CACHE_SECONDS = 3600;
/** kid が見つからない場合に JWKS を取り直す最短間隔（匿名リクエストで外部取得を乱発させない）。 */
var GOOGLE_JWKS_REFETCH_MIN_MS = 60 * 1000;
var GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
var ID_TOKEN_MAX_LENGTH = 4096;
var ID_TOKEN_CLOCK_SKEW_SECONDS = 300;
/** DigestInfo prefix for SHA-256 (RFC 8017 9.2)。 */
var SHA256_DIGEST_INFO_PREFIX = [0x30, 0x31, 0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05, 0x00, 0x04, 0x20];

function nowMs_() { return Date.now(); }

function unauthenticated_() { return new Error('unauthenticated'); }

function base64UrlToBytes_(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) throw unauthenticated_();
  var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  var bytes = [];
  var buffer = 0;
  var bits = 0;
  for (var i = 0; i < text.length; i++) {
    buffer = (buffer << 6) | alphabet.indexOf(text.charAt(i));
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
      buffer &= (1 << bits) - 1;
    }
  }
  return bytes;
}

function bytesToUtf8_(bytes) {
  try {
    return decodeURIComponent(bytes.map(function (b) { return '%' + (b < 16 ? '0' : '') + b.toString(16); }).join(''));
  } catch (ignored) { throw unauthenticated_(); }
}

function parseJsonObject_(text) {
  var value;
  try { value = JSON.parse(text); } catch (ignored) { throw unauthenticated_(); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw unauthenticated_();
  return value;
}

function bytesToBigInt_(bytes) {
  var hex = bytes.map(function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join('');
  return hex ? BigInt('0x' + hex) : BigInt(0);
}

function modPow_(base, exponent, modulus) {
  var result = BigInt(1);
  var b = base % modulus;
  var e = exponent;
  while (e > BigInt(0)) {
    if (e & BigInt(1)) result = (result * b) % modulus;
    e = e >> BigInt(1);
    b = (b * b) % modulus;
  }
  return result;
}

function sha256Bytes_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map(function (b) { return b & 0xff; });
}

/** RSASSA-PKCS1-v1_5 / SHA-256 の署名検証。encoded message を完全一致で比較する。 */
function verifyRs256_(signingInput, signatureBytes, jwk) {
  var modulusBytes = base64UrlToBytes_(jwk.n);
  while (modulusBytes.length && modulusBytes[0] === 0) modulusBytes.shift();
  var k = modulusBytes.length;
  if (k < 256 || signatureBytes.length !== k) return false;
  var n = bytesToBigInt_(modulusBytes);
  var e = bytesToBigInt_(base64UrlToBytes_(jwk.e));
  if (e < BigInt(3) || e % BigInt(2) === BigInt(0)) return false;
  var s = bytesToBigInt_(signatureBytes);
  if (s >= n) return false;
  var hex = modPow_(s, e, n).toString(16);
  while (hex.length < k * 2) hex = '0' + hex;
  if (hex.length > k * 2) return false;
  var digestInfo = SHA256_DIGEST_INFO_PREFIX.concat(sha256Bytes_(signingInput));
  var padding = k - 3 - digestInfo.length;
  if (padding < 8) return false;
  var expected = [0x00, 0x01];
  for (var i = 0; i < padding; i++) expected.push(0xff);
  expected = expected.concat([0x00], digestInfo);
  var expectedHex = expected.map(function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join('');
  return hex === expectedHex;
}

/** Google の公開鍵セット。取得失敗は null（呼び出し側が fail closed）。 */
function fetchGoogleJwks_() {
  try {
    var response = UrlFetchApp.fetch(GOOGLE_JWKS_URL, { method: 'get', muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) return null;
    var body = JSON.parse(response.getContentText());
    return body && Array.isArray(body.keys) ? body.keys : null;
  } catch (ignored) { return null; }
}

function readJwksCache_() {
  try {
    var raw = CacheService.getScriptCache().get(GOOGLE_JWKS_CACHE_KEY);
    var cached = raw ? JSON.parse(raw) : null;
    return cached && Array.isArray(cached.keys) && typeof cached.fetchedAt === 'number' ? cached : null;
  } catch (ignored) { return null; }
}

/** kid に対応する公開鍵（RSA / RS256 のみ）。無ければ null。 */
function getGoogleSigningKey_(kid) {
  function find(keys) {
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (key && key.kid === kid && key.kty === 'RSA' && (key.alg === undefined || key.alg === 'RS256') &&
          typeof key.n === 'string' && typeof key.e === 'string') return key;
    }
    return null;
  }
  var cached = readJwksCache_();
  if (cached) {
    var hit = find(cached.keys);
    if (hit) return hit;
    if (nowMs_() - cached.fetchedAt < GOOGLE_JWKS_REFETCH_MIN_MS) return null;
  }
  var keys = fetchGoogleJwks_();
  if (!keys) return null;
  try {
    CacheService.getScriptCache().put(GOOGLE_JWKS_CACHE_KEY, JSON.stringify({ fetchedAt: nowMs_(), keys: keys }), GOOGLE_JWKS_CACHE_SECONDS);
  } catch (ignored) { /* キャッシュできなくても検証は続行 */ }
  return find(keys);
}

/**
 * ID token を検証して { email, sub, emailVerified, exp } を返す。失敗は Error('unauthenticated')、
 * ADMIN_GOOGLE_CLIENT_ID 未設定は Error('not_configured')（どちらも fail closed）。
 * ここで返る email は Google が署名した claim のみ。クライアント指定の値は一切使わない。
 */
function verifyGoogleIdToken_(idToken) {
  var clientId = String(PropertiesService.getScriptProperties().getProperty(PROP_ADMIN_GOOGLE_CLIENT_ID) || '').trim();
  if (!clientId) throw new Error('not_configured');
  if (typeof idToken !== 'string' || !idToken || idToken.length > ID_TOKEN_MAX_LENGTH) throw unauthenticated_();
  var parts = idToken.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) throw unauthenticated_();

  var header = parseJsonObject_(bytesToUtf8_(base64UrlToBytes_(parts[0])));
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) throw unauthenticated_();
  var key = getGoogleSigningKey_(header.kid);
  if (!key) throw unauthenticated_();
  if (!verifyRs256_(parts[0] + '.' + parts[1], base64UrlToBytes_(parts[2]), key)) throw unauthenticated_();

  // 署名検証後にのみ claim を信用する。
  var claims = parseJsonObject_(bytesToUtf8_(base64UrlToBytes_(parts[1])));
  var nowSeconds = Math.floor(nowMs_() / 1000);
  if (GOOGLE_ISSUERS.indexOf(claims.iss) === -1) throw unauthenticated_();
  if (typeof claims.aud !== 'string' || claims.aud !== clientId) throw unauthenticated_();
  if (typeof claims.exp !== 'number' || !isFinite(claims.exp) || claims.exp <= nowSeconds) throw unauthenticated_();
  if (typeof claims.iat !== 'number' || !isFinite(claims.iat) || claims.iat > nowSeconds + ID_TOKEN_CLOCK_SKEW_SECONDS) throw unauthenticated_();
  if (typeof claims.sub !== 'string' || !claims.sub) throw unauthenticated_();
  if (typeof claims.email !== 'string' || !claims.email) throw unauthenticated_();
  if (claims.email_verified !== true) throw unauthenticated_();
  return { email: claims.email, sub: claims.sub, emailVerified: true, exp: claims.exp };
}
