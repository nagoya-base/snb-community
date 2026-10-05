'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadPublic, loadAdmin, validPayload, plain, ROOT } = require('./helpers/gas-env');
const { buildPage } = require('./helpers/admin-page');

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
const dashboard = (admin) => plain(admin.ctx.getDashboardData());
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
  assert.throws(() => admin.ctx.getDashboardData(), /responses_sheet_missing/);
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
  const x = plain(admin.ctx.getCrosstabData('age_range', 'costume_interest'));
  const row = (id) => x.rows.find((r) => r.id === id);
  const col = (id) => x.cols.findIndex((c) => c.id === id);
  assert.strictEqual(row('age_20_24').base, 2);
  assert.strictEqual(row('age_20_24').cells[col('suit')], 2);
  assert.strictEqual(row('age_20_24').cells[col('uniform')], 1);
  assert.strictEqual(row('age_30_34').cells[col('uniform')], 1);
  const m = plain(admin.ctx.getCrosstabData('costume_interest', 'costume_photographed'));
  const mrow = (id) => m.rows.find((r) => r.id === id);
  const mcol = (id) => m.cols.findIndex((c) => c.id === id);
  assert.strictEqual(mrow('suit').base, 2);
  assert.strictEqual(mrow('suit').cells[mcol('uniform')], 2); // 両方を選んだ「人数」（2人）
  assert.strictEqual(mrow('suit').cells[mcol('suit')], 1);
  assert.strictEqual(mrow('uniform').cells[mcol('rubber')], 1);
  assert.ok(m.note.includes('回答者数') && m.note.includes('合計は回答者数と一致しません'));
  // matrix の行を軸にできる
  const y = plain(admin.ctx.getCrosstabData('intent_3m:get_portrait', 'age_range'));
  assert.strictEqual(y.rows.find((r) => r.id === 'interested').base, 3);
  assert.strictEqual(y.rows.find((r) => r.id === 'interested').cells[y.cols.findIndex((c) => c.id === 'age_20_24')], 2);
  // 不正な軸は拒否（任意のkeyを受け付けない）
  for (const bad of ['unknown', 'cheer_message', 'intent_3m', 'intent_3m:nope', 'age_range:x', '__proto__', '']) {
    assert.throws(() => admin.ctx.getCrosstabData(bad, 'age_range'), /unknown_axis/, bad);
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

function asRole(admin, email, owners, viewers) {
  admin.env.activeEmail = email;
  ['ADMIN_OWNER_EMAILS', 'ADMIN_VIEWER_EMAILS'].forEach((k, i) => {
    const v = [owners, viewers][i];
    if (v === undefined) admin.env.props.delete(k); else admin.env.props.set(k, v);
  });
}
const roleOf = (admin) => { try { return admin.ctx.getAdminRole_(); } catch (e) { return String(e.message); } };

test('認証：許可メール以外・未設定・取得不能はすべて拒否（fail closed）', () => {
  const admin = loadAdmin();
  admin.env.spreadsheet.insertSheet('responses');
  assert.doesNotThrow(() => admin.ctx.getDashboardData());
  admin.env.activeEmail = 'someone@example.com';
  assert.throws(() => admin.ctx.getDashboardData(), /forbidden/);
  assert.throws(() => admin.ctx.getCrosstabData('age_range', 'costume_interest'), /forbidden/);
  assert.throws(() => admin.ctx.doGet(), /forbidden/);
  admin.env.activeEmail = '';
  assert.throws(() => admin.ctx.getDashboardData(), /forbidden/);
  admin.env.activeEmail = 'ADMIN@example.com ';
  assert.doesNotThrow(() => admin.ctx.getDashboardData());
  admin.env.props.delete('ADMIN_OWNER_EMAILS');
  assert.throws(() => admin.ctx.getDashboardData(), /forbidden/);
  admin.env.props.set('ADMIN_OWNER_EMAILS', ' , ');
  assert.throws(() => admin.ctx.getDashboardData(), /forbidden/);
});

test('ロール判定：owner / viewer / 未登録 / 両方登録はowner優先 / 正規化 / 未設定・空・メール空', () => {
  const admin = loadAdmin();
  asRole(admin, 'o@example.com', 'o@example.com', 'v@example.com');
  assert.strictEqual(roleOf(admin), 'owner');
  asRole(admin, 'v@example.com', 'o@example.com', 'v@example.com');
  assert.strictEqual(roleOf(admin), 'viewer');
  asRole(admin, 'x@example.com', 'o@example.com', 'v@example.com');
  assert.strictEqual(roleOf(admin), 'forbidden');
  asRole(admin, 'both@example.com', 'both@example.com', 'both@example.com');
  assert.strictEqual(roleOf(admin), 'owner');
  asRole(admin, '  V@Example.COM ', 'o@example.com', ' a@example.com , V@EXAMPLE.com ');
  assert.strictEqual(roleOf(admin), 'viewer');
  asRole(admin, 'O@EXAMPLE.COM', ' o@example.com ', undefined);
  assert.strictEqual(roleOf(admin), 'owner');
  // 未設定・空・空白のみ
  asRole(admin, 'v@example.com', undefined, undefined);
  assert.strictEqual(roleOf(admin), 'forbidden');
  asRole(admin, 'v@example.com', '', '');
  assert.strictEqual(roleOf(admin), 'forbidden');
  asRole(admin, 'v@example.com', ' , ', ' ,, ');
  assert.strictEqual(roleOf(admin), 'forbidden');
  // Sessionメールが空 / 取得で例外
  asRole(admin, '', 'o@example.com', 'v@example.com');
  assert.strictEqual(roleOf(admin), 'forbidden');
  admin.env.sandbox.Session.getActiveUser = () => { throw new Error('no'); };
  asRole(admin, 'o@example.com', 'o@example.com', 'v@example.com');
  assert.strictEqual(roleOf(admin), 'forbidden');
});

test('旧 ADMIN_ALLOWED_EMAILS は fallback として使われない（設定漏れは拒否）', () => {
  const admin = loadAdmin();
  asRole(admin, 'legacy@example.com', undefined, undefined);
  admin.env.props.set('ADMIN_ALLOWED_EMAILS', 'legacy@example.com');
  assert.strictEqual(roleOf(admin), 'forbidden');
  assert.throws(() => admin.ctx.getDashboardData(), /forbidden/);
  assert.throws(() => admin.ctx.doGet(), /forbidden/);
});

const SECRET = {
  free_ideas: 'SECRET_IDEAS_TEXT', free_themes: 'SECRET_THEMES_TEXT', cheer_message: 'SECRET_CHEER_TEXT',
  residence_country: 'SECRET_COUNTRY_TEXT'
};
const SENSITIVE_IDS = ['sexual_orientation', 'residence', 'aichi_area', 'residence_country', 'free_ideas', 'free_themes', 'cheer_message',
  'fetish_presentation', 'hesitation', 'portrait_price', 'intent_3m', 'travel_range', 'rental_price', 'equipment_wanted'];

function roleSetup(role) {
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
  const admin = loadAdmin();
  admin.env.spreadsheet = pub.env.spreadsheet;
  asRole(admin, role + '@example.com', 'owner@example.com', 'viewer@example.com');
  return { admin, pub };
}

test('OWNER：自由記述・cheer_message・private項目・内部メタ・全クロス集計を従来どおり取得できる', () => {
  const { admin } = roleSetup('owner');
  const data = dashboard(admin);
  assert.strictEqual(data.role, 'owner');
  const json = JSON.stringify(data);
  Object.values(SECRET).concat(['SECRET_OTHER_TEXT']).forEach((t) => assert.ok(json.includes(t), t));
  for (const id of ['sexual_orientation', 'residence', 'portrait_price', 'intent_3m']) assert.ok(view(data, id), id);
  assert.ok(data.summary.finalize && 'duplicateRejects' in data.summary && 'lateRows' in data.summary);
  assert.strictEqual(data.crosstabPresets.length, 17);
  assert.ok(data.funnels.length === 2 && data.axes.length > 30);
  assert.doesNotThrow(() => admin.ctx.getCrosstabData('residence', 'sexual_orientation'));
});

test('VIEWER：総数・日別・allowlist単純集計は取得でき、自由記述/cheer/国名/内部metaは返却に存在しない', () => {
  const { admin } = roleSetup('viewer');
  const data = dashboard(admin);
  assert.strictEqual(data.role, 'viewer');
  assert.strictEqual(data.summary.totalRows, 2);
  assert.strictEqual(data.summary.validRows, 2);
  assert.deepStrictEqual(data.byDay, [{ date: '2026-11-01', count: 2 }]);
  assert.strictEqual(view(data, 'age_range').view.base, 2);
  assert.strictEqual(view(data, 'age_range').view.options.find((o) => o.id === 'age_25_29').count, 1);
  const json = JSON.stringify(data);
  Object.values(SECRET).concat(['SECRET_OTHER_TEXT']).forEach((t) => assert.ok(!json.includes(t), t));
  for (const key of ['freeText', 'funnels', 'axes', 'finalize', 'duplicateRejects', 'lateRows', 'unparseableRows', 'schemaVersion']) {
    assert.ok(!json.includes('"' + key + '"'), key);
  }
  for (const id of SENSITIVE_IDS) assert.ok(!json.includes('"' + id + '"'), id);
  assert.deepStrictEqual(data.sections.flatMap((s) => s.questions).map((q) => q.id).sort(), plain(admin.ctx.getViewerAllowedQuestionIds_()).sort());
});

test('VIEWER：allowlistは明示定義で、センシティブ設問・自由記述を含まない／クロス集計は両軸が許可済みのものだけ', () => {
  const { admin } = roleSetup('viewer');
  const allowed = plain(admin.ctx.getViewerAllowedQuestionIds_());
  const schema = admin.ctx.SURVEY_SCHEMA;
  for (const id of SENSITIVE_IDS) assert.ok(!allowed.includes(id), id);
  assert.ok(allowed.every((id) => schema.questions.find((q) => q.id === id).type !== 'text'));
  const data = dashboard(admin);
  assert.ok(data.crosstabPresets.length > 0 && data.crosstabPresets.length < 17);
  for (const p of data.crosstabPresets) {
    const def = schema.crosstabs.find((c) => c.id === p.id);
    assert.ok(allowed.includes(def.row.question) && allowed.includes(def.col.question), p.id);
  }
  assert.ok(!data.crosstabPresets.some((p) => /price|fetish|studio|support/.test(p.id)));
});

test('VIEWER：禁止クロス集計・任意軸は拒否、許可プリセットは取得可（クライアントの指定は信用しない）', () => {
  const { admin } = roleSetup('viewer');
  for (const [r, c] of [['residence', 'sexual_orientation'], ['age_range', 'residence'], ['portrait_interest', 'portrait_price'],
    ['age_range', 'cheer_message'], ['intent_3m:get_portrait', 'age_range'], ['age_range', 'backdrop'], ['costume_interest', 'age_range']]) {
    assert.throws(() => admin.ctx.getCrosstabData(r, c), /forbidden/, r + '×' + c);
  }
  const ok = plain(admin.ctx.getCrosstabData('age_range', 'costume_interest'));
  assert.strictEqual(ok.rowKey, 'age_range');
  // OWNERは同じ関数で任意軸を取得できる
  asRole(admin, 'owner@example.com', 'owner@example.com', 'viewer@example.com');
  assert.doesNotThrow(() => admin.ctx.getCrosstabData('age_range', 'backdrop'));
});

test('Dashboard UI：ロール表示。VIEWERでは返却されなかったタブ（ファネル・自由記述）がDOMごと存在しない', () => {
  const owner = roleSetup('owner');
  const o = buildPage(plain(owner.admin.ctx.getDashboardData()));
  assert.ok(o.w.document.getElementById('role').textContent.includes('OWNER'));
  assert.ok(o.w.document.getElementById('tab-free') && o.w.document.getElementById('tab-funnel'));
  const viewer = roleSetup('viewer');
  const v = buildPage(plain(viewer.admin.ctx.getDashboardData()));
  const doc = v.w.document;
  assert.ok(doc.getElementById('role').textContent.includes('VIEWER'));
  assert.strictEqual(doc.getElementById('tab-free'), null);
  assert.strictEqual(doc.getElementById('tab-funnel'), null);
  assert.strictEqual(doc.querySelector('[data-tab="free"]'), null);
  assert.strictEqual(doc.querySelector('[data-tab="funnel"]'), null);
  assert.strictEqual(doc.getElementById('tab-cross').querySelectorAll('select').length, 0);
  assert.ok(doc.getElementById('tab-cross').querySelectorAll('table').length > 0);
  assert.ok(!doc.body.textContent.includes('重複拒否件数') && !doc.body.textContent.includes('finalize'));
  assert.ok(doc.getElementById('tab-overview').textContent.includes('有効回答数'));
});

test('README は ANYONE=全員のメール取得可 とは書かず、同一Workspaceドメイン等の条件を明記している', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.ok(readme.includes('OWNER / VIEWER として利用できるGoogleアカウント条件'));
  assert.ok(readme.includes('同一Workspaceドメイン') && readme.includes('個人Gmail'));
  assert.ok(readme.includes('「ログイン済みGoogleユーザー全員のメールが取れる」設定ではない'));
  assert.ok(!/ANYONE[^\n]*(なら|であれば)[^\n]*メール[^\n]*(取得できる|取れる)/.test(readme));
});

test('Admin GAS は読み取り専用で、Public GAS とは別プロジェクト（管理機能を混在させない）', () => {
  const adminSource = fs.readdirSync(path.join(ROOT, 'admin')).filter((f) => /\.(gs|html)$/.test(f))
    .map((f) => fs.readFileSync(path.join(ROOT, 'admin', f), 'utf8')).join('\n');
  for (const api of ['appendRow', 'setValue', 'setValues', 'setFormula', 'clearContent', '.clear(', 'deleteSheet', 'deleteRow', 'insertSheet', 'MailApp', 'sendEmail', 'setProperty', 'deleteProperty']) {
    assert.ok(!adminSource.includes(api), api);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'admin', 'appsscript.json'), 'utf8'));
  // 別Googleアカウント（OWNER/VIEWER）が到達できる必要があるため MYSELF ではなく ANYONE（ログイン済みGoogleユーザー）。匿名は不可。
  // 認可はデプロイ後の実行時に Session メール × ADMIN_OWNER/VIEWER_EMAILS で fail closed 判定する（Auth.gs）。
  assert.strictEqual(manifest.webapp.access, 'ANYONE');
  assert.notStrictEqual(manifest.webapp.access, 'ANYONE_ANONYMOUS');
  assert.strictEqual(manifest.webapp.executeAs, 'USER_DEPLOYING'); // Spreadsheetはデプロイ者のみ。VIEWERへ直接共有しない
  assert.ok(manifest.oauthScopes.every((s) => !s.endsWith('/spreadsheets') && !s.includes('send_mail')));
  const publicSource = fs.readdirSync(path.join(ROOT, 'public')).filter((f) => f.endsWith('.gs'))
    .map((f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8')).join('\n');
  for (const word of ['getDashboardData', 'getCrosstabData', 'HtmlService', 'ADMIN_ALLOWED_EMAILS', 'ADMIN_OWNER_EMAILS', 'ADMIN_VIEWER_EMAILS', 'getActiveUser']) assert.ok(!publicSource.includes(word), word);
  const publicManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'appsscript.json'), 'utf8'));
  assert.ok(publicManifest.oauthScopes.includes('https://www.googleapis.com/auth/script.send_mail'));
  assert.ok(publicManifest.oauthScopes.includes('https://www.googleapis.com/auth/spreadsheets'));
  assert.strictEqual(publicManifest.webapp, undefined, 'Public Web Appの公開設定はデプロイ側で管理し、CIは変更しない');
});
