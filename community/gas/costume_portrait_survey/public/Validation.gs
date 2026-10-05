/**
 * サーバー側リクエスト検証。Frontendの検証は信用しない。
 * 設問・選択肢・分岐の判定はschema由来の SurveyCore.validateAnswers を使い、
 * ここではschemaに依存しない送信envelope（age_confirmed・UUID・未知field・メタ情報）を検証する。
 */
var PAYLOAD_ALLOWED_KEYS = ['schema_version', 'uuid', 'age_confirmed', 'answers', 'other_texts', 'website', 'elapsed_ms', 'test_mode'];
var MAX_ELAPSED_MS = 7 * 24 * 60 * 60 * 1000;

function isPlainObject_(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @return {{ok: boolean, errors: Array<{field: string, code: string}>, clean: ?Object, uuid: ?string, elapsedMs: number, testMode: boolean}}
 */
function validatePayload_(payload) {
  var errors = [];
  function fail(field, code) { errors.push({ field: field, code: code }); }

  Object.keys(payload).forEach(function (key) {
    if (PAYLOAD_ALLOWED_KEYS.indexOf(key) === -1) fail(key, 'unknown_field');
  });

  if (payload.age_confirmed !== true) fail('age_confirmed', 'required');
  if (!isValidUuid_(payload.uuid)) fail('uuid', 'invalid_uuid');
  if (payload.test_mode !== undefined && typeof payload.test_mode !== 'boolean') fail('test_mode', 'invalid_type');
  if (payload.test_mode === true && !isLiveTestEnabled_()) fail('test_mode', 'disabled');

  // honeypot：人間には見えない欄。入力があればbotとして拒否する。
  if (payload.website !== undefined && payload.website !== '') fail('website', 'honeypot');

  // E2E実送信テスト（test_mode=true かつ LIVE_TEST_ENABLED=true）だけ最短回答時間を免除する。
  // 通常回答、および LIVE_TEST_ENABLED が無効なときの test_mode は免除しない（後者は上で disabled 拒否）。
  var liveTest = payload.test_mode === true && isLiveTestEnabled_();
  var elapsed = payload.elapsed_ms;
  if (typeof elapsed !== 'number' || !isFinite(elapsed) || elapsed < 0 || elapsed > MAX_ELAPSED_MS) {
    fail('elapsed_ms', 'invalid_type');
  } else if (!liveTest && elapsed < SURVEY_SCHEMA.limits.minElapsedMs) {
    fail('elapsed_ms', 'too_fast');
  }

  var result = SurveyCore.validateAnswers(SURVEY_SCHEMA, payload.answers, payload.other_texts);
  result.errors.forEach(function (error) { errors.push(error); });

  return {
    ok: errors.length === 0,
    errors: errors,
    clean: result.clean,
    uuid: typeof payload.uuid === 'string' ? payload.uuid : null,
    elapsedMs: typeof elapsed === 'number' ? Math.floor(elapsed) : 0,
    testMode: liveTest
  };
}
