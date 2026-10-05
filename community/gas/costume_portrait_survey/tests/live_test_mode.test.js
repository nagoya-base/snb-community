'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadPublic, loadAdmin, validPayload, plain, ROOT } = require('./helpers/gas-env');

const NOW = new Date('2026-11-01T12:00:00+09:00');
const submit = (ctx, payload, now = NOW) => plain(ctx.processSubmission_(JSON.stringify(payload), now));
const rows = (env) => env.spreadsheet.getSheetByName('responses').rows;
const header = (env) => rows(env)[0];
const cell = (env, name, line = 1) => rows(env)[line][header(env).indexOf(name)];

test('test_mode は LIVE_TEST_ENABLED=true の間だけ受理する（既定は拒否）', () => {
  const { env, ctx } = loadPublic();
  const payload = validPayload(ctx, {}, {}, { test_mode: true });
  let result = submit(ctx, payload);
  assert.strictEqual(result.error, 'invalid_request');
  assert.ok(result.fields.some((f) => f.field === 'test_mode' && f.code === 'disabled'));
  assert.strictEqual(rows(env).length, 1);

  env.props.set('LIVE_TEST_ENABLED', 'true');
  result = submit(ctx, payload);
  assert.deepStrictEqual(result, { ok: true, status: 'accepted_test', test: true });
  assert.strictEqual(rows(env).length, 2);
  assert.strictEqual(cell(env, 'completion_status'), 'test');
});

test('test送信は通知せず、繰り返せて、同じUUIDの通常回答をブロックしない', () => {
  const { env, ctx } = loadPublic();
  env.props.set('LIVE_TEST_ENABLED', 'true');
  const payload = validPayload(ctx, { cheer_message: 'テスト通知は送らない' }, {}, { test_mode: true });

  assert.strictEqual(submit(ctx, payload).status, 'accepted_test');
  assert.strictEqual(submit(ctx, payload).status, 'accepted_test');
  assert.strictEqual(rows(env).length, 3);
  assert.deepStrictEqual(env.mails, []);
  assert.strictEqual(plain(ctx.processStatus_(payload.uuid, NOW)).answered, false, 'test行だけでは回答済みにしない');

  const normal = Object.assign({}, payload);
  delete normal.test_mode;
  assert.deepStrictEqual(submit(ctx, normal), { ok: true, status: 'accepted' });
  assert.strictEqual(rows(env).length, 4);
  assert.strictEqual(cell(env, 'completion_status', 3), 'complete');
  assert.strictEqual(plain(ctx.processStatus_(payload.uuid, NOW)).answered, true);
});

test('test行はAdmin集計とfinalize/公開件数から除外する', () => {
  const pub = loadPublic();
  pub.env.props.set('LIVE_TEST_ENABLED', 'true');
  const testPayload = validPayload(pub.ctx, {}, {}, { test_mode: true });
  const normalPayload = validPayload(pub.ctx);
  assert.strictEqual(submit(pub.ctx, testPayload).status, 'accepted_test');
  assert.strictEqual(submit(pub.ctx, normalPayload).status, 'accepted');

  const admin = loadAdmin();
  admin.env.spreadsheet = pub.env.spreadsheet;
  const dashboard = plain(admin.ctx.getDashboardData(admin.owner()));
  assert.strictEqual(dashboard.summary.totalRows, 1);
  assert.strictEqual(dashboard.summary.validRows, 1);

  pub.env.props.set('SURVEY_CLOSES_AT', '2026-11-01T13:00:00+09:00');
  const finalized = plain(pub.ctx.finalizeSurvey_(new Date('2026-11-02T00:00:00+09:00')));
  assert.strictEqual(finalized.stats.responseRows, 1);
  assert.strictEqual(finalized.stats.validRows, 1);
  assert.strictEqual(finalized.stats.publicTotal, 1);
});

test('Frontendの ?test=submit はGA4を止め、test_modeを付与し、TEST MODEを明示する', () => {
  const html = fs.readFileSync(path.join(ROOT, '..', '..', 'costume-portrait-survey.html'), 'utf8');
  const script = fs.readFileSync(path.join(ROOT, '..', '..', 'costume-portrait-survey', 'live-test.js'), 'utf8');
  assert.match(html, /t === 'submit'/);
  assert.match(html, /live-test\.js/);
  assert.match(script, /payload\.test_mode = true/);
  assert.match(script, /window\.SNBAnalytics = null/);
  assert.match(script, /TEST MODE/);
});

// ── 最短回答時間（minElapsedMs）：通常回答は維持し、LIVE_TEST有効なtest_modeだけ免除 ──
const MIN = require('../survey.schema.json').limits.minElapsedMs;
const tooFast = (result) => Array.isArray(result.fields) && result.fields.some((f) => f.field === 'elapsed_ms' && f.code === 'too_fast');

test('通常送信：elapsed_ms が最短時間未満なら too_fast、以上なら accepted（LIVE_TEST_ENABLEDに関係なく維持）', () => {
  for (const live of [false, true]) {
    const { env, ctx } = loadPublic();
    if (live) env.props.set('LIVE_TEST_ENABLED', 'true');
    const fast = submit(ctx, validPayload(ctx, {}, {}, { elapsed_ms: MIN - 1 }));
    assert.strictEqual(fast.error, 'invalid_request');
    assert.ok(tooFast(fast), `live=${live}`);
    assert.strictEqual(rows(env).length, 1, '保存しない');
    assert.deepStrictEqual(submit(ctx, validPayload(ctx, {}, {}, { elapsed_ms: MIN })), { ok: true, status: 'accepted' });
    assert.strictEqual(cell(env, 'completion_status'), 'complete');
  }
});

test('test_mode=true かつ LIVE_TEST_ENABLED!=true は elapsed_ms に関係なく disabled で拒否（免除しない）', () => {
  for (const value of [undefined, 'false', 'TRUE_ish']) {
    const { env, ctx } = loadPublic();
    if (value !== undefined) env.props.set('LIVE_TEST_ENABLED', value);
    const result = submit(ctx, validPayload(ctx, {}, {}, { test_mode: true, elapsed_ms: 300 }));
    assert.strictEqual(result.error, 'invalid_request');
    assert.ok(result.fields.some((f) => f.field === 'test_mode' && f.code === 'disabled'), String(value));
    assert.ok(tooFast(result), '最短時間も免除されない');
    assert.strictEqual(rows(env).length, 1);
  }
});

test('test_mode=true かつ LIVE_TEST_ENABLED=true は elapsed_ms が短くても accepted_test（completion_status=test）', () => {
  const { env, ctx } = loadPublic();
  env.props.set('LIVE_TEST_ENABLED', 'true');
  assert.deepStrictEqual(submit(ctx, validPayload(ctx, {}, {}, { test_mode: true, elapsed_ms: 300 })), { ok: true, status: 'accepted_test', test: true });
  assert.strictEqual(rows(env).length, 2);
  assert.strictEqual(cell(env, 'completion_status'), 'test');
  assert.strictEqual(cell(env, 'client_elapsed_ms'), 300);
});

test('免除はelapsed_msの最短時間だけ：型不正・過大値・honeypot・設問不備は test_mode でも拒否', () => {
  const { env, ctx } = loadPublic();
  env.props.set('LIVE_TEST_ENABLED', 'true');
  const base = { test_mode: true };
  assert.ok(submit(ctx, validPayload(ctx, {}, {}, Object.assign({ elapsed_ms: 'fast' }, base))).fields.some((f) => f.field === 'elapsed_ms' && f.code === 'invalid_type'));
  assert.ok(submit(ctx, validPayload(ctx, {}, {}, Object.assign({ elapsed_ms: -1 }, base))).fields.some((f) => f.field === 'elapsed_ms'));
  assert.ok(submit(ctx, validPayload(ctx, {}, {}, Object.assign({ elapsed_ms: 300, website: 'x' }, base))).fields.some((f) => f.code === 'honeypot'));
  assert.ok(submit(ctx, validPayload(ctx, { backdrop: undefined }, {}, Object.assign({ elapsed_ms: 300 }, base))).fields.some((f) => f.field === 'backdrop'));
  assert.strictEqual(rows(env).length, 1);
});

test('免除されたtest回答は duplicate判定・status・Admin集計・finalize・公開件数へ混入しない', () => {
  const pub = loadPublic();
  pub.env.props.set('LIVE_TEST_ENABLED', 'true');
  const testPayload = validPayload(pub.ctx, {}, {}, { test_mode: true, elapsed_ms: 300 });
  assert.strictEqual(submit(pub.ctx, testPayload).status, 'accepted_test');
  assert.strictEqual(submit(pub.ctx, testPayload).status, 'accepted_test', 'test同士は重複拒否しない');
  assert.strictEqual(plain(pub.ctx.processStatus_(testPayload.uuid, NOW)).answered, false);
  const normal = validPayload(pub.ctx, {}, {}, { uuid: testPayload.uuid });
  assert.strictEqual(submit(pub.ctx, normal).status, 'accepted', '同じUUIDの通常回答はtest行にブロックされない');
  assert.strictEqual(submit(pub.ctx, normal).error, 'duplicate_submission');

  const admin = loadAdmin();
  admin.env.spreadsheet = pub.env.spreadsheet;
  const dashboard = plain(admin.ctx.getDashboardData(admin.owner()));
  assert.strictEqual(dashboard.summary.totalRows, 1);
  assert.strictEqual(dashboard.summary.validRows, 1);

  pub.env.props.set('SURVEY_CLOSES_AT', '2026-11-01T13:00:00+09:00');
  const finalized = plain(pub.ctx.finalizeSurvey_(new Date('2026-11-02T00:00:00+09:00')));
  assert.strictEqual(finalized.stats.responseRows, 1);
  assert.strictEqual(finalized.stats.validRows, 1);
  assert.strictEqual(finalized.stats.publicTotal, 1);
});
