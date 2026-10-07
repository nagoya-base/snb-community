'use strict';
// OWNER 1名専用の管理ダッシュボード（Admin GAS 内HTML）のUIテスト（Issue #363）。
// google.script.run は、実際の Admin GAS 関数（getDashboardData / getCrosstabData）を直接呼ぶフェイク。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadAdmin, loadPublic, validPayload, plain } = require('./helpers/gas-env');
const { REPO, settle } = require('./helpers/dom');
const { openAdminPage, renderDashboardHtml } = require('./helpers/admin-page');

const NOW = new Date('2026-11-01T12:00:00+09:00');

function backend(texts = {}) {
  const pub = loadPublic();
  for (let i = 0; i < 3; i++) pub.ctx.processSubmission_(JSON.stringify(validPayload(pub.ctx, i === 0 ? texts : {})), NOW);
  const admin = loadAdmin();
  admin.env.spreadsheet = pub.env.spreadsheet;
  const server = {
    getDashboardData: () => plain(admin.ctx.getDashboardData()),
    getCrosstabData: (rowKey, colKey) => plain(admin.ctx.getCrosstabData(rowKey, colKey))
  };
  return { admin, server };
}

test('初期化：/exec を開くと google.script.run で getDashboardData を1回だけ呼び、全タブ（需要ファネル含む）を描画する', async () => {
  const { server } = backend({ free_ideas: 'こんな撮影会' });
  const page = await openAdminPage({ server });
  assert.deepStrictEqual(page.calls, [{ name: 'getDashboardData', args: [] }]); // 引数なし（token / email / role を送らない）
  assert.strictEqual(page.d.getElementById('dashboard-view').hidden, false);
  assert.strictEqual(page.text('status'), '');
  assert.deepStrictEqual(Array.from(page.d.querySelectorAll('#tabs button')).map((b) => b.getAttribute('data-tab')), ['overview', 'simple', 'funnel', 'demand', 'cross', 'free']);
  assert.ok(page.text('tab-overview').includes('総回答数') && page.text('tab-overview').includes('重複拒否件数'));
  assert.ok(page.d.getElementById('tab-simple').querySelectorAll('.card').length > 30);
  assert.ok(page.text('tab-funnel').includes('ポートレート撮影の需要ファネル'));
  const demand = page.text('tab-demand');
  assert.ok(demand.includes('① 撮られたい人') && demand.includes('分母') && demand.includes('前段階比') && demand.includes('全回答者比'));
  assert.ok(demand.includes('ストロボのみ') && demand.includes('常時光のみ') && demand.includes('既存データでは判定できない需要'));
  assert.strictEqual(page.d.getElementById('tab-cross').querySelectorAll('table').length, 17);
  assert.strictEqual(page.d.getElementById('tab-cross').querySelectorAll('select').length, 2);
  assert.ok(page.text('tab-free').includes('こんな撮影会'));
  page.d.querySelector('[data-tab="cross"]').click();
  assert.strictEqual(page.d.getElementById('tab-cross').hidden, false);
  assert.strictEqual(page.d.getElementById('tab-overview').hidden, true);
});

test('ログイン画面・ロール表示・ログアウト・Googleログインの要素は存在しない', async () => {
  const page = await openAdminPage({ server: backend().server });
  for (const id of ['login-view', 'login-message', 'gis-button', 'logout', 'role']) assert.strictEqual(page.d.getElementById(id), null, id);
  assert.ok(!page.d.body.textContent.includes('Googleアカウントでログイン'));
  assert.ok(!page.d.body.textContent.includes('未設定'));
  assert.strictEqual(page.d.querySelectorAll('script[src]').length, 0);
});

test('カスタムクロス集計：選んだ軸で getCrosstabData を呼び、結果を表示する（失敗時は詳細を出さない）', async () => {
  const { server } = backend();
  const page = await openAdminPage({ server });
  const panel = page.d.getElementById('tab-cross');
  const [rowSel, colSel] = Array.from(panel.querySelectorAll('select'));
  rowSel.value = 'age_range';
  colSel.value = 'costume_interest';
  panel.querySelector('button').click();
  await settle();
  assert.deepStrictEqual(page.calls[1], { name: 'getCrosstabData', args: ['age_range', 'costume_interest'] });
  assert.ok(panel.querySelectorAll('table').length >= 18);

  const failing = await openAdminPage({ server: { getDashboardData: server.getDashboardData, getCrosstabData: () => new Error('SECRET-DETAIL') } });
  const fp = failing.d.getElementById('tab-cross');
  fp.querySelector('button').click();
  await settle();
  assert.ok(fp.textContent.includes('集計に失敗しました。'));
  assert.ok(!failing.d.body.textContent.includes('SECRET-DETAIL'));
});

test('取得失敗：失敗メッセージだけを表示し、例外の内容・ダッシュボードの内容は出さない', async () => {
  const page = await openAdminPage({ server: { getDashboardData: () => new Error('Exception: SECRET-STACK-DETAIL') } });
  assert.ok(page.text('status').includes('読み込みに失敗しました'));
  assert.ok(!page.d.body.textContent.includes('SECRET-STACK-DETAIL'));
  assert.strictEqual(page.d.querySelectorAll('#tabs button').length, 0);
  assert.strictEqual(page.d.getElementById('panels').children.length, 0);
});

test('自由記述・その他のHTML/スクリプトは文字列として表示され、要素として解釈されない', async () => {
  const evil = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';
  const pub = loadPublic();
  pub.ctx.processSubmission_(JSON.stringify(validPayload(pub.ctx, { portrait_interest: 'other', free_ideas: evil, free_themes: evil, cheer_message: evil }, { portrait_interest: evil })), NOW);
  const admin = loadAdmin();
  admin.env.spreadsheet = pub.env.spreadsheet;
  const page = await openAdminPage({ server: { getDashboardData: () => plain(admin.ctx.getDashboardData()) } });
  assert.strictEqual(page.w.__xss, undefined);
  assert.strictEqual(page.d.querySelectorAll('img').length, 0);
  assert.strictEqual(page.d.querySelectorAll('script').length, 1); // 管理画面のscriptのみ（自由記述由来のscriptなし）
  assert.ok(page.text('tab-free').includes(evil), '文字列としてそのまま表示される');
});

test('静的検査：外部スクリプト・GA・通信API・storage・innerHTMLが無く、noindexが付き、旧admin/ディレクトリは存在しない', () => {
  const html = renderDashboardHtml();
  const js = fs.readFileSync(path.join(REPO, 'community/gas/costume_portrait_survey/admin/DashboardScript.html'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(/<meta name="robots" content="noindex, nofollow">/.test(html));
  assert.ok(!/<script[^>]*\bsrc=/.test(html), '外部scriptなし');
  assert.ok(!/gtag|googletagmanager|analytics/.test(html));
  for (const bad of ['innerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'localStorage', 'sessionStorage', 'document.cookie', 'console.', 'fetch(', 'XMLHttpRequest', 'accounts.google.com', 'idToken']) {
    assert.ok(!js.includes(bad), bad);
  }
  assert.ok(js.includes('google.script.run'));
  assert.ok(!fs.existsSync(path.join(REPO, 'community/costume-portrait-survey-admin')), '旧 GitHub Pages admin/ は削除済み');
});

test('旧GitHub Pagesの管理画面URLは、noindexの移行済み案内だけ（管理画面・GAS URL・ログインは無い）', () => {
  const html = fs.readFileSync(path.join(REPO, 'community/costume-portrait-survey-admin.html'), 'utf8');
  assert.ok(/<meta name="robots" content="noindex, nofollow">/.test(html));
  assert.ok(html.includes('移行しました'));
  assert.ok(!/<script/i.test(html) && !/<link[^>]+stylesheet/i.test(html), 'スクリプト・外部CSSなし');
  assert.ok(!/script\.google\.com|\/exec|googleusercontent|accounts\.google|COSTUME_PORTRAIT_ADMIN_CONFIG|<a\s/i.test(html), 'GAS URL・ログイン・リンクを載せない');
  assert.ok(!fs.readFileSync(path.join(REPO, 'sitemap.xml'), 'utf8').includes('costume-portrait-survey-admin'));
});
