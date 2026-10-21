'use strict';
// Admin 日別回答数（Issue #432）。入力はすべて架空の fixture。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { createAdminEnv } = require('./helpers/admin-env');
const { schema, aggregate, answersFor, rowFor, classify, NOW } = require('./helpers/fixtures');

const at = (timestamp, meta) => rowFor(answersFor({}), Object.assign({ timestamp }, meta || {}));
const JST = 'Asia/Tokyo';
const summaryOf = (rows, tz = JST) => aggregate.buildAdminSummary(schema, aggregate.classifyRows(schema, rows, { spreadsheetTimeZone: tz }), { now: NOW });

test('jstDayOf：瞬間（Date / offset 付き ISO）は JST に変換し、シリアル・壁時計文字列は Spreadsheet の timeZone から JST へ変換する', () => {
  const day = aggregate.jstDayOf;
  assert.equal(day('2026-11-10T14:59:59Z'), '2026-11-10');
  assert.equal(day('2026-11-10T15:00:00Z'), '2026-11-11');
  assert.equal(day('2026-11-10T23:30:00+09:00'), '2026-11-10');
  assert.equal(day(new Date('2026-11-10T15:00:00Z')), '2026-11-11');
  // Spreadsheet が JST
  assert.equal(day('2026-11-10 23:59', JST), '2026-11-10');
  assert.equal(day('2026/11/3 08:00:00', JST), '2026-11-03');
  assert.equal(day(46336.75, JST), '2026-11-10'); // 2026-11-10 18:00 JST
  // Spreadsheet が JST 以外：同じ瞬間（JST 2026-11-11 00:30）が、Sheets では各 timeZone の壁時計で保存される
  assert.equal(day('2026-11-10 15:30', 'UTC'), '2026-11-11');
  assert.equal(day('2026-11-10 10:30', 'America/New_York'), '2026-11-11'); // EST = UTC-5
  assert.equal(day('2026-11-11 02:30', 'Australia/Sydney'), '2026-11-11'); // AEDT = UTC+11
  assert.equal(day(46336 + 15.5 / 24, 'UTC'), '2026-11-11'); // シリアルも同様（UTC 15:30 → JST 翌日 00:30）
  assert.equal(day(46336 + 15.5 / 24, JST), '2026-11-10'); // 同じシリアルでも timeZone が違えば別の瞬間
  // timeZone が不明・不正なら推測せず日付不明
  [undefined, null, '', 'Not/AZone'].forEach((tz) => {
    assert.equal(day(46336.75, tz), null, String(tz));
    assert.equal(day('2026-11-10 12:00', tz), null, String(tz));
  });
  assert.equal(day('2026-11-10T14:59:59Z'), '2026-11-10', '瞬間は timeZone 不要');
  ['', null, undefined, 'abc', '2026-13-40', '2026-02-30 10:00', '2026-11-10 25:00', NaN, true].forEach((v) => assert.equal(day(v, JST), null, String(v)));
});

test('日別回答数：Spreadsheet の timeZone が JST でなくても深夜付近の日付がずれない / timeZone 不明は日付不明に倒す', () => {
  // JST 2026-11-11 00:30 の回答。Spreadsheet が UTC なら壁時計は 11-10 15:30、New York なら 11-10 10:30。
  const utc = summaryOf([at('2026-11-10 15:30')], 'UTC').daily_responses;
  assert.deepEqual(utc.days, [{ date: '2026-11-11', count: 1 }]);
  const ny = summaryOf([at(46336 + 10.5 / 24)], 'America/New_York').daily_responses;
  assert.deepEqual(ny.days, [{ date: '2026-11-11', count: 1 }]);
  const unknown = summaryOf([at('2026-11-10 15:30'), at(46336.5)], null).daily_responses;
  assert.deepEqual(unknown, { timezone: 'Asia/Tokyo', days: [], undated: 2, total: 2 });
});

test('日別回答数：有効回答だけを日別に数え、0 件の日も連続させ、合計は production_valid_total と一致する', () => {
  const rows = [
    at('2026-11-10T14:00:00Z'), at('2026-11-10T14:30:00Z'), // 11/10 (JST) ×2
    at('2026-11-10T15:00:00Z'),                              // 11/11 (JST)
    at('2026-11-13 09:00'),                                  // 11/13
    at('not a date'),                                        // 日付不明
    at('2026-11-12 10:00', { response_mode: 'test', test_run_id: 'r1' }),
    at('2026-11-12 10:00', { completion_status: 'partial' }),
    at('2026-11-12 10:00', { schema_version: '0' }),
    at('2026-11-12 10:00', { respondent_hash: 'dup' }), at('2026-11-12 10:00', { respondent_hash: 'dup' })
  ];
  const summary = summaryOf(rows);
  const d = summary.daily_responses;
  assert.equal(d.timezone, 'Asia/Tokyo');
  assert.deepEqual(d.days, [
    { date: '2026-11-10', count: 2 }, { date: '2026-11-11', count: 1 },
    { date: '2026-11-12', count: 1 }, // duplicate の最初の 1 件だけ有効
    { date: '2026-11-13', count: 1 }
  ]);
  assert.equal(d.undated, 1);
  assert.equal(d.total, summary.production_valid_total);
  assert.equal(d.days.reduce((n, x) => n + x.count, 0) + d.undated, summary.production_valid_total);
});

test('日別回答数：legacy 互換で有効扱いの回答（survey_version が月初シリアル）も含める', () => {
  const rows = [at('2026-11-10 12:00', { survey_version: 46296 }), at('2026-11-10 13:00')];
  const summary = summaryOf(rows);
  assert.equal(summary.legacy_date_serial_accepted, 1);
  assert.deepEqual(summary.daily_responses.days, [{ date: '2026-11-10', count: 2 }]);
  assert.equal(summary.daily_responses.total, summary.production_valid_total);
});

test('日別回答数：有効回答が無ければ days は空・合計 0', () => {
  const d = summaryOf([at('2026-11-10 12:00', { response_mode: 'test', test_run_id: 'r1' })]).daily_responses;
  assert.deepEqual(d, { timezone: 'Asia/Tokyo', days: [], undated: 0, total: 0 });
});

test('日別回答数：個別 timestamp・hash・自由記述を出さず、Public 結果・snapshot に影響しない', () => {
  const rows = [at('2026-11-10 12:34:56'), at('2026-11-11 08:00')];
  const withDaily = summaryOf(rows);
  const json = JSON.stringify(withDaily.daily_responses);
  assert.ok(!/12:34|08:00|hash|free_text|other_texts/.test(json));
  assert.deepEqual(Object.keys(withDaily.daily_responses).sort(), ['days', 'timezone', 'total', 'undated']);
  assert.ok(!('daily_responses' in withDaily.publicPreview));
  assert.ok(!/daily/.test(JSON.stringify(withDaily.publicPreview)));
  // タイムスタンプが違っても snapshot は同一（日別は snapshot の入力にならない）
  const shifted = summaryOf([at('2026-01-01 00:00'), at('2027-05-05 00:00')]);
  assert.deepEqual(shifted.publicPreview, withDaily.publicPreview);
  aggregate.FORBIDDEN_KEYS.forEach((k) => assert.ok(!(k in withDaily.publicPreview)));
});

test('Dashboard：「日別回答数」を上部に横棒グラフで表示し、横スクロールを作らない（textContent のみ）', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'admin', 'Dashboard.html'), 'utf8');
  assert.ok(!/innerHTML/.test(html));
  assert.match(html, /id="daily"/);
  assert.ok(html.indexOf('id="daily"') < html.indexOf('id="tab-results"'));
  assert.ok(!/overflow-x\s*:\s*(auto|scroll)/.test(html));
  const rows = [at('2026-11-10 12:00'), at('2026-11-10 13:00'), at('2026-11-12 09:00')];
  const summary = JSON.parse(JSON.stringify(summaryOf(rows)));
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    beforeParse(window) {
      const h = {};
      const run = new Proxy({}, { get(_, n) { if (n === 'withSuccessHandler') return (fn) => { h.ok = fn; return run; }; if (n === 'withFailureHandler') return () => run; return () => { if (n === 'getAdminSummary') h.ok(summary); }; } });
      Object.defineProperty(window, 'google', { value: { script: { run } } });
    }
  });
  dom.window.eval([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n'));
  const doc = dom.window.document;
  const card = doc.getElementById('daily');
  assert.match(card.querySelector('h2').textContent, /日別回答数/);
  assert.equal(card.querySelector('ul.daily, .daily-axis, details'), null);
  const rowsEl = [...card.querySelectorAll('.daily-bars > .opt')];
  assert.deepEqual(rowsEl.map((r) => r.querySelector('.opt-label').textContent), ['11/10', '11/11', '11/12']); // 古い→新しい
  assert.deepEqual(rowsEl.map((r) => r.querySelector('.opt-num').textContent), ['2件', '0件', '1件']);
  assert.deepEqual(rowsEl.map((r) => r.querySelector('.bar > span').style.width), ['100%', '0%', '50%']);
  assert.match(card.textContent, /合計 3 件/);
});

test('Admin GAS：Spreadsheet の timeZone を Sheets API（読み取り）で取得し、JST 以外でも日付を JST に揃える。設定は書き換えない', () => {
  const rows = [at(46336 + 10.5 / 24)]; // Spreadsheet(New York) の壁時計 10:30 = JST 2026-11-11 00:30
  const ny = createAdminEnv(rows, { spreadsheetTimeZone: 'America/New_York' });
  assert.deepEqual(JSON.parse(JSON.stringify(ny.ctx.getAdminSummary().daily_responses.days)), [{ date: '2026-11-11', count: 1 }]);
  assert.deepEqual(ny.writes, []);
  const jst = createAdminEnv(rows, { spreadsheetTimeZone: 'Asia/Tokyo' });
  assert.deepEqual(JSON.parse(JSON.stringify(jst.ctx.getAdminSummary().daily_responses.days)), [{ date: '2026-11-10', count: 1 }]);
  const none = createAdminEnv(rows, { spreadsheetTimeZone: null });
  assert.equal(none.ctx.getAdminSummary().daily_responses.undated, 1);
  assert.match(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'admin', 'Data.gs'), 'utf8'), /properties\.timeZone/);
});
