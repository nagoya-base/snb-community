'use strict';
// Public GAS の公開結果 endpoint と snapshot 永続化（Issue #425）。実Google・本番Spreadsheetへは接続しない（全て架空の fixture）。
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { loadPublic, validPayload, plain, NOW } = require('./helpers/gas-env');
const { rowsFrom, rowFor, answersFor } = require('./helpers/fixtures');
const SnapshotStore = require('../src/snapshot-store.js');
const aggregate = require('../src/survey-aggregate.js');
const schema = require('../survey.schema.json');

const DAY = 24 * 3600 * 1000;
const INTERESTED = { club_awareness: 'aware_not_attended', catchball_interest: 'very_interested' };
const ATTENDEE = { club_awareness: 'attended', last_attended: 'within_3m' };
const sha = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const at = (offsetMs) => new Date(NOW.getTime() + offsetMs);

/** 十分な回答（45 件：公開される設問がある）。 */
const rich = () => rowsFrom([
  { count: 25, overrides: Object.assign({}, ATTENDEE, { overall_satisfaction: '5' }) },
  { count: 20, overrides: Object.assign({}, INTERESTED, { favorite_uniforms: ['baseball'] }) }
]);

function append(env, ctx, rowObjects) {
  const sheet = env.spreadsheet.getSheetByName('responses');
  const header = plain(ctx.responseHeader_());
  rowObjects.forEach((row) => sheet.rows.push(header.map((name) => (row[name] === undefined ? '' : row[name]))));
}
const policyOf = (ctx) => plain(ctx.SurveyAggregate.snapshotPolicy(ctx.SURVEY_SCHEMA));
const storeSheet = (env) => env.spreadsheet.getSheetByName('public_snapshot');
const metaOf = (env) => SnapshotStore.parseMeta(storeSheet(env).rows[0][0]);
const results = (ctx, now = NOW) => plain(ctx.processResults_(now));
const more = (count) => rowsFrom([{ count, overrides: ATTENDEE }]);

// ── endpoint ──

test('action=results は privacy-safe snapshot を返し、回答がまだ無くても全項目非公開の初期 snapshot を返す', () => {
  const { env, ctx } = loadPublic();
  const body = JSON.parse(ctx.doGet({ parameter: { action: 'results' } }).getContent());
  assert.equal(body.ok, true);
  assert.deepEqual(aggregate.validateSnapshot(schema, body.snapshot), []);
  assert.ok(body.snapshot.questions.every((q) => q.state !== 'published'));
  assert.equal(body.snapshot.response_status.state, 'collecting');
  assert.equal(metaOf(env).reason, 'initial', 'store が空なら initial snapshot を 1 回だけ保存する');
});

test('store が空のとき、現在の production valid 回答から safe な initial snapshot を 1 回だけ生成する', () => {
  const { env, ctx } = loadPublic();
  append(env, ctx, rich());
  const first = results(ctx);
  assert.equal(first.snapshot.response_status.state, 'counting');
  assert.ok(first.snapshot.questions.some((q) => q.state === 'published'));
  assert.deepEqual(aggregate.validateSnapshot(schema, first.snapshot), []);
  const meta = metaOf(env);
  assert.equal(meta.reason, 'initial');
  assert.equal(meta.exact_total, 45);
  // 2 回目以降は（増分が無いので）再生成せず、同じ snapshot を返す。
  const second = results(ctx, at(5 * DAY));
  assert.deepEqual(second, first);
  assert.equal(metaOf(env).updated_at, meta.updated_at);
});

test('query に回答内容・locale を付けても無視する（結果は同一で、raw にも触れない）', () => {
  const { env, ctx } = loadPublic();
  append(env, ctx, rich());
  const before = JSON.stringify(env.spreadsheet.getSheetByName('responses').rows);
  const plainBody = JSON.parse(ctx.doGet({ parameter: { action: 'results' } }).getContent());
  const withQuery = JSON.parse(ctx.doGet({ parameter: { action: 'results', locale: 'en', answers: '{"age_confirmed":"yes"}', uuid: 'x' } }).getContent());
  assert.deepEqual(withQuery, plainBody);
  assert.equal(JSON.stringify(env.spreadsheet.getSheetByName('responses').rows), before, 'responses は読み取りだけ');
});

test('action=status と回答送信の応答は従来どおり（互換性）', () => {
  const { ctx } = loadPublic();
  const status = JSON.parse(ctx.doGet({ parameter: { action: 'status' } }).getContent());
  assert.deepEqual(Object.keys(status).sort(), ['design_version', 'ok', 'schema_version', 'status', 'survey_version']);
  const base = JSON.parse(ctx.doGet({ parameter: {} }).getContent());
  assert.equal(base.service, 'baseball-uniform-survey');
  assert.equal(base.snapshot, undefined);
});

// ── privacy ──

test('返す JSON に private field・自由記述・hash・timestamp・詳細地域が含まれない', () => {
  const { env, ctx } = loadPublic();
  const rows = rowsFrom([
    { count: 25, overrides: Object.assign({ feedback: 'SECRET-FREE-TEXT-ZZ' }, ATTENDEE), otherTexts: { favorite_uniforms: 'SECRET-OTHER-TEXT-ZZ' } },
    { count: 20, overrides: INTERESTED }
  ]);
  append(env, ctx, rows);
  const body = results(ctx);
  const text = JSON.stringify(body);
  assert.ok(!/SECRET-FREE-TEXT-ZZ|SECRET-OTHER-TEXT-ZZ/.test(text));
  rows.forEach((row) => assert.ok(!text.includes(row.respondent_hash), 'respondent_hash'));
  assert.ok(!/[0-9a-f]{32,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/.test(text), 'hash / UUID らしき値');
  assert.ok(!text.includes('2026-11-10 12:00'), 'timestamp');
  schema.questions.filter((q) => q.type === 'text').forEach((q) => assert.ok(!text.includes(`"${q.id}"`), `自由記述の設問 ${q.id}`));
  const forbidden = ['respondent_hash', 'uuid', 'timestamp', 'source_channel', 'client_elapsed_ms', 'other_texts', 'free_text', 'test_run_id', 'notification_status', 'response_mode', 'completion_status', 'answers', 'rows', 'records'];
  const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.keys(v).forEach((k) => { assert.ok(!forbidden.includes(k), k); walk(v[k]); }); };
  walk(body);
  // 保存された store にも raw は含まれない（snapshot と更新メタデータだけ）。
  const stored = JSON.stringify(storeSheet(env).rows);
  assert.ok(!/SECRET-|respondent_hash/.test(stored));
  rows.forEach((row) => assert.ok(!stored.includes(row.respondent_hash)));
});

test('test 回答・18歳未満・invalid・重複・version_mismatch は snapshot に入らない（Admin と同じ classifyRows）', () => {
  const { env, ctx } = loadPublic();
  const valid = rich();
  const dup = rowFor(answersFor(ATTENDEE), { respondent_hash: valid[0].respondent_hash });
  const extra = rowsFrom([
    { count: 4, meta: { response_mode: 'test', test_run_id: 'run' } },
    { count: 3, overrides: { age_confirmed: 'under_18' } },
    { count: 3, overrides: { club_awareness: 'not_an_option' } },
    { count: 3, meta: { schema_version: '99' } }
  ]);
  append(env, ctx, valid.concat([dup], extra));
  const body = results(ctx);
  const expected = aggregate.buildSnapshot(schema, aggregate.classifyRows(schema, valid).valid, { generatedAt: NOW });
  assert.deepEqual(body.snapshot, plain(expected));
  assert.equal(metaOf(env).exact_total, 45);
});

test('Sheets が version を日付へ自動変換した既存行も、Admin と同じく有効回答として数える', () => {
  const { env, ctx } = loadPublic();
  const rows = rich().map((row, i) => (i < 10 ? Object.assign({}, row, { survey_version: new Date('2026-10-01T00:00:00+09:00') }) : row));
  append(env, ctx, rows);
  assert.equal(results(ctx).snapshot.production_valid_total, aggregate.liveCountDisplay(schema, 45).floor);
  assert.equal(metaOf(env).exact_total, 45);
});

// ── batch 更新（毎回更新しない） ──

test('submit 直後に毎回 snapshot を更新しない（増分が minimumIncrement 未満なら更新しない）', () => {
  const { env, ctx } = loadPublic();
  append(env, ctx, rich());
  results(ctx);
  const before = metaOf(env);
  const policy = policyOf(ctx);
  for (let i = 0; i < policy.minimumIncrement - 1; i++) {
    const res = plain(ctx.processSubmission_(JSON.stringify(validPayload(ctx)), at((i + 1) * 60000)));
    assert.deepEqual(res, { ok: true, status: 'accepted' });
    assert.deepEqual(metaOf(env), before, `${i + 1} 件目の送信では更新しない`);
  }
  // 1 日経過しても、増分が minimumIncrement 未満なら更新しない。
  assert.deepEqual(plain(ctx.refreshPublicSnapshot_(at(3 * DAY))), { updated: false, reason: 'insufficient_increment' });
  assert.deepEqual(metaOf(env), before);
});

test('増分が minimumIncrement 以上でも、間隔未満かつ countTrigger 未満なら更新しない（not_due）', () => {
  const { env, ctx } = loadPublic();
  append(env, ctx, rich());
  results(ctx);
  const before = metaOf(env);
  const policy = policyOf(ctx);
  assert.ok(policy.minimumIncrement < policy.countTriggerIncrement, 'schema の想定');
  append(env, ctx, more(policy.minimumIncrement));
  assert.deepEqual(plain(ctx.refreshPublicSnapshot_(at(2 * 3600 * 1000))), { updated: false, reason: 'not_due' });
  assert.deepEqual(metaOf(env), before);
});

test('count trigger（増分が countTriggerIncrement 以上）で更新する', () => {
  const { env, ctx } = loadPublic();
  append(env, ctx, rich());
  results(ctx);
  const first = metaOf(env);
  const policy = policyOf(ctx);
  append(env, ctx, more(policy.countTriggerIncrement));
  assert.deepEqual(plain(ctx.refreshPublicSnapshot_(at(2 * 3600 * 1000))), { updated: true, reason: 'count_increment' });
  const second = metaOf(env);
  assert.equal(second.exact_total, 45 + policy.countTriggerIncrement);
  assert.equal(second.reason, 'count_increment');
  assert.notEqual(second.slot, first.slot, 'slot を交互に使う');
  assert.deepEqual(aggregate.validateSnapshot(schema, results(ctx, at(2 * 3600 * 1000)).snapshot), []);
});

test('daily 条件（1 日経過 + minimumIncrement 以上）で更新する。results の取得でも判定される', () => {
  const { env, ctx } = loadPublic();
  append(env, ctx, rich());
  results(ctx);
  const policy = policyOf(ctx);
  append(env, ctx, more(policy.minimumIncrement));
  const body = results(ctx, at(DAY + 60000));
  assert.equal(metaOf(env).reason, 'daily');
  assert.equal(metaOf(env).exact_total, 45 + policy.minimumIncrement);
  assert.equal(body.snapshot.generated_at, at(DAY + 60000).toISOString());
});

// ── fail closed / last-known-good ──

test('新しい snapshot が validateSnapshot に通らないときは last-known-good を維持し、壊れた snapshot を公開しない', () => {
  const { env, ctx } = loadPublic();
  append(env, ctx, rich());
  const good = results(ctx);
  const before = metaOf(env);
  const policy = policyOf(ctx);
  append(env, ctx, more(policy.countTriggerIncrement));
  const later = at(2 * DAY);
  const real = ctx.SurveyAggregate.validateSnapshot;
  ctx.SurveyAggregate.validateSnapshot = (sch, snapshot) => (snapshot.generated_at === later.toISOString() ? ['forced_problem'] : real(sch, snapshot));
  assert.deepEqual(plain(ctx.refreshPublicSnapshot_(later)), { updated: false, reason: 'snapshot_invalid' });
  assert.deepEqual(metaOf(env), before);
  assert.deepEqual(results(ctx, later), good, 'last-known-good を返す');
});

test('validateSnapshot が常に失敗し last-known-good も無いなら、endpoint は snapshot を返さず server_error（結果ページは bundled へ fallback）', () => {
  const { ctx } = loadPublic();
  ctx.SurveyAggregate.validateSnapshot = () => ['forced_problem'];
  const body = JSON.parse(ctx.doGet({ parameter: { action: 'results' } }).getContent());
  assert.deepEqual(body, { ok: false, error: 'server_error' });
});

test('保存先の改ざん（digest 不一致）・private field の混入・version 不整合は公開せず、再生成した safe な snapshot を返す', () => {
  const { env, ctx } = loadPublic();
  append(env, ctx, rich());
  results(ctx);
  const sheet = storeSheet(env);
  const meta = metaOf(env);
  const col = 1 + meta.slot;

  // 1) chunk を書き換える（digest 不一致）
  const original = sheet.rows[0][col];
  sheet.rows[0][col] = original.replace('"questions"', '"respondent_hash":"deadbeef","questions"');
  assert.ok(!JSON.stringify(results(ctx)).includes('deadbeef'));
  assert.ok(!JSON.stringify(storeSheet(env).rows).includes('deadbeef'), '再生成された store にも残らない');

  // 2) digest を合わせた上で private field を混入（validateSnapshot が止める）
  const forged = JSON.parse(SnapshotStore.readGrid(storeSheet(env).rows, sha).json);
  forged.questions[0].respondent_hash = 'a'.repeat(64);
  const json = JSON.stringify(forged);
  const planned = SnapshotStore.plan(json, sha(json), { generatedAt: forged.generated_at, exactTotal: 45, publicTotal: forged.production_valid_total, reason: 'daily', updatedAt: NOW.toISOString(), surveyVersion: '2026-10', schemaVersion: '1', designVersion: '2.18' }, null);
  const rowsNow = storeSheet(env).rows;
  rowsNow[0][1 + planned.slot] = planned.chunkCells[0];
  planned.chunkCells.slice(1).forEach((c, i) => { rowsNow[i + 1] = rowsNow[i + 1] || []; rowsNow[i + 1][1 + planned.slot] = c; });
  rowsNow[0][0] = planned.metaCell;
  assert.equal(ctx.loadStoredSnapshot_().ok, false);
  assert.ok(!JSON.stringify(results(ctx)).includes('aaaaaaaa'));

  // 3) meta の version が schema と違う
  const fresh = loadPublic();
  append(fresh.env, fresh.ctx, rich());
  results(fresh.ctx);
  const m = metaOf(fresh.env);
  storeSheet(fresh.env).rows[0][0] = SnapshotStore.META_PREFIX + JSON.stringify(Object.assign({}, m, { schema_version: '99' }));
  assert.equal(fresh.ctx.loadStoredSnapshot_().problem, 'version_mismatch');
});

test('保存途中で失敗しても last-known-good は壊れない（meta は最後に書く）', () => {
  const { env, ctx } = loadPublic();
  append(env, ctx, rich());
  const good = results(ctx);
  const before = metaOf(env);
  append(env, ctx, more(policyOf(ctx).countTriggerIncrement));
  storeSheet(env).hooks.onWrite = () => { throw new Error('write failed'); };
  assert.deepEqual(plain(ctx.refreshPublicSnapshot_(at(2 * DAY))), { updated: false, reason: 'failed' });
  assert.deepEqual(metaOf(env), before);
  assert.deepEqual(results(ctx, at(2 * DAY)), good);
  assert.equal(env.lockHeld, false);
});

test('responses のヘッダーが schema と一致しないときは読まず、initial（全項目非公開）を返す', () => {
  const { env, ctx } = loadPublic();
  env.spreadsheet.getSheetByName('responses').rows[0][0] = 'unexpected';
  const body = results(ctx);
  assert.ok(body.snapshot.questions.every((q) => q.state !== 'published'));
  assert.equal(storeSheet(env), null, '不明な Sheet からは store を作らない');
});

test('snapshot が 1 セル上限を超える場合も chunk に分割して保存・読み戻しできる', () => {
  const big = JSON.stringify({ filler: 'x'.repeat(SnapshotStore.CHUNK_SIZE * 2 + 123) });
  const planned = SnapshotStore.plan(big, sha(big), { generatedAt: NOW.toISOString(), exactTotal: 1, publicTotal: 0, reason: 'initial', updatedAt: NOW.toISOString(), surveyVersion: 'a', schemaVersion: 'b', designVersion: 'c' }, null);
  assert.equal(planned.chunkCells.length, 3);
  assert.ok(planned.chunkCells.every((c) => c.length <= 50000 && c.startsWith('c:')));
  const grid = planned.chunkCells.map((c, i) => (i === 0 ? [planned.metaCell, c, ''] : ['', c, '']));
  const read = SnapshotStore.readGrid(grid, sha);
  assert.equal(read.ok, true);
  assert.equal(read.json, big);
  // chunk 欠落 / digest 不一致 / 長さ不一致 / 不明な meta key
  assert.equal(SnapshotStore.readGrid(grid.slice(0, 2), sha).problem, 'chunk_missing');
  const tampered = grid.map((r) => r.slice());
  tampered[1][1] = 'c:' + 'y'.repeat(SnapshotStore.CHUNK_SIZE);
  assert.equal(SnapshotStore.readGrid(tampered, sha).problem, 'digest_mismatch');
  const short = grid.map((r) => r.slice());
  short[2][1] = 'c:z';
  assert.equal(SnapshotStore.readGrid(short, sha).problem, 'length_mismatch');
  const unknownKey = grid.map((r) => r.slice());
  unknownKey[0][0] = SnapshotStore.META_PREFIX + JSON.stringify(Object.assign(JSON.parse(planned.metaCell.slice(2)), { respondent_hash: 'x' }));
  assert.equal(SnapshotStore.readGrid(unknownKey, sha).problem, 'meta_invalid');
  assert.equal(SnapshotStore.readGrid([], sha).problem, 'empty');
});

test('回答保存の仕様は変わらない：snapshot 更新が失敗しても回答は accepted で、保存済み行は 1 件だけ', () => {
  const { env, ctx } = loadPublic();
  ctx.SurveyAggregate.classifyRows = () => { throw new Error('boom'); };
  const res = plain(ctx.processSubmission_(JSON.stringify(validPayload(ctx)), NOW));
  assert.deepEqual(res, { ok: true, status: 'accepted' });
  assert.equal(env.spreadsheet.getSheetByName('responses').rows.length, 2);
  assert.equal(env.lockHeld, false);
});

test('test 回答（submit_excluded）の送信では snapshot の更新判定をしない', () => {
  const { env, ctx } = loadPublic();
  const payload = validPayload(ctx, {}, {}, { test_token: 'test-token-0123456789abcdef-0123', test_run_id: 'run_a' });
  assert.deepEqual(plain(ctx.processSubmission_(JSON.stringify(payload), NOW)), { ok: true, status: 'accepted_test', test: true });
  assert.equal(storeSheet(env), null);
});
