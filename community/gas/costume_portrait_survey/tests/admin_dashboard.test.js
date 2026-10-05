'use strict';
// Admin ダッシュボードのクライアント描画（jsdom）：自由記述がHTMLとして解釈されないこと。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { loadAdmin, loadPublic, validPayload, plain, ROOT } = require('./helpers/gas-env');

function read(name) { return fs.readFileSync(path.join(ROOT, 'admin', name), 'utf8'); }

function buildPage(payload) {
  const html = read('Dashboard.html')
    .replace("<?!= include('DashboardStyles'); ?>", '')
    .replace("<?!= include('DashboardScript'); ?>", '');
  const script = read('DashboardScript.html').replace(/^<script>/, '').replace(/<\/script>\s*$/, '');
  const calls = [];
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  const w = dom.window;
  w.google = { script: { run: {
    withSuccessHandler(ok) { this.ok = ok; return this; },
    withFailureHandler(ng) { this.ng = ng; return this; },
    getDashboardData() { calls.push('dashboard'); this.ok(payload); },
    getCrosstabData(r, c) { calls.push(['cross', r, c]); }
  } } };
  w.eval(script);
  return { w, calls };
}

test('自由記述・その他・Q30のHTML/スクリプトは文字列として表示され、要素として解釈されない', () => {
  const evil = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';
  const pub = loadPublic();
  pub.ctx.processSubmission_(JSON.stringify(validPayload(pub.ctx, { portrait_interest: 'other', free_ideas: evil, free_themes: evil, cheer_message: evil }, { portrait_interest: evil })), new Date('2026-11-01T12:00:00+09:00'));
  const admin = loadAdmin();
  admin.env.spreadsheet = pub.env.spreadsheet;
  const payload = plain(admin.ctx.getDashboardData());
  const { w } = buildPage(payload);
  assert.strictEqual(w.__xss, undefined);
  assert.strictEqual(w.document.querySelectorAll('img').length, 0);
  assert.strictEqual(w.document.querySelectorAll('script').length, 0);
  const free = w.document.getElementById('tab-free').textContent;
  assert.ok(free.includes(evil), '文字列としてそのまま表示される');
  assert.ok(!/innerHTML|insertAdjacentHTML|document\.write|eval\(/.test(read('DashboardScript.html')));
});

test('各タブ（概要・単純集計・ファネル・クロス集計・自由記述）が描画される', () => {
  const pub = loadPublic();
  for (let i = 0; i < 3; i++) pub.ctx.processSubmission_(JSON.stringify(validPayload(pub.ctx)), new Date('2026-11-01T12:00:00+09:00'));
  const admin = loadAdmin();
  admin.env.spreadsheet = pub.env.spreadsheet;
  const { w } = buildPage(plain(admin.ctx.getDashboardData()));
  const doc = w.document;
  assert.ok(doc.getElementById('tab-overview').textContent.includes('総回答数'));
  assert.ok(doc.getElementById('tab-overview').textContent.includes('重複拒否件数'));
  assert.ok(doc.getElementById('tab-simple').querySelectorAll('.card').length > 30);
  assert.ok(doc.getElementById('tab-funnel').textContent.includes('ポートレート撮影の需要ファネル'));
  assert.strictEqual(doc.getElementById('tab-cross').querySelectorAll('table').length, 14);
  assert.ok(doc.getElementById('tab-cross').querySelectorAll('select').length === 2);
  assert.ok(doc.getElementById('tab-free').textContent.includes('Q30'));
  // タブ切替
  doc.querySelector('[data-tab="cross"]').click();
  assert.strictEqual(doc.getElementById('tab-cross').hidden, false);
  assert.strictEqual(doc.getElementById('tab-overview').hidden, true);
});

test('空データでも描画できる', () => {
  const admin = loadAdmin();
  admin.env.spreadsheet.insertSheet('responses');
  const { w } = buildPage(plain(admin.ctx.getDashboardData()));
  assert.ok(w.document.getElementById('tab-overview').textContent.includes('まだ回答がありません'));
});
