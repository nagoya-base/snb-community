/**
 * close 後の finalize（Issue #383）。
 *
 * 集計・publication 判定・suppression・snapshot 生成・検証は #382 の SurveyAggregate をそのまま呼ぶ
 * （finalize 用の別集計・別 suppression は作らない）。判断と順序は SurveyMaintenance.finalize が持ち、
 * ここは Spreadsheet / Script Properties との接続（ports）だけを置く。
 *
 * 順序（固定）: precondition → responses を read-only で再読込 → classifyRows → buildSnapshot → validateSnapshot
 *   → 整合確認 → final snapshot を final_snapshot Sheet へ保存 → 読み戻して SHA-256 を照合 → 最後にだけ finalized marker を保存。
 * 途中で例外が出ても marker は保存されない。
 *
 * production submit の受付可否はここで判定しない（#380 Public GAS の責務）。closes_at は precondition にだけ使う。
 * responses_valid（派生 Sheet）は生成しない。snapshot の入力は classifyRows の valid record だけで、
 * 自由記述・respondent_hash を別の場所へ複製しない。
 */
function saveFinalSnapshot_(json) {
  var spreadsheet = openSpreadsheet_();
  var sheet = spreadsheet.getSheetByName(SHEET_FINAL_SNAPSHOT) || spreadsheet.insertSheet(SHEET_FINAL_SNAPSHOT);
  sheet.clear();
  var rows = [['chunk_index', 'content']];
  for (var i = 0; i * SNAPSHOT_CHUNK_SIZE < json.length; i++) {
    // 先頭に固定文字列を付け、チャンクの先頭が = + - @ や数字でも数式・数値として解釈されないようにする。
    rows.push([i, SNAPSHOT_CHUNK_PREFIX + json.substr(i * SNAPSHOT_CHUNK_SIZE, SNAPSHOT_CHUNK_SIZE)]);
  }
  sheet.getRange(2, 2, rows.length - 1, 1).setNumberFormat('@');
  sheet.getRange(1, 1, rows.length, 2).setValues(rows);
  SpreadsheetApp.flush();
}

/** 保存済み final snapshot（JSON 文字列）。未保存・不整合は null。 */
function readFinalSnapshot_() {
  var sheet = openSpreadsheet_().getSheetByName(SHEET_FINAL_SNAPSHOT);
  if (!sheet || sheet.getLastRow() < 2) return null;
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  var parts = [];
  for (var i = 0; i < values.length; i++) {
    var cell = values[i][1];
    if (Number(values[i][0]) !== i || typeof cell !== 'string' || cell.indexOf(SNAPSHOT_CHUNK_PREFIX) !== 0) return null;
    parts.push(cell.substr(SNAPSHOT_CHUNK_PREFIX.length));
  }
  return parts.join('');
}

function finalizePorts_(now) {
  return {
    now: now,
    schema: SURVEY_SCHEMA,
    reception: SURVEY_RECEPTION,
    sha256: sha256Hex_,
    readRows: readRows_,
    loadMarker: function () { return getProperty_(PROP_FINALIZED_MARKER) || null; },
    saveFinalSnapshot: saveFinalSnapshot_,
    readFinalSnapshot: readFinalSnapshot_,
    saveMarker: function (marker) { setProperty_(PROP_FINALIZED_MARKER, JSON.stringify(marker)); }
  };
}

function finalizePreflight_() {
  return SurveyMaintenance.finalizePreflight(finalizePorts_(currentTime_()));
}

function finalizeSurvey_(confirmation) {
  return withLock_(function () {
    var result = SurveyMaintenance.finalize(finalizePorts_(currentTime_()), confirmation);
    logEvent_('finalize', { status: result.status, production_valid_total: result.summary.production_valid_total });
    return result;
  });
}

function getFinalizedStatus_() {
  return SurveyMaintenance.finalizedStatus(finalizePorts_(currentTime_()));
}

/** 確認用に final snapshot の JSON と digest を返す（GitHub Pages へは operator が確認後に PR で反映する。自動 commit しない）。 */
function getFinalSnapshot_() {
  var status = getFinalizedStatus_();
  if (status.state !== 'finalized') throw new Error('not_finalized');
  if (!status.snapshot_verified) throw new Error('snapshot_verify_failed');
  return { json: readFinalSnapshot_(), digest: status.marker.snapshot_digest };
}
