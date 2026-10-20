'use strict';
// jsdom で回答ページを開くヘルパー（Issue #381）。実Googleへは接続せず、fetch は呼び出し側が差し替える。
const fs = require('fs');
const path = require('path');
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');
const schema = require('../../survey.schema.json');

const SITE = 'https://nagoya-base.github.io/snb-community/';
const REPO = path.join(__dirname, '..', '..', '..', '..', '..');
const PAGE = 'baseball/baseball-uniform-survey.html';
const ENDPOINT = 'https://script.google.com/macros/s/TEST/exec';

class LocalLoader extends ResourceLoader {
  constructor(overrides) { super(); this.overrides = overrides || {}; }
  fetch(url) {
    for (const [suffix, body] of Object.entries(this.overrides)) if (url.endsWith(suffix)) return Promise.resolve(Buffer.from(body));
    if (url.startsWith(SITE)) return Promise.resolve(fs.readFileSync(path.join(REPO, url.slice(SITE.length).split('?')[0])));
    return Promise.resolve(Buffer.from('')); // 外部（GTM等）は読み込まない
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function settle(times = 6) { for (let i = 0; i < times; i++) await tick(); }

const statusBody = (status = 'open', extra = {}) => Object.assign({ ok: true, status, schema_version: schema.schema_version, design_version: schema.design_version, survey_version: schema.survey_version }, extra);
function defaultFetch(url, options) {
  if (options.method === 'POST') return { ok: true, status: 'accepted' };
  return statusBody('open');
}

/**
 * @param {Object} opts
 * @param {string} [opts.search]   例 '?src=line'
 * @param {string} [opts.hash]     例 '#test=preview_no_submit'
 * @param {string} [opts.endpoint] config.js の endpoint（'' で未設定）
 * @param {Function} [opts.fetch]  (url, options, calls) => body | Error
 * @param {Object} [opts.storage]  sessionStorage の初期値 {key: value}
 * @param {Object} [opts.overrides] 読み込むファイルの差し替え {末尾一致するURL: 本文}（辞書の欠落テストなど）
 * @param {Object} [opts.local]    localStorage の初期値 {key: value}
 * @param {string[]} [opts.languages] navigator.languages（既定 ['ja-JP','ja']）
 */
async function openPage(opts = {}) {
  const endpoint = opts.endpoint === undefined ? ENDPOINT : opts.endpoint;
  const calls = [];
  const virtualConsole = new VirtualConsole();
  const errors = [];
  virtualConsole.on('jsdomError', (e) => errors.push(e));
  const dom = new JSDOM(fs.readFileSync(path.join(REPO, PAGE), 'utf8'), {
    url: SITE + PAGE + (opts.search || '') + (opts.hash || ''),
    runScripts: 'dangerously',
    resources: new LocalLoader(Object.assign({ 'config.js': `window.BASEBALL_UNIFORM_SURVEY_CONFIG = { endpoint: ${JSON.stringify(endpoint)} };` }, opts.overrides || {})),
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      window.scrollTo = () => {};
      window.Element.prototype.scrollIntoView = () => {};
      Object.entries(opts.storage || {}).forEach(([k, v]) => window.sessionStorage.setItem(k, v));
      Object.entries(opts.local || {}).forEach(([k, v]) => window.localStorage.setItem(k, v));
      // 既定は日本語ブラウザ（jsdom の既定 en-US だと初期言語が en になる）。言語判定のテストは opts.languages で指定する。
      const languages = opts.languages || ['ja-JP', 'ja'];
      Object.defineProperty(window.navigator, 'languages', { value: languages, configurable: true });
      Object.defineProperty(window.navigator, 'language', { value: languages[0], configurable: true });
      window.fetch = (url, options) => {
        calls.push({ url, options: options || {} });
        const handler = opts.fetch || defaultFetch;
        return Promise.resolve(handler(url, options || {}, calls)).then((r) => {
          if (r instanceof Error) throw r;
          return { ok: true, json: () => Promise.resolve(r) };
        });
      };
    }
  });
  await new Promise((resolve) => dom.window.addEventListener('load', resolve));
  await settle();
  return { dom, window: dom.window, document: dom.window.document, calls, errors, events: () => gaEvents(dom.window) };
}

/** window.dataLayer に積まれた GA4 イベント（['event', name, params]）。 */
function gaEvents(window) {
  return (window.dataLayer || []).map((args) => Array.from(args)).filter((a) => a[0] === 'event').map((a) => ({ name: a[1], params: a[2] }));
}

const fieldset = (document, id) => document.querySelector(`fieldset[data-qid="${id}"]`);
const visibleIds = (document) => Array.from(document.querySelectorAll('fieldset[data-qid]')).map((f) => f.getAttribute('data-qid'));
const pageTitle = (document) => { const h = document.getElementById('bus-page-title'); return h ? h.textContent : null; };
const progressText = (document) => (document.getElementById('bus-progress-text') || { textContent: '' }).textContent;
const bodyText = (document) => document.getElementById('bus-app').textContent;

function fire(window, node, type) { node.dispatchEvent(new window.Event(type, { bubbles: true })); }

/** UI 操作で 1 設問に回答する。value: string | string[]（text は文字列）。other: 「その他」本文。 */
function answer(env, id, value, other) {
  const { document, window } = env;
  const fs_ = fieldset(document, id);
  if (!fs_) throw new Error(`設問が表示されていません: ${id}`);
  // 自由記述は textarea、1行入力（inputStyle=single_line）は設問直下の input[type=text]（「その他」入力欄は .bus-other 内）。
  const textarea = fs_.querySelector('textarea') || Array.from(fs_.children).find((c) => c.tagName === 'INPUT' && c.type === 'text');
  if (textarea) { textarea.value = value; fire(window, textarea, 'input'); return; }
  const wanted = Array.isArray(value) ? value : [value];
  // 冪等：指定した状態にそろえる（複数選択は指定外を外す）。
  Array.from(fs_.querySelectorAll('input')).filter((i) => i.type !== 'text').forEach((input) => {
    const desired = wanted.includes(input.value);
    if (input.type === 'checkbox' ? input.checked !== desired : desired && !input.checked) input.click();
  });
  wanted.forEach((v) => {
    if (!Array.from(fs_.querySelectorAll('input')).some((i) => i.value === v && i.type !== 'text')) throw new Error(`選択肢がありません: ${id}=${v}`);
  });
  if (other !== undefined) {
    const box = fs_.querySelector('.bus-other input');
    box.value = other;
    fire(window, box, 'input');
  }
}

const click = (document, id) => document.getElementById(id).click();
const start = async (env) => { click(env.document, 'bus-next'); await settle(); };
const next = async (env) => { click(env.document, 'bus-next'); await settle(); };

/** 現在の section の visible 設問に、最小の有効回答（先頭 option）を入れる。overrides で個別指定。 */
function fillPage(env, overrides = {}, others = {}) {
  // 回答で新しい設問が現れるため、表示が安定するまで繰り返す。
  for (let round = 0; round < 6; round++) {
    const before = visibleIds(env.document).join(',');
    fillOnce(env, overrides, others);
    if (visibleIds(env.document).join(',') === before) return;
  }
}

function fillOnce(env, overrides, others) {
  const core = env.window.SurveyCore;
  const sch = env.window.SURVEY_SCHEMA;
  visibleIds(env.document).forEach((id) => {
    const q = core.getQuestion(sch, id);
    if (Object.prototype.hasOwnProperty.call(overrides, id)) {
      if (overrides[id] !== undefined) answer(env, id, overrides[id], others[id]);
      return;
    }
    if (!q.required) return;
    const fs_ = fieldset(env.document, id);
    if (!fs_) return;
    const inputs = Array.from(fs_.querySelectorAll('input')).filter((i) => i.type !== 'text');
    const already = inputs.some((i) => i.checked);
    if (already) return;
    const pick = inputs.find((i) => {
      const opt = (q.options || []).find((o) => o.id === i.value);
      return !(opt && (opt.other || opt.exclusive));
    }) || inputs[0];
    if (pick) pick.click();
  });
}

/** intro から review まで進める。各ページで fillPage を実行。戻り値は通過した section 見出し。 */
async function walkToReview(env, overrides = {}, others = {}) {
  const titles = [];
  await start(env);
  for (let guard = 0; guard < 40; guard++) {
    if (env.document.getElementById('bus-questions') === null) break;
    titles.push(pageTitle(env.document));
    fillPage(env, overrides, others);
    await next(env);
  }
  return titles;
}

module.exports = { SITE, REPO, PAGE, ENDPOINT, openPage, settle, statusBody, gaEvents, fieldset, visibleIds, pageTitle, progressText, bodyText, answer, click, start, next, fillPage, walkToReview, schema, fire };
