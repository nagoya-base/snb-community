'use strict';

// survey-core.js（専用fork）のunit test。Issue #379。
// 入力はschema（実物またはメモリ上の架空schema）と架空の回答のみ。実回答・salt・tokenは使わない。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const Core = require('../src/survey-core.js');
const schema = require('../survey.schema.json');

const CORE_PATH = path.join(__dirname, '..', 'src', 'survey-core.js');
const NON_ATTENDEE = 'aware_not_attended';
const INTERESTED = 'very_interested';

function ids(list) { return list.map((x) => x.id); }

function mini(questions, conditions) {
  return { questions, conditions: conditions || {}, testModes: schema.testModes };
}
function single(id, optionIds, extra) {
  return Object.assign({ id, type: 'single', required: true, options: optionIds.map((o) => ({ id: o })) }, extra);
}
function multi(id, optionIds, extra) {
  return Object.assign({ id, type: 'multiple', required: true, options: optionIds.map((o) => ({ id: o })) }, extra);
}

// ---- condition: all / any / ネスト ----

test('all / any をネストして評価する', () => {
  const s = mini([
    single('a', ['x', 'y']),
    single('b', ['p', 'q']),
    single('c', ['m', 'n']),
  ]);
  const cond = {
    any: [
      { question: 'a', equals: 'x' },
      { all: [{ question: 'b', equals: 'p' }, { question: 'c', in: ['m', 'n'] }] },
    ],
  };
  assert.equal(Core.evalCondition(s, cond, { a: 'x' }), true);
  assert.equal(Core.evalCondition(s, cond, { a: 'y', b: 'p', c: 'n' }), true);
  assert.equal(Core.evalCondition(s, cond, { a: 'y', b: 'p' }), false);
  assert.equal(Core.evalCondition(s, cond, { a: 'y', b: 'q', c: 'm' }), false);
  assert.equal(Core.evalCondition(s, cond, {}), false);
});

test('条件なしは true', () => {
  assert.equal(Core.evalCondition(schema, undefined, {}), true);
  assert.equal(Core.evalCondition(schema, null, {}), true);
});

test('conditionRef を実 schema の conditions で解決する（lapsed_attendee）', () => {
  assert.equal(Core.evalNamedCondition(schema, 'lapsed_attendee', { club_awareness: 'attended', last_attended: 'over_1y' }), true);
  assert.equal(Core.evalNamedCondition(schema, 'lapsed_attendee', { club_awareness: 'attended', last_attended: 'within_3m' }), false);
  assert.equal(Core.evalNamedCondition(schema, 'lapsed_attendee', { club_awareness: NON_ATTENDEE, last_attended: 'over_1y' }), false);
});

test('conditions 内のネストした conditionRef（operations_eligible の any/all）', () => {
  assert.equal(Core.evalNamedCondition(schema, 'operations_eligible', { club_awareness: 'attended' }), true);
  assert.equal(Core.evalNamedCondition(schema, 'operations_eligible', { club_awareness: NON_ATTENDEE, catchball_interest: INTERESTED }), true);
  assert.equal(Core.evalNamedCondition(schema, 'operations_eligible', { club_awareness: NON_ATTENDEE, catchball_interest: 'low_interest' }), false);
});

test('equals / in / hasAnyExcept', () => {
  const s = mini([single('s', ['a', 'b', 'c']), multi('m', ['a', 'b', 'none'])]);
  assert.equal(Core.evalCondition(s, { question: 's', equals: 'a' }, { s: 'a' }), true);
  assert.equal(Core.evalCondition(s, { question: 's', equals: 'a' }, { s: 'b' }), false);
  assert.equal(Core.evalCondition(s, { question: 's', in: ['a', 'b'] }, { s: 'b' }), true);
  assert.equal(Core.evalCondition(s, { question: 's', in: ['a', 'b'] }, { s: 'c' }), false);
  assert.equal(Core.evalCondition(s, { question: 'm', hasAnyExcept: ['none'] }, { m: ['a'] }), true);
  assert.equal(Core.evalCondition(s, { question: 'm', hasAnyExcept: ['none'] }, { m: ['none'] }), false);
  assert.equal(Core.evalCondition(s, { question: 'm', hasAnyExcept: ['none'] }, { m: ['a', 'b'] }), true);
  assert.equal(Core.evalCondition(s, { question: 'm', hasAnyExcept: ['none'] }, { m: [] }), false);
});

test('schemaにある notEquals / contains / notContains', () => {
  const s = mini([single('s', ['a', 'b']), multi('m', ['a', 'b', 'c'])]);
  assert.equal(Core.evalCondition(s, { question: 's', notEquals: 'a' }, { s: 'b' }), true);
  assert.equal(Core.evalCondition(s, { question: 's', notEquals: 'a' }, { s: 'a' }), false);
  assert.equal(Core.evalCondition(s, { question: 'm', contains: 'a' }, { m: ['a', 'c'] }), true);
  assert.equal(Core.evalCondition(s, { question: 'm', contains: 'b' }, { m: ['a', 'c'] }), false);
  assert.equal(Core.evalCondition(s, { question: 'm', notContains: 'b' }, { m: ['a', 'c'] }), true);
  assert.equal(Core.evalCondition(s, { question: 'm', notContains: 'a' }, { m: ['a', 'c'] }), false);
});

test('未回答の設問に対する条件は notEquals / notContains も false', () => {
  const s = mini([single('s', ['a', 'b']), multi('m', ['a', 'b'])]);
  assert.equal(Core.evalCondition(s, { question: 's', notEquals: 'a' }, {}), false);
  assert.equal(Core.evalCondition(s, { question: 'm', notContains: 'a' }, {}), false);
  assert.equal(Core.evalCondition(s, { question: 'm', notContains: 'a' }, { m: [] }), false);
});

test('malformed / unknown condition は fail-safe（false）', () => {
  const s = mini([single('s', ['a', 'b']), multi('m', ['a', 'b'])], { loop1: { conditionRef: 'loop2' }, loop2: { conditionRef: 'loop1' } });
  const bad = [
    'string', 42, [], {},
    { question: 's' },
    { question: 's', equals: 'a', in: ['a'] },
    { question: 'nope', equals: 'a' },
    { question: 's', unknownOp: 'a' },
    { question: 's', equals: ['a'] },
    { question: 's', in: 'a' },
    { question: 'm', equals: 'a' },
    { question: 's', contains: 'a' },
    { all: [] },
    { any: 'x' },
    { all: [{ question: 's', equals: 'a' }], any: [{ question: 's', equals: 'a' }] },
    { all: [{ question: 's', equals: 'a' }, {}] },
    { any: [null] },
    { conditionRef: 'missing' },
    { conditionRef: 42 },
    { conditionRef: 'loop1' },
  ];
  bad.forEach((cond) => {
    assert.equal(Core.evalCondition(s, cond, { s: 'a', m: ['a'] }), false, JSON.stringify(cond));
  });
  // 不正な showIf を持つ設問は表示されない
  const s2 = mini([single('x', ['a'], { showIf: { question: 'ghost', equals: 'a' } })]);
  assert.equal(Core.isVisible(s2, 'x', {}), false);
  assert.equal(Core.isVisible(s2, 'missing', {}), false);
});

// ---- visibility ----

test('値の変更で条件が true → false になると hidden になる', () => {
  const answers = { club_awareness: NON_ATTENDEE, catchball_interest: INTERESTED };
  assert.equal(Core.isVisible(schema, 'barriers', answers), true);
  assert.equal(Core.isVisible(schema, 'barriers', Object.assign({}, answers, { catchball_interest: 'low_interest' })), false);
});

test('low-interest route: uniform_social_interest が visible、運営条件・活動歴は hidden', () => {
  const low = { club_awareness: NON_ATTENDEE, catchball_interest: 'low_interest' };
  const visible = Core.visibleQuestionIds(schema, low);
  assert.ok(visible.includes('uniform_social_interest'));
  ['barriers', 'near_term_participation_intent', 'preferred_program', 'student_activities', 'activity_stopped', 'adult_sports']
    .forEach((id) => assert.ok(!visible.includes(id), id));
  assert.ok(visible.includes('exercise_frequency'));
  const notInterested = { club_awareness: 'name_only', catchball_interest: 'not_interested' };
  assert.equal(Core.isVisible(schema, 'uniform_social_interest', notInterested), true);
  const interested = { club_awareness: NON_ATTENDEE, catchball_interest: INTERESTED };
  assert.equal(Core.isVisible(schema, 'uniform_social_interest', interested), false);
  assert.equal(Core.isVisible(schema, 'near_term_participation_intent', interested), true);
});

test('activity_stopped_reasons の2条件（activity_history_eligible かつ activity_stopped = yes）', () => {
  const eligible = { club_awareness: 'attended' };
  assert.equal(Core.isVisible(schema, 'activity_stopped_reasons', eligible), false);
  assert.equal(Core.isVisible(schema, 'activity_stopped_reasons', Object.assign({}, eligible, { activity_stopped: 'yes' })), true);
  assert.equal(Core.isVisible(schema, 'activity_stopped_reasons', Object.assign({}, eligible, { activity_stopped: 'no' })), false);
  // eligible でなければ activity_stopped が yes でも出ない
  const notEligible = { club_awareness: NON_ATTENDEE, catchball_interest: 'low_interest', activity_stopped: 'yes' };
  assert.equal(Core.isVisible(schema, 'activity_stopped_reasons', notEligible), false);
});

test('adult_context の2条件（activity_history_eligible かつ adult_sports が none 以外を含む）', () => {
  const eligible = { club_awareness: 'attended' };
  assert.equal(Core.isVisible(schema, 'adult_context', Object.assign({}, eligible, { adult_sports: ['gym'] })), true);
  assert.equal(Core.isVisible(schema, 'adult_context', Object.assign({}, eligible, { adult_sports: ['none'] })), false);
  assert.equal(Core.isVisible(schema, 'adult_context', Object.assign({}, eligible, { adult_sports: [] })), false);
  const notEligible = { club_awareness: NON_ATTENDEE, catchball_interest: 'low_interest', adult_sports: ['gym'] };
  assert.equal(Core.isVisible(schema, 'adult_context', notEligible), false);
});

test('親が hidden なら、残っている親の旧値は子の表示判定に使われない', () => {
  // adult_sports は hidden だが旧値が残っている → adult_context は visible にならない
  const stale = { club_awareness: NON_ATTENDEE, catchball_interest: 'low_interest', activity_stopped: 'yes', adult_sports: ['gym'] };
  assert.equal(Core.isVisible(schema, 'adult_context', stale), false);
  const s = mini([
    single('p', ['go', 'stop']),
    single('mid', ['a', 'b'], { showIf: { question: 'p', equals: 'go' } }),
    single('leaf', ['x'], { showIf: { question: 'mid', equals: 'a' } }),
  ]);
  assert.equal(Core.isVisible(s, 'leaf', { p: 'go', mid: 'a' }), true);
  assert.equal(Core.isVisible(s, 'leaf', { p: 'stop', mid: 'a' }), false);
});

test('showIf の循環は fail-safe で hidden', () => {
  const s = mini([
    single('a', ['x'], { showIf: { question: 'b', equals: 'x' } }),
    single('b', ['x'], { showIf: { question: 'a', equals: 'x' } }),
  ]);
  assert.equal(Core.isVisible(s, 'a', { a: 'x', b: 'x' }), false);
  assert.deepEqual(Core.visibleQuestionIds(s, { a: 'x', b: 'x' }), []);
});

// ---- single_dynamic ----

test('single_dynamic: sourceQuestion の選択済み option だけを source の順で候補化し excludeOptionIds を除く', () => {
  const answers = { favorite_uniforms: ['tennis', 'baseball', 'none'] };
  // 'none' は exclusive だが、ここでは excludeOptionIds の除外だけを確認する
  assert.deepEqual(ids(Core.getDynamicOptions(schema, 'top_uniform', answers)), ['baseball', 'tennis']);
  const withOther = { favorite_uniforms: ['other', 'soccer'] };
  assert.deepEqual(ids(Core.getDynamicOptions(schema, 'top_uniform', withOther)), ['soccer', 'other']);
  assert.deepEqual(ids(Core.getDynamicOptions(schema, 'top_uniform', { favorite_uniforms: ['none'] })), []);
  assert.deepEqual(ids(Core.getDynamicOptions(schema, 'top_uniform', {})), []);
});

test('single_dynamic: 候補は option ID と label を引き継ぎ、other 本文は候補にしない', () => {
  const answers = { favorite_uniforms: ['other', 'baseball'] };
  const candidates = Core.getDynamicOptions(schema, 'top_uniform', answers);
  const baseball = candidates.find((c) => c.id === 'baseball');
  assert.equal(baseball.label, '野球');
  assert.equal(baseball.sourceOptionId, 'baseball');
  const other = candidates.find((c) => c.id === 'other');
  assert.equal(other.fromOther, true);
  assert.equal(other.other, undefined);
  // 自由記述本文をIDとした回答は受理しない
  const r = Core.validateAnswers(schema, { favorite_uniforms: ['other', 'baseball'], top_uniform: 'ラグビーっぽいやつ' }, { favorite_uniforms: 'ラグビーっぽいやつ' });
  assert.ok(r.errors.some((e) => e.field === 'top_uniform' && e.code === 'invalid_option'));
  // dynamic が other を選んでも、dynamic 側に本文は要求しない
  assert.equal(Core.otherTextInfo(schema, 'top_uniform', 'other').required, false);
});

test('single_dynamic: main_barrier は barriers の選択から none を除く', () => {
  const answers = { club_awareness: NON_ATTENDEE, catchball_interest: INTERESTED, barriers: ['cost', 'schedule'] };
  assert.deepEqual(ids(Core.getDynamicOptions(schema, 'main_barrier', answers)), ['schedule', 'cost']);
  assert.equal(Core.isVisible(schema, 'main_barrier', answers), true);
  assert.equal(Core.isVisible(schema, 'main_barrier', Object.assign({}, answers, { barriers: ['none'] })), false);
});

test('single_dynamic: source が hidden なら候補は空', () => {
  const answers = { club_awareness: 'attended', barriers: ['cost'] };
  assert.deepEqual(Core.getDynamicOptions(schema, 'main_barrier', answers), []);
});

test('autoSelectIfSingle: 候補が1件のときだけ自動選択値を返す', () => {
  assert.equal(Core.autoSelectValue(schema, 'top_uniform', { favorite_uniforms: ['tennis'] }), 'tennis');
  assert.equal(Core.autoSelectValue(schema, 'top_uniform', { favorite_uniforms: ['tennis', 'baseball'] }), null);
  assert.equal(Core.autoSelectValue(schema, 'top_uniform', { favorite_uniforms: ['tennis', 'none'] }), 'tennis');
  assert.equal(Core.autoSelectValue(schema, 'top_uniform', {}), null);
  assert.equal(Core.autoSelectValue(schema, 'age_confirmed', { age_confirmed: 'yes' }), null);
});

test('source の選択変更で dynamic の旧値が候補外になると検出・除去される', () => {
  const answers = { favorite_uniforms: ['baseball'], top_uniform: 'soccer' };
  assert.deepEqual(Core.findStaleValues(schema, answers), [{ questionId: 'top_uniform', reason: 'option_unavailable', field: 'answers' }]);
  const r = Core.sanitizeAnswers(schema, answers);
  assert.equal('top_uniform' in r.answers, false);
});

test('top_uniform の変更が下流 top_uniform_sport_experience の可視性へ連鎖する', () => {
  const answers = { favorite_uniforms: ['baseball', 'soccer'], top_uniform: 'soccer', top_uniform_sport_experience: 'casual' };
  assert.equal(Core.isVisible(schema, 'top_uniform_sport_experience', answers), true);
  const changed = { favorite_uniforms: ['baseball'], top_uniform: 'soccer', top_uniform_sport_experience: 'casual' };
  const r = Core.sanitizeAnswers(schema, changed);
  assert.deepEqual(r.answers, { favorite_uniforms: ['baseball'] });
});

// ---- hidden 後の stale value ----

test('hidden 後の旧値を sanitize で state / payload から除去できる', () => {
  const answers = {
    club_awareness: NON_ATTENDEE,
    catchball_interest: 'low_interest', // 直前まで INTERESTED だった想定
    barriers: ['cost', 'other'],
    main_barrier: 'cost',
    near_term_participation_intent: 'definitely',
    uniform_social_interest: 'very_interested',
  };
  const others = { barriers: '雨が心配' };
  const before = JSON.stringify([answers, others]);
  const stale = Core.findStaleValues(schema, answers, others);
  assert.deepEqual(stale.map((s) => s.questionId + ':' + s.field).sort(), [
    'barriers:answers', 'barriers:other_texts', 'main_barrier:answers', 'near_term_participation_intent:answers',
  ]);
  const r = Core.sanitizeAnswers(schema, answers, others);
  assert.deepEqual(r.answers, { club_awareness: NON_ATTENDEE, catchball_interest: 'low_interest', uniform_social_interest: 'very_interested' });
  assert.deepEqual(r.other_texts, {});
  assert.equal(JSON.stringify([answers, others]), before, '入力は変更しない');
});

test('sanitize は未知のkeyも残さず、残すべき値は変えない', () => {
  const answers = { age_confirmed: 'yes', ghost: 'x', club_awareness: 'attended' };
  const r = Core.sanitizeAnswers(schema, answers, { ghost: 'y' });
  assert.deepEqual(r.answers, { age_confirmed: 'yes', club_awareness: 'attended' });
  assert.deepEqual(r.other_texts, {});
});

test('「その他」が外れた後に残った本文は stale', () => {
  const answers = { favorite_uniforms: ['baseball'] };
  const stale = Core.findStaleValues(schema, answers, { favorite_uniforms: '残った本文' });
  assert.deepEqual(stale, [{ questionId: 'favorite_uniforms', reason: 'other_text_stale', field: 'other_texts' }]);
});

// ---- required は visible だけ ----

test('required 判定は visible な設問だけが対象', () => {
  const low = { club_awareness: NON_ATTENDEE, catchball_interest: 'low_interest' };
  const required = Core.requiredQuestionIds(schema, low);
  assert.ok(required.includes('uniform_social_interest'));
  assert.ok(!required.includes('barriers'));
  assert.ok(!required.includes('overall_satisfaction'));
  assert.ok(!required.includes('feedback'), 'required:false は対象外');
});

test('hidden な required 設問は required エラーにならない', () => {
  const s = mini([
    single('gate', ['yes', 'no']),
    single('dep', ['a'], { showIf: { question: 'gate', equals: 'yes' } }),
  ]);
  const hiddenCase = Core.validateAnswers(s, { gate: 'no' });
  assert.equal(hiddenCase.ok, true);
  const visibleCase = Core.validateAnswers(s, { gate: 'yes' });
  assert.deepEqual(visibleCase.errors, [{ field: 'dep', code: 'required' }]);
  // hidden な設問に値があれば hidden_field（黙って受理しない）
  const staleCase = Core.validateAnswers(s, { gate: 'no', dep: 'a' });
  assert.deepEqual(staleCase.errors, [{ field: 'dep', code: 'hidden_field' }]);
  // sanitize 後は通る
  assert.equal(Core.validateAnswers(s, Core.sanitizeAnswers(s, { gate: 'no', dep: 'a' }).answers).ok, true);
});

// ---- multiple / exclusive / other ----

test('exclusive 選択時は他 option を解除し、他 option 選択時は exclusive を解除する', () => {
  const apply = (cur, opt, on) => Core.applyMultipleSelection(schema, 'barriers', cur, opt, on);
  assert.deepEqual(apply(['cost', 'schedule'], 'none', true), ['none']);
  assert.deepEqual(apply(['none'], 'cost', true), ['cost']);
  assert.deepEqual(apply(['cost'], 'schedule', true), ['schedule', 'cost'].sort((a, b) => ['schedule', 'cost'].indexOf(a) - ['schedule', 'cost'].indexOf(b)));
  assert.deepEqual(apply(['none'], 'none', false), []);
  assert.deepEqual(apply(['cost', 'schedule'], 'cost', false), ['schedule']);
  assert.deepEqual(apply([], 'unknown_option', true), []);
  const input = ['cost'];
  apply(input, 'none', true);
  assert.deepEqual(input, ['cost'], '入力は変更しない');
});

test('結果は schema の option 順に整う', () => {
  const r = Core.applyMultipleSelection(schema, 'favorite_uniforms', ['tennis'], 'baseball', true);
  assert.deepEqual(r, ['baseball', 'tennis']);
});

test('server validation: exclusive と他 option の同時選択は exclusive_conflict', () => {
  const answers = { favorite_uniforms: ['baseball', 'none'] };
  const r = Core.validateAnswers(schema, answers);
  assert.ok(r.errors.some((e) => e.field === 'favorite_uniforms' && e.code === 'exclusive_conflict'));
  const ok = Core.validateAnswers(schema, { favorite_uniforms: ['none'] });
  assert.ok(!ok.errors.some((e) => e.field === 'favorite_uniforms'));
});

test('other_text: 「その他」選択時だけ必須、未選択で本文があればエラー', () => {
  assert.deepEqual(Core.otherTextInfo(schema, 'favorite_uniforms', ['baseball']), { required: false, optionIds: ['other'], maxLength: 100 });
  assert.equal(Core.otherTextInfo(schema, 'favorite_uniforms', ['other']).required, true);
  assert.equal(Core.otherTextInfo(schema, 'barriers', ['other']).maxLength, 150);
  assert.equal(Core.otherTextInfo(schema, 'club_awareness', 'attended').required, false);
  assert.equal(Core.otherTextInfo(schema, 'ghost', ['other']).required, false);

  const base = { favorite_uniforms: ['other'] };
  const find = (r) => r.errors.filter((e) => e.field === 'favorite_uniforms');
  assert.deepEqual(find(Core.validateAnswers(schema, base)), [{ field: 'favorite_uniforms', code: 'other_text_required' }]);
  assert.deepEqual(find(Core.validateAnswers(schema, base, { favorite_uniforms: '  ' })), [{ field: 'favorite_uniforms', code: 'other_text_required' }]);
  assert.deepEqual(find(Core.validateAnswers(schema, base, { favorite_uniforms: 'x'.repeat(101) })), [{ field: 'favorite_uniforms', code: 'too_long' }]);
  const ok = Core.validateAnswers(schema, base, { favorite_uniforms: ' ソフトボール\r\n' });
  assert.deepEqual(find(ok), []);
  assert.equal(ok.clean.other_texts.favorite_uniforms, 'ソフトボール');
  assert.deepEqual(find(Core.validateAnswers(schema, { favorite_uniforms: ['baseball'] }, { favorite_uniforms: '余計' })), [{ field: 'favorite_uniforms', code: 'other_text_unexpected' }]);
});

test('すべての「その他」付き設問が otherMaxLength を持つ（本文長の上限が schema に定義されている）', () => {
  schema.questions.filter((q) => (q.options || []).some((o) => o.other)).forEach((q) => {
    assert.equal(typeof q.otherMaxLength, 'number', q.id);
    assert.equal(Core.otherTextInfo(schema, q.id, ['other']).maxLength, q.otherMaxLength);
  });
});

// ---- scale ----

test('scale: min..max とanchors、notApplicable は尺度外の独立値', () => {
  const scale = Core.getScale(schema, 'overall_satisfaction');
  assert.deepEqual(scale.points.map((p) => p.id), ['1', '2', '3', '4', '5']);
  assert.deepEqual(scale.points.map((p) => p.value), [1, 2, 3, 4, 5]);
  assert.equal(scale.points[0].label, '不満');
  assert.equal(scale.points[4].label, '満足');
  assert.deepEqual(scale.notApplicable, { id: 'cannot_rate', label: '評価できない' });
  assert.deepEqual(scale.orderedIds, ['1', '2', '3', '4', '5']);
  assert.deepEqual(scale.allIds, ['1', '2', '3', '4', '5', 'cannot_rate']);
  assert.equal(Core.getScale(schema, 'age_confirmed'), null);
});

test('scale: 検証は整数 / 文字列ID / notApplicable を受理し、範囲外・小数を拒否する', () => {
  const attended = { club_awareness: 'attended' };
  const run = (value) => Core.validateAnswers(schema, Object.assign({}, attended, { overall_satisfaction: value }));
  const err = (r) => r.errors.filter((e) => e.field === 'overall_satisfaction');
  assert.deepEqual(err(run(4)), []);
  assert.equal(run(4).clean.answers.overall_satisfaction, '4');
  assert.deepEqual(err(run('2')), []);
  assert.deepEqual(err(run('cannot_rate')), []);
  assert.equal(run('cannot_rate').clean.answers.overall_satisfaction, 'cannot_rate');
  assert.deepEqual(err(run(0)), [{ field: 'overall_satisfaction', code: 'invalid_option' }]);
  assert.deepEqual(err(run(6)), [{ field: 'overall_satisfaction', code: 'invalid_option' }]);
  assert.deepEqual(err(run(2.5)), [{ field: 'overall_satisfaction', code: 'invalid_option' }]);
  assert.deepEqual(err(run('na')), [{ field: 'overall_satisfaction', code: 'invalid_option' }]);
  assert.deepEqual(err(run(true)), [{ field: 'overall_satisfaction', code: 'invalid_type' }]);
  assert.deepEqual(err(run(undefined)), [{ field: 'overall_satisfaction', code: 'required' }]);
});

test('scale の値は条件からも文字列IDで参照できる（数値回答でも同じ）', () => {
  const s = mini([
    { id: 'r', type: 'scale', min: 1, max: 5, required: true, notApplicable: { id: 'na', label: 'NA' } },
    single('follow', ['x'], { showIf: { question: 'r', in: ['1', '2'] } }),
    single('na_follow', ['x'], { showIf: { question: 'r', equals: 'na' } }),
  ]);
  assert.equal(Core.isVisible(s, 'follow', { r: 2 }), true);
  assert.equal(Core.isVisible(s, 'follow', { r: '2' }), true);
  assert.equal(Core.isVisible(s, 'follow', { r: 4 }), false);
  assert.equal(Core.isVisible(s, 'follow', { r: 'na' }), false);
  assert.equal(Core.isVisible(s, 'na_follow', { r: 'na' }), true);
});

// ---- ordinal ----

test('ordinal 順の保持: scale は min..max で notApplicable を混ぜず、選択式は option 定義順', () => {
  assert.deepEqual(Core.ordinalOrder(schema, 'overall_satisfaction'), {
    orderedIds: ['1', '2', '3', '4', '5'],
    independentIds: ['cannot_rate'],
  });
  const awareness = Core.ordinalOrder(schema, 'catchball_interest');
  assert.deepEqual(awareness.orderedIds, ['very_interested', 'if_conditions', 'some_interest', 'low_interest', 'not_interested']);
  assert.deepEqual(awareness.independentIds, []);
  assert.equal(Core.ordinalOrder(schema, 'favorite_uniforms'), null, 'ordinal でない設問は並びを固定しない');
  assert.equal(Core.ordinalOrder(schema, 'ghost'), null);
});

test('ordinal:true の設問はすべて順序を返せる', () => {
  schema.questions.filter((q) => q.publication && q.publication.ordinal === true).forEach((q) => {
    const order = Core.ordinalOrder(schema, q.id);
    assert.ok(order && order.orderedIds.length > 0, q.id);
  });
});

// ---- publication ----

test('publication は question.publication を唯一の正本として読む', () => {
  const pub = Core.getPublication(schema, 'overall_satisfaction');
  assert.deepEqual(pub, schema.questions.find((q) => q.id === 'overall_satisfaction').publication);
  assert.equal(pub.visibility, 'public');
  assert.equal(pub.tier, 'bias_sensitive');
  assert.equal(pub.minTotal, 30);
  assert.equal(pub.minTarget, 20);
  assert.equal(pub.minCell, 3);
  assert.equal(pub.sensitiveBranch, true);
  assert.equal(pub.ordinal, true);
  assert.equal(pub.showZeroCells, true);
  assert.equal(pub.denominator, 'question_reached');

  const sorted = Core.getPublication(schema, 'favorite_uniforms');
  assert.equal(sorted.sort, 'count_desc');
  assert.equal(sorted.tieBreak, 'schema_option_order');
  assert.equal(sorted.showZeroCells, false);

  assert.deepEqual(Core.getPublication(schema, 'feedback'), { visibility: 'private' });
  assert.equal(Core.getPublication(schema, 'ghost'), null);
});

test('publication の返り値は schema を汚さない（コピー）', () => {
  const pub = Core.getPublication(schema, 'favorite_uniforms');
  pub.minCell = 999;
  assert.equal(schema.questions.find((q) => q.id === 'favorite_uniforms').publication.minCell, 3);
});

test('公開設問一覧は question.publication.visibility から導出し、別一覧を持たない', () => {
  const derived = schema.questions.filter((q) => q.publication && q.publication.visibility === 'public').map((q) => q.id);
  assert.deepEqual(Core.publicQuestionIds(schema), derived);
  assert.equal(Core.isPublic(schema, 'feedback'), false);
  assert.equal(Core.isPublic(schema, 'favorite_uniforms'), true);
  assert.ok(!/publicQuestionIds\s*=\s*\[|PUBLIC_QUESTIONS/.test(fs.readFileSync(CORE_PATH, 'utf8')));
});

test('denominator は question_reached。公開設問はすべて question_reached', () => {
  Core.publicQuestionIds(schema).forEach((id) => assert.equal(Core.denominatorOf(schema, id), 'question_reached', id));
  assert.equal(Core.denominatorOf(schema, 'feedback'), null);
});

test('targetCount = question_reached: 設問に到達した回答者数（回答の有無ではなく到達で数える）', () => {
  const records = [
    { club_awareness: 'attended', overall_satisfaction: 5 },
    { club_awareness: 'attended' }, // 到達したが未回答でも到達者に数える
    { club_awareness: NON_ATTENDEE, catchball_interest: INTERESTED },
    { club_awareness: NON_ATTENDEE, catchball_interest: 'low_interest', overall_satisfaction: 3 }, // hidden の旧値は到達にならない
  ];
  assert.equal(Core.countQuestionReached(schema, 'overall_satisfaction', records), 2);
  assert.equal(Core.countQuestionReached(schema, 'club_awareness', records), 4);
  assert.equal(Core.countQuestionReached(schema, 'barriers', records), 1);
  assert.equal(Core.countQuestionReached(schema, 'barriers', []), 0);
  assert.equal(Core.countQuestionReached(schema, 'barriers', null), 0);
  assert.ok(!/targetCount|reachedCount/.test(fs.readFileSync(CORE_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')), 'targetCount と question_reached を別概念として実装しない');
});

// ---- test mode ----

test('test mode: preview_no_submit / closed_view は client-only、submit_excluded は serverVerified', () => {
  const preview = Core.getTestMode(schema, 'preview_no_submit');
  assert.deepEqual([preview.clientOnly, preview.serverVerified, preview.responseMode, preview.countInValidResponses], [true, false, null, false]);
  const closed = Core.getTestMode(schema, 'closed_view');
  assert.deepEqual([closed.clientOnly, closed.serverVerified, closed.responseMode], [true, false, null]);
  const excluded = Core.getTestMode(schema, 'submit_excluded');
  assert.deepEqual([excluded.clientOnly, excluded.serverVerified, excluded.responseMode, excluded.countInValidResponses], [false, true, 'test', false]);
  const production = Core.getTestMode(schema, 'production');
  assert.deepEqual([production.clientOnly, production.serverVerified, production.responseMode, production.countInValidResponses], [false, false, 'production', true]);
});

test('test mode: 未知 mode は null、本番集計に含められるのは response_mode=production だけ', () => {
  assert.equal(Core.getTestMode(schema, 'live_test'), null);
  assert.equal(Core.getTestMode(schema, undefined), null);
  assert.equal(Core.getTestMode({}, 'production'), null);
  assert.equal(Core.isProductionResponseMode('production'), true);
  ['test', '', undefined, null, 'Production', 'preview_no_submit'].forEach((m) => assert.equal(Core.isProductionResponseMode(m), false, String(m)));
});

test('coreは旧test mode・無区切りhash・旧validation定数を持たない', () => {
  const src = fs.readFileSync(CORE_PATH, 'utf8');
  assert.ok(!/LIVE_TEST_ENABLED/.test(src));
  assert.ok(!/completion_status/.test(src));
  assert.ok(!/MIN_ELAPSED|minElapsed|respondent_hash|respondentHash|salt|sha256|digest/i.test(src), 'hash / 最短回答時間は #380 の責務');
  assert.ok(!/localStorage|sessionStorage|Date\.now|new Date|Math\.random|XMLHttpRequest|fetch\(/.test(src), '副作用・環境依存を持たない');
  assert.ok(!/costume|portrait/i.test(src.replace(/\/\*[\s\S]*?\*\//, '')), '本文中に衣装調査への依存を持たない');
});

// ---- termination / 型 / 副作用なし ----

test('termination: age_confirmed = no は ineligible', () => {
  assert.deepEqual(Core.findTermination(schema, { age_confirmed: 'no' }), { questionId: 'age_confirmed', status: 'ineligible' });
  assert.equal(Core.findTermination(schema, { age_confirmed: 'yes' }), null);
  assert.equal(Core.findTermination(schema, {}), null);
});

test('text: trim・制御文字・長さ', () => {
  const run = (v) => Core.validateAnswers(schema, { feedback: v }).errors.filter((e) => e.field === 'feedback');
  assert.deepEqual(run(undefined), []);
  assert.deepEqual(run('  '), [], 'required:false の空白のみは未回答');
  assert.deepEqual(run('a\u0000b'), [{ field: 'feedback', code: 'invalid_text' }]);
  assert.deepEqual(run('あ'.repeat(501)), [{ field: 'feedback', code: 'too_long' }]);
  assert.deepEqual(run('あ'.repeat(500)), []);
  assert.deepEqual(run(5), [{ field: 'feedback', code: 'invalid_type' }]);
});

test('未知の question type は黙って通さない', () => {
  const s = mini([{ id: 'legacy', type: 'matrix', required: true }]);
  assert.deepEqual(Core.validateAnswers(s, {}).errors, [{ field: 'legacy', code: 'unknown_question_type' }]);
  assert.equal(Core.evalCondition(mini([{ id: 'legacy', type: 'matrix' }]), { question: 'legacy', equals: 'a' }, { legacy: 'a' }), false);
});

test('不正な入力型・未知 key', () => {
  assert.deepEqual(Core.validateAnswers(schema, null).errors, [{ field: 'answers', code: 'invalid_type' }]);
  assert.deepEqual(Core.validateAnswers(schema, {}, 'x').errors, [{ field: 'other_texts', code: 'invalid_type' }]);
  assert.ok(Core.validateAnswers(schema, { ghost: 'x' }).errors.some((e) => e.field === 'ghost' && e.code === 'unknown_field'));
  assert.ok(Core.validateAnswers(schema, {}, { club_awareness: 'x' }).errors.some((e) => e.field === 'club_awareness' && e.code === 'unknown_field'));
});

test('通しで有効な最短ルートの回答を検証できる（low-interest route）', () => {
  const answers = {
    age_confirmed: 'yes',
    favorite_uniforms: ['none'],
    uniform_appeal: undefined,
  };
  delete answers.uniform_appeal;
  const visible = Core.visibleQuestions(schema, answers);
  assert.ok(visible.length > 0);
  const r = Core.validateAnswers(schema, answers);
  // 必須の未回答は required として返る。hidden な設問は返らない
  const requiredErrors = r.errors.filter((e) => e.code === 'required').map((e) => e.field);
  const visibleRequired = Core.requiredQuestionIds(schema, answers).filter((id) => !(id in answers));
  assert.deepEqual(requiredErrors, visibleRequired);
});

test('schema と answers を書き換えない', () => {
  const before = JSON.stringify(schema);
  const answers = { club_awareness: NON_ATTENDEE, catchball_interest: INTERESTED, barriers: ['cost'], main_barrier: 'cost' };
  const answersBefore = JSON.stringify(answers);
  Core.visibleQuestionIds(schema, answers);
  Core.validateAnswers(schema, answers, {});
  Core.sanitizeAnswers(schema, answers, {});
  Core.getDynamicOptions(schema, 'main_barrier', answers);
  Core.getPublication(schema, 'barriers');
  assert.equal(JSON.stringify(schema), before);
  assert.equal(JSON.stringify(answers), answersBefore);
});

test('実 schema の全 condition / showIf が評価器で解釈できる（演算子・参照の取りこぼしなし）', () => {
  const ops = new Set(['equals', 'notEquals', 'in', 'contains', 'notContains', 'hasAnyExcept']);
  const walk = (node, acc) => {
    if (!node || typeof node !== 'object') return;
    if ('conditionRef' in node) { acc.refs.add(node.conditionRef); return; }
    ['all', 'any'].forEach((g) => { if (Array.isArray(node[g])) node[g].forEach((c) => walk(c, acc)); });
    Object.keys(node).forEach((k) => { if (ops.has(k)) acc.ops.add(k); });
  };
  const acc = { ops: new Set(), refs: new Set() };
  Object.values(schema.conditions).forEach((c) => walk(c, acc));
  schema.questions.forEach((q) => walk(q.showIf, acc));
  acc.refs.forEach((name) => assert.ok(name in schema.conditions, name));
  acc.ops.forEach((op) => assert.ok(ops.has(op), op));
  // 実 schema の question type はすべて core が解釈する
  const types = new Set(schema.questions.map((q) => q.type));
  assert.deepEqual([...types].sort(), ['multiple', 'scale', 'single', 'single_dynamic', 'text']);
});
