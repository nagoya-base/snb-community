/*
 * 名古屋野球ユニ部アンケート（design v2.17）：maintenance（retention / close 後 finalize / cleanup）の判断ロジック（Issue #383）。
 *
 * 設計方針
 *  - Spreadsheet・Script Properties・時刻・乱数・network に直接触れない。副作用は呼び出し側が渡す ports 経由だけで、
 *    ports の呼び出し順がそのまま永続化の順序になる（finalized marker は必ず最後）。
 *  - 集計・publication 判定・suppression・snapshot 生成・検証は SurveyAggregate（#382）をそのまま呼ぶ。ここに別実装を持たない。
 *  - production submit の受付可否（opens_at / closes_at による許可・拒否）は #380 Public GAS が唯一の権威。
 *    ここで行うのは「締切後であること」という finalize の precondition 確認だけで、doPost / survey_closed 判定は持たない。
 *  - 回答本文・自由記述・respondent_hash は扱わない（行を classifyRows に渡して snapshot にするだけ。返り値・marker・audit に含めない）。
 *
 * ES5記法。Apps Script V8 と Node.js のどちらでも動く。Node.js では module.exports でも公開する（tests用）。
 */
var SurveyMaintenance = (function (aggregate) {
  'use strict';

  var OWNER = 'nagoya-base';
  var REQUIRED_TIMEZONE = 'Asia/Tokyo';
  var DAY_MS = 24 * 60 * 60 * 1000;
  var JST_OFFSET_MS = 9 * 60 * 60 * 1000;
  var SCHEMA_BLOCKING_STATUS = 'must_set_before_launch';
  var CONFIRMATION_LENGTH = 12;
  var AUDIT_MAX_ENTRIES = 5;
  var AUDIT_MAX_CHARS = 8000; /* Script Property の値上限（9KB）に収める */

  /* finalized marker に保存してよいキー（これ以外は不正 = fail closed）。個票・自由記述・hash・UUID・salt・token は含めない。 */
  var MARKER_KEYS = [
    'finalized_at', 'survey_id', 'survey_version', 'schema_version', 'design_version',
    'closes_at', 'production_valid_total', 'snapshot_digest', 'operator'
  ];
  /* 同じ内容かどうか（idempotent / conflict 判定）に使うキー。finalized_at は含めない。 */
  var MARKER_IDENTITY_KEYS = MARKER_KEYS.filter(function (k) { return k !== 'finalized_at'; });
  /* cleanup audit に保存してよいキー。 */
  var AUDIT_KEYS = ['executed_at', 'policy_version', 'success', 'storages', 'manual_required'];

  /*
   * 回答由来データの保存先の棚卸し。automation:
   *   auto             : maintenance GAS が削除・再 scan できる
   *   manual_required  : コードから削除できない（別 GAS project / GitHub / 外部）。dry-run に出し、Owner が手動で消して完了を記録する
   *   not_used         : 現在の実装では使っていない（tests が静的に保証する）
   * policy: keep_final_snapshot に従って残す／消すもの。retained: 監査情報として常に残すもの。
   */
  var STORAGE_INVENTORY = [
    { id: 'responses_production', label: 'responses Sheet の production 行', kind: 'raw', mode: 'production', automation: 'auto' },
    { id: 'responses_test', label: 'responses Sheet の test 行（submit_excluded）', kind: 'raw', mode: 'test', automation: 'auto' },
    { id: 'responses_unclassified', label: 'responses Sheet の response_mode 不明行', kind: 'raw', mode: 'unknown', automation: 'auto' },
    { id: 'responses_valid_sheet', label: 'responses_valid 等の派生 Sheet（finalize は生成しない。存在すれば削除）', kind: 'derived', mode: 'production', automation: 'auto' },
    { id: 'final_snapshot_sheet', label: 'final_snapshot Sheet（privacy-safe な final public snapshot）', kind: 'public_snapshot', mode: 'production', automation: 'auto', policy: 'keep_final_snapshot' },
    { id: 'maintenance_script_properties', label: 'maintenance の Script Properties（finalized marker / cleanup audit。件数・日時・digest のみ）', kind: 'metadata', mode: 'n/a', automation: 'auto', retained: true },
    { id: 'cache_service', label: 'CacheService（Public / Admin / maintenance は使用しない）', kind: 'derived', mode: 'n/a', automation: 'not_used' },
    { id: 'admin_script_properties', label: 'Admin GAS の Script Properties（SNAPSHOT_STATE：時刻と件数のみ）', kind: 'metadata', mode: 'n/a', automation: 'manual_required' },
    { id: 'public_script_properties', label: 'Public GAS の Script Properties（RESPONDENT_SALT / TEST_TOKEN / NOTIFICATION_EMAIL。salt は削除して hash を再識別不能にする）', kind: 'metadata', mode: 'n/a', automation: 'manual_required' },
    { id: 'github_pages_snapshot', label: 'GitHub Pages の snapshot.json（privacy-safe な公開 snapshot）', kind: 'public_snapshot', mode: 'production', automation: 'manual_required', policy: 'keep_final_snapshot' },
    { id: 'notification_and_execution_logs', label: '通知メール・Apps Script 実行ログ等（回答由来の件数・日時）', kind: 'log', mode: 'n/a', automation: 'manual_required' },
    { id: 'admin_export_copies', label: 'Admin export 等のコピー（ダウンロード済みファイル含む）', kind: 'raw', mode: 'both', automation: 'manual_required' },
    { id: 'external_tool_copies', label: '外部 AI / 外部ツールへ渡した de-identified copy', kind: 'derived', mode: 'both', automation: 'manual_required' },
    { id: 'spreadsheet_history_and_backups', label: 'Spreadsheet の変更履歴・ゴミ箱・バックアップ・ダウンロード済みコピー（行削除後も残る）', kind: 'raw', mode: 'both', automation: 'manual_required' }
  ];

  function hasOwn(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }
  function isPlainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function contains(list, item) { return list.indexOf(item) !== -1; }
  function inventoryIds() { return STORAGE_INVENTORY.map(function (s) { return s.id; }); }
  function storageById(id) {
    for (var i = 0; i < STORAGE_INVENTORY.length; i++) if (STORAGE_INVENTORY[i].id === id) return STORAGE_INVENTORY[i];
    return null;
  }

  function bytesToHex(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i++) {
      var b = bytes[i] < 0 ? bytes[i] + 256 : bytes[i];
      out += (b < 16 ? '0' : '') + b.toString(16);
    }
    return out;
  }

  /* 「+09:00」付き ISO 8601（秒まで必須）だけを受理して epoch ms を返す。未設定・不正は null。 */
  function parseJstDateTime(text) {
    if (typeof text !== 'string') return null;
    var match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\+09:00$/.exec(text);
    if (!match) return null;
    var month = Number(match[2]);
    var day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31 || Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59) return null;
    var utc = new Date(Date.UTC(Number(match[1]), month - 1, day));
    if (utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
    var time = Date.parse(text);
    return isNaN(time) ? null : time;
  }

  /* ── finalize precondition ──
   * submit の可否判定ではない。finalize を締切前に実行しないための前提確認。
   * ok:false の reason: reception_not_configured / closes_at_not_set / not_closed_yet */
  function evaluateFinalizePrecondition(reception, now) {
    var r = isPlainObject(reception) ? reception : {};
    if (r.timezone !== REQUIRED_TIMEZONE) return { ok: false, reason: 'reception_not_configured', closes_at_ms: null, closes_at: null };
    if (r.closes_at === null || r.closes_at === undefined || r.closes_at === '') return { ok: false, reason: 'closes_at_not_set', closes_at_ms: null, closes_at: null };
    var closes = parseJstDateTime(r.closes_at);
    var opens = parseJstDateTime(r.opens_at);
    if (closes === null || opens === null || opens >= closes) return { ok: false, reason: 'reception_not_configured', closes_at_ms: null, closes_at: null };
    var closed = now.getTime() > closes;
    return { ok: closed, reason: closed ? null : 'not_closed_yet', closes_at_ms: closes, closes_at: r.closes_at };
  }

  /* ── retention policy ── */

  function isPlaceholder(value) {
    if (typeof value !== 'string') return true;
    var text = value.trim();
    if (text === '') return true;
    return /^(tbd|todo|unset|none|n\/a|placeholder|x{2,}|未定|未設定|未確定)/i.test(text) || text.indexOf(SCHEMA_BLOCKING_STATUS) !== -1;
  }

  function parseJstDate(text) {
    var match = typeof text === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(text) : null;
    if (!match) return null;
    var month = Number(match[2]);
    var day = Number(match[3]);
    var utc = new Date(Date.UTC(Number(match[1]), month - 1, day));
    if (utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
    return Date.parse(text + 'T23:59:59.999+09:00');
  }

  function toJstIso(ms) {
    var d = new Date(ms + JST_OFFSET_MS);
    function p(n, w) { var s = String(n); while (s.length < (w || 2)) s = '0' + s; return s; }
    return p(d.getUTCFullYear(), 4) + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + 'T' +
      p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds()) + '+09:00';
  }

  /*
   * retention 設定（retention.config.json）を機械判定する。具体的な期限はここでは決めない（Owner が設定する）。
   *   status: 'unset'（policy_status が confirmed ではない）／'invalid'（confirmed と書かれているが不備あり）／'confirmed'
   *   unset / invalid は fail closed（cleanup 不可、launch 不可）。
   * launch_ready は retention 設定が confirmed、かつ schema の respondentNotice.retention.status が must_set_before_launch ではないときだけ true。
   */
  function evaluateRetentionPolicy(config, schema, closesAtMs, now) {
    var cfg = isPlainObject(config) ? config : {};
    var notice = schema && schema.respondentNotice && schema.respondentNotice.retention;
    var schemaStatus = notice && typeof notice.status === 'string' ? notice.status : SCHEMA_BLOCKING_STATUS;
    var problems = [];
    var result = {
      status: 'unset', confirmed: false, problems: problems, owner: OWNER, policy_version: null,
      deadline: null, deadline_ms: null, deadline_reached: false, keep_final_snapshot: null,
      cleanup_operator_set: false, verification_method_set: false,
      schema_retention_status: schemaStatus, launch_ready: false
    };
    if (cfg.owner !== OWNER) problems.push('owner_mismatch');
    if (cfg.policy_status !== 'confirmed') {
      problems.push('policy_not_confirmed');
      return result;
    }
    result.status = 'invalid';
    if (isPlaceholder(cfg.policy_version)) problems.push('policy_version_not_set'); else result.policy_version = cfg.policy_version.trim();
    if (typeof cfg.keep_final_snapshot !== 'boolean') problems.push('keep_final_snapshot_not_set'); else result.keep_final_snapshot = cfg.keep_final_snapshot;
    if (isPlaceholder(cfg.cleanup_operator)) problems.push('cleanup_operator_not_set'); else result.cleanup_operator_set = true;
    if (isPlaceholder(cfg.verification_method)) problems.push('verification_method_not_set'); else result.verification_method_set = true;
    var reviewed = Array.isArray(cfg.inventory_reviewed) ? cfg.inventory_reviewed : [];
    if (!inventoryIds().every(function (id) { return contains(reviewed, id); })) problems.push('inventory_not_reviewed');
    if (closesAtMs === null || closesAtMs === undefined) problems.push('closes_at_not_set');

    var endDate = cfg.retention_end_date;
    var rule = cfg.retention_rule;
    var hasDate = endDate !== null && endDate !== undefined;
    var hasRule = rule !== null && rule !== undefined;
    var deadline = null;
    if (hasDate && hasRule) {
      problems.push('retention_deadline_ambiguous');
    } else if (hasDate) {
      deadline = parseJstDate(endDate);
      if (deadline === null) problems.push('retention_end_date_invalid');
    } else if (hasRule) {
      var days = isPlainObject(rule) ? rule.days : null;
      if (!isPlainObject(rule) || rule.basis !== 'closes_at' || typeof days !== 'number' || days < 1 || days !== Math.floor(days)) {
        problems.push('retention_rule_invalid');
      } else if (typeof closesAtMs === 'number') {
        deadline = closesAtMs + days * DAY_MS;
      }
    } else {
      problems.push('retention_deadline_not_set');
    }
    if (deadline !== null && typeof closesAtMs === 'number' && deadline <= closesAtMs) {
      problems.push('retention_deadline_before_close');
      deadline = null;
    }
    if (deadline !== null) {
      result.deadline_ms = deadline;
      result.deadline = toJstIso(deadline);
      result.deadline_reached = now.getTime() > deadline;
    }
    if (!problems.length) {
      result.status = 'confirmed';
      result.confirmed = true;
    }
    result.launch_ready = result.confirmed && schemaStatus !== SCHEMA_BLOCKING_STATUS;
    return result;
  }

  /* ── finalized marker ── */

  function parseMarker(raw) {
    if (raw === null || raw === undefined || raw === '') return null;
    var marker;
    try { marker = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { throw new Error('marker_invalid'); }
    if (!isPlainObject(marker)) throw new Error('marker_invalid');
    var keys = Object.keys(marker);
    if (keys.length !== MARKER_KEYS.length || !keys.every(function (k) { return contains(MARKER_KEYS, k); })) throw new Error('marker_invalid');
    if (typeof marker.production_valid_total !== 'number' || marker.production_valid_total < 0 || marker.production_valid_total !== Math.floor(marker.production_valid_total)) throw new Error('marker_invalid');
    if (marker.operator !== OWNER || !/^[0-9a-f]{64}$/.test(String(marker.snapshot_digest))) throw new Error('marker_invalid');
    return marker;
  }

  function sameIdentity(a, b) {
    return MARKER_IDENTITY_KEYS.every(function (k) { return a[k] === b[k]; });
  }

  /* ── finalize ──
   * ports: { now: Date, reception, schema, sha256(text)→hex, readRows()→rows, loadMarker()→string|null,
   *          saveFinalSnapshot(json), readFinalSnapshot()→string|null, saveMarker(marker) }
   * 呼び出し順（固定）: precondition → readRows → classifyRows → buildSnapshot → validateSnapshot → 整合確認
   *   → (marker 照合) → saveFinalSnapshot → readFinalSnapshot（digest 照合）→ saveMarker（最後）
   * どこで例外が出ても saveMarker は呼ばれない。 */
  function computeFinal(ports) {
    var schema = ports.schema;
    var precondition = evaluateFinalizePrecondition(ports.reception, ports.now);
    if (!precondition.ok) throw new Error(precondition.reason);

    var classification = aggregate.classifyRows(schema, ports.readRows());
    var valid = classification.valid;
    var counts = classification.counts;
    var closesIso = new Date(precondition.closes_at_ms).toISOString();
    var snapshot = aggregate.buildSnapshot(schema, valid, { generatedAt: new Date(precondition.closes_at_ms) });
    if (aggregate.validateSnapshot(schema, snapshot).length) throw new Error('snapshot_invalid');

    var excludedTotal = Object.keys(counts.excluded).reduce(function (sum, k) { return sum + counts.excluded[k]; }, 0);
    var consistent =
      snapshot.survey_id === schema.survey_id &&
      snapshot.survey_version === schema.survey_version &&
      snapshot.schema_version === schema.schema_version &&
      snapshot.design_version === schema.design_version &&
      snapshot.generated_at === closesIso &&
      counts.production_valid === valid.length &&
      snapshot.production_valid_total === aggregate.liveCountDisplay(schema, valid.length).floor &&
      counts.rows === counts.production_valid + counts.test_excluded + excludedTotal;
    if (!consistent) throw new Error('consistency_mismatch');

    var json = JSON.stringify(snapshot, null, 2) + '\n';
    var digest = ports.sha256(json);
    return {
      precondition: precondition,
      counts: counts,
      exact_total: valid.length,
      snapshot_json: json,
      snapshot_digest: digest,
      confirmation_code: 'FINALIZE:' + schema.survey_version + ':' + digest.slice(0, CONFIRMATION_LENGTH),
      marker_identity: {
        survey_id: schema.survey_id,
        survey_version: schema.survey_version,
        schema_version: schema.schema_version,
        design_version: schema.design_version,
        closes_at: precondition.closes_at,
        production_valid_total: valid.length,
        snapshot_digest: digest,
        operator: OWNER
      }
    };
  }

  /* marker が指す保存済み final snapshot の状態。null（正常）／'final_snapshot_missing'／'final_snapshot_mismatch'。 */
  function storedSnapshotProblem(ports, marker) {
    var stored = ports.readFinalSnapshot();
    if (typeof stored !== 'string' || stored === '') return 'final_snapshot_missing';
    return ports.sha256(stored) === marker.snapshot_digest ? null : 'final_snapshot_mismatch';
  }

  function summarizeFinal(computed, existing, would, problem) {
    return {
      would: would,
      problem: problem || null,
      closes_at: computed.precondition.closes_at,
      production_valid_total: computed.exact_total,
      counts: computed.counts,
      snapshot_digest: computed.snapshot_digest,
      confirmation_code: would === 'finalize' ? computed.confirmation_code : null,
      finalized_at: existing ? existing.finalized_at : null
    };
  }

  /* 書き込みなし。finalize の結果（snapshot digest・件数）と、実行に必要な confirmation_code を返す。 */
  function finalizePreflight(ports) {
    var existing = parseMarker(ports.loadMarker());
    var computed = computeFinal(ports);
    if (!existing) return summarizeFinal(computed, null, 'finalize');
    if (!sameIdentity(existing, computed.marker_identity)) return summarizeFinal(computed, existing, 'conflict');
    // marker が同一でも、保存済み snapshot が欠損・改変されていれば noop と表示しない。
    var problem = storedSnapshotProblem(ports, existing);
    return summarizeFinal(computed, existing, problem ? 'inconsistent' : 'noop', problem);
  }

  function finalize(ports, confirmation) {
    var existing = parseMarker(ports.loadMarker());
    var computed = computeFinal(ports);
    if (existing) {
      // 同一内容なら no-op 成功。異なる内容でのfinalized済みは自動上書きせず fail closed。
      if (!sameIdentity(existing, computed.marker_identity)) throw new Error('finalized_conflict');
      // 保存済み snapshot が欠損・不一致なら成功扱いにせず fail closed（marker は書き換えない）。
      var problem = storedSnapshotProblem(ports, existing);
      if (problem) throw new Error(problem);
      return { status: 'already_finalized', noop: true, summary: summarizeFinal(computed, existing, 'noop') };
    }
    if (confirmation !== computed.confirmation_code) throw new Error('confirmation_mismatch');
    ports.saveFinalSnapshot(computed.snapshot_json);
    var stored = ports.readFinalSnapshot();
    if (typeof stored !== 'string' || ports.sha256(stored) !== computed.snapshot_digest) throw new Error('snapshot_verify_failed');
    var marker = {
      finalized_at: ports.now.toISOString(),
      survey_id: computed.marker_identity.survey_id,
      survey_version: computed.marker_identity.survey_version,
      schema_version: computed.marker_identity.schema_version,
      design_version: computed.marker_identity.design_version,
      closes_at: computed.marker_identity.closes_at,
      production_valid_total: computed.marker_identity.production_valid_total,
      snapshot_digest: computed.snapshot_digest,
      operator: OWNER
    };
    ports.saveMarker(marker); // 最後にだけ保存する。
    return { status: 'finalized', noop: false, summary: summarizeFinal(computed, marker, 'noop') };
  }

  /* marker と保存済み snapshot の状態（rows は読まない）。 */
  function finalizedStatus(ports) {
    var marker;
    try { marker = parseMarker(ports.loadMarker()); } catch (e) { return { state: 'marker_invalid', marker: null, snapshot_verified: false }; }
    if (!marker) return { state: 'not_finalized', marker: null, snapshot_verified: false };
    var stored = ports.readFinalSnapshot();
    return { state: 'finalized', marker: marker, snapshot_verified: typeof stored === 'string' && ports.sha256(stored) === marker.snapshot_digest };
  }

  /* ── cleanup ──
   * counts: { responses_production, responses_test, responses_unclassified, responses_valid_sheet, final_snapshot_sheet }（件数。値は出さない）
   * finalizedOk: marker が有効で保存済み snapshot の digest が一致している。 */
  function planAction(storage, policy, manualDone) {
    if (storage.automation === 'not_used') return 'not_used';
    if (storage.retained) return 'retain';
    if (storage.policy === 'keep_final_snapshot' && policy.keep_final_snapshot === true) return 'retain';
    if (storage.automation === 'manual_required') return manualDone ? 'manual_done' : 'manual_required';
    return 'delete';
  }

  function buildCleanupPlan(input) {
    var policy = input.policy;
    var counts = input.counts || {};
    var manualDone = input.manualDone || {};
    var blockers = [];
    if (!policy.confirmed) blockers.push('retention_policy_not_confirmed');
    else if (!policy.deadline_reached) blockers.push('retention_not_reached');
    if (policy.confirmed && policy.keep_final_snapshot === true && !input.finalizedOk) blockers.push('final_snapshot_required');

    var storages = STORAGE_INVENTORY.map(function (s) {
      var action = planAction(s, policy, manualDone[s.id] === true);
      return {
        id: s.id, label: s.label, kind: s.kind, mode: s.mode, automation: s.automation, action: action,
        count: s.automation === 'auto' && !s.retained && typeof counts[s.id] === 'number' ? counts[s.id] : null
      };
    });
    var manualRequired = storages.filter(function (s) { return s.action === 'manual_required' || s.action === 'manual_done'; })
      .map(function (s) { return { id: s.id, label: s.label, completed: s.action === 'manual_done' }; });
    var plan = {
      policy: {
        status: policy.status, version: policy.policy_version, deadline: policy.deadline,
        deadline_reached: policy.deadline_reached, keep_final_snapshot: policy.keep_final_snapshot
      },
      final_snapshot: { policy: policy.keep_final_snapshot === true ? 'retain' : (policy.keep_final_snapshot === false ? 'delete' : 'undecided'), finalized: input.finalizedOk === true },
      storages: storages,
      manual_required: manualRequired,
      blockers: blockers,
      can_execute: blockers.length === 0,
      confirmation_code: null
    };
    if (plan.can_execute) {
      var signature = policy.policy_version + '|' + storages.map(function (s) { return s.id + '=' + s.action + ':' + s.count; }).join(',');
      plan.confirmation_code = 'CLEANUP:' + policy.policy_version + ':' + input.sha256(signature).slice(0, CONFIRMATION_LENGTH);
    }
    return plan;
  }

  /*
   * ports: { now, policy（evaluateRetentionPolicy の結果）, sha256, countStorages()→counts, finalizedOk(): bool,
   *          manualDone(): {id: true}, deleteStorage(id)→削除件数, appendAudit(entry) }
   * dryRun は一切書き込まない。execute は policy → 期限 → final snapshot → confirmation の順に拒否し、
   * 削除後に再 scan して残っていれば失敗扱い。audit には件数・storage 名・成否だけを残す。 */
  function planFromPorts(ports) {
    return buildCleanupPlan({
      policy: ports.policy,
      counts: ports.countStorages(),
      finalizedOk: ports.finalizedOk(),
      manualDone: ports.manualDone(),
      sha256: ports.sha256
    });
  }

  function cleanupDryRun(ports) {
    return planFromPorts(ports);
  }

  function cleanupExecute(ports, confirmation) {
    var plan = planFromPorts(ports);
    if (!plan.can_execute) throw new Error(plan.blockers[0]);
    if (typeof confirmation !== 'string' || confirmation === '') throw new Error('confirmation_required');
    if (confirmation !== plan.confirmation_code) throw new Error('confirmation_mismatch');

    var targets = plan.storages.filter(function (s) { return s.action === 'delete'; });
    var results = targets.map(function (s) {
      try {
        var deleted = ports.deleteStorage(s.id);
        return { id: s.id, deleted: typeof deleted === 'number' ? deleted : 0, success: true };
      } catch (e) {
        return { id: s.id, deleted: 0, success: false };
      }
    });
    // 削除後に再 scan。対象が残っていれば成功扱いにしない。
    var after = ports.countStorages();
    results.forEach(function (r) {
      if (r.success && after[r.id] > 0) r.success = false;
    });
    var success = results.every(function (r) { return r.success; });
    var manualDone = ports.manualDone();
    var manual = plan.manual_required.map(function (m) { return { id: m.id, completed: manualDone[m.id] === true }; });
    var entry = {
      executed_at: ports.now.toISOString(), policy_version: plan.policy.version, success: success,
      storages: results, manual_required: manual
    };
    ports.appendAudit(entry);
    var manualPending = manual.filter(function (m) { return !m.completed; }).map(function (m) { return m.id; });
    return {
      status: !success ? 'failed' : (manualPending.length ? 'completed_manual_required_pending' : 'completed'),
      success: success,
      storages: results,
      manual_required_pending: manualPending,
      audit: entry
    };
  }

  /* audit の保存形式（新しいものから AUDIT_MAX_ENTRIES 件・AUDIT_MAX_CHARS 文字まで）。許可キー以外は保存しない。 */
  function sanitizeAudit(entry) {
    var out = {};
    AUDIT_KEYS.forEach(function (k) { if (hasOwn(entry, k)) out[k] = entry[k]; });
    out.storages = (out.storages || []).map(function (s) { return { id: s.id, deleted: s.deleted, success: s.success }; });
    out.manual_required = (out.manual_required || []).map(function (m) { return { id: m.id, completed: m.completed }; });
    return out;
  }

  function appendAuditList(currentJson, entry) {
    var list = [];
    try { list = JSON.parse(currentJson || '[]'); } catch (e) { list = []; }
    if (!Array.isArray(list)) list = [];
    list.push(sanitizeAudit(entry));
    list = list.slice(-AUDIT_MAX_ENTRIES);
    while (list.length > 1 && JSON.stringify(list).length > AUDIT_MAX_CHARS) list.shift();
    return list;
  }

  return {
    OWNER: OWNER,
    REQUIRED_TIMEZONE: REQUIRED_TIMEZONE,
    SCHEMA_BLOCKING_STATUS: SCHEMA_BLOCKING_STATUS,
    MARKER_KEYS: MARKER_KEYS,
    AUDIT_KEYS: AUDIT_KEYS,
    STORAGE_INVENTORY: STORAGE_INVENTORY,
    inventoryIds: inventoryIds,
    storageById: storageById,
    bytesToHex: bytesToHex,
    parseJstDateTime: parseJstDateTime,
    evaluateFinalizePrecondition: evaluateFinalizePrecondition,
    evaluateRetentionPolicy: evaluateRetentionPolicy,
    parseMarker: parseMarker,
    finalizePreflight: finalizePreflight,
    finalize: finalize,
    finalizedStatus: finalizedStatus,
    buildCleanupPlan: buildCleanupPlan,
    cleanupDryRun: cleanupDryRun,
    cleanupExecute: cleanupExecute,
    sanitizeAudit: sanitizeAudit,
    appendAuditList: appendAuditList
  };
})(typeof SurveyAggregate !== 'undefined' ? SurveyAggregate : require('./survey-aggregate.js'));

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SurveyMaintenance;
}
