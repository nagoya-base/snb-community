/**
 * サーバー側リクエスト検証。Frontendの検証は信用しない。
 *
 * 設問・選択肢・分岐・required・hidden/stale の判定はすべて schema 由来の SurveyCore.validateAnswers に任せる。
 * 受信した answers / other_texts は sanitize せず、そのまま最初に validateAnswers へ渡す
 * （hidden / unknown / stale / invalid option を黙って除去すると、本来拒否すべき不正payloadを受理してしまう）。
 * ここではschemaに依存しない送信envelope（UUID・mode・test token・経過時間・source_channel）だけを検証する。
 */
var PAYLOAD_ALLOWED_KEYS = ['schema_version', 'uuid', 'answers', 'other_texts', 'elapsed_ms', 'source_channel', 'test_token', 'test_run_id'];

function isPlainObject_(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function digestHex_(text) {
  return bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8));
}

/** test token の検証。TEST_TOKEN が未設定・短すぎる場合は常に拒否（fail closed）。固定長のdigest同士を比較する。 */
function verifyTestToken_(candidate) {
  var expected = getProperty_(PROP_TEST_TOKEN);
  if (expected.length < MIN_TEST_TOKEN_LENGTH) return false;
  if (typeof candidate !== 'string' || !candidate) return false;
  var a = digestHex_(expected);
  var b = digestHex_(candidate);
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * response_mode をserver側で確定する。client申告の response_mode は受け付けない（unknown_field）。
 *  - test_token なし → production（test_run_id の同送も拒否）
 *  - test_token あり → token を検証して submit_excluded（response_mode=test）。test_run_id 必須。
 * @return {{ok: boolean, responseMode: ?string, modeId: ?string, testRunId: string, errors: Array<{field: string, code: string}>}}
 */
function resolveResponseMode_(payload) {
  var hasToken = Object.prototype.hasOwnProperty.call(payload, 'test_token');
  var hasRunId = Object.prototype.hasOwnProperty.call(payload, 'test_run_id');
  var errors = [];
  if (!hasToken) {
    if (hasRunId) errors.push({ field: 'test_run_id', code: 'unexpected' });
    var production = SurveyCore.getTestMode(SURVEY_SCHEMA, 'production');
    if (!production || production.responseMode !== 'production') throw new Error('production_mode_missing');
    return { ok: errors.length === 0, responseMode: production.responseMode, modeId: 'production', testRunId: '', errors: errors };
  }
  var test = SurveyCore.getTestMode(SURVEY_SCHEMA, 'submit_excluded');
  if (!test || !test.serverVerified || test.responseMode !== 'test') throw new Error('test_mode_missing');
  if (!verifyTestToken_(payload.test_token)) {
    return { ok: false, responseMode: null, modeId: null, testRunId: '', errors: [{ field: 'test_token', code: 'invalid_token' }] };
  }
  var testRunId = payload.test_run_id;
  if (typeof testRunId !== 'string' || !new RegExp(SURVEY_CONFIG.testRun.idPattern).test(testRunId)) {
    errors.push({ field: 'test_run_id', code: 'invalid_test_run_id' });
  }
  return { ok: errors.length === 0, responseMode: test.responseMode, modeId: 'submit_excluded', testRunId: errors.length ? '' : testRunId, errors: errors };
}

/** source_channel は allowlist のみ保存する。未指定・allowlist外・型違いは unknown（受信値は保存しない）。 */
function normalizeSourceChannel_(value) {
  var source = SURVEY_SCHEMA.persistenceSchema.sourceChannel;
  if (typeof value === 'string' && source.allowlist.indexOf(value) !== -1) return value;
  return source.unknownFallback;
}

/**
 * @return {{ok: boolean, errors: Array<{field: string, code: string}>, clean: Object, terminated: boolean,
 *           uuid: ?string, elapsedMs: number, sourceChannel: string}}
 */
function validatePayload_(payload, mode) {
  var errors = [];
  function fail(field, code) { errors.push({ field: field, code: code }); }
  var validation = SURVEY_CONFIG.validation;

  Object.keys(payload).forEach(function (key) {
    if (PAYLOAD_ALLOWED_KEYS.indexOf(key) === -1) fail(key, 'unknown_field');
  });
  if (!isValidUuid_(payload.uuid)) fail('uuid', 'invalid_uuid');

  var elapsed = payload.elapsed_ms;
  if (typeof elapsed !== 'number' || !isFinite(elapsed) || elapsed < 0 || elapsed > validation.maxElapsedMs) {
    fail('elapsed_ms', 'invalid_type');
  } else if (mode.responseMode === 'production' && elapsed < validation.minElapsedMs) {
    // 最短回答時間はproductionのみ。test送信（submit_excluded）では免除する。
    fail('elapsed_ms', 'too_fast');
  }

  // 受信したままを最初に validateAnswers へ渡す（sanitizeしない）。
  var result = SurveyCore.validateAnswers(SURVEY_SCHEMA, payload.answers, payload.other_texts);
  result.errors.forEach(function (error) { errors.push(error); });

  // 18歳未満（age_confirmed の termination）は、他の検証結果に関わらず本文を一切保存しない。
  var termination = isPlainObject_(payload.answers) ? SurveyCore.findTermination(SURVEY_SCHEMA, payload.answers) : null;

  return {
    ok: errors.length === 0,
    errors: errors,
    clean: result.clean,
    terminated: termination !== null,
    uuid: typeof payload.uuid === 'string' ? payload.uuid : null,
    elapsedMs: typeof elapsed === 'number' && isFinite(elapsed) ? Math.floor(elapsed) : 0,
    sourceChannel: normalizeSourceChannel_(payload.source_channel)
  };
}
