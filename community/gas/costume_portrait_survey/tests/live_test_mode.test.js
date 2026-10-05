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
  const dashboard = plain(admin.ctx.getDashboardData());
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
