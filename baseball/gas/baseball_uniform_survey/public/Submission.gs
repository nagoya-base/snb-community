/**
 * 回答受付：mode確定 → 受付可否 → 検証 → LockService内で「重複判定＋保存」を一体で実行 → 保存成功後に通知。
 * doPost はここへ委譲するだけで、ロジックを持たない。
 */
var CLOSED_ERRORS = { not_open: 'survey_not_open', closed: 'survey_closed', not_configured: 'survey_not_configured' };

function parseRequestBody_(rawBody) {
  if (typeof rawBody !== 'string' || !rawBody) return { error: errorBody_('invalid_request', { reason: 'empty_body' }) };
  if (utf8ByteLength_(rawBody) > SURVEY_CONFIG.validation.payloadMaxBytes) {
    logEvent_('invalid', { code: 'payload_too_large' });
    return { error: errorBody_('invalid_request', { reason: 'payload_too_large' }) };
  }
  var payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (ignored) {
    logEvent_('invalid', { code: 'malformed_json' });
    return { error: errorBody_('invalid_request', { reason: 'malformed_json' }) };
  }
  if (!isPlainObject_(payload)) {
    logEvent_('invalid', { code: 'not_an_object' });
    return { error: errorBody_('invalid_request', { reason: 'not_an_object' }) };
  }
  return { payload: payload };
}

/** @return {Object} レスポンスbody（ok:true / ok:false + error） */
function processSubmission_(rawBody, now) {
  var parsed = parseRequestBody_(rawBody);
  if (parsed.error) return parsed.error;
  var payload = parsed.payload;

  var mode;
  try {
    mode = resolveResponseMode_(payload);
  } catch (error) {
    logEvent_('error', { code: 'mode_unavailable' });
    return errorBody_('server_error');
  }
  if (!mode.ok) {
    logEvent_('invalid', { fields: mode.errors.map(function (e) { return e.field + ':' + e.code; }) });
    return errorBody_('invalid_request', { fields: mode.errors });
  }
  var isProduction = mode.responseMode === 'production';

  // 受付期間の判定は production のみ・server が最終権威。test送信は公開前にも確認できる。
  if (isProduction) {
    var state = receptionState_(now);
    if (state !== 'open') {
      logEvent_(state === 'closed' ? 'closed' : 'not_accepting', { reason: state });
      return errorBody_(CLOSED_ERRORS[state]);
    }
  }
  if (payload.schema_version !== SURVEY_SCHEMA.schema_version) {
    logEvent_('schema_mismatch');
    return errorBody_('schema_mismatch', { schema_version: SURVEY_SCHEMA.schema_version });
  }

  var validation = validatePayload_(payload, mode);
  if (validation.terminated) {
    // 18歳未満相当：回答本文・hash・メタ情報を一切保存せず、各countにも含めない。
    logEvent_('ineligible');
    return { ok: true, status: 'ineligible' };
  }
  if (!validation.ok) {
    logEvent_('invalid', { fields: validation.errors.map(function (e) { return e.field + ':' + e.code; }) });
    return errorBody_('invalid_request', { fields: validation.errors });
  }

  var hash;
  try {
    hash = hashRespondent_(mode.responseMode, mode.testRunId, validation.uuid);
  } catch (error) {
    logEvent_('error', { code: 'not_configured' });
    return errorBody_('server_error');
  }

  // 通知条件: production && valid && saved && notification.enabled && support_message が空白以外。
  var supportMessage = hasSupportMessage_(validation) ? validation.clean.answers.support_message : '';
  var notificationEnabled = isProduction && SURVEY_CONFIG.notification.enabled === true;
  var shouldNotify = notificationEnabled && supportMessage !== '';
  var initialNotification = !isProduction ? 'not_applicable' : (!notificationEnabled ? 'disabled' : (shouldNotify ? 'pending' : 'not_required'));
  var saved;
  try {
    saved = saveWithLock_(hash, validation, mode, now, initialNotification);
  } catch (error) {
    logEvent_('error', { code: error && error.message ? String(error.message).slice(0, 40) : 'save_failed' });
    return errorBody_('server_error');
  }
  if (saved.duplicate) {
    logEvent_('duplicate');
    return errorBody_('duplicate_submission');
  }

  if (!isProduction) {
    logEvent_('accepted_test');
    return { ok: true, status: 'accepted_test', test: true };
  }
  logEvent_('accepted');
  // 通知は保存成功の「後」に、support_message が入力されたproduction回答に限って行う。通知の失敗は回答の成否に影響させない。
  if (shouldNotify) {
    var status = notifySupportMessage_(saved.sheet, supportMessage, now);
    try {
      updateNotificationStatus_(saved.sheet, saved.row, status);
    } catch (ignored) { /* 補助情報の更新失敗は無視 */ }
  }
  return { ok: true, status: 'accepted' };
}

/** ScriptLock内で重複判定とappendを一体で行う（同時submitでも1件だけ保存される）。 */
function saveWithLock_(hash, validation, mode, now, notificationStatus) {
  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_WAIT_MS);
  try {
    var sheet = getResponsesSheet_();
    // hash入力に response_mode と test_run_id が入っているため、production / test の重複判定は混ざらない。
    if (hasRespondentHash_(sheet, hash)) return { duplicate: true };
    var row = appendResponse_(sheet, buildRow_(validation, mode, hash, now, notificationStatus));
    SpreadsheetApp.flush();
    return { duplicate: false, sheet: sheet, row: row };
  } finally {
    lock.releaseLock();
  }
}
