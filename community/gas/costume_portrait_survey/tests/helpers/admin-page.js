'use strict';
// 管理ダッシュボード（GitHub Pages側）を jsdom で開く。Google Identity Services と Admin GAS（fetch）はフェイク。
const fs = require('fs');
const path = require('path');
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');
const { settle, SITE, REPO } = require('./dom');

const PAGE = 'community/costume-portrait-survey-admin.html';
const ENDPOINT = 'https://script.google.com/macros/s/ADMIN-TEST/exec';
const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';

class Loader extends ResourceLoader {
  constructor(configJs) { super(); this.configJs = configJs; }
  fetch(url) {
    if (url.endsWith('costume-portrait-survey-admin/config.js') && this.configJs !== null) return Promise.resolve(Buffer.from(this.configJs));
    if (url.startsWith(SITE)) return Promise.resolve(fs.readFileSync(path.join(REPO, url.slice(SITE.length).split('?')[0])));
    return Promise.resolve(Buffer.from(''));
  }
}

/**
 * @param {Object} opts
 * @param {Function} [opts.api]    (body, call) => レスポンスJSON（Admin GAS doPost の代わり）。Errorを返すとネットワーク失敗。
 * @param {Object|null} [opts.config]  null なら実ファイル(config.js)をそのまま使う
 * @param {boolean} [opts.gis=true] false ならGISフェイクを用意せず、script読込にも失敗させない（空のまま）
 */
async function openAdminPage(opts = {}) {
  const config = opts.config === undefined ? { endpoint: ENDPOINT, googleClientId: CLIENT_ID } : opts.config;
  const calls = [];
  const consoleLines = [];
  const gis = { cfg: null, rendered: 0, disabled: 0 };
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => consoleLines.push(String(e && e.message)));
  ['log', 'info', 'warn', 'error', 'debug'].forEach((m) => virtualConsole.on(m, (...args) => consoleLines.push(args.join(' '))));
  const dom = new JSDOM(fs.readFileSync(path.join(REPO, PAGE), 'utf8'), {
    url: SITE + PAGE,
    runScripts: 'dangerously',
    resources: new Loader(config === null ? null : 'window.COSTUME_PORTRAIT_ADMIN_CONFIG = ' + JSON.stringify(config) + ';'),
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      if (opts.gis !== false) {
        window.google = { accounts: { id: {
          initialize(cfg) { gis.cfg = cfg; },
          renderButton(el) { gis.rendered += 1; const b = window.document.createElement('div'); b.id = 'fake-google-button'; el.appendChild(b); },
          disableAutoSelect() { gis.disabled += 1; }
        } } };
      }
      window.fetch = (url, options) => {
        const call = { url, options: options || {}, body: options && options.body ? JSON.parse(options.body) : null };
        calls.push(call);
        const result = (opts.api || (() => ({ ok: false, error: 'server_error' })))(call.body, call);
        if (result instanceof Error) return Promise.reject(result);
        return Promise.resolve({ ok: true, json: () => Promise.resolve(result) });
      };
    }
  });
  await new Promise((resolve) => dom.window.addEventListener('load', resolve));
  await settle();
  const w = dom.window;
  const d = w.document;
  return {
    dom, w, d, calls, gis, consoleLines,
    login: async (credential) => { gis.cfg.callback({ credential }); await settle(); },
    visible: (id) => !d.getElementById(id).hidden,
    text: (id) => d.getElementById(id).textContent
  };
}

module.exports = { openAdminPage, ENDPOINT, CLIENT_ID, PAGE };
