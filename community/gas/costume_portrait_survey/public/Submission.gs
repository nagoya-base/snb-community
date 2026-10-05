/**
 * 回答受付：検証 → LockService内で「重複判定＋保存」を一体で実行 → 保存成功後に通知。
 * doPost はここへ委譲するだけで、ロジックを持たない。
 */
function jsonOutput_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

function errorBody_(code, extra) {
  var body = { ok: false, error: code };
  if (extra) Object.keys(extra).forEach(function (key) { body[key] = extra[key]; });
  return body;
}

function parseRequestBody_(rawBody) {
  if (typeof rawBody !== 'string' || !rawBody) return { error: errorBody_('invalid_request', { reason: 'empty_body' }) };
  if (utf8ByteLength_(rawBody) > SURVEY_SCHEMA.limits.payloadMaxBytes) {
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

  if (!isSurveyOpen_(now)) {
    logEvent_('closed');
    return errorBody_('survey_closed');
  }
  if (payload.schema_version !== SURVEY_SCHEMA.schema_version) {
    logEvent_('schema_mismatch');
    return errorBody_('schema_mismatch', { schema_version: SURVEY_SCHEMA.schema_version });
  }

  var validation = validatePayload_(payload);
  if (!validation.ok) {
    logEvent_('invalid', { fields: validation.errors.map(function (e) { return e.field + ':' + e.code; }) });
    return errorBody_('invalid_request', { fields: validation.errors });
  }

  var hash;
  try {
    hash = hashRespondent_(validation.uuid);
  } catch (error) {
    logEvent_('error', { code: 'not_configured' });
    return errorBody_('server_error');
  }

  var saved;
  try {
    saved = saveWithLock_(hash, validation, now);
  } catch (error) {
    logEvent_('error', { code: error && error.message ? String(error.message).slice(0, 40) : 'save_failed' });
    return errorBody_('server_error');
  }
  if (saved.duplicate) {
    logEvent_('duplicate');
    return errorBody_('duplicate_submission');
  }
  logEvent_('accepted');

  // 回答保存の成功後に通知する。通知の失敗は回答の成否に影響させない。
  var status = notifyCheerMessage_(validation.clean, now);
  if (status !== 'none') {
    try {
      updateNotificationStatus_(saved.sheet, saved.row, status);
    } catch (ignored) { /* 補助情報の更新失敗は無視 */ }
  }
  return { ok: true, status: 'accepted' };
}

/** ScriptLock内で重複判定とappendを一体で行う（同時submitでも1件だけ保存される）。 */
function saveWithLock_(hash, validation, now) {
  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_WAIT_MS);
  try {
    var spreadsheet = openSpreadsheet_();
    var sheet = getResponsesSheet_();
    if (hasRespondentHash_(sheet, hash)) {
      try { incrementMetaCounter_(spreadsheet, 'duplicate_rejects'); } catch (ignored) { /* カウンタ失敗は無視 */ }
      return { duplicate: true };
    }
    var row = appendResponse_(sheet, buildRow_(validation.clean, hash, now, validation.elapsedMs));
    SpreadsheetApp.flush();
    return { duplicate: false, sheet: sheet, row: row };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 入力前のstatus。submitと同じサーバー側hash照合を使うが、hash自体は返さない。
 * 返すのはこのUUIDの持ち主自身が知り得る「回答済みか」だけ。
 */
function processStatus_(uuid, now) {
  if (!isValidUuid_(uuid)) return errorBody_('invalid_request', { reason: 'invalid_uuid' });
  var answered = false;
  try {
    answered = hasRespondentHash_(getResponsesSheet_(), hashRespondent_(uuid));
  } catch (error) {
    logEvent_('error', { code: 'status_failed' });
    return errorBody_('server_error');
  }
  return {
    ok: true,
    status: isSurveyOpen_(now) ? 'open' : 'closed',
    answered: answered,
    schema_version: SURVEY_SCHEMA.schema_version,
    survey_version: SURVEY_SCHEMA.survey_version
  };
}
