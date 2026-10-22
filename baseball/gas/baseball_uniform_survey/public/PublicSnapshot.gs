/**
 * 公開結果用 privacy-safe snapshot（Issue #425）。
 *
 * 公開結果ページは `GET ?action=results` でここが返す snapshot だけを読む。返すのは
 * SurveyAggregate.buildSnapshot + validateSnapshot を通過した JSON だけで、回答本文・自由記述・respondent_hash・
 * timestamp・source_channel・test_run_id・notification_status・詳細居住地は含まない（validateSnapshot が検査）。
 *
 * - 保存先は専用 `public_snapshot` シート（形式は src/snapshot-store.js）。Script Properties の 1 値上限に依存せず、
 *   `responses` とは別シート。結果ページは Sheet 自体へアクセスしない。
 * - 更新は batch のみ。1 回答ごとには更新しない。更新してよいかは既存の SurveyAggregate.decideSnapshotUpdate
 *   （minimumIncrement / countTriggerIncrement / 1 日間隔 / minCell 以上の増分）が唯一の判定。
 * - 新しい snapshot が validateSnapshot に通らない・保存に失敗したときは last-known-good を維持する（壊れた snapshot は公開しない）。
 *   store が空（初回）のときだけ、現在の production valid 回答から initial snapshot を 1 回生成する。
 * - 更新の契機は「production 回答の保存後」と「results の取得時」。どちらも更新判定を通ったときだけ書く。
 * - 直近の refresh attempt の診断（Issue #450）は public_snapshot シートの D1 に、固定 allowlist の値だけを残す（Admin が readonly で確認する）。
 *   公開 API（action=results）には診断を一切含めない。回答値・hash・ID・例外 message / stack は保存しない。
 */
var SNAPSHOT_REFRESH_LOCK_WAIT_MS = 10000;
// Sheets が日付化した version 列を、Admin（Sheets API の UNFORMATTED_VALUE）と同じ日付シリアル値へ揃える。
var SHEETS_EPOCH_SERIAL = 25569;
// 結果が変わらない skipped / failed の診断は、この間隔より短いうちは書き直さない（results 取得のたびに Sheet へ書かない）。
var SNAPSHOT_DIAG_REWRITE_MS = 60 * 60 * 1000;

/* Apps Script のファイル評価順に依存しないよう、SnapshotStore は関数実行時に参照する。 */
function snapshotStoreSheetName_() {
  return SnapshotStore.SHEET_NAME;
}

function sha256Hex_(text) {
  return SnapshotStore.bytesToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8));
}

/** public_snapshot シート。create=true のときだけ作る（読み出しでは作らない）。 */
function getSnapshotSheet_(create) {
  var spreadsheet = openSpreadsheet_();
  var sheetName = snapshotStoreSheetName_();
  var sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet && create) sheet = spreadsheet.insertSheet(sheetName);
  return sheet;
}

/** 保存済み snapshot を検証して返す。{ok:true, meta, snapshot} / {ok:false, problem}。 */
function loadStoredSnapshot_() {
  var sheet;
  try {
    sheet = getSnapshotSheet_(false);
  } catch (error) {
    return { ok: false, problem: 'unavailable' };
  }
  if (!sheet || sheet.getLastRow() < 1) return { ok: false, problem: 'empty' };
  var grid = sheet.getRange(1, 1, sheet.getLastRow(), SnapshotStore.SLOT_COUNT + 1).getValues();
  var stored = SnapshotStore.readGrid(grid, sha256Hex_);
  if (!stored.ok) return stored;
  // 読み戻し時にも検証する（改変・schema/version の不整合は公開しない）。
  var meta = stored.meta;
  if (meta.survey_version !== String(SURVEY_SCHEMA.survey_version) || meta.schema_version !== String(SURVEY_SCHEMA.schema_version) ||
      meta.design_version !== String(SURVEY_SCHEMA.design_version)) return { ok: false, problem: 'version_mismatch' };
  if (SurveyAggregate.validateSnapshot(SURVEY_SCHEMA, stored.snapshot).length) return { ok: false, problem: 'snapshot_invalid' };
  return { ok: true, meta: meta, snapshot: stored.snapshot };
}

function isDate_(value) { return Object.prototype.toString.call(value) === '[object Date]'; }

/** Sheets が version 列を日付へ自動変換していた場合、Admin と同じ日付シリアル値（number）へ戻す。それ以外のセルは変えない。 */
function normalizeCell_(name, value) {
  if (SurveyAggregate.VERSION_FIELDS.indexOf(name) === -1 || !isDate_(value) || isNaN(value.getTime())) return value;
  var parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(Utilities.formatDate(value, REQUIRED_TIMEZONE, 'yyyy-MM-dd'));
  return parts ? Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])) / 86400000 + SHEETS_EPOCH_SERIAL : value;
}

/** responses の全行（列名 → 値）。ヘッダーが schema と一致しない Sheet は読まない。この中だけで使い、外へ出さない。 */
function readResponseRows_(sheet) {
  var header = responseHeader_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var values = sheet.getRange(2, 1, lastRow - 1, header.length).getValues();
  return values.map(function (line) {
    var row = {};
    for (var c = 0; c < header.length; c++) row[header[c]] = normalizeCell_(header[c], line[c]);
    return row;
  });
}

/** 全回答 all-insufficient の初期 snapshot（validateSnapshot 必須）。保存はしない。 */
function buildEmptySnapshot_(now) {
  var snapshot = SurveyAggregate.buildSnapshot(SURVEY_SCHEMA, [], { generatedAt: now });
  if (SurveyAggregate.validateSnapshot(SURVEY_SCHEMA, snapshot).length) throw new Error('snapshot_invalid');
  return snapshot;
}

/** 診断用の段階記録。各段階に入る直前に stage を更新するので、例外時も「どこで落ちたか」が残る。 */
function newRefreshTrace_() {
  return { stage: 'lock', responsesVerified: false, errorClass: null, previousExactTotal: null, currentValidTotal: null, increment: null, classify: null, validate: null };
}

/**
 * ScriptLock 内で呼ぶこと。更新判定 → 生成 → validateSnapshot → 保存。戻りは {updated, reason}（件数・回答値は含めない）。
 * trace には段階と件数サマリだけを書く（診断用。個票・hash は入れない）。
 */
function refreshSnapshotLocked_(now, trace) {
  trace.stage = 'load';
  var stored = loadStoredSnapshot_();
  var previous = stored.ok ? { generated_at: stored.meta.generated_at, production_valid_total: stored.meta.exact_total } : null;
  var sheet = getResponsesSheet_();
  trace.responsesVerified = true;
  trace.previousExactTotal = previous ? previous.production_valid_total : null;
  var policy = SurveyAggregate.snapshotPolicy(SURVEY_SCHEMA);
  // 軽量な事前判定：有効回答数は production 行数以下なので、行数の増分が minimumIncrement 未満なら全行を読まずに終える。
  if (previous && countProductionResponses_(sheet) - previous.production_valid_total < policy.minimumIncrement) {
    return { updated: false, reason: 'insufficient_increment' };
  }
  var rows = readResponseRows_(sheet);
  trace.stage = 'classify';
  var classification = SurveyAggregate.classifyRows(SURVEY_SCHEMA, rows);
  var total = classification.valid.length;
  trace.classify = classification.counts;
  trace.currentValidTotal = total;
  var decision = SurveyAggregate.decideSnapshotUpdate(SURVEY_SCHEMA, previous, total, now);
  trace.increment = previous ? decision.increment : null;
  if (!decision.update) return { updated: false, reason: decision.reason };

  trace.stage = 'build';
  var snapshot = SurveyAggregate.buildSnapshot(SURVEY_SCHEMA, classification.valid, { generatedAt: now });
  trace.stage = 'validate';
  var problems = SurveyAggregate.validateSnapshot(SURVEY_SCHEMA, snapshot);
  if (problems.length) {
    // 新しい snapshot は公開しない。last-known-good（あれば）を維持する。問題は種別の件数だけに集約して診断へ残す。
    trace.validate = SnapshotStore.summarizeValidation(SurveyAggregate.validateSnapshotDetailed(SURVEY_SCHEMA, snapshot), problems.length);
    logEvent_('error', { code: 'snapshot_invalid' });
    return { updated: false, reason: 'snapshot_invalid' };
  }
  trace.stage = 'plan';
  var json = JSON.stringify(snapshot);
  var written = SnapshotStore.plan(json, sha256Hex_(json), {
    generatedAt: snapshot.generated_at,
    exactTotal: total,
    publicTotal: snapshot.production_valid_total,
    reason: decision.reason,
    updatedAt: now.toISOString(),
    surveyVersion: String(SURVEY_SCHEMA.survey_version),
    schemaVersion: String(SURVEY_SCHEMA.schema_version),
    designVersion: String(SURVEY_SCHEMA.design_version)
  }, stored.ok ? stored.meta : null);
  if (!writeSnapshotStore_(written, trace)) {
    // 書いた chunk が読み戻しで一致しなかった。meta は更新していないので last-known-good は有効なまま。
    logEvent_('error', { code: 'snapshot_verify_failed' });
    return { updated: false, reason: 'verify_failed' };
  }
  return { updated: true, reason: decision.reason };
}

/**
 * chunk を slot（有効な slot の反対側）の列へ書き、読み戻して検証できたときだけ、最後に meta を書く。
 * 検証に失敗したら meta は更新せず false を返す（meta が指す直前の slot は壊れない）。
 */
function writeSnapshotStore_(written, trace) {
  if (trace) trace.stage = 'write';
  var sheet = getSnapshotSheet_(true);
  var column = 2 + written.slot;
  var rows = Math.max(sheet.getLastRow(), written.chunkCells.length);
  var cells = [];
  for (var i = 0; i < rows; i++) cells.push([i < written.chunkCells.length ? written.chunkCells[i] : '']);
  sheet.getRange(1, column, rows, 1).setValues(cells);
  SpreadsheetApp.flush();
  if (trace) trace.stage = 'verify';
  var grid = sheet.getRange(1, 1, rows, SnapshotStore.SLOT_COUNT + 1).getValues();
  grid[0][0] = written.metaCell;
  if (!SnapshotStore.readGrid(grid, sha256Hex_).ok) return false;
  sheet.getRange(1, 1, 1, 1).setValues([[written.metaCell]]);
  SpreadsheetApp.flush();
  return true;
}

/** refresh の戻り（{updated, reason}）→ 診断の result / reason。例外（reason 'failed'）は reason 'exception'。 */
function refreshOutcome_(result) {
  if (result.updated) return { result: 'success', reason: result.reason };
  if (result.reason === 'failed') return { result: 'failed', reason: 'exception' };
  if (result.reason === 'snapshot_invalid' || result.reason === 'verify_failed') return { result: 'failed', reason: result.reason };
  return { result: 'skipped', reason: result.reason };
}

/** 直近の診断（D1）。無い・不正は null。読めなくても例外にしない。 */
function readRefreshDiagnostics_(sheet) {
  try {
    if (sheet.getLastColumn() < SnapshotStore.DIAG_COLUMN) return null;
    return SnapshotStore.parseDiagnostics(sheet.getRange(1, SnapshotStore.DIAG_COLUMN, 1, 1).getValues()[0][0]);
  } catch (error) {
    return null;
  }
}

/**
 * 直近の refresh attempt を public_snapshot!D1 に残す（ScriptLock 内で呼ぶ）。失敗しても refresh・回答保存・results の成否に影響させない。
 * 残すのは SnapshotStore.encodeDiagnostics が allowlist 化した値だけ。
 * responses の検証前に落ちた場合（別 survey の Sheet 等）は、public_snapshot シートを新規作成しない。
 */
function recordRefreshDiagnostics_(now, trace, result) {
  try {
    var outcome = refreshOutcome_(result);
    var diagnostics = {
      attempted_at: now.toISOString(),
      result: outcome.result,
      stage: outcome.result === 'success' ? 'verify' : trace.stage,
      reason: outcome.reason,
      error_class: outcome.reason === 'exception' ? (trace.errorClass || 'unknown') : null,
      previous_exact_total: trace.previousExactTotal,
      current_valid_total: trace.currentValidTotal,
      increment: trace.increment,
      classify: trace.classify,
      validate: trace.validate
    };
    var cell = SnapshotStore.encodeDiagnostics(diagnostics);
    if (!cell) return;
    var sheet = getSnapshotSheet_(trace.responsesVerified);
    if (!sheet) return;
    if (outcome.result !== 'success') {
      // 内容が前回と同じ skipped / failed は、一定時間は書き直さない。
      var last = readRefreshDiagnostics_(sheet);
      var same = function (d) { return JSON.stringify(Object.assign({}, d, { attempted_at: null })); };
      if (last && same(last) === same(SnapshotStore.parseDiagnostics(cell)) &&
          now.getTime() - new Date(last.attempted_at).getTime() < SNAPSHOT_DIAG_REWRITE_MS) return;
    }
    sheet.getRange(1, SnapshotStore.DIAG_COLUMN, 1, 1).setValues([[cell]]);
  } catch (error) {
    logEvent_('error', { code: 'snapshot_diagnostics_failed' });
  }
}

/**
 * 更新判定を通ったときだけ snapshot を更新する。失敗しても呼び出し元（回答保存・結果取得）の成否に影響させない。
 * 他の更新が進行中（ロック取得不可）のときは何もしない（進行中の refresh が診断を残す）。
 * 戻りの {updated, reason} は従来どおり。段階・件数サマリ・失敗分類は診断（D1）にだけ残す。
 */
function refreshPublicSnapshot_(now) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(SNAPSHOT_REFRESH_LOCK_WAIT_MS);
  } catch (error) {
    return { updated: false, reason: 'busy' };
  }
  try {
    var trace = newRefreshTrace_();
    var result;
    try {
      result = refreshSnapshotLocked_(now, trace);
    } catch (error) {
      trace.errorClass = SnapshotStore.classifyError(error);
      logEvent_('error', { code: 'snapshot_refresh_failed', reason: trace.errorClass });
      result = { updated: false, reason: 'failed' };
    }
    recordRefreshDiagnostics_(now, trace, result);
    return result;
  } finally {
    lock.releaseLock();
  }
}

/**
 * `GET ?action=results`。更新判定を通っていれば更新し、保存済みの検証済み snapshot を返す。
 * 保存済みが無い・読めない場合は、全項目非公開の initial snapshot を返す（raw は返さない）。
 */
function processResults_(now) {
  refreshPublicSnapshot_(now);
  var stored = loadStoredSnapshot_();
  if (stored.ok) return { ok: true, snapshot: stored.snapshot };
  return { ok: true, snapshot: buildEmptySnapshot_(now) };
}
