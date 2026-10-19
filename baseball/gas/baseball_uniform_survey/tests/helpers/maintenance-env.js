'use strict';
// maintenance GAS（Issue #383）の最小フェイク。実Googleへは接続しない。
// env.events に永続化操作を発生順に記録する（marker が最後であること・dry-run が非破壊であることの検証用）。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { header } = require('./fixtures');

const ROOT = path.join(__dirname, '..', '..');
const RESPONSES_ID = 'responses-sheet-id';

const RECEPTION = { opens_at: '2026-11-01T00:00:00+09:00', closes_at: '2026-11-30T23:59:59+09:00', timezone: 'Asia/Tokyo' };
const AFTER_CLOSE = new Date('2026-12-05T00:00:00+09:00');
const BEFORE_CLOSE = new Date('2026-11-20T00:00:00+09:00');

class FakeSheet {
  constructor(env, name, values) { this.env = env; this.name = name; this.values = values || []; }
  record(op) { this.env.events.push('sheet:' + this.name + ':' + op); }
  getLastRow() { return this.values.length; }
  getLastColumn() { return this.values.reduce((m, r) => Math.max(m, r.length), 0); }
  getRange(row, col, numRows, numCols) {
    const sheet = this;
    return {
      getValues: () => {
        const out = [];
        for (let r = 0; r < numRows; r++) {
          const line = [];
          for (let c = 0; c < numCols; c++) {
            const v = (sheet.values[row - 1 + r] || [])[col - 1 + c];
            line.push(v === undefined ? '' : v);
          }
          out.push(line);
        }
        return out;
      },
      setValues: (vals) => {
        sheet.record('setValues');
        if (sheet.env.options.failSheetWrite === sheet.name) throw new Error('sheet_write_failed');
        vals.forEach((line, r) => line.forEach((v, c) => {
          while (sheet.values.length <= row - 1 + r) sheet.values.push([]);
          sheet.values[row - 1 + r][col - 1 + c] = v;
        }));
      },
      setNumberFormat: () => { sheet.record('setNumberFormat'); }
    };
  }
  deleteRows(start, count) {
    this.record('deleteRows');
    if (this.env.options.failDeleteRows === this.name) throw new Error('delete_failed');
    if (this.env.options.noopDeleteRows === this.name) return;
    this.values.splice(start - 1, count);
  }
  clear() { this.record('clear'); this.values = []; }
}

function createMaintenanceEnv(rows, options = {}) {
  const env = { options, events: [], logs: [], props: new Map(), sheets: new Map(), now: options.now || AFTER_CLOSE, htmlOutputs: [] };
  const head = options.header || header();
  const lines = [head].concat((rows || []).map((row) => head.map((name) => (row[name] === undefined ? '' : row[name]))));
  if (options.noResponsesSheet !== true) env.sheets.set('responses', new FakeSheet(env, 'responses', lines));
  (options.extraSheets || []).forEach((name) => env.sheets.set(name, new FakeSheet(env, name, [['x'], ['derived']])));

  const spreadsheet = {
    getSheetByName: (name) => env.sheets.get(name) || null,
    insertSheet: (name) => { env.events.push('spreadsheet:insertSheet:' + name); const s = new FakeSheet(env, name, []); env.sheets.set(name, s); return s; },
    deleteSheet: (sheet) => { env.events.push('spreadsheet:deleteSheet:' + sheet.name); env.sheets.delete(sheet.name); }
  };
  const properties = {
    getProperty: (k) => (env.props.has(k) ? env.props.get(k) : null),
    setProperty: (k, v) => {
      env.events.push('property:' + k);
      if (options.failSetProperty === k) throw new Error('property_write_failed');
      env.props.set(k, String(v));
    }
  };
  class FakeDate extends Date {
    constructor(...args) { if (args.length === 0) super(env.now.getTime()); else super(...args); }
    static now() { return env.now.getTime(); }
  }
  env.sandbox = {
    Date: FakeDate,
    console: { log: (m) => env.logs.push(String(m)), error: (m) => env.logs.push(String(m)) },
    PropertiesService: { getScriptProperties: () => properties },
    SpreadsheetApp: {
      openById: (id) => { if (id !== RESPONSES_ID) throw new Error('not_found'); return spreadsheet; },
      flush: () => {}
    },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => { env.events.push('lock:acquire'); },
        releaseLock: () => { env.events.push('lock:release'); }
      })
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      // Apps Script と同じく符号付き byte 配列を返す。
      computeDigest: (algorithm, text) => Array.from(Int8Array.from(crypto.createHash('sha256').update(text, 'utf8').digest()))
    },
    HtmlService: {
      XFrameOptionsMode: { DEFAULT: 'DEFAULT' },
      createHtmlOutputFromFile: (name) => {
        const out = { name, setTitle() { return this; }, addMetaTag() { return this; }, setXFrameOptionsMode() { return this; } };
        env.htmlOutputs.push(out);
        return out;
      }
    }
  };
  env.props.set('RESPONSES_SPREADSHEET_ID', RESPONSES_ID);
  const ctx = vm.createContext(env.sandbox);
  const dir = path.join(ROOT, 'maintenance');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.gs')).sort((a, b) => (a === 'SurveyGenerated.gs' ? -1 : b === 'SurveyGenerated.gs' ? 1 : a.localeCompare(b)));
  files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f }));
  // 生成物の既定値（reception / retention は未設定）を、テストごとの架空の設定へ差し替える。
  ctx.SURVEY_RECEPTION = options.reception === undefined ? JSON.parse(JSON.stringify(RECEPTION)) : options.reception;
  if (options.retention) ctx.RETENTION_CONFIG = JSON.parse(JSON.stringify(options.retention));
  if (options.chunkSize) ctx.SNAPSHOT_CHUNK_SIZE = options.chunkSize;
  env.ctx = ctx;
  return env;
}

/** 全項目を満たした retention 設定（架空）。end_date は fixture の closes_at より後。 */
function confirmedRetention(overrides = {}) {
  const ids = require('../../src/maintenance-core.js').inventoryIds();
  return Object.assign({
    config_version: 1,
    owner: 'nagoya-base',
    policy_status: 'confirmed',
    policy_version: 'fixture-1',
    retention_end_date: '2027-03-31',
    retention_rule: null,
    keep_final_snapshot: true,
    cleanup_operator: 'fixture-operator',
    verification_method: 'fixture: dry-run の件数を確認',
    inventory_reviewed: ids
  }, overrides);
}

module.exports = { ROOT, RESPONSES_ID, RECEPTION, AFTER_CLOSE, BEFORE_CLOSE, createMaintenanceEnv, confirmedRetention };
