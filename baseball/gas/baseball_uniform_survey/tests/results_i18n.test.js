'use strict';
// 公開結果ページの5言語対応（Issue #414）：固定UI・設問/選択肢ラベルの翻訳、回答ページとの言語共有、段階公開・privacy 仕様の不変。
// 翻訳の正本は回答ページと同じ i18n/*.json。結果ページは results-i18n.generated.js を question.id / option.id（cell.id）で引く。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { schema, clone, validFrom, snapshotOf } = require('./helpers/fixtures');
const { openResults, settle, REPO, PAGE, read } = require('./helpers/results');
const D = require('./helpers/dom');
const i18n = require('../tools/i18n');
const { renderResultsI18n, RESULTS_I18N_TARGET } = require('../tools/build-public-gas');

const dicts = i18n.loadDicts();
const LOCALES = ['ja', 'en', 'ko', 'zh-Hans', 'zh-Hant'];
const LOCALE_KEY = 'snb_baseball_uniform_survey_locale_v1';
const KANA = /[぀-ヿｦ-ﾟ]/;
const NAME = '名古屋野球ユニ部';
const noKana = (text) => !KANA.test(String(text).split(NAME).join(''));
const NON_JA = LOCALES.filter((l) => l !== 'ja');

const ATTENDEE = { club_awareness: 'attended', last_attended: 'within_3m', overall_satisfaction: '5', satisfaction_atmosphere: '4', prefecture: 'pref_23' };
/** 地域・単一選択・複数選択・single_dynamic・scale（評価できない含む）がすべて published になる snapshot。 */
const richSnapshot = () => snapshotOf(validFrom([
  { count: 40, overrides: Object.assign({}, ATTENDEE, { favorite_uniforms: ['baseball', 'soccer'], top_uniform: 'baseball', baseball_experience: 'team' }) },
  { count: 10, overrides: Object.assign({}, ATTENDEE, { overall_satisfaction: 'cannot_rate', prefecture: 'pref_27', favorite_uniforms: ['baseball'], top_uniform: 'baseball' }) },
  { count: 15, overrides: { club_awareness: 'aware_not_attended', catchball_interest: 'very_interested', prefecture: 'pref_13', barriers: ['time'], main_barrier: 'time' } }
]));
const withMergedRegion = (snapshot) => {
  const copy = clone(snapshot);
  copy.questions.find((q) => q.type === 'region').cells.push({ id: 'other_regions', label: 'その他の地域', count: 4, merged: true });
  return copy;
};

const ui = (locale, key, params) => {
  let text = dicts[locale].ui[key];
  Object.entries(params || {}).forEach(([k, v]) => { text = text.split('{' + k + '}').join(String(v)); });
  return text;
};
const select = (env) => env.document.getElementById('bur-lang-select');
async function setLang(env, code) {
  const el = select(env);
  el.value = code;
  D.fire(env.window, el, 'change');
  await settle();
}
const cardsOf = (env) => Array.from(env.document.querySelectorAll('.bur-card'));
/** 言語に依存しない描画の構造（state・件数・割合・bar・suppression）。 */
function structure(env) {
  return cardsOf(env).map((card) => ({
    state: card.getAttribute('data-state'),
    base: (card.querySelector('.bur-base').textContent.match(/\d+/) || [])[0],
    suppressedNote: !!card.querySelector('.bur-hidden-note'),
    cells: Array.from(card.querySelectorAll('.bur-cells > li')).map((li) => ({
      hidden: li.classList.contains('bur-cell-hidden'),
      numbers: (li.querySelector('.bur-cell-count').textContent.match(/\d+/g) || []).join(','),
      width: li.querySelector('.bur-bar i') ? li.querySelector('.bur-bar i').style.width : null
    }))
  }));
}
const layersOf = (env) => Array.from(env.document.querySelectorAll('.bur-layer')).map((l) => l.getAttribute('data-section'));

// ── 生成物と辞書（正本は回答ページと同じ i18n/*.json） ──

test('results-i18n.generated.js は i18n/*.json の再生成結果と一致する（二重管理しない）', () => {
  assert.equal(fs.readFileSync(RESULTS_I18N_TARGET, 'utf8'), renderResultsI18n());
  assert.deepEqual(i18n.validate(schema, dicts), []);
});

test('結果ページ用の ui key（results.*）は5言語すべてにあり、プレースホルダが ja と一致する', () => {
  const keys = Object.keys(dicts.ja.ui).filter((k) => k.indexOf('results.') === 0);
  assert.ok(keys.length > 20);
  LOCALES.forEach((locale) => {
    keys.forEach((k) => {
      assert.equal(typeof dicts[locale].ui[k], 'string', `${locale} ${k}`);
      assert.equal(i18n.placeholders(dicts[locale].ui[k]), i18n.placeholders(dicts.ja.ui[k]), `${locale} ${k}`);
    });
  });
});

test('生成物の中身：ja 以外は 固定UI・公開設問の label / options / anchors / notApplicable・地域ブロックを question.id / option.id で持つ', () => {
  const sandbox = {};
  new Function('sandbox', fs.readFileSync(RESULTS_I18N_TARGET, 'utf8').replace('var SURVEY_RESULTS_I18N =', 'sandbox.R =') )(sandbox);
  const R = sandbox.R;
  assert.deepEqual(R.locales, LOCALES);
  const regionIds = schema.publicRegionAggregation.blocks.map((b) => b.id).concat('other_regions');
  const publicIds = schema.publicResultsOrder.filter((id) => schema.questions.some((q) => q.id === id));
  LOCALES.forEach((locale) => {
    const dict = R.dicts[locale];
    ['page.skip', 'page.back', 'page.eyebrow', 'lang.label', 'results.heading', 'results.answerCta', 'results.cell.count', 'results.base', 'results.error'].forEach((k) => assert.ok(dict.ui[k], `${locale} ${k}`));
    regionIds.forEach((id) => assert.ok(dict.ui['results.region.' + id], `${locale} region ${id}`));
    if (locale === 'ja') return;
    publicIds.forEach((id) => {
      const q = schema.questions.find((x) => x.id === id);
      const entry = dict.questions[id];
      assert.ok(entry && entry.label, `${locale} ${id}`);
      const owner = q.type === 'single_dynamic' ? schema.questions.find((x) => x.id === q.sourceQuestion) : q;
      if (q.type === 'single_dynamic') assert.equal(R.dynamicSources[id], q.sourceQuestion);
      (owner.options || []).forEach((o) => assert.ok(R.dicts[locale].questions[owner.id].options[o.id], `${locale} ${owner.id}.${o.id}`));
      if (q.type === 'scale') {
        Object.keys(q.anchors).forEach((n) => assert.ok(entry.anchors[n], `${locale} ${id} anchor ${n}`));
        assert.ok(entry.notApplicable);
      }
    });
    // 回答ページの辞書と同じ文言（二重管理していない）
    publicIds.forEach((id) => assert.equal(dict.questions[id].label, dicts[locale].questions[id].label));
  });
});

test('ja の固定UI・地域名・representativeness は、静的HTML・snapshot（schema 由来）と同じ文言（日本語の正本が二つにならない）', () => {
  const doc = new JSDOM(read(PAGE)).window.document;
  doc.querySelectorAll('[data-i18n]').forEach((node) => assert.equal(node.textContent, dicts.ja.ui[node.getAttribute('data-i18n')], node.getAttribute('data-i18n')));
  assert.equal(doc.querySelector('img[data-i18n-alt]').getAttribute('alt'), dicts.ja.ui['results.heroAlt']);
  assert.equal(doc.title, dicts.ja.ui['results.page.title']);
  assert.equal(doc.querySelector('meta[name="description"]').getAttribute('content'), dicts.ja.ui['results.page.metaDescription']);
  assert.equal(dicts.ja.ui['results.representativeness'], schema.publicationPolicy.ui.representativenessNotice);
  assert.equal(dicts.ja.ui['results.region.label'], schema.publicRegionAggregation.publicLabel);
  assert.equal(dicts.ja.ui['results.region.other_regions'], schema.publicRegionAggregation.privacy.mergedLabel);
  schema.publicRegionAggregation.blocks.forEach((b) => assert.equal(dicts.ja.ui['results.region.' + b.id], b.label));
  schema.publicationPolicy.ui.sections.forEach((s) => assert.equal(dicts.ja.ui['results.section.' + s.id], s.label));
});

// ── 初期言語・言語切替 ──

test('初期言語は 保存済みの明示選択 → ブラウザ言語 → ja。自動判定だけでは保存しない', async () => {
  const cases = [[['ja-JP'], 'ja'], [['en-US'], 'en'], [['ko-KR'], 'ko'], [['zh-CN'], 'zh-Hans'], [['zh-TW'], 'zh-Hant'], [['fr-FR'], 'ja']];
  for (const [languages, expected] of cases) {
    const env = await openResults(richSnapshot(), null, { languages });
    assert.equal(env.document.documentElement.getAttribute('lang'), expected, languages.join());
    assert.equal(select(env).value, expected);
    assert.equal(env.window.localStorage.getItem(LOCALE_KEY), null);
  }
  const saved = await openResults(richSnapshot(), null, { languages: ['en-US'], local: { [LOCALE_KEY]: 'zh-Hant' } });
  assert.equal(saved.document.documentElement.getAttribute('lang'), 'zh-Hant');
  const broken = await openResults(richSnapshot(), null, { languages: ['ko-KR'], local: { [LOCALE_KEY]: 'xx' } });
  assert.equal(broken.document.documentElement.getAttribute('lang'), 'ko');
});

test('言語選択は5言語。再読み込み・再取得なしで切り替わり、選択は localStorage だけに保存される', async () => {
  const env = await openResults(richSnapshot());
  assert.deepEqual(Array.from(select(env).options).map((o) => [o.value, o.textContent]), [['ja', '日本語'], ['en', 'English'], ['ko', '한국어'], ['zh-Hans', '简体中文'], ['zh-Hant', '繁體中文']]);
  assert.equal(env.document.querySelector('label[for="bur-lang-select"]').textContent, ui('ja', 'lang.label'));
  await setLang(env, 'ko');
  assert.equal(env.calls.length, 1, 'snapshot は再取得しない');
  assert.equal(env.window.localStorage.getItem(LOCALE_KEY), 'ko');
  assert.equal(env.document.documentElement.getAttribute('lang'), 'ko');
  assert.equal(env.document.activeElement, select(env), 'フォーカスは言語選択に残る');
  assert.equal(env.document.querySelector('label[for="bur-lang-select"]').textContent, ui('ko', 'lang.label'));
  assert.deepEqual(env.errors, []);
});

test('5言語すべてで固定UI（本文へ移動・戻る・eyebrow・H1・CTA・見方・回答状況・セクション見出し・回答数・対象者数・非表示注記）が切り替わり、日本語が残らない', async () => {
  const snapshot = withMergedRegion(richSnapshot());
  const published = snapshot.questions.filter((q) => q.state === 'published');
  const env = await openResults(snapshot);
  for (const locale of LOCALES) {
    await setLang(env, locale);
    const doc = env.document;
    assert.equal(doc.documentElement.getAttribute('lang'), locale);
    assert.equal(doc.querySelector('.bur-skip').textContent, ui(locale, 'page.skip'));
    assert.equal(doc.querySelector('.bur-back').textContent, ui(locale, 'page.back'));
    assert.equal(doc.querySelector('.bur-eyebrow').textContent, ui(locale, 'page.eyebrow'));
    assert.equal(doc.querySelector('h1').textContent, ui(locale, 'results.heading'));
    assert.equal(doc.querySelector('.bur-answer-cta').textContent, ui(locale, 'results.answerCta'));
    assert.equal(doc.getElementById('bur-notice-title').textContent, ui(locale, 'results.notice.title'));
    assert.deepEqual(Array.from(doc.querySelectorAll('.bur-notice li')).map((li) => li.textContent), ['voluntary', 'smallGroups', 'unpublished', 'batch'].map((k) => ui(locale, 'results.notice.' + k)));
    assert.equal(doc.querySelector('.bur-hero img').getAttribute('alt'), ui(locale, 'results.heroAlt'));
    assert.equal(doc.title, ui(locale, 'results.page.title'));
    assert.equal(doc.querySelector('meta[name="description"]').getAttribute('content'), ui(locale, 'results.page.metaDescription'));
    assert.deepEqual(Array.from(doc.querySelectorAll('.bur-layer > h2')).map((h) => h.textContent), [ui(locale, 'results.section.response_status'), ui(locale, 'results.section.survey_results')]);
    assert.equal(doc.querySelector('.bur-status').textContent, ui(locale, 'results.status.counting', { count: snapshot.production_valid_total }));
    cardsOf(env).forEach((card, i) => assert.equal(card.querySelector('.bur-base').textContent, ui(locale, 'results.base', { count: Math.floor(published[i].targetCount / 10) * 10 })));
    assert.ok(doc.querySelector('.bur-hidden-note') === null || doc.querySelector('.bur-hidden-note').textContent === ui(locale, 'results.hiddenNote'));
    assert.equal(doc.querySelector('#bur-app > p.bur-lead').textContent, ui(locale, 'results.representativeness'));
    if (locale !== 'ja') {
      // 言語名の選択肢と noscript（5言語併記）を除く、表示されるすべての文言に日本語が残らない。
      const leaves = Array.from(doc.querySelector('.bur-wrap').querySelectorAll('*')).filter((e) => e.children.length === 0 && !e.closest('.bur-lang') && !e.closest('noscript')).map((e) => e.textContent);
      const leftover = leaves.filter((text) => !noKana(text));
      assert.deepEqual(leftover, [], `${locale} に日本語が残っている`);
    }
  }
  assert.deepEqual(env.errors, []);
});

test('回答数の表示（10件未満は「回答受付中」）も5言語で切り替わる', async () => {
  const env = await openResults(snapshotOf(validFrom([{ count: 7 }])));
  for (const locale of LOCALES) {
    await setLang(env, locale);
    assert.equal(env.document.querySelector('.bur-status').textContent, ui(locale, 'results.status.collecting'));
    assert.deepEqual(layersOf(env), ['response_status']);
    assert.equal(cardsOf(env).length, 0);
  }
});

test('snapshot の取得失敗時のエラー文言も5言語で切り替わる（言語切替で再取得しない）', async () => {
  const env = await openResults(null, () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }));
  assert.equal(env.text(), ui('ja', 'results.error'));
  for (const locale of LOCALES) {
    await setLang(env, locale);
    assert.equal(env.text(), ui(locale, 'results.error'));
  }
  assert.equal(env.calls.length, 1);
});

// ── 設問ラベル・選択肢ラベル ──

test('5言語すべてで公開設問ラベル・選択肢ラベル（地域・単一・複数・single_dynamic・scale・評価できない）が question.id / option.id で翻訳される', async () => {
  const snapshot = withMergedRegion(richSnapshot());
  const published = snapshot.questions.filter((q) => q.state === 'published');
  assert.ok(['region', 'single', 'multiple', 'single_dynamic', 'scale'].every((type) => published.some((q) => q.type === type)));
  const env = await openResults(snapshot);
  const qOf = (id) => schema.questions.find((q) => q.id === id);
  for (const locale of LOCALES) {
    await setLang(env, locale);
    const cards = cardsOf(env);
    assert.equal(cards.length, published.length);
    published.forEach((q, i) => {
      const card = cards[i];
      const entryOf = (id) => dicts[locale].questions[id];
      let expectedTitle;
      if (q.type === 'region') expectedTitle = ui(locale, 'results.region.label');
      else expectedTitle = locale === 'ja' ? q.label : entryOf(q.id).label;
      assert.equal(card.querySelector('h3').textContent, expectedTitle, `${locale} ${q.id} label`);
      const labels = Array.from(card.querySelectorAll('.bur-cells > li .bur-cell-head > span:first-child')).map((s) => s.textContent);
      const expected = q.cells.map((cell) => {
        if (locale === 'ja') return cell.label;
        if (q.type === 'region') return ui(locale, 'results.region.' + cell.id);
        const owner = q.type === 'single_dynamic' ? q.sourceQuestion || qOf(q.id).sourceQuestion : q.id;
        const entry = entryOf(owner);
        if (q.type === 'scale') return cell.independent ? entry.notApplicable : entry.anchors[cell.id];
        return entry.options[cell.id];
      });
      assert.deepEqual(labels, expected, `${locale} ${q.id} cells`);
      if (locale !== 'ja') labels.forEach((l) => assert.ok(noKana(l), `${locale} ${q.id}: ${l}`));
    });
  }
});

test('単一の翻訳元：結果ページが表示する英語の設問・選択肢は、回答ページの辞書（i18n/en.json）の文言そのもの', async () => {
  const env = await openResults(richSnapshot(), null, { languages: ['en-US'] });
  const en = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'i18n', 'en.json'), 'utf8'));
  const card = cardsOf(env).find((c) => c.querySelector('h3').textContent === en.questions.baseball_experience.label);
  assert.ok(card);
  assert.equal(card.querySelector('.bur-cells > li .bur-cell-head > span').textContent, en.questions.baseball_experience.options.team);
});

// ── 段階公開・privacy は言語で変わらない ──

test('言語切替の前後で、公開/非公開 state・件数・割合・bar・suppression 表示・snapshot の値が変わらない', async () => {
  const valid = validFrom([
    { count: 20, overrides: { baseball_experience: 'team' } },
    { count: 2, overrides: { baseball_experience: 'grass_baseball' } },
    { count: 8, overrides: { baseball_experience: 'catchball_only' } }
  ]);
  const snapshot = withMergedRegion(snapshotOf(valid));
  const before = JSON.stringify(snapshot);
  const env = await openResults(snapshot);
  const base = structure(env);
  const baseLayers = layersOf(env);
  assert.ok(base.some((c) => c.cells.some((cell) => cell.hidden)), '少数セルの非表示を含む');
  assert.ok(base.some((c) => c.suppressedNote));
  for (const locale of ['en', 'ko', 'zh-Hans', 'zh-Hant', 'ja']) {
    await setLang(env, locale);
    assert.deepEqual(structure(env), base, locale);
    assert.deepEqual(layersOf(env), baseLayers, locale);
    // 非表示セルは値を出さない（位置だけ残す）
    Array.from(env.document.querySelectorAll('.bur-cell-hidden')).forEach((li) => {
      assert.equal(li.querySelector('.bur-cell-count').textContent, ui(locale, 'results.cell.hidden'));
      assert.equal(li.querySelector('.bur-bar'), null);
    });
    assert.equal(env.document.querySelector('.bur-hidden-note').textContent, ui(locale, 'results.hiddenNote'));
  }
  assert.equal(env.calls.length, 1);
  assert.equal(JSON.stringify(snapshot), before);
});

test('非公開設問（insufficient / sensitive_withheld / suppressed_all / 未知 state）は、どの言語でも設問カードとして存在しない', async () => {
  const snapshot = clone(richSnapshot());
  ['suppressed_all', 'something_new', 'insufficient', 'sensitive_withheld'].forEach((state, i) => { snapshot.questions[i].state = state; });
  const hiddenIds = snapshot.questions.slice(0, 4).map((q) => q.id);
  const published = snapshot.questions.filter((q) => q.state === 'published');
  const env = await openResults(snapshot);
  for (const locale of LOCALES) {
    await setLang(env, locale);
    assert.equal(cardsOf(env).length, published.length, locale);
    const titles = cardsOf(env).map((c) => c.querySelector('h3').textContent);
    hiddenIds.forEach((id) => {
      const label = locale === 'ja' ? snapshot.questions.find((q) => q.id === id).label : (dicts[locale].questions[id] || {}).label || ui(locale, 'results.region.label');
      assert.ok(!titles.includes(label), `${locale} ${id}`);
    });
    assert.equal(env.document.querySelectorAll('.bur-msg').length, 0);
  }
});

test('公開設問0件のセクションは見出しごと出さない（response_status だけ例外）。言語を切り替えても同じ', async () => {
  const env = await openResults(snapshotOf(validFrom([{ count: 7 }])));
  for (const locale of LOCALES) {
    await setLang(env, locale);
    assert.deepEqual(layersOf(env), ['response_status']);
    assert.equal(env.document.querySelectorAll('.bur-layer > h2').length, 1);
  }
});

// ── 翻訳欠落 ──

test('翻訳が欠けていても日本語（snapshot の label）へ fallback し、描画全体を壊さない', async () => {
  const sandbox = {};
  new Function('sandbox', fs.readFileSync(path.join(REPO, 'baseball/baseball-uniform-survey-results/results-i18n.generated.js'), 'utf8').replace('var SURVEY_RESULTS_I18N =', 'sandbox.R ='))(sandbox);
  const broken = clone(sandbox.R);
  const en = broken.dicts.en;
  delete en.questions.baseball_experience;                     // 設問ごと欠落
  delete en.questions.favorite_uniforms.options.baseball;      // 選択肢だけ欠落
  delete en.questions.overall_satisfaction.anchors['5'];       // scale 目盛りの欠落
  delete en.questions.overall_satisfaction.notApplicable;      // 評価できない の欠落
  delete en.ui['results.region.tokai'];                        // 地域名の欠落
  delete en.ui['results.base'];                                // 固定UIの欠落（ja へ fallback）
  broken.dicts.ko = undefined;                                 // 言語まるごと欠落
  delete broken.dicts.ja.ui['results.cell.hidden'];            // ja にも無い key は key 名を出す（画面は壊れない）
  const snapshot = richSnapshot();
  const i18nScript = 'var SURVEY_RESULTS_I18N = ' + JSON.stringify(broken) + ';';
  const env = await openResults(snapshot, null, { languages: ['en-US'], i18n: i18nScript });
  assert.deepEqual(env.errors, []);
  const q = (id) => snapshot.questions.find((x) => x.id === id);
  const cardOf = (id, label) => cardsOf(env).find((c) => c.querySelector('h3').textContent === label);
  assert.ok(cardOf('baseball_experience', q('baseball_experience').label), '設問ラベルは ja へ fallback');
  const fav = cardOf('favorite_uniforms', dicts.en.questions.favorite_uniforms.label);
  const favLabels = Array.from(fav.querySelectorAll('.bur-cells > li .bur-cell-head > span:first-child')).map((s) => s.textContent);
  assert.equal(favLabels[0], q('favorite_uniforms').cells[0].label, '欠けた選択肢は ja');
  assert.equal(favLabels[1], dicts.en.questions.favorite_uniforms.options.soccer, '欠けていない選択肢は翻訳');
  const sat = cardOf('overall_satisfaction', dicts.en.questions.overall_satisfaction.label);
  const satLabels = Array.from(sat.querySelectorAll('.bur-cells > li .bur-cell-head > span:first-child')).map((s) => s.textContent);
  assert.equal(satLabels[4], q('overall_satisfaction').cells[4].label);
  assert.equal(satLabels[5], q('overall_satisfaction').cells[5].label);
  assert.equal(satLabels[0], dicts.en.questions.overall_satisfaction.anchors['1']);
  const region = cardsOf(env)[0];
  assert.ok(Array.from(region.querySelectorAll('.bur-cell-head > span:first-child')).some((s) => s.textContent === '東海'));
  assert.equal(env.document.querySelector('.bur-base').textContent, ui('ja', 'results.base', { count: Math.floor(snapshot.questions.filter((x) => x.state === 'published')[0].targetCount / 10) * 10 }), '欠けた固定UIは ja');
  await setLang(env, 'ko');
  assert.deepEqual(env.errors, []);
  assert.equal(env.document.querySelector('.bur-answer-cta').textContent, ui('ja', 'results.answerCta'), '言語まるごと欠落は ja');
  assert.equal(cardsOf(env).length, snapshot.questions.filter((x) => x.state === 'published').length);
  assert.equal(env.document.querySelector('.bur-cell-hidden'), null);
  await setLang(env, 'ja');
  assert.deepEqual(env.errors, []);
});

test('辞書ファイル自体が読み込めなくても（SURVEY_RESULTS_I18N 未定義）描画は壊れず、snapshot の日本語ラベルを出す', async () => {
  const snapshot = richSnapshot();
  const env = await openResults(snapshot, null, { i18n: '' });
  assert.deepEqual(env.errors, []);
  assert.equal(cardsOf(env).length, snapshot.questions.filter((x) => x.state === 'published').length);
  assert.equal(cardsOf(env)[1].querySelector('h3').textContent, snapshot.questions.filter((x) => x.state === 'published')[1].label);
});

// ── URL・GA4・canonical ──

test('言語はURL（query / hash）・history・リンク・canonical・OGP に載らず、GA4 へも送らない', async () => {
  const env = await openResults(richSnapshot(), null, { search: '?src=line' });
  const href = env.window.location.href;
  const length = env.window.history.length;
  const head = () => Array.from(env.document.querySelectorAll('link[rel="canonical"], meta[property^="og:"], meta[name^="twitter:"]')).map((n) => n.outerHTML).join('\n');
  const headBefore = head();
  for (const locale of ['en', 'ko', 'zh-Hans', 'zh-Hant', 'ja']) {
    await setLang(env, locale);
    assert.equal(env.window.location.href, href);
    assert.equal(env.window.history.length, length);
    assert.ok(!/locale|lang/i.test(env.window.location.search + env.window.location.hash));
    env.document.querySelectorAll('a[href]').forEach((a) => assert.ok(!/[?#]/.test(a.getAttribute('href')) || a.getAttribute('href').startsWith('#'), a.outerHTML));
    assert.equal(env.document.querySelector('.bur-answer-cta').getAttribute('href'), 'baseball-uniform-survey.html');
    assert.equal(head(), headBefore, 'canonical / og は言語切替で変えない');
  }
  assert.match(headBefore, /rel="canonical" href="https:\/\/nagoya-base\.github\.io\/snb-community\/baseball\/baseball-uniform-survey-results\.html"/);
  assert.match(headBefore, /survey-ogp\.jpg/);
  assert.deepEqual(env.calls, ['baseball-uniform-survey-results/snapshot.json']);
  const source = read('baseball/baseball-uniform-survey-results/results.js') + read(PAGE);
  assert.ok(!/gtag|dataLayer|analytics\.js|sendBeacon|location\.(search|hash)|history\.(push|replace)State/.test(source));
});

// ── 回答ページとの相互遷移（同じ localStorage キー） ──

test('回答ページで選んだ言語が結果ページに反映される', async () => {
  const survey = await D.openPage({ languages: ['ja-JP'] });
  const sel = survey.document.getElementById('bus-lang-select');
  sel.value = 'zh-Hant';
  D.fire(survey.window, sel, 'change');
  await settle();
  const stored = survey.window.localStorage.getItem(LOCALE_KEY);
  assert.equal(stored, 'zh-Hant');
  const results = await openResults(richSnapshot(), null, { languages: ['ja-JP'], local: { [LOCALE_KEY]: stored } });
  assert.equal(results.document.documentElement.getAttribute('lang'), 'zh-Hant');
  assert.equal(select(results).value, 'zh-Hant');
  assert.equal(results.document.querySelector('h1').textContent, ui('zh-Hant', 'results.heading'));
  assert.equal(results.document.querySelector('.bur-answer-cta').textContent, ui('zh-Hant', 'results.answerCta'));
});

test('結果ページで選んだ言語が回答ページ（結果を見る CTA を含む）に反映される', async () => {
  const results = await openResults(richSnapshot(), null, { languages: ['ja-JP'] });
  await setLang(results, 'ko');
  const stored = results.window.localStorage.getItem(LOCALE_KEY);
  assert.equal(stored, 'ko');
  const survey = await D.openPage({ languages: ['ja-JP'], local: { [LOCALE_KEY]: stored } });
  assert.equal(survey.document.documentElement.getAttribute('lang'), 'ko');
  assert.equal(survey.document.getElementById('bus-lang-select').value, 'ko');
  assert.equal(survey.document.querySelector('.bus-results-cta').textContent, ui('ko', 'page.resultsCta'));
  assert.equal(survey.document.querySelector('.bus-results-cta').getAttribute('href'), 'baseball-uniform-survey-results.html');
});

test('回答ページと結果ページは同じ言語ロジック（locale.js）・同じ localStorage キーを使う', () => {
  const app = read('baseball/baseball-uniform-survey/app.js');
  const results = read('baseball/baseball-uniform-survey-results/results.js');
  const locale = read('baseball/baseball-uniform-survey/locale.js');
  assert.match(locale, new RegExp(`KEY = '${LOCALE_KEY}'`));
  assert.ok(!app.includes(LOCALE_KEY) && !results.includes(LOCALE_KEY), 'キーの定義は locale.js だけ');
  assert.match(app, /SurveyLocale\.initial/);
  assert.match(results, /SurveyLocale\.initial/);
  assert.match(read('baseball/baseball-uniform-survey.html'), /baseball-uniform-survey\/locale\.js/);
  assert.match(read(PAGE), /baseball-uniform-survey\/locale\.js/);
  assert.ok(fs.existsSync(path.join(REPO, 'baseball/baseball-uniform-survey/locale.js')));
  // ページ側スクリプトの読み込み順：辞書 → locale.js → ページのスクリプト
  const order = (html, names) => names.map((n) => html.indexOf(n));
  const r = order(read(PAGE), ['survey-results/results-i18n.generated.js"', 'survey/locale.js"', 'survey-results/results.js"']);
  assert.deepEqual(r.slice().sort((a, b) => a - b), r);
  const s = order(read('baseball/baseball-uniform-survey.html'), ['i18n.generated.js"', 'locale.js"', 'app.js"']);
  assert.deepEqual(s.slice().sort((a, b) => a - b), s);
});

// ── モバイル幅 ──

test('モバイル幅（iPhone Safari 含む）で言語切替UIが横スクロールを起こさない構造（CSS / viewport の静的検査）', () => {
  const css = read('baseball/baseball-uniform-survey-results/results.css');
  const html = read(PAGE);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1.0">/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
  assert.match(css, /\.bur-wrap\s*\{[^}]*max-width:\s*720px/);
  assert.match(css, /\.bur-lang\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(css, /\.bur-lang-select\s*\{[^}]*max-width:\s*60%/);
  assert.match(css, /\.bur-lang-select\s*\{[^}]*font:\s*inherit/, 'iOS のズーム回避（16px）');
  assert.match(css, /\.bur-card\s*\{[^}]*min-width:\s*0/);
  const widths = [...css.matchAll(/(?:^|[;{\s])(?:min-)?width:\s*(\d+)px/g)].map((m) => Number(m[1]));
  widths.forEach((w) => assert.ok(w <= 360, `width ${w}px`));
  // 言語名は最長でも 7 文字程度。長い翻訳（回答数・対象者数）もセル内で折り返せる
  assert.ok(/\.bur-cell-head\s*\{[^}]*display:\s*flex/.test(css));
});

// ── ヒーロー画像（言語別）。OGP / Twitter 画像は固定 ──

const HERO = {
  ja: ['survey-hero.webp', 'survey-ogp.jpg'],
  en: ['survey-hero-en.webp', 'survey-hero-en.webp'],
  ko: ['survey-hero-ko.webp', 'survey-hero-ko.webp'],
  'zh-Hans': ['survey-hero-zh-hans.webp', 'survey-hero-zh-hans.webp'],
  'zh-Hant': ['survey-hero-zh-hant.webp', 'survey-hero-zh-hant.webp']
};
const heroOf = (env) => ({
  srcset: env.document.querySelector('.bur-hero source').getAttribute('srcset'),
  src: env.document.querySelector('.bur-hero img').getAttribute('src'),
  alt: env.document.querySelector('.bur-hero img').getAttribute('alt')
});
const metaImages = (env) => Array.from(env.document.querySelectorAll('meta[property="og:image"], meta[property^="og:image:"], meta[name="twitter:image"], meta[name="twitter:card"]')).map((m) => m.outerHTML);
const IMG_DIR = '../images/baseball/catchball/';

test('ヒーロー画像：5言語それぞれで <source srcset> / <img src> / alt が再読み込みなしで切り替わり、実ファイルが存在する', async () => {
  const env = await openResults(richSnapshot());
  assert.deepEqual(heroOf(env), { srcset: IMG_DIR + 'survey-hero.webp', src: IMG_DIR + 'survey-ogp.jpg', alt: ui('ja', 'results.heroAlt') });
  const seen = new Set();
  for (const locale of ['en', 'ko', 'zh-Hans', 'zh-Hant', 'ja']) {
    await setLang(env, locale);
    const hero = heroOf(env);
    assert.deepEqual(hero, { srcset: IMG_DIR + HERO[locale][0], src: IMG_DIR + HERO[locale][1], alt: ui(locale, 'results.heroAlt') }, locale);
    [hero.srcset, hero.src].forEach((u) => assert.ok(fs.existsSync(path.join(REPO, 'baseball', u)), u));
    seen.add(hero.srcset);
  }
  assert.equal(seen.size, 5, '5言語で画像URLがすべて異なる');
  assert.equal(env.calls.length, 1, '再読み込み・再取得なし');
  assert.equal(env.document.querySelectorAll('.bur-hero img').length, 1);
});

test('ヒーロー画像：初期言語・保存済みの言語に合わせて最初から切り替わる', async () => {
  for (const [languages, locale] of [[['en-US'], 'en'], [['ko-KR'], 'ko'], [['zh-CN'], 'zh-Hans'], [['zh-TW'], 'zh-Hant']]) {
    const env = await openResults(richSnapshot(), null, { languages });
    assert.equal(heroOf(env).srcset, IMG_DIR + HERO[locale][0], locale);
  }
  const saved = await openResults(richSnapshot(), null, { languages: ['ja-JP'], local: { [LOCALE_KEY]: 'ko' } });
  assert.equal(heroOf(saved).src, IMG_DIR + HERO.ko[1]);
});

test('ヒーロー画像：言語別画像の読み込みに失敗したら日本語ヒーローへ fallback し、その言語は以後再試行しない', async () => {
  const env = await openResults(richSnapshot(), null, { languages: ['en-US'] });
  assert.equal(heroOf(env).srcset, IMG_DIR + HERO.en[0]);
  env.document.querySelector('.bur-hero img').dispatchEvent(new env.window.Event('error'));
  assert.equal(heroOf(env).srcset, IMG_DIR + HERO.ja[0]);
  assert.equal(heroOf(env).src, IMG_DIR + HERO.ja[1]);
  assert.equal(heroOf(env).alt, ui('en', 'results.heroAlt'), 'alt は選択言語のまま');
  await setLang(env, 'ko');
  assert.equal(heroOf(env).srcset, IMG_DIR + HERO.ko[0], '他言語の画像は引き続き使える');
  await setLang(env, 'en');
  assert.equal(heroOf(env).srcset, IMG_DIR + HERO.ja[0], '失敗した言語は ja のまま');
  env.document.querySelector('.bur-hero img').dispatchEvent(new env.window.Event('error'));
  await setLang(env, 'ja');
  env.document.querySelector('.bur-hero img').dispatchEvent(new env.window.Event('error')); // ja が失敗しても無限に書き換えない
  assert.equal(heroOf(env).src, IMG_DIR + HERO.ja[1]);
  assert.deepEqual(env.errors, []);
});

test('OGP / Twitter 画像は survey-ogp.jpg 固定で、言語切替・fallback でも JS は書き換えない', async () => {
  const env = await openResults(richSnapshot());
  const before = metaImages(env);
  assert.ok(before.some((m) => m.includes('property="og:image"') && m.includes('/images/baseball/catchball/survey-ogp.jpg')));
  assert.ok(before.some((m) => m.includes('name="twitter:image"') && m.includes('/images/baseball/catchball/survey-ogp.jpg')));
  for (const locale of LOCALES) {
    await setLang(env, locale);
    assert.deepEqual(metaImages(env), before, locale);
  }
  env.document.querySelector('.bur-hero img').dispatchEvent(new env.window.Event('error'));
  assert.deepEqual(metaImages(env), before);
  const js = read('baseball/baseball-uniform-survey-results/results.js');
  assert.ok(!/og:image|twitter:image|meta\[property|property="og/.test(js.replace(/\/\*[\s\S]*?\*\//g, '')), 'results.js は OGP meta を触らない');
  // 静的 HTML の OGP 画像は言語別ヒーローではなく survey-ogp.jpg
  assert.ok(!/og:image"[^>]*survey-hero|twitter:image"[^>]*survey-hero/.test(read(PAGE)));
});
