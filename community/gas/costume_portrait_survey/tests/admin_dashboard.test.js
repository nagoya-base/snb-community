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
  assert.ok(demand.includes('① 撮ってもらいたい人') && demand.includes('分母') && demand.includes('前段階比') && demand.includes('全回答者比'));
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

// ---------- 棒グラフの回答数降順表示（Issue #365） ----------
function barLabels(root) { return Array.from(root.querySelectorAll('.bar-row > span:first-child')).map((n) => n.textContent); }

/** 実データの形はそのまま、対象の配列だけ「昇順・同数あり」の既知の値に差し替えた getDashboardData を返す。 */
function sortFixture() {
  const data = backend().server.getDashboardData();
  const opts = (spec) => spec.map(([label, count]) => ({ label, count }));
  const ascTies = [['A少', 1], ['B同数1', 5], ['C多', 9], ['D同数2', 5], ['E零', 0]]; // 期待: C, B, D, A, E
  const q = data.sections[0].questions.find((x) => x.view && x.view.options);
  q.view.options = opts(ascTies);
  const m = data.sections.flatMap((s) => s.questions).find((x) => x.matrix);
  m.matrix[0].view.options = opts(ascTies);
  const f = data.demandFunnels.funnels.find((x) => x.parallel);
  f.parallel = f.parallel.map((p, i) => Object.assign({}, p, { label: 'P' + i, count: [2, 7, 7, 4][i % 4] }));
  const fb = data.demandFunnels.funnels.find((x) => x.breakdown);
  fb.breakdown = opts([['B少', 1], ['B多', 8], ['B同数1', 3], ['B同数2', 3]]);
  const withCross = data.demandFunnels.funnels.flatMap((x) => (x.segments || []).flatMap((s) => s.crosses))[0];
  withCross.options = opts(ascTies);
  data.byDay = [{ date: '2026-10-01', count: 1 }, { date: '2026-10-02', count: 9 }, { date: '2026-10-03', count: 3 }];
  data.funnels[0].stages.forEach((st, i) => { st.count = 10 + i * 3; }); // 段階順に反して増える値
  return { data, q, m, f, fb, withCross, ascTies };
}

test('棒グラフ降順：通常設問・matrix各行・クロス集計の選択肢が count 降順で、同数は元の順を維持する', async () => {
  const { data, q, m, withCross } = sortFixture();
  const page = await openAdminPage({ server: { getDashboardData: () => data } });
  const expected = ['C多', 'B同数1', 'D同数2', 'A少', 'E零'];
  const cardOf = (panelId, title) => Array.from(page.d.getElementById(panelId).querySelectorAll('.card')).find((c) => c.querySelector('h3') && c.querySelector('h3').textContent === title);
  assert.deepStrictEqual(barLabels(cardOf('tab-simple', q.no + ' ' + q.label)), expected);
  const matrixLabels = barLabels(cardOf('tab-simple', m.no + ' ' + m.label));
  assert.deepStrictEqual(matrixLabels.slice(0, 5), expected);
  const cross = Array.from(page.d.querySelectorAll('#tab-demand .demand-cross')).find((b) => b.querySelector('h4').textContent === withCross.label);
  assert.deepStrictEqual(barLabels(cross), expected);
});

test('棒グラフ降順：需要ファネルの parallel / breakdown も count 降順（同数は元順、parallelAny は末尾）', async () => {
  const { data, f, fb } = sortFixture();
  const page = await openAdminPage({ server: { getDashboardData: () => data } });
  const cardOf = (flow) => Array.from(page.d.querySelectorAll('#tab-demand .card')).find((c) => c.querySelector('h2') && c.querySelector('h2').textContent === flow.label);
  const labels = barLabels(cardOf(f));
  const parallelNames = f.parallel.map((p) => p.label);
  const pIdx = labels.map((l) => parallelNames.indexOf(l)).filter((i) => i >= 0);
  const wantP = f.parallel.map((p, i) => ({ p, i })).sort((a, b) => (b.p.count - a.p.count) || (a.i - b.i)).map((x) => x.i);
  assert.deepStrictEqual(pIdx, wantP);
  assert.strictEqual(labels[parallelNames.length], f.parallelAny.label, 'parallelAny は並べ替えず parallel の直後');
  assert.deepStrictEqual(barLabels(cardOf(fb)).filter((l) => /^B/.test(l)), ['B多', 'B同数1', 'B同数2', 'B少']);
});

test('棒グラフ降順：回答日別（byDay）は日付順、ファネル段階（stages）は段階順のまま', async () => {
  const { data } = sortFixture();
  const page = await openAdminPage({ server: { getDashboardData: () => data } });
  const overview = page.d.getElementById('tab-overview');
  const dayCard = Array.from(overview.querySelectorAll('.card')).find((c) => c.querySelector('h2') && c.querySelector('h2').textContent.includes('回答日別'));
  assert.deepStrictEqual(barLabels(dayCard), ['2026-10-01', '2026-10-02', '2026-10-03']);
  const stageLabels = (id, flow) => Array.from(Array.from(page.d.getElementById(id).querySelectorAll('.card')).find((c) => c.querySelector('h2').textContent === flow.label).querySelectorAll('.funnel-stage > span:first-child')).map((n) => n.textContent.replace(/^↓ /, ''));
  assert.deepStrictEqual(stageLabels('tab-funnel', data.funnels[0]), data.funnels[0].stages.map((s) => s.label));
  const df = data.demandFunnels.funnels.find((x) => x.stages);
  assert.deepStrictEqual(stageLabels('tab-demand', df), df.stages.map((s) => s.label));
});

test('棒グラフ降順：受け取った元データ配列を破壊せず、クロス集計表の行列順も変えない', async () => {
  const { data } = sortFixture();
  const server = { getDashboardData: () => data, getCrosstabData: (r, c) => backend().server.getCrosstabData(r, c) };
  const snapshot = JSON.stringify(data);
  const page = await openAdminPage({ server });
  assert.strictEqual(JSON.stringify(data), snapshot, '描画後も入力データは不変（fake は JSON 経由で渡すので静的検査も併用）');
  const js = fs.readFileSync(path.join(REPO, 'community/gas/costume_portrait_survey/admin/DashboardScript.html'), 'utf8');
  const helper = js.match(/function byCountDesc\(items\) \{[\s\S]*?\n  \}/)[0];
  assert.ok(!/\bitems\.sort\(/.test(helper), '引数の配列を直接 sort しない');
  const fn = new Function(helper + '; return byCountDesc;')();
  const src = [{ label: 'x', count: 1 }, { label: 'y', count: 3 }, { label: 'z', count: 3 }];
  const before = JSON.stringify(src);
  const out = fn(src);
  assert.strictEqual(JSON.stringify(src), before);
  assert.notStrictEqual(out, src);
  assert.deepStrictEqual(out.map((o) => o.label), ['y', 'z', 'x']);
  // クロス集計表（preset）は schema 側の軸順のまま
  const ths = Array.from(page.d.querySelectorAll('#tab-cross table')[0].querySelectorAll('tr:first-child th')).slice(2).map((n) => n.textContent);
  assert.deepStrictEqual(ths, data.crosstabPresets[0].cols.map((c) => c.label));
});
