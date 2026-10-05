'use strict';
// 管理ダッシュボード（GitHub Pages）: Googleログイン→ID token をAdmin GASへ送る→返却データだけを描画する。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadAdmin, loadPublic, validPayload, plain } = require('./helpers/gas-env');
const { REPO, settle } = require('./helpers/dom');
const { openAdminPage, ENDPOINT, CLIENT_ID, PAGE } = require('./helpers/admin-page');

const NOW = new Date('2026-11-01T12:00:00+09:00');
const TOKEN = 'HEADER.PAYLOAD.SIGNATURE-DO-NOT-LEAK';

/** 実際のAdmin GASを経由して、ロール別の本物のレスポンスを作る（認証は偽IdPのtoken）。 */
function backend(texts = {}) {
  const pub = loadPublic();
  for (let i = 0; i < 3; i++) pub.ctx.processSubmission_(JSON.stringify(validPayload(pub.ctx, i === 0 ? texts : {})), NOW);
  const admin = loadAdmin();
  admin.env.spreadsheet = pub.env.spreadsheet;
  admin.env.props.set('ADMIN_OWNER_EMAILS', 'owner@gmail.com');
  admin.env.props.set('ADMIN_VIEWER_EMAILS', 'viewer@gmail.com');
  // フロントが送る「token」を、どのメールのtokenかに対応づけて doPost を呼ぶ
  const tokens = { OWNER_TOKEN: admin.tokenFor('owner@gmail.com'), VIEWER_TOKEN: admin.tokenFor('viewer@gmail.com'),
    STRANGER_TOKEN: admin.tokenFor('stranger@gmail.com'), EXPIRED_TOKEN: admin.tokenFor('owner@gmail.com', { exp: Math.floor(Date.now() / 1000) - 5 }) };
  const api = (body) => JSON.parse(admin.ctx.doPost({ postData: { contents: JSON.stringify(Object.assign({}, body, { idToken: tokens[body.idToken] })) } }).getContent());
  return { admin, api };
}

test('未認証：ログインUIだけが見え、ダッシュボードは空・非表示。通信もしない', async () => {
  const page = await openAdminPage({ api: () => { throw new Error('should not call'); } });
  assert.strictEqual(page.visible('login-view'), true);
  assert.strictEqual(page.visible('dashboard-view'), false);
  assert.strictEqual(page.d.getElementById('tabs').children.length, 0);
  assert.strictEqual(page.d.getElementById('panels').children.length, 0);
  assert.strictEqual(page.calls.length, 0);
  assert.strictEqual(page.gis.cfg.client_id, CLIENT_ID);
  assert.strictEqual(page.gis.rendered, 1);
  assert.strictEqual(page.gis.cfg.auto_select, false);
});

test('未設定（endpoint / clientId が空）：未設定を表示し、Googleログインも通信もしない', async () => {
  for (const config of [null, { endpoint: '', googleClientId: CLIENT_ID }, { endpoint: ENDPOINT, googleClientId: '' }]) {
    const page = await openAdminPage({ config });
    assert.ok(page.text('login-message').includes('未設定'));
    assert.strictEqual(page.gis.cfg, null);
    assert.strictEqual(page.calls.length, 0);
    assert.strictEqual(page.visible('dashboard-view'), false);
  }
});

test('Googleログイン成功（OWNER）：tokenだけをtext/plainのPOSTで送り、全タブを描画。ロールはサーバー値を表示', async () => {
  const { api } = backend({ free_ideas: 'こんな撮影会' });
  const page = await openAdminPage({ api });
  await page.login('OWNER_TOKEN');
  assert.strictEqual(page.calls.length, 1);
  const call = page.calls[0];
  assert.strictEqual(call.url, ENDPOINT);
  assert.strictEqual(call.options.method, 'POST');
  assert.strictEqual(call.options.headers['Content-Type'], 'text/plain;charset=utf-8'); // 単純リクエスト（プリフライトなし）
  assert.strictEqual(call.options.credentials, 'omit');
  assert.deepStrictEqual(call.body, { idToken: 'OWNER_TOKEN', action: 'dashboard' }); // email / role は送らない
  assert.strictEqual(page.visible('login-view'), false);
  assert.strictEqual(page.visible('dashboard-view'), true);
  assert.ok(page.text('role').includes('管理者権限: OWNER'));
  assert.deepStrictEqual(Array.from(page.d.querySelectorAll('#tabs button')).map((b) => b.getAttribute('data-tab')), ['overview', 'simple', 'funnel', 'cross', 'free']);
  assert.ok(page.text('tab-overview').includes('総回答数') && page.text('tab-overview').includes('重複拒否件数'));
  assert.ok(page.d.getElementById('tab-simple').querySelectorAll('.card').length > 30);
  assert.ok(page.text('tab-funnel').includes('ポートレート撮影の需要ファネル'));
  assert.strictEqual(page.d.getElementById('tab-cross').querySelectorAll('table').length, 17);
  assert.strictEqual(page.d.getElementById('tab-cross').querySelectorAll('select').length, 2);
  assert.ok(page.text('tab-free').includes('こんな撮影会'));
  page.d.querySelector('[data-tab="cross"]').click();
  assert.strictEqual(page.d.getElementById('tab-cross').hidden, false);
  assert.strictEqual(page.d.getElementById('tab-overview').hidden, true);
});

test('Googleログイン成功（VIEWER）：ロール表示。返却されなかったタブ（ファネル・自由記述）はDOMごと存在しない', async () => {
  const { api } = backend({ free_ideas: 'SECRET_IDEAS_TEXT' });
  const page = await openAdminPage({ api });
  await page.login('VIEWER_TOKEN');
  assert.ok(page.text('role').includes('管理者権限: VIEWER'));
  const d = page.d;
  assert.deepStrictEqual(Array.from(d.querySelectorAll('#tabs button')).map((b) => b.getAttribute('data-tab')), ['overview', 'simple', 'cross']);
  for (const id of ['tab-free', 'tab-funnel']) assert.strictEqual(d.getElementById(id), null, id);
  assert.strictEqual(d.getElementById('tab-cross').querySelectorAll('select').length, 0);
  assert.ok(d.getElementById('tab-cross').querySelectorAll('table').length > 0);
  assert.ok(!d.body.textContent.includes('重複拒否件数') && !d.body.textContent.includes('finalize'));
  assert.ok(!d.documentElement.outerHTML.includes('SECRET_IDEAS_TEXT'));
  assert.ok(d.getElementById('tab-overview').textContent.includes('有効回答数'));
});

test('未登録アカウント：権限なしを表示し、ダッシュボードは出さない。内部エラー・tokenは出さない', async () => {
  const { api } = backend();
  const page = await openAdminPage({ api });
  await page.login('STRANGER_TOKEN');
  assert.strictEqual(page.visible('dashboard-view'), false);
  assert.strictEqual(page.visible('login-view'), true);
  assert.ok(page.text('login-message').includes('このアカウントには管理画面の利用権限がありません'));
  assert.strictEqual(page.d.getElementById('panels').children.length, 0);
  assert.ok(!page.d.documentElement.outerHTML.includes('STRANGER_TOKEN'));
});

test('期限切れ・不正token：再ログインを促す。サーバーのエラー詳細は出さない', async () => {
  const { api } = backend();
  const page = await openAdminPage({ api });
  await page.login('EXPIRED_TOKEN');
  assert.strictEqual(page.visible('dashboard-view'), false);
  assert.ok(page.text('login-message').includes('もう一度ログインしてください'));
  assert.strictEqual(page.d.getElementById('panels').children.length, 0);
  // 通信失敗・想定外エラーは汎用メッセージ
  const down = await openAdminPage({ api: () => new Error('network down: TOKEN-DETAIL') });
  await down.login('OWNER_TOKEN');
  assert.ok(down.text('login-message').includes('読み込みに失敗しました'));
  assert.ok(!down.d.documentElement.outerHTML.includes('TOKEN-DETAIL'));
});

test('ログイン後のクロス集計もtokenを毎回送る。途中で期限切れになればダッシュボードを消してログイン画面へ', async () => {
  const { api } = backend();
  const page = await openAdminPage({ api });
  await page.login('OWNER_TOKEN');
  const cross = page.d.getElementById('tab-cross');
  cross.querySelector('button').click();
  await settle();
  const sent = page.calls[1].body;
  assert.deepStrictEqual(Object.keys(sent).sort(), ['action', 'colKey', 'idToken', 'rowKey']);
  assert.strictEqual(sent.action, 'crosstab');
  assert.strictEqual(sent.idToken, 'OWNER_TOKEN');
  assert.ok(sent.rowKey && sent.colKey);
  assert.strictEqual(cross.querySelectorAll('table').length, 18, '17プリセット + 任意集計の結果');
  // サーバーが unauthenticated を返す（tokenの有効期限切れ）
  const expiring = await openAdminPage({ api: (body) => (body.action === 'dashboard' ? api(body) : { ok: false, error: 'unauthenticated' }) });
  await expiring.login('OWNER_TOKEN');
  expiring.d.getElementById('tab-cross').querySelector('button').click();
  await settle();
  assert.strictEqual(expiring.visible('dashboard-view'), false);
  assert.strictEqual(expiring.visible('login-view'), true);
  assert.strictEqual(expiring.d.getElementById('panels').children.length, 0);
  assert.ok(expiring.text('login-message').includes('もう一度ログインしてください'));
});

test('ログアウト：保持tokenを破棄し、Dashboardを消してログイン画面へ戻す（再ログインは新しいtokenを使う）', async () => {
  const { api } = backend({ free_ideas: 'PRIVATE_FREE_TEXT' });
  const page = await openAdminPage({ api });
  await page.login('OWNER_TOKEN');
  assert.ok(page.d.documentElement.outerHTML.includes('PRIVATE_FREE_TEXT'));
  page.d.getElementById('logout').click();
  await settle();
  assert.strictEqual(page.visible('dashboard-view'), false);
  assert.strictEqual(page.visible('login-view'), true);
  assert.strictEqual(page.d.getElementById('tabs').children.length, 0);
  assert.strictEqual(page.d.getElementById('panels').children.length, 0);
  assert.strictEqual(page.text('role'), '');
  assert.ok(!page.d.documentElement.outerHTML.includes('PRIVATE_FREE_TEXT'), 'ダッシュボードの内容がDOMに残らない');
  assert.strictEqual(page.gis.disabled, 1);
  assert.strictEqual(page.calls.length, 1, 'ログアウト後は通信しない');
  // 別アカウント（VIEWER）で再ログインすると、OWNERのタブ・データは残らない
  await page.login('VIEWER_TOKEN');
  assert.strictEqual(page.calls[1].body.idToken, 'VIEWER_TOKEN');
  assert.ok(page.text('role').includes('VIEWER'));
  assert.strictEqual(page.d.getElementById('tab-free'), null);
  assert.ok(!page.d.documentElement.outerHTML.includes('PRIVATE_FREE_TEXT'));
});

test('tokenはDOM・URL・Storage・Cookie・consoleに露出せず、通信のbodyにだけ載る', async () => {
  const viewer = backend();
  const viewerData = plain(viewer.admin.ctx.getDashboardData(viewer.admin.tokenFor('viewer@gmail.com')));
  const page = await openAdminPage({ api: () => ({ ok: true, role: 'viewer', data: viewerData }) });
  await page.login(TOKEN);
  assert.ok(page.calls.length === 1 && page.calls[0].options.body.includes(TOKEN));
  assert.ok(!page.calls[0].url.includes(TOKEN) && !page.calls[0].url.includes('?'));
  assert.ok(!page.d.documentElement.outerHTML.includes(TOKEN));
  assert.ok(!page.w.location.href.includes(TOKEN) && !page.w.location.search && !page.w.location.hash);
  assert.ok(!page.w.document.cookie.includes(TOKEN));
  for (const store of [page.w.localStorage, page.w.sessionStorage]) {
    assert.strictEqual(store.length, 0);
  }
  assert.ok(!page.consoleLines.join('\n').includes(TOKEN));
  page.d.getElementById('logout').click();
  assert.ok(!page.d.documentElement.outerHTML.includes(TOKEN));
});

test('自由記述・その他のHTML/スクリプトは文字列として表示され、要素として解釈されない', async () => {
  const evil = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';
  const pub = loadPublic();
  pub.ctx.processSubmission_(JSON.stringify(validPayload(pub.ctx, { portrait_interest: 'other', free_ideas: evil, free_themes: evil, cheer_message: evil }, { portrait_interest: evil })), NOW);
  const admin = loadAdmin();
  admin.env.spreadsheet = pub.env.spreadsheet;
  const payload = plain(admin.ctx.getDashboardData(admin.owner()));
  const page = await openAdminPage({ api: () => ({ ok: true, role: 'owner', data: payload }) });
  await page.login('OWNER_TOKEN');
  assert.strictEqual(page.w.__xss, undefined);
  assert.strictEqual(page.d.querySelectorAll('img').length, 0);
  assert.strictEqual(page.d.querySelectorAll('script').length, 2); // config.js / admin.js のみ（自由記述由来のscriptなし）
  assert.ok(page.text('tab-free').includes(evil), '文字列としてそのまま表示される');
});

test('静的検査：HTMLにインラインscript・GA・外部の追加スクリプトがなく、noindex・CSPが付き、admin.js はstorage/console/innerHTMLを使わない', () => {
  const html = fs.readFileSync(path.join(REPO, PAGE), 'utf8');
  const js = fs.readFileSync(path.join(REPO, 'community/costume-portrait-survey-admin/admin.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); // コメント内の言及は除く
  const config = fs.readFileSync(path.join(REPO, 'community/costume-portrait-survey-admin/config.js'), 'utf8');
  assert.ok(/<meta name="robots" content="noindex, nofollow">/.test(html));
  assert.ok(/<meta http-equiv="Content-Security-Policy"/.test(html) && html.includes("default-src 'none'") && html.includes("script-src 'self' https://accounts.google.com/gsi/client"));
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(html), 'インラインscriptなし');
  assert.deepStrictEqual((html.match(/<script[^>]*src="([^"]+)"/g) || []).map((s) => s.match(/src="([^"]+)"/)[1]),
    ['costume-portrait-survey-admin/config.js', 'costume-portrait-survey-admin/admin.js']);
  assert.ok(!/gtag|googletagmanager|analytics/.test(html + js));
  for (const bad of ['innerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'localStorage', 'sessionStorage', 'document.cookie', 'console.', 'location.search', 'location.hash', 'atob(', 'JSON.parse(atob']) {
    assert.ok(!js.includes(bad), bad);
  }
  assert.ok(js.includes("credentials: 'omit'") && js.includes('text/plain'));
  // 設定ファイルにはエンドポイントとClient IDだけ（secret / token を置かない）
  assert.ok(/endpoint:/.test(config) && /googleClientId:/.test(config) && !/secret|refresh|idToken|password/i.test(config.replace(/\/\*[\s\S]*?\*\//, '')));
  // ページはsitemap / Public結果ページへのリンクに載せない
  assert.ok(!fs.readFileSync(path.join(REPO, 'sitemap.xml'), 'utf8').includes('costume-portrait-survey-admin'));
});
