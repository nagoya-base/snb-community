/*
 * 名古屋野球ユニ部アンケート（design v2.17）：Admin 集計・publication 判定・privacy-safe snapshot 生成（Issue #382）。
 *
 * 設計方針
 *  - 副作用なし。Spreadsheet・時刻・乱数・storage・network に触れない（行オブジェクトと Date を引数で受け取る）。
 *  - 設問ID・option・分岐・公開閾値をここにベタ書きしない。すべて schema（question.publication が唯一の正本）と
 *    専用 survey-core（SurveyCore）を参照する。
 *  - denominator は schema の question_reached。targetCount は SurveyCore.countQuestionReached と同じ概念
 *    （その設問に実際に到達した有効回答者数）で、別概念を作らない。
 *  - public snapshot を作る処理（buildSnapshot）は、自由記述・「その他」本文・respondent_hash・詳細地域を入力として受け取らない。
 *    classifyRows が自由記述を valid record の answers から分離する。
 *
 * ES5記法。ブラウザ・Apps Script V8・Node.js のいずれでも動く。Node.js では module.exports でも公開する（tests用）。
 */
var SurveyAggregate = (function (core) {
  'use strict';

  var SNAPSHOT_VERSION = 1;
  var REGION_ID = 'region_blocks';
  /* publication.sensitiveBranch:true の設問が公開されるための最小 targetCount の下限（schema が緩んでも下回らせない）。 */
  var SENSITIVE_BRANCH_MIN_TARGET = 20;
  /* 回答件数表示：この件数未満は数値を出さない／以降は LIVE_COUNT_STEP 件単位で切り下げる（publicationPolicy.liveCount）。 */
  var LIVE_COUNT_MIN = 10;
  var LIVE_COUNT_STEP = 10;
  var DAY_MS = 24 * 60 * 60 * 1000;
  var PRODUCTION_STATUS = 'complete';

  /* snapshot の publish state */
  var STATE_PUBLISHED = 'published';
  var STATE_INSUFFICIENT = 'insufficient';
  var STATE_SENSITIVE_WITHHELD = 'sensitive_withheld';
  var STATE_SUPPRESSED_ALL = 'suppressed_all';

  /* public snapshot に絶対に出さないキー名（個票・system field・private 設問）。 */
  var FORBIDDEN_KEYS = [
    'respondent_hash', 'uuid', 'timestamp', 'source_channel', 'client_elapsed_ms', 'other_texts', 'free_text',
    'test_run_id', 'notification_status', 'response_mode', 'completion_status', 'answers', 'rows', 'records'
  ];

  function hasOwn(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }
  function isPlainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function contains(list, item) { return list.indexOf(item) !== -1; }
  function str(value) { return value === undefined || value === null ? '' : String(value); }

  /* ── 行 → 有効回答 ── */

  /* 保存形式 '|a|b|' の複数選択を ID 配列へ。空・不正は空配列。 */
  function decodeMultiple(cell) {
    if (Array.isArray(cell)) return cell.slice();
    var text = str(cell);
    if (text === '') return [];
    return text.split('|').filter(function (part) { return part !== ''; });
  }

  /* 行オブジェクト（列名 → セル値）から answers / other_texts を復元する。復元できない行は null。 */
  function rowToAnswers(schema, row) {
    var answers = {};
    core.getQuestions(schema).forEach(function (q) {
      var cell = hasOwn(row, q.id) ? row[q.id] : '';
      if (cell === '' || cell === undefined || cell === null) return;
      if (q.type === 'multiple') {
        var ids = decodeMultiple(cell);
        if (ids.length) answers[q.id] = ids;
      } else if (q.type === 'text') {
        answers[q.id] = str(cell);
      } else {
        answers[q.id] = str(cell);
      }
    });
    var others = {};
    var rawOthers = str(row.other_texts);
    if (rawOthers !== '') {
      try { others = JSON.parse(rawOthers); } catch (e) { return null; }
      if (!isPlainObject(others)) return null;
    }
    return { answers: answers, other_texts: others };
  }

  function emptyExcluded() {
    return {
      unknown_response_mode: 0, incomplete: 0, version_mismatch: 0, malformed: 0,
      ineligible: 0, schema_invalid: 0, missing_hash: 0, duplicate: 0
    };
  }

  /* ── version system field の比較 ── */

  var VERSION_FIELDS = ['survey_version', 'schema_version', 'design_version'];
  var SHEETS_EPOCH_OFFSET_DAYS = 25569; /* 1899-12-30 → 1970-01-01 の日数（Sheets の日付シリアル値の起点） */

  /*
   * 保存仕様では version は文字列。Sheets が "1" / "2.18" を数値へ自動変換した場合に限り、
   * 数値を文字列表現（String(n)）で比較して許容する。それ以外の型変換（真偽値・前後空白付き文字列など）は
   * 同一視しない（fail-closed）。
   * 例外（#422 Owner 判断）: survey_version だけは、schema 側が YYYY-MM で、actual が有限 number かつ
   * 期待月の月初の日付シリアル値と完全一致する場合に限り、Sheets が "2026-10" を日付化した既存行として一致扱いにする。
   * schema_version / design_version には広げない。
   */
  function isLegacyDateSerial(expected, actual, field) {
    if (field !== 'survey_version' || typeof actual !== 'number' || !isFinite(actual)) return false;
    var serial = monthStartSerial(expected);
    return serial !== null && actual === serial;
  }

  function versionMatches(expected, actual, field) {
    if (typeof actual === 'string') return actual === expected;
    if (typeof actual === 'number') return isFinite(actual) && (String(actual) === expected || isLegacyDateSerial(expected, actual, field));
    return false;
  }

  /* 文字列/数値の通常一致ではなく、月初日付シリアルの互換認識で一致した field か。 */
  function isLegacyAccepted(schema, row, field) {
    var expected = str(schema[field]);
    return isLegacyDateSerial(expected, row[field], field) && String(row[field]) !== expected;
  }

  /* 不一致の version field 名の配列（一致なら空）。classifyRows と diagnoseVersions が同じ判定を使う。 */
  function mismatchedVersionFields(schema, row) {
    return VERSION_FIELDS.filter(function (field) { return !versionMatches(str(schema[field]), row[field], field); });
  }

  /* classifyRows が version 比較へ進める行（production かつ complete）。診断も同じ条件で対象行を決める。 */
  function reachesVersionCheck(row) {
    return isPlainObject(row) && core.isProductionResponseMode(str(row.response_mode)) &&
      str(row.response_mode) !== 'test' && str(row.completion_status) === PRODUCTION_STATUS;
  }

  function emptyVersionFieldCounts() {
    var counts = {};
    VERSION_FIELDS.forEach(function (field) { counts[field] = 0; });
    return counts;
  }

  /* 'YYYY-MM' の月初を Sheets の日付シリアル値にしたもの。形式が違えば null。 */
  function monthStartSerial(text) {
    var m = /^(\d{4})-(\d{2})$/.exec(text);
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, 1) / 86400000 + SHEETS_EPOCH_OFFSET_DAYS;
  }

  /* API が返した値の型と、値そのものを出さない安全な分類。 */
  function describeVersionValue(expected, actual) {
    if (actual === undefined || actual === null || actual === '') return { api_type: 'empty', shape: 'empty' };
    if (typeof actual === 'string') {
      return { api_type: 'string', shape: actual.trim() === expected ? 'string_whitespace_variant' : 'string_other' };
    }
    if (typeof actual === 'number') {
      var serial = monthStartSerial(expected);
      var shape;
      if (!isFinite(actual)) shape = 'number_other';
      else if (serial !== null && actual === serial) shape = 'date_serial_of_expected_month';
      else if (Math.floor(actual) === actual && actual >= 36526 && actual <= 73050) shape = 'date_serial_other';
      else shape = 'number_other';
      return { api_type: 'number', shape: shape };
    }
    return { api_type: typeof actual === 'boolean' ? 'boolean' : 'other', shape: typeof actual === 'boolean' ? 'boolean' : 'other' };
  }

  /*
   * version_mismatch の原因診断。行ごとの値・回答本文・hash・timestamp は返さない（件数と型の分類だけ）。
   *   rows: Sheets API（UNFORMATTED_VALUE）が返した値の行オブジェクト
   *   displayRows: 同じ行の表示値（FORMATTED_VALUE）の行オブジェクト（任意。行の並びは rows と同じ）
   * display_matches_expected が true なのに mismatch なら、画面表示ではなく API が返した型・値が原因（Sheets の自動型変換）。
   */
  function diagnoseVersions(schema, rows, displayRows) {
    var list = Array.isArray(rows) ? rows : [];
    var display = Array.isArray(displayRows) ? displayRows : null;
    var expected = {};
    VERSION_FIELDS.forEach(function (field) { expected[field] = str(schema[field]); });
    var result = {
      expected: expected,
      rows_checked: 0,
      mismatch_rows: 0,
      mismatch_by_field: emptyVersionFieldCounts(),
      legacy_date_serial_accepted_rows: 0,
      display_equal_api_differs_rows: display ? 0 : null,
      observed: {}
    };
    VERSION_FIELDS.forEach(function (field) { result.observed[field] = []; });
    var groups = {};

    list.forEach(function (row, index) {
      if (!reachesVersionCheck(row)) return;
      result.rows_checked++;
      var fields = mismatchedVersionFields(schema, row);
      if (!fields.length) {
        if (isLegacyAccepted(schema, row, 'survey_version')) result.legacy_date_serial_accepted_rows++;
        return;
      }
      result.mismatch_rows++;
      var displayEqual = false;
      fields.forEach(function (field) {
        result.mismatch_by_field[field]++;
        var shown = null;
        if (display) {
          var shownRow = isPlainObject(display[index]) ? display[index] : {};
          shown = str(shownRow[field]) === expected[field];
          if (shown) displayEqual = true;
        }
        var described = describeVersionValue(expected[field], row[field]);
        var key = [field, described.api_type, described.shape, String(shown)].join('|');
        if (!hasOwn(groups, key)) {
          groups[key] = { api_type: described.api_type, shape: described.shape, display_matches_expected: shown, count: 0 };
          result.observed[field].push(groups[key]);
        }
        groups[key].count++;
      });
      if (display && displayEqual) result.display_equal_api_differs_rows++;
    });
    return result;
  }

  /*
   * 行を production 有効回答とそれ以外に分ける。
   *   response_mode = test               → test_excluded（通常集計に入れない）
   *   response_mode が production 以外   → unknown_response_mode（fail-closed）
   *   completion_status != complete      → incomplete
   *   survey/schema/design version 不一致 → version_mismatch
   *   18歳未満（termination）・schema 検証失敗・hash 欠損・hash 重複 → 除外
   * valid の各 record: {answers（text 設問を除く）, other_texts, free_text, respondent_hash}。
   * respondent_hash は重複除去のためだけに使い、public へは出さない。
   */
  function classifyRows(schema, rows) {
    var counts = { rows: 0, production_valid: 0, test_excluded: 0, excluded: emptyExcluded(), version_mismatch_fields: emptyVersionFieldCounts(), legacy_date_serial_accepted: 0 };
    var valid = [];
    var seen = {};
    var textIds = core.getQuestions(schema).filter(function (q) { return q.type === 'text'; }).map(function (q) { return q.id; });

    (Array.isArray(rows) ? rows : []).forEach(function (row) {
      counts.rows++;
      if (!isPlainObject(row)) { counts.excluded.malformed++; return; }
      var mode = str(row.response_mode);
      if (mode === 'test') { counts.test_excluded++; return; }
      if (!core.isProductionResponseMode(mode)) { counts.excluded.unknown_response_mode++; return; }
      if (str(row.completion_status) !== PRODUCTION_STATUS) { counts.excluded.incomplete++; return; }
      var mismatched = mismatchedVersionFields(schema, row);
      if (mismatched.length) {
        counts.excluded.version_mismatch++;
        mismatched.forEach(function (field) { counts.version_mismatch_fields[field]++; });
        return;
      }
      if (isLegacyAccepted(schema, row, 'survey_version')) counts.legacy_date_serial_accepted++;
      var parsed = rowToAnswers(schema, row);
      if (!parsed) { counts.excluded.malformed++; return; }
      if (core.findTermination(schema, parsed.answers)) { counts.excluded.ineligible++; return; }
      var validation = core.validateAnswers(schema, parsed.answers, parsed.other_texts);
      if (!validation.ok) { counts.excluded.schema_invalid++; return; }
      var hash = str(row.respondent_hash);
      if (hash === '') { counts.excluded.missing_hash++; return; }
      if (hasOwn(seen, hash)) { counts.excluded.duplicate++; return; }
      seen[hash] = true;

      var answers = {};
      var freeText = {};
      Object.keys(validation.clean.answers).forEach(function (id) {
        if (contains(textIds, id)) freeText[id] = validation.clean.answers[id];
        else answers[id] = validation.clean.answers[id];
      });
      valid.push({ answers: answers, other_texts: validation.clean.other_texts, free_text: freeText, respondent_hash: hash });
      counts.production_valid++;
    });
    return { valid: valid, counts: counts };
  }

  /* ── 設問ごとの集計（exact。Admin 用。public へは suppress を通す） ── */

  /* セルの定義（schema 順）。single_dynamic は source 設問の option から excludeOptionIds を除いたもの（other は ID 'other' のまま）。 */
  function cellDefinitions(schema, question) {
    var defs = [];
    if (question.type === 'scale') {
      var scale = core.getScale(schema, question.id);
      if (!scale) return defs;
      scale.points.forEach(function (p) { defs.push({ id: p.id, label: p.label, independent: false }); });
      if (scale.notApplicable) defs.push({ id: scale.notApplicable.id, label: scale.notApplicable.label, independent: true });
      return defs;
    }
    var source = question;
    var excluded = [];
    if (question.type === 'single_dynamic') {
      source = core.getQuestion(schema, question.sourceQuestion) || { options: [] };
      excluded = Array.isArray(question.excludeOptionIds) ? question.excludeOptionIds : [];
    }
    core.getOptions(schema, source).forEach(function (o) {
      if (!contains(excluded, o.id)) defs.push({ id: o.id, label: o.label, independent: false });
    });
    return defs;
  }

  function isSingleValued(question) {
    return question.type === 'single' || question.type === 'single_dynamic' || question.type === 'scale';
  }

  /* 設問に到達した回答者の answers を集める。visibility は core の評価（countQuestionReached と同一）。 */
  function reachedAnswers(schema, questionId, answersList) {
    var out = [];
    answersList.forEach(function (answers) {
      if (core.isVisible(schema, questionId, answers)) out.push(answers);
    });
    return out;
  }

  /*
   * 設問の exact な集計表。targetCount = その設問に到達した有効回答者数（question_reached）。
   * answeredCount は到達者のうち回答が option に該当した人数。
   */
  function tallyQuestion(schema, question, answersList) {
    var reached = reachedAnswers(schema, question.id, answersList);
    var defs = cellDefinitions(schema, question);
    var counts = {};
    defs.forEach(function (d) { counts[d.id] = 0; });
    var answered = 0;
    reached.forEach(function (answers) {
      var picked = core.selectedIds(question, answers[question.id]).filter(function (id) { return hasOwn(counts, id); });
      if (picked.length) answered++;
      picked.forEach(function (id) { counts[id]++; });
    });
    return { targetCount: reached.length, answeredCount: answered, defs: defs, counts: counts };
  }

  /* 詳細都道府県 → 地方ブロックの対応（publicRegionAggregation）。 */
  function regionConfig(schema) {
    var cfg = schema && schema.publicRegionAggregation;
    return isPlainObject(cfg) && cfg.enabled === true ? cfg : null;
  }

  /* 地方ブロックの exact な集計表。詳細都道府県は戻り値に含めない。 */
  function tallyRegion(schema, answersList) {
    var cfg = regionConfig(schema);
    if (!cfg) return null;
    var excluded = Array.isArray(cfg.excludeOptionIds) ? cfg.excludeOptionIds : [];
    var blockOf = {};
    cfg.blocks.forEach(function (b) { b.prefectureOptionIds.forEach(function (id) { blockOf[id] = b.id; }); });
    var defs = cfg.blocks.map(function (b) { return { id: b.id, label: b.label, independent: false }; });
    var counts = {};
    defs.forEach(function (d) { counts[d.id] = 0; });
    var target = 0;
    answersList.forEach(function (answers) {
      if (!core.isVisible(schema, cfg.sourceQuestion, answers)) return;
      var picked = core.selectedIds(core.getQuestion(schema, cfg.sourceQuestion), answers[cfg.sourceQuestion])[0];
      if (!picked || contains(excluded, picked) || !hasOwn(blockOf, picked)) return;
      counts[blockOf[picked]]++;
      target++;
    });
    return { targetCount: target, answeredCount: target, defs: defs, counts: counts };
  }

  /* ── publication 判定 ── */

  /* 公開判定に使う閾値。schema の publication を正本とし、下限（minCell・sensitive branch の minTarget）だけ補強する。 */
  function effectiveThresholds(schema, publication) {
    var policy = schema && schema.publicationPolicy && schema.publicationPolicy.cellPrivacy;
    var minCellFloor = policy && typeof policy.defaultMinCell === 'number' ? policy.defaultMinCell : 1;
    var minTarget = Number(publication.minTarget);
    if (publication.sensitiveBranch === true) minTarget = Math.max(minTarget, SENSITIVE_BRANCH_MIN_TARGET);
    return {
      minTotal: Number(publication.minTotal),
      minTarget: minTarget,
      minCell: Math.max(Number(publication.minCell), minCellFloor)
    };
  }

  /*
   * 公開状態（セル抑止前）。
   *   production valid total < minTotal または targetCount < minTarget → 非公開
   *   （sensitiveBranch は sensitive_withheld。公開対象に達しないまま調査が終わっても仕様違反ではない）
   * visibility が public / public_derived 以外は常に非公開（null）。
   */
  function evaluatePublication(schema, publication, productionTotal, targetCount) {
    if (!isPlainObject(publication) || (publication.visibility !== 'public' && publication.visibility !== 'public_derived')) {
      return { state: null, thresholds: null, totalMet: false, targetMet: false };
    }
    var t = effectiveThresholds(schema, publication);
    var totalMet = productionTotal >= t.minTotal;
    var targetMet = targetCount >= t.minTarget;
    var state = STATE_PUBLISHED;
    if (!totalMet || !targetMet) state = publication.sensitiveBranch === true ? STATE_SENSITIVE_WITHHELD : STATE_INSUFFICIENT;
    return { state: state, thresholds: t, totalMet: totalMet, targetMet: targetMet };
  }

  /* ── small-cell / complementary suppression ── */

  /*
   * complementary suppression の計画（partition 用）。
   *  - 小セル（0 < count < minCell）を隠す。小セルがあれば、さらに「最小の公開セル」をちょうど 1 つ隠す
   *    （同数なら schema の後ろ）。件数はデータに依らない固定規則なので、公開された出力から攻撃者が逆算に使える。
   *  - そのうえで、公開された出力（公開セル・隠した合計 S・隠しうるセルの位置）と整合する「元の件数」が、
   *    どの隠しセルについても 2 通り以上あることを確認する（ambiguityHolds）。確認できなければ ok:false。
   *    合計だけでは足りない（minCell=3 で小セルが 2・2 なら、合計 4 から 2+2 に確定する）。
   * 返り値: {hiddenIds, ok}。小セルが無ければ何も隠さず ok:true。
   */
  function planPartitionHiding(defs, counts, minCell, ordered) {
    var hiddenIds = {};
    var smallSum = 0;
    var smalls = 0;
    defs.forEach(function (d) {
      var c = counts[d.id];
      if (c > 0 && c < minCell) { hiddenIds[d.id] = true; smallSum += c; smalls++; }
    });
    if (smalls === 0) return { hiddenIds: hiddenIds, ok: true };

    var extra = null;
    defs.forEach(function (d, index) {
      var c = counts[d.id];
      if (c <= 0 || hasOwn(hiddenIds, d.id)) return;
      if (!extra || c < extra.count || (c === extra.count && index > extra.index)) extra = { id: d.id, count: c, index: index };
    });
    if (!extra) return { hiddenIds: hiddenIds, ok: false };
    hiddenIds[extra.id] = true;

    var vmin = null;
    var maxTiedIndex = -1;
    defs.forEach(function (d, index) {
      var c = counts[d.id];
      if (c <= 0 || hasOwn(hiddenIds, d.id)) return;
      if (vmin === null || c < vmin) { vmin = c; maxTiedIndex = index; } else if (c === vmin) maxTiedIndex = index;
    });
    if (vmin === null) return { hiddenIds: hiddenIds, ok: false }; // 公開できるセルが残らない
    // 攻撃者から見て値が分からないセル（ordinal は隠した位置だけ。nominal は公開セル以外すべて＝ゼロ・隠したセルを区別できない）。
    var unknown = [];
    defs.forEach(function (d, index) {
      var isVisible = counts[d.id] > 0 && !hasOwn(hiddenIds, d.id);
      if (ordered ? hasOwn(hiddenIds, d.id) : !isVisible) unknown.push(index);
    });
    var sum = smallSum + extra.count;
    return { hiddenIds: hiddenIds, ok: ambiguityHolds(unknown, sum, minCell, vmin, maxTiedIndex, ordered) };
  }

  /*
   * 公開出力と整合する元の件数（世界）を、隠したセルごとに数え上げずに区間で判定する。
   * 整合する世界 = 未知セル unknown の値で、合計が sum、ちょうど 1 セルが「追加で隠した最小の公開セル」（minCell 以上
   * vmin 未満。vmin と同数なら schema の後ろのセルだけ許される）、残りが小セル（ordinal は 1..minCell-1、nominal は 0..minCell-1 で
   * 少なくとも 1 つは小セル）。どの未知セルについても取りうる値が 2 通り以上あれば、小セルの元値は一意に確定しない。
   */
  function ambiguityHolds(unknown, sum, minCell, vmin, maxTiedIndex, ordered) {
    var n = unknown.length - 1;
    var lo0 = ordered ? 1 : 0;
    var smallMax = minCell - 1;
    for (var u = 0; u < unknown.length; u++) {
      var cell = unknown[u];
      var feasible = 0;
      // i が追加で隠したセルの場合
      var upperSelf = cell > maxTiedIndex ? vmin : vmin - 1;
      if (n >= 1) {
        var loA = Math.max(n * lo0, 1);
        var hiA = n * smallMax;
        for (var x = minCell; x <= upperSelf && feasible < 2; x++) if (sum - x >= loA && sum - x <= hiA) feasible++;
      }
      // i が小セル（または nominal のゼロ）の場合：追加で隠したセルは別の未知セル j
      var hasLater = unknown.some(function (j) { return j !== cell && j > maxTiedIndex; });
      var upperExtra = hasLater ? vmin : vmin - 1;
      if (n >= 1 && upperExtra >= minCell) {
        for (var y = lo0; y <= smallMax && feasible < 2; y++) {
          var loB = minCell + (n - 1) * lo0 + (!ordered && y === 0 ? 1 : 0);
          var hiB = upperExtra + (n - 1) * smallMax;
          if (!ordered && y === 0 && n - 1 < 1) continue; // 小セルが 1 つも無くなる
          if (sum - y >= loB && sum - y <= hiB) feasible++;
        }
      }
      if (feasible < 2) return false;
    }
    return true;
  }

  /*
   * セルの抑止。
   *  1. 0 < count < minCell のセルは値を出さない（small-cell suppression）。
   *  2. partition（単一選択・scale・地域）では targetCount と他セルから隠したセルが逆算できてしまうため、
   *     planPartitionHiding で最小の公開セルも 1 つ隠し、隠したセルの元値が一意に決まらないことを確認する。
   *     確認できなければ何も公開しない（visibleNonzero:0 → suppressed_all）。
   *     多選択はセルの合計が targetCount と一致しないため補完は不要。
   * ordered:true（ordinal）は目盛りを保つため、隠したセルも位置だけ残し count:null で返す。
   * ordered:false（nominal）は隠したセル・ゼロセルを出力から除く（隠したのかゼロなのかも区別させない）。
   * showZeroCells が true のときだけゼロを 0 として出す。
   * 返り値: {cells, hidden（値を出さなかった非ゼロセル数）, visibleNonzero}
   */
  function suppressCells(defs, counts, options) {
    var minCell = options.minCell;
    var hiddenIds = {};
    if (options.partition) {
      var plan = planPartitionHiding(defs, counts, minCell, options.ordered);
      if (!plan.ok) return { cells: [], hidden: Object.keys(plan.hiddenIds).length, visibleNonzero: 0 };
      hiddenIds = plan.hiddenIds;
    } else {
      defs.forEach(function (d) { var c = counts[d.id]; if (c > 0 && c < minCell) hiddenIds[d.id] = true; });
    }
    var hiddenCount = Object.keys(hiddenIds).length;

    var visibleNonzero = 0;
    defs.forEach(function (d) { if (counts[d.id] > 0 && !hasOwn(hiddenIds, d.id)) visibleNonzero++; });

    var cells = [];
    defs.forEach(function (d) {
      var c = counts[d.id];
      var cell = { id: d.id, label: d.label };
      if (d.independent) cell.independent = true;
      if (hasOwn(hiddenIds, d.id)) {
        if (!options.ordered) return;
        cell.count = null;
        cell.suppressed = true;
      } else if (c === 0) {
        if (!options.showZeroCells) return;
        cell.count = 0;
      } else {
        cell.count = c;
      }
      cells.push(cell);
    });
    return { cells: cells, hidden: hiddenCount, visibleNonzero: visibleNonzero };
  }

  /* nominal の並び：publication.sort が count_desc なら件数降順（同数は schema の並び＝tieBreak）。それ以外は schema 順。 */
  function sortNominal(defs, counts, publication) {
    var indexed = defs.map(function (d, index) { return { def: d, index: index }; });
    if (publication.sort === 'count_desc') {
      indexed.sort(function (a, b) {
        var diff = counts[b.def.id] - counts[a.def.id];
        return diff !== 0 ? diff : a.index - b.index;
      });
    }
    return indexed.map(function (x) { return x.def; });
  }

  /* ordinal の並び：schema 順（scale は min..max、尺度外の独立値は末尾）。ordinal に sort があっても無視する。 */
  function orderOrdinal(schema, question, defs) {
    var order = core.ordinalOrder(schema, question.id);
    if (!order) return defs.slice();
    var ids = order.orderedIds.concat(order.independentIds);
    var byId = {};
    defs.forEach(function (d) { byId[d.id] = d; });
    var out = [];
    ids.forEach(function (id) { if (hasOwn(byId, id)) out.push(byId[id]); });
    defs.forEach(function (d) { if (!contains(ids, d.id)) out.push(d); }); // schema にない並びは末尾（落とさない）
    return out;
  }

  /*
   * 地域ブロックの公開用セル。小さいブロックは「その他の地域」へまとめる。
   * 単一選択と同じ planPartitionHiding を使い、まとめた先（小ブロック + 最小の公開ブロック 1 つ）が
   * 一意に逆算できないことを確認する。確認できない・公開ブロックが残らない場合は suppressed_all。
   */
  function regionCells(schema, table, publication, thresholds) {
    var cfg = regionConfig(schema);
    var plan = planPartitionHiding(table.defs, table.counts, thresholds.minCell, false);
    var mergedSum = 0;
    var mergedBlocks = 0;
    var named = [];
    table.defs.forEach(function (d, index) {
      var c = table.counts[d.id];
      if (c <= 0) return;
      if (hasOwn(plan.hiddenIds, d.id)) { mergedSum += c; mergedBlocks++; } else named.push({ def: d, count: c, index: index });
    });
    if (!plan.ok || named.length === 0) return { cells: [], hasSuppressed: mergedBlocks > 0 };
    if (publication.sort === 'count_desc') {
      named.sort(function (a, b) { return b.count !== a.count ? b.count - a.count : a.index - b.index; });
    }
    var cells = named.map(function (n) { return { id: n.def.id, label: n.def.label, count: n.count }; });
    if (mergedBlocks > 0) {
      cells.push({ id: 'other_regions', label: cfg.privacy && cfg.privacy.mergedLabel ? cfg.privacy.mergedLabel : 'その他の地域', count: mergedSum, merged: true });
    }
    return { cells: cells, hasSuppressed: mergedBlocks > 0 };
  }

  /* ── 回答件数表示 ── */

  /* 10 件未満は数値を出さず「回答受付中」。10 件以上は 10 件単位に切り下げる（正確な件数は出さない）。 */
  function liveCountDisplay(schema, productionTotal) {
    var live = schema && schema.publicationPolicy && schema.publicationPolicy.liveCount;
    var collectingLabel = live && typeof live.under10 === 'string' ? live.under10 : '回答受付中';
    var total = Math.max(0, Math.floor(Number(productionTotal) || 0));
    if (total < LIVE_COUNT_MIN) return { state: 'collecting', floor: null, label: collectingLabel };
    var floor = Math.floor(total / LIVE_COUNT_STEP) * LIVE_COUNT_STEP;
    return { state: 'counting', floor: floor, label: floor + '件以上' };
  }

  /* ── snapshot ── */

  /* 公開結果の layer（publicationPolicy.ui.sections の selector.tier）。tier が合わなければ survey_results。 */
  function sectionFor(schema, tier) {
    var sections = schema && schema.publicationPolicy && schema.publicationPolicy.ui && schema.publicationPolicy.ui.sections;
    var fallback = 'survey_results';
    if (!Array.isArray(sections)) return fallback;
    var found = fallback;
    sections.forEach(function (s) {
      if (s && s.selector && typeof s.selector.tier === 'string' && typeof tier === 'string' && contains(s.selector.tier.split('_or_'), tier)) found = s.id;
    });
    return found;
  }

  /* 公開対象の { id, label, kind, publication }（publicResultsOrder の順）。順序の不整合は例外にする。 */
  function publicEntries(schema) {
    var order = schema.publicResultsOrder;
    if (!Array.isArray(order)) throw new Error('publicResultsOrder がありません');
    var cfg = regionConfig(schema);
    var entries = [];
    var seen = {};
    order.forEach(function (id) {
      if (hasOwn(seen, id)) throw new Error('publicResultsOrder に重複があります: ' + id);
      seen[id] = true;
      if (id === REGION_ID) {
        if (!cfg) throw new Error('publicResultsOrder に region_blocks がありますが publicRegionAggregation が無効です');
        entries.push({ id: id, label: cfg.publicLabel, kind: 'region', publication: cfg.publication });
        return;
      }
      var q = core.getQuestion(schema, id);
      if (!q) throw new Error('publicResultsOrder に存在しない設問があります: ' + id);
      if (!core.isPublic(schema, id)) throw new Error('publicResultsOrder に非公開設問があります: ' + id);
      entries.push({ id: id, label: q.label, kind: 'question', question: q, publication: q.publication });
    });
    core.publicQuestionIds(schema).forEach(function (id) {
      if (!hasOwn(seen, id)) throw new Error('publicResultsOrder にない公開設問があります: ' + id);
    });
    return entries;
  }

  function entryTable(schema, entry, answersList) {
    return entry.kind === 'region' ? tallyRegion(schema, answersList) : tallyQuestion(schema, entry.question, answersList);
  }

  /* 公開 entry を 1 件作る。非公開（collecting 等）のときは targetCount・値を一切含めない。 */
  function buildPublicEntry(schema, entry, answersList, productionTotal) {
    var table = entryTable(schema, entry, answersList);
    var pub = entry.publication;
    var evaluation = evaluatePublication(schema, pub, productionTotal, table.targetCount);
    var ordinal = entry.kind === 'question' && pub.ordinal === true;
    var out = {
      id: entry.id,
      label: entry.label,
      section: sectionFor(schema, pub.tier),
      tier: pub.tier,
      type: entry.kind === 'region' ? 'region' : entry.question.type,
      ordinal: ordinal,
      state: evaluation.state,
      targetCount: null,
      cells: [],
      hasSuppressedCells: false
    };
    if (evaluation.state !== STATE_PUBLISHED) return out;

    var t = evaluation.thresholds;
    var shaped;
    if (entry.kind === 'region') {
      var region = regionCells(schema, table, pub, t);
      shaped = { cells: region.cells, hidden: region.hasSuppressed ? 1 : 0, visibleNonzero: region.cells.length };
    } else {
      var defs = ordinal ? orderOrdinal(schema, entry.question, table.defs) : sortNominal(table.defs, table.counts, pub);
      shaped = suppressCells(defs, table.counts, {
        minCell: t.minCell,
        partition: isSingleValued(entry.question),
        ordered: ordinal,
        showZeroCells: pub.showZeroCells === true
      });
    }
    if (shaped.visibleNonzero === 0) {
      // 値を出せるセルが無い（全セルが少数）。targetCount も出さない。
      out.state = STATE_SUPPRESSED_ALL;
      out.hasSuppressedCells = true;
      return out;
    }
    out.targetCount = table.targetCount;
    out.cells = shaped.cells;
    out.hasSuppressedCells = shaped.hidden > 0;
    return out;
  }

  function isoTime(value) {
    var date = value instanceof Date ? value : new Date(value);
    if (isNaN(date.getTime())) throw new Error('generated_at が不正です');
    return date.toISOString();
  }

  /*
   * privacy-safe snapshot。入力は valid record（classifyRows の valid）。
   * 参照するのは record.answers だけで、other_texts / free_text / respondent_hash は読まない。
   */
  function buildSnapshot(schema, validRecords, options) {
    var settings = options || {};
    var records = Array.isArray(validRecords) ? validRecords : [];
    var answersList = records.map(function (r) { return r.answers; });
    var total = answersList.length;
    var live = liveCountDisplay(schema, total);
    var cfg = regionConfig(schema);
    if (cfg && cfg.privacy && (cfg.privacy.publishPrefectureDetail !== false || cfg.privacy.publishAichiAreaDetail !== false)) {
      throw new Error('詳細都道府県・愛知県内地域は公開できません（publicRegionAggregation.privacy）');
    }
    var ui = schema.publicationPolicy && schema.publicationPolicy.ui ? schema.publicationPolicy.ui : {};
    return {
      snapshot_version: SNAPSHOT_VERSION,
      survey_id: schema.survey_id,
      survey_version: schema.survey_version,
      schema_version: schema.schema_version,
      design_version: schema.design_version,
      generated_at: isoTime(settings.generatedAt || new Date()),
      response_status: { state: live.state, label: live.label },
      production_valid_total: live.floor,
      representativeness_notice: typeof ui.representativenessNotice === 'string' ? ui.representativenessNotice : '',
      sections: Array.isArray(ui.sections) ? ui.sections.map(function (s) { return { id: s.id, label: s.label }; }) : [],
      questions: publicEntries(schema).map(function (entry) { return buildPublicEntry(schema, entry, answersList, total); })
    };
  }

  /* ── snapshot の更新判定（batch のみ。submit ごとには更新しない） ── */

  function snapshotPolicy(schema) {
    var update = schema && schema.publicationPolicy && schema.publicationPolicy.snapshotUpdate;
    var minCells = [];
    publicEntries(schema).forEach(function (e) { minCells.push(effectiveThresholds(schema, e.publication).minCell); });
    var minCell = minCells.length ? Math.max.apply(null, minCells) : 1;
    var minimumBatch = update && typeof update.minimumBatchIncrement === 'number' ? update.minimumBatchIncrement : 1;
    var countTrigger = update && typeof update.countTriggerIncrement === 'number' ? update.countTriggerIncrement : minimumBatch;
    return {
      mode: update && update.mode ? update.mode : 'batch_only',
      perResponseUpdate: false,
      // 差分から 1 件の回答が復元されないよう、どの更新でも増分は minCell 以上・minimumBatchIncrement 以上にする。
      minimumIncrement: Math.max(minimumBatch, minCell),
      countTriggerIncrement: Math.max(countTrigger, minimumBatch, minCell),
      intervalMs: DAY_MS
    };
  }

  /*
   * 新しい snapshot を公開（切替）してよいか。
   *   previous: {generated_at, production_valid_total（exact。運営側の記録）} または null（初回）
   *   current : 現在の production valid total（exact）
   * 1 日 1 回（intervalMs 経過）か、件数増分が countTriggerIncrement 以上のときだけ true。
   * どちらも増分が minimumIncrement（minCell 以上）に満たなければ更新しない。
   */
  function decideSnapshotUpdate(schema, previous, currentTotal, now) {
    var policy = snapshotPolicy(schema);
    var current = Math.max(0, Math.floor(Number(currentTotal) || 0));
    if (!previous || !previous.generated_at) return { update: true, reason: 'initial', increment: current, policy: policy };
    var prevTime = new Date(previous.generated_at).getTime();
    var nowTime = (now instanceof Date ? now : new Date(now)).getTime();
    if (isNaN(prevTime) || isNaN(nowTime)) return { update: true, reason: 'invalid_previous', increment: current, policy: policy };
    var increment = current - Math.max(0, Math.floor(Number(previous.production_valid_total) || 0));
    if (increment < policy.minimumIncrement) return { update: false, reason: 'insufficient_increment', increment: increment, policy: policy };
    if (nowTime - prevTime >= policy.intervalMs) return { update: true, reason: 'daily', increment: increment, policy: policy };
    if (increment >= policy.countTriggerIncrement) return { update: true, reason: 'count_increment', increment: increment, policy: policy };
    return { update: false, reason: 'not_due', increment: increment, policy: policy };
  }

  /* ── snapshot の検証（schema drift・privacy・suppression の不変条件） ── */

  function walkStrings(value, visit, keyVisit) {
    if (Array.isArray(value)) { value.forEach(function (v) { walkStrings(v, visit, keyVisit); }); return; }
    if (isPlainObject(value)) {
      Object.keys(value).forEach(function (k) { keyVisit(k); walkStrings(value[k], visit, keyVisit); });
      return;
    }
    if (typeof value === 'string') visit(value);
  }

  var HASH_LIKE = /^[0-9a-f]{32,}$/i;
  var UUID_LIKE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  /*
   * snapshot が schema と整合し、private 情報を含まず、小セルを逆算できないことを検査する。
   * 返り値: 問題の文字列配列（空なら OK）。
   */
  function validateSnapshot(schema, snapshot) {
    var problems = [];
    function bad(message) { problems.push(message); }
    if (!isPlainObject(snapshot)) return ['snapshot が object ではありません'];
    if (snapshot.snapshot_version !== SNAPSHOT_VERSION) bad('snapshot_version が不正です');
    ['survey_id', 'survey_version', 'schema_version', 'design_version'].forEach(function (k) {
      if (snapshot[k] !== schema[k]) bad(k + ' が schema と一致しません（schema drift）');
    });
    if (isNaN(new Date(snapshot.generated_at).getTime())) bad('generated_at が不正です');
    if (!isPlainObject(snapshot.response_status)) bad('response_status がありません');
    var total = snapshot.production_valid_total;
    if (total !== null && (typeof total !== 'number' || total < LIVE_COUNT_MIN || total % LIVE_COUNT_STEP !== 0)) {
      bad('production_valid_total は null か 10 件単位の切り下げ値でなければなりません');
    }
    if (isPlainObject(snapshot.response_status)) {
      if (total === null && snapshot.response_status.state !== 'collecting') bad('10件未満は collecting でなければなりません');
      if (total !== null && snapshot.response_status.state !== 'counting') bad('10件以上は counting でなければなりません');
    }

    var privateIds = core.questionIds(schema).filter(function (id) { return !core.isPublic(schema, id); });
    var prefectureIds = [];
    var cfg = regionConfig(schema);
    if (cfg) cfg.blocks.forEach(function (b) { prefectureIds = prefectureIds.concat(b.prefectureOptionIds); });
    walkStrings(snapshot, function (text) {
      if (HASH_LIKE.test(text) || UUID_LIKE.test(text)) bad('hash / UUID らしき値があります');
      if (contains(prefectureIds, text)) bad('詳細都道府県の ID があります: ' + text);
      if (contains(privateIds, text)) bad('非公開設問の ID があります: ' + text);
    }, function (key) {
      if (contains(FORBIDDEN_KEYS, key)) bad('公開してはいけないキーがあります: ' + key);
      if (contains(privateIds, key)) bad('非公開設問のキーがあります: ' + key);
    });

    var expected = [];
    try { expected = publicEntries(schema); } catch (e) { bad(String(e.message || e)); }
    var expectedIds = expected.map(function (e) { return e.id; });
    var actualIds = Array.isArray(snapshot.questions) ? snapshot.questions.map(function (q) { return q && q.id; }) : [];
    if (JSON.stringify(expectedIds) !== JSON.stringify(actualIds)) bad('questions の順序が publicResultsOrder と一致しません');

    var byId = {};
    expected.forEach(function (e) { byId[e.id] = e; });
    (Array.isArray(snapshot.questions) ? snapshot.questions : []).forEach(function (q) {
      var entry = q && byId[q.id];
      if (!entry) return;
      var evaluation = evaluatePublication(schema, entry.publication, 0, 0);
      var t = evaluation.thresholds;
      var tag = q.id + ': ';
      if (q.state !== STATE_PUBLISHED) {
        if (!contains([STATE_INSUFFICIENT, STATE_SENSITIVE_WITHHELD, STATE_SUPPRESSED_ALL], q.state)) bad(tag + 'state が不正です');
        if (entry.publication.sensitiveBranch !== true && q.state === STATE_SENSITIVE_WITHHELD) bad(tag + 'sensitive 以外が sensitive_withheld です');
        if (q.targetCount !== null || !Array.isArray(q.cells) || q.cells.length) bad(tag + '非公開の項目に件数・値があります');
        return;
      }
      if (!t || typeof q.targetCount !== 'number' || q.targetCount < t.minTarget) bad(tag + 'targetCount が minTarget 未満です');
      if (!Array.isArray(q.cells) || q.cells.length === 0) { bad(tag + 'cells がありません'); return; }
      var visibleSum = 0;
      var placeholders = 0;
      q.cells.forEach(function (c) {
        if (c.count === null) {
          if (c.suppressed !== true) bad(tag + 'count:null は suppressed:true が必要です');
          placeholders++;
          return;
        }
        if (typeof c.count !== 'number') { bad(tag + 'count が数値ではありません'); return; }
        visibleSum += c.count;
        if (c.count > 0 && t && c.count < t.minCell) bad(tag + 'minCell 未満の値が公開されています');
        if (c.count === 0 && entry.publication.showZeroCells !== true) bad(tag + 'showZeroCells=false なのにゼロが公開されています');
      });
      // 隠した分（targetCount − 公開セルの合計）。単一セルとして逆算できてはならない。
      var partition = entry.kind === 'region' || (entry.question && isSingleValued(entry.question));
      if (partition && t) {
        var hidden = q.targetCount - visibleSum;
        if (hidden < 0) bad(tag + '公開セルの合計が targetCount を超えています');
        if (hidden > 0 && hidden < t.minCell) bad(tag + '隠したセルの合計が minCell 未満で、小セルを逆算できます');
        if (entry.kind === 'question' && entry.publication.ordinal === true && hidden > 0 && placeholders < 2) {
          bad(tag + 'ordinal で隠したセルが 1 つだけで、小セルを逆算できます');
        }
      }
      // 公開出力だけから、隠したセルの元値が一意に決まらないこと（合計だけでなく取りうる世界の数で確認する）。
      if (partition && t) {
        var defsForCheck = entry.kind === 'region' ? tallyRegion(schema, []).defs : cellDefinitions(schema, entry.question);
        var ordered = entry.kind === 'question' && entry.publication.ordinal === true;
        var shownCount = {};
        q.cells.forEach(function (c) { if (typeof c.count === 'number' && c.count > 0) shownCount[c.id] = c.count; });
        var vmin = null;
        var maxTied = -1;
        var unknown = [];
        defsForCheck.forEach(function (d, index) {
          if (hasOwn(shownCount, d.id)) {
            if (vmin === null || shownCount[d.id] < vmin) { vmin = shownCount[d.id]; maxTied = index; } else if (shownCount[d.id] === vmin) maxTied = index;
          } else if (!ordered || q.cells.some(function (c) { return c.id === d.id && c.count === null; })) {
            unknown.push(index);
          }
        });
        var hiddenTotal = q.targetCount - visibleSum;
        if (hiddenTotal > 0 && (vmin === null || !ambiguityHolds(unknown, hiddenTotal, t.minCell, vmin, maxTied, ordered))) {
          bad(tag + '公開された出力から、隠した小セルの元値を一意に逆算できます');
        }
      }
      if (entry.kind === 'question' && entry.publication.ordinal !== true && entry.publication.sort === 'count_desc') {
        for (var i = 1; i < q.cells.length; i++) {
          if (q.cells[i].count > q.cells[i - 1].count) bad(tag + 'nominal が件数降順になっていません');
        }
      }
      if (entry.kind === 'question' && entry.publication.ordinal === true) {
        var order = core.ordinalOrder(schema, q.id);
        var actual = q.cells.map(function (c) { return c.id; });
        if (order) {
          var sorted = order.orderedIds.concat(order.independentIds).filter(function (id) { return contains(actual, id); });
          if (JSON.stringify(sorted) !== JSON.stringify(actual)) bad(tag + 'ordinal が schema の順序になっていません');
        }
      }
    });
    return problems;
  }

  /* ── semantic code 集計（Admin 分析用。public には出さない） ── */

  /*
   * 障壁（semanticCodes）と安心条件（reassuranceFor）を code ごとに回答者単位で数える。
   * 同一 respondent が同一 code に複数 option（primary / secondary を含む）から該当しても 1 人として数える。
   * 自由記述の自動分類はしない（選択済み option の code だけ）。
   */
  function analyzeSemanticCodes(schema, validRecords) {
    var answersList = (Array.isArray(validRecords) ? validRecords : []).map(function (r) { return r.answers; });
    var barrierCodes = isPlainObject(schema.barrierCodes) ? schema.barrierCodes : {};
    var sources = [];
    core.getQuestions(schema).forEach(function (q) {
      var options = core.getOptions(schema, q);
      var barrierOptions = options.filter(function (o) { return isPlainObject(o.semanticCodes); });
      var reassuranceOptions = options.filter(function (o) { return Array.isArray(o.reassuranceFor); });
      if (!barrierOptions.length && !reassuranceOptions.length) return;
      var role = barrierOptions.length ? 'barrier' : 'reassurance';
      var reached = reachedAnswers(schema, q.id, answersList);
      var perCode = {};
      reached.forEach(function (answers) {
        var seenCodes = {};
        core.selectedIds(q, answers[q.id]).forEach(function (id) {
          options.forEach(function (o) {
            if (o.id !== id) return;
            var codes = [];
            if (role === 'barrier') {
              if (isPlainObject(o.semanticCodes)) {
                codes.push(o.semanticCodes.primary);
                if (Array.isArray(o.semanticCodes.secondary)) codes = codes.concat(o.semanticCodes.secondary);
              }
            } else if (Array.isArray(o.reassuranceFor)) {
              codes = o.reassuranceFor;
            }
            codes.forEach(function (code) { if (typeof code === 'string' && code !== '') seenCodes[code] = true; });
          });
        });
        Object.keys(seenCodes).forEach(function (code) { perCode[code] = (perCode[code] || 0) + 1; });
      });
      sources.push({ questionId: q.id, role: role, targetCount: reached.length, codes: perCode });
    });

    var comparison = Object.keys(barrierCodes).map(function (code) {
      var barrier = {};
      var reassurance = {};
      var hasBarrierSource = false;
      var hasReassuranceSource = false;
      sources.forEach(function (s) {
        var n = hasOwn(s.codes, code) ? s.codes[code] : 0;
        if (s.role === 'barrier') { barrier[s.questionId] = n; hasBarrierSource = true; }
        else { reassurance[s.questionId] = n; hasReassuranceSource = true; }
      });
      // schema に、その code を安心条件として結びつけた option があるか（なければ「対応する安心条件が未設計」）。
      var covered = false;
      core.getQuestions(schema).forEach(function (q) {
        core.getOptions(schema, q).forEach(function (o) { if (Array.isArray(o.reassuranceFor) && contains(o.reassuranceFor, code)) covered = true; });
      });
      return {
        code: code,
        label: barrierCodes[code].label,
        barrier: hasBarrierSource ? barrier : {},
        reassurance: hasReassuranceSource ? reassurance : {},
        reassuranceDefined: covered
      };
    }).filter(function (row) {
      var any = false;
      Object.keys(row.barrier).forEach(function (k) { if (row.barrier[k] > 0) any = true; });
      Object.keys(row.reassurance).forEach(function (k) { if (row.reassurance[k] > 0) any = true; });
      return any || row.reassuranceDefined;
    });
    return { sources: sources, comparison: comparison };
  }

  /* ── Admin サマリー（exact。運営者のみ。個票・自由記述・hash を含まない） ── */

  function buildAdminSummary(schema, classification, options) {
    var settings = options || {};
    var valid = classification.valid;
    var answersList = valid.map(function (r) { return r.answers; });
    var total = valid.length;
    var questions = publicEntries(schema).map(function (entry) {
      var table = entryTable(schema, entry, answersList);
      var evaluation = evaluatePublication(schema, entry.publication, total, table.targetCount);
      var t = evaluation.thresholds;
      var publicEntry = buildPublicEntry(schema, entry, answersList, total);
      return {
        id: entry.id,
        label: entry.label,
        type: entry.kind === 'region' ? 'region' : entry.question.type,
        tier: entry.publication.tier,
        sensitiveBranch: entry.publication.sensitiveBranch === true,
        denominator: entry.kind === 'region' ? (schema.publicRegionAggregation.denominator || 'question_reached') : (core.denominatorOf(schema, entry.id) || 'question_reached'),
        targetCount: table.targetCount,
        answeredCount: table.answeredCount,
        thresholds: t,
        totalMet: evaluation.totalMet,
        targetMet: evaluation.targetMet,
        publicState: publicEntry.state,
        hasSuppressedCells: publicEntry.hasSuppressedCells,
        /* Admin 内部の exact な集計。公開閾値・suppression とは無関係に常に返す（公開側は publicPreview / buildPublicEntry を通る）。 */
        tally: table.defs.map(function (d) { return { id: d.id, label: d.label, count: table.counts[d.id] }; })
      };
    });
    /* 公開対象外（publicResultsOrder に無い）の non-text 設問。Admin 内部集計のみ。publication / snapshot には一切渡さない。 */
    var publicIds = {};
    publicEntries(schema).forEach(function (entry) { publicIds[entry.id] = true; });
    var internalQuestions = core.getQuestions(schema).filter(function (q) {
      return q.type !== 'text' && !hasOwn(publicIds, q.id);
    }).map(function (q) {
      var table = tallyQuestion(schema, q, answersList);
      return {
        id: q.id,
        label: q.label,
        type: q.type,
        targetCount: table.targetCount,
        answeredCount: table.answeredCount,
        publicState: 'not_public',
        tally: table.defs.map(function (d) { return { id: d.id, label: d.label, count: table.counts[d.id] }; })
      };
    });
    var snapshot = buildSnapshot(schema, valid, { generatedAt: settings.now || new Date() });
    var decision = decideSnapshotUpdate(schema, settings.previousSnapshot || null, total, settings.now || new Date());
    return {
      survey_id: schema.survey_id,
      survey_version: schema.survey_version,
      design_version: schema.design_version,
      production_valid_total: total,
      test_excluded: classification.counts.test_excluded,
      excluded: classification.counts.excluded,
      version_mismatch_fields: classification.counts.version_mismatch_fields || emptyVersionFieldCounts(),
      legacy_date_serial_accepted: classification.counts.legacy_date_serial_accepted || 0,
      rows: classification.counts.rows,
      questions: questions,
      internalQuestions: internalQuestions,
      semantic: analyzeSemanticCodes(schema, valid),
      snapshotDecision: { update: decision.update, reason: decision.reason, increment: decision.increment },
      publicPreview: snapshot
    };
  }

  /* 自由記述（Admin のみ）。public snapshot の生成処理とは別関数・別ファイルで呼ぶ。個票の識別子は含めない。 */
  function listFreeText(schema, classification) {
    var textIds = core.getQuestions(schema).filter(function (q) { return q.type === 'text'; }).map(function (q) { return q.id; });
    var items = [];
    classification.valid.forEach(function (record) {
      textIds.forEach(function (id) {
        if (hasOwn(record.free_text, id)) items.push({ questionId: id, label: core.getQuestion(schema, id).label, text: record.free_text[id] });
      });
      Object.keys(record.other_texts).forEach(function (id) {
        items.push({ questionId: id, label: core.getQuestion(schema, id).label, kind: 'other', text: record.other_texts[id] });
      });
    });
    return items;
  }

  return {
    SNAPSHOT_VERSION: SNAPSHOT_VERSION,
    REGION_ID: REGION_ID,
    SENSITIVE_BRANCH_MIN_TARGET: SENSITIVE_BRANCH_MIN_TARGET,
    STATE_PUBLISHED: STATE_PUBLISHED,
    STATE_INSUFFICIENT: STATE_INSUFFICIENT,
    STATE_SENSITIVE_WITHHELD: STATE_SENSITIVE_WITHHELD,
    STATE_SUPPRESSED_ALL: STATE_SUPPRESSED_ALL,
    FORBIDDEN_KEYS: FORBIDDEN_KEYS,
    decodeMultiple: decodeMultiple,
    rowToAnswers: rowToAnswers,
    classifyRows: classifyRows,
    VERSION_FIELDS: VERSION_FIELDS,
    diagnoseVersions: diagnoseVersions,
    versionMatches: versionMatches,
    cellDefinitions: cellDefinitions,
    tallyQuestion: tallyQuestion,
    tallyRegion: tallyRegion,
    effectiveThresholds: effectiveThresholds,
    evaluatePublication: evaluatePublication,
    suppressCells: suppressCells,
    planPartitionHiding: planPartitionHiding,
    regionCells: regionCells,
    liveCountDisplay: liveCountDisplay,
    publicEntries: publicEntries,
    buildSnapshot: buildSnapshot,
    snapshotPolicy: snapshotPolicy,
    decideSnapshotUpdate: decideSnapshotUpdate,
    validateSnapshot: validateSnapshot,
    analyzeSemanticCodes: analyzeSemanticCodes,
    buildAdminSummary: buildAdminSummary,
    listFreeText: listFreeText
  };
})(typeof SurveyCore !== 'undefined' ? SurveyCore : require('./survey-core.js'));

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SurveyAggregate;
}
