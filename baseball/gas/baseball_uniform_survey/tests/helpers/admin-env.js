'use strict';
// Admin GAS（Issue #382）の最小フェイク。実Googleへは接続しない。SpreadsheetApp は sandbox に存在しない（呼べば ReferenceError）。Sheets API の書き込みは呼ばれたら失敗する（read-only の検証）。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { header } = require('./fixtures');

const ROOT = path.join(__dirname, '..', '..');

function createAdminEnv(rows, options = {}) {
  const env = { writes: [], reads: 0, props: new Map(), logs: [], htmlOutputs: [] };
  const values = [options.header || header()].concat(rows.map((row) => (options.header || header()).map((name) => (row[name] === undefined ? '' : row[name]))));
  const deny = (name) => () => { env.writes.push(name); throw new Error('write_not_allowed: ' + name); };
  // Sheets API は末尾の空セル・空行を省く（実挙動の再現）。
  const trimmed = values.map((line) => { const out = line.slice(); while (out.length && out[out.length - 1] === '') out.pop(); return out; });
  while (trimmed.length && !trimmed[trimmed.length - 1].length) trimmed.pop();
  env.calls = [];
  const Sheets = {
    Spreadsheets: {
      get: (id, opts) => {
        env.calls.push('Spreadsheets.get');
        if (id !== 'responses-sheet-id') throw new Error('not_found');
        return { sheets: [{ properties: { title: options.sheetTitle || 'responses' } }] };
      },
      batchUpdate: deny('Spreadsheets.batchUpdate'),
      create: deny('Spreadsheets.create'),
      Values: {
        get: (id, range, opts) => {
          env.reads++;
          env.calls.push('Values.get ' + range);
          if (id !== 'responses-sheet-id') throw new Error('not_found');
          return { range, majorDimension: 'ROWS', values: trimmed.map((line) => line.slice()) };
        },
        update: deny('Values.update'), append: deny('Values.append'), clear: deny('Values.clear'),
        batchUpdate: deny('Values.batchUpdate'), batchClear: deny('Values.batchClear')
      }
    }
  };
  const properties = {
    getProperty: (k) => (env.props.has(k) ? env.props.get(k) : null),
    setProperty: (k, v) => { env.props.set(k, String(v)); }
  };
  env.sandbox = {
    console: { log: (m) => env.logs.push(String(m)), error: (m) => env.logs.push(String(m)) },
    PropertiesService: { getScriptProperties: () => properties },
    Sheets,
    HtmlService: {
      XFrameOptionsMode: { DEFAULT: 'DEFAULT' },
      createHtmlOutputFromFile: (name) => {
        const out = { name, title: null, setTitle(t) { this.title = t; return this; }, addMetaTag() { return this; }, setXFrameOptionsMode() { return this; } };
        env.htmlOutputs.push(out);
        return out;
      }
    }
  };
  env.props.set('RESPONSES_SPREADSHEET_ID', 'responses-sheet-id');
  const ctx = vm.createContext(env.sandbox);
  const dir = path.join(ROOT, 'admin');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.gs')).sort((a, b) => (a === 'SurveyGenerated.gs' ? -1 : b === 'SurveyGenerated.gs' ? 1 : a.localeCompare(b)));
  files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f }));
  env.ctx = ctx;
  return env;
}

module.exports = { ROOT, createAdminEnv };
