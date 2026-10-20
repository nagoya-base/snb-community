'use strict';
// Frontend の5言語対応（Issue #398）：初期言語・言語切替・回答/route/page の保持・validation・完了表示・test mode・GA4・a11y。
// 言語が変わっても payload の回答値は stable ID のまま変わらないこと、GA4/URL/payload に言語を載せないことを固定する。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const D = require('./helpers/dom');
const i18n = require('../tools/i18n');

const { openPage, settle, statusBody, fieldset, visibleIds, pageTitle, bodyText, answer, click, start, next, fillPage, walkToReview, fire, schema } = D;
const dicts = i18n.loadDicts();
const LOCALE_KEY = 'snb_baseball_uniform_survey_locale_v1';
const SECRET = 'TESTTOKEN_abc123';
const posts = (env) => env.calls.filter((c) => c.options.method === 'POST');
const bodyOf = (call) => JSON.parse(call.options.body);
const plain = (x) => JSON.parse(JSON.stringify(x));
const LOCALES = ['ja', 'en', 'ko', 'zh-Hans', 'zh-Hant'];

const select = (env) => env.document.getElementById('bus-lang-select');
async function setLang(env, code) {
  const el = select(env);
  el.value = code;
  fire(env.window, el, 'change');
  await settle();
}
const htmlLang = (env) => env.document.documentElement.getAttribute('lang');
const ui = (locale, key, params) => {
  let text = dicts[locale].ui[key];
  Object.entries(params || {}).forEach(([k, v]) => { text = text.split('{' + k + '}').join(String(v)); });
  return text;
};
const section = (locale, id) => dicts[locale].sections[id];
const optionLabelOf = (locale, qid, oid) => (locale === 'ja' ? schema.questions.find((q) => q.id === qid).options.find((o) => o.id === oid).label : dicts[locale].questions[qid].options[oid]);
const labelOf = (locale, qid) => (locale === 'ja' ? schema.questions.find((q) => q.id === qid).label : dicts[locale].questions[qid].label);

const ROUTE = { club_awareness: 'attended', last_attended: 'within_3m' };

// ── 初期言語 ──

test('初期言語は ja（日本語ブラウザ）。<html lang> と見出しが日本語で、言語選択が上部にある', async () => {
  const env = await openPage({ languages: ['ja-JP'] });
  assert.strictEqual(htmlLang(env), 'ja');
  assert.strictEqual(pageTitle(env.document), ui('ja', 'intro.title'));
  assert.strictEqual(env.document.title, ui('ja', 'page.title'));
  const sel = select(env);
  assert.ok(sel, '言語選択');
  assert.deepStrictEqual(plain(Array.from(sel.options).map((o) => [o.value, o.textContent, o.getAttribute('lang')])), [
    ['ja', '日本語', 'ja'], ['en', 'English', 'en'], ['ko', '한국어', 'ko'], ['zh-Hans', '简体中文', 'zh-Hans'], ['zh-Hant', '繁體中文', 'zh-Hant']
  ]);
  const wrap = env.document.querySelector('.bus-wrap');
  assert.strictEqual(wrap.firstElementChild.id, 'bus-lang', '言語選択はページ上部');
  assert.strictEqual(env.document.querySelector('label[for="bus-lang-select"]').textContent, ui('ja', 'lang.label'));
  assert.deepStrictEqual(env.errors, []);
});

test('browser language による初期言語の判定（ja* / en* / ko* / zh-CN・SG・Hans / zh-TW・HK・MO・Hant / 対応外は ja）', async () => {
  const cases = [
    [['ja-JP'], 'ja'], [['ja'], 'ja'], [['en-US'], 'en'], [['en-GB'], 'en'], [['ko-KR'], 'ko'], [['ko'], 'ko'],
    [['zh-CN'], 'zh-Hans'], [['zh-SG'], 'zh-Hans'], [['zh-Hans'], 'zh-Hans'], [['zh-Hans-CN'], 'zh-Hans'], [['zh'], 'zh-Hans'],
    [['zh-TW'], 'zh-Hant'], [['zh-HK'], 'zh-Hant'], [['zh-MO'], 'zh-Hant'], [['zh-Hant'], 'zh-Hant'], [['zh-Hant-TW'], 'zh-Hant'],
    [['fr-FR'], 'ja'], [['de', 'es'], 'ja'], [[], 'ja'], [['fr-FR', 'ko-KR', 'en'], 'ko']
  ];
  for (const [languages, expected] of cases) {
    const env = await openPage({ languages });
    assert.strictEqual(htmlLang(env), expected, languages.join(','));
    assert.strictEqual(select(env).value, expected, languages.join(','));
    assert.strictEqual(pageTitle(env.document), ui(expected, 'intro.title'), languages.join(','));
  }
});

test('保存済みの選択（localStorage）が browser language より優先され、不正な保存値は無視する', async () => {
  const saved = await openPage({ languages: ['en-US'], local: { [LOCALE_KEY]: 'zh-Hant' } });
  assert.strictEqual(htmlLang(saved), 'zh-Hant');
  assert.strictEqual(pageTitle(saved.document), ui('zh-Hant', 'intro.title'));
  const broken = await openPage({ languages: ['ko-KR'], local: { [LOCALE_KEY]: 'xx' } });
  assert.strictEqual(htmlLang(broken), 'ko', '対応外の保存値は無視して browser language');
  const unsupported = await openPage({ languages: ['fr-FR'], local: { [LOCALE_KEY]: 'fr' } });
  assert.strictEqual(htmlLang(unsupported), 'ja');
});

test('言語を選ぶと localStorage に保存され、再読み込み後も維持される。自動判定は強制せず、いつでも変更できる', async () => {
  const env = await openPage({ languages: ['en-US'] });
  assert.strictEqual(env.window.localStorage.getItem(LOCALE_KEY), null, '自動判定だけでは保存しない');
  await setLang(env, 'ko');
  assert.strictEqual(env.window.localStorage.getItem(LOCALE_KEY), 'ko');
  await setLang(env, 'ja');
  assert.strictEqual(env.window.localStorage.getItem(LOCALE_KEY), 'ja');
  assert.strictEqual(htmlLang(env), 'ja');
  const reopened = await openPage({ languages: ['en-US'], local: { [LOCALE_KEY]: env.window.localStorage.getItem(LOCALE_KEY) } });
  assert.strictEqual(htmlLang(reopened), 'ja');
});

test('localStorage が使えなくても動作する（メモリだけで言語を切り替えられる）', async () => {
  const env = await openPage({ languages: ['ja-JP'] });
  env.window.Storage.prototype.setItem = () => { throw new Error('denied'); };
  env.window.Storage.prototype.getItem = () => { throw new Error('denied'); };
  await setLang(env, 'en');
  assert.strictEqual(htmlLang(env), 'en');
  assert.strictEqual(pageTitle(env.document), ui('en', 'intro.title'));
});

// ── 言語切替：回答・page・route の保持 ──

test('回答途中の言語切替（ja→en→ko→zh-Hans→zh-Hant）で、回答値・page・route・自由記述が保持され、値は stable ID のまま', async () => {
  const env = await openPage({ languages: ['ja-JP'] });
  await start(env);
  assert.strictEqual(pageTitle(env.document), section('ja', 'eligibility'));
  answer(env, 'age_confirmed', 'yes');
  await next(env);
  assert.strictEqual(pageTitle(env.document), section('ja', 'uniform'));
  answer(env, 'favorite_uniforms', ['baseball', 'soccer', 'other'], 'マイナー競技 ⚾ original text');
  answer(env, 'top_uniform', 'soccer');

  let urlBefore = env.window.location.href;
  for (const code of ['en', 'ko', 'zh-Hans', 'zh-Hant', 'ja', 'en']) {
    await setLang(env, code);
    assert.strictEqual(htmlLang(env), code);
    assert.strictEqual(pageTitle(env.document), section(code, 'uniform'), `${code}: page が維持される`);
    assert.deepStrictEqual(plain(visibleIds(env.document).slice(0, 2)), ['favorite_uniforms', 'top_uniform']);
    const fav = fieldset(env.document, 'favorite_uniforms');
    assert.deepStrictEqual(plain(Array.from(fav.querySelectorAll('input[type=checkbox]:checked')).map((i) => i.value)), ['baseball', 'soccer', 'other'], `${code}: 選択が維持される`);
    assert.strictEqual(fav.querySelector('legend .bus-qtext').textContent, labelOf(code, 'favorite_uniforms'));
    assert.strictEqual(fav.querySelector('input[value="soccer"]').parentNode.textContent, optionLabelOf(code, 'favorite_uniforms', 'soccer'));
    assert.strictEqual(fav.querySelector('.bus-other input').value, 'マイナー競技 ⚾ original text', `${code}: 自由記述は翻訳せず原文のまま`);
    assert.strictEqual(fieldset(env.document, 'top_uniform').querySelector('input[value="soccer"]').checked, true);
    // single_dynamic の候補も選択言語で表示される（source 設問の翻訳を使う）
    assert.strictEqual(fieldset(env.document, 'top_uniform').querySelector('input[value="baseball"]').parentNode.textContent, optionLabelOf(code, 'favorite_uniforms', 'baseball'));
    assert.strictEqual(env.document.activeElement, select(env), `${code}: フォーカスは言語選択に残る`);
    assert.strictEqual(env.window.location.href, urlBefore, 'URL に言語を載せない');
  }
  assert.strictEqual(posts(env).length, 0);
});

test('route は言語切替で変わらない：途中で切り替えても、表示される設問ID列（分岐結果）が切り替えなしと同じ', async () => {
  async function route(switches) {
    const env = await openPage({ languages: ['ja-JP'] });
    const ids = [];
    await start(env);
    for (let guard = 0, n = 0; guard < 40 && env.document.getElementById('bus-questions'); guard++, n++) {
      if (switches[n]) await setLang(env, switches[n]);
      fillPage(env, ROUTE);
      ids.push(visibleIds(env.document).join(','));
      await next(env);
    }
    return ids;
  }
  const base = await route({});
  assert.ok(base.length > 5);
  assert.deepStrictEqual(await route({ 1: 'zh-Hant', 3: 'ko', 5: 'en' }), base);
  assert.deepStrictEqual(await route({ 0: 'zh-Hans', 2: 'ja' }), base);
});

test('review 画面で言語を切り替えても回答内容が選択言語で表示され、自由記述は原文のまま', async () => {
  const env = await openPage({ languages: ['ja-JP'] });
  await walkToReview(env, Object.assign({ feedback: 'ご要望: もっと開催してください! 🙏', adult_context: ['gay_men_group', 'other'] }, ROUTE), { adult_context: 'My own club, Nagoya' });
  assert.strictEqual(pageTitle(env.document), ui('ja', 'review.title'));
  for (const code of ['ko', 'en', 'zh-Hans', 'zh-Hant']) {
    await setLang(env, code);
    assert.strictEqual(pageTitle(env.document), ui(code, 'review.title'), code);
    assert.strictEqual(env.document.getElementById('bus-next').textContent, ui(code, 'common.submit'));
    const text = bodyText(env.document);
    assert.ok(text.includes(optionLabelOf(code, 'club_awareness', 'attended')), `${code}: option 表示`);
    assert.ok(text.includes('ご要望: もっと開催してください! 🙏'), `${code}: 自由記述は翻訳しない`);
    const other = ui(code, 'common.withOther', { label: optionLabelOf(code, 'adult_context', 'other'), text: 'My own club, Nagoya' });
    assert.ok(text.includes(other), `${code}: 「その他」は ${other}`);
    const editButtons = Array.from(env.document.querySelectorAll('.bus-link-btn'));
    assert.ok(editButtons.length > 3);
    const editNames = Object.values(dicts[code].sections).map((title) => ui(code, 'common.editAria', { section: title }));
    editButtons.forEach((b) => { assert.strictEqual(b.textContent, ui(code, 'common.edit')); assert.ok(editNames.includes(b.getAttribute('aria-label')), `${code}: ${b.getAttribute('aria-label')}`); });
    assert.strictEqual(env.document.querySelector('.bus-progress [role=progressbar]').getAttribute('aria-label'), ui(code, 'progress.barAria'));
  }
  assert.strictEqual(posts(env).length, 0);
});

test('scale（満足度）と notApplicable も選択言語で表示され、保存値の ID は変わらない', async () => {
  const env = await openPage({ languages: ['ja-JP'] });
  await start(env);
  for (let guard = 0; guard < 40 && !visibleIds(env.document).includes('overall_satisfaction'); guard++) {
    fillPage(env, ROUTE);
    await next(env);
  }
  assert.ok(visibleIds(env.document).includes('overall_satisfaction'));
  answer(env, 'overall_satisfaction', '4');
  for (const code of ['en', 'ko', 'zh-Hans', 'zh-Hant']) {
    await setLang(env, code);
    const fs_ = fieldset(env.document, 'overall_satisfaction');
    const entry = dicts[code].questions.overall_satisfaction;
    assert.strictEqual(fs_.querySelector('input[value="4"]').parentNode.textContent, ui(code, 'common.scalePoint', { value: 4, label: entry.anchors['4'] }));
    assert.strictEqual(fs_.querySelector('input[value="cannot_rate"]').parentNode.textContent, entry.notApplicable);
    assert.strictEqual(fs_.querySelector('input[value="4"]').checked, true, '回答が保持される');
  }
});

// ── validation / エラー ──

test('required error・要約・個別エラーが選択言語で表示され、言語を切り替えても同じ誤りが選択言語で出続ける', async () => {
  const env = await openPage({ languages: ['ja-JP'] });
  await start(env);
  await setLang(env, 'en');
  click(env.document, 'bus-next'); // age_confirmed 未回答
  await settle();
  assert.strictEqual(env.document.getElementById('bus-err-age_confirmed').textContent, ui('en', 'error.required'));
  assert.strictEqual(env.document.querySelector('.bus-summary-title').textContent, ui('en', 'error.summaryTitle', { count: 1 }));
  assert.strictEqual(env.document.querySelector('#bus-summary a').textContent, ui('en', 'error.summaryItem', { label: labelOf('en', 'age_confirmed'), message: ui('en', 'error.required') }));
  for (const code of ['ko', 'zh-Hans', 'zh-Hant', 'ja']) {
    await setLang(env, code);
    assert.strictEqual(env.document.getElementById('bus-err-age_confirmed').hidden, false, code);
    assert.strictEqual(env.document.getElementById('bus-err-age_confirmed').textContent, ui(code, 'error.required'), code);
    assert.strictEqual(env.document.querySelector('.bus-summary-title').textContent, ui(code, 'error.summaryTitle', { count: 1 }));
    assert.strictEqual(env.document.getElementById('bus-summary').getAttribute('role'), 'alert');
    assert.strictEqual(env.document.querySelector('fieldset[data-qid="age_confirmed"] input').getAttribute('aria-invalid'), 'true');
    assert.strictEqual(env.document.activeElement, select(env));
  }
  // 回答すると誤りが消える（言語切替後も）
  answer(env, 'age_confirmed', 'yes');
  assert.strictEqual(env.document.getElementById('bus-err-age_confirmed').hidden, true);
});

test('「その他」本文が必要なのに空のときの error（other_text_required）と、必須・任意の表示が選択言語になる', async () => {
  const env = await openPage({ languages: ['ko-KR'] });
  await start(env);
  answer(env, 'age_confirmed', 'yes');
  await next(env);
  answer(env, 'favorite_uniforms', ['other']);
  answer(env, 'top_uniform', 'other');
  click(env.document, 'bus-next');
  await settle();
  assert.strictEqual(env.document.getElementById('bus-err-favorite_uniforms').textContent, ui('ko', 'error.other_text_required'));
  assert.strictEqual(fieldset(env.document, 'favorite_uniforms').querySelector('.bus-req').textContent, ui('ko', 'common.required'));
  await setLang(env, 'zh-Hans');
  assert.strictEqual(env.document.getElementById('bus-err-favorite_uniforms').textContent, ui('zh-Hans', 'error.other_text_required'));
  assert.strictEqual(fieldset(env.document, 'favorite_uniforms').querySelector('.bus-req').textContent, ui('zh-Hans', 'common.required'));
});

test('server の invalid_request・network error・server error の一般向け表示も選択言語で、言語を切り替えると再表示される', async () => {
  const env = await openPage({ languages: ['en-US'], fetch: (url, options) => (options.method === 'POST' ? new Error('network') : statusBody('open')) });
  await walkToReview(env, ROUTE);
  click(env.document, 'bus-next');
  await settle();
  assert.strictEqual(env.document.querySelector('.bus-summary-title').textContent, ui('en', 'submit.networkFailed'));
  assert.strictEqual(env.document.getElementById('bus-next').disabled, false, '入力は保持され再送できる');
  await setLang(env, 'ko');
  assert.strictEqual(env.document.querySelector('.bus-summary-title').textContent, ui('ko', 'submit.networkFailed'));
  assert.ok(!/network|Error/.test(bodyText(env.document)));

  const http = await openPage({ languages: ['zh-TW'], fetch: (url, options) => (options.method === 'POST' ? { ok: false, error: 'server_error' } : statusBody('open')) });
  await walkToReview(http, ROUTE);
  click(http.document, 'bus-next');
  await settle();
  assert.strictEqual(http.document.querySelector('.bus-summary-title').textContent, ui('zh-Hant', 'submit.serverFailed'));

  const fast = await openPage({ languages: ['zh-CN'], fetch: (url, options) => (options.method === 'POST' ? { ok: false, error: 'invalid_request', fields: [{ field: 'elapsed_ms', code: 'too_fast' }] } : statusBody('open')) });
  await walkToReview(fast, ROUTE);
  click(fast.document, 'bus-next');
  await settle();
  assert.strictEqual(fast.document.querySelector('.bus-summary-title').textContent, ui('zh-Hans', 'submit.tooFast'));
  assert.ok(!/elapsed_ms|too_fast/.test(bodyText(fast.document)));
});

test('状態表示（準備中・受付開始前・受付終了・更新必要）が選択言語で、切替でも維持される', async () => {
  const cases = [
    [{ endpoint: '' }, 'done.preparing'],
    [{ fetch: () => statusBody('not_open') }, 'done.notOpen'],
    [{ fetch: () => statusBody('closed') }, 'done.closed'],
    [{ fetch: () => statusBody('open', { schema_version: 'other' }) }, 'done.updateNeeded']
  ];
  for (const [opts, key] of cases) {
    for (const code of LOCALES) {
      const env = await openPage(Object.assign({ languages: ['ja-JP'] }, opts));
      await setLang(env, code);
      assert.strictEqual(pageTitle(env.document), ui(code, key + '.title'), `${key} ${code}`);
      assert.ok(bodyText(env.document).includes(ui(code, key + '.line')));
      assert.ok(bodyText(env.document).includes(ui(code, 'common.backToClub')));
      assert.strictEqual(htmlLang(env), code);
    }
  }
});

test('受付状況の確認中（loading）に言語を切り替えても、確認後は選択言語で intro が出る', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const env = await openPage({ languages: ['ja-JP'], fetch: (url, options) => (options.method === 'POST' ? { ok: true, status: 'accepted' } : gate.then(() => statusBody('open'))) });
  assert.ok(bodyText(env.document).includes(ui('ja', 'common.checkingStatus')));
  await setLang(env, 'en');
  assert.ok(bodyText(env.document).includes(ui('en', 'common.checkingStatus')));
  release();
  await settle();
  assert.strictEqual(pageTitle(env.document), ui('en', 'intro.title'));
});

// ── 完了・18歳未満・重複 ──

test('production 完了表示・結果ページリンクが選択言語で、payload の回答は stable ID のまま', async () => {
  const env = await openPage({ languages: ['ja-JP'] });
  await walkToReview(env, Object.assign({ feedback: '自由記述 as typed' }, ROUTE));
  await setLang(env, 'zh-Hans');
  click(env.document, 'bus-next');
  await settle();
  assert.strictEqual(pageTitle(env.document), ui('zh-Hans', 'done.thanks.title'));
  assert.ok(bodyText(env.document).includes(ui('zh-Hans', 'done.thanks.line')));
  const link = Array.from(env.document.querySelectorAll('a.bus-link')).find((a) => a.textContent === ui('zh-Hans', 'common.resultsLink'));
  assert.ok(link && link.getAttribute('href') === 'baseball-uniform-survey-results.html');
  await setLang(env, 'ko');
  assert.strictEqual(pageTitle(env.document), ui('ko', 'done.thanks.title'));
  assert.strictEqual(posts(env).length, 1, '切替で再送しない');
  const body = bodyOf(posts(env)[0]);
  assert.strictEqual(body.answers.feedback, '自由記述 as typed');
  assert.strictEqual(body.answers.club_awareness, 'attended');
});

test('重複送信（duplicate_submission）の表示が選択言語になる', async () => {
  const env = await openPage({ languages: ['ko-KR'], fetch: (url, options) => (options.method === 'POST' ? { ok: false, error: 'duplicate_submission' } : statusBody('open')) });
  await walkToReview(env, ROUTE);
  click(env.document, 'bus-next');
  await settle();
  assert.strictEqual(pageTitle(env.document), ui('ko', 'done.duplicate.title'));
  await setLang(env, 'en');
  assert.strictEqual(pageTitle(env.document), ui('en', 'done.duplicate.title'));
  assert.ok(!env.events().some((e) => e.name === 'survey_submit'));
});

test('18歳未満の終了表示が選択言語で、回答は破棄され server へ何も送らない', async () => {
  const env = await openPage({ languages: ['en-US'] });
  await start(env);
  answer(env, 'age_confirmed', 'no');
  await next(env);
  assert.strictEqual(pageTitle(env.document), ui('en', 'done.ineligible.title'));
  for (const code of ['ja', 'ko', 'zh-Hans', 'zh-Hant']) {
    await setLang(env, code);
    assert.strictEqual(pageTitle(env.document), ui(code, 'done.ineligible.title'), code);
    assert.ok(bodyText(env.document).includes(ui(code, 'done.ineligible.line')));
  }
  assert.strictEqual(posts(env).length, 0);
});

// ── payload：言語によらず同一 ──

test('同じ回答は言語を切り替えて送っても payload の answers / other_texts が完全に同一で、locale 等の key を持たない', async () => {
  const overrides = Object.assign({ feedback: 'free text 日本語 / English / 한국어 / 中文', favorite_uniforms: ['baseball', 'other'] }, ROUTE);
  const others = { favorite_uniforms: 'my other thing' };
  const payloads = {};
  for (const lang of LOCALES) {
    const env = await openPage({ languages: ['ja-JP'] });
    await setLang(env, lang);
    await walkToReview(env, overrides, others);
    // 途中ではなく review でも別言語へ切り替えてから送る（表示言語が回答値に影響しないこと）
    await setLang(env, lang === 'ja' ? 'ko' : 'ja');
    click(env.document, 'bus-next');
    await settle();
    assert.strictEqual(posts(env).length, 1, lang);
    const body = bodyOf(posts(env)[0]);
    assert.deepStrictEqual(plain(Object.keys(body)).sort(), ['answers', 'elapsed_ms', 'other_texts', 'schema_version', 'uuid'], '言語・locale の key を送らない');
    payloads[lang] = { answers: body.answers, other_texts: body.other_texts };
    const labels = [].concat(...LOCALES.map((l) => Object.values(dicts[l].ui)));
    Object.values(body.answers).forEach((v) => [].concat(v).forEach((x) => { if (typeof x === 'string' && x !== overrides.feedback) assert.match(x, /^[a-z0-9_]+$/, `answer は stable ID だけ: ${x}`); }));
    assert.ok(labels.length > 0);
  }
  LOCALES.slice(1).forEach((lang) => assert.deepStrictEqual(payloads[lang], payloads.ja, `${lang} の payload は ja と同一`));
});

test('翻訳 label を回答として持たない：どの言語でも input の value は option ID で、表示ラベルと異なる', async () => {
  const env = await openPage({ languages: ['ja-JP'] });
  await start(env);
  answer(env, 'age_confirmed', 'yes');
  await next(env);
  for (const code of LOCALES) {
    await setLang(env, code);
    const ids = new Set(schema.questions.find((q) => q.id === 'favorite_uniforms').options.map((o) => o.id));
    Array.from(fieldset(env.document, 'favorite_uniforms').querySelectorAll('input[type=checkbox]')).forEach((input) => {
      assert.ok(ids.has(input.value), `${code}: value=${input.value}`);
      assert.strictEqual(input.getAttribute('name') !== null, true);
    });
  }
});

test('hidden / stale の挙動は言語切替で変わらない：親の回答変更で子の値が消え、payload に残らない', async () => {
  const env = await openPage({ languages: ['ja-JP'] });
  await start(env);
  answer(env, 'age_confirmed', 'yes');
  await next(env);
  answer(env, 'favorite_uniforms', ['baseball', 'soccer']);
  await setLang(env, 'en');
  answer(env, 'top_uniform', 'soccer');
  await setLang(env, 'ko');
  assert.ok(visibleIds(env.document).includes('top_uniform'));
  answer(env, 'favorite_uniforms', ['none']); // exclusive：top_uniform が hidden になる
  await setLang(env, 'zh-Hant');
  assert.ok(!visibleIds(env.document).includes('top_uniform'), 'hidden 設問は DOM から消える');
  await setLang(env, 'ja');
  answer(env, 'favorite_uniforms', ['baseball']);
  assert.ok(visibleIds(env.document).includes('top_uniform'));
  assert.strictEqual(fieldset(env.document, 'top_uniform').querySelector('input:checked').value, 'baseball', '候補が1件なので自動選択。soccer の旧値は復活しない');
  for (let guard = 0; guard < 40 && env.document.getElementById('bus-questions'); guard++) {
    fillPage(env, ROUTE);
    await next(env);
  }
  click(env.document, 'bus-next');
  await settle();
  const answers = bodyOf(posts(env)[0]).answers;
  assert.deepStrictEqual(plain(answers.favorite_uniforms), ['baseball']);
  assert.strictEqual(answers.top_uniform, 'baseball', '候補が1件なので自動選択。soccer の旧値は残らない');
});

// ── 進捗・milestone・route メッセージ ──

test('進捗・milestone・低関心メッセージ・短縮 route の案内が選択言語になる（schema の文言を翻訳辞書で置き換える）', async () => {
  const env = await openPage({ languages: ['ja-JP'] });
  await start(env);
  const low = { club_awareness: 'first_time', catchball_interest: 'low_interest' };
  let sawAck = false;
  let sawRoute = false;
  for (let guard = 0; guard < 20 && !(sawAck && sawRoute); guard++) {
    fillPage(env, low);
    if (visibleIds(env.document).includes('catchball_interest')) {
      await setLang(env, 'ko');
      const ack = fieldset(env.document, 'catchball_interest').querySelector('.bus-ack');
      assert.strictEqual(ack.hidden, false);
      assert.strictEqual(ack.textContent, dicts.ko.schemaText.lowInterestAcknowledgement);
      assert.match(env.document.getElementById('bus-progress-text').textContent, /섹션/);
      sawAck = true;
    }
    if (pageTitle(env.document) === section('ko', 'profile')) {
      assert.ok(bodyText(env.document).includes(dicts.ko.schemaText.routes.pure_uniform_short_route.messageBeforeProfile));
      await setLang(env, 'zh-Hant');
      assert.ok(bodyText(env.document).includes(dicts['zh-Hant'].schemaText.routes.pure_uniform_short_route.messageBeforeProfile));
      sawRoute = true;
    }
    await next(env);
  }
  assert.ok(sawAck && sawRoute);
});

test('milestone（afterQuestion 型）は切替後も参照が保たれ、選択言語の文言で表示される', async () => {
  const env = await openPage({ languages: ['en-US'] });
  await start(env);
  let seen = false;
  for (let guard = 0; guard < 6 && !seen; guard++) {
    fillPage(env, ROUTE);
    await next(env);
    if (bodyText(env.document).includes(dicts.en.schemaText.milestones['after:top_uniform_sport_experience'])) {
      seen = true;
      await setLang(env, 'zh-Hans');
      assert.ok(bodyText(env.document).includes(dicts['zh-Hans'].schemaText.milestones['after:top_uniform_sport_experience']));
      assert.ok(!bodyText(env.document).includes(dicts.en.schemaText.milestones['after:top_uniform_sport_experience']));
    }
  }
  assert.ok(seen);
});

// ── test mode ──

test('preview_no_submit：言語を切り替えても通信・GA4 なし。TEST 表示と完了表示が選択言語になる', async () => {
  const env = await openPage({ languages: ['ja-JP'], hash: '#test=preview_no_submit' });
  assert.strictEqual(env.window.SNB_BASEBALL_SURVEY_TEST_MODE, 'preview_no_submit');
  await setLang(env, 'en');
  assert.strictEqual(env.document.querySelector('#bus-test-banner span').textContent, ui('en', 'test.banner.preview_no_submit'));
  assert.strictEqual(env.document.querySelector('.bus-test-exit').textContent, ui('en', 'test.exit'));
  await walkToReview(env, ROUTE);
  await setLang(env, 'ko');
  click(env.document, 'bus-next');
  await settle();
  assert.strictEqual(pageTitle(env.document), ui('ko', 'test.preview.title'));
  assert.ok(bodyText(env.document).includes(ui('ko', 'test.chip')));
  await setLang(env, 'zh-Hans');
  assert.strictEqual(pageTitle(env.document), ui('zh-Hans', 'test.preview.title'));
  assert.strictEqual(env.calls.length, 0, '通信しない');
  assert.strictEqual(env.window.dataLayer, undefined, 'GA4 を初期化しない');
  assert.strictEqual(env.window.gtag, undefined);
});

test('closed_view：言語を切り替えても受付終了表示だけで、通信・GA4 なし', async () => {
  const env = await openPage({ languages: ['ja-JP'], hash: '#test=closed_view' });
  for (const code of LOCALES) {
    await setLang(env, code);
    assert.strictEqual(pageTitle(env.document), ui(code, 'done.closed.title'), code);
    assert.strictEqual(env.document.querySelector('#bus-test-banner span').textContent, ui(code, 'test.banner.closed_view'));
  }
  assert.strictEqual(env.calls.length, 0);
  assert.strictEqual(env.window.dataLayer, undefined);
});

test('submit_excluded：言語切替で fragment token / sessionStorage / test_run_id / endpoint / submit が壊れず、payload は同一', async () => {
  const run = 'run_i18n_1';
  const env = await openPage({ languages: ['ja-JP'], hash: `#test=submit_excluded&token=${SECRET}&run=${run}`, fetch: (url, options) => (options.method === 'POST' ? { ok: true, status: 'accepted_test', test: true } : statusBody('open')) });
  const stored = () => JSON.parse(env.window.sessionStorage.getItem('snb_baseball_uniform_survey_test_v1'));
  assert.deepStrictEqual(plain(stored()), { mode: 'submit_excluded', token: SECRET, run });
  await setLang(env, 'en');
  await start(env);
  fillPage(env, ROUTE);
  await setLang(env, 'ko');
  await walkToReviewFromHere(env);
  await setLang(env, 'zh-Hant');
  assert.deepStrictEqual(plain(stored()), { mode: 'submit_excluded', token: SECRET, run }, '言語切替で test 状態が変わらない');
  assert.ok(!env.window.location.hash.includes('token'), 'fragment は URL から除去済み');
  click(env.document, 'bus-next');
  await settle();
  assert.strictEqual(pageTitle(env.document), ui('zh-Hant', 'test.submitted.title'));
  const calls = posts(env);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, D.ENDPOINT);
  const body = bodyOf(calls[0]);
  assert.strictEqual(body.test_token, SECRET);
  assert.strictEqual(body.test_run_id, run);
  assert.ok(!JSON.stringify(body).match(/locale|lang/i), 'payload に言語を載せない');
  assert.strictEqual(env.window.dataLayer, undefined, 'test mode では GA4 を初期化しない');
  assert.strictEqual(env.document.querySelector('#bus-test-banner span').textContent, ui('zh-Hant', 'test.banner.submit_excluded'));
  assert.ok(!bodyText(env.document).includes(SECRET));
});

async function walkToReviewFromHere(env) {
  for (let guard = 0; guard < 40 && env.document.getElementById('bus-questions'); guard++) {
    fillPage(env, ROUTE);
    await next(env);
  }
}

test('submit_excluded：同じ test_run_id の重複は言語によらず抑止され、表示が選択言語になる', async () => {
  const env = await openPage({ languages: ['ko-KR'], hash: `#test=submit_excluded&token=${SECRET}&run=r_dup`, fetch: (url, options) => (options.method === 'POST' ? { ok: false, error: 'duplicate_submission' } : statusBody('open')) });
  await walkToReview(env, ROUTE);
  click(env.document, 'bus-next');
  await settle();
  assert.strictEqual(pageTitle(env.document), ui('ko', 'test.duplicate.title'));
  await setLang(env, 'en');
  assert.strictEqual(pageTitle(env.document), ui('en', 'test.duplicate.title'));
  assert.ok(bodyText(env.document).includes(ui('en', 'test.duplicate.line')));
  assert.ok(!/duplicate_submission/.test(bodyText(env.document)));
  assert.strictEqual(env.window.dataLayer, undefined);
});

test('テスト設定エラー（invalid_test_config）の表示も5言語で、GA4・通信なしのまま', async () => {
  const env = await openPage({ languages: ['ja-JP'], hash: '#test=submit_excluded&token=x&run=bad run' });
  for (const code of LOCALES) {
    await setLang(env, code);
    assert.strictEqual(pageTitle(env.document), ui(code, 'test.invalid.title'), code);
    assert.strictEqual(env.document.querySelector('#bus-test-banner span').textContent, ui(code, 'test.banner.invalid_test_config'));
  }
  assert.strictEqual(env.calls.length, 0);
  assert.strictEqual(env.window.dataLayer, undefined);
});

// ── GA4 / URL ──

test('production の GA4：言語切替で追加イベントを送らず、許可イベントのパラメータに言語・route・回答が入らない', async () => {
  const env = await openPage({ languages: ['ja-JP'] });
  const before = env.events().length;
  for (const code of LOCALES) await setLang(env, code);
  assert.strictEqual(env.events().length, before, '言語切替だけでは GA4 イベントが増えない');
  await start(env);
  await setLang(env, 'ko');
  click(env.document, 'bus-next'); // required error
  await settle();
  await setLang(env, 'zh-Hans');
  const events = env.events();
  const allowedParams = ['site_brand', 'site_section', 'page_type', 'form_name', 'error_type'];
  assert.deepStrictEqual(plain(events.map((e) => e.name)), ['form_start', 'form_error']);
  events.forEach((e) => Object.keys(e.params || {}).forEach((k) => assert.ok(allowedParams.includes(k), k)));
  const serialized = JSON.stringify(Array.from(env.window.dataLayer || []).map((a) => Array.from(a)));
  assert.ok(!/zh-Hans|zh-Hant|"ko"|"en"|locale|language|age_confirmed/.test(serialized), '言語・設問IDを GA4 に送らない');
  const select_ = select(env);
  ['data-cta-name', 'data-outbound-channel', 'data-section-view'].forEach((a) => assert.ok(!select_.hasAttribute(a), a));
});

test('言語情報を URL（query / hash）に載せず、fetch の URL にも載せない', async () => {
  const env = await openPage({ languages: ['ja-JP'], search: '?src=line' });
  const initial = env.window.location.href;
  for (const code of LOCALES) await setLang(env, code);
  assert.strictEqual(env.window.location.href, initial);
  await walkToReview(env, ROUTE);
  click(env.document, 'bus-next');
  await settle();
  env.calls.forEach((c) => assert.ok(!/lang|locale/i.test(c.url), c.url));
  assert.strictEqual(bodyOf(posts(env)[0]).source_channel, 'line');
});

// ── a11y ──

test('a11y：言語ごとに <html lang> が更新され、全 input にラベルが関連付き、button の accessible name も翻訳される', async () => {
  const env = await openPage({ languages: ['ja-JP'] });
  await start(env);
  answer(env, 'age_confirmed', 'yes');
  await next(env);
  for (const code of LOCALES) {
    await setLang(env, code);
    assert.strictEqual(htmlLang(env), code);
    assert.strictEqual(env.document.querySelector('.bus-skip').textContent, ui(code, 'page.skip'));
    assert.strictEqual(env.document.querySelector('.bus-back').textContent, ui(code, 'page.back'));
    assert.strictEqual(env.document.querySelector('.bus-hero h1').textContent, ui(code, 'page.heading'));
    assert.strictEqual(env.document.querySelector('.bus-eyebrow').textContent, ui(code, 'page.eyebrow'));
    assert.strictEqual(env.document.getElementById('bus-next').textContent, ui(code, 'common.next'));
    assert.strictEqual(env.document.getElementById('bus-back-btn').textContent, ui(code, 'common.back'));
    Array.from(env.document.querySelectorAll('#bus-app input, #bus-app textarea')).forEach((input) => {
      const labelled = input.closest('label') || (input.id && env.document.querySelector(`label[for="${input.id}"]`)) || input.getAttribute('aria-label');
      assert.ok(labelled, `${code}: ラベルなしの入力`);
    });
    Array.from(env.document.querySelectorAll('fieldset[data-qid]')).forEach((f) => assert.ok(f.querySelector('legend')));
    assert.strictEqual(env.document.querySelector('label[for="bus-lang-select"]').textContent, ui(code, 'lang.label'));
    assert.strictEqual(env.document.querySelector('[role=progressbar]').getAttribute('aria-label'), ui(code, 'progress.barAria'));
  }
});

test('a11y：「その他」の入力欄は <label for> で関連付く（韓国語・中国語でも）。textarea は aria-label を持つ', async () => {
  const env = await openPage({ languages: ['ko-KR'] });
  await start(env);
  answer(env, 'age_confirmed', 'yes');
  await next(env);
  answer(env, 'favorite_uniforms', ['other'], '기타 입력');
  for (const code of ['ko', 'zh-Hans', 'zh-Hant']) {
    await setLang(env, code);
    const box = fieldset(env.document, 'favorite_uniforms').querySelector('.bus-other');
    const input = box.querySelector('input');
    assert.strictEqual(box.querySelector('label').getAttribute('for'), input.id);
    assert.strictEqual(box.querySelector('label').textContent, ui(code, 'common.otherText'));
    assert.strictEqual(input.value, '기타 입력');
  }
});

test('textarea（feedback / support_message）の aria-label・helpText・文字数表示が選択言語で、入力は保持される', async () => {
  const env = await openPage({ languages: ['ja-JP'] });
  await walkToReview(env, ROUTE);
  click(env.document, 'bus-back-btn');
  await settle();
  assert.ok(visibleIds(env.document).includes('support_message'));
  answer(env, 'support_message', 'ありがとう! thanks 感謝');
  for (const code of ['en', 'ko', 'zh-Hans', 'zh-Hant']) {
    await setLang(env, code);
    const fs_ = fieldset(env.document, 'support_message');
    const ta = fs_.querySelector('textarea');
    assert.strictEqual(ta.getAttribute('aria-label'), labelOf(code, 'support_message'));
    assert.strictEqual(fs_.querySelector('.bus-help').textContent, dicts[code].questions.support_message.helpText);
    assert.strictEqual(ta.value, 'ありがとう! thanks 感謝', '自由記述は翻訳しない');
    assert.strictEqual(fs_.querySelector('.bus-count').textContent, ui(code, 'common.charCount', { count: ta.value.length, max: schema.questions.find((q) => q.id === 'support_message').maxLength }));
  }
});

// ── fallback ──

test('翻訳 key が欠けても画面を壊さず、選択言語 → ja（schema）の順で表示する（CI の辞書テストが欠落自体を失敗させる）', async () => {
  const broken = JSON.parse(JSON.stringify(dicts));
  delete broken.en.ui['common.next'];
  delete broken.en.sections.uniform;
  delete broken.en.questions.favorite_uniforms.options.soccer;
  delete broken.en.questions.favorite_uniforms.label;
  const script = i18n.renderFrontend(broken);
  const env = await openPage({ languages: ['en-US'], overrides: { 'i18n.generated.js': script } });
  assert.deepStrictEqual(env.errors, []);
  await start(env);
  answer(env, 'age_confirmed', 'yes');
  assert.strictEqual(env.document.getElementById('bus-next').textContent, ui('ja', 'common.next'), 'ui は ja にフォールバック');
  await next(env);
  assert.strictEqual(pageTitle(env.document), section('ja', 'uniform'), 'section 見出しも ja');
  const fs_ = fieldset(env.document, 'favorite_uniforms');
  assert.strictEqual(fs_.querySelector('legend .bus-qtext').textContent, labelOf('ja', 'favorite_uniforms'));
  assert.strictEqual(fs_.querySelector('input[value="soccer"]').parentNode.textContent, optionLabelOf('ja', 'favorite_uniforms', 'soccer'));
  assert.strictEqual(fs_.querySelector('input[value="baseball"]').parentNode.textContent, optionLabelOf('en', 'favorite_uniforms', 'baseball'), '欠けていない文言は英語のまま');
});

test('辞書ファイルが読み込めなくても（SURVEY_I18N 未定義）日本語で動作する', async () => {
  const env = await openPage({ languages: ['en-US'], overrides: { 'i18n.generated.js': '' } });
  assert.strictEqual(htmlLang(env), 'ja', '辞書が無ければ ja');
  assert.strictEqual(env.document.getElementById('bus-lang-select').options.length, 1);
  assert.ok(bodyText(env.document).length > 0);
  assert.strictEqual(env.errors.length, 0);
});

test('生成された辞書と app.js の組み合わせで、全言語・全 section を表示しても JS エラーが出ない', async () => {
  for (const code of LOCALES) {
    const env = await openPage({ languages: [code] });
    assert.strictEqual(htmlLang(env), code);
    await walkToReview(env, ROUTE);
    assert.strictEqual(pageTitle(env.document), ui(code, 'review.title'), code);
    assert.deepStrictEqual(env.errors, [], code);
    assert.ok(!/\bundefined\b|\bnull\b|\{[a-z]+\}/i.test(bodyText(env.document)), `${code}: 未解決の placeholder / undefined がない`);
  }
});

test('モバイル幅でも言語選択が崩れない構造（CSS：flex 折り返しなし・最小タップ領域 44px・フォーカス表示）', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'baseball-uniform-survey', 'styles.css'), 'utf8');
  assert.match(css, /\.bus-lang-select\s*\{[^}]*min-height:\s*44px/);
  assert.match(css, /\.bus-lang-select:focus-visible/);
  assert.match(css, /html:lang\(ko\)/);
  assert.match(css, /html:lang\(zh-Hans\)/);
  assert.match(css, /html:lang\(zh-Hant\)/);
});

// ── residence_country（海外選択時の国・地域名。1行・必須・自由記述は翻訳しない） ──

async function openOverseasProfile(languages) {
  const env = await openPage({ languages });
  await walkToReview(env, { club_awareness: 'first_time', catchball_interest: 'low_interest' });
  for (let i = 0; i < 20 && !visibleIds(env.document).includes('prefecture'); i++) { click(env.document, 'bus-back-btn'); await settle(); }
  answer(env, 'prefecture', 'overseas');
  return env;
}

test('residence_country：label・helpText・必須・required error が5言語で表示され、1行入力が維持される', async () => {
  const env = await openOverseasProfile(['ja-JP']);
  for (const code of LOCALES) {
    await setLang(env, code);
    const fs_ = fieldset(env.document, 'residence_country');
    assert.ok(fs_, `${code}: 海外選択で表示`);
    assert.strictEqual(fs_.querySelector('legend .bus-qtext').textContent, labelOf(code, 'residence_country'));
    assert.strictEqual(fs_.querySelector('.bus-help').textContent, code === 'ja' ? schema.questions.find((q) => q.id === 'residence_country').helpText : dicts[code].questions.residence_country.helpText);
    assert.strictEqual(fs_.querySelector('.bus-req').textContent, ui(code, 'common.required'));
    const input = Array.from(fs_.children).find((c) => c.tagName === 'INPUT');
    assert.strictEqual(input.type, 'text');
    assert.strictEqual(input.getAttribute('aria-label'), labelOf(code, 'residence_country'));
  }
  await setLang(env, 'ko');
  click(env.document, 'bus-next'); // 未入力
  await settle();
  assert.strictEqual(env.document.getElementById('bus-err-residence_country').textContent, ui('ko', 'error.required'));
  await setLang(env, 'zh-Hant');
  assert.strictEqual(env.document.getElementById('bus-err-residence_country').textContent, ui('zh-Hant', 'error.required'));
  assert.strictEqual(env.document.querySelector('#bus-summary a').textContent, ui('zh-Hant', 'error.summaryItem', { label: labelOf('zh-Hant', 'residence_country'), message: ui('zh-Hant', 'error.required') }));
});

test('residence_country：入力は翻訳せず原文のまま保持・確認表示・送信され、公開向けの翻訳に混ざらない', async () => {
  const env = await openOverseasProfile(['en-US']);
  answer(env, 'residence_country', 'Việt Nam / 台灣 / España');
  for (const code of ['ko', 'zh-Hans']) {
    await setLang(env, code);
    const input = Array.from(fieldset(env.document, 'residence_country').children).find((c) => c.tagName === 'INPUT');
    assert.strictEqual(input.value, 'Việt Nam / 台灣 / España', `${code}: 原文のまま`);
  }
  for (let guard = 0; guard < 20 && env.document.getElementById('bus-questions'); guard++) { fillPage(env, { club_awareness: 'first_time', catchball_interest: 'low_interest' }); await next(env); }
  await setLang(env, 'zh-Hant');
  assert.ok(bodyText(env.document).includes('Việt Nam / 台灣 / España'), '確認画面も原文');
  click(env.document, 'bus-next');
  await settle();
  const body = bodyOf(posts(env)[0]);
  assert.strictEqual(body.answers.prefecture, 'overseas');
  assert.strictEqual(body.answers.residence_country, 'Việt Nam / 台灣 / España');
  assert.ok(!env.events().some((e) => JSON.stringify(e).includes('Việt')), 'GA4 へ送らない');
});

test('回答者向け画面（5言語）に GA4 / アクセス解析の技術的な説明を出さない。計測の制限（GA4 へ送らない実装）は変えない', async () => {
  const TECH = /GA4|Google Analytics|analytics|アクセス解析|접속 분석|访问分析|流量分析/i;
  for (const code of LOCALES) {
    const env = await openPage({ languages: [code] });
    assert.ok(!TECH.test(bodyText(env.document)), `${code}: intro`);
    Object.entries(dicts[code].ui).filter(([k]) => !k.startsWith('test.')).forEach(([k, v]) => assert.ok(!TECH.test(v), `${code}: ui.${k}`));
    assert.ok(!Object.prototype.hasOwnProperty.call(dicts[code].ui, 'intro.note.analytics'));
  }
  // 実装上の制限は従来どおり：form_start だけが送られ、設問ID・route・回答は含まれない
  const env = await openPage({ languages: ['ja-JP'] });
  await start(env);
  assert.deepStrictEqual(plain(env.events().map((e) => e.name)), ['form_start']);
});
