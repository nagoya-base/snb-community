'use strict';
// Admin GAS（Issue #382）の最小フェイク。実Googleへは接続しない。SpreadsheetApp は sandbox に存在しない（呼べば ReferenceError）。Sheets API の書き込みは呼ばれたら失敗する（read-only の検証）。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { header } = require('./fixtures');

const ROOT = path.join(__dirname, '..', '..');

function createAdminEnv(rows, options = {}) {
  const env = { writes: [], reads: 0, props: new Map(), logs: [], htmlOutputs: [], renderOptions: [], ranges: [] };
  let values = [options.header || header()].concat(rows.map((row) => (options.header || header()).map((name) => (row[name] === undefined ? '' : row[name]))));
  if (options.transform) values = options.transform(values);
  const deny = (name) => () => { env.writes.push(name); throw new Error('write_not_allowed: ' + name); };
  // Sheets API は末尾の空セル・空行を省く（実挙動の再現）。
  const trimmed = values.map((line) => { const out = line.slice(); while (!options.noTrim && out.length && out[out.length - 1] === '') out.pop(); return out; });
  while (!options.noTrim && trimmed.length && !trimmed[trimmed.length - 1].length) trimmed.pop();
  env.calls = [];
  const Sheets = {
    Spreadsheets: {
      get: (id, opts) => {
        env.calls.push('Spreadsheets.get');
        if (id !== 'responses-sheet-id') throw new Error('not_found');
        const extra = options.publicSnapshotGrid ? [{ properties: { title: 'public_snapshot' } }] : [];
        return { sheets: [{ properties: { title: options.sheetTitle || 'responses' } }].concat(extra) };
      },
      batchUpdate: deny('Spreadsheets.batchUpdate'),
      create: deny('Spreadsheets.create'),
      Values: {
        get: (id, range, opts) => {
          env.reads++;
          env.calls.push('Values.get ' + range);
          if (id !== 'responses-sheet-id') throw new Error('not_found');
          if (range === "'public_snapshot'") {
            env.calls.push('public_snapshot');
            return { range, majorDimension: 'ROWS', values: (options.publicSnapshotGrid || []).map((line) => line.slice()) };
          }
          const render = opts && opts.valueRenderOption;
          env.renderOptions.push(render);
          // FORMATTED_VALUE は画面の表示値。options.displayRows（行オブジェクト）があればそれを表示値として返す。
          let source = trimmed;
          if (render === 'FORMATTED_VALUE') {
            const base = options.header || header();
            const shown = options.displayRows
              ? [base].concat(options.displayRows.map((row) => base.map((name) => (row[name] === undefined ? '' : row[name]))))
              : values;
            source = shown.map((line) => { const out = line.map((cell) => (typeof cell === 'number' ? String(cell) : cell)); while (out.length && out[out.length - 1] === '') out.pop(); return out; });
          }
          // 'responses'!B:D のような列範囲だけ返す（Sheets API 同様、範囲の左端が先頭列になる）。
          const columns = /!([A-Z]+):([A-Z]+)$/.exec(range);
          if (columns) {
            const index = (letters) => letters.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
            const first = index(columns[1]);
            const last = index(columns[2]);
            env.ranges.push(range);
            source = source.map((line) => { const out = line.slice(first, last + 1); while (out.length && out[out.length - 1] === '') out.pop(); return out; });
          }
          return { range, majorDimension: 'ROWS', values: source.map((line) => line.slice()) };
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
    Utilities: {
      computeDigest: (_alg, input) => Array.from(require('crypto').createHash('sha256').update(input, 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)),
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' }
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
