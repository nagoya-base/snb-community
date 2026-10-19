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
  setNumberFormat(format) { for (let c = 0; c < this.numCols; c++) this.sheet.formats[this.col + c] = format; return this; }
}

class FakeSheet {
  constructor(name) { this.name = name; this.rows = []; this.hooks = {}; this.formats = {}; }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return this.rows.reduce((m, r) => Math.max(m, r.length), 0); }
  getMaxRows() { return Math.max(1000, this.rows.length); }
  getRange(row, col, numRows, numCols) { return new FakeRange(this, row, col, numRows || 1, numCols || 1); }
  setFrozenRows() {}
}

class FakeSpreadsheet {
  constructor() { this.sheets = new Map(); }
  getSheetByName(name) { return this.sheets.get(name) || null; }
  insertSheet(name) { const s = new FakeSheet(name); this.sheets.set(name, s); return s; }
}

function createEnv() {
  const env = {
    spreadsheet: new FakeSpreadsheet(),
    props: new Map(),
    mails: [],
    logs: [],
    lockHeld: false,
    lockEvents: [],
    failMail: false,
    sandbox: null
  };
  const properties = {
    getProperty: (k) => (env.props.has(k) ? env.props.get(k) : null),
    setProperty: (k, v) => { env.props.set(k, String(v)); }
  };
  const jst = (date, _zone, fmt) => {
    const d = new Date(date.getTime() + 9 * 3600 * 1000);
    const p = (n, w = 2) => String(n).padStart(w, '0');
    return fmt.replace('yyyy', p(d.getUTCFullYear(), 4)).replace('MM', p(d.getUTCMonth() + 1))
      .replace('dd', p(d.getUTCDate())).replace('HH', p(d.getUTCHours())).replace('mm', p(d.getUTCMinutes()));
  };
  env.sandbox = {
    console: { log: (m) => env.logs.push(String(m)), error: (m) => env.logs.push(String(m)) },
    PropertiesService: { getScriptProperties: () => properties },
    SpreadsheetApp: { openById: () => env.spreadsheet, flush: () => {} },
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
      formatDate: jst
    },
    MailApp: { sendEmail: (m) => { if (env.failMail) throw new Error('Service invoked too many times'); env.mails.push(m); } },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput: (text) => ({ text, setMimeType() { return this; }, getContent() { return text; } })
    }
  };
  return env;
}

function loadPublicDir(env) {
  const dir = path.join(ROOT, 'public');
  const ctx = vm.createContext(env.sandbox);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.gs')).sort((a, b) => {
    if (a === 'SurveyGenerated.gs') return -1;
    if (b === 'SurveyGenerated.gs') return 1;
    return a.localeCompare(b);
  });
  files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f }));
  return ctx;
}

const plain = (x) => JSON.parse(JSON.stringify(x));

const SALT = 'test-salt-0123456789abcdef-0123456789abcdef';
const TEST_TOKEN = 'test-token-0123456789abcdef-0123';
const WINDOW = { opens_at: '2026-11-01T00:00:00+09:00', closes_at: '2026-11-30T23:59:59+09:00' };
const NOW = new Date('2026-11-10T12:00:00+09:00');

/**
 * Public GAS を読み込む。既定では「受付期間を設定済み・保持期限確定済み」の状態にする（本番化後の想定）。
 * 実 schema / config の未確定状態（fail closed）を検証するときは launched:false。
 */
function loadPublic(options = {}) {
  const env = createEnv();
  const ctx = loadPublicDir(env);
  env.props.set('SPREADSHEET_ID', 'sheet-id');
  env.props.set('RESPONDENT_SALT', SALT);
  env.props.set('TEST_TOKEN', TEST_TOKEN);
  env.props.set('NOTIFICATION_EMAIL', 'owner@example.com');
  if (options.launched !== false) {
    ctx.SURVEY_CONFIG.reception.opens_at = WINDOW.opens_at;
    ctx.SURVEY_CONFIG.reception.closes_at = WINDOW.closes_at;
    ctx.SURVEY_SCHEMA.respondentNotice.retention.status = 'confirmed';
  }
  if (options.setup !== false) ctx.setupSpreadsheet();
  return { env, ctx };
}

/** schemaから、検証を通る最小の回答を作る。overrides: {設問ID: 値}、otherTexts: {設問ID: 文字列}、extra: envelope上書き */
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
    if (q.type === 'single') answers[q.id] = core.getOptions(schema, q).filter((o) => !o.other)[0].id;
    else if (q.type === 'multiple') answers[q.id] = [core.getOptions(schema, q).filter((o) => !o.other && !o.exclusive)[0].id];
    else if (q.type === 'single_dynamic') answers[q.id] = core.getDynamicOptions(schema, q.id, answers)[0].id;
    else if (q.type === 'scale') answers[q.id] = '3';
  });
  return Object.assign({
    schema_version: schema.schema_version,
    uuid: crypto.randomUUID(),
    answers: plain(answers),
    other_texts: otherTexts,
    elapsed_ms: 90000
  }, extra);
}

module.exports = { ROOT, createEnv, loadPublic, validPayload, plain, SALT, TEST_TOKEN, NOW, WINDOW };
