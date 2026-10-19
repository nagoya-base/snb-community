'use strict';
// 完全に架空の回答 fixture（Issue #382）。schema をメモリ上で読み、実データ・実Spreadsheetは一切使わない。
const crypto = require('crypto');
const core = require('../../src/survey-core.js');
const aggregate = require('../../src/survey-aggregate.js');
const schema = require('../../survey.schema.json');

const clone = (x) => JSON.parse(JSON.stringify(x));

/**
 * schema から、検証を通る最小の answers を作る。overrides: {設問ID: 値}（undefined で未回答）。
 * 可視性は core で評価するので、分岐の結果として表示される設問だけに先頭 option を入れる。
 */
function answersFor(overrides = {}, sch = schema) {
  const answers = {};
  sch.questions.forEach((q) => {
    if (Object.prototype.hasOwnProperty.call(overrides, q.id)) {
      if (overrides[q.id] !== undefined) answers[q.id] = overrides[q.id];
      return;
    }
    if (!core.isVisible(sch, q.id, answers) || !q.required) return;
    if (q.type === 'single') answers[q.id] = core.getOptions(sch, q).filter((o) => !o.other)[0].id;
    else if (q.type === 'multiple') answers[q.id] = [core.getOptions(sch, q).filter((o) => !o.other && !o.exclusive)[0].id];
    else if (q.type === 'single_dynamic') answers[q.id] = core.getDynamicOptions(sch, q.id, answers)[0].id;
    else if (q.type === 'scale') answers[q.id] = '3';
  });
  return clone(answers);
}

function header(sch = schema) {
  return sch.persistenceSchema.systemFields.concat(core.questionIds(sch), ['other_texts']);
}

let hashCounter = 0;
const nextHash = () => crypto.createHash('sha256').update('fixture-' + (hashCounter++)).digest('hex');

/** 保存形式（#380 の Sheet 行）に変換する。meta で response_mode / hash 等を差し替える。 */
function rowFor(answers, meta = {}, otherTexts = {}, sch = schema) {
  const row = {
    timestamp: '2026-11-10 12:00',
    survey_version: sch.survey_version,
    schema_version: sch.schema_version,
    design_version: sch.design_version,
    response_mode: 'production',
    test_run_id: '',
    respondent_hash: nextHash(),
    completion_status: 'complete',
    source_channel: 'unknown',
    client_elapsed_ms: 120000,
    notification_status: 'sent',
    other_texts: JSON.stringify(otherTexts)
  };
  core.questionIds(sch).forEach((id) => {
    const q = core.getQuestion(sch, id);
    const v = answers[id];
    if (v === undefined) row[id] = '';
    else if (q.type === 'multiple') row[id] = v.length ? '|' + v.join('|') + '|' : '';
    else row[id] = v;
  });
  return Object.assign(row, meta);
}

/** specs: [{count, overrides, meta, otherTexts}] → 行の配列。 */
function rowsFrom(specs) {
  const rows = [];
  specs.forEach((spec) => {
    for (let i = 0; i < (spec.count || 1); i++) rows.push(rowFor(answersFor(spec.overrides || {}), spec.meta || {}, spec.otherTexts || {}));
  });
  return rows;
}

const classify = (rows) => aggregate.classifyRows(schema, rows);
/** specs から有効回答 record を作る（classifyRows を通すので、本番と同じ経路）。 */
function validFrom(specs) {
  const result = classify(rowsFrom(specs));
  return result.valid;
}

const NOW = new Date('2026-11-10T12:00:00.000Z');
const snapshotOf = (valid, generatedAt = NOW) => aggregate.buildSnapshot(schema, valid, { generatedAt });
const entryOf = (snapshot, id) => snapshot.questions.find((q) => q.id === id);

// 決定的な疑似乱数（property test 用）。
function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

module.exports = { schema, core, aggregate, clone, answersFor, header, rowFor, rowsFrom, classify, validFrom, snapshotOf, entryOf, lcg, NOW };
