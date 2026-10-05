'use strict';
// Apps Script実行環境の最小フェイク。実際のGoogle APIは一切呼ばない。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');

class FakeRange {
  constructor(sheet, row, col, numRows, numCols) { Object.assign(this, { sheet, row, col, numRows, numCols }); }
  getValues() {
    this.sheet.hooks.onRead && this.sheet.hooks.onRead(this);
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const line = [];
      for (let c = 0; c < this.numCols; c++) {
        const v = (this.sheet.rows[this.row - 1 + r] || [])[this.col - 1 + c];
        line.push(v === undefined ? '' : v);
      }
      out.push(line);
    }
    return out;
  }
  getValue() { return this.getValues()[0][0]; }
  setValues(values) {
    this.sheet.hooks.onWrite && this.sheet.hooks.onWrite(this, values);
    values.forEach((line, r) => line.forEach((v, c) => {
      const rowIndex = this.row - 1 + r;
      while (this.sheet.rows.length <= rowIndex) this.sheet.rows.push([]);
      this.sheet.rows[rowIndex][this.col - 1 + c] = v;
    }));
    return this;
  }
  setValue(value) { return this.setValues([[value]]); }
}

class FakeSheet {
  constructor(name) { this.name = name; this.rows = []; this.hooks = {}; }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return this.rows.reduce((m, r) => Math.max(m, r.length), 0); }
  getRange(row, col, numRows, numCols) { return new FakeRange(this, row, col, numRows || 1, numCols || 1); }
  setFrozenRows() {}
}

class FakeSpreadsheet {
  constructor() { this.sheets = new Map(); }
  getSheetByName(name) { return this.sheets.get(name) || null; }
  insertSheet(name) { const s = new FakeSheet(name); this.sheets.set(name, s); return s; }
}

function createEnv(options = {}) {
  const env = {
    spreadsheet: new FakeSpreadsheet(),
    props: new Map(),
    mails: [],
    logs: [],
    lockHeld: false,
    lockEvents: [],
    failMail: false,
    failOpen: false,
    activeEmail: '',
    sandbox: null
  };
  const properties = {
    getProperty: (k) => (env.props.has(k) ? env.props.get(k) : null),
    setProperty: (k, v) => { env.props.set(k, String(v)); },
    deleteProperty: (k) => { env.props.delete(k); },
    getProperties: () => Object.fromEntries(env.props)
  };
  const tz = (date, _zone, fmt) => {
    const d = new Date(date.getTime() + 9 * 3600 * 1000);
    const p = (n, w = 2) => String(n).padStart(w, '0');
    return fmt.replace('yyyy', p(d.getUTCFullYear(), 4)).replace('MM', p(d.getUTCMonth() + 1))
      .replace('dd', p(d.getUTCDate())).replace('HH', p(d.getUTCHours())).replace('mm', p(d.getUTCMinutes()));
  };
  env.sandbox = {
    console: { log: (m) => env.logs.push(String(m)), error: (m) => env.logs.push(String(m)) },
    PropertiesService: { getScriptProperties: () => properties },
    SpreadsheetApp: {
      openById: () => { if (env.failOpen) throw new Error('Service Spreadsheets failed'); return env.spreadsheet; },
      flush: () => {}
    },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => { if (env.lockHeld) throw new Error('Lock timeout'); env.lockHeld = true; env.lockEvents.push('acquire'); },
        releaseLock: () => { env.lockHeld = false; env.lockEvents.push('release'); }
      })
    },
    Utilities: {
      computeDigest: (_alg, input) => Array.from(crypto.createHash('sha256').update(input, 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)),
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      getUuid: () => crypto.randomUUID(),
      formatDate: tz
    },
    MailApp: { sendEmail: (m) => { if (env.failMail) throw new Error('Service invoked too many times'); env.mails.push(m); } },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput: (text) => ({ text, setMimeType() { return this; }, getContent() { return text; } })
    },
    Session: { getActiveUser: () => ({ getEmail: () => env.activeEmail }) },
    HtmlService: {}
  };
  return env;
}

function loadDir(env, dir, extraFiles = []) {
  const ctx = vm.createContext(env.sandbox);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.gs')).sort((a, b) => {
    if (a === 'SurveyGenerated.gs') return -1;
    if (b === 'SurveyGenerated.gs') return 1;
    return a.localeCompare(b);
  });
  files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f }));
  extraFiles.forEach((f) => vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f }));
  return ctx;
}

const plain = (x) => JSON.parse(JSON.stringify(x));

function loadPublic(options = {}) {
  const env = createEnv();
  const ctx = loadDir(env, path.join(ROOT, 'public'));
  env.props.set('SPREADSHEET_ID', 'sheet-id');
  env.props.set('RESPONDENT_SALT', 'test-salt-0123456789abcdef');
  env.props.set('SURVEY_CLOSES_AT', options.closesAt || '2026-12-31T23:59:59+09:00');
  env.props.set('NOTIFICATION_EMAIL', 'owner@example.com');
  if (options.setup !== false) ctx.setupSpreadsheet();
  return { env, ctx };
}

function loadAdmin() {
  const env = createEnv();
  const ctx = loadDir(env, path.join(ROOT, 'admin'));
  env.props.set('SPREADSHEET_ID', 'sheet-id');
  env.props.set('SURVEY_CLOSES_AT', '2026-12-31T23:59:59+09:00');
  env.props.set('ADMIN_OWNER_EMAILS', 'admin@example.com');
  env.activeEmail = 'admin@example.com';
  return { env, ctx };
}

/** schemaから、検証を通る最小の回答を作る。overrides: {設問ID: 値}、otherTexts: {設問ID: 文字列} */
function validPayload(ctx, overrides = {}, otherTexts = {}, extra = {}) {
  const schema = ctx.SURVEY_SCHEMA;
  const core = ctx.SurveyCore;
  const answers = {};
  schema.questions.forEach((q) => {
    if (Object.prototype.hasOwnProperty.call(overrides, q.id)) {
      if (overrides[q.id] !== undefined) answers[q.id] = overrides[q.id];
      return;
    }
    if (!core.isVisible(schema, q.id, answers) || !q.required) return;
    const options = q.type === 'matrix' ? [] : core.getOptions(schema, q).filter((o) => !o.other && !o.exclusive);
    if (q.type === 'single') answers[q.id] = options[0].id;
    else if (q.type === 'multi') answers[q.id] = [options[0].id];
    else if (q.type === 'matrix') answers[q.id] = Object.fromEntries(q.rows.map((r) => [r.id, q.scale[2].id]));
  });
  return Object.assign({
    schema_version: schema.schema_version,
    uuid: crypto.randomUUID(),
    age_confirmed: true,
    answers: plain(answers),
    other_texts: otherTexts,
    website: '',
    elapsed_ms: 90000
  }, extra);
}

module.exports = { ROOT, createEnv, loadDir, loadPublic, loadAdmin, validPayload, plain, FakeSheet, FakeSpreadsheet };
