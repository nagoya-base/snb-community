'use strict';
// 回答者向け Frontend の5言語辞書（Issue #398）：完全性・unknown key・意味の固定（stable ID は schema から変わらない）。
// 日本語の設問・選択肢は schema が正本。辞書側が新しい設問・選択肢・意味を作っていないことを検査する。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const i18n = require('../tools/i18n');
const { clone } = require('./helpers/fixtures');

const schema = require('../survey.schema.json');
const APP = path.join(__dirname, '..', '..', '..', 'baseball-uniform-survey', 'app.js');
const HTML = path.join(__dirname, '..', '..', '..', 'baseball-uniform-survey.html');
const dicts = i18n.loadDicts();
const OTHERS = ['en', 'ko', 'zh-Hans', 'zh-Hant'];
const content = i18n.jaContent(schema);

const problemsOf = (mutate) => {
  const copy = clone(dicts);
  mutate(copy);
  return i18n.validate(schema, copy);
};
const has = (problems, locale, code, key) => problems.some((p) => p.locale === locale && p.code === code && p.key === key);

test('5言語（ja / en / ko / zh-Hans / zh-Hant）の辞書が存在し、zh は簡体・繁体を別辞書で持つ', () => {
  assert.deepStrictEqual(i18n.LOCALES, ['ja', 'en', 'ko', 'zh-Hans', 'zh-Hant']);
  i18n.LOCALES.forEach((locale) => {
    const file = path.join(i18n.I18N_DIR, locale + '.json');
    assert.ok(fs.existsSync(file), locale + '.json');
    assert.strictEqual(dicts[locale].locale, locale);
  });
  assert.ok(!fs.existsSync(path.join(i18n.I18N_DIR, 'zh.json')), 'zh だけにまとめない');
  assert.notDeepStrictEqual(dicts['zh-Hans'].ui, dicts['zh-Hant'].ui);
  assert.notDeepStrictEqual(dicts['zh-Hans'].questions, dicts['zh-Hant'].questions);
});

test('実物の辞書は完全性検証を通る（欠落・unknown・空・placeholder・日本語の残りが 0 件）', () => {
  assert.deepStrictEqual(i18n.validate(schema, dicts), []);
});

test('全 question.id に label があり、日本語に helpText があれば各言語にもある', () => {
  OTHERS.forEach((locale) => {
    schema.questions.forEach((q) => {
      const entry = dicts[locale].questions[q.id];
      assert.ok(entry && typeof entry.label === 'string' && entry.label.trim(), `${locale}.${q.id}.label`);
      if (q.helpText) assert.ok(typeof entry.helpText === 'string' && entry.helpText.trim(), `${locale}.${q.id}.helpText`);
      else assert.strictEqual(entry.helpText, undefined, `${locale}.${q.id}.helpText は日本語に無い`);
    });
  });
  assert.strictEqual(schema.questions.filter((q) => q.helpText).length, 2);
});

test('全 option.id に label があり、option ID 集合は日本語（schema）と各言語で完全一致する', () => {
  OTHERS.forEach((locale) => {
    schema.questions.forEach((q) => {
      const entry = dicts[locale].questions[q.id];
      if (!Array.isArray(q.options)) { assert.strictEqual(entry.options, undefined, `${locale}.${q.id} は options を持たない`); return; }
      assert.deepStrictEqual(Object.keys(entry.options).sort(), q.options.map((o) => o.id).sort(), `${locale}.${q.id}`);
      q.options.forEach((o) => assert.ok(entry.options[o.id].trim(), `${locale}.${q.id}.${o.id}`));
    });
  });
});

test('scale の anchors / notApplicable、section 見出し、milestone・route・低関心メッセージが全言語にある', () => {
  i18n.LOCALES.forEach((locale) => {
    schema.questions.filter((q) => q.type === 'scale').forEach((q) => {
      if (locale === 'ja') return;
      const entry = dicts[locale].questions[q.id];
      assert.deepStrictEqual(Object.keys(entry.anchors).sort(), Object.keys(q.anchors).sort(), `${locale}.${q.id}`);
      assert.ok(entry.notApplicable, `${locale}.${q.id}.notApplicable`);
    });
    i18n.sectionIds(schema).forEach((id) => assert.ok(dicts[locale].sections[id], `${locale}.sections.${id}`));
    Object.keys(dicts[locale].sections).forEach((id) => assert.ok(i18n.sectionIds(schema).includes(id), `不要な section: ${id}`));
    if (locale === 'ja') return;
    assert.deepStrictEqual(Object.keys(dicts[locale].schemaText.milestones).sort(), Object.keys(content.schemaText.milestones).sort());
    assert.ok(dicts[locale].schemaText.lowInterestAcknowledgement);
    assert.ok(dicts[locale].schemaText.routes.pure_uniform_short_route.messageBeforeProfile);
  });
});

test('UI 共通文言（ui key）が全言語に同じ集合で存在し、placeholder も日本語と一致する', () => {
  const keys = Object.keys(dicts.ja.ui).sort();
  assert.ok(keys.length >= 90);
  OTHERS.forEach((locale) => {
    assert.deepStrictEqual(Object.keys(dicts[locale].ui).sort(), keys, locale);
    keys.forEach((k) => assert.strictEqual(i18n.placeholders(dicts[locale].ui[k]), i18n.placeholders(dicts.ja.ui[k]), `${locale}.${k}`));
  });
});

test('日本語は schema が正本：ja.json は設問・選択肢を持たず（上書きしない）、持たせると検出される', () => {
  assert.deepStrictEqual(Object.keys(dicts.ja).sort(), ['locale', 'sections', 'ui']);
  const problems = problemsOf((d) => { d.ja.questions = { age_confirmed: { label: 'x' } }; d.ja.schemaText = {}; });
  assert.ok(has(problems, 'ja', 'ja_override', 'questions'));
  assert.ok(has(problems, 'ja', 'ja_override', 'schemaText'));
});

test('検出力：option の欠落・余分な option（新しい選択肢）・typo の key・設問の欠落を検出する', () => {
  const missing = problemsOf((d) => { delete d.en.questions.barriers.options.cost; });
  assert.ok(has(missing, 'en', 'missing', 'questions.barriers.options.cost'));
  const extra = problemsOf((d) => { d.ko.questions.barriers.options.brand_new_option = '새 선택지'; });
  assert.ok(has(extra, 'ko', 'unknown', 'questions.barriers.options.brand_new_option'), '翻訳側に新しい選択肢を作れない');
  const typo = problemsOf((d) => { d['zh-Hans'].questions.barriers.options.shcedule = d['zh-Hans'].questions.barriers.options.schedule; delete d['zh-Hans'].questions.barriers.options.schedule; });
  assert.ok(has(typo, 'zh-Hans', 'unknown', 'questions.barriers.options.shcedule'));
  assert.ok(has(typo, 'zh-Hans', 'missing', 'questions.barriers.options.schedule'));
  const q = problemsOf((d) => { delete d['zh-Hant'].questions.feedback; d['zh-Hant'].questions.feedbak = { label: 'x' }; });
  assert.ok(has(q, 'zh-Hant', 'missing', 'questions.feedback'));
  assert.ok(has(q, 'zh-Hant', 'unknown', 'questions.feedbak'));
  const ui = problemsOf((d) => { delete d.en.ui['common.next']; d.en.ui['common.nxt'] = 'Next'; });
  assert.ok(has(ui, 'en', 'missing', 'ui.common.next'));
  assert.ok(has(ui, 'en', 'unknown', 'ui.common.nxt'));
});

test('検出力：helpText / anchors / section / 空文字 / placeholder 欠け / 日本語の残りを検出する', () => {
  assert.ok(has(problemsOf((d) => { delete d.ko.questions.support_message.helpText; }), 'ko', 'missing', 'questions.support_message.helpText'));
  assert.ok(has(problemsOf((d) => { d.ko.questions.overall_satisfaction.helpText = 'x'; }), 'ko', 'unknown', 'questions.overall_satisfaction.helpText'));
  assert.ok(has(problemsOf((d) => { delete d.en.questions.overall_satisfaction.anchors['3']; }), 'en', 'missing', 'questions.overall_satisfaction.anchors.3'));
  assert.ok(has(problemsOf((d) => { delete d['zh-Hans'].sections.closing; }), 'zh-Hans', 'missing', 'sections.closing'));
  assert.ok(has(problemsOf((d) => { d.en.sections.not_a_section = 'x'; }), 'en', 'unknown', 'sections.not_a_section'));
  assert.ok(has(problemsOf((d) => { d.en.ui['common.start'] = '  '; }), 'en', 'empty', 'ui.common.start'));
  assert.ok(has(problemsOf((d) => { d.en.ui['progress.percent'] = 'About % done'; }), 'en', 'placeholder_mismatch', 'ui.progress.percent'));
  assert.ok(has(problemsOf((d) => { d.ko.questions.age.label = '年代を教えてください'; }), 'ko', 'untranslated_japanese', 'questions.age.label'), '翻訳漏れ（日本語のまま）');
  assert.ok(has(problemsOf((d) => { delete d.en.schemaText.milestones['before:preferred_program']; }), 'en', 'missing', 'schemaText.milestones.before:preferred_program'));
  assert.ok(has(problemsOf((d) => { d.en.questions.age.options.extra = 'x'; }), 'en', 'unknown', 'questions.age.options.extra'));
});

test('single_dynamic 設問は options を持たない（source 設問の翻訳を使う。翻訳側で選択肢を作らない）', () => {
  schema.questions.filter((q) => q.type === 'single_dynamic').forEach((q) => {
    OTHERS.forEach((locale) => assert.strictEqual(dicts[locale].questions[q.id].options, undefined, `${locale}.${q.id}`));
  });
  assert.ok(has(problemsOf((d) => { d.en.questions.top_uniform.options = { baseball: 'x' }; }), 'en', 'unknown', 'questions.top_uniform.options'));
});

test('用語の一貫性：名古屋野球ユニ部は別団体名に見えない訳を使い、キャッチボール会・ユニフォーム交流を落とさない', () => {
  const TERMS = {
    en: { club: 'Nagoya Baseball Uniform Club', catchball: /catchball/i, uniform: /uniform/i },
    ko: { club: '나고야 야구 유니폼부', catchball: /캐치볼/, uniform: /유니폼/ },
    'zh-Hans': { club: '名古屋棒球球衣部', catchball: /传接球/, uniform: /球衣/ },
    'zh-Hant': { club: '名古屋棒球球衣部', catchball: /傳接球/, uniform: /球衣/ }
  };
  const jaStrings = {};
  Object.keys(dicts.ja.ui).forEach((k) => { jaStrings['ui.' + k] = dicts.ja.ui[k]; });
  Object.keys(dicts.ja.sections).forEach((k) => { jaStrings['sections.' + k] = dicts.ja.sections[k]; });
  schema.questions.forEach((q) => {
    jaStrings[`questions.${q.id}.label`] = q.label;
    (q.options || []).forEach((o) => { jaStrings[`questions.${q.id}.options.${o.id}`] = o.label; });
  });
  Object.keys(content.schemaText.milestones).forEach((k) => { jaStrings['schemaText.milestones.' + k] = content.schemaText.milestones[k]; });
  jaStrings['schemaText.lowInterestAcknowledgement'] = content.schemaText.lowInterestAcknowledgement;
  jaStrings['schemaText.routes.pure_uniform_short_route.messageBeforeProfile'] = content.schemaText.routes.pure_uniform_short_route.messageBeforeProfile;
  // ui key は 'common.next' のように '.' を含むので、先頭の領域名で分けて引く。
  const pick = (dict, key) => {
    if (key.startsWith('ui.')) return dict.ui[key.slice(3)];
    return key.split('.').reduce((node, part) => (node === undefined ? undefined : node[part]), dict);
  };
  OTHERS.forEach((locale) => {
    const terms = TERMS[locale];
    Object.keys(jaStrings).forEach((key) => {
      const ja = jaStrings[key];
      const text = pick(dicts[locale], key);
      assert.ok(typeof text === 'string', `${locale} ${key}`);
      if (ja.includes('名古屋野球ユニ部') && key !== 'ui.page.back' && !key.startsWith('sections.')) {
        assert.ok(text.includes(terms.club) || text.includes('名古屋野球ユニ部'), `${locale} ${key}: 団体名`);
      }
      if (ja.includes('キャッチボール会') && !key.startsWith('sections.')) assert.match(text, terms.catchball, `${locale} ${key}: キャッチボール会`);
      if (ja.includes('ユニフォーム交流')) assert.match(text, terms.uniform, `${locale} ${key}: ユニフォーム交流`);
    });
  });
});

test('中国語は簡体字と繁体字を混ぜない（簡体の辞書に繁体専用字、繁体の辞書に簡体専用字がない）', () => {
  const TRAD_ONLY = /[體點關請嗎與為們這會後學選項應報態質運總經驗環體購買價輕鬆說還個]/;
  const SIMP_ONLY = /[体点关请吗与为们这会后学选项应报态质运总经验环购买价轻松说还个]/;
  const flatten = (node, out = []) => { if (typeof node === 'string') out.push(node); else if (node && typeof node === 'object') Object.values(node).forEach((v) => flatten(v, out)); return out; };
  flatten(dicts['zh-Hans']).forEach((text) => assert.ok(!TRAD_ONLY.test(text), `zh-Hans に繁体字: ${text}`));
  flatten(dicts['zh-Hant']).forEach((text) => assert.ok(!SIMP_ONLY.test(text), `zh-Hant に簡体字: ${text}`));
});

test('自由記述・入力値を扱う文言：翻訳は表示ラベルだけで、入力本文は辞書に入らない（辞書は文字列のみ・script/HTML なし）', () => {
  const flatten = (node, out = []) => { if (typeof node === 'string') out.push(node); else if (node && typeof node === 'object') Object.values(node).forEach((v) => flatten(v, out)); return out; };
  i18n.LOCALES.forEach((locale) => flatten(dicts[locale]).forEach((text) => {
    assert.ok(!/[<>]/.test(text), `${locale}: HTML を含まない: ${text}`);
  }));
});

test('Frontend が参照する ui key は辞書にあり、辞書の ui key は Frontend で使われている（typo・不要 key の検出）', () => {
  const code = fs.readFileSync(APP, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const html = fs.readFileSync(HTML, 'utf8');
  const PREFIX = '(?:page|lang|common|intro|review|progress|error|submit|done|test)';
  const literal = new RegExp(`'(${PREFIX}\\.[A-Za-z0-9_.]+)'`, 'g');
  const used = new Set();
  let m;
  while ((m = literal.exec(code))) used.add(m[1]);
  (html.match(/data-i18n="[^"]+"/g) || []).forEach((a) => used.add(a.slice(11, -1)));
  // 動的に組み立てる key（'test.banner.' + mode / 'error.' + code）は網羅リストで展開する。
  ['invalid_test_config', 'preview_no_submit', 'closed_view', 'submit_excluded'].forEach((mode) => used.add('test.banner.' + mode));
  const errorCodes = /ERROR_CODES = \[([^\]]+)\]/.exec(code)[1].match(/'([a-z_]+)'/g).map((s) => s.slice(1, -1));
  errorCodes.forEach((c) => used.add('error.' + c));
  const known = new Set(Object.keys(dicts.ja.ui));
  used.forEach((key) => { if (!key.endsWith('.')) assert.ok(known.has(key), `辞書に無い key: ${key}`); });
  known.forEach((key) => assert.ok(used.has(key), `使われていない key: ${key}`));
  // 動的 key の接頭辞だけの文字列（'test.banner.' / 'error.'）は literal に拾われないこと
  assert.ok(errorCodes.length === 11);
});

test('Frontend に日本語の表示文言をベタ書きしない（言語名の表記を除く）', () => {
  const stripped = fs.readFileSync(APP, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\/\/[^\n'"`]*$/gm, '');
  const offenders = stripped.split('\n').filter((line) => /[぀-ヿ一-鿿]/.test(line) && !/LOCALE_NAMES/.test(line));
  assert.deepStrictEqual(offenders, []);
});

test('静的 HTML の data-i18n 文言は ja 辞書と一致し、noscript は5言語を併記する', () => {
  const html = fs.readFileSync(HTML, 'utf8');
  const re = /<([a-z0-9]+)[^>]*data-i18n="([^"]+)"[^>]*>([^<]*)</g;
  let m;
  let count = 0;
  while ((m = re.exec(html))) { count += 1; assert.strictEqual(m[3], dicts.ja.ui[m[2]], m[2]); }
  assert.strictEqual(count, 4);
  ['ja', 'en', 'ko', 'zh-Hans', 'zh-Hant'].forEach((lang) => assert.match(html, new RegExp(`<noscript>[\\s\\S]*lang="${lang}"[\\s\\S]*</noscript>`)));
  assert.match(html, /<html lang="ja">/);
  assert.ok(html.indexOf('i18n.generated.js') < html.indexOf('baseball-uniform-survey/app.js'), '辞書は app.js より先に読み込む');
});

test('生成物 i18n.generated.js は辞書と一致し、server 専用情報・個票を含まない。Public/Admin/maintenance GAS には配らない', () => {
  const build = require('../tools/build-public-gas');
  const actual = fs.readFileSync(build.FRONTEND_I18N_TARGET, 'utf8');
  assert.strictEqual(actual, build.renderFrontendI18n());
  assert.match(actual, /DO NOT EDIT/);
  assert.ok(!/SURVEY_CONFIG|opens_at|RESPONDENT_SALT|test_token/.test(actual));
  [build.TARGET, build.ADMIN_TARGET, build.MAINTENANCE_TARGET].forEach((file) => assert.ok(!fs.readFileSync(file, 'utf8').includes('SURVEY_I18N'), path.basename(path.dirname(file))));
});

test('翻訳対象件数（日本語正本）を数えられる：設問46・選択肢・scale・UI 文言', () => {
  const n = i18n.countTargets(schema, dicts);
  assert.strictEqual(n.questions, schema.questions.length);
  assert.strictEqual(n.options, schema.questions.reduce((sum, q) => sum + (q.options ? q.options.length : 0), 0));
  assert.ok(n.total > 500);
});
