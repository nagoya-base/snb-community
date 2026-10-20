'use strict';
// 公開結果ページ（Issue #382 / #414）を jsdom で開くヘルパー。snapshot を fetch の応答として返し、実Googleへは接続しない。
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const REPO = path.join(__dirname, '..', '..', '..', '..', '..');
const SITE = 'https://nagoya-base.github.io/snb-community/';
const PAGE = 'baseball/baseball-uniform-survey-results.html';
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
const resultsJs = read('baseball/baseball-uniform-survey-results/results.js');
const resultsI18nJs = read('baseball/baseball-uniform-survey-results/results-i18n.generated.js');
const localeJs = read('baseball/baseball-uniform-survey/locale.js');

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const settle = async (times = 6) => { for (let i = 0; i < times; i++) await tick(); };

/**
 * @param {Object|null} snapshot
 * @param {Function} [fetchImpl]
 * @param {Object} [options]
 * @param {string[]} [options.languages] navigator.languages（既定 ['ja-JP']）
 * @param {Object} [options.local]       localStorage の初期値
 * @param {string} [options.search]      例 '?src=line'
 * @param {string} [options.endpoint]   Public GAS の endpoint（config.js 相当。指定時だけ dynamic snapshot を試す）
 * @param {string} [options.i18n]        results-i18n.generated.js の差し替え本文（翻訳欠落テスト用）
 */
async function openResults(snapshot, fetchImpl, options) {
  const opts = options || {};
  const calls = [];
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => errors.push(e));
  const dom = new JSDOM(read(PAGE).replace(/<script src="[^"]*"><\/script>/g, ''), {
    url: SITE + PAGE + (opts.search || ''),
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole
  });
  const { window } = dom;
  window.fetch = (url) => {
    calls.push(String(url));
    if (fetchImpl) return fetchImpl(url);
    return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(JSON.stringify(snapshot))) });
  };
  Object.defineProperty(window.navigator, 'languages', { value: opts.languages || ['ja-JP'], configurable: true });
  if (opts.endpoint) window.BASEBALL_UNIFORM_SURVEY_CONFIG = { endpoint: opts.endpoint };
  Object.keys(opts.local || {}).forEach((k) => window.localStorage.setItem(k, opts.local[k]));
  window.eval(opts.i18n === undefined ? resultsI18nJs : opts.i18n);
  window.eval(localeJs);
  window.eval(resultsJs);
  await settle();
  return { window, document: window.document, calls, errors, text: () => window.document.getElementById('bur-app').textContent };
}

module.exports = { openResults, settle, REPO, SITE, PAGE, read };
