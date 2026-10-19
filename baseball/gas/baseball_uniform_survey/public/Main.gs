/**
 * Public Web App のエントリポイント。ルーティングだけを行い、ロジックは各ファイルへ委譲する。
 *
 *   GET  ?action=status                        受付状態（open / not_open / closed / not_configured）とversion
 *   POST (Content-Type: text/plain, body=JSON) 回答送信（production と submit_excluded のみ。client-only の
 *                                              preview_no_submit / closed_view はserverへ送らない）
 * 管理者機能・公開結果・finalize はこのプロジェクトに置かない。
 */
function doGet(e) {
  var params = e && e.parameter ? e.parameter : {};
  var body;
  try {
    if (params.action === 'status') body = processStatus_(new Date());
    else body = { ok: true, service: 'baseball-uniform-survey', schema_version: SURVEY_SCHEMA.schema_version };
  } catch (error) {
    logEvent_('error', { code: 'get_failed' });
    body = errorBody_('server_error');
  }
  return jsonOutput_(body);
}

function doPost(e) {
  var raw = e && e.postData ? e.postData.contents : '';
  var body;
  try {
    body = processSubmission_(raw, new Date());
  } catch (error) {
    logEvent_('error', { code: 'post_failed' });
    body = errorBody_('server_error');
  }
  return jsonOutput_(body);
}

function jsonOutput_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

function errorBody_(code, extra) {
  var body = { ok: false, error: code };
  if (extra) Object.keys(extra).forEach(function (key) { body[key] = extra[key]; });
  return body;
}

/** 受付状態。回答者の有無・件数・hashは返さない。 */
function processStatus_(now) {
  return {
    ok: true,
    status: receptionState_(now),
    schema_version: SURVEY_SCHEMA.schema_version,
    design_version: SURVEY_SCHEMA.design_version,
    survey_version: SURVEY_SCHEMA.survey_version
  };
}
