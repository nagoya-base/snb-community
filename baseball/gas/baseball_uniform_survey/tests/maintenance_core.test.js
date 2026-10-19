'use strict';
// maintenance の判断ロジック（Issue #383）：finalize / retention / cleanup。副作用は ports のフェイクだけ。入力はすべて架空の fixture。
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const maintenance = require('../src/maintenance-core.js');
const { schema, aggregate, answersFor, rowFor, rowsFrom, entryOf } = require('./helpers/fixtures');
const { RECEPTION, AFTER_CLOSE, BEFORE_CLOSE, confirmedRetention } = require('./helpers/maintenance-env');

const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const INTERESTED = { club_awareness: 'aware_not_attended', catchball_interest: 'very_interested' };
const ATTENDEE = { club_awareness: 'attended', last_attended: 'within_3m' };
const CLOSES = new Date(RECEPTION.closes_at);
const SECRET_TEXT = 'FINAL-SECRET-FREE-TEXT';

const fixtureRows = () => rowsFrom([
  { count: 32, overrides: Object.assign({ feedback: SECRET_TEXT }, INTERESTED) },
  { count: 21, overrides: ATTENDEE },
  { count: 4, meta: { response_mode: 'test', test_run_id: 'run' } }
]);

/** finalize 用 ports。calls に呼び出し順を記録する。 */
function finalizePorts(rows, overrides = {}) {
  const state = { marker: null, snapshot: null, calls: [] };
  const ports = {
    now: AFTER_CLOSE, schema, reception: RECEPTION, sha256,
    readRows: () => { state.calls.push('readRows'); return rows; },
    loadMarker: () => state.marker,
    saveFinalSnapshot: (json) => { state.calls.push('saveFinalSnapshot'); state.snapshot = json; },
    readFinalSnapshot: () => { state.calls.push('readFinalSnapshot'); return state.snapshot; },
    saveMarker: (marker) => { state.calls.push('saveMarker'); state.marker = JSON.stringify(marker); }
  };
  return { ports: Object.assign(ports, overrides), state };
}
const confirmationOf = (ports) => maintenance.finalizePreflight(ports).confirmation_code;

// ── finalize の precondition（submit 拒否ではなく、finalize を早まらせないための前提） ──

test('finalize は締切後だけ実行できる：締切前・締切ちょうど・closes_at 未設定・受付期間未設定は拒否し、行も読まない', () => {
  const cases = [
    [{ now: BEFORE_CLOSE }, 'not_closed_yet'],
    [{ now: CLOSES }, 'not_closed_yet'],
    [{ reception: Object.assign({}, RECEPTION, { closes_at: null }) }, 'closes_at_not_set'],
    [{ reception: Object.assign({}, RECEPTION, { opens_at: null }) }, 'reception_not_configured'],
    [{ reception: Object.assign({}, RECEPTION, { timezone: 'UTC' }) }, 'reception_not_configured'],
    [{ reception: Object.assign({}, RECEPTION, { closes_at: '2026-11-30T23:59:59Z' }) }, 'reception_not_configured'],
    [{ reception: Object.assign({}, RECEPTION, { opens_at: RECEPTION.closes_at }) }, 'reception_not_configured']
  ];
  for (const [override, reason] of cases) {
    const { ports, state } = finalizePorts(fixtureRows(), override);
    assert.throws(() => maintenance.finalizePreflight(ports), new RegExp('^Error: ' + reason + '$'), reason);
    assert.throws(() => maintenance.finalize(ports, 'FINALIZE:x'), new RegExp('^Error: ' + reason + '$'), reason);
    assert.deepEqual(state.calls, [], reason + ': 行を読まず何も保存しない');
  }
  const closedAfter = new Date(CLOSES.getTime() + 1);
  const { ports } = finalizePorts(fixtureRows(), { now: closedAfter });
  assert.doesNotThrow(() => maintenance.finalizePreflight(ports));
});

// ── final snapshot は #382 の classifyRows / buildSnapshot / validateSnapshot そのもの ──

test('final snapshot は #382 の buildSnapshot と一致し、test / invalid / 18歳未満 / 重複を除外する', () => {
  const ok = answersFor({});
  const rows = fixtureRows().concat([
    rowFor({ age_confirmed: 'no' }),
    rowFor(Object.assign({}, ok, { baseball_experience: 'not_an_option' })),
    rowFor(ok, { respondent_hash: 'dup' }), rowFor(ok, { respondent_hash: 'dup' }),
    rowFor(ok, { response_mode: 'staging' })
  ]);
  const { ports, state } = finalizePorts(rows);
  const code = confirmationOf(ports);
  const result = maintenance.finalize(ports, code);
  const classification = aggregate.classifyRows(schema, rows);
  const expected = JSON.stringify(aggregate.buildSnapshot(schema, classification.valid, { generatedAt: CLOSES }), null, 2) + '\n';
  assert.equal(state.snapshot, expected);
  assert.equal(result.status, 'finalized');
  assert.equal(result.summary.production_valid_total, classification.valid.length);
  assert.deepEqual(result.summary.counts, classification.counts);
  assert.equal(classification.counts.excluded.ineligible, 1);
  assert.equal(classification.counts.excluded.duplicate, 1);
  assert.equal(classification.counts.excluded.schema_invalid, 1);
  assert.equal(classification.counts.excluded.unknown_response_mode, 1);
  assert.equal(classification.counts.test_excluded, 4);
  assert.deepEqual(aggregate.validateSnapshot(schema, JSON.parse(state.snapshot)), []);
  assert.equal(JSON.parse(state.snapshot).generated_at, CLOSES.toISOString(), '締切時刻で固定（再実行しても同じ digest）');
});

test('final snapshot に自由記述・hash・system identifier・詳細地域が入らず、marker にも個票を含めない', () => {
  const rows = fixtureRows();
  const { ports, state } = finalizePorts(rows);
  maintenance.finalize(ports, confirmationOf(ports));
  assert.ok(!state.snapshot.includes(SECRET_TEXT));
  rows.forEach((r) => assert.ok(!state.snapshot.includes(r.respondent_hash) && !state.marker.includes(r.respondent_hash)));
  const keys = [];
  (function walk(v) { if (v && typeof v === 'object') Object.keys(v).forEach((k) => { keys.push(k); walk(v[k]); }); })(JSON.parse(state.snapshot));
  ['respondent_hash', 'uuid', 'timestamp', 'source_channel', 'client_elapsed_ms', 'other_texts', 'free_text', 'test_run_id', 'notification_status', 'response_mode', 'answers', 'rows', 'records']
    .forEach((k) => assert.ok(!keys.includes(k), k));
  // 詳細都道府県・愛知県内地域は private（#382 と同じ。回答に含まれていても final に出さない）。
  assert.ok(!state.snapshot.includes('aichi_area') && !state.snapshot.includes('"prefecture"') && !state.snapshot.includes('名古屋市'));
  const marker = JSON.parse(state.marker);
  assert.deepEqual(Object.keys(marker).sort(), [...maintenance.MARKER_KEYS].sort());
  assert.ok(!state.marker.includes(SECRET_TEXT) && !/salt|token|uuid|hash/i.test(Object.keys(marker).join()));
  assert.equal(marker.operator, 'nagoya-base');
  assert.equal(marker.snapshot_digest, sha256(state.snapshot));
  assert.equal(marker.production_valid_total, 53);
});

test('閾値未達の sensitive branch は final でも非公開のまま（suppression を緩めない）', () => {
  const rows = rowsFrom([{ count: 32, overrides: INTERESTED }, { count: 19, overrides: ATTENDEE }]);
  const { ports, state } = finalizePorts(rows);
  maintenance.finalize(ports, confirmationOf(ports));
  const snapshot = JSON.parse(state.snapshot);
  const entry = entryOf(snapshot, 'repeat_intent');
  assert.equal(entry.state, 'sensitive_withheld');
  assert.equal(entry.targetCount, null);
  assert.deepEqual(entry.cells, []);
});

// ── 永続化の順序と fail closed ──

test('保存順は snapshot 保存 → 読み戻し照合 → marker の順で、marker は常に最後に1回だけ', () => {
  const { ports, state } = finalizePorts(fixtureRows());
  maintenance.finalize(ports, confirmationOf(ports));
  const writes = state.calls.filter((c) => c !== 'readRows');
  assert.deepEqual(writes, ['saveFinalSnapshot', 'readFinalSnapshot', 'saveMarker']);
  assert.equal(state.calls[state.calls.length - 1], 'saveMarker');
  assert.equal(state.calls.indexOf('readRows'), 0);
});

test('途中失敗では marker を残さない：validateSnapshot 失敗・snapshot 保存失敗・読み戻し不一致・整合不一致', () => {
  const original = aggregate.validateSnapshot;
  try {
    aggregate.validateSnapshot = () => ['forced'];
    const { ports, state } = finalizePorts(fixtureRows());
    assert.throws(() => maintenance.finalizePreflight(ports), /snapshot_invalid/);
    assert.throws(() => maintenance.finalize(ports, 'x'), /snapshot_invalid/);
    assert.equal(state.marker, null);
    assert.ok(!state.calls.includes('saveFinalSnapshot') && !state.calls.includes('saveMarker'));
  } finally {
    aggregate.validateSnapshot = original;
  }

  const saveFail = finalizePorts(fixtureRows(), { saveFinalSnapshot: () => { throw new Error('boom'); } });
  assert.throws(() => maintenance.finalize(saveFail.ports, confirmationOf(saveFail.ports)), /boom/);
  assert.equal(saveFail.state.marker, null);
  assert.ok(!saveFail.state.calls.includes('saveMarker'));

  const tampered = finalizePorts(fixtureRows());
  tampered.ports.readFinalSnapshot = () => '{"tampered":true}';
  assert.throws(() => maintenance.finalize(tampered.ports, confirmationOf(tampered.ports)), /snapshot_verify_failed/);
  assert.equal(tampered.state.marker, null);

  const missing = finalizePorts(fixtureRows());
  missing.ports.readFinalSnapshot = () => null;
  assert.throws(() => maintenance.finalize(missing.ports, confirmationOf(missing.ports)), /snapshot_verify_failed/);

  const markerFail = finalizePorts(fixtureRows());
  markerFail.ports.saveMarker = () => { throw new Error('marker_write_failed'); };
  assert.throws(() => maintenance.finalize(markerFail.ports, confirmationOf(markerFail.ports)), /marker_write_failed/);
  assert.equal(markerFail.state.marker, null);

  const originalBuild = aggregate.buildSnapshot;
  try {
    // design / schema version のずれは validateSnapshot が、締切時刻・件数のずれは整合確認が拒否する。
    aggregate.buildSnapshot = (s, v, o) => Object.assign(originalBuild(s, v, o), { design_version: '0.0' });
    const versionDrift = finalizePorts(fixtureRows());
    assert.throws(() => maintenance.finalizePreflight(versionDrift.ports), /snapshot_invalid/);
    aggregate.buildSnapshot = (s, v, o) => Object.assign(originalBuild(s, v, o), { generated_at: '2000-01-01T00:00:00.000Z' });
    const timeDrift = finalizePorts(fixtureRows());
    assert.throws(() => maintenance.finalize(timeDrift.ports, 'x'), /consistency_mismatch/);
    assert.deepEqual(timeDrift.state.calls, ['readRows']);
    assert.equal(timeDrift.state.marker, null);
  } finally {
    aggregate.buildSnapshot = originalBuild;
  }
});

test('finalize は explicit confirmation が必要：なし・不一致・別 digest の code では保存しない', () => {
  const { ports, state } = finalizePorts(fixtureRows());
  const code = confirmationOf(ports);
  assert.match(code, /^FINALIZE:2026-10:[0-9a-f]{12}$/);
  for (const bad of [undefined, '', 'FINALIZE', code + 'x', 'FINALIZE:2026-10:000000000000']) {
    assert.throws(() => maintenance.finalize(ports, bad), /confirmation_mismatch/);
  }
  assert.equal(state.marker, null);
  assert.ok(!state.calls.includes('saveFinalSnapshot'));
  assert.equal(maintenance.finalizePreflight(ports).would, 'finalize');
});

test('同内容の再実行は no-op 成功、異なる内容での finalized 済みは自動上書きせず fail closed', () => {
  const rows = fixtureRows();
  const first = finalizePorts(rows);
  maintenance.finalize(first.ports, confirmationOf(first.ports));
  const markerBefore = first.state.marker;

  first.state.calls.length = 0;
  const again = maintenance.finalize(first.ports, 'not even needed');
  assert.equal(again.status, 'already_finalized');
  assert.equal(again.noop, true);
  assert.equal(first.state.marker, markerBefore);
  assert.ok(!first.state.calls.includes('saveFinalSnapshot') && !first.state.calls.includes('saveMarker'));
  assert.equal(maintenance.finalizePreflight(first.ports).would, 'noop');

  // 回答が増えた（digest が変わる）／締切が変わった → conflict。保存しない。
  const changedRows = rows.concat(rowsFrom([{ count: 20, overrides: ATTENDEE }]));
  const changed = finalizePorts(changedRows);
  changed.state.marker = markerBefore;
  assert.equal(maintenance.finalizePreflight(changed.ports).would, 'conflict');
  assert.throws(() => maintenance.finalize(changed.ports, 'x'), /finalized_conflict/);
  const moved = finalizePorts(rows, { reception: Object.assign({}, RECEPTION, { closes_at: '2026-11-29T23:59:59+09:00' }) });
  moved.state.marker = markerBefore;
  assert.throws(() => maintenance.finalize(moved.ports, 'x'), /finalized_conflict/);
  [changed, moved].forEach((s) => {
    assert.equal(s.state.marker, markerBefore);
    assert.ok(!s.state.calls.includes('saveFinalSnapshot') && !s.state.calls.includes('saveMarker'));
  });
});

test('同一 marker でも保存済み snapshot を検証する：正常は no-op、欠損・改変は fail closed（preflight も noop と表示しない）', () => {
  const first = finalizePorts(fixtureRows());
  maintenance.finalize(first.ports, confirmationOf(first.ports));
  const { ports, state } = first;
  const markerBefore = state.marker;
  const goodSnapshot = state.snapshot;

  // 正常：no-op 成功
  assert.equal(maintenance.finalizePreflight(ports).would, 'noop');
  assert.equal(maintenance.finalizePreflight(ports).problem, null);
  assert.equal(maintenance.finalize(ports, 'x').status, 'already_finalized');

  // 欠損・改変：どちらも成功扱いにせず、何も書かない
  for (const [stored, problem] of [[null, 'final_snapshot_missing'], ['', 'final_snapshot_missing'], [goodSnapshot.replace('"survey_id"', '"survey_id "'), 'final_snapshot_mismatch'], ['{"tampered":true}', 'final_snapshot_mismatch']]) {
    state.snapshot = stored;
    state.calls.length = 0;
    const preflight = maintenance.finalizePreflight(ports);
    assert.equal(preflight.would, 'inconsistent', problem);
    assert.equal(preflight.problem, problem);
    assert.equal(preflight.confirmation_code, null);
    assert.throws(() => maintenance.finalize(ports, 'x'), new RegExp('^Error: ' + problem + '$'));
    assert.ok(!state.calls.includes('saveFinalSnapshot') && !state.calls.includes('saveMarker'));
    assert.equal(state.marker, markerBefore);
    const status = maintenance.finalizedStatus(ports);
    assert.deepEqual([status.state, status.snapshot_verified], ['finalized', false]);
  }
  state.snapshot = goodSnapshot;
  assert.equal(maintenance.finalizePreflight(ports).would, 'noop');
});

test('不正な marker（余分なキー・形式違い）は fail closed', () => {
  const { ports, state } = finalizePorts(fixtureRows());
  maintenance.finalize(ports, confirmationOf(ports));
  const valid = JSON.parse(state.marker);
  for (const bad of [
    JSON.stringify(Object.assign({}, valid, { respondent_hash: 'x' })),
    JSON.stringify(Object.assign({}, valid, { operator: 'someone' })),
    JSON.stringify(Object.assign({}, valid, { snapshot_digest: 'abc' })),
    JSON.stringify(Object.assign({}, valid, { production_valid_total: -1 })),
    '{not json', '[]'
  ]) {
    state.marker = bad;
    assert.throws(() => maintenance.finalizePreflight(ports), /marker_invalid/);
    assert.throws(() => maintenance.finalize(ports, 'x'), /marker_invalid/);
    assert.equal(maintenance.finalizedStatus(ports).state, 'marker_invalid');
  }
  state.marker = null;
  assert.equal(maintenance.finalizedStatus(ports).state, 'not_finalized');
});

test('preflight は非破壊で、個票を返さない', () => {
  const rows = fixtureRows();
  const { ports, state } = finalizePorts(rows);
  const summary = maintenance.finalizePreflight(ports);
  assert.deepEqual(state.calls, ['readRows']);
  const text = JSON.stringify(summary);
  assert.ok(!text.includes(SECRET_TEXT));
  rows.forEach((r) => assert.ok(!text.includes(r.respondent_hash)));
  assert.equal(summary.production_valid_total, 53);
  assert.equal(summary.counts.test_excluded, 4);
});

// ── #380 の受付判定を再実装していない ──

test('maintenance は submit 受付判定を持たない（doPost / survey_closed / 受付状態の判定がない）', () => {
  const dir = path.join(__dirname, '..', 'maintenance');
  const strip = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const files = fs.readdirSync(dir).filter((f) => /\.(gs|html)$/.test(f) && f !== 'SurveyGenerated.gs')
    .map((f) => ({ name: f, code: strip(fs.readFileSync(path.join(dir, f), 'utf8')) }));
  files.push({ name: 'src/maintenance-core.js', code: strip(fs.readFileSync(path.join(__dirname, '..', 'src', 'maintenance-core.js'), 'utf8')) });
  for (const { name, code } of files) {
    assert.ok(!/doPost|survey_closed|not_open|receptionState|isReceptionOpen|acceptSubmit|submitResponse/.test(code), `${name}: 受付判定を持たない`);
    assert.ok(!/opens_at[^\n]*(now|time)|(now|time)[^\n]*opens_at/.test(code), `${name}: opens_at と現在時刻を比較しない`);
  }
  // 締切後の precondition だけが closes_at を参照する。state は ok / reason のみで、'open' 等の受付状態を返さない。
  const reasons = [];
  [BEFORE_CLOSE, AFTER_CLOSE].forEach((now) => reasons.push(maintenance.evaluateFinalizePrecondition(RECEPTION, now)));
  assert.deepEqual(reasons.map((r) => [r.ok, r.reason]), [[false, 'not_closed_yet'], [true, null]]);
});

// ── retention policy ──

test('retention 未確定は launch blocker：リポジトリの設定は unset で、schema も must_set_before_launch のまま', () => {
  const committed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'retention.config.json'), 'utf8'));
  assert.equal(committed.owner, 'nagoya-base');
  assert.equal(committed.policy_status, 'unset');
  const policy = maintenance.evaluateRetentionPolicy(committed, schema, CLOSES.getTime(), AFTER_CLOSE);
  assert.equal(policy.status, 'unset');
  assert.equal(policy.confirmed, false);
  assert.equal(policy.launch_ready, false);
  assert.equal(policy.deadline, null);
  assert.equal(schema.respondentNotice.retention.status, 'must_set_before_launch');
  // closes_at 未設定（現状のリポジトリ設定）でも unset のまま。
  assert.equal(maintenance.evaluateRetentionPolicy(committed, schema, null, AFTER_CLOSE).launch_ready, false);
});

test('retention が confirmed でも、schema の status が must_set_before_launch のままなら launch_ready にならない', () => {
  const closes = CLOSES.getTime();
  const policy = maintenance.evaluateRetentionPolicy(confirmedRetention(), schema, closes, AFTER_CLOSE);
  assert.equal(policy.status, 'confirmed');
  assert.equal(policy.launch_ready, false);
  const relaxed = JSON.parse(JSON.stringify(schema));
  relaxed.respondentNotice.retention.status = 'set';
  assert.equal(maintenance.evaluateRetentionPolicy(confirmedRetention(), relaxed, closes, AFTER_CLOSE).launch_ready, true);
  assert.equal(maintenance.evaluateRetentionPolicy(confirmedRetention({ policy_status: 'unset' }), relaxed, closes, AFTER_CLOSE).launch_ready, false);
});

test('retention 設定の不備・placeholder は fail closed（invalid / unset）', () => {
  const closes = CLOSES.getTime();
  const evaluate = (overrides, closesAt = closes) => maintenance.evaluateRetentionPolicy(confirmedRetention(overrides), schema, closesAt, AFTER_CLOSE);
  const cases = [
    [{ owner: 'someone-else' }, 'owner_mismatch'],
    [{ policy_version: null }, 'policy_version_not_set'],
    [{ policy_version: 'TBD' }, 'policy_version_not_set'],
    [{ policy_version: 'must_set_before_launch' }, 'policy_version_not_set'],
    [{ keep_final_snapshot: null }, 'keep_final_snapshot_not_set'],
    [{ keep_final_snapshot: 'yes' }, 'keep_final_snapshot_not_set'],
    [{ cleanup_operator: '' }, 'cleanup_operator_not_set'],
    [{ cleanup_operator: '未定' }, 'cleanup_operator_not_set'],
    [{ verification_method: 'todo' }, 'verification_method_not_set'],
    [{ inventory_reviewed: [] }, 'inventory_not_reviewed'],
    [{ inventory_reviewed: maintenance.inventoryIds().slice(1) }, 'inventory_not_reviewed'],
    [{ retention_end_date: null }, 'retention_deadline_not_set'],
    [{ retention_end_date: '2027-02-30' }, 'retention_end_date_invalid'],
    [{ retention_end_date: '2027/03/31' }, 'retention_end_date_invalid'],
    [{ retention_end_date: '2026-11-29' }, 'retention_deadline_before_close'],
    [{ retention_rule: { basis: 'closes_at', days: 30 } }, 'retention_deadline_ambiguous'],
    [{ retention_end_date: null, retention_rule: { basis: 'closes_at', days: 0 } }, 'retention_rule_invalid'],
    [{ retention_end_date: null, retention_rule: { basis: 'opens_at', days: 30 } }, 'retention_rule_invalid'],
    [{ retention_end_date: null, retention_rule: { basis: 'closes_at', days: 1.5 } }, 'retention_rule_invalid']
  ];
  for (const [override, problem] of cases) {
    const policy = evaluate(override);
    assert.equal(policy.confirmed, false, JSON.stringify(override));
    assert.ok(policy.problems.includes(problem), `${JSON.stringify(override)} → ${policy.problems}`);
    assert.ok(policy.status === 'invalid' || policy.status === 'unset');
  }
  assert.ok(evaluate({}, null).problems.includes('closes_at_not_set'));
  assert.equal(maintenance.evaluateRetentionPolicy(null, schema, closes, AFTER_CLOSE).confirmed, false);
});

test('retention の期限：固定日（JST 当日末まで）または closes_at からの日数。deadline_reached はその後だけ true', () => {
  const closes = CLOSES.getTime();
  const at = (iso) => new Date(iso);
  const byDate = (now) => maintenance.evaluateRetentionPolicy(confirmedRetention({ retention_end_date: '2027-03-31' }), schema, closes, now);
  assert.equal(byDate(at('2027-03-31T23:59:59.999+09:00')).deadline_reached, false);
  assert.equal(byDate(at('2027-04-01T00:00:00+09:00')).deadline_reached, true);
  assert.equal(byDate(AFTER_CLOSE).deadline, '2027-03-31T23:59:59+09:00');
  const rule = { retention_end_date: null, retention_rule: { basis: 'closes_at', days: 90 } };
  const byRule = (now) => maintenance.evaluateRetentionPolicy(confirmedRetention(rule), schema, closes, now);
  const deadline = closes + 90 * 24 * 3600 * 1000;
  assert.equal(byRule(new Date(deadline)).deadline_reached, false);
  assert.equal(byRule(new Date(deadline + 1)).deadline_reached, true);
  assert.equal(byRule(AFTER_CLOSE).status, 'confirmed');
});

test('storage inventory：production / test / 派生 / Script Properties / Cache / snapshot / GitHub / log / export / 外部コピーを棚卸しし、コードから消せないものは manual_required', () => {
  const ids = maintenance.inventoryIds();
  assert.equal(new Set(ids).size, ids.length);
  [
    'responses_production', 'responses_test', 'responses_valid_sheet', 'final_snapshot_sheet', 'maintenance_script_properties',
    'admin_script_properties', 'public_script_properties', 'cache_service', 'github_pages_snapshot', 'notification_and_execution_logs',
    'admin_export_copies', 'external_tool_copies', 'spreadsheet_history_and_backups'
  ].forEach((id) => assert.ok(ids.includes(id), id));
  const byId = (id) => maintenance.storageById(id);
  assert.equal(byId('responses_production').mode, 'production');
  assert.equal(byId('responses_test').mode, 'test');
  ['admin_script_properties', 'public_script_properties', 'github_pages_snapshot', 'notification_and_execution_logs', 'admin_export_copies', 'external_tool_copies', 'spreadsheet_history_and_backups']
    .forEach((id) => assert.equal(byId(id).automation, 'manual_required', id));
  ['responses_production', 'responses_test', 'responses_unclassified', 'responses_valid_sheet', 'final_snapshot_sheet']
    .forEach((id) => assert.equal(byId(id).automation, 'auto', id));
  maintenance.STORAGE_INVENTORY.forEach((s) => assert.ok(['raw', 'derived', 'public_snapshot', 'metadata', 'log'].includes(s.kind), s.id));
  assert.equal(byId('nope'), null);
});

// ── cleanup ──

/** cleanup 用 ports。storage は件数だけのフェイク。 */
function cleanupFixture(policyOverrides = {}, options = {}) {
  const state = {
    counts: Object.assign({ responses_production: 53, responses_test: 4, responses_unclassified: 0, responses_valid_sheet: 1, final_snapshot_sheet: 1 }, options.counts),
    finalized: options.finalized !== false, manual: Object.assign({}, options.manual), audits: [], deleted: [], now: options.now || new Date('2027-04-02T00:00:00+09:00')
  };
  const policy = maintenance.evaluateRetentionPolicy(confirmedRetention(policyOverrides), schema, CLOSES.getTime(), state.now);
  const ports = {
    now: state.now, policy, sha256,
    countStorages: () => Object.assign({}, state.counts),
    finalizedOk: () => state.finalized,
    manualDone: () => Object.assign({}, state.manual),
    deleteStorage: (id) => {
      if (options.failOn === id) throw new Error('delete_failed');
      state.deleted.push(id);
      const n = state.counts[id];
      if (options.leaveOver !== id) state.counts[id] = 0;
      return n;
    },
    appendAudit: (entry) => state.audits.push(entry)
  };
  return { ports, state };
}
const planOf = (fixture) => maintenance.cleanupDryRun(fixture.ports);

test('cleanup：retention 未確定・期限前は dry-run で実行不可、execute は拒否して何も削除しない', () => {
  const unset = cleanupFixture({ policy_status: 'unset' });
  assert.equal(planOf(unset).can_execute, false);
  assert.deepEqual(planOf(unset).blockers, ['retention_policy_not_confirmed']);
  assert.throws(() => maintenance.cleanupExecute(unset.ports, 'CLEANUP:fixture-1:000000000000'), /retention_policy_not_confirmed/);

  const early = cleanupFixture({}, { now: new Date('2027-03-31T12:00:00+09:00') });
  assert.deepEqual(planOf(early).blockers, ['retention_not_reached']);
  assert.equal(planOf(early).policy.deadline_reached, false);
  assert.equal(planOf(early).confirmation_code, null);
  assert.throws(() => maintenance.cleanupExecute(early.ports, 'anything'), /retention_not_reached/);
  [unset, early].forEach((f) => assert.deepEqual([f.state.deleted, f.state.audits], [[], []]));
});

test('cleanup dry-run は非破壊で、件数・storage 名・production/test・raw/derived/snapshot の区別を返し、個票値を含まない', () => {
  const fixture = cleanupFixture({ keep_final_snapshot: true });
  const plan = planOf(fixture);
  assert.deepEqual([fixture.state.deleted, fixture.state.audits], [[], []]);
  assert.equal(plan.can_execute, true);
  assert.equal(plan.policy.version, 'fixture-1');
  assert.equal(plan.policy.deadline_reached, true);
  const byId = Object.fromEntries(plan.storages.map((s) => [s.id, s]));
  assert.deepEqual([byId.responses_production.count, byId.responses_production.mode, byId.responses_production.kind, byId.responses_production.action], [53, 'production', 'raw', 'delete']);
  assert.deepEqual([byId.responses_test.count, byId.responses_test.mode, byId.responses_test.action], [4, 'test', 'delete']);
  assert.deepEqual([byId.responses_valid_sheet.kind, byId.responses_valid_sheet.action], ['derived', 'delete']);
  assert.deepEqual([byId.final_snapshot_sheet.kind, byId.final_snapshot_sheet.action], ['public_snapshot', 'retain']);
  assert.equal(byId.cache_service.action, 'not_used');
  assert.equal(byId.maintenance_script_properties.action, 'retain');
  assert.equal(byId.admin_script_properties.action, 'manual_required');
  assert.deepEqual(plan.final_snapshot, { policy: 'retain', finalized: true });
  assert.match(plan.confirmation_code, /^CLEANUP:fixture-1:[0-9a-f]{12}$/);
  assert.ok(plan.manual_required.every((m) => m.completed === false));
  assert.ok(!JSON.stringify(plan).includes(SECRET_TEXT));
});

test('final snapshot の保持方針：keep=true は finalize 済みを要求して残し、keep=false は削除し、公開 snapshot の手動処理も方針に従う', () => {
  const keepUnfinalized = cleanupFixture({ keep_final_snapshot: true }, { finalized: false });
  assert.deepEqual(planOf(keepUnfinalized).blockers, ['final_snapshot_required']);
  assert.throws(() => maintenance.cleanupExecute(keepUnfinalized.ports, 'x'), /final_snapshot_required/);
  assert.deepEqual(keepUnfinalized.state.deleted, []);

  const keep = cleanupFixture({ keep_final_snapshot: true });
  maintenance.cleanupExecute(keep.ports, planOf(keep).confirmation_code);
  assert.ok(!keep.state.deleted.includes('final_snapshot_sheet'));
  assert.equal(keep.state.counts.final_snapshot_sheet, 1);
  assert.ok(!planOf(keep).manual_required.some((m) => m.id === 'github_pages_snapshot'), '保持する公開 snapshot は手動処理不要');

  const drop = cleanupFixture({ keep_final_snapshot: false }, { finalized: false });
  const dropPlan = planOf(drop);
  assert.equal(dropPlan.can_execute, true, 'keep=false なら finalize 済みでなくてよい');
  assert.equal(dropPlan.final_snapshot.policy, 'delete');
  assert.ok(dropPlan.manual_required.some((m) => m.id === 'github_pages_snapshot' && m.completed === false));
  maintenance.cleanupExecute(drop.ports, dropPlan.confirmation_code);
  assert.ok(drop.state.deleted.includes('final_snapshot_sheet'));
});

test('cleanup execute は explicit confirmation が必要：なし・不一致・件数が変わった後の古い code は拒否', () => {
  const fixture = cleanupFixture();
  const code = planOf(fixture).confirmation_code;
  for (const bad of [undefined, '', null]) assert.throws(() => maintenance.cleanupExecute(fixture.ports, bad), /confirmation_required/);
  for (const bad of ['yes', 'CLEANUP', code + '0', 'CLEANUP:fixture-1:000000000000']) assert.throws(() => maintenance.cleanupExecute(fixture.ports, bad), /confirmation_mismatch/);
  assert.deepEqual([fixture.state.deleted, fixture.state.audits], [[], []]);
  fixture.state.counts.responses_production = 54; // dry-run 後に件数が変わった
  assert.throws(() => maintenance.cleanupExecute(fixture.ports, code), /confirmation_mismatch/);
  assert.deepEqual(fixture.state.deleted, []);
});

test('cleanup execute：production / test 双方を削除し、再 scan で空を確認し、audit には件数・storage 名・成否だけを残す', () => {
  const fixture = cleanupFixture({ keep_final_snapshot: true });
  const result = maintenance.cleanupExecute(fixture.ports, planOf(fixture).confirmation_code);
  assert.deepEqual(fixture.state.deleted.sort(), ['responses_production', 'responses_test', 'responses_unclassified', 'responses_valid_sheet'].sort());
  assert.equal(result.success, true);
  assert.equal(result.status, 'completed_manual_required_pending', 'manual_required が残る間は completed にしない');
  assert.ok(result.manual_required_pending.includes('spreadsheet_history_and_backups'));
  assert.deepEqual(result.storages.find((s) => s.id === 'responses_production'), { id: 'responses_production', deleted: 53, success: true });
  assert.equal(fixture.state.audits.length, 1);
  const audit = fixture.state.audits[0];
  assert.deepEqual(Object.keys(audit).sort(), [...maintenance.AUDIT_KEYS].sort());
  assert.deepEqual(Object.keys(audit.storages[0]).sort(), ['deleted', 'id', 'success']);
  assert.ok(!JSON.stringify(audit).includes(SECRET_TEXT));
  assert.match(audit.executed_at, /^\d{4}-\d{2}-\d{2}T/);
  // 削除後の dry-run は対象が残っていない。
  const after = planOf(fixture);
  assert.ok(after.storages.filter((s) => s.action === 'delete').every((s) => s.count === 0));
});

test('部分失敗・削除後に残っている場合は成功扱いにしない（audit も success:false）', () => {
  const failing = cleanupFixture({}, { failOn: 'responses_test' });
  const failed = maintenance.cleanupExecute(failing.ports, planOf(failing).confirmation_code);
  assert.equal(failed.success, false);
  assert.equal(failed.status, 'failed');
  assert.deepEqual(failed.storages.find((s) => s.id === 'responses_test'), { id: 'responses_test', deleted: 0, success: false });
  assert.equal(failed.storages.find((s) => s.id === 'responses_production').success, true);
  assert.equal(failing.state.audits[0].success, false);

  const leftover = cleanupFixture({}, { leaveOver: 'responses_production' });
  const result = maintenance.cleanupExecute(leftover.ports, planOf(leftover).confirmation_code);
  assert.equal(result.success, false, '再 scan で残っていれば失敗');
  assert.equal(result.storages.find((s) => s.id === 'responses_production').success, false);
});

test('manual_required は手動完了が記録されるまで完了扱いにしない', () => {
  const manualIds = maintenance.STORAGE_INVENTORY.filter((s) => s.automation === 'manual_required').map((s) => s.id);
  const done = Object.fromEntries(manualIds.map((id) => [id, true]));
  const fixture = cleanupFixture({ keep_final_snapshot: false }, { manual: done });
  const plan = planOf(fixture);
  assert.ok(plan.manual_required.every((m) => m.completed === true));
  assert.ok(plan.storages.filter((s) => s.automation === 'manual_required').every((s) => s.action === 'manual_done'));
  const result = maintenance.cleanupExecute(fixture.ports, plan.confirmation_code);
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.manual_required_pending, []);
  const partial = cleanupFixture({ keep_final_snapshot: false }, { manual: { admin_script_properties: true } });
  const partialResult = maintenance.cleanupExecute(partial.ports, planOf(partial).confirmation_code);
  assert.equal(partialResult.status, 'completed_manual_required_pending');
  assert.ok(!partialResult.manual_required_pending.includes('admin_script_properties'));
});

test('audit は許可キーだけを保存し、件数・文字数の上限内に収める', () => {
  const dirty = { executed_at: 'x', policy_version: 'v', success: true, respondent_hash: 'h', free_text: 'secret', storages: [{ id: 'a', deleted: 1, success: true, rows: ['secret'] }], manual_required: [{ id: 'm', completed: false, note: 'secret' }] };
  const clean = maintenance.sanitizeAudit(dirty);
  assert.deepEqual(Object.keys(clean).sort(), [...maintenance.AUDIT_KEYS].sort());
  assert.ok(!JSON.stringify(clean).includes('secret'));
  let json = '[]';
  for (let i = 0; i < 12; i++) json = JSON.stringify(maintenance.appendAuditList(json, dirty));
  assert.ok(JSON.parse(json).length <= 5);
  assert.ok(json.length <= 8000);
  assert.deepEqual(maintenance.appendAuditList('{broken', dirty).length, 1);
});
