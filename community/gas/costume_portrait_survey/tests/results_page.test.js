'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { openPage } = require('./helpers/dom');

const PAGE = 'community/costume-portrait-survey-results.html';
const body = (document) => document.getElementById('cp-results').textContent;

test('endpoint未設定なら「準備中」を表示し、通信しない', async () => {
  const { document, calls } = await openPage({ page: PAGE, endpoint: '' });
  assert.ok(body(document).includes('準備中'));
  assert.strictEqual(calls.length, 0);
});

test('未確定・件数不足の間は何も数値を表示しない', async () => {
  const a = await openPage({ page: PAGE, fetch: () => ({ ok: true, status: 'not_finalized' }) });
  assert.ok(body(a.document).includes('受付終了後に確定'));
  assert.match(a.calls[0].url, /action=results$/);
  const b = await openPage({ page: PAGE, fetch: () => ({ ok: true, results: { status: 'insufficient', min_total: 30 } }) });
  assert.ok(body(b.document).includes('十分に集まるまで'));
  assert.ok(!/\d+件/.test(body(b.document)));
});

test('確定結果を表示し、抑止されたセルは「非公開」、ラベルのHTMLは解釈されない', async () => {
  const evil = '<img src=x onerror="window.__xss=1">';
  const results = { status: 'final', total: 42, items: [
    { id: 'backdrop', title: evil, type: 'multi', base: 42, suppressed: false, categories: [
      { id: 'white', label: evil, count: 30, pct: 71.4 }, { id: 'fantasy', label: '異世界', count: null, pct: null }] },
    { id: 'retouch', title: '仕上げ', type: 'single', base: null, suppressed: true, categories: [] }] };
  const { document, window } = await openPage({ page: PAGE, fetch: () => ({ ok: true, results }) });
  assert.ok(body(document).includes('有効回答数：42件'));
  assert.ok(body(document).includes('71.4%'));
  assert.ok(body(document).includes('非公開'));
  assert.ok(body(document).includes('回答数が少ないため非公開です'));
  assert.strictEqual(document.querySelectorAll('#cp-results img').length, 0);
  assert.strictEqual(window.__xss, undefined);
});

test('通信失敗時は読み込みエラーを表示する', async () => {
  const { document } = await openPage({ page: PAGE, fetch: () => new Error('offline') });
  assert.ok(body(document).includes('読み込めませんでした'));
});
