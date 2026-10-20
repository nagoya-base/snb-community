'use strict';

// 回答者向け Frontend の表示辞書（i18n/*.json）の読み込み・完全性検証・生成物の描画（Issue #398）。
//
// 方針:
//  - 日本語の設問・選択肢・scale・milestone 等は survey.schema.json が正本。ja.json は UI 文言と section 見出しだけを持つ。
//  - 他言語は question.id / option.id をキーに「表示文言」だけを持つ。新しい設問・選択肢・意味を作らない（unknown key はエラー）。
//  - 保存値・分岐・required は schema のまま。辞書は Public GAS / Admin / maintenance には配らない（Frontend 専用）。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const I18N_DIR = path.join(ROOT, 'i18n');
const LOCALES = ['ja', 'en', 'ko', 'zh-Hans', 'zh-Hant'];
const DEFAULT_LOCALE = 'ja';
const DICT_KEYS = ['locale', 'ui', 'sections', 'schemaText', 'questions'];
const QUESTION_KEYS = ['label', 'helpText', 'options', 'anchors', 'notApplicable'];
const KANA_RE = /[\u3040-\u30ff\uff66-\uff9f]/;
// 固有名詞「名古屋野球ユニ部」の原表記だけは、別団体名に見えないよう各言語で併記してよい。
const KANA = { test: (text) => KANA_RE.test(String(text).split('名古屋野球ユニ部').join('')) };

function loadDicts(dir) {
  const base = dir || I18N_DIR;
  const dicts = {};
  LOCALES.forEach((locale) => {
    const file = path.join(base, locale + '.json');
    dicts[locale] = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  });
  return dicts;
}

function milestoneKey(milestone) {
  return milestone.afterQuestion ? 'after:' + milestone.afterQuestion : 'before:' + milestone.beforeQuestion;
}

/** schema（日本語の正本）から、翻訳対象の文言を辞書と同じ形で取り出す。 */
function jaContent(schema) {
  const questions = {};
  schema.questions.forEach((q) => {
    const entry = { label: q.label };
    if (typeof q.helpText === 'string') entry.helpText = q.helpText;
    if (Array.isArray(q.options)) {
      entry.options = {};
      q.options.forEach((o) => { entry.options[o.id] = o.label; });
    }
    if (q.type === 'scale') {
      entry.anchors = Object.assign({}, q.anchors);
      if (q.notApplicable) entry.notApplicable = q.notApplicable.label;
    }
    questions[q.id] = entry;
  });
  const ux = schema.sectionUx || {};
  const schemaText = { milestones: {}, routes: {} };
  (ux.milestones || []).forEach((m) => { schemaText.milestones[milestoneKey(m)] = m.message; });
  if (ux.lowInterestAcknowledgement) schemaText.lowInterestAcknowledgement = ux.lowInterestAcknowledgement.message;
  Object.keys(schema.routeUx || {}).forEach((name) => {
    const route = schema.routeUx[name];
    if (route && typeof route.messageBeforeProfile === 'string') schemaText.routes[name] = { messageBeforeProfile: route.messageBeforeProfile };
  });
  return { questions, schemaText };
}

function sectionIds(schema) {
  const ids = [];
  schema.questions.forEach((q) => { if (ids.indexOf(q.section) === -1) ids.push(q.section); });
  return ids;
}

function placeholders(text) {
  return (String(text).match(/\{[A-Za-z0-9_]+\}/g) || []).sort().filter((v, i, a) => a.indexOf(v) === i).join(',');
}

function isText(value) { return typeof value === 'string' && value.trim() !== ''; }
const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

function diffKeys(expected, actual) {
  return {
    missing: expected.filter((k) => actual.indexOf(k) === -1),
    unknown: actual.filter((k) => expected.indexOf(k) === -1)
  };
}

/**
 * 辞書の完全性を検証して問題の一覧を返す（空なら OK）。
 * 問題: {locale, code, key, detail?}。code: missing / unknown / empty / placeholder_mismatch / untranslated_japanese / ja_override / invalid_dict
 */
function validate(schema, dicts) {
  const problems = [];
  const add = (locale, code, key, detail) => problems.push({ locale, code, key, detail });
  const ja = dicts.ja;
  const content = jaContent(schema);
  const sections = sectionIds(schema);
  LOCALES.forEach((locale) => { if (!isObject(dicts[locale])) add(locale, 'invalid_dict', locale + '.json'); });
  if (!isObject(ja)) return problems;

  LOCALES.forEach((locale) => {
    const dict = dicts[locale];
    if (!isObject(dict)) return;
    if (dict.locale !== locale) add(locale, 'invalid_dict', 'locale', String(dict.locale));
    diffKeys(locale === 'ja' ? ['locale', 'ui', 'sections'] : DICT_KEYS, Object.keys(dict)).unknown.forEach((k) => add(locale, locale === 'ja' && DICT_KEYS.indexOf(k) !== -1 ? 'ja_override' : 'unknown', k));
    if (locale !== 'ja') diffKeys(DICT_KEYS, Object.keys(dict)).missing.forEach((k) => add(locale, 'missing', k));

    // ui
    const ui = isObject(dict.ui) ? dict.ui : {};
    const uiDiff = diffKeys(Object.keys(ja.ui), Object.keys(ui));
    uiDiff.missing.forEach((k) => add(locale, 'missing', 'ui.' + k));
    uiDiff.unknown.forEach((k) => add(locale, 'unknown', 'ui.' + k));
    Object.keys(ui).forEach((k) => {
      if (!isText(ui[k])) { add(locale, 'empty', 'ui.' + k); return; }
      if (ja.ui[k] !== undefined && placeholders(ui[k]) !== placeholders(ja.ui[k])) add(locale, 'placeholder_mismatch', 'ui.' + k, placeholders(ja.ui[k]) + ' <> ' + placeholders(ui[k]));
      if (locale !== 'ja' && KANA.test(ui[k])) add(locale, 'untranslated_japanese', 'ui.' + k);
    });

    // sections（schema の section ID と 1:1）
    const sec = isObject(dict.sections) ? dict.sections : {};
    const secDiff = diffKeys(sections, Object.keys(sec));
    secDiff.missing.forEach((k) => add(locale, 'missing', 'sections.' + k));
    secDiff.unknown.forEach((k) => add(locale, 'unknown', 'sections.' + k));
    Object.keys(sec).forEach((k) => {
      if (!isText(sec[k])) add(locale, 'empty', 'sections.' + k);
      else if (locale !== 'ja' && KANA.test(sec[k])) add(locale, 'untranslated_japanese', 'sections.' + k);
    });
    if (locale === 'ja') return;

    // schemaText
    const st = isObject(dict.schemaText) ? dict.schemaText : {};
    diffKeys(['milestones', 'lowInterestAcknowledgement', 'routes'].filter((k) => k !== 'lowInterestAcknowledgement' || content.schemaText.lowInterestAcknowledgement), Object.keys(st)).missing.forEach((k) => add(locale, 'missing', 'schemaText.' + k));
    diffKeys(['milestones', 'lowInterestAcknowledgement', 'routes'], Object.keys(st)).unknown.forEach((k) => add(locale, 'unknown', 'schemaText.' + k));
    const ms = isObject(st.milestones) ? st.milestones : {};
    const msDiff = diffKeys(Object.keys(content.schemaText.milestones), Object.keys(ms));
    msDiff.missing.forEach((k) => add(locale, 'missing', 'schemaText.milestones.' + k));
    msDiff.unknown.forEach((k) => add(locale, 'unknown', 'schemaText.milestones.' + k));
    Object.keys(ms).forEach((k) => { if (!isText(ms[k])) add(locale, 'empty', 'schemaText.milestones.' + k); else if (KANA.test(ms[k])) add(locale, 'untranslated_japanese', 'schemaText.milestones.' + k); });
    if (content.schemaText.lowInterestAcknowledgement) {
      if (!isText(st.lowInterestAcknowledgement)) add(locale, 'empty', 'schemaText.lowInterestAcknowledgement');
      else if (KANA.test(st.lowInterestAcknowledgement)) add(locale, 'untranslated_japanese', 'schemaText.lowInterestAcknowledgement');
    } else if (st.lowInterestAcknowledgement !== undefined) add(locale, 'unknown', 'schemaText.lowInterestAcknowledgement');
    const routes = isObject(st.routes) ? st.routes : {};
    const routeDiff = diffKeys(Object.keys(content.schemaText.routes), Object.keys(routes));
    routeDiff.missing.forEach((k) => add(locale, 'missing', 'schemaText.routes.' + k));
    routeDiff.unknown.forEach((k) => add(locale, 'unknown', 'schemaText.routes.' + k));
    Object.keys(content.schemaText.routes).forEach((name) => {
      const text = routes[name] && routes[name].messageBeforeProfile;
      if (!isText(text)) { if (routes[name] || routeDiff.missing.indexOf(name) === -1) add(locale, 'empty', 'schemaText.routes.' + name + '.messageBeforeProfile'); }
      else if (KANA.test(text)) add(locale, 'untranslated_japanese', 'schemaText.routes.' + name + '.messageBeforeProfile');
    });

    // questions（question.id / option.id をキーに、schema と完全一致）
    const qs = isObject(dict.questions) ? dict.questions : {};
    const qDiff = diffKeys(Object.keys(content.questions), Object.keys(qs));
    qDiff.missing.forEach((k) => add(locale, 'missing', 'questions.' + k));
    qDiff.unknown.forEach((k) => add(locale, 'unknown', 'questions.' + k));
    Object.keys(content.questions).forEach((id) => {
      const want = content.questions[id];
      const have = qs[id];
      if (!isObject(have)) return;
      const where = 'questions.' + id;
      diffKeys(QUESTION_KEYS, Object.keys(have)).unknown.forEach((k) => add(locale, 'unknown', where + '.' + k));
      ['label', 'helpText'].forEach((field) => {
        if (want[field] === undefined) { if (have[field] !== undefined) add(locale, 'unknown', where + '.' + field); return; }
        if (!isText(have[field])) add(locale, have[field] === undefined ? 'missing' : 'empty', where + '.' + field);
        else if (KANA.test(have[field])) add(locale, 'untranslated_japanese', where + '.' + field);
      });
      // option（option ID 集合が完全一致。single_dynamic は source 設問の翻訳を使うので options を持たない）
      if (want.options === undefined) { if (have.options !== undefined) add(locale, 'unknown', where + '.options'); }
      else {
        const options = isObject(have.options) ? have.options : {};
        if (!isObject(have.options)) add(locale, 'missing', where + '.options');
        const oDiff = diffKeys(Object.keys(want.options), Object.keys(options));
        oDiff.missing.forEach((k) => { if (isObject(have.options)) add(locale, 'missing', where + '.options.' + k); });
        oDiff.unknown.forEach((k) => add(locale, 'unknown', where + '.options.' + k));
        Object.keys(options).forEach((k) => { if (!isText(options[k])) add(locale, 'empty', where + '.options.' + k); else if (KANA.test(options[k])) add(locale, 'untranslated_japanese', where + '.options.' + k); });
      }
      // scale
      if (want.anchors === undefined) { if (have.anchors !== undefined) add(locale, 'unknown', where + '.anchors'); }
      else {
        const anchors = isObject(have.anchors) ? have.anchors : {};
        if (!isObject(have.anchors)) add(locale, 'missing', where + '.anchors');
        const aDiff = diffKeys(Object.keys(want.anchors), Object.keys(anchors));
        aDiff.missing.forEach((k) => { if (isObject(have.anchors)) add(locale, 'missing', where + '.anchors.' + k); });
        aDiff.unknown.forEach((k) => add(locale, 'unknown', where + '.anchors.' + k));
        Object.keys(anchors).forEach((k) => { if (!isText(anchors[k])) add(locale, 'empty', where + '.anchors.' + k); else if (KANA.test(anchors[k])) add(locale, 'untranslated_japanese', where + '.anchors.' + k); });
      }
      if (want.notApplicable === undefined) { if (have.notApplicable !== undefined) add(locale, 'unknown', where + '.notApplicable'); }
      else if (!isText(have.notApplicable)) add(locale, have.notApplicable === undefined ? 'missing' : 'empty', where + '.notApplicable');
      else if (KANA.test(have.notApplicable)) add(locale, 'untranslated_japanese', where + '.notApplicable');
    });
  });
  return problems;
}

/** 翻訳対象の文言数（日本語正本の件数）。 */
function countTargets(schema, dicts) {
  const content = jaContent(schema);
  let questions = 0, options = 0, anchors = 0, help = 0;
  Object.keys(content.questions).forEach((id) => {
    const q = content.questions[id];
    questions += 1;
    if (q.helpText) help += 1;
    if (q.options) options += Object.keys(q.options).length;
    if (q.anchors) anchors += Object.keys(q.anchors).length + (q.notApplicable ? 1 : 0);
  });
  const ui = Object.keys(dicts.ja.ui).length;
  const sections = sectionIds(schema).length;
  const schemaText = Object.keys(content.schemaText.milestones).length + (content.schemaText.lowInterestAcknowledgement ? 1 : 0) + Object.keys(content.schemaText.routes).length;
  return { ui, sections, questions, options, anchors, help, schemaText, total: ui + sections + questions + options + anchors + help + schemaText };
}

// 結果ページ専用の UI 文言は ui の `results.` 接頭辞に置く（回答ページには配らない）。固定 UI のうち共通のもの（本文へ移動・戻るリンク・eyebrow・言語ラベル）は回答ページと同じ key を再利用する。
const RESULTS_UI_PREFIX = 'results.';
const RESULTS_SHARED_UI_KEYS = ['page.skip', 'page.back', 'page.eyebrow', 'lang.label'];

function pick(source, keys) {
  const out = {};
  keys.forEach((k) => { if (source[k] !== undefined) out[k] = source[k]; });
  return out;
}

/** Frontend 用の生成物。ja の設問文言は schema（SURVEY_SCHEMA）が正本なので含めない。結果ページ専用の `results.*` は含めない（results-i18n.generated.js へ）。 */
function renderFrontend(dicts) {
  const out = { default: DEFAULT_LOCALE, locales: LOCALES.slice(), dicts: {} };
  LOCALES.forEach((locale) => {
    const dict = dicts[locale];
    const ui = {};
    Object.keys(dict.ui).forEach((k) => { if (k.indexOf(RESULTS_UI_PREFIX) !== 0) ui[k] = dict.ui[k]; });
    out.dicts[locale] = Object.assign({}, dict, { ui });
  });
  return [
    '/*',
    ' * AUTO-GENERATED (Frontend i18n) — DO NOT EDIT.',
    ' * 正本: baseball/gas/baseball_uniform_survey/i18n/*.json（日本語の設問・選択肢は survey.schema.json が正本）',
    ' * 再生成: (baseball/gas/baseball_uniform_survey で) npm run build',
    ' * CIは `npm run build:check` で生成物との差分を検出し、`tests/i18n.test.js` が辞書の完全性を検証する。',
    ' */',
    'var SURVEY_I18N = ' + JSON.stringify(out) + ';',
    ''
  ].join('\n');
}

/** 結果ページに表示される設問（publicResultsOrder）と、single_dynamic の候補の元になる設問。region_blocks は設問ではない。 */
function resultsQuestionIds(schema) {
  const ids = [];
  const add = (id) => { if (ids.indexOf(id) === -1 && schema.questions.some((q) => q.id === id)) ids.push(id); };
  (schema.publicResultsOrder || []).forEach((id) => {
    add(id);
    const q = schema.questions.find((x) => x.id === id);
    if (q && q.type === 'single_dynamic') add(q.sourceQuestion);
  });
  return ids;
}

/**
 * 結果ページ用の生成物。回答ページと同じ i18n/*.json から、結果ページが使う分だけ（固定 UI・公開設問の label / options / anchors / notApplicable）を取り出す。
 * 設問・選択肢は question.id / option.id をキーにする。ja の設問文言は snapshot（= schema 由来）が持つので含めない。
 */
function renderResults(dicts, schema) {
  const ids = resultsQuestionIds(schema);
  const dynamic = {};
  schema.questions.forEach((q) => { if (q.type === 'single_dynamic' && ids.indexOf(q.id) !== -1) dynamic[q.id] = q.sourceQuestion; });
  const out = { default: DEFAULT_LOCALE, locales: LOCALES.slice(), dynamicSources: dynamic, dicts: {} };
  LOCALES.forEach((locale) => {
    const dict = dicts[locale];
    const uiKeys = Object.keys(dict.ui).filter((k) => k.indexOf(RESULTS_UI_PREFIX) === 0).concat(RESULTS_SHARED_UI_KEYS);
    const questions = {};
    if (locale !== DEFAULT_LOCALE) {
      ids.forEach((id) => {
        const entry = dict.questions[id];
        const picked = {};
        ['label', 'options', 'anchors', 'notApplicable'].forEach((k) => { if (entry[k] !== undefined) picked[k] = entry[k]; });
        questions[id] = picked;
      });
    }
    out.dicts[locale] = { locale, ui: pick(dict.ui, uiKeys), questions };
  });
  return [
    '/*',
    ' * AUTO-GENERATED (Results page i18n) — DO NOT EDIT.',
    ' * 正本: baseball/gas/baseball_uniform_survey/i18n/*.json（回答ページと同じ辞書。設問・選択肢は question.id / option.id で共有し、二重管理しない）',
    ' * 再生成: (baseball/gas/baseball_uniform_survey で) npm run build',
    ' * CIは `npm run build:check` で生成物との差分を検出し、`tests/results_i18n.test.js` が結果ページに必要な翻訳の完全性を検証する。',
    ' */',
    'var SURVEY_RESULTS_I18N = ' + JSON.stringify(out) + ';',
    ''
  ].join('\n');
}

module.exports = { LOCALES, DEFAULT_LOCALE, I18N_DIR, loadDicts, jaContent, validate, countTargets, renderFrontend, renderResults, resultsQuestionIds, RESULTS_UI_PREFIX, RESULTS_SHARED_UI_KEYS, sectionIds, placeholders, milestoneKey };
