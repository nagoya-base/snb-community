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

test('30件未満は何も数値を表示せず、案内文を出す', async () => {
  const b = await openPage({ page: PAGE, fetch: () => ({ ok: true, results: { status: 'insufficient', min_total: 30 } }) });
  assert.match(b.calls[0].url, /action=results$/);
  assert.ok(body(b.document).includes('有効回答が30件以上集まると、途中集計を公開します。'));
  assert.ok(!/有効回答数/.test(body(b.document)));
  assert.ok(!/\d+件/.test(body(b.document).replace('30件以上', '')));
});

const sample = (status, phase) => ({ ok: true, results: Object.assign({ status, total: 30, items: [
  { id: 'backdrop', title: '背景', type: 'multi', base: 30, suppressed: false, categories: [{ id: 'white', label: '白', count: 30, pct: 100 }] }] }, phase ? { phase } : {}) });

test('受付中の途中集計：途中集計の案内と件数・集計を表示', async () => {
  const { document } = await openPage({ page: PAGE, fetch: () => sample('partial', 'collecting') });
  assert.ok(body(document).includes('途中集計です。受付中のため、結果は回答の追加により変わります。'));
  assert.ok(body(document).includes('有効回答数：30件'));
  assert.ok(!body(document).includes('最終結果'));
});

test('受付終了・未確定の途中集計：最終確定待ちの案内を表示', async () => {
  const { document } = await openPage({ page: PAGE, fetch: () => sample('partial', 'closed_pending') });
  assert.ok(body(document).includes('受付は終了しました。現在は途中集計を表示しています。最終結果は確定後に公開します。'));
  assert.ok(body(document).includes('受付終了・最終確定待ち'));
});

test('確定後は「最終結果」と明示する', async () => {
  const { document } = await openPage({ page: PAGE, fetch: () => sample('final') });
  assert.ok(body(document).includes('最終結果'));
  assert.ok(!body(document).includes('途中集計'));
});

test('不正なレスポンスは読み込みエラーにし、30件未満とは表示しない', async () => {
  const bads = [{ ok: true }, { ok: true, results: {} }, { ok: true, results: { status: 'partial', total: 30, items: [] } },
    { ok: true, results: { status: 'partial', phase: 'x', total: 30, items: [] } }, { ok: true, results: { status: 'final', items: [] } },
    { ok: false, error: 'survey_close_not_configured' }, { ok: true, status: 'not_finalized' }];
  for (const bad of bads) {
    const { document } = await openPage({ page: PAGE, fetch: () => bad });
    assert.ok(body(document).includes('読み込めませんでした'), JSON.stringify(bad));
    assert.ok(!body(document).includes('30件以上集まると'), JSON.stringify(bad));
  }
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
