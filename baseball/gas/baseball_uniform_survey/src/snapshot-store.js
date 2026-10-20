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
