'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Issue #319：community/fetish-survey-results.html の表示確認。
// GAS版（Results.html/ResultsScript.html）のtest_results_frontend.jsと同じ手法（jsdom）で、
// 「静的JSON（fetish-survey-results.data.json）をfetchして描画するだけで、GAS・Spreadsheetへは
// 一切問い合わせない」という設計を検証する。

const PAGE_PATH = path.join(__dirname, '..', 'fetish-survey-results.html');
const pageHtml = fs.readFileSync(PAGE_PATH, 'utf8');

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
 * window.fetch をモックしてページを起動する。
 * ページ内スクリプトは即時実行のIIFEで、fetch()の解決を待つ非同期処理のため、
 * 呼び出し側はPromiseを await して描画完了後に検証する。
 */
async function boot(fetchResponse) {
  let fetchCalledWith = null;
  const mockScript =
    '<script>\n' +
    '  window.__fetchCalls = [];\n' +
    '  window.fetch = function (url, opts) {\n' +
    '    window.__fetchCalls.push(url);\n' +
    '    return Promise.resolve({\n' +
    '      ok: true,\n' +
    '      json: function () { return Promise.resolve(' + JSON.stringify(fetchResponse) + '); }\n' +
    '    });\n' +
    '  };\n' +
    '</script>\n';

  // ページ末尾の本体<script>の直前にモックを挿し込む（本体スクリプトが定義される前に
  // window.fetchが差し替わっている必要があるため）。
  const html = pageHtml.replace('  <script>\n    (function () {', mockScript + '  <script>\n    (function () {');

  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/community/fetish-survey-results.html' });
  const { window } = dom;
  window.addEventListener('error', (e) => {
    console.error('WINDOW ERROR:', (e.error && e.error.stack) || e.message);
    failures++;
  });

  // fetch().then(...)チェーンの解決を待つ（マイクロタスクを数ターン回す）。
  await new Promise((resolve) => setTimeout(resolve, 20));

  return { window, doc: window.document };
}

function items(pairs, total) {
  return pairs
    .map(([name, count]) => ({ name, count }))
    .filter((i) => i.count > 0)
    .map((i) => ({ ...i, percent: Math.round((i.count / total) * 1000) / 10 }))
    .sort((a, b) => b.count - a.count);
}

function finalFile(resultsOverrides) {
  const total = 30;
  return {
    status: 'final',
    finalizedAt: '2026-10-01T09:00:00+09:00',
    surveyPeriod: { start: '2026-08-01T00:00:00+09:00', end: '2026-09-30T23:59:59+09:00' },
    results: Object.assign({
      total,
      generatedAt: '2026-10-01T00:00:00.000Z',
      ready: true,
      categories: items([['野球ユニフォーム', 12]], total),
      primaryInterestCategory: items([['野球ユニフォーム', 12], ['スーツ', 8]], total),
      engagement: items([['自分で着たい', 10]], total),
      region: items([['関東', 10]], total),
      age: items([['20代以下', 10]], total),
      snbcAwareness: { targetCount: 0, items: [] },
      snbcInterest: { targetCount: 0, items: [] }
    }, resultsOverrides || {})
  };
}

(async () => {
  /* ── ページはGAS・SpreadsheetへではなくGitHub Pages上の静的JSONだけをfetchする ── */
  {
    const { window } = await boot(finalFile());
    assert(window.__fetchCalls.length === 1, 'the page calls fetch exactly once, got ' + window.__fetchCalls.length);
    assert(window.__fetchCalls[0] === 'fetish-survey-results.data.json',
      'the page fetches the static same-origin JSON file (not a GAS /exec URL, not Spreadsheet), got ' + window.__fetchCalls[0]);
  }

  /* ── status:"final" のとき、確定済みの内訳が描画される ── */
  {
    const { doc } = await boot(finalFile());
    assert(doc.getElementById('results-content').hidden === false, 'results-content is shown once data loads');
    assert(doc.getElementById('results-pending').hidden === true, 'pending panel is hidden when status=final and ready=true');
    assert(doc.getElementById('results-blocks').hidden === false, 'result blocks are shown when status=final and ready=true');
    assert(doc.getElementById('results-total').textContent === '30', 'total count is rendered, got ' + doc.getElementById('results-total').textContent);

    const rows = doc.getElementById('chart-primary-interest-category').querySelectorAll('.bar-row');
    assert(rows.length === 2, 'primary interest category renders one bar-row per non-zero item, got ' + rows.length);
  }

  /* ── status:"pending"（締切前・未確定）のときは、内訳を出さず「集計中」表示にする ── */
  {
    const pendingFile = {
      status: 'pending',
      finalizedAt: null,
      surveyPeriod: { start: null, end: '2026-09-30T23:59:59+09:00' },
      results: { total: 0, generatedAt: '2026-09-25T00:00:00.000Z', ready: false }
    };
    const { doc } = await boot(pendingFile);
    assert(doc.getElementById('results-pending').hidden === false, 'pending panel is shown when status=pending');
    assert(doc.getElementById('results-blocks').hidden === true, 'result blocks are hidden when status=pending (no unfinalized values leak into the DOM)');

    const categoriesChart = doc.getElementById('chart-categories');
    assert(categoriesChart.children.length === 0, 'no chart is rendered from unfinalized data when status=pending');
  }

  /* ── 万一 status:"final" でも results.ready が false なら描画しない（CLI側のガードの保険・防御的多重チェック） ── */
  {
    const inconsistentFile = {
      status: 'final',
      finalizedAt: '2026-10-01T09:00:00+09:00',
      surveyPeriod: { start: null, end: '2026-09-30T23:59:59+09:00' },
      results: { total: 4, generatedAt: '2026-10-01T00:00:00.000Z', ready: false }
    };
    const { doc } = await boot(inconsistentFile);
    assert(doc.getElementById('results-pending').hidden === false,
      'pending panel is shown even when status=final if results.ready is false (defense in depth against a malformed data file)');
    assert(doc.getElementById('results-blocks').hidden === true, 'result blocks stay hidden in that inconsistent case');
  }

  /* ── fetchが失敗した場合はエラー表示になる（GASや外部APIの障害に依存しないので基本発生しないが、静的ファイル欠落等の保険） ── */
  {
    const mockScript =
      '<script>\n' +
      '  window.fetch = function () { return Promise.resolve({ ok: false, status: 404, json: function () { return Promise.reject(new Error("no")); } }); };\n' +
      '</script>\n';
    const html = pageHtml.replace('  <script>\n    (function () {', mockScript + '  <script>\n    (function () {');
    const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/community/fetish-survey-results.html' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const doc = dom.window.document;
    assert(doc.getElementById('results-error').hidden === false, 'error panel is shown when the static JSON fails to load (e.g. HTTP 404)');
    assert(doc.getElementById('results-content').hidden === true, 'results-content stays hidden on fetch failure');
  }

  if (failures > 0) {
    console.error('\n' + failures + ' failure(s) in test_fetish_survey_results_page.js');
    process.exitCode = 1;
  } else {
    console.log('\ntest_fetish_survey_results_page.js: all checks passed');
  }
  process.exit(process.exitCode || 0);
})();
