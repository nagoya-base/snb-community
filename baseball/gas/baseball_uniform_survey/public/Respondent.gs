/**
 * browser UUID → respondent_hash。UUID生値はSpreadsheet・ログ・レスポンスのどこにも出さない。hashもレスポンスへ返さない。
 *
 * hash入力は canonical serialization（固定順の配列を JSON.stringify）で要素境界を一意にする。
 * 無区切り・区切り文字連結はしない（"a","bc" と "ab","c" のような境界の曖昧さを作らない）。
 *   ['snb-respondent-hash', <format version>, survey_id, response_mode, test_run_id, uuid(小文字), salt]
 *  - production は test_run_id を空文字として直列化する。
 *  - submit_excluded（response_mode=test）は test_run_id を含める。同じブラウザでも test_run_id が違えば別テスト回答、
 *    同一 test_run_id 内では production と同等に重複抑止する。
 *  - response_mode を含めるため production と test の重複判定は混ざらない。
 * これは完全な本人認証ではない（ブラウザ・端末・UUID消去で回避できる）。README参照。
 */
var UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var HASH_DOMAIN = 'snb-respondent-hash';
var HASH_FORMAT_VERSION = 1;

function isValidUuid_(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function getSalt_() {
  var salt = getProperty_(PROP_SALT);
  if (salt.length < MIN_SALT_LENGTH) throw new Error('not_configured');
  return salt;
}

/** @return {string} 要素境界が一意なhash入力（JSON配列） */
function canonicalHashInput_(responseMode, testRunId, uuid, salt) {
  return JSON.stringify([
    HASH_DOMAIN,
    HASH_FORMAT_VERSION,
    SURVEY_SCHEMA.survey_id,
    String(responseMode),
    String(testRunId || ''),
    uuid.toLowerCase(),
    salt
  ]);
}

function hashRespondent_(responseMode, testRunId, uuid) {
  var input = canonicalHashInput_(responseMode, testRunId, uuid, getSalt_());
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input, Utilities.Charset.UTF_8);
  return bytesToHex_(digest);
}

function bytesToHex_(bytes) {
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    var value = bytes[i] < 0 ? bytes[i] + 256 : bytes[i];
    hex += (value < 16 ? '0' : '') + value.toString(16);
  }
  return hex;
}
