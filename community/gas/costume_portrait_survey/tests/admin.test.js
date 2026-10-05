'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadPublic, loadAdmin, validPayload, plain, ROOT } = require('./helpers/gas-env');

const NOW = new Date('2026-11-01T12:00:00+09:00');

/** Public GAS で実際に保存した行を、Admin 用のフェイクSpreadsheetへ引き渡す。 */
function adminWith(variants, mutate) {
  const pub = loadPublic();
  variants.forEach((v) => {
    const r = plain(pub.ctx.processSubmission_(JSON.stringify(validPayload(pub.ctx, v.answers || {}, v.others || {})), v.now || NOW));
    assert.strictEqual(r.ok, true, JSON.stringify(r));
  });
  const admin = loadAdmin();
  admin.env.spreadsheet = pub.env.spreadsheet;
  if (mutate) mutate(admin, pub);
  return { admin, pub };
}
const dashboard = (admin) => plain(admin.ctx.getDashboardData(admin.owner()));
const view = (data, id) => data.sections.flatMap((s) => s.questions).find((q) => q.id === id);

test('データが無い場合も壊れず、0件のダッシュボードを返す', () => {
  const { admin } = adminWith([]);
  const data = dashboard(admin);
  assert.strictEqual(data.summary.totalRows, 0);
  assert.strictEqual(data.summary.validRows, 0);
  assert.strictEqual(data.summary.duplicateRejects, 0);
  assert.strictEqual(data.summary.finalize.status, 'not_finalized');
  assert.deepStrictEqual(data.byDay, []);
  assert.deepStrictEqual(data.funnels[0].stages.map((s) => s.count), [0, 0, 0, 0, 0]);
  assert.strictEqual(view(data, 'age_range').view.base, 0);
  assert.strictEqual(view(data, 'age_range').view.options[0].pct, 0);
  assert.strictEqual(data.crosstabPresets.length, 17);
  assert.deepStrictEqual(data.freeText.others, []);
});

test('responsesシートが存在しない場合はエラー（空扱いにしない）', () => {
  const admin = loadAdmin();
  admin.env.spreadsheet.insertSheet('other');
  assert.throws(() => admin.ctx.getDashboardData(admin.owner()), /responses_sheet_missing/);
});

test('1件だけの回答でも集計できる（総数・有効数・単純集計・日別）', () => {
  const { admin } = adminWith([{ answers: { age_range: 'age_25_29', costume_interest: ['uniform', 'rubber'], uniform_interest: ['uniform_baseball'] } }]);
  const data = dashboard(admin);
  assert.strictEqual(data.summary.totalRows, 1);
  assert.strictEqual(data.summary.validRows, 1);
  assert.deepStrictEqual(data.byDay, [{ date: '2026-11-01', count: 1 }]);
  const age = view(data, 'age_range').view;
  assert.strictEqual(age.base, 1);
  assert.strictEqual(age.options.find((o) => o.id === 'age_25_29').count, 1);
  assert.strictEqual(age.options.find((o) => o.id === 'age_25_29').pct, 100);
  const interest = view(data, 'costume_interest').view;
  assert.strictEqual(interest.options.find((o) => o.id === 'rubber').count, 1);
  assert.strictEqual(view(data, 'uniform_interest').view.options.find((o) => o.id === 'uniform_baseball').count, 1);
  // 居住地域・matrix も集計される
  assert.strictEqual(view(data, 'residence').view.base, 1);
  assert.strictEqual(view(data, 'intent_3m').matrix.length, 8);
});

test('複数選択の集計：count は「選んだ回答者数」、延べ選択数ではない', () => {
  const { admin } = adminWith([
    { answers: { backdrop: ['white', 'black', 'gray'] } },
    { answers: { backdrop: ['white'] } },
    { answers: { backdrop: ['black'] } }
  ]);
  const backdrop = view(dashboard(admin), 'backdrop').view;
  assert.strictEqual(backdrop.base, 3);
  const count = (id) => backdrop.options.find((o) => o.id === id).count;
  assert.strictEqual(count('white'), 2);
  assert.strictEqual(count('black'), 2);
  assert.strictEqual(count('gray'), 1);
  assert.strictEqual(backdrop.options.find((o) => o.id === 'white').pct, 66.7);
});

test('クロス集計：単一×複数、複数×複数、matrix行の軸（人数）', () => {
  const { admin } = adminWith([
    { answers: { age_range: 'age_20_24', costume_interest: ['uniform', 'suit'], uniform_interest: ['uniform_baseball'], costume_photographed: ['uniform'], backdrop: ['white'] } },
    { answers: { age_range: 'age_20_24', costume_interest: ['suit'], costume_photographed: ['suit', 'uniform'], backdrop: ['white', 'black'] } },
    { answers: { age_range: 'age_30_34', costume_interest: ['uniform'], uniform_interest: ['uniform_soccer'], costume_photographed: ['rubber'], backdrop: ['black'] } }
  ]);
  const x = plain(admin.ctx.getCrosstabData(admin.owner(), 'age_range', 'costume_interest'));
  const row = (id) => x.rows.find((r) => r.id === id);
  const col = (id) => x.cols.findIndex((c) => c.id === id);
  assert.strictEqual(row('age_20_24').base, 2);
  assert.strictEqual(row('age_20_24').cells[col('suit')], 2);
  assert.strictEqual(row('age_20_24').cells[col('uniform')], 1);
  assert.strictEqual(row('age_30_34').cells[col('uniform')], 1);
  const m = plain(admin.ctx.getCrosstabData(admin.owner(), 'costume_interest', 'costume_photographed'));
  const mrow = (id) => m.rows.find((r) => r.id === id);
  const mcol = (id) => m.cols.findIndex((c) => c.id === id);
  assert.strictEqual(mrow('suit').base, 2);
  assert.strictEqual(mrow('suit').cells[mcol('uniform')], 2); // 両方を選んだ「人数」（2人）
  assert.strictEqual(mrow('suit').cells[mcol('suit')], 1);
  assert.strictEqual(mrow('uniform').cells[mcol('rubber')], 1);
  assert.ok(m.note.includes('回答者数') && m.note.includes('合計は回答者数と一致しません'));
  // matrix の行を軸にできる
  const y = plain(admin.ctx.getCrosstabData(admin.owner(), 'intent_3m:get_portrait', 'age_range'));
  assert.strictEqual(y.rows.find((r) => r.id === 'interested').base, 3);
  assert.strictEqual(y.rows.find((r) => r.id === 'interested').cells[y.cols.findIndex((c) => c.id === 'age_20_24')], 2);
  // 不正な軸は拒否（任意のkeyを受け付けない）
  for (const bad of ['unknown', 'cheer_message', 'intent_3m', 'intent_3m:nope', 'age_range:x', '__proto__', '']) {
    assert.throws(() => admin.ctx.getCrosstabData(admin.owner(), bad, 'age_range'), /unknown_axis/, bad);
  }
});

test('主要クロス集計17種（時間帯は平日・土日祝を別集計）がすべて組み込まれ、計算できる', () => {
  const { admin } = adminWith([{ answers: {} }, { answers: { shooter_interest: 'want_to_try' } }]);
  const data = dashboard(admin);
  assert.deepStrictEqual(data.crosstabPresets.map((p) => p.id), [
    'age_x_costume', 'age_x_portrait_interest', 'costume_x_photographed', 'costume_x_shoot', 'costume_x_backdrop', 'interest_x_price',
    'interest_x_weekday', 'interest_x_weekday_time', 'interest_x_holiday_time', 'usage_x_interest', 'shooter_x_studio', 'studio_x_rental_price', 'experience_x_support', 'intent3m_x_price',
    'interest_x_suit_photographed', 'interest_x_school_photographed', 'interest_x_fetish_presentation']);
  for (const p of data.crosstabPresets) {
    assert.ok(p.rows.length && p.cols.length, p.id);
    assert.ok(p.rows.every((r) => r.cells.length === p.cols.length), p.id);
  }
  assert.ok(data.axes.length > 30);
  assert.ok(data.axes.some((a) => a.key === 'intent_3m:get_portrait'));
  assert.ok(!data.axes.some((a) => a.key === 'cheer_message'));
});

test('ファネルは schema 定義に従い、前段階を満たした人だけを数える', () => {
  const { admin } = adminWith([
    { answers: { portrait_interest: 'very_interested', intent_3m: { get_portrait: 'definitely', shoot_model: 'no', rent_studio: 'no', join_shoot_event: 'no', join_small_session: 'no', try_lighting: 'no', learn_shooting: 'no', meet_people: 'no' }, portrait_price: '7000_8999' } },
    { answers: { portrait_interest: 'interested', portrait_price: '15000_plus' } },
    { answers: { portrait_interest: 'not_at_all', portrait_price: '15000_plus' } }
  ]);
  const flow = dashboard(admin).funnels.find((f) => f.id === 'portrait_demand');
  assert.deepStrictEqual(flow.stages.map((s) => [s.id, s.count]), [['all', 3], ['portrait_interest', 2], ['wants_photographed', 2], ['near_term_intent', 1], ['price_7000_plus', 1]]);
});

test('重複拒否件数・締切後/日時不明の行・確定状態を表示できる', () => {
  const { admin, pub } = adminWith([{ answers: {} }], (a, p) => {
    const dup = validPayload(p.ctx);
    p.ctx.processSubmission_(JSON.stringify(dup), NOW);
    p.ctx.processSubmission_(JSON.stringify(dup), NOW); // duplicate
    const sheet = p.env.spreadsheet.getSheetByName('responses');
    const late = sheet.rows[1].slice(); late[0] = new Date('2027-02-01T00:00:00+09:00');
    const broken = sheet.rows[1].slice(); broken[0] = 'unknown';
    sheet.rows.push(late, broken);
  });
  const data = dashboard(admin);
  assert.strictEqual(data.summary.totalRows, 4);
  assert.strictEqual(data.summary.validRows, 2);
  assert.strictEqual(data.summary.lateRows, 1);
  assert.strictEqual(data.summary.unparseableRows, 1);
  assert.strictEqual(data.summary.duplicateRejects, 1);
  assert.strictEqual(data.summary.finalize.status, 'not_finalized');
  assert.ok(pub);
});

test('finalize 状態は Public GAS が書いた meta シートから表示される', () => {
  const { admin, pub } = adminWith([{ answers: {} }]);
  const done = plain(pub.ctx.finalizeSurvey_(new Date('2027-02-01T00:00:00+09:00')));
  const data = dashboard(admin);
  assert.strictEqual(data.summary.finalize.status, 'final');
  assert.strictEqual(data.summary.finalize.finalizedAt, done.finalizedAt);
  assert.strictEqual(data.summary.finalize.publicTotal, 1);
});

test('自由記述：「その他」・Q28・Q29・Q30 を管理画面から確認できる（公開側には出ない）', () => {
  const { admin } = adminWith([
    { answers: { portrait_interest: 'other', free_ideas: 'こんな撮影会', free_themes: '価格の調べ', cheer_message: '応援しています' }, others: { portrait_interest: '気分次第' } },
    { answers: { free_ideas: '=1+1', cheer_message: '-応援' } }
  ]);
  const data = dashboard(admin);
  const text = (id) => data.freeText.texts.find((t) => t.id === id).items.map((i) => i.text);
  assert.deepStrictEqual(text('free_ideas').sort(), ['=1+1', 'こんな撮影会']); // 保存時の ' 接頭辞は戻して表示
  assert.deepStrictEqual(text('free_themes'), ['価格の調べ']);
  assert.deepStrictEqual(text('cheer_message').sort(), ['-応援', '応援しています']);
  assert.strictEqual(data.freeText.texts.find((t) => t.id === 'cheer_message').items[0].at, '2026/11/01 12:00');
  const other = data.freeText.others.find((o) => o.id === 'portrait_interest');
  assert.deepStrictEqual(other.items.map((i) => i.text), ['気分次第']);
  assert.ok(data.freeText.others.every((o) => o.label.startsWith('Q')));
});


// ───────────── 認証（Googleが署名したID tokenのみが根拠） ─────────────
const OWNERS = 'owner@gmail.com';
const VIEWERS = 'viewer@gmail.com';
/** owners / viewers: null = Script Property 未設定 */
function configured(admin, owners = OWNERS, viewers = VIEWERS) {
  [['ADMIN_OWNER_EMAILS', owners], ['ADMIN_VIEWER_EMAILS', viewers]].forEach(([k, v]) => { if (v === null) admin.env.props.delete(k); else admin.env.props.set(k, v); });
  return admin;
}
const roleOf = (admin, token) => { try { return admin.ctx.assertAdminToken_(token).role; } catch (e) { return e.message; } };
const NOW_S = () => Math.floor(Date.now() / 1000);

test('認証：有効なOWNER tokenは owner、VIEWER tokenは viewer（個人Gmail）', () => {
  const admin = configured(loadAdmin());
  const owner = plain(admin.ctx.assertAdminToken_(admin.tokenFor('owner@gmail.com')));
  assert.deepStrictEqual(owner, { email: 'owner@gmail.com', sub: 'sub-owner@gmail.com', role: 'owner' });
  assert.strictEqual(roleOf(admin, admin.tokenFor('viewer@gmail.com')), 'viewer');
});

test('認証：有効でも未登録のメールは forbidden（OWNER/VIEWER未設定・空も forbidden）', () => {
  const admin = configured(loadAdmin());
  assert.strictEqual(roleOf(admin, admin.tokenFor('stranger@gmail.com')), 'forbidden');
  configured(admin, null, null);
  assert.strictEqual(roleOf(admin, admin.tokenFor('owner@gmail.com')), 'forbidden');
  configured(admin, '', '');
  assert.strictEqual(roleOf(admin, admin.tokenFor('owner@gmail.com')), 'forbidden');
  configured(admin, ' , ', ' ,, ');
  assert.strictEqual(roleOf(admin, admin.tokenFor('owner@gmail.com')), 'forbidden');
});

test('認証：OWNER/VIEWER両方に登録されていれば OWNER 優先。trim + lowercase で比較', () => {
  const admin = configured(loadAdmin(), 'both@gmail.com', 'both@gmail.com');
  assert.strictEqual(roleOf(admin, admin.tokenFor('both@gmail.com')), 'owner');
  configured(admin, ' Owner@Gmail.COM ', ' a@gmail.com , V@GMAIL.com ');
  assert.strictEqual(roleOf(admin, admin.tokenFor('OWNER@gmail.com')), 'owner');
  assert.strictEqual(roleOf(admin, admin.tokenFor('v@Gmail.com')), 'viewer');
  assert.strictEqual(plain(admin.ctx.getAdminIdentity_(admin.tokenFor('  Mixed@Gmail.com '))).email, 'mixed@gmail.com');
});

test('認証：偽造署名・別鍵署名は拒否（payloadを読むだけでは信用しない）', () => {
  const admin = configured(loadAdmin());
  const good = admin.tokenFor('owner@gmail.com');
  // 攻撃者が同じ kid で自分の鍵で署名
  assert.strictEqual(roleOf(admin, admin.tokenFor('owner@gmail.com', {}, { key: admin.jwt.ATTACKER_KEY })), 'unauthenticated');
  // payloadだけ差し替え（署名は元のまま）
  const [h, , sig] = good.split('.');
  const forged = h + '.' + admin.jwt.b64u(JSON.stringify(admin.jwt.claimsFor('viewer@gmail.com', { email: 'owner@gmail.com' }))) + '.' + sig;
  assert.strictEqual(roleOf(admin, forged), 'unauthenticated');
  // 署名なし / alg=none / HS256 / 未知kid
  assert.strictEqual(roleOf(admin, good.split('.').slice(0, 2).join('.') + '.'), 'unauthenticated');
  assert.strictEqual(roleOf(admin, admin.tokenFor('owner@gmail.com', {}, { header: { alg: 'none' } })), 'unauthenticated');
  assert.strictEqual(roleOf(admin, admin.tokenFor('owner@gmail.com', {}, { header: { alg: 'HS256' } })), 'unauthenticated');
  assert.strictEqual(roleOf(admin, admin.tokenFor('owner@gmail.com', {}, { header: { kid: 'unknown' } })), 'unauthenticated');
});

test('認証：aud / iss / exp / iat / email_verified / email / sub の不正は拒否', () => {
  const admin = configured(loadAdmin());
  const bad = (overrides) => roleOf(admin, admin.tokenFor('owner@gmail.com', overrides));
  assert.strictEqual(bad({}), 'owner');
  assert.strictEqual(bad({ aud: 'other-client.apps.googleusercontent.com' }), 'unauthenticated');
  assert.strictEqual(bad({ aud: [admin.jwt.CLIENT_ID] }), 'unauthenticated');
  assert.strictEqual(bad({ aud: undefined }), 'unauthenticated');
  assert.strictEqual(bad({ iss: 'https://evil.example.com' }), 'unauthenticated');
  assert.strictEqual(bad({ iss: 'accounts.google.com.evil.com' }), 'unauthenticated');
  assert.strictEqual(bad({ iss: undefined }), 'unauthenticated');
  assert.strictEqual(bad({ iss: 'accounts.google.com' }), 'owner'); // 公式に許される2形式
  assert.strictEqual(bad({ exp: NOW_S() - 1 }), 'unauthenticated');
  assert.strictEqual(bad({ exp: undefined }), 'unauthenticated');
  assert.strictEqual(bad({ exp: String(NOW_S() + 3600) }), 'unauthenticated');
  assert.strictEqual(bad({ iat: NOW_S() + 3600 }), 'unauthenticated');
  assert.strictEqual(bad({ email_verified: false }), 'unauthenticated');
  assert.strictEqual(bad({ email_verified: 'true' }), 'unauthenticated');
  assert.strictEqual(bad({ email_verified: undefined }), 'unauthenticated');
  assert.strictEqual(bad({ email: undefined }), 'unauthenticated');
  assert.strictEqual(bad({ email: '' }), 'unauthenticated');
  assert.strictEqual(bad({ sub: undefined }), 'unauthenticated');
});

test('認証：不正な形式のtoken・巨大token・ADMIN_GOOGLE_CLIENT_ID未設定は拒否（fail closed）', () => {
  const admin = configured(loadAdmin());
  for (const t of [undefined, null, '', 'abc', 'a.b', 'a.b.c', '...', '!!!.@@@.###', 123, {}, [], 'x'.repeat(5000)]) {
    assert.strictEqual(roleOf(admin, t), 'unauthenticated', String(t).slice(0, 20));
  }
  admin.env.props.delete('ADMIN_GOOGLE_CLIENT_ID');
  assert.strictEqual(roleOf(admin, admin.tokenFor('owner@gmail.com')), 'not_configured');
  admin.env.props.set('ADMIN_GOOGLE_CLIENT_ID', '  ');
  assert.strictEqual(roleOf(admin, admin.tokenFor('owner@gmail.com')), 'not_configured');
});

test('認証：Googleの公開鍵取得失敗は拒否。公開鍵はキャッシュされ、未知kidでの再取得は間隔を制限する', () => {
  const admin = configured(loadAdmin());
  admin.env.jwksStatus = 500;
  assert.strictEqual(roleOf(admin, admin.tokenFor('owner@gmail.com')), 'unauthenticated');
  admin.env.jwksStatus = 200;
  assert.strictEqual(roleOf(admin, admin.tokenFor('owner@gmail.com')), 'owner');
  const fetchesAfterFirst = admin.env.fetches.length;
  for (let i = 0; i < 3; i++) assert.strictEqual(roleOf(admin, admin.tokenFor('owner@gmail.com')), 'owner');
  assert.strictEqual(admin.env.fetches.length, fetchesAfterFirst, '有効な間は再取得しない');
  for (let i = 0; i < 5; i++) assert.strictEqual(roleOf(admin, admin.tokenFor('owner@gmail.com', {}, { header: { kid: 'rotated' } })), 'unauthenticated');
  assert.strictEqual(admin.env.fetches.length, fetchesAfterFirst, '未知kidの連打で外部取得しない');
  assert.ok(admin.env.fetches.every((f) => f.url === 'https://www.googleapis.com/oauth2/v3/certs' && f.options.method === 'get'));
  admin.env.jwks = [];
  admin.env.cache.clear();
  assert.strictEqual(roleOf(admin, admin.tokenFor('owner@gmail.com')), 'unauthenticated', '鍵が無ければ拒否');
});

test('認証：Session / クライアント指定の email・role は認証根拠にならない', () => {
  const admin = configured(loadAdmin());
  admin.env.activeEmail = 'owner@gmail.com'; // Sessionが何を返してもtokenが無ければ拒否
  assert.throws(() => admin.ctx.getDashboardData(), /unauthenticated/);
  assert.throws(() => admin.ctx.getDashboardData('owner@gmail.com'), /unauthenticated/);
  assert.throws(() => admin.ctx.getCrosstabData(undefined, 'age_range', 'costume_interest'), /unauthenticated/);
  // 旧 ADMIN_ALLOWED_EMAILS も使われない
  admin.env.props.set('ADMIN_ALLOWED_EMAILS', 'stranger@gmail.com');
  assert.strictEqual(roleOf(admin, admin.tokenFor('stranger@gmail.com')), 'forbidden');
});

// ───────────── API（doPost）: 毎回token必須・fail closed ─────────────
function post(admin, request) {
  const raw = typeof request === 'string' ? request : JSON.stringify(request);
  return JSON.parse(admin.ctx.doPost({ postData: { contents: raw, type: 'text/plain' } }).getContent());
}

test('API: getDashboardData / getCrosstabData は token 必須。期限切れtokenでは取得できない', () => {
  const admin = configured(loadAdmin());
  admin.env.spreadsheet.insertSheet('responses');
  assert.throws(() => admin.ctx.getDashboardData(), /unauthenticated/);
  assert.throws(() => admin.ctx.getCrosstabData('age_range', 'costume_interest'), /unauthenticated/);
  const expired = admin.tokenFor('owner@gmail.com', { exp: NOW_S() - 5 });
  assert.throws(() => admin.ctx.getDashboardData(expired), /unauthenticated/);
  assert.throws(() => admin.ctx.getCrosstabData(expired, 'age_range', 'costume_interest'), /unauthenticated/);
  assert.strictEqual(plain(admin.ctx.getDashboardData(admin.tokenFor('owner@gmail.com'))).role, 'owner');
});

test('API doPost: dashboard / crosstab は毎回tokenを検証し、ロールはサーバーが決める', () => {
  const admin = configured(loadAdmin());
  admin.env.spreadsheet.insertSheet('responses');
  const owner = post(admin, { action: 'dashboard', idToken: admin.tokenFor('owner@gmail.com') });
  assert.strictEqual(owner.ok, true);
  assert.strictEqual(owner.role, 'owner');
  assert.strictEqual(owner.data.role, 'owner');
  // クライアントが role / email を名乗っても無視される（VIEWERはVIEWERのまま）
  const viewer = post(admin, { action: 'dashboard', idToken: admin.tokenFor('viewer@gmail.com'), role: 'owner', email: 'owner@gmail.com', isOwner: true });
  assert.strictEqual(viewer.role, 'viewer');
  assert.ok(!('freeText' in viewer.data) && !('funnels' in viewer.data));
  // 最初の1回だけでなく、2回目以降のAPIも毎回検証する
  const x = post(admin, { action: 'crosstab', idToken: admin.tokenFor('owner@gmail.com'), rowKey: 'age_range', colKey: 'costume_interest' });
  assert.strictEqual(x.ok, true);
  assert.strictEqual(post(admin, { action: 'crosstab', idToken: admin.tokenFor('owner@gmail.com', { exp: NOW_S() - 5 }), rowKey: 'age_range', colKey: 'costume_interest' }).error, 'unauthenticated');
  assert.strictEqual(post(admin, { action: 'crosstab', rowKey: 'age_range', colKey: 'costume_interest' }).error, 'unauthenticated');
  assert.strictEqual(post(admin, { action: 'crosstab', idToken: admin.tokenFor('viewer@gmail.com'), rowKey: 'residence', colKey: 'sexual_orientation' }).error, 'forbidden');
  assert.strictEqual(post(admin, { action: 'crosstab', idToken: admin.tokenFor('owner@gmail.com'), rowKey: '__proto__', colKey: 'age_range' }).error, 'bad_request');
});

test('API doPost: 未認証・未登録・不正リクエストにはデータを一切返さない（エラーは分類コードのみ）', () => {
  const admin = configured(loadAdmin());
  const secret = loadPublic();
  secret.ctx.processSubmission_(JSON.stringify(validPayload(secret.ctx, { free_ideas: 'TOP_SECRET_TEXT' })), NOW);
  admin.env.spreadsheet = secret.env.spreadsheet;
  const cases = [
    [{ action: 'dashboard' }, 'unauthenticated'],
    [{ action: 'dashboard', idToken: '' }, 'unauthenticated'],
    [{ action: 'dashboard', idToken: 'garbage' }, 'unauthenticated'],
    [{ action: 'dashboard', idToken: admin.tokenFor('stranger@gmail.com') }, 'forbidden'],
    [{ action: 'dashboard', idToken: admin.tokenFor('owner@gmail.com', { email_verified: false }) }, 'unauthenticated'],
    [{ action: 'nope', idToken: admin.tokenFor('owner@gmail.com') }, 'bad_request'],
    [{ idToken: admin.tokenFor('owner@gmail.com') }, 'bad_request'],
    ['not json', 'bad_request'], ['', 'bad_request'], ['[]', 'bad_request'], ['null', 'bad_request'],
    ['{"action":"dashboard","idToken":"' + 'x'.repeat(9000) + '"}', 'bad_request']
  ];
  for (const [request, error] of cases) {
    const res = post(admin, request);
    assert.deepStrictEqual(res, { ok: false, error }, JSON.stringify(request).slice(0, 60));
    assert.ok(!JSON.stringify(res).includes('TOP_SECRET_TEXT'));
  }
  assert.deepStrictEqual(JSON.parse(admin.ctx.doPost({}).getContent()), { ok: false, error: 'bad_request' });
  assert.deepStrictEqual(JSON.parse(admin.ctx.doPost().getContent()), { ok: false, error: 'bad_request' });
  // 設定漏れ・Spreadsheet障害も内部情報を返さない
  admin.env.props.delete('ADMIN_GOOGLE_CLIENT_ID');
  assert.deepStrictEqual(post(admin, { action: 'dashboard', idToken: admin.tokenFor('owner@gmail.com') }), { ok: false, error: 'server_error' });
  admin.env.props.set('ADMIN_GOOGLE_CLIENT_ID', admin.jwt.CLIENT_ID);
  admin.env.failOpen = true;
  assert.deepStrictEqual(post(admin, { action: 'dashboard', idToken: admin.tokenFor('owner@gmail.com') }), { ok: false, error: 'server_error' });
});

test('API doGet: データを返さない（死活確認のみ）', () => {
  const admin = configured(loadAdmin());
  const pub = loadPublic();
  pub.ctx.processSubmission_(JSON.stringify(validPayload(pub.ctx, { free_ideas: 'TOP_SECRET_TEXT' })), NOW);
  admin.env.spreadsheet = pub.env.spreadsheet;
  for (const e of [undefined, {}, { parameter: { action: 'dashboard' } }, { parameter: { idToken: admin.tokenFor('owner@gmail.com') } }]) {
    assert.deepStrictEqual(JSON.parse(admin.ctx.doGet(e).getContent()), { ok: true, service: 'costume-portrait-survey-admin' });
  }
});

// ───────────── OWNER / VIEWER のデータ分離（PR #352 のレスポンス分離ロジックを再利用） ─────────────
const SECRET = {
  free_ideas: 'SECRET_IDEAS_TEXT', free_themes: 'SECRET_THEMES_TEXT', cheer_message: 'SECRET_CHEER_TEXT',
  residence_country: 'SECRET_COUNTRY_TEXT'
};
const SENSITIVE_IDS = ['sexual_orientation', 'residence', 'aichi_area', 'residence_country', 'free_ideas', 'free_themes', 'cheer_message',
  'fetish_presentation', 'hesitation', 'portrait_price', 'intent_3m', 'travel_range', 'rental_price', 'equipment_wanted'];

function roleSetup() {
  const pub = loadPublic();
  const answers = { portrait_interest: 'other', age_range: 'age_25_29', residence: 'pref_99', sexual_orientation: 'prefer_not' };
  const probe = validPayload(pub.ctx, answers, { portrait_interest: 'SECRET_OTHER_TEXT' });
  Object.assign(probe.answers, SECRET);
  const r = plain(pub.ctx.processSubmission_(JSON.stringify(probe), NOW));
  if (!r.ok) {
    // 居住国入力が許される選択肢へ切替（schema由来）
    const q = pub.ctx.SURVEY_SCHEMA.questions.find((x) => x.id === 'residence');
    const abroad = q.options.find((o) => /overseas|abroad|foreign/.test(o.id)) || q.options[q.options.length - 1];
    const retry = validPayload(pub.ctx, Object.assign({}, answers, { residence: abroad.id }), { portrait_interest: 'SECRET_OTHER_TEXT' });
    Object.assign(retry.answers, SECRET);
    assert.strictEqual(plain(pub.ctx.processSubmission_(JSON.stringify(retry), NOW)).ok, true);
  }
  pub.ctx.processSubmission_(JSON.stringify(validPayload(pub.ctx)), NOW);
  const admin = configured(loadAdmin());
  admin.env.spreadsheet = pub.env.spreadsheet;
  return admin;
}
const asViewer = (admin) => plain(admin.ctx.getDashboardData(admin.tokenFor('viewer@gmail.com')));
const asOwner = (admin) => plain(admin.ctx.getDashboardData(admin.tokenFor('owner@gmail.com')));

test('OWNER：自由記述・cheer_message・private項目・内部メタ・全クロス集計を従来どおり取得できる', () => {
  const admin = roleSetup();
  const data = asOwner(admin);
  assert.strictEqual(data.role, 'owner');
  const json = JSON.stringify(data);
  Object.values(SECRET).concat(['SECRET_OTHER_TEXT']).forEach((t) => assert.ok(json.includes(t), t));
  for (const id of ['sexual_orientation', 'residence', 'portrait_price', 'intent_3m']) assert.ok(view(data, id), id);
  assert.ok(data.summary.finalize && 'duplicateRejects' in data.summary && 'lateRows' in data.summary);
  assert.strictEqual(data.crosstabPresets.length, 17);
  assert.ok(data.funnels.length === 2 && data.axes.length > 30);
  assert.doesNotThrow(() => admin.ctx.getCrosstabData(admin.tokenFor('owner@gmail.com'), 'residence', 'sexual_orientation'));
});

test('VIEWER：総数・日別・allowlist単純集計は取得でき、自由記述/cheer/国名/内部metaは返却に存在しない', () => {
  const admin = roleSetup();
  const data = asViewer(admin);
  assert.strictEqual(data.role, 'viewer');
  assert.strictEqual(data.summary.totalRows, 2);
  assert.strictEqual(data.summary.validRows, 2);
  assert.deepStrictEqual(data.byDay, [{ date: '2026-11-01', count: 2 }]);
  assert.strictEqual(view(data, 'age_range').view.base, 2);
  assert.strictEqual(view(data, 'age_range').view.options.find((o) => o.id === 'age_25_29').count, 1);
  // doPost 経由のレスポンス全体にも含まれない
  const wire = JSON.stringify(post(admin, { action: 'dashboard', idToken: admin.tokenFor('viewer@gmail.com') }));
  Object.values(SECRET).concat(['SECRET_OTHER_TEXT']).forEach((t) => assert.ok(!wire.includes(t), t));
  const json = JSON.stringify(data);
  for (const key of ['freeText', 'funnels', 'axes', 'finalize', 'duplicateRejects', 'lateRows', 'unparseableRows', 'schemaVersion']) {
    assert.ok(!json.includes('"' + key + '"'), key);
  }
  for (const id of SENSITIVE_IDS) assert.ok(!json.includes('"' + id + '"'), id);
  assert.deepStrictEqual(data.sections.flatMap((s) => s.questions).map((q) => q.id).sort(), plain(admin.ctx.getViewerAllowedQuestionIds_()).sort());
});

test('VIEWER：allowlistは明示定義で、センシティブ設問・自由記述を含まない／クロス集計は両軸が許可済みのものだけ', () => {
  const admin = roleSetup();
  const allowed = plain(admin.ctx.getViewerAllowedQuestionIds_());
  const schema = admin.ctx.SURVEY_SCHEMA;
  for (const id of SENSITIVE_IDS) assert.ok(!allowed.includes(id), id);
  assert.ok(allowed.every((id) => schema.questions.find((q) => q.id === id).type !== 'text'));
  const data = asViewer(admin);
  assert.ok(data.crosstabPresets.length > 0 && data.crosstabPresets.length < 17);
  for (const p of data.crosstabPresets) {
    const def = schema.crosstabs.find((c) => c.id === p.id);
    assert.ok(allowed.includes(def.row.question) && allowed.includes(def.col.question), p.id);
  }
  assert.ok(!data.crosstabPresets.some((p) => /price|fetish|studio|support/.test(p.id)));
});

test('VIEWER：禁止クロス集計・任意軸は拒否、許可プリセットは取得可（クライアントの指定は信用しない）', () => {
  const admin = roleSetup();
  const v = admin.tokenFor('viewer@gmail.com');
  for (const [r, c] of [['residence', 'sexual_orientation'], ['age_range', 'residence'], ['portrait_interest', 'portrait_price'],
    ['age_range', 'cheer_message'], ['intent_3m:get_portrait', 'age_range'], ['age_range', 'backdrop'], ['costume_interest', 'age_range']]) {
    assert.throws(() => admin.ctx.getCrosstabData(v, r, c), /forbidden/, r + '×' + c);
  }
  assert.strictEqual(plain(admin.ctx.getCrosstabData(v, 'age_range', 'costume_interest')).rowKey, 'age_range');
  // OWNERは同じ関数で任意軸を取得できる
  assert.doesNotThrow(() => admin.ctx.getCrosstabData(admin.tokenFor('owner@gmail.com'), 'age_range', 'backdrop'));
});

test('Admin GAS は読み取り専用で、Public GAS とは別プロジェクト（管理機能を混在させない）', () => {
  const adminSource = fs.readdirSync(path.join(ROOT, 'admin')).filter((f) => /\.(gs|html)$/.test(f))
    .map((f) => fs.readFileSync(path.join(ROOT, 'admin', f), 'utf8')).join('\n');
  for (const api of ['appendRow', 'setValue', 'setValues', 'setFormula', 'clearContent', '.clear(', 'deleteSheet', 'deleteRow', 'insertSheet', 'MailApp', 'sendEmail', 'setProperty', 'deleteProperty']) {
    assert.ok(!adminSource.includes(api), api);
  }
  // token・メール・例外内容をログへ出さない／Sessionを認証根拠にしない／Spreadsheet・Propertiesへtokenを保存しない
  const code = adminSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); // コメント内の言及は除く
  for (const api of ['Logger.', 'console.', 'Session.', 'getActiveUser', 'getEmail', 'HtmlService', 'tokeninfo']) assert.ok(!code.includes(api), api);
  // 外部通信は Google の公開鍵取得（GET）の1箇所だけ
  assert.strictEqual((adminSource.match(/UrlFetchApp\.fetch\(/g) || []).length, 1);
  assert.ok(adminSource.includes("'https://www.googleapis.com/oauth2/v3/certs'"));
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'admin', 'appsscript.json'), 'utf8'));
  // 個人Gmailのロール分離のため匿名到達可（ID token未検証ならデータは一切返さない）＋デプロイ者権限でSpreadsheetを読む
  assert.strictEqual(manifest.webapp.access, 'ANYONE_ANONYMOUS');
  assert.strictEqual(manifest.webapp.executeAs, 'USER_DEPLOYING');
  assert.deepStrictEqual(manifest.oauthScopes.slice().sort(), [
    'https://www.googleapis.com/auth/script.external_request', 'https://www.googleapis.com/auth/spreadsheets']);
  // openById には spreadsheets scope が必須（#358）。書き込みはコード側で存在しないこと（上の静的検査）で担保する
  const publicSource = fs.readdirSync(path.join(ROOT, 'public')).filter((f) => f.endsWith('.gs'))
    .map((f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8')).join('\n');
  for (const word of ['getDashboardData', 'getCrosstabData', 'HtmlService', 'ADMIN_ALLOWED_EMAILS', 'ADMIN_OWNER_EMAILS', 'ADMIN_VIEWER_EMAILS', 'ADMIN_GOOGLE_CLIENT_ID', 'getActiveUser', 'verifyGoogleIdToken_']) assert.ok(!publicSource.includes(word), word);
  const publicManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'appsscript.json'), 'utf8'));
  assert.ok(publicManifest.oauthScopes.includes('https://www.googleapis.com/auth/script.send_mail'));
  assert.ok(publicManifest.oauthScopes.includes('https://www.googleapis.com/auth/spreadsheets'));
  assert.strictEqual(publicManifest.webapp, undefined, 'Public Web Appの公開設定はデプロイ側で管理し、CIは変更しない');
});

test('README：個人Gmail対応の認証方式・OAuth Client設定・tokenを保存しないこと・本番反映手順が記載されている', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  for (const word of ['ADMIN_GOOGLE_CLIENT_ID', 'ADMIN_OWNER_EMAILS', 'ADMIN_VIEWER_EMAILS', '承認済みの JavaScript 生成元', 'https://nagoya-base.github.io',
    'ANYONE_ANONYMOUS', 'USER_DEPLOYING', 'script.external_request', 'ログアウト', '署名', 'OWNER 優先', 'ロール確認']) {
    assert.ok(readme.includes(word), word);
  }
  assert.ok(readme.includes('VIEWER に Spreadsheet') || readme.includes('VIEWER へは共有しない'));
  assert.ok(/Storage|localStorage/.test(readme) && readme.includes('メモリ上の変数だけ'));
  assert.ok(!/ADMIN_ALLOWED_EMAILS` \(カンマ|アクセス=\*\*自分のみ/.test(readme), '旧方式の手順を残さない');
  // 本番deploy前チェックリスト（実機診断 + 実通信）
  for (const word of ['本番deploy前チェックリスト', 'diagBigIntAndRsa', 'diagJwksFetch', 'diagVerifyRealToken', 'diagClearToken', 'GISログイン成功', 'クロスオリジンPOST成功',
    'OWNER取得成功', 'VIEWER取得成功', '未登録Gmailはforbidden', 'token期限切れはunauthenticated', 'VIEWERレスポンスに自由記述等が含まれない']) assert.ok(readme.includes(word), word);
  assert.ok(readme.includes('"error":"forbidden"') && readme.includes('"error":"unauthenticated"'));
  assert.ok(/readonly.*権限不足/.test(readme.replace(/\n/g, '')) || readme.includes('spreadsheets.readonly` では実行時に権限不足'));
});
