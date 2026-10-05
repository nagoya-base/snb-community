'use strict';
const SV = require('../../survey.schema.json').schema_version;
const fs = require('fs');
const path = require('path');
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');

const SITE = 'https://nagoya-base.github.io/snb-community/';
const REPO = path.join(__dirname, '..', '..', '..', '..', '..');

class LocalLoader extends ResourceLoader {
  constructor(overrides) { super(); this.overrides = overrides || {}; }
  fetch(url) {
    for (const [suffix, body] of Object.entries(this.overrides)) if (url.endsWith(suffix)) return Promise.resolve(Buffer.from(body));
    if (url.startsWith(SITE)) {
      const file = path.join(REPO, url.slice(SITE.length).split('?')[0]);
      return Promise.resolve(fs.readFileSync(file));
    }
    return Promise.resolve(Buffer.from('')); // 外部（GTM等）は読み込まない
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function settle(times = 6) { for (let i = 0; i < times; i++) await tick(); }

/**
 * @param {Object} opts
 * @param {string} [opts.page]      'costume-portrait-survey.html' | 'costume-portrait-survey-results.html'
 * @param {string} [opts.search]    例 '?test=1'
 * @param {string} [opts.endpoint]  config.js の endpoint
 * @param {Function} [opts.fetch]   (url, options) => Promise<{ok, json}> | 値
 */
async function openPage(opts = {}) {
  const page = opts.page || 'community/costume-portrait-survey.html';
  const endpoint = opts.endpoint === undefined ? 'https://script.google.com/macros/s/TEST/exec' : opts.endpoint;
  const calls = [];
  const virtualConsole = new VirtualConsole();
  const errors = [];
  virtualConsole.on('jsdomError', (e) => errors.push(e));
  const dom = new JSDOM(fs.readFileSync(path.join(REPO, page), 'utf8'), {
    url: SITE + page + (opts.search || ''),
    runScripts: 'dangerously',
    resources: new LocalLoader({ 'config.js': `window.COSTUME_PORTRAIT_CONFIG = { endpoint: ${JSON.stringify(endpoint)} };` }),
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      window.scrollTo = () => {};
      window.Element.prototype.scrollIntoView = () => {};
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

function defaultFetch(url, options) {
  if (options.method === 'POST') return { ok: true, status: 'accepted' };
  return { ok: true, status: 'open', answered: false, schema_version: SV, survey_version: '2026-10' };
}

/** window.dataLayer に積まれた GA4 イベント（['event', name, params]）。 */
function gaEvents(window) {
  return (window.dataLayer || []).map((args) => Array.from(args)).filter((a) => a[0] === 'event').map((a) => ({ name: a[1], params: a[2] }));
}

const q = (document, id) => document.querySelector(`fieldset[data-qid="${id}"]`);
const visibleFieldsets = (document) => Array.from(document.querySelectorAll('fieldset[data-qid]')).filter((f) => !f.hidden);
const pageTitle = (document) => { const h = document.querySelector('#cp-page h2'); return h ? h.textContent : null; };
const progressText = (document) => (document.getElementById('cp-progress-text') || { textContent: '' }).textContent;

function choose(document, id, value) {
  const fs_ = q(document, id);
  const input = Array.from(fs_.querySelectorAll('input')).find((i) => i.value === value);
  if (!input) throw new Error(`no option ${id}.${value}`);
  input.click();
  return input;
}

function setText(window, element, value) {
  element.value = value;
  element.dispatchEvent(new window.Event('input', { bubbles: true }));
}

/** 表示中の必須設問のうち未回答のものへ、先頭の通常選択肢（other・排他を除く）を回答する。 */
function fillVisible(document) {
  for (let pass = 0; pass < 4; pass++) {
    visibleFieldsets(document).forEach((fs_) => {
      if (fs_.querySelector('textarea')) return;
      const matrixRows = fs_.querySelectorAll('.cp-matrix-row');
      if (matrixRows.length) {
        matrixRows.forEach((row) => { const radios = row.querySelectorAll('input'); if (!Array.from(radios).some((r) => r.checked)) radios[2].click(); });
        return;
      }
      const inputs = Array.from(fs_.querySelectorAll('.cp-options input'));
      if (inputs.some((i) => i.checked)) return;
      const first = inputs.find((i) => i.value !== 'other' && !['none', 'dont_know', 'no_support'].includes(i.value)) || inputs[0];
      first.click();
    });
  }
}

const next = (document) => document.getElementById('cp-next').click();
const back = (document) => document.getElementById('cp-back').click();

/** 年齢確認 → 全セクションを順に通過して「送信前の確認」まで進む。通過したセクション名を返す。 */
async function advanceToReview(document, customize) {
  document.getElementById('cp-age').click();
  next(document);
  const titles = [];
  for (let i = 0; i < 30; i++) {
    const title = pageTitle(document);
    if (title === '送信前の確認') return titles;
    titles.push(title);
    fillVisible(document);
    if (customize) customize(title, document);
    next(document);
  }
  throw new Error('did not reach review: ' + titles.join(','));
}

module.exports = { openPage, settle, tick, q, visibleFieldsets, pageTitle, progressText, choose, setText, fillVisible, next, back, advanceToReview, gaEvents, SITE, REPO };
