'use strict';
// Issue #450：Public snapshot が 30 件時点で止まる問題。
//  - 原因：validateSnapshot が、公開済みセルの id（離脱理由の選択肢 'age'・地方ブロック 'overseas'）を
//    非公開設問 / 詳細都道府県の ID と文字列一致で誤検知し、セルが公開される件数に達した更新が全て snapshot_invalid になっていた。
//  - refresh の失敗段階・理由を、個票を含まない allowlist 済みの診断（public_snapshot!D1）に残し、Admin が readonly で確認できる。
// 実Google・本番Spreadsheetへは接続しない（全て架空の fixture）。
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { loadPublic, plain, NOW } = require('./helpers/gas-env');
const { createAdminEnv } = require('./helpers/admin-env');
const { rowsFrom, header } = require('./helpers/fixtures');
const SnapshotStore = require('../src/snapshot-store.js');
const aggregate = require('../src/survey-aggregate.js');
const schema = require('../survey.schema.json');

const DAY = 24 * 3600 * 1000;
const at = (offsetMs) => new Date(NOW.getTime() + offsetMs);
const sha = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const ATTENDEE = { club_awareness: 'attended', last_attended: 'within_3m' };
const INTERESTED = { club_awareness: 'aware_not_attended', catchball_interest: 'very_interested' };
// 実運用で公開されるセル id が、非公開設問 id（age）・詳細都道府県 id（overseas）と同じ文字列になる回答。
// 'age' は attendance_lapse_reasons（離脱理由）の選択肢 ID、'overseas' は地方ブロック（詳細都道府県 option と同名）。
const LAPSED_ABROAD = { club_awareness: 'attended', last_attended: 'over_1y', attendance_lapse_reasons: ['age'], prefecture: 'overseas', residence_country: 'FIXTURE-COUNTRY' };

/** 「30 件の last-known-good」を作る回答。 */
const baseRows = () => rowsFrom([{ count: 15, overrides: ATTENDEE }, { count: 15, overrides: INTERESTED }]);
/** 30 件 + 63 件 = 93 件（公開 total 90）。 */
const addedRows = () => rowsFrom([{ count: 33, overrides: LAPSED_ABROAD }, { count: 30, overrides: ATTENDEE }]);

function append(env, ctx, rowObjects) {
  const sheet = env.spreadsheet.getSheetByName('responses');
  const head = plain(ctx.responseHeader_());
  rowObjects.forEach((row) => sheet.rows.push(head.map((name) => (row[name] === undefined ? '' : row[name]))));
}
const storeSheet = (env) => env.spreadsheet.getSheetByName('public_snapshot');
const metaOf = (env) => SnapshotStore.parseMeta(storeSheet(env).rows[0][0]);
const diagOf = (env) => SnapshotStore.parseDiagnostics(storeSheet(env).rows[0][SnapshotStore.DIAG_COLUMN - 1]);
const rawDiagCell = (env) => String(storeSheet(env).rows[0][SnapshotStore.DIAG_COLUMN - 1] || '');
const results = (ctx, now = NOW) => plain(ctx.processResults_(now));
/** 公開 API が返すはずの last-known-good（refresh を走らせずに store から読む）。 */
const lastKnownGood = (ctx) => ({ ok: true, snapshot: plain(ctx.loadStoredSnapshot_()).snapshot });
const cellOf = (snapshot, qid, cid) => snapshot.questions.find((q) => q.id === qid).cells.find((c) => c.id === cid);

/** 30 件の last-known-good が保存済みで、現在は 93 件の有効回答がある状態。 */
function lastKnownGood30Current93() {
  const loaded = loadPublic();
  append(loaded.env, loaded.ctx, baseRows());
  assert.deepEqual(plain(loaded.ctx.refreshPublicSnapshot_(NOW)), { updated: true, reason: 'initial' });
  assert.equal(metaOf(loaded.env).exact_total, 30);
  append(loaded.env, loaded.ctx, addedRows());
  return loaded;
}

// ── 原因：公開済みセル id の誤検知 ──

test('fixture の前提：93 件では age（離脱理由）と overseas（地方ブロック）のセルが公開される', () => {
  const rows = baseRows().concat(addedRows());
  const cls = aggregate.classifyRows(schema, rows);
  assert.equal(cls.valid.length, 93);
  const at30 = aggregate.buildSnapshot(schema, aggregate.classifyRows(schema, baseRows()).valid, { generatedAt: NOW });
  const at93 = aggregate.buildSnapshot(schema, cls.valid, { generatedAt: NOW });
  const published = (snap, qid, cid) => { const c = snap.questions.find((q) => q.id === qid).cells.find((x) => x.id === cid); return !!c && typeof c.count === 'number'; };
  assert.equal(published(at30, 'attendance_lapse_reasons', 'age'), false, '30 件では閾値未満で非公開（だから 30 件の snapshot は検証を通っていた）');
  assert.equal(published(at93, 'attendance_lapse_reasons', 'age'), true);
  assert.equal(published(at93, aggregate.REGION_ID, 'overseas'), true);
});

test('公開済みセルの id が非公開設問 / 詳細都道府県 id と同名でも、validateSnapshot は通る', () => {
  const valid = aggregate.classifyRows(schema, baseRows().concat(addedRows())).valid;
  const snapshot = aggregate.buildSnapshot(schema, valid, { generatedAt: NOW });
  assert.deepEqual(aggregate.validateSnapshotDetailed(schema, snapshot), []);
  assert.deepEqual(aggregate.validateSnapshot(schema, snapshot), []);
});

test('それ以外の位置での漏えいは従来どおり検出する（セル id 免除はその設問の option / ブロック id に限る）', () => {
  const valid = aggregate.classifyRows(schema, baseRows().concat(addedRows())).valid;
  const make = () => JSON.parse(JSON.stringify(aggregate.buildSnapshot(schema, valid, { generatedAt: NOW })));
  const categories = (snap) => aggregate.validateSnapshotDetailed(schema, snap).map((p) => p.category);

  const leakedLabel = make();
  leakedLabel.questions[0].label = 'age';
  assert.ok(categories(leakedLabel).includes('private_value_detected'), '非公開設問 id が label に出ている');

  const wrongQuestion = make();
  const other = wrongQuestion.questions.find((q) => q.id === 'attendance_lapse_reasons');
  other.cells[0].id = 'pref_23';
  assert.ok(categories(wrongQuestion).includes('private_value_detected'), '詳細都道府県 id が cell id に出ている');

  const foreignCell = make();
  foreignCell.questions.find((q) => q.id === aggregate.REGION_ID).cells[0].id = 'age';
  assert.ok(categories(foreignCell).includes('private_value_detected'), 'その設問の定義にない cell id（他設問の option id）は免除しない');

  const privateKey = make();
  privateKey.questions[0].respondent_hash = 'x';
  assert.ok(categories(privateKey).includes('private_key_detected'));
});

test('validateSnapshotDetailed は固定 allowlist の category と schema 上の設問 id だけを返す', () => {
  assert.deepEqual(SnapshotStore.DIAG_VALIDATION_CATEGORIES, aggregate.VALIDATION_CATEGORIES);
  const valid = aggregate.classifyRows(schema, baseRows().concat(addedRows())).valid;
  const snapshot = JSON.parse(JSON.stringify(aggregate.buildSnapshot(schema, valid, { generatedAt: NOW })));
  snapshot.schema_version = 'x';
  snapshot.survey_id = 'other';
  snapshot.production_valid_total = 11;
  const barriers = snapshot.questions.find((q) => q.id === 'attendance_lapse_reasons');
  barriers.cells.forEach((c) => { if (typeof c.count === 'number') c.count = 1; });
  const problems = aggregate.validateSnapshotDetailed(schema, snapshot);
  assert.ok(problems.length >= 3);
  const ids = schema.questions.map((q) => q.id);
  problems.forEach((p) => {
    assert.ok(aggregate.VALIDATION_CATEGORIES.includes(p.category), p.category);
    assert.ok(p.question_id === null || ids.includes(p.question_id), String(p.question_id));
  });
  assert.ok(problems.some((p) => p.category === 'version_mismatch'));
  assert.ok(problems.some((p) => p.category === 'live_count'));
  assert.ok(problems.some((p) => p.category === 'small_cell_suppression' && p.question_id === 'attendance_lapse_reasons'));
  assert.deepEqual(aggregate.validateSnapshot(schema, snapshot), problems.map((p) => p.message));
});

// ── 30 件の last-known-good から 90 件超へ ──

test('30 件の last-known-good が存在し現在 93 件：count trigger で更新され、buildSnapshot → validate → plan → write → verify が通る', () => {
  const { env, ctx } = lastKnownGood30Current93();
  const policy = plain(ctx.SurveyAggregate.snapshotPolicy(ctx.SURVEY_SCHEMA));
  assert.ok(93 - 30 >= policy.countTriggerIncrement);
  const later = at(2 * 3600 * 1000); // 1 日未満：daily ではなく count trigger
  assert.deepEqual(plain(ctx.refreshPublicSnapshot_(later)), { updated: true, reason: 'count_increment' });
  const meta = metaOf(env);
  assert.equal(meta.exact_total, 93);
  assert.equal(meta.public_total, 90);
  assert.equal(meta.reason, 'count_increment');
  // 保存された snapshot を読み戻して検証できる（chunk・digest・schema/version・validateSnapshot）。
  const loaded = plain(ctx.loadStoredSnapshot_());
  assert.equal(loaded.ok, true);
  assert.deepEqual(aggregate.validateSnapshot(schema, loaded.snapshot), []);
  assert.equal(loaded.snapshot.production_valid_total, 90);
  assert.equal(typeof cellOf(loaded.snapshot, 'attendance_lapse_reasons', 'age').count, 'number');
  assert.equal(results(ctx, later).snapshot.production_valid_total, 90);
});

test('同じ 93 件 fixture を Node 側で組み立てても buildSnapshot → validateSnapshot → plan → write → verify が通る（chunk 分割を含む）', () => {
  const valid = aggregate.classifyRows(schema, baseRows().concat(addedRows())).valid;
  const snapshot = aggregate.buildSnapshot(schema, valid, { generatedAt: NOW });
  assert.deepEqual(aggregate.validateSnapshot(schema, snapshot), []);
  const json = JSON.stringify(snapshot);
  const previous = SnapshotStore.plan(json, sha(json), { generatedAt: NOW.toISOString(), exactTotal: 30, publicTotal: 30, reason: 'initial', updatedAt: NOW.toISOString(), surveyVersion: 'a', schemaVersion: 'b', designVersion: 'c' }, null).meta;
  const planned = SnapshotStore.plan(json, sha(json), { generatedAt: snapshot.generated_at, exactTotal: 93, publicTotal: snapshot.production_valid_total, reason: 'count_increment', updatedAt: NOW.toISOString(), surveyVersion: 'a', schemaVersion: 'b', designVersion: 'c' }, previous);
  assert.notEqual(planned.slot, previous.slot, 'slot を切り替える');
  const grid = planned.chunkCells.map((c, i) => [i === 0 ? planned.metaCell : '', planned.slot === 0 ? c : '', planned.slot === 1 ? c : '']);
  const read = SnapshotStore.readGrid(grid, sha);
  assert.equal(read.ok, true);
  assert.equal(read.json, json);
  // 小さい chunk 上限を超える大きさでも分割して読み戻せる。
  const big = JSON.stringify({ snapshot, pad: 'x'.repeat(SnapshotStore.CHUNK_SIZE * 2) });
  const bigPlan = SnapshotStore.plan(big, sha(big), { generatedAt: NOW.toISOString(), exactTotal: 93, publicTotal: 90, reason: 'daily', updatedAt: NOW.toISOString(), surveyVersion: 'a', schemaVersion: 'b', designVersion: 'c' }, previous);
  assert.ok(bigPlan.chunkCells.length >= 3);
  const bigGrid = bigPlan.chunkCells.map((c, i) => [i === 0 ? bigPlan.metaCell : '', bigPlan.slot === 0 ? c : '', bigPlan.slot === 1 ? c : '']);
  assert.equal(SnapshotStore.readGrid(bigGrid, sha).json, big);
});

// ── 診断：成功 / skipped / failed ──

test('refresh 成功：診断は success / verify / count_increment と previous exact・current valid・increment・classify summary を持つ', () => {
  const { env, ctx } = lastKnownGood30Current93();
  const later = at(2 * 3600 * 1000);
  ctx.refreshPublicSnapshot_(later);
  const diag = plain(diagOf(env));
  assert.equal(diag.result, 'success');
  assert.equal(diag.stage, 'verify');
  assert.equal(diag.reason, 'count_increment');
  assert.equal(diag.attempted_at, later.toISOString());
  assert.equal(diag.previous_exact_total, 30);
  assert.equal(diag.current_valid_total, 93);
  assert.equal(diag.increment, 63);
  assert.equal(diag.error_class, null);
  assert.equal(diag.validate, null);
  assert.equal(diag.classify.rows, 93);
  assert.equal(diag.classify.production_valid, 93);
  assert.equal(diag.classify.test_excluded, 0);
  assert.equal(diag.classify.excluded_total, 0);
  assert.deepEqual(Object.keys(diag.classify.version_mismatch_fields).sort(), ['design_version', 'schema_version', 'survey_version']);
  // 診断は snapshot の有効性に影響しない（meta が指す chunk は無傷）。
  assert.equal(plain(ctx.loadStoredSnapshot_()).ok, true);
});

test('更新条件を満たさない試行は skipped（段階・理由・件数つき）', () => {
  const { env, ctx } = loadPublic();
  append(env, ctx, baseRows());
  ctx.refreshPublicSnapshot_(NOW);
  // 行数の事前判定で終わる（全行を読まない）
  ctx.refreshPublicSnapshot_(at(3600000));
  let diag = plain(diagOf(env));
  assert.deepEqual([diag.result, diag.stage, diag.reason, diag.previous_exact_total, diag.current_valid_total, diag.increment], ['skipped', 'load', 'insufficient_increment', 30, null, null]);
  // 増分は minimumIncrement 以上だが間隔未満かつ countTrigger 未満：判定は classify の後
  const policy = plain(ctx.SurveyAggregate.snapshotPolicy(ctx.SURVEY_SCHEMA));
  append(env, ctx, rowsFrom([{ count: policy.minimumIncrement, overrides: ATTENDEE }]));
  ctx.refreshPublicSnapshot_(at(7200000));
  diag = plain(diagOf(env));
  assert.deepEqual([diag.result, diag.stage, diag.reason, diag.previous_exact_total, diag.current_valid_total, diag.increment], ['skipped', 'classify', 'not_due', 30, 30 + policy.minimumIncrement, policy.minimumIncrement]);
  assert.equal(diag.classify.production_valid, 30 + policy.minimumIncrement);
});

test('snapshot_invalid：last-known-good を維持し、段階 validate・種別件数・設問 id が診断に残る（公開 API は ok:true のまま）', () => {
  const { env, ctx } = lastKnownGood30Current93();
  const before = metaOf(env);
  const good = lastKnownGood(ctx);
  const later = at(2 * 3600 * 1000);
  const real = ctx.SurveyAggregate.validateSnapshotDetailed;
  const realPlain = ctx.SurveyAggregate.validateSnapshot;
  const forced = [
    { category: 'small_cell_suppression', question_id: 'attendance_lapse_reasons', message: 'barriers: SECRET-MESSAGE-ZZ' },
    { category: 'complementary_suppression', question_id: 'top_uniform', message: 'x' },
    { category: 'complementary_suppression', question_id: 'main_barrier', message: 'x' }
  ];
  ctx.SurveyAggregate.validateSnapshotDetailed = (sch, snap) => (snap.generated_at === later.toISOString() ? forced : real(sch, snap));
  ctx.SurveyAggregate.validateSnapshot = (sch, snap) => (snap.generated_at === later.toISOString() ? forced.map((p) => p.message) : realPlain(sch, snap));
  assert.deepEqual(plain(ctx.refreshPublicSnapshot_(later)), { updated: false, reason: 'snapshot_invalid' });
  assert.deepEqual(metaOf(env), before, 'meta は更新しない');
  const diag = plain(diagOf(env));
  assert.deepEqual([diag.result, diag.stage, diag.reason], ['failed', 'validate', 'snapshot_invalid']);
  assert.equal(diag.previous_exact_total, 30);
  assert.equal(diag.current_valid_total, 93);
  assert.equal(diag.increment, 63);
  assert.equal(diag.validate.problem_total, 3);
  assert.equal(diag.validate.categories.small_cell_suppression, 1);
  assert.equal(diag.validate.categories.complementary_suppression, 2);
  assert.deepEqual(diag.validate.question_ids, ['attendance_lapse_reasons', 'top_uniform', 'main_barrier']);
  assert.ok(!rawDiagCell(env).includes('SECRET-MESSAGE-ZZ'), '問題の message 全文は保存しない');
  // 公開 API は従来どおり last-known-good を ok:true で返す。
  assert.deepEqual(results(ctx, later), good);
});

test('verify_failed：読み戻し不一致では meta を更新せず、段階 verify・reason verify_failed を診断に残す', () => {
  const { env, ctx } = lastKnownGood30Current93();
  const before = metaOf(env);
  const sheet = storeSheet(env);
  sheet.hooks.onWrite = (range, values) => { if (range.col !== SnapshotStore.DIAG_COLUMN && range.col > 1) values[0][0] = 'c:corrupted'; };
  assert.deepEqual(plain(ctx.refreshPublicSnapshot_(at(2 * 3600 * 1000))), { updated: false, reason: 'verify_failed' });
  assert.deepEqual(metaOf(env), before);
  const diag = plain(diagOf(env));
  assert.deepEqual([diag.result, diag.stage, diag.reason, diag.error_class], ['failed', 'verify', 'verify_failed', null]);
  assert.equal(diag.current_valid_total, 93);
  assert.equal(plain(ctx.loadStoredSnapshot_()).ok, true, 'last-known-good は有効なまま');
});

test('想定外の例外：公開 API は壊れず last-known-good を返し、診断には段階と分類コードだけが残る（message・stack・ID・secret は残らない）', () => {
  const secrets = ['SECRET-SPREADSHEET-ID-1A2B3C', 'ya29.OAUTH-TOKEN-ZZZ', 'AKfycbxDEPLOYMENT-ID', 'RESPONDENT-SALT-XYZ'];
  const stages = [
    ['classify', (ctx) => { ctx.SurveyAggregate.classifyRows = () => { throw new Error(secrets.join(' ')); }; }],
    ['build', (ctx) => { ctx.SurveyAggregate.buildSnapshot = () => { throw new TypeError(secrets.join(' ')); }; }],
    ['plan', (ctx) => { ctx.SnapshotStore.plan = () => { throw new Error('Service invoked too many times ' + secrets[0]); }; }],
    ['write', (ctx, env) => { storeSheet(env).hooks.onWrite = (range) => { if (range.col !== SnapshotStore.DIAG_COLUMN) throw new Error(secrets.join(' ')); }; }]
  ];
  stages.forEach(([stage, sabotage]) => {
    const { env, ctx } = lastKnownGood30Current93();
    const good = lastKnownGood(ctx);
    const before = metaOf(env);
    sabotage(ctx, env);
    const later = at(2 * 3600 * 1000);
    assert.deepEqual(plain(ctx.refreshPublicSnapshot_(later)), { updated: false, reason: 'failed' }, stage);
    assert.deepEqual(metaOf(env), before, stage);
    const diag = plain(diagOf(env));
    assert.deepEqual([diag.result, diag.stage, diag.reason], ['failed', stage, 'exception']);
    assert.ok(SnapshotStore.DIAG_ERROR_CLASSES.includes(diag.error_class), diag.error_class);
    const cell = rawDiagCell(env);
    const logs = env.logs.join('\n');
    secrets.concat(['Error:', 'at ', 'stack']).forEach((word) => {
      assert.ok(!cell.includes(word), `${stage}: 診断に ${word} が残っている`);
      assert.ok(!logs.includes(word) || word === 'at ' || word === 'stack' || word === 'Error:', `${stage}: ログに ${word}`);
    });
    secrets.forEach((word) => assert.ok(!logs.includes(word), `${stage}: ログに secret`));
    assert.deepEqual(results(ctx, later), good, `${stage}: 公開 API は last-known-good を返す`);
    assert.equal(env.lockHeld, false);
  });
  const { env, ctx } = lastKnownGood30Current93();
  ctx.SnapshotStore.plan = () => { throw new Error('Service invoked too many times'); };
  ctx.refreshPublicSnapshot_(at(2 * 3600 * 1000));
  assert.equal(diagOf(env).error_class, 'service_quota');
});

test('classifyError は固定 allowlist のコードだけを返す', () => {
  const cases = [
    [new Error('not_configured'), 'not_configured'], [new Error('responses_sheet_missing'), 'responses_sheet_missing'], [new Error('header_mismatch'), 'header_mismatch'],
    [new Error('Service invoked too many times for one day: premium'), 'service_quota'], [new Error('Exceeded maximum execution time'), 'timeout'],
    [new Error('You do not have permission to access SECRET'), 'permission'], [new TypeError('x is not a function'), 'programming_error'],
    [new Error('anything else with SECRET-ID'), 'unknown'], [null, 'unknown'], ['text', 'unknown'], [{ message: 42 }, 'unknown']
  ];
  cases.forEach(([error, expected]) => {
    const got = SnapshotStore.classifyError(error);
    assert.equal(got, expected);
    assert.ok(SnapshotStore.DIAG_ERROR_CLASSES.includes(got));
  });
});

test('診断の正規化：allowlist 外の値・未知のキー・個票らしき値は保存も表示もしない（書き込み側も読み出し側も同じ）', () => {
  const dirty = {
    attempted_at: NOW.toISOString(), result: 'failed', stage: 'validate', reason: 'snapshot_invalid', error_class: 'SECRET-CLASS',
    previous_exact_total: 30, current_valid_total: 93, increment: 63,
    respondent_hash: 'a'.repeat(64), spreadsheet_id: '1AbC', message: 'boom', stack: 'at x',
    classify: { rows: 93, production_valid: 93, test_excluded: 0, excluded: { duplicate: 2, 'uuid-like-key': 9 }, rows_detail: [{ respondent_hash: 'b'.repeat(64) }], version_mismatch_fields: { survey_version: 1, extra: 5 } },
    validate: { problem_total: 2, categories: { small_cell_suppression: 1, 'free text here': 1 }, question_ids: ['barriers', 'Not An Id!', 'a'.repeat(100), 'barriers'] }
  };
  const cell = SnapshotStore.encodeDiagnostics(dirty);
  const text = JSON.stringify(SnapshotStore.parseDiagnostics(cell));
  ['respondent_hash', 'a'.repeat(64), 'b'.repeat(64), 'spreadsheet_id', '1AbC', 'boom', 'at x', 'SECRET-CLASS', 'uuid-like-key', 'free text', 'Not An Id', 'rows_detail', 'extra'].forEach((w) => assert.ok(!cell.includes(w) && !text.includes(w), w));
  const clean = SnapshotStore.parseDiagnostics(cell);
  assert.equal(clean.error_class, null);
  assert.equal(clean.classify.excluded.duplicate, 2);
  assert.equal(clean.classify.excluded_total, 2);
  assert.deepEqual(clean.validate.question_ids, ['barriers']);
  // 必須項目が allowlist 外・時刻が不正なら診断として扱わない。
  ['result', 'stage', 'reason'].forEach((k) => assert.equal(SnapshotStore.encodeDiagnostics(Object.assign({}, dirty, { [k]: 'bogus' })), null, k));
  assert.equal(SnapshotStore.encodeDiagnostics(Object.assign({}, dirty, { attempted_at: 'nope' })), null);
  assert.equal(SnapshotStore.parseDiagnostics('g:{not json'), null);
  assert.equal(SnapshotStore.parseDiagnostics('m:{}'), null);
  assert.equal(SnapshotStore.parseDiagnostics(undefined), null);
});

test('classify summary と診断セルに、個別回答・hash・自由記述・UUID・Spreadsheet ID が含まれない', () => {
  const { env, ctx } = loadPublic();
  const rows = rowsFrom([
    { count: 15, overrides: Object.assign({ feedback: 'SECRET-FREE-TEXT-ZZ' }, ATTENDEE) },
    { count: 15, overrides: INTERESTED },
    { count: 4, meta: { response_mode: 'test', test_run_id: 'run-secret' } },
    { count: 3, overrides: { age_confirmed: 'under_18' } },
    { count: 3, meta: { schema_version: '99' } }
  ]);
  append(env, ctx, rows);
  ctx.refreshPublicSnapshot_(NOW);
  const diag = plain(diagOf(env));
  assert.equal(diag.classify.rows, 40);
  assert.equal(diag.classify.production_valid, 30);
  assert.equal(diag.classify.test_excluded, 4);
  assert.equal(diag.classify.excluded.schema_invalid, 3, '18歳未満の回答に後続設問が付いた行は schema_invalid');
  assert.equal(diag.classify.excluded.version_mismatch, 3);
  assert.equal(diag.classify.version_mismatch_fields.schema_version, 3);
  assert.equal(diag.classify.excluded_total, 6);
  assert.equal(diag.classify.rows, 40);
  const cell = rawDiagCell(env);
  rows.forEach((row) => assert.ok(!cell.includes(row.respondent_hash)));
  assert.ok(!/SECRET-|run-secret|sheet-id|salt|token|owner@example/i.test(cell));
  assert.ok(!/[0-9a-f]{32,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i.test(cell));
  assert.ok(cell.length < 2000);
});

test('同じ結果の skipped は一定時間は書き直さず、内容が変われば書き直す。回答保存の成否・responses には影響しない', () => {
  const { env, ctx } = loadPublic();
  append(env, ctx, baseRows());
  ctx.refreshPublicSnapshot_(NOW);
  ctx.refreshPublicSnapshot_(at(60000));
  const first = rawDiagCell(env);
  ctx.refreshPublicSnapshot_(at(120000));
  assert.equal(rawDiagCell(env), first, '同じ skipped は 1 時間以内なら書き直さない');
  assert.equal(diagOf(env).attempted_at, at(60000).toISOString());
  ctx.refreshPublicSnapshot_(at(61 * 60000 + 60000));
  assert.equal(diagOf(env).attempted_at, at(62 * 60000).toISOString(), '1 時間を過ぎたら書き直す');
  const rowsBefore = JSON.stringify(env.spreadsheet.getSheetByName('responses').rows);
  storeSheet(env).hooks.onWrite = () => { throw new Error('diag write failed'); };
  ctx.SurveyAggregate.classifyRows = () => { throw new Error('boom'); };
  append(env, ctx, rowsFrom([{ count: 12, overrides: ATTENDEE }]));
  assert.deepEqual(plain(ctx.refreshPublicSnapshot_(at(3 * DAY))), { updated: false, reason: 'failed' }, '診断の書き込みに失敗しても refresh の結果は変わらない');
  assert.ok(JSON.stringify(env.spreadsheet.getSheetByName('responses').rows).startsWith(rowsBefore.slice(0, -2)));
  assert.equal(env.lockHeld, false);
});

test('responses を検証できない段階で落ちた場合、診断のために public_snapshot シートを新規作成しない', () => {
  const { env, ctx } = loadPublic();
  env.spreadsheet.getSheetByName('responses').rows[0][0] = 'unexpected';
  assert.deepEqual(plain(ctx.refreshPublicSnapshot_(NOW)), { updated: false, reason: 'failed' });
  assert.equal(storeSheet(env), null);
});

// ── 公開 API には診断を出さない ──

test('GET ?action=results は privacy-safe snapshot だけを返し、診断・失敗理由・件数詳細を含まない（refresh が失敗していても）', () => {
  const { env, ctx } = lastKnownGood30Current93();
  ctx.SurveyAggregate.classifyRows = () => { throw new Error('boom'); };
  const body = JSON.parse(ctx.doGet({ parameter: { action: 'results' } }).getContent());
  assert.equal(body.ok, true);
  assert.deepEqual(Object.keys(body).sort(), ['ok', 'snapshot']);
  assert.deepEqual(aggregate.validateSnapshot(schema, body.snapshot), []);
  assert.equal(body.snapshot.production_valid_total, 30, '失敗中は last-known-good');
  const text = JSON.stringify(body);
  ['attempted_at', 'stage', 'error_class', 'previous_exact_total', 'current_valid_total', 'increment', 'classify', 'refresh', 'diagnostic', 'exception', 'g:'].forEach((w) => assert.ok(!text.includes(w), w));
  assert.equal(diagOf(env).result, 'failed');
  // 成功後の応答も同じ形。
  const ok = lastKnownGood30Current93();
  const okBody = JSON.parse(ok.ctx.doGet({ parameter: { action: 'results' } }).getContent());
  assert.deepEqual(Object.keys(okBody).sort(), ['ok', 'snapshot']);
});

// ── Admin ──

/** Public GAS の public_snapshot シート全体を、Admin の Sheets API 読み取り形式（行配列）にする。 */
const gridOf = (env) => storeSheet(env).rows.map((line) => line.slice());

test('Admin：refresh 診断・current valid / previous exact / increment / classify を確認でき、従来の項目も維持される', () => {
  const { env, ctx } = lastKnownGood30Current93();
  const publicValid = aggregate.classifyRows(schema, baseRows().concat(addedRows())).valid;
  const stuck = lastKnownGood30Current93();
  // Public 側で更新に失敗し続けている状態（last-known-good は 30 件のまま）。
  stuck.ctx.SurveyAggregate.classifyRows = () => { throw new Error('boom'); };
  const attemptedAt = at(2 * 3600 * 1000);
  stuck.ctx.refreshPublicSnapshot_(attemptedAt);
  assert.equal(publicValid.length, 93);
  const admin = createAdminEnv(baseRows().concat(addedRows()), { publicSnapshotGrid: gridOf(stuck.env) });
  const status = plain(admin.ctx.getPublicSnapshotStatus_(attemptedAt));
  assert.equal(status.status, 'ok');
  // 従来の項目
  assert.equal(status.generated_at, NOW.toISOString());
  assert.equal(status.exact_total_at_generation, 30);
  assert.equal(status.current_production_valid_total, 93);
  assert.equal(status.increment, 63);
  assert.equal(status.would_update, true);
  assert.equal(status.decision_reason, 'count_increment');
  assert.equal(status.conditions.next_daily_at, new Date(NOW.getTime() + DAY).toISOString());
  assert.ok(status.diff && Array.isArray(status.diff.changed_questions));
  assert.ok(status.diff.changed_questions.length > 0, 'preview（93 件）と公開中（30 件）の差');
  // 追加項目
  assert.equal(status.refresh.result, 'failed');
  assert.equal(status.refresh.stage, 'classify');
  assert.equal(status.refresh.reason, 'exception');
  assert.equal(status.refresh.previous_exact_total, 30);
  assert.equal(status.admin_classify.production_valid, 93);
  assert.deepEqual(status.preview_validation, { problem_total: 0, categories: Object.fromEntries(aggregate.VALIDATION_CATEGORIES.map((c) => [c, 0])), question_ids: [] });
  // read-only のまま・個票は返さない
  assert.deepEqual(admin.writes, []);
  assert.ok(admin.calls.every((c) => !/update|append|clear|batchUpdate/i.test(c)));
  assert.ok(!/respondent_hash|free_text|other_texts/.test(JSON.stringify(status)));
  assert.ok(env && ctx);
});

test('Admin：Public の classifyRows と Admin の classifyRows は同じ production valid total（Sheets の自動型変換後の version でも一致）', () => {
  const rows = baseRows().concat(addedRows(), rowsFrom([{ count: 4, meta: { response_mode: 'test' } }, { count: 2, overrides: { age_confirmed: 'under_18' } }]));
  // Public は getValues（version が日付なら Date）、Admin は UNFORMATTED_VALUE（日付シリアル値）で読む。
  const { env, ctx } = loadPublic();
  const converted = rows.map((row, i) => (i % 3 === 0 ? Object.assign({}, row, { survey_version: new Date('2026-10-01T00:00:00+09:00') }) : row));
  append(env, ctx, converted);
  const publicCounts = plain(ctx.SurveyAggregate.classifyRows(ctx.SURVEY_SCHEMA, ctx.readResponseRows_(env.spreadsheet.getSheetByName('responses'))).counts);
  const serial = Date.UTC(2026, 9, 1) / 86400000 + 25569;
  const adminRows = rows.map((row, i) => (i % 3 === 0 ? Object.assign({}, row, { survey_version: serial }) : row));
  const admin = createAdminEnv(adminRows, { header: header() });
  const adminCounts = plain(admin.ctx.classifyResponses_().counts);
  assert.equal(publicCounts.production_valid, 93);
  assert.deepEqual(publicCounts, adminCounts);
});

test('Admin：refresh 診断が無い・壊れている・改ざんされている場合は null（allowlist 外の文字列を表示しない）', () => {
  const { env, ctx } = lastKnownGood30Current93();
  const withoutDiag = gridOf(env);
  withoutDiag[0].length = SnapshotStore.DIAG_COLUMN - 1;
  const none = createAdminEnv(baseRows(), { publicSnapshotGrid: withoutDiag });
  assert.equal(plain(none.ctx.getPublicSnapshotStatus_(NOW)).refresh, null);
  ctx.refreshPublicSnapshot_(at(2 * 3600 * 1000));
  const grid = gridOf(env);
  const tampered = grid.map((line) => line.slice());
  tampered[0][SnapshotStore.DIAG_COLUMN - 1] = 'g:' + JSON.stringify({ attempted_at: NOW.toISOString(), result: 'failed', stage: 'validate', reason: 'DROP TABLE', error_class: 'x' });
  assert.equal(plain(createAdminEnv(baseRows(), { publicSnapshotGrid: tampered }).ctx.getPublicSnapshotStatus_(NOW)).refresh, null);
  const injected = grid.map((line) => line.slice());
  injected[0][SnapshotStore.DIAG_COLUMN - 1] = 'g:' + JSON.stringify(Object.assign(JSON.parse(rawDiagCell(env).slice(2)), { error_class: 'SECRET-TEXT', respondent_hash: 'z'.repeat(64) }));
  const shown = JSON.stringify(plain(createAdminEnv(baseRows(), { publicSnapshotGrid: injected }).ctx.getPublicSnapshotStatus_(NOW)).refresh);
  assert.ok(!shown.includes('SECRET-TEXT') && !shown.includes('zzzz'));
});

test('Admin：store の snapshot が読めなくても（empty / invalid）、refresh 診断は確認できる', () => {
  const { env, ctx } = lastKnownGood30Current93();
  ctx.SurveyAggregate.classifyRows = () => { throw new Error('boom'); };
  ctx.refreshPublicSnapshot_(at(2 * 3600 * 1000));
  const grid = gridOf(env);
  grid[0][0] = '';
  const status = plain(createAdminEnv(baseRows(), { publicSnapshotGrid: grid }).ctx.getPublicSnapshotStatus_(NOW));
  assert.equal(status.status, 'empty');
  assert.equal(status.refresh.stage, 'classify');
});
