/**
 * browser UUID → salt付きSHA-256（respondent_hash）。
 * UUID生値はSpreadsheet・ログ・レスポンスのどこにも出さない。hashもレスポンスへ返さない。
 * 調査ごとにnamespace（survey_id）を分け、同じブラウザから別アンケートへ回答できるようにする。
 */
var UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid_(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function getSalt_() {
  var salt = getProperty_(PROP_SALT);
  if (salt.length < MIN_SALT_LENGTH) throw new Error('not_configured');
  return salt;
}

function hashRespondent_(uuid) {
  var input = SURVEY_SCHEMA.survey_id + '\n' + uuid.toLowerCase() + '\n' + getSalt_();
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input, Utilities.Charset.UTF_8);
  var hex = '';
  for (var i = 0; i < digest.length; i++) {
    var value = digest[i] < 0 ? digest[i] + 256 : digest[i];
    hex += (value < 16 ? '0' : '') + value.toString(16);
  }
  return hex;
}
