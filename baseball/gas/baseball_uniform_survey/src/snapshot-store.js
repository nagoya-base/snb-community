/**
 * 名古屋野球ユニ部アンケート（Issue #425）：Public GAS が保持する privacy-safe snapshot の永続化形式。
 *
 * 副作用なしの純粋関数だけを持つ（Sheet への読み書き・時刻・digest 計算は呼び出し側が行う）。
 * Public GAS（書き込み・読み出し）と Admin GAS（readonly の状態表示）が同じ形式を解釈するために共有する。
 *
 * 保存先は Spreadsheet の専用 `public_snapshot` シート（raw responses の `responses` とは別）。
 *   A1            : メタデータ（先頭 `m:` + JSON）。**最後に**書く。これが指す slot の chunk だけが有効。
 *   B列 / C列     : slot 0 / slot 1 の chunk。1 行 1 chunk（先頭 `c:` + 最大 CHUNK_SIZE 文字）。
 * 2 つの slot を交互に使うので、書き込み途中で失敗しても直前の last-known-good（もう一方の slot）は壊れない。
 * `c:` / `m:` の接頭辞は、Sheets が数式・数値・日付として解釈するのを避ける。1 セル 50,000 文字の上限にも収まる。
 *
 *   D1            : 直近の refresh 診断（先頭 `g:` + JSON。Issue #450）。snapshot の有効性とは無関係（meta が指す chunk には影響しない）。
 *                   固定 allowlist に正規化した値（段階・結果・理由・件数・分類サマリ）だけを持ち、回答値・hash・ID・例外 message は持たない。
 *
 * 読み戻し時は meta・chunk 数・総文字数・SHA-256 を照合し、1 つでも合わなければ「無い」ものとして扱う（fail closed）。
 * snapshot 自体の privacy / suppression / version の検証は SurveyAggregate.validateSnapshot が行う。
 *
 * ES5記法。ブラウザ・Apps Script V8・Node.js のいずれでも動く。
 */
var SnapshotStore = (function () {
  'use strict';

  var STORE_VERSION = 1;
  var SLOT_COUNT = 2;
  var CHUNK_SIZE = 40000;
  var META_PREFIX = 'm:';
  var CHUNK_PREFIX = 'c:';
  var SHEET_NAME = 'public_snapshot';
  // meta に許可するキー（これ以外を含む meta は不正。個票・hash などが紛れ込む余地を作らない）。
  var STRING_KEYS = ['digest', 'generated_at', 'updated_at', 'reason', 'survey_version', 'schema_version', 'design_version'];
  var COUNT_KEYS = ['slot', 'chunks', 'length', 'exact_total'];

  // ── refresh 診断（Issue #450）：書き込み側・読み出し側の両方が同じ allowlist で正規化する（fail closed）。 ──
  var DIAG_VERSION = 1;
  var DIAG_PREFIX = 'g:';
  var DIAG_COLUMN = SLOT_COUNT + 2; // 1 始まりの列番号（D 列）。行は 1。
  var DIAG_STAGES = ['lock', 'load', 'classify', 'build', 'validate', 'plan', 'write', 'verify'];
  var DIAG_RESULTS = ['success', 'skipped', 'failed'];
  var DIAG_REASONS = ['initial', 'invalid_previous', 'daily', 'count_increment', 'insufficient_increment', 'not_due', 'busy',
    'snapshot_invalid', 'verify_failed', 'exception'];
  var DIAG_ERROR_CLASSES = ['not_configured', 'responses_sheet_missing', 'header_mismatch', 'service_quota', 'timeout', 'permission',
    'service_unavailable', 'sheet_limit', 'programming_error', 'unknown'];
  var DIAG_EXCLUDED_KEYS = ['unknown_response_mode', 'incomplete', 'version_mismatch', 'malformed', 'ineligible', 'schema_invalid', 'missing_hash', 'duplicate'];
  var DIAG_VERSION_FIELDS = ['survey_version', 'schema_version', 'design_version'];
  // SurveyAggregate.VALIDATION_CATEGORIES と同一（tests/refresh_diagnostics.test.js が一致を検証する）。
  var DIAG_VALIDATION_CATEGORIES = ['structure', 'snapshot_version', 'version_mismatch', 'generated_at', 'response_status', 'live_count',
    'private_value_detected', 'private_key_detected', 'question_order', 'invalid_state', 'target_count', 'cells_structure',
    'small_cell_suppression', 'complementary_suppression', 'sort_order'];
  var DIAG_MAX_QUESTION_IDS = 40;
  var QUESTION_ID_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

  function isInt(value) { return typeof value === 'number' && isFinite(value) && value === Math.floor(value); }
  function countOrNull(value) { return isCount(value) ? value : null; }
  function intOrNull(value) { return isInt(value) ? value : null; }
  function pick(list, value) { return typeof value === 'string' && list.indexOf(value) !== -1 ? value : null; }

  /** keys の各キーを件数（非負整数）へ。無い・不正は 0。 */
  function countMap(keys, source) {
    var out = {};
    for (var i = 0; i < keys.length; i++) out[keys[i]] = isPlainObject(source) && isCount(source[keys[i]]) ? source[keys[i]] : 0;
    return out;
  }

  function sanitizeClassify(input) {
    if (!isPlainObject(input)) return null;
    var excluded = countMap(DIAG_EXCLUDED_KEYS, input.excluded);
    var excludedTotal = 0;
    for (var i = 0; i < DIAG_EXCLUDED_KEYS.length; i++) excludedTotal += excluded[DIAG_EXCLUDED_KEYS[i]];
    return {
      rows: countOrNull(input.rows) || 0,
      production_valid: countOrNull(input.production_valid) || 0,
      test_excluded: countOrNull(input.test_excluded) || 0,
      excluded_total: excludedTotal,
      excluded: excluded,
      version_mismatch_fields: countMap(DIAG_VERSION_FIELDS, input.version_mismatch_fields),
      legacy_date_serial_accepted: countOrNull(input.legacy_date_serial_accepted) || 0
    };
  }

  function sanitizeValidate(input) {
    if (!isPlainObject(input)) return null;
    var ids = [];
    if (Array.isArray(input.question_ids)) {
      for (var i = 0; i < input.question_ids.length && ids.length < DIAG_MAX_QUESTION_IDS; i++) {
        var id = input.question_ids[i];
        if (typeof id === 'string' && QUESTION_ID_PATTERN.test(id) && ids.indexOf(id) === -1) ids.push(id);
      }
    }
    return { problem_total: countOrNull(input.problem_total) || 0, categories: countMap(DIAG_VALIDATION_CATEGORIES, input.categories), question_ids: ids };
  }

  /**
   * 診断 → allowlist 済みの診断。result / stage / reason / attempted_at のどれかが不正なら null（保存・表示しない）。
   * 未知のキー・allowlist 外の文字列は捨てる。
   */
  function sanitizeDiagnostics(input) {
    if (!isPlainObject(input)) return null;
    var result = pick(DIAG_RESULTS, input.result);
    var stage = pick(DIAG_STAGES, input.stage);
    var reason = pick(DIAG_REASONS, input.reason);
    var attempted = typeof input.attempted_at === 'string' ? new Date(input.attempted_at) : null;
    if (!result || !stage || !reason || !attempted || isNaN(attempted.getTime())) return null;
    return {
      v: DIAG_VERSION,
      attempted_at: attempted.toISOString(),
      result: result,
      stage: stage,
      reason: reason,
      error_class: pick(DIAG_ERROR_CLASSES, input.error_class),
      previous_exact_total: countOrNull(input.previous_exact_total),
      current_valid_total: countOrNull(input.current_valid_total),
      increment: intOrNull(input.increment),
      classify: sanitizeClassify(input.classify),
      validate: sanitizeValidate(input.validate)
    };
  }

  /** 保存するセル文字列。不正な診断は null。 */
  function encodeDiagnostics(input) {
    var clean = sanitizeDiagnostics(input);
    return clean ? DIAG_PREFIX + JSON.stringify(clean) : null;
  }

  /** セル値 → allowlist 済みの診断 or null（空・形式違い・不正は null）。 */
  function parseDiagnostics(cell) {
    if (typeof cell !== 'string' || cell.indexOf(DIAG_PREFIX) !== 0) return null;
    var parsed;
    try { parsed = JSON.parse(cell.substr(DIAG_PREFIX.length)); } catch (e) { return null; }
    return sanitizeDiagnostics(parsed);
  }

  /** validateSnapshotDetailed の戻り（[{category, question_id}]）→ 件数サマリ。fallbackTotal は詳細が空のときの問題件数。 */
  function summarizeValidation(problems, fallbackTotal) {
    var list = Array.isArray(problems) ? problems : [];
    var categories = {};
    var ids = [];
    for (var i = 0; i < list.length; i++) {
      var category = isPlainObject(list[i]) ? pick(DIAG_VALIDATION_CATEGORIES, list[i].category) : null;
      if (category) categories[category] = (categories[category] || 0) + 1;
      if (isPlainObject(list[i]) && typeof list[i].question_id === 'string') ids.push(list[i].question_id);
    }
    return sanitizeValidate({ problem_total: list.length || fallbackTotal || 0, categories: categories, question_ids: ids });
  }

  /**
   * 例外 → 固定 allowlist の分類（error_class）。message / stack は保存せず、ここで分類コードへ落とすだけ。
   * 完全一致する内部コードか、既知の Apps Script 障害パターンだけを分類する。それ以外は 'unknown'。
   */
  function classifyError(error) {
    var message = error && typeof error.message === 'string' ? error.message : '';
    var name = error && typeof error.name === 'string' ? error.name : '';
    if (message === 'not_configured' || message === 'responses_sheet_missing' || message === 'header_mismatch') return message;
    if (/too many times|quota|rate limit|limit exceeded/i.test(message)) return 'service_quota';
    if (/time(d)? ?out|exceeded maximum execution/i.test(message)) return 'timeout';
    if (/permission|not authorized|authorization|access denied/i.test(message)) return 'permission';
    if (/service (is )?unavailable|temporarily|internal error|server error/i.test(message)) return 'service_unavailable';
    if (/grid limits|outside the dimensions|above the limit|10000000 cells/i.test(message)) return 'sheet_limit';
    if (name === 'TypeError' || name === 'ReferenceError' || name === 'RangeError' || name === 'SyntaxError') return 'programming_error';
    return 'unknown';
  }

  function isPlainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function isCount(value) { return typeof value === 'number' && isFinite(value) && value >= 0 && value === Math.floor(value); }

  /** meta セル → meta object。形式違い・未知キー・型違いは null。 */
  function parseMeta(cell) {
    if (typeof cell !== 'string' || cell.indexOf(META_PREFIX) !== 0) return null;
    var meta;
    try { meta = JSON.parse(cell.substr(META_PREFIX.length)); } catch (e) { return null; }
    if (!isPlainObject(meta) || meta.v !== STORE_VERSION) return null;
    var allowed = ['v', 'public_total'].concat(STRING_KEYS, COUNT_KEYS);
    var keys = Object.keys(meta);
    for (var i = 0; i < keys.length; i++) if (allowed.indexOf(keys[i]) === -1) return null;
    for (var s = 0; s < STRING_KEYS.length; s++) if (typeof meta[STRING_KEYS[s]] !== 'string') return null;
    for (var c = 0; c < COUNT_KEYS.length; c++) if (!isCount(meta[COUNT_KEYS[c]])) return null;
    // 公開仕様上の回答数。閾値未満の間は snapshot 側が null なので null を許す。
    if (meta.public_total !== null && !isCount(meta.public_total)) return null;
    if (meta.slot >= SLOT_COUNT || meta.chunks < 1 || isNaN(new Date(meta.generated_at).getTime())) return null;
    return meta;
  }

  /** 次に書く slot（現在有効な slot の反対側。meta が無い・不正なら 0）。 */
  function nextSlot(previousMeta) {
    return previousMeta && isCount(previousMeta.slot) ? (previousMeta.slot + 1) % SLOT_COUNT : 0;
  }

  /**
   * 書き込み計画。snapshotJson は JSON.stringify 済みの文字列、digest は SHA-256 hex。
   * info: {generatedAt, exactTotal, publicTotal, reason, updatedAt（ISO）, surveyVersion, schemaVersion, designVersion}
   * 戻り: {slot, chunkCells, metaCell, meta}。呼び出し側は chunkCells を slot の列へ書いた「後に」metaCell を書く。
   */
  function plan(snapshotJson, digest, info, previousMeta) {
    var chunkCells = [];
    for (var offset = 0; offset < snapshotJson.length; offset += CHUNK_SIZE) {
      chunkCells.push(CHUNK_PREFIX + snapshotJson.substr(offset, CHUNK_SIZE));
    }
    var meta = {
      v: STORE_VERSION,
      slot: nextSlot(previousMeta),
      chunks: chunkCells.length,
      length: snapshotJson.length,
      digest: digest,
      generated_at: info.generatedAt,
      exact_total: info.exactTotal,
      public_total: info.publicTotal,
      reason: info.reason,
      updated_at: info.updatedAt,
      survey_version: info.surveyVersion,
      schema_version: info.schemaVersion,
      design_version: info.designVersion
    };
    return { slot: meta.slot, chunkCells: chunkCells, metaCell: META_PREFIX + JSON.stringify(meta), meta: meta };
  }

  /**
   * シート全体の値（行配列。末尾の空セル・空行は省かれていてよい）から、有効な snapshot JSON を取り出す。
   * sha256(text) は呼び出し側が渡す。戻り: {ok:true, meta, json, snapshot} / {ok:false, problem}。
   * problem: empty / meta_invalid / chunk_missing / chunk_invalid / length_mismatch / digest_mismatch / json_invalid
   */
  function readGrid(grid, sha256) {
    var first = Array.isArray(grid) && Array.isArray(grid[0]) ? grid[0][0] : undefined;
    if (first === undefined || first === null || first === '') return { ok: false, problem: 'empty' };
    var meta = parseMeta(first);
    if (!meta) return { ok: false, problem: 'meta_invalid' };
    var parts = [];
    for (var i = 0; i < meta.chunks; i++) {
      var line = grid[i];
      var cell = Array.isArray(line) ? line[1 + meta.slot] : undefined;
      if (cell === undefined || cell === null || cell === '') return { ok: false, problem: 'chunk_missing' };
      if (typeof cell !== 'string' || cell.indexOf(CHUNK_PREFIX) !== 0) return { ok: false, problem: 'chunk_invalid' };
      parts.push(cell.substr(CHUNK_PREFIX.length));
    }
    var json = parts.join('');
    if (json.length !== meta.length) return { ok: false, problem: 'length_mismatch' };
    if (sha256(json) !== meta.digest) return { ok: false, problem: 'digest_mismatch' };
    var snapshot;
    try { snapshot = JSON.parse(json); } catch (e) { return { ok: false, problem: 'json_invalid' }; }
    if (!isPlainObject(snapshot)) return { ok: false, problem: 'json_invalid' };
    return { ok: true, meta: meta, json: json, snapshot: snapshot };
  }

  /** バイト列（Apps Script の Utilities.computeDigest の戻り。符号付き）→ 小文字 hex。 */
  function bytesToHex(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i++) {
      var b = bytes[i] < 0 ? bytes[i] + 256 : bytes[i];
      out += (b < 16 ? '0' : '') + b.toString(16);
    }
    return out;
  }

  var api = {
    STORE_VERSION: STORE_VERSION,
    DIAG_PREFIX: DIAG_PREFIX,
    DIAG_COLUMN: DIAG_COLUMN,
    DIAG_STAGES: DIAG_STAGES,
    DIAG_RESULTS: DIAG_RESULTS,
    DIAG_REASONS: DIAG_REASONS,
    DIAG_ERROR_CLASSES: DIAG_ERROR_CLASSES,
    DIAG_VALIDATION_CATEGORIES: DIAG_VALIDATION_CATEGORIES,
    sanitizeDiagnostics: sanitizeDiagnostics,
    summarizeClassification: sanitizeClassify,
    encodeDiagnostics: encodeDiagnostics,
    parseDiagnostics: parseDiagnostics,
    summarizeValidation: summarizeValidation,
    classifyError: classifyError,
    SLOT_COUNT: SLOT_COUNT,
    CHUNK_SIZE: CHUNK_SIZE,
    CHUNK_PREFIX: CHUNK_PREFIX,
    META_PREFIX: META_PREFIX,
    SHEET_NAME: SHEET_NAME,
    parseMeta: parseMeta,
    nextSlot: nextSlot,
    plan: plan,
    readGrid: readGrid,
    bytesToHex: bytesToHex
  };
  return api;
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SnapshotStore;
}
