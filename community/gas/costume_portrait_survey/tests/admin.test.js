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


// ───────────── Web App（OWNER 1名専用。Issue #363） ─────────────
const adminFile = (name) => fs.readFileSync(path.join(ROOT, 'admin', name), 'utf8');

test('doGet は管理ダッシュボードHTMLを返す（ヘルスチェックJSONではない）。includeは展開済みで scriptlet が残らない', () => {
  const { admin } = adminWith([{}]);
  const out = admin.ctx.doGet();
  const html = out.getContent();
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(html.includes('id="dashboard-view"') && html.includes('id="tabs"') && html.includes('id="panels"'));
  assert.ok(html.includes('<style>') && html.includes('google.script.run') && html.includes('getDashboardData'));
  assert.ok(!html.includes('<?'), 'scriptlet が未展開のまま');
  assert.ok(html.includes('noindex'));
  assert.ok(out.title.includes('管理ダッシュボード'));
  assert.ok(!html.includes('"service"'));
});

test('google.script.run から呼ぶ getDashboardData / getCrosstabData は引数なし認証で、OWNER向けの完全な集計を返す', () => {
  const { admin } = adminWith([{}, { answers: { age_range: 'age_25_29' } }]);
  const data = plain(admin.ctx.getDashboardData());
  assert.strictEqual(data.summary.validRows, 2);
  const x = plain(admin.ctx.getCrosstabData('age_range', 'costume_interest'));
  assert.ok(x.rows.length && x.cols.length);
  assert.throws(() => admin.ctx.getCrosstabData('__proto__', 'age_range'), /unknown_axis/);
  // google.script.run はJSONシリアライズ可能な値のみ返せる
  assert.deepStrictEqual(JSON.parse(JSON.stringify(data)), data);
});

test('OWNER集計：自由記述・cheer_message・private項目・内部メタ・全クロス集計・需要ファネルを取得できる', () => {
  const pub = loadPublic();
  const answers = { portrait_interest: 'other', age_range: 'age_25_29', residence: 'pref_99', sexual_orientation: 'prefer_not' };
  const SECRET = { free_ideas: 'SECRET_IDEAS_TEXT', free_themes: 'SECRET_THEMES_TEXT', cheer_message: 'SECRET_CHEER_TEXT', residence_country: 'SECRET_COUNTRY_TEXT' };
  const probe = validPayload(pub.ctx, answers, { portrait_interest: 'SECRET_OTHER_TEXT' });
  Object.assign(probe.answers, SECRET);
  if (!plain(pub.ctx.processSubmission_(JSON.stringify(probe), NOW)).ok) {
    const q = pub.ctx.SURVEY_SCHEMA.questions.find((x) => x.id === 'residence');
    const abroad = q.options.find((o) => /overseas|abroad|foreign/.test(o.id)) || q.options[q.options.length - 1];
    const retry = validPayload(pub.ctx, Object.assign({}, answers, { residence: abroad.id }), { portrait_interest: 'SECRET_OTHER_TEXT' });
    Object.assign(retry.answers, SECRET);
    assert.strictEqual(plain(pub.ctx.processSubmission_(JSON.stringify(retry), NOW)).ok, true);
  }
  pub.ctx.processSubmission_(JSON.stringify(validPayload(pub.ctx)), NOW);
  const admin = loadAdmin();
  admin.env.spreadsheet = pub.env.spreadsheet;
  const data = plain(admin.ctx.getDashboardData());
  assert.ok(!('role' in data), 'ロールの概念は無い');
  const json = JSON.stringify(data);
  Object.values(SECRET).concat(['SECRET_OTHER_TEXT']).forEach((t) => assert.ok(json.includes(t), t));
  for (const id of ['sexual_orientation', 'residence', 'portrait_price', 'intent_3m']) assert.ok(view(data, id), id);
  assert.ok(data.summary.finalize && 'duplicateRejects' in data.summary && 'lateRows' in data.summary);
  assert.strictEqual(data.crosstabPresets.length, 17);
  assert.ok(data.funnels.length === 2 && data.axes.length > 30);
  assert.ok(data.demandFunnels && data.demandFunnels.funnels.length === 5, '需要ファネル5種（#361）');
  assert.doesNotThrow(() => admin.ctx.getCrosstabData('residence', 'sexual_orientation'));
});

test('OAuth / ID token / VIEWER 依存が無く、残存するScript Propertyが管理画面をブロックしない', () => {
  const { admin } = adminWith([{}]);
  const dashboardWith = (props) => {
    Object.entries(props).forEach(([k, v]) => admin.env.props.set(k, v));
    return plain(admin.ctx.getDashboardData());
  };
  const base = dashboardWith({});
  // 旧構成のScript Propertiesが残っていても結果は変わらない（削除は本番確認後に手動）
  assert.deepStrictEqual(dashboardWith({ ADMIN_GOOGLE_CLIENT_ID: 'x.apps.googleusercontent.com', ADMIN_OWNER_EMAILS: 'a@gmail.com', ADMIN_VIEWER_EMAILS: 'b@gmail.com' }), base);
  for (const name of ['Auth.gs', 'IdToken.gs']) assert.ok(!fs.existsSync(path.join(ROOT, 'admin', name)), name);
  assert.ok(!fs.existsSync(path.join(ROOT, 'diagnostics')));
  const code = fs.readdirSync(path.join(ROOT, 'admin')).filter((f) => /\.(gs|html)$/.test(f)).map(adminFile).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const word of ['ADMIN_GOOGLE_CLIENT_ID', 'ADMIN_OWNER_EMAILS', 'ADMIN_VIEWER_EMAILS', 'idToken', 'verifyGoogleIdToken_', 'accounts.google.com', 'googleClientId',
    'VIEWER_ALLOWED', 'buildViewerDashboard_', 'ADMIN_ROLE', 'doPost', 'fetch(']) assert.ok(!code.includes(word), word);
});

test('Admin GAS は読み取り専用・OWNER 1名専用の設定で、Public GAS とは別プロジェクト（管理機能を混在させない）', () => {
  const adminSource = fs.readdirSync(path.join(ROOT, 'admin')).filter((f) => /\.(gs|html)$/.test(f)).map(adminFile).join('\n');
  for (const api of ['appendRow', 'setValue', 'setValues', 'setFormula', 'clearContent', '.clear(', 'deleteSheet', 'deleteRow', 'insertSheet', 'MailApp', 'sendEmail', 'setProperty', 'deleteProperty']) {
    assert.ok(!adminSource.includes(api), api);
  }
  const code = adminSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // 外部通信なし・ログなし・Sessionを認証根拠にしない
  for (const api of ['Logger.', 'console.', 'Session.', 'getActiveUser', 'getEmail', 'UrlFetchApp', 'CacheService', 'tokeninfo']) assert.ok(!code.includes(api), api);
  const manifest = JSON.parse(adminFile('appsscript.json'));
  // OWNER本人のみ（MYSELF）＋デプロイ者権限でSpreadsheetを読む。共有パスワード・URLトークンは持たない
  assert.strictEqual(manifest.webapp.access, 'MYSELF');
  assert.strictEqual(manifest.webapp.executeAs, 'USER_DEPLOYING');
  assert.deepStrictEqual(manifest.oauthScopes, ['https://www.googleapis.com/auth/spreadsheets']);
  const publicSource = fs.readdirSync(path.join(ROOT, 'public')).filter((f) => f.endsWith('.gs'))
    .map((f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8')).join('\n');
  for (const word of ['getDashboardData', 'getCrosstabData', 'HtmlService', 'ADMIN_OWNER_EMAILS', 'ADMIN_VIEWER_EMAILS', 'ADMIN_GOOGLE_CLIENT_ID', 'getActiveUser']) assert.ok(!publicSource.includes(word), word);
  const publicManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'appsscript.json'), 'utf8'));
  assert.ok(publicManifest.oauthScopes.includes('https://www.googleapis.com/auth/script.send_mail'));
  assert.ok(publicManifest.oauthScopes.includes('https://www.googleapis.com/auth/spreadsheets'));
  assert.strictEqual(publicManifest.webapp, undefined, 'Public Web Appの公開設定はデプロイ側で管理し、CIは変更しない');
});

test('README：OWNER 1名専用構成（MYSELF・google.script.run）・OAuth不要・Spreadsheet非共有・既存デプロイ更新手順が記載されている', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  for (const word of ['OWNER 1名専用', 'USER_DEPLOYING', 'MYSELF', 'google.script.run', '/exec', 'Google Cloud', 'OAuth Client ID', '不要',
    'Spreadsheet を他のユーザーへ共有しない', 'Public GAS とは別', 'update-deployment', 'workflow_dispatch', '本番デプロイ後の確認', 'admin_access_set_to_myself', '変更しない', 'アクセス変更 → 配備']) {
    assert.ok(readme.includes(word), word);
  }
  for (const stale of ['ADMIN_ALLOWED_EMAILS', 'diagBigIntAndRsa', '承認済みの JavaScript 生成元', 'ANYONE_ANONYMOUS`（全員）']) assert.ok(!readme.includes(stale), '旧方式の手順を残さない: ' + stale);
});
