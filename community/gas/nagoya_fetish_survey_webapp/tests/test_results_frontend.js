'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Issue #315（追加対応）：Results.html / ResultsScript.htmlの表示確認。
// test_frontend.jsがアンケートフォーム（Index.html/Script.html）を検証するのと同じ手法
// （jsdom + google.script.runのモック）で、公開結果ページ（?view=results）を検証する。

const RESULTS_PATH = path.join(__dirname, '..', 'Results.html');
const STYLES_PATH = path.join(__dirname, '..', 'Styles.html');
const RESULTS_SCRIPT_PATH = path.join(__dirname, '..', 'ResultsScript.html');

const resultsHtml = fs.readFileSync(RESULTS_PATH, 'utf8');
const stylesHtml = fs.readFileSync(STYLES_PATH, 'utf8');
const resultsScriptHtml = fs.readFileSync(RESULTS_SCRIPT_PATH, 'utf8');

// Index.html内のApps Scriptテンプレートスクリプトレット（<?!= include(...); ?>）を、
// 実ファイルの中身で置き換えた簡易HTMLを組み立てる（test_frontend.jsと同じ手法）。
const bodyTemplate = resultsHtml
  .replace(/<\?!= include\('Styles'\); \?>/, stylesHtml)
  .replace(/<\?!= include\('ResultsScript'\); \?>/, resultsScriptHtml)
  .replace(/<base target="_top">/, '');

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failures++;
  } else {
    console.log('OK:', msg);
  }
}

/**
 * getPublicResults()がpayloadを即座に返すgoogle.script.runモックでResults.htmlを起動する。
 *
 * 【注意】ResultsScript.htmlはfetchResults()をDOMContentLoadedを待たずトップレベルで
 * 即時実行するため（アンケートフォーム側Script.htmlと異なり、ページ表示時点で即座に
 * getPublicResults()を呼ぶ設計）、jsdomがResultsScript.htmlの<script>を構文解析中に
 * 同期実行する前にgoogle.script.runが定義済みでなければならない。そのため
 * `new JSDOM()`構築後にwindow.googleへ代入するのではなく、モックscriptタグをHTML文字列
 * （ResultsScript.htmlの直前）へ直接埋め込んだ上でJSDOMを構築する。
 */
function boot(payload) {
  const mockScript =
    '<script>window.google = { script: { run: {\n' +
    '  withSuccessHandler: function (fn) { this._success = fn; return this; },\n' +
    '  withFailureHandler: function (fn) { this._failure = fn; return this; },\n' +
    '  getPublicResults: function () { this._success(' + JSON.stringify(payload) + '); }\n' +
    '} } };</script>';
  const html = bodyTemplate.replace(
    resultsScriptHtml,
    mockScript + resultsScriptHtml
  );

  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/exec?view=results' });
  const { window } = dom;
  window.addEventListener('error', (e) => {
    console.error('WINDOW ERROR:', (e.error && e.error.stack) || e.message);
    failures++;
  });

  return { window, doc: window.document };
}

function items(pairs, total) {
  return pairs
    .map(([name, count]) => ({ name, count }))
    .filter((i) => i.count > 0)
    .map((i) => ({ ...i, percent: Math.round((i.count / total) * 1000) / 10 }))
    .sort((a, b) => b.count - a.count);
}

function minimalReadyPayload(overrides) {
  const total = 20;
  return Object.assign({
    total,
    generatedAt: new Date().toISOString(),
    ready: true,
    categories: items([['野球ユニフォーム', 8]], total),
    primaryInterestCategory: items([['野球ユニフォーム', 12], ['スーツ', 8], ['サッカーユニフォーム', 0]], total),
    engagement: items([['自分で着たい', 10]], total),
    region: items([['関東', 10]], total),
    age: items([['20代以下', 10]], total),
    snbcAwareness: { targetCount: 0, items: [] },
    snbcInterest: { targetCount: 0, items: [] }
  }, overrides || {});
}

/* ── 第一嗜好：バーチャートが描画され、件数・割合が表示される ── */
{
  const payload = minimalReadyPayload();
  const { doc } = boot(payload);

  const chart = doc.getElementById('chart-primary-interest-category');
  assert(!!chart, 'chart-primary-interest-category container exists in Results.html');

  const rows = chart.querySelectorAll('.bar-row');
  assert(rows.length === 2, 'primary interest category renders one bar-row per non-zero item (2 items), got ' + rows.length);

  const names = Array.from(chart.querySelectorAll('.bar-row__name')).map((el) => el.textContent);
  assert(names[0] === '野球ユニフォーム' && names[1] === 'スーツ',
    'primary interest category rows are in the order provided by the payload (count desc), got ' + JSON.stringify(names));
  assert(names.indexOf('サッカーユニフォーム') === -1, '0-count options (サッカーユニフォーム) are not rendered');

  const values = Array.from(chart.querySelectorAll('.bar-row__value')).map((el) => el.textContent);
  assert(values[0] === '12件（60%）', 'primary interest category shows count and percent for the top item, got ' + values[0]);
  assert(values[1] === '8件（40%）', 'primary interest category shows count and percent for the 2nd item, got ' + values[1]);
}

/* ── 第一嗜好が「衣装・嗜好」セクション内（興味のある衣装・服装の直後・衣装との関わり方の直前）に配置されている ── */
{
  const payload = minimalReadyPayload();
  const { doc } = boot(payload);

  const blocks = Array.from(doc.querySelectorAll('#results-blocks > .result-block, #results-blocks > *'));
  const headings = Array.from(doc.querySelectorAll('#results-blocks .result-block > h2')).map((h) => h.textContent);
  const idxCategories = headings.indexOf('興味のある衣装・服装');
  const idxPrimary = headings.indexOf('第一嗜好');
  const idxEngagement = headings.indexOf('衣装・服装との関わり方');
  assert(idxCategories !== -1 && idxPrimary !== -1 && idxEngagement !== -1,
    '興味のある衣装・服装／第一嗜好／衣装・服装との関わり方の3見出しがすべて存在する');
  assert(idxCategories < idxPrimary && idxPrimary < idxEngagement,
    '第一嗜好は既存の「衣装・嗜好」セクション内（興味のある衣装・服装の直後、衣装・服装との関わり方の直前）に配置されている, got order: ' +
    JSON.stringify(headings));
}

/* ── 全項目が0件（primaryInterestCategoryが空配列）でも「データがありません」表示になり、エラーにならない ── */
{
  const payload = minimalReadyPayload({ primaryInterestCategory: [] });
  const { doc } = boot(payload);
  const chart = doc.getElementById('chart-primary-interest-category');
  const empty = chart.querySelector('.result-block__empty');
  assert(!!empty, 'primary interest category shows the empty-state message when all counts are 0');
}

/* ── 総回答数10件未満（ready:false）のときは他のブロックと同様、第一嗜好チャートも描画されない（pending表示） ── */
{
  const { doc } = boot({ total: 4, generatedAt: new Date().toISOString(), ready: false });
  assert(doc.getElementById('results-pending').hidden === false, 'pending panel shown when ready=false');
  assert(doc.getElementById('results-blocks').hidden === true, 'results-blocks (including primary interest category) hidden when ready=false');
  const chart = doc.getElementById('chart-primary-interest-category');
  assert(chart.children.length === 0, 'primary interest category chart is left empty (not rendered) when ready=false');
}

if (failures > 0) {
  console.error('\n' + failures + ' failure(s) in test_results_frontend.js');
  process.exitCode = 1;
} else {
  console.log('\ntest_results_frontend.js: all checks passed');
}

// ResultsScript.htmlはsetInterval(fetchResults, ...)でポーリングを開始する
// （アンケートフォーム側と異なりDOMContentLoaded待ちではなく即時実行するため）ため、
// 各boot()で作られたjsdomウィンドウのタイマーがNodeプロセスを生かし続けてしまう。
// 全アサーション完了後は明示的に終了する。
process.exit(process.exitCode || 0);
