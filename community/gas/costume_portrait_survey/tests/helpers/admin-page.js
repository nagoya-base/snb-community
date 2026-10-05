'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { ROOT } = require('./gas-env');

function read(name) { return fs.readFileSync(path.join(ROOT, 'admin', name), 'utf8'); }

function buildPage(payload) {
  const html = read('Dashboard.html')
    .replace("<?!= include('DashboardStyles'); ?>", '')
    .replace("<?!= include('DashboardScript'); ?>", '');
  const script = read('DashboardScript.html').replace(/^<script>/, '').replace(/<\/script>\s*$/, '');
  const calls = [];
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  const w = dom.window;
  w.google = { script: { run: {
    withSuccessHandler(ok) { this.ok = ok; return this; },
    withFailureHandler(ng) { this.ng = ng; return this; },
    getDashboardData() { calls.push('dashboard'); this.ok(payload); },
    getCrosstabData(r, c) { calls.push(['cross', r, c]); }
  } } };
  w.eval(script);
  return { w, calls };
}

module.exports = { buildPage, read };
