'use strict';

// Code.gs（サーバー側・正本）とScript.html（クライアント側・表示用コピー）の選択肢配列が
// 完全に一致しているかを検証する。設問・選択肢を変更したとき、片方だけ更新してしまう事故を
// 検出するための最重要テスト。

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const CODE_PATH = path.join(__dirname, '..', 'Code.gs');
const SCRIPT_HTML_PATH = path.join(__dirname, '..', 'Script.html');

const code = fs.readFileSync(CODE_PATH, 'utf8');
const sandboxServer = {
  PropertiesService: {}, SpreadsheetApp: {}, LockService: {},
  Utilities: { DigestAlgorithm: {}, Charset: {} }, HtmlService: {}, Logger: { log: () => {} }
};
vm.createContext(sandboxServer);
vm.runInContext(code, sandboxServer);

const scriptHtml = fs.readFileSync(SCRIPT_HTML_PATH, 'utf8');
const match = scriptHtml.match(/<script>([\s\S]*)<\/script>/);
if (!match) throw new Error('Script.html: <script>タグが見つかりません');
const clientCode = match[1];

// クライアント側はIIFEでスコープが閉じているため、DOMContentLoaded登録の直前に
// 配列をwindowへ書き出すコードを差し込んで評価する。
const names = [
  'PREFECTURES', 'AICHI_AREA_OPTIONS', 'AGE_OPTIONS', 'CLOTHING_OPTIONS',
  'FREQUENCY_OPTIONS', 'PRICE_OPTIONS', 'GROUP_SIZE_OPTIONS', 'FORMAT_OPTIONS',
  'EVENT_AWARENESS_OPTIONS', 'BARRIER_OPTIONS', 'HELPFUL_INFO_OPTIONS',
  'ATMOSPHERE_OPTIONS', 'HYPOTHETICAL_INTENT_OPTIONS', 'GAP_OPTIONS', 'GAP_REASON_OPTIONS'
];
const exportCode = clientCode.replace(
  "document.addEventListener('DOMContentLoaded', function () {",
  'window.__EXPORTS__ = { ' + names.join(', ') + ' };\n' +
    "  document.addEventListener('DOMContentLoaded', function () {"
);

const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'dangerously' });
// このテストは配列の中身だけを見ればよく#survey-form等の実DOMは用意していないため、
// DOMContentLoaded後のUI初期化コード（init()）が投げる無害な例外を出力に出さないよう抑止する。
dom.window.addEventListener('error', (e) => { e.preventDefault(); });
dom.window.eval(exportCode);
const client = dom.window.__EXPORTS__;

let allOk = true;
names.forEach((name) => {
  const s = sandboxServer[name];
  const c = client[name];
  if (!Array.isArray(s) || !Array.isArray(c)) {
    console.error('MISSING', name, 'server=', s, 'client=', c);
    allOk = false;
    return;
  }
  const same = JSON.stringify(s) === JSON.stringify(c);
  console.log((same ? 'OK ' : 'MISMATCH ') + name + ' server=' + s.length + ' client=' + c.length);
  if (!same) {
    allOk = false;
    const sSet = new Set(s);
    const cSet = new Set(c);
    console.log('  in Code.gs but not Script.html:', s.filter((x) => !cSet.has(x)));
    console.log('  in Script.html but not Code.gs:', c.filter((x) => !sSet.has(x)));
  }
});

if (allOk) {
  console.log('\ncompare_arrays.js: ALL ARRAYS MATCH');
} else {
  console.error('\ncompare_arrays.js: MISMATCH FOUND — Code.gsとScript.htmlの選択肢を同時に修正してください');
  process.exitCode = 1;
}
