/**
 * Admin Web App（JSON API）。UIは GitHub Pages（community/costume-portrait-survey-admin.html）にあり、
 * Googleログインで得た ID token を doPost へ渡す。Spreadsheetはデプロイ者権限で読み取り専用。
 *
 *   GET  : データを返さない（死活確認のみ）。
 *   POST : Content-Type: text/plain（CORSプリフライトを避ける）、body=JSON
 *          { action: 'dashboard' | 'crosstab', idToken, rowKey?, colKey? }
 *          → { ok: true, role, data } | { ok: false, error: 'unauthenticated' | 'forbidden' | 'bad_request' | 'server_error' }
 * 全リクエストで毎回 ID token を検証する。認証失敗・未登録・想定外エラーはすべてデータなしで拒否（fail closed）。
 * token・email・例外内容はログへ出さない（このプロジェクトに Logger / console は無い）。
 */
var ADMIN_API_MAX_BODY = 8192;

function doGet() {
  return adminJson_({ ok: true, service: 'costume-portrait-survey-admin' });
}

function doPost(e) {
  var body;
  try {
    var raw = e && e.postData && typeof e.postData.contents === 'string' ? e.postData.contents : '';
    if (!raw || raw.length > ADMIN_API_MAX_BODY) return adminJson_(adminError_('bad_request'));
    var request;
    try { request = JSON.parse(raw); } catch (ignored) { return adminJson_(adminError_('bad_request')); }
    if (!request || typeof request !== 'object' || Array.isArray(request)) return adminJson_(adminError_('bad_request'));
    if (request.action === 'dashboard') {
      var data = getDashboardData(request.idToken);
      body = { ok: true, role: data.role, data: data };
    } else if (request.action === 'crosstab') {
      body = { ok: true, data: getCrosstabData(request.idToken, request.rowKey, request.colKey) };
    } else {
      body = adminError_('bad_request');
    }
  } catch (error) {
    var code = error && error.message;
    body = adminError_(code === 'unauthenticated' || code === 'forbidden' ? code : (code === 'unknown_axis' ? 'bad_request' : 'server_error'));
  }
  return adminJson_(body);
}

function adminError_(code) { return { ok: false, error: code }; }

function adminJson_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

/** ロールはID tokenからサーバー側で決め、ロール別に別個のレスポンスを組み立てる。 */
function getDashboardData(idToken) {
  var session = assertAdminToken_(idToken);
  return session.role === ADMIN_ROLE_OWNER ? getOwnerDashboardData_() : getViewerDashboardData_();
}

function getOwnerDashboardData_() {
  var spreadsheet = openSpreadsheet_();
  var data = buildDashboard_(readResponses_(spreadsheet), readMeta_(spreadsheet));
  data.role = ADMIN_ROLE_OWNER;
  return data;
}

/** VIEWER用。自由記述・非allowlist設問・内部メタはここで組み立てる時点で含めない。 */
function getViewerDashboardData_() {
  var data = buildViewerDashboard_(readResponses_(openSpreadsheet_()));
  data.role = ADMIN_ROLE_VIEWER;
  return data;
}

/** 汎用クロス集計。軸は schema 由来のキー（設問ID または 設問ID:行ID）のみ。VIEWERは許可済みの組み合わせのみ。 */
function getCrosstabData(idToken, rowKey, colKey) {
  var session = assertAdminToken_(idToken);
  if (session.role === ADMIN_ROLE_VIEWER && !isViewerCrosstab_(String(rowKey), String(colKey))) throw new Error('forbidden');
  var rows = readResponses_(openSpreadsheet_());
  var records = rows.filter(function (r) { return r.kind === 'valid'; }).map(function (r) { return r.record; });
  return buildCrosstab_(String(rowKey), String(colKey), records);
}
