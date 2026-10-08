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

test('旧GAS（insufficient）応答：従来の案内文のみ。数値は表示しない', async () => {
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
    { ok: false, error: 'survey_close_not_configured' }];
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

test('旧GASの not_finalized 応答は「公開準備中」と表示し、エラーにも30件未満にもしない', async () => {
  const { document } = await openPage({ page: PAGE, fetch: () => ({ ok: true, status: 'not_finalized' }) });
  assert.ok(body(document).includes('途中集計の公開準備中です'));
  assert.ok(!body(document).includes('読み込めませんでした'));
  assert.ok(!body(document).includes('30件以上集まると'));
});

// ── 基本属性の先行公開・相互導線（Issue #367） ──
const cta = (document) => document.getElementById('cp-answer-cta');
const basicItems = [
  { id: 'age_range', title: '年代', type: 'single', base: 18, suppressed: false, categories: [
    { id: 'age_18_29', label: '18〜29歳', count: 10, pct: 55.6 }, { id: 'age_30_39', label: '30〜39歳', count: null, pct: null }] },
  { id: 'residence', title: '居住地', type: 'single', base: 18, suppressed: false, categories: [{ id: 'pref_23', label: '愛知県', count: 15, pct: 83.3 }] },
  { id: 'aichi_area', title: '愛知県内エリア', type: 'single', base: null, suppressed: true, categories: [] }];
const partial30 = (total, phase = 'collecting', extra = {}) => ({ ok: true, results: Object.assign({ status: 'partial', phase, total, min_total: 30, threshold_reached: false, items: basicItems }, extra) });

test('30件未満：基本情報だけを表示し、件数を「XX件 / 30件」で示す。主要結果は出ない', async () => {
  const { document } = await openPage({ page: PAGE, fetch: () => partial30(18) });
  const t = body(document);
  assert.ok(t.includes('現在の回答傾向（基本情報）'));
  assert.ok(t.includes('年齢・居住エリアなどの基本情報のみ先行公開しています。主要なアンケート結果は有効回答30件以上で公開します。'));
  assert.ok(t.includes('現在の有効回答数：18件 / 30件'));
  assert.deepStrictEqual(Array.from(document.querySelectorAll('#cp-results h3')).map((h) => h.textContent), ['年代', '居住地', '愛知県内エリア']);
  assert.ok(t.includes('55.6%'));
  assert.ok(t.includes('83.3%'));
  assert.ok(t.includes('非公開'));
  assert.ok(t.includes('回答数が少ないため非公開です'));
  assert.ok(!t.includes('途中集計'));
  assert.ok(!t.includes('読み込めませんでした'));
});

test('30件以上・受付中：従来どおり「途中集計」と変動する旨を表示し、基本情報の見出しは出さない', async () => {
  const { document } = await openPage({ page: PAGE, fetch: () => partial30(30, 'collecting', { threshold_reached: true }) });
  assert.ok(body(document).includes('途中集計です。受付中のため、結果は回答の追加により変わります。'));
  assert.ok(body(document).includes('有効回答数：30件'));
  assert.ok(!body(document).includes('現在の回答傾向（基本情報）'));
  assert.ok(!body(document).includes('/ 30件'));
});

test('回答CTA：HTMLに「アンケートに回答する」リンクがあり、受付中の時だけ表示される', async () => {
  const link = (document) => document.querySelector('#cp-answer-cta a');
  const before = await openPage({ page: PAGE, fetch: () => new Promise(() => {}) });
  assert.strictEqual(link(before.document).getAttribute('href'), './costume-portrait-survey.html');
  assert.strictEqual(link(before.document).textContent, 'アンケートに回答する');
  assert.strictEqual(cta(before.document).hidden, true, '状態が分かるまでは表示しない');
  const collecting = await openPage({ page: PAGE, fetch: () => partial30(18) });
  assert.strictEqual(cta(collecting.document).hidden, false);
  const collecting30 = await openPage({ page: PAGE, fetch: () => partial30(40, 'collecting', { threshold_reached: true }) });
  assert.strictEqual(cta(collecting30.document).hidden, false);
});

test('final では回答CTAを表示しない（募集CTAと誤認させない）。受付終了・確定待ちも同様', async () => {
  const final30 = await openPage({ page: PAGE, fetch: () => sample('final') });
  assert.strictEqual(cta(final30.document).hidden, true);
  assert.ok(body(final30.document).includes('アンケートの受付は終了し'));
  const finalBasic = await openPage({ page: PAGE, fetch: () => ({ ok: true, results: { status: 'final', total: 25, min_total: 30, threshold_reached: false, items: basicItems } }) });
  assert.strictEqual(cta(finalBasic.document).hidden, true);
  assert.ok(body(finalBasic.document).includes('最終結果'));
  assert.ok(body(finalBasic.document).includes('年代'));
  assert.ok(!body(finalBasic.document).includes('現在の有効回答数'));
  const pending = await openPage({ page: PAGE, fetch: () => partial30(18, 'closed_pending') });
  assert.strictEqual(cta(pending.document).hidden, true);
  assert.ok(body(pending.document).includes('受付終了・最終確定待ち'));
});

test('読み込み失敗・準備中では回答CTAを表示しない', async () => {
  for (const f of [() => new Error('offline'), () => ({ ok: false }), () => ({ ok: true, status: 'not_finalized' })]) {
    const { document } = await openPage({ page: PAGE, fetch: f });
    assert.strictEqual(cta(document).hidden, true);
  }
});

test('結果ページ：threshold_reached:false の応答でも items をそのまま描画する（30件未満の全面非公開を決め打ちしない）', async () => {
  const { document } = await openPage({ page: PAGE, fetch: () => partial30(3) });
  assert.strictEqual(document.querySelectorAll('#cp-results h3').length, 3);
  assert.ok(body(document).includes('現在の有効回答数：3件 / 30件'));
});
