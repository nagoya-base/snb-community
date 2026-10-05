/**
 * 締切後の結果確定（finalize）。Apps Scriptエディタから `finalizeSurvey` を1回だけ手動実行する。
 *
 *  - 締切前、または締切設定（SURVEY_CLOSES_AT）が未設定・不正な場合は何もせずエラー（未確定の数値を最終結果にしない）。
 *    締切時刻ちょうどは受付中のため確定できず、1ms後から確定できる。
 *  - 締切内(timestamp <= 締切)の有効回答だけで公開payloadを作り、Script Propertiesへチャンク保存する。
 *    completion_status=test のE2Eテスト行は件数・集計・公開結果から除外する。
 *    以後の公開結果はこのスナップショットを返すだけで、Spreadsheetの後続変更では変わらない。
 *  - 二重実行は安全：確定済みなら何も書き換えず、確定済みの統計を返す。
 *  - 途中で失敗したらスナップショットを残さない（確定扱いにしない）。
 *  - metaシートに統計（件数・確定日時・status）を書く。Admin GASはこれを読んで確定状態を表示する。
 */
var PROP_FINAL_META = 'FINAL_RESULTS_META';
var PROP_FINAL_CHUNK_PREFIX = 'FINAL_RESULTS_';
var PROP_FINALIZED_AT = 'FINALIZED_AT';
var CHUNK_MAX_BYTES = 8000;

function splitByUtf8Bytes_(text, maxBytes) {
  var chunks = [];
  var current = '';
  var currentBytes = 0;
  var chars = Array.from(text);
  chars.forEach(function (ch) {
    var size = utf8ByteLength_(ch);
    if (currentBytes + size > maxBytes) { chunks.push(current); current = ''; currentBytes = 0; }
    current += ch;
    currentBytes += size;
  });
  if (current) chunks.push(current);
  return chunks;
}

function chunkKey_(index) { return PROP_FINAL_CHUNK_PREFIX + ('000' + index).slice(-3); }

function clearFinalSnapshot_(properties) {
  var all = properties.getProperties();
  Object.keys(all).forEach(function (key) {
    if (key === PROP_FINAL_META || key === PROP_FINALIZED_AT || key.indexOf(PROP_FINAL_CHUNK_PREFIX) === 0) {
      properties.deleteProperty(key);
    }
  });
}

function readFinalMeta_() {
  var text = getProperty_(PROP_FINALIZED_AT);
  return text ? { finalizedAt: text } : null;
}

/** responsesシートを行オブジェクト（列名→値）で読む。列順に依存しない。 */
function readResponseRows_(sheet) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2) return [];
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  return values.map(function (row) {
    var obj = {};
    header.forEach(function (name, i) { obj[name] = row[i]; });
    return obj;
  });
}

function classifyTimestamp_(value, closesAt) {
  var time = value && typeof value.getTime === 'function' ? value.getTime() : Date.parse(String(value));
  if (isNaN(time)) return 'unparseable';
  return time > closesAt ? 'late' : 'valid';
}

function finalizeSurvey() {
  return finalizeSurvey_(new Date());
}

function finalizeSurvey_(now) {
  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_WAIT_MS);
  try {
    var properties = PropertiesService.getScriptProperties();
    var existing = readFinalMeta_();
    if (existing) {
      logEvent_('finalize', { already: true });
      return { status: 'final', already: true, finalizedAt: existing.finalizedAt, stats: JSON.parse(getProperty_(PROP_FINAL_META)).stats };
    }
    // 締切値そのものを明示検証する。isSurveyOpen_() は未設定/不正でも false を返す（受付はfail closed）ため、
    // 「締切済み」と「締切設定不正」を区別できず、不正値のまま確定すると全行がlate扱いの誤った確定結果になる。
    var closesAt = parseCloseTime_(getProperty_(PROP_CLOSES_AT));
    if (closesAt === null) throw new Error('survey_close_not_configured');
    if (now.getTime() <= closesAt) throw new Error('survey_not_closed'); // 締切時刻ちょうどは受付中

    var spreadsheet = openSpreadsheet_();
    var rows = readResponseRows_(getResponsesSheet_());
    var stats = { responseRows: 0, validRows: 0, lateRows: 0, unparseableRows: 0, publicTotal: 0 };
    var records = [];
    rows.forEach(function (row) {
      if (row.completion_status === 'test') return;
      if (row.timestamp === '' || row.timestamp === null || row.timestamp === undefined) return;
      stats.responseRows++;
      var kind = classifyTimestamp_(row.timestamp, closesAt);
      if (kind === 'late') { stats.lateRows++; return; }
      if (kind === 'unparseable') { stats.unparseableRows++; return; }
      stats.validRows++;
      records.push(SurveyCore.decodeRecord(SURVEY_SCHEMA, row));
    });

    var payload = assertPublicPayload_(buildPublicPayload_(records));
    if (payload.status === 'final' && payload.total !== stats.validRows) throw new Error('total_mismatch');
    stats.publicTotal = stats.validRows;

    try {
      var json = JSON.stringify(payload);
      var chunks = splitByUtf8Bytes_(json, CHUNK_MAX_BYTES);
      chunks.forEach(function (chunk, i) { properties.setProperty(chunkKey_(i), chunk); });
      var finalizedAt = now.toISOString();
      properties.setProperty(PROP_FINAL_META, JSON.stringify({ chunks: chunks.length, stats: stats, status: 'final' }));
      // 読み戻して検証してから確定マーカーを書く。
      if (readSnapshotJson_(properties) !== json) throw new Error('snapshot_verify_failed');
      properties.setProperty(PROP_FINALIZED_AT, finalizedAt);
    } catch (error) {
      clearFinalSnapshot_(properties);
      throw error;
    }

    try {
      var meta = getMetaSheet_(spreadsheet);
      setMeta_(meta, 'finalize_status', 'final');
      setMeta_(meta, 'finalized_at', properties.getProperty(PROP_FINALIZED_AT));
      Object.keys(stats).forEach(function (key) { setMeta_(meta, 'finalize_' + key, stats[key]); });
    } catch (ignored) {
      logEvent_('error', { code: 'meta_write_failed' });
    }
    logEvent_('finalize', { stats: stats });
    return { status: 'final', already: false, finalizedAt: properties.getProperty(PROP_FINALIZED_AT), stats: stats };
  } finally {
    lock.releaseLock();
  }
}

function readSnapshotJson_(properties) {
  var meta = JSON.parse(properties.getProperty(PROP_FINAL_META));
  var text = '';
  for (var i = 0; i < meta.chunks; i++) {
    var chunk = properties.getProperty(chunkKey_(i));
    if (typeof chunk !== 'string') throw new Error('snapshot_chunk_missing');
    text += chunk;
  }
  return text;
}

/** 公開結果API。確定済みスナップショットを返すだけで、Spreadsheetは一切読まない。 */
function readPublicResults_() {
  if (!readFinalMeta_()) return { ok: true, status: 'not_finalized' };
  var payload = JSON.parse(readSnapshotJson_(PropertiesService.getScriptProperties()));
  assertPublicPayload_(payload);
  return { ok: true, results: payload };
}
