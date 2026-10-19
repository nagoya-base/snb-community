'use strict';
// Admin GAS（Issue #382）の最小フェイク。実Googleへは接続しない。Spreadsheet への書き込み API は呼ばれたら失敗する（read-only の検証）。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { header } = require('./fixtures');

const ROOT = path.join(__dirname, '..', '..');

function createAdminEnv(rows, options = {}) {
  const env = { writes: [], reads: 0, props: new Map(), logs: [], htmlOutputs: [] };
  const values = [options.header || header()].concat(rows.map((row) => (options.header || header()).map((name) => (row[name] === undefined ? '' : row[name]))));
  const deny = (name) => () => { env.writes.push(name); throw new Error('write_not_allowed: ' + name); };
  const sheet = {
    getLastRow: () => values.length,
    getLastColumn: () => values[0].length,
    getRange: (row, col, numRows, numCols) => {
      env.reads++;
      return {
        getValues: () => values.slice(row - 1, row - 1 + numRows).map((line) => line.slice(col - 1, col - 1 + numCols)),
        setValue: deny('setValue'), setValues: deny('setValues'), clear: deny('clear'), clearContent: deny('clearContent'), deleteCells: deny('deleteCells')
      };
    },
    appendRow: deny('appendRow'), deleteRow: deny('deleteRow'), deleteRows: deny('deleteRows'), insertRowAfter: deny('insertRowAfter'), clear: deny('clear')
  };
  env.sheet = sheet;
  const properties = {
    getProperty: (k) => (env.props.has(k) ? env.props.get(k) : null),
    setProperty: (k, v) => { env.props.set(k, String(v)); }
  };
  env.sandbox = {
    console: { log: (m) => env.logs.push(String(m)), error: (m) => env.logs.push(String(m)) },
    PropertiesService: { getScriptProperties: () => properties },
    SpreadsheetApp: {
      openById: (id) => ({ getSheetByName: (name) => (name === 'responses' && id === 'responses-sheet-id' ? sheet : null) })
    },
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
