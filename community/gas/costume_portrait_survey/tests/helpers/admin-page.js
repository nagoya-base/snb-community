'use strict';
// 管理ダッシュボード（Admin GAS 内HTML）を jsdom で開く。google.script.run はフェイク（Admin GAS 関数を直接呼ぶ）。
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { settle, REPO } = require('./dom');

const ADMIN_DIR = path.join(REPO, 'community/gas/costume_portrait_survey/admin');

/** doGet() と同じ展開（<?!= include('X') ?>）。 */
function renderDashboardHtml() {
  const read = (name) => fs.readFileSync(path.join(ADMIN_DIR, name + '.html'), 'utf8');
  return read('Dashboard').replace(/<\?!=\s*include\('([A-Za-z]+)'\)\s*\?>/g, (_m, name) => read(name));
}

/**
 * @param {Object} opts
 * @param {Object} [opts.server]  { 関数名: (...args) => 戻り値 | Error }。Errorなら withFailureHandler へ。
 */
async function openAdminPage(opts = {}) {
  const calls = [];
  const consoleLines = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => consoleLines.push(String(e && e.message)));
  ['log', 'info', 'warn', 'error', 'debug'].forEach((m) => virtualConsole.on(m, (...args) => consoleLines.push(args.join(' '))));
  const server = opts.server || {};
  const dom = new JSDOM(renderDashboardHtml(), {
    url: 'https://script.google.com/macros/s/ADMIN-TEST/exec',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      const makeRunner = (success, failure) => new Proxy({}, {
        get(_t, prop) {
          if (prop === 'withSuccessHandler') return (fn) => makeRunner(fn, failure);
          if (prop === 'withFailureHandler') return (fn) => makeRunner(success, fn);
          return (...args) => {
            calls.push({ name: String(prop), args });
            let result;
            try { result = server[prop] ? server[prop](...args) : new Error('no such function'); } catch (e) { result = e instanceof Error ? e : new Error(String(e)); }
            // 実際の google.script.run と同様、値はJSONで受け渡し、非同期で返る。
            setTimeout(() => {
              if (result instanceof Error) { if (failure) failure(result); } else if (success) success(JSON.parse(JSON.stringify(result)));
            }, 0);
          };
        }
      });
      window.google = { script: { run: makeRunner(null, null) } };
    }
  });
  await new Promise((resolve) => dom.window.addEventListener('load', resolve));
  await settle();
  const w = dom.window;
  const d = w.document;
  return { dom, w, d, calls, consoleLines, text: (id) => d.getElementById(id).textContent };
}

module.exports = { openAdminPage, renderDashboardHtml };
