/**
 * Public Web App のエントリポイント。ルーティングだけを行い、ロジックは各ファイルへ委譲する。
 * 管理者機能はこのプロジェクトに置かない（Admin GASは別プロジェクト）。
 *
 *   GET  ?action=status&uuid=<browser UUID>  受付状態・回答済み・schema_version
 *   GET  ?action=results                     公開結果（確定済みはスナップショット、未確定は30件以上で途中集計）
 *   POST (Content-Type: text/plain, body=JSON) 回答送信
 */
function doGet(e) {
  var params = e && e.parameter ? e.parameter : {};
  var now = new Date();
  var body;
  try {
    if (params.action === 'status') body = processStatus_(params.uuid, now);
    else if (params.action === 'results') body = readPublicResults_(now);
    else body = { ok: true, service: 'costume-portrait-survey', schema_version: SURVEY_SCHEMA.schema_version };
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
