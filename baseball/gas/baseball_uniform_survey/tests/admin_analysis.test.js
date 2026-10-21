'use strict';
// Admin 専用：需要ファネル分析と重要クロス集計（Issue #440）。実Google・実データには接続しない（完全に架空の fixture）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { createAdminEnv, ROOT } = require('./helpers/admin-env');
const { schema, core, aggregate, clone, rowFor, answersFor, classify, snapshotOf, NOW } = require('./helpers/fixtures');
const analysis = require('../src/survey-analysis.js');
const { validateSchema } = require('../tools/validate-schema');
const build = require('../tools/build-public-gas');

const plain = (x) => JSON.parse(JSON.stringify(x));
const NON = { club_awareness: 'aware_not_attended' };
const rowsOf = (specs) => specs.map((overrides) => rowFor(answersFor(overrides)));
const analyze = (specs, sch = schema) => analysis.buildAdminAnalysis(sch, aggregate.classifyRows(sch, rowsOf(specs)));
// 返却 payload は stable ID を含まない（表示ラベルのみ）。テストは schema 側のラベルへ引き直して検証する。
const qByLabel = (label) => schema.questions.find((q) => q.label === label);
const optLabel = (q, id) => {
  const source = q.type === 'single_dynamic' ? schema.questions.find((x) => x.id === q.sourceQuestion) : q;
  return source.options.find((o) => o.id === id).label;
};
const labelOfOption = (qid, id) => optLabel(schema.questions.find((q) => q.id === qid), id);
const funnelOf = (result, id) => result.funnels.find((f) => f.label === schema.adminAnalysis.funnelLabels[id]);
const stageOf = (funnel, qid) => funnel.stages.find((s) => s.label === schema.questions.find((q) => q.id === qid).label);
const crossOf = (result, id) => result.crossTabs.find((c) => c.label === schema.adminAnalysis.crossTabs.find((d) => d.id === id).label);
const countOf = (stage, id) => stage.options.find((x) => x.label === optLabel(qByLabel(stage.label), id)).count;
const rateOf = (stage, id) => stage.options.find((x) => x.label === optLabel(qByLabel(stage.label), id)).rate;
const rowOf = (tab, id) => tab.rowCategories.find((r) => r.label === optLabel(qByLabel(tab.rowAxis.label), id));
const cellOf = (tab, row, id) => row.cells.find((c) => c.label === optLabel(qByLabel(tab.columnAxis.label), id));
const overallOf = (tab, id) => tab.overall.find((c) => c.label === optLabel(qByLabel(tab.columnAxis.label), id));

// 要件の9本（Issue #440）。schema の定義がこれと一致すること自体を確認する。
const NINE = [
  ['top_uniform', 'top_uniform_sport_experience'],
  ['baseball_experience', 'catchball_interest'],
  ['club_awareness', 'near_term_participation_intent'],
  ['age', 'near_term_participation_intent'],
  ['barriers', 'age'],
  ['participation_fee_tolerance', 'near_term_participation_intent'],
  ['preferred_schedule', 'near_term_participation_intent'],
  ['attendance_count', 'repeat_intent'],
  ['last_attended', 'repeat_intent']
];

test('schema：クロス集計9本が adminAnalysis.crossTabs に定義済みで、全て計算できる。コード側にペアを持たない', () => {
  const defs = schema.adminAnalysis.crossTabs;
  assert.deepEqual(defs.map((d) => [d.row, d.column]), NINE);
  assert.equal(new Set(defs.map((d) => d.id)).size, 9);
  const result = analyze([{ ...NON, catchball_interest: 'very_interested' }]);
  assert.deepEqual(result.crossTabs.map((c) => c.label), defs.map((d) => d.label));
  for (const tab of result.crossTabs) {
    assert.ok(tab.rowCategories.length > 0 && tab.overall.length > 0, tab.label);
    assert.ok(tab.rowAxis.label && tab.columnAxis.label);
  }
  const code = fs.readFileSync(path.join(ROOT, 'src', 'survey-analysis.js'), 'utf8');
  for (const [row, column] of NINE) assert.ok(!code.includes("'" + row + "'") && !code.includes("'" + column + "'"), `${row}/${column} を直書きしない`);
  assert.ok(!/analysisFunnels\.(nonattendee|attendee|uniform|participation)/.test(code) && !/'(very_interested|attended|definitely)'/.test(code), 'ファネルの条件を直書きしない');
});

test('schema：新しい分析定義は schema 検証を通り、存在しない設問・同一軸・非選択式は拒否される', () => {
  assert.deepEqual(validateSchema(schema), []);
  const bad = clone(schema);
  bad.adminAnalysis.crossTabs.push({ id: 'x1', label: 'x', row: 'nope', column: 'age' });
  bad.adminAnalysis.crossTabs.push({ id: 'x2', label: 'x', row: 'age', column: 'age' });
  bad.adminAnalysis.crossTabs.push({ id: 'x3', label: 'x', row: 'feedback', column: 'age' });
  bad.analysisFunnels.attendee_retention.stages[2].pass = ['definitely', 'no_such_option'];
  const codes = validateSchema(bad).map((e) => e.code);
  for (const code of ['cross_tab_question_missing', 'cross_tab_same_axis', 'cross_tab_question_type', 'funnel_option_missing']) assert.ok(codes.includes(code), code);
});

test('ファネル：analysisFunnels の4本が schema の population / stage / denominator どおりに出る。past_to_current_barriers は比較ブロック', () => {
  const result = analyze([{ ...NON, catchball_interest: 'very_interested' }]);
  const funnelIds = ['nonattendee_conversion', 'attendee_retention', 'uniform_to_sport', 'participation_environment'];
  assert.deepEqual(result.funnels.map((f) => f.label), funnelIds.map((id) => schema.adminAnalysis.funnelLabels[id]));
  funnelIds.forEach((id, i) => {
    assert.deepEqual(result.funnels[i].stages.map((s) => s.label), schema.analysisFunnels[id].stages.map((s) => schema.questions.find((q) => q.id === s.question).label));
  });
  assert.deepEqual(result.comparisons, [{ method: schema.analysisFunnels.past_to_current_barriers.method }]);
});

test('nonattendee_conversion：前段階未通過者は次段階の分母に入らず、分岐未到達（参加経験者）は母集団外', () => {
  const result = analyze([
    { ...NON, catchball_interest: 'very_interested', near_term_participation_intent: 'definitely', barriers: ['cost', 'schedule'], participation_conditions: ['price_clear'], participation_fee_tolerance: 'up_to_500' },
    { club_awareness: 'name_only', catchball_interest: 'some_interest', near_term_participation_intent: 'unsure', barriers: ['location'], participation_conditions: ['near_location'], participation_fee_tolerance: 'up_to_1000' },
    { club_awareness: 'first_time', catchball_interest: 'low_interest' },
    { club_awareness: 'attended', last_attended: 'within_3m' }
  ]);
  const f = funnelOf(result, 'nonattendee_conversion');
  assert.equal(f.population.n, 3);
  const interest = stageOf(f, 'catchball_interest');
  assert.deepEqual([interest.n, interest.previousN, interest.pass.count, interest.rateFromPrevious], [3, 3, 2, 1]);
  assert.equal(interest.pass.rate, 2 / 3);
  const intent = stageOf(f, 'near_term_participation_intent');
  assert.deepEqual([intent.n, intent.previousN, intent.pass.count, intent.rateFromPrevious], [2, 2, 1, 1]);
  assert.equal(intent.pass.rate, 0.5);
  // 3段階目以降は near_term_participation_intent の pass（definitely / if_conditions）者だけ。unsure の回答は入らない。
  const barriers = stageOf(f, 'barriers');
  assert.deepEqual([barriers.n, barriers.previousN, barriers.rateFromPrevious], [1, 1, 1]);
  assert.equal(countOf(barriers, 'cost'), 1);
  assert.equal(countOf(barriers, 'schedule'), 1);
  assert.equal(countOf(barriers, 'location'), 0, '前段階未通過者の障壁は数えない');
  assert.equal(rateOf(barriers, 'cost'), 1);
  assert.equal(countOf(stageOf(f, 'participation_fee_tolerance'), 'up_to_1000'), 0);
  assert.equal(countOf(stageOf(f, 'participation_fee_tolerance'), 'up_to_500'), 1);
});

test('attendee_retention：denominator は attendee_population（割合の分母は参加経験者全体）。到達率は前段階比', () => {
  const result = analyze([
    { club_awareness: 'attended', attendance_count: 'once', last_attended: 'within_3m', repeat_intent: 'definitely' },
    { club_awareness: 'attended', attendance_count: 'five_plus', last_attended: 'over_1y', repeat_intent: 'if_conditions', attendance_lapse_reasons: ['schedule'], rejoin_conditions: ['more_dates'] },
    { club_awareness: 'attended', attendance_count: 'two_to_four', last_attended: 'over_1y', repeat_intent: 'unsure', attendance_lapse_reasons: ['cost'], rejoin_conditions: ['no_change'] },
    { ...NON, catchball_interest: 'very_interested' }
  ]);
  const f = funnelOf(result, 'attendee_retention');
  assert.equal(f.denominator, 'attendee_population');
  assert.equal(f.population.n, 3);
  const repeat = stageOf(f, 'repeat_intent');
  assert.deepEqual([repeat.n, repeat.pass.count, repeat.denominatorN, repeat.rateOfDenominator], [3, 2, 3, 1]);
  // 長期離脱（lapsed_attendee）に到達し、かつ repeat_intent を通過した 1 人だけ。unsure の離脱者は入らない。
  const lapse = stageOf(f, 'attendance_lapse_reasons');
  assert.deepEqual([lapse.n, lapse.previousN, lapse.rateFromPrevious, lapse.denominatorN], [1, 2, 0.5, 3]);
  assert.equal(lapse.rateOfDenominator, 1 / 3);
  assert.equal(countOf(lapse, 'schedule'), 1);
  assert.equal(countOf(lapse, 'cost'), 0);
  assert.equal(rateOf(lapse, 'schedule'), 1 / 3, '選択肢の割合も schema の denominator（参加経験者全体）');
  assert.equal(countOf(stageOf(f, 'rejoin_conditions'), 'no_change'), 0);
});

test('uniform_to_sport：population は top_uniform が競技ユニフォームの人。経験あり/なしを schema の experienced / no_experience で数える', () => {
  const result = analyze([
    { ...NON, catchball_interest: 'very_interested', favorite_uniforms: ['baseball', 'soccer'], top_uniform: 'baseball', top_uniform_sport_experience: 'continuous' },
    { ...NON, catchball_interest: 'very_interested', favorite_uniforms: ['soccer'], top_uniform: 'soccer', top_uniform_sport_experience: 'trial_only' },
    { ...NON, catchball_interest: 'very_interested', favorite_uniforms: ['soccer'], top_uniform: 'soccer', top_uniform_sport_experience: 'none' },
    { ...NON, catchball_interest: 'very_interested', favorite_uniforms: ['training_wear'], top_uniform: 'training_wear' }
  ]);
  const f = funnelOf(result, 'uniform_to_sport');
  assert.equal(f.population.n, 3, 'training_wear は population 外');
  const experience = stageOf(f, 'top_uniform_sport_experience');
  assert.equal(experience.n, 3);
  const group = (key) => experience.groups[key === 'experienced' ? 0 : 1]; // schema の stage 定義順（experienced, no_experience）
  assert.deepEqual(group('experienced').optionLabels, schema.analysisFunnels.uniform_to_sport.stages[2].experienced.map((id) => labelOfOption('top_uniform_sport_experience', id)));
  assert.deepEqual(group('no_experience').optionLabels, schema.analysisFunnels.uniform_to_sport.stages[2].no_experience.map((id) => labelOfOption('top_uniform_sport_experience', id)));
  assert.deepEqual([group('experienced').count, group('experienced').rate], [2, 2 / 3]);
  assert.deepEqual([group('no_experience').count, group('no_experience').rate], [1, 1 / 3]);
  assert.equal(countOf(experience, 'continuous'), 1);
  assert.ok(!('derivedMetrics' in f), '内部メトリックIDは返さない（経験あり/なし率は groups の表示ラベルと件数で返す）');
  // top_uniform_sport_experience に到達した人は population と一致する（schema の分岐と population が同じ集合）。
  assert.equal(experience.n, f.population.n);
});

test('participation_environment：population は運営設問に到達した人（operations_eligible）。denominator は question_reached', () => {
  const rows = rowsOf([
    { ...NON, catchball_interest: 'very_interested' },
    { club_awareness: 'attended', last_attended: 'within_3m' },
    { club_awareness: 'name_only', catchball_interest: 'not_interested' }
  ]);
  const result = analysis.buildAdminAnalysis(schema, aggregate.classifyRows(schema, rows));
  const f = funnelOf(result, 'participation_environment');
  const eligible = aggregate.classifyRows(schema, rows).valid.filter((r) => core.evalNamedCondition(schema, 'operations_eligible', r.answers)).length;
  assert.equal(f.population.n, eligible);
  assert.equal(f.population.n, 2);
  assert.equal(f.denominator, 'question_reached');
  for (const stage of f.stages) assert.deepEqual([stage.n, stage.denominatorN, stage.rateOfDenominator], [2, 2, 1]);
});

test('クロス集計：multiple 軸は各選択肢へ重複計上し、割合は行カテゴリの到達者数が分母。分岐未到達の回答は母集団に入らない', () => {
  const interested = { ...NON, catchball_interest: 'very_interested', near_term_participation_intent: 'definitely' };
  const result = analyze([
    { ...interested, barriers: ['cost', 'schedule'], age: '25_29' },
    { ...interested, barriers: ['cost'], age: '25_29' },
    { ...interested, barriers: ['cost'], age: '30_39' },
    { club_awareness: 'first_time', catchball_interest: 'low_interest', age: '25_29' }
  ]);
  const tab = crossOf(result, 'barriers_x_age');
  assert.deepEqual([tab.reachedCount, tab.population, tab.unansweredCount], [3, 3, 0]);
  const row = (id) => rowOf(tab, id);
  assert.equal(row('cost').n, 3);
  assert.equal(row('schedule').n, 1);
  const cell = (r, id) => cellOf(tab, row(r), id);
  assert.deepEqual([cell('cost', '25_29').count, cell('cost', '25_29').rate], [2, 2 / 3]);
  assert.deepEqual([cell('cost', '30_39').count, cell('cost', '30_39').rate], [1, 1 / 3]);
  assert.equal(cell('schedule', '25_29').rate, 1);
  assert.equal(cell('cost', '18_24').rate, 0);
  assert.equal(row('location').n, 0);
  assert.equal(row('location').cells[0].rate, null, '行が0人なら割合は出さない（0除算しない）');
  assert.ok(tab.rowCategories.reduce((n, r) => n + r.n, 0) > tab.population, 'multiple 軸なので行の合計は回答者数を超える');
  assert.equal(tab.rowAxis.multiple, true);
  assert.equal(tab.columnAxis.multiple, false);
  // 参考の全体分布は母集団（3 人）が分母。
  assert.equal(overallOf(tab, '25_29').rate, 2 / 3);
  // 名義尺度（barriers）は件数降順、同数は schema 順。ordinal な列（age）は schema 順のまま 0 件も残す。
  assert.deepEqual(tab.rowCategories.slice(0, 2).map((r) => r.label), ['cost', 'schedule'].map((id) => labelOfOption('barriers', id)));
  assert.deepEqual(tab.rowCategories.filter((r) => r.n === 0).map((r) => r.label), schema.questions.find((q) => q.id === 'barriers').options.filter((o) => !['cost', 'schedule'].includes(o.id)).map((o) => o.label));
  assert.deepEqual(tab.overall.map((c) => c.label), schema.questions.find((q) => q.id === 'age').options.map((o) => o.label));
});

test('クロス集計：multiple の列軸（開催希望時間帯）も各選択肢へ重複計上し、単一軸の行は row-base 割合の合計が100%', () => {
  const interested = { ...NON, catchball_interest: 'very_interested' };
  const result = analyze([
    { ...interested, near_term_participation_intent: 'definitely', preferred_schedule: ['sat_morning', 'sun_morning'] },
    { ...interested, near_term_participation_intent: 'unsure', preferred_schedule: ['sat_morning'] },
    { ...interested, near_term_participation_intent: 'definitely', preferred_schedule: ['weekday_night'] }
  ]);
  const tab = crossOf(result, 'preferred_schedule_x_near_term_intent');
  const sat = rowOf(tab, 'sat_morning');
  assert.equal(sat.n, 2);
  assert.equal(cellOf(tab, sat, 'definitely').rate, 0.5);
  assert.equal(cellOf(tab, sat, 'unsure').rate, 0.5);
  assert.equal(rowOf(tab, 'sun_morning').n, 1);
  // 単一選択の列（near_term_participation_intent）は、各行のセル割合の合計が 1。
  tab.rowCategories.filter((r) => r.n > 0).forEach((r) => assert.equal(r.cells.reduce((s, c) => s + c.count, 0), r.n));
  assert.deepEqual(tab.overall.map((c) => c.label), ['definitely', 'if_conditions', 'unsure', 'not_now'].map((id) => labelOfOption('near_term_participation_intent', id)), 'ordinal は schema 順');
});

test('クロス集計：参加経験者branchだけの2本は未参加者を母集団に入れない。top_uniform は population 外の列未到達を含めない', () => {
  const result = analyze([
    { club_awareness: 'attended', attendance_count: 'once', last_attended: 'within_3m', repeat_intent: 'definitely', favorite_uniforms: ['training_wear'], top_uniform: 'training_wear' },
    { club_awareness: 'attended', attendance_count: 'once', last_attended: 'over_1y', repeat_intent: 'unsure', attendance_lapse_reasons: ['schedule'], rejoin_conditions: ['more_dates'], favorite_uniforms: ['training_wear'], top_uniform: 'training_wear' },
    { ...NON, catchball_interest: 'very_interested', favorite_uniforms: ['training_wear'], top_uniform: 'training_wear' },
    { ...NON, catchball_interest: 'very_interested', favorite_uniforms: ['baseball'], top_uniform: 'baseball', top_uniform_sport_experience: 'continuous' }
  ]);
  for (const id of ['attendance_count_x_repeat_intent', 'last_attended_x_repeat_intent']) {
    const tab = crossOf(result, id);
    assert.deepEqual([tab.reachedCount, tab.population], [2, 2], id);
  }
  const count = crossOf(result, 'attendance_count_x_repeat_intent');
  assert.equal(rowOf(count, 'once').n, 2);
  assert.equal(cellOf(count, rowOf(count, 'once'), 'definitely').rate, 0.5);
  const uniform = crossOf(result, 'top_uniform_x_sport_experience');
  assert.deepEqual([uniform.reachedCount, uniform.population], [1, 1], 'training_wear は列設問に到達しないので母集団外');
  assert.equal(rowOf(uniform, 'training_wear').n, 0);
  assert.equal(cellOf(uniform, rowOf(uniform, 'baseball'), 'continuous').rate, 1);
});

test('test 回答・除外回答は分析に入らない。0件でも壊れない', () => {
  const rows = rowsOf([{ ...NON, catchball_interest: 'very_interested' }]).concat([rowFor(answersFor({ ...NON, catchball_interest: 'very_interested' }), { response_mode: 'test', test_run_id: 'r1' })]);
  const result = analysis.buildAdminAnalysis(schema, aggregate.classifyRows(schema, rows));
  assert.equal(result.production_valid_total, 1);
  assert.equal(funnelOf(result, 'nonattendee_conversion').population.n, 1);
  const empty = analysis.buildAdminAnalysis(schema, aggregate.classifyRows(schema, []));
  assert.equal(empty.production_valid_total, 0);
  assert.equal(funnelOf(empty, 'attendee_retention').stages[0].rateFromPrevious, null);
  assert.equal(crossOf(empty, 'barriers_x_age').rowCategories[0].cells[0].rate, null);
});

test('privacy：hash / timestamp / test_run_id / source_channel / 行番号 / 自由記述本文を分析結果に含めない', () => {
  const canary = 'CANARY-FREE-TEXT-440';
  const metas = { source_channel: 'x', test_run_id: '' };
  const answers = answersFor({ ...NON, catchball_interest: 'very_interested', near_term_participation_intent: 'definitely', feedback: canary + '-feedback', support_message: canary + '-support', barriers: ['other'] });
  const row = rowFor(answers, metas, { barriers: canary + '-other' });
  const classification = aggregate.classifyRows(schema, [row]);
  assert.equal(classification.valid.length, 1);
  const result = analysis.buildAdminAnalysis(schema, classification);
  const text = JSON.stringify(result);
  assert.ok(!text.includes(canary), '自由記述・その他本文を返さない');
  assert.ok(!text.includes(row.respondent_hash) && !text.includes(row.timestamp), 'hash / timestamp の値を返さない');
  const keys = new Set();
  (function walk(v) { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.keys(v).forEach((k) => { keys.add(k); walk(v[k]); }); })(result);
  for (const forbidden of aggregate.FORBIDDEN_KEYS.concat(['respondent_hash', 'timestamp', 'test_run_id', 'source_channel', 'row', 'rowNumber', 'answers', 'other_texts', 'free_text', 'texts'])) {
    assert.ok(!keys.has(forbidden), `key ${forbidden}`);
  }
  assert.deepEqual(plain(analysis.buildAdminAnalysis(schema, classification)), plain(result), '副作用なし（再計算で同じ結果）');
});

test('raw ID：返却 payload に question / option / funnel / cross / role などの stable ID を含めない（表示ラベルと件数のみ）', () => {
  const result = analyze([
    { ...NON, catchball_interest: 'very_interested', near_term_participation_intent: 'definitely', barriers: ['cost'], age: '25_29', favorite_uniforms: ['baseball'], top_uniform: 'baseball', top_uniform_sport_experience: 'continuous' },
    { club_awareness: 'attended', attendance_count: 'once', last_attended: 'over_1y', repeat_intent: 'definitely', attendance_lapse_reasons: ['schedule'], rejoin_conditions: ['more_dates'] }
  ]);
  const stable = new Set();
  schema.questions.forEach((q) => { stable.add(q.id); (q.options || []).forEach((o) => stable.add(o.id)); });
  Object.keys(schema.analysisFunnels).forEach((id) => stable.add(id));
  Object.values(schema.analysisFunnels).forEach((f) => (f.derivedMetrics || []).forEach((m) => stable.add(m)));
  stable.add(schema.survey_id);
  schema.adminAnalysis.crossTabs.forEach((d) => stable.add(d.id));
  Object.keys(schema.adminAnalysis.roleLabels).forEach((id) => stable.add(id));
  Object.keys(schema.adminAnalysis.denominatorLabels).forEach((id) => stable.add(id));
  const ID_KEYS = new Set(['id', 'questionId', 'question', 'key', 'role', 'optionId', 'optionIds', 'row', 'column']);
  const seen = [];
  (function walk(v, key) {
    if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === 'object') Object.keys(v).forEach((k) => { if (ID_KEYS.has(k)) seen.push('key:' + k); walk(v[k], k); });
    else if (typeof v === 'string' && !['type', 'basis', 'denominator'].includes(key) && stable.has(v)) seen.push(key + '=' + v);
  })(result, '');
  assert.deepEqual(seen, []);
  assert.ok(!('survey_id' in result) && !JSON.stringify(result).includes('experienced_rate') && !JSON.stringify(result).includes(schema.survey_id));
  assert.ok(!('id' in result.funnels[0]) && !('id' in result.crossTabs[0]) && !('questionId' in result.funnels[0].stages[0]));
});

test('Public / snapshot / 既存 Admin summary は adminAnalysis の有無で変わらない（影響なし）', () => {
  const bare = clone(schema);
  delete bare.adminAnalysis;
  const rows = rowsOf([
    { ...NON, catchball_interest: 'very_interested', near_term_participation_intent: 'definitely' },
    { club_awareness: 'attended', last_attended: 'over_1y', repeat_intent: 'definitely' }
  ]);
  assert.deepEqual(plain(snapshotOf(classify(rows).valid)), plain(aggregate.buildSnapshot(bare, aggregate.classifyRows(bare, rows).valid, { generatedAt: NOW })));
  const withSummary = aggregate.buildAdminSummary(schema, classify(rows), { now: NOW });
  const bareSummary = aggregate.buildAdminSummary(bare, aggregate.classifyRows(bare, rows), { now: NOW });
  assert.deepEqual(plain(withSummary), plain(bareSummary));
  assert.ok(!('funnels' in withSummary) && !('crossTabs' in withSummary), 'getAdminSummary に分析は混ぜない');
  assert.ok(!JSON.stringify(withSummary.publicPreview).includes('adminAnalysis'));
});

test('bundle：SurveyAnalysis は Admin の生成物だけ。Public / maintenance / Frontend には持ち込まない。生成物は正本と一致する', () => {
  assert.equal(fs.readFileSync(build.ADMIN_TARGET, 'utf8'), build.renderAdmin());
  assert.match(fs.readFileSync(build.ADMIN_TARGET, 'utf8'), /var SurveyAnalysis = /);
  for (const target of [build.TARGET, build.MAINTENANCE_TARGET, build.FRONTEND_TARGET]) assert.ok(!/SurveyAnalysis/.test(fs.readFileSync(target, 'utf8')), path.basename(target));
  assert.equal(fs.readFileSync(build.TARGET, 'utf8'), build.render());
  assert.equal(fs.readFileSync(build.MAINTENANCE_TARGET, 'utf8'), build.renderMaintenance());
});

test('Admin GAS：getAdminAnalysis は read-only（Sheets 読み取りのみ）で、getAdminSummary / getFreeText / getOtherTexts は従来どおり', () => {
  const rows = rowsOf([{ ...NON, catchball_interest: 'very_interested', near_term_participation_intent: 'definitely', feedback: 'ADMIN-ONLY-TEXT' }]);
  const env = createAdminEnv(rows);
  const result = plain(env.ctx.getAdminAnalysis());
  assert.equal(result.production_valid_total, 1);
  assert.deepEqual(env.writes, []);
  assert.deepEqual(env.calls.filter((c, i, a) => a.indexOf(c) === i), ['Spreadsheets.get', "Values.get 'responses'"]);
  assert.ok(!JSON.stringify(result).includes('ADMIN-ONLY-TEXT'));
  assert.ok(Array.isArray(env.ctx.getAdminSummary().questions));
  assert.ok(env.ctx.getFreeText().some((i) => /ADMIN-ONLY-TEXT/.test(i.text)));
  assert.deepEqual(plain(env.ctx.getOtherTexts('barriers')), { questionId: 'barriers', texts: [] });
  assert.deepEqual(env.ctx.getAdminAnalysis().crossTabs.length, 9);
});

/* 実際の getAdminAnalysis() の返却値で Dashboard.html を描画する。 */
function renderDashboard(rows) {
  const env = createAdminEnv(rows);
  const summary = plain(env.ctx.getAdminSummary());
  const analysisResult = plain(env.ctx.getAdminAnalysis());
  const html = fs.readFileSync(path.join(ROOT, 'admin', 'Dashboard.html'), 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    beforeParse(window) {
      const chain = () => {
        const handlers = {};
        const run = new Proxy({}, {
          get(_, name) {
            if (name === 'withSuccessHandler') return (fn) => { handlers.ok = fn; return run; };
            if (name === 'withFailureHandler') return (fn) => { handlers.ng = fn; return run; };
            return () => {
              if (name === 'getAdminSummary') handlers.ok(summary);
              else if (name === 'getAdminAnalysis') handlers.ok(analysisResult);
              else if (handlers.ok) handlers.ok({});
            };
          }
        });
        return run;
      };
      Object.defineProperty(window, 'google', { value: { script: { get run() { return chain(); } } } });
    }
  });
  dom.window.eval([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n'));
  return { document: dom.window.document, html, analysisResult };
}

test('Dashboard：需要ファネル分析と重要クロス集計を折りたたみ・縦カードで表示（table なし・横スクロールなし・既存表示を維持）', () => {
  const { document, html } = renderDashboard(rowsOf([
    { ...NON, catchball_interest: 'very_interested', near_term_participation_intent: 'definitely', barriers: ['cost', 'schedule'], age: '25_29', favorite_uniforms: ['baseball'], top_uniform: 'baseball', top_uniform_sport_experience: 'continuous' },
    { club_awareness: 'attended', attendance_count: 'once', last_attended: 'over_1y', repeat_intent: 'definitely', attendance_lapse_reasons: ['schedule'], rejoin_conditions: ['more_dates'] }
  ]));
  const box = document.getElementById('analysis');
  assert.equal(box.hidden, false);
  const funnels = document.querySelectorAll('#funnelBody > details');
  assert.equal(funnels.length, 5, '4 ファネル + 障壁の変化/比較');
  assert.match(funnels[0].querySelector('summary').textContent, /未参加者の転換（母集団 1 人）/);
  assert.match(funnels[0].textContent, /前段階を通過しなかった人・分岐で未到達の人は次の段階に含めません/);
  assert.match(funnels[1].textContent, /参加経験者全体/);
  assert.match(funnels[4].querySelector('summary').textContent, /障壁の変化／比較/);
  const crosses = document.querySelectorAll('#crossBody > details');
  assert.equal(crosses.length, 9);
  for (const d of [...funnels, ...crosses, document.getElementById('funnels'), document.getElementById('crosstabs')]) assert.equal(d.hasAttribute('open'), false, '各ブロックは折りたたみ');
  assert.match(crosses[0].textContent, /行カテゴリの到達者数（その行を選んだ人）」が分母/);
  assert.match(crosses[4].textContent, /1 人が複数のセルに入り、行・列の合計は回答者数と一致しません/);
  assert.ok(!/複数のセルに入り/.test(crosses[0].textContent), '単一軸のクロスには multiple 注記を出さない');
  assert.ok(!box.querySelector('table'), '横長 table を使わない');
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.ok(!/overflow-x/.test(css) && !/<table/.test(html));
  assert.ok(!/\bwidth\s*:\s*\d{3,}px|min-width\s*:\s*(?:[3-9]\d\d|\d{4,})px/.test(css), '320px を超える固定幅を使わない');
  assert.match(css, /\.stage\s*\{[^}]*min-width\s*:\s*0/);
  assert.match(css, /\.xrow\s*\{[^}]*min-width\s*:\s*0/);
  // 既存の表示（日別・集計結果・タブ）は維持。
  assert.deepEqual([...document.querySelectorAll('[data-tab]')].map((b) => b.getAttribute('data-tab')), ['results', 'publication', 'semantic', 'snapshot', 'freetext']);
  assert.ok(document.querySelector('#results .card'));
  assert.ok(document.getElementById('daily').textContent.includes('日別回答数'));
  // 分析ブロックには question ID や hash を主表示しない。
  assert.ok(!/\b(club_awareness|catchball_interest|near_term_participation_intent)\b/.test(box.textContent));
});

test('Dashboard：分析の取得に失敗しても既存の集計結果は表示され、分析ブロックだけが隠れる', () => {
  const html = fs.readFileSync(path.join(ROOT, 'admin', 'Dashboard.html'), 'utf8');
  assert.match(html, /getAdminAnalysis\(\)/);
  assert.match(html, /withFailureHandler\(function \(\) \{ \$\('analysis'\)\.hidden = true; \}\)\.getAdminAnalysis/);
  assert.ok(!/innerHTML/.test(html), 'textContent で描画する');
});
