'use strict';

// 実物の survey.schema.json（design v2.17）に対するテスト。Issue #378。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { validateSchema, lowInterestOptionIds, DEFAULT_SCHEMA_PATH } = require('../tools/validate-schema');

const SURVEY_DIR = path.join(__dirname, '..');
const raw = fs.readFileSync(DEFAULT_SCHEMA_PATH, 'utf8');
const schema = JSON.parse(raw);
const q = (id) => schema.questions.find((x) => x.id === id);

test('survey.schema.json は parse でき design_version は 2.17', () => {
  assert.equal(schema.design_version, '2.17');
  assert.equal(schema.survey_id, 'nagoya_baseball_uniform_club_2026');
  assert.equal(schema.survey_version, '2026-10');
  assert.ok(Array.isArray(schema.questions) && schema.questions.length > 0);
});

test('参照整合 validation が全項目エラー 0', () => {
  const errors = validateSchema(schema);
  assert.deepEqual(errors, []);
});

test('v2.17 で必須の構成要素が存在する', () => {
  for (const key of [
    'barrierCodes', 'conditions', 'publicResultsOrder', 'sectionUx', 'routeUx',
    'respondentNotice', 'privacyNotice', 'testModes', 'persistenceSchema', 'publicationPolicy',
  ]) {
    assert.ok(schema[key], `${key} がありません`);
  }
  for (const id of [
    'catchball_interest', 'uniform_social_interest', 'activity_stopped_reasons', 'adult_context',
    'exercise_frequency', 'exercise_continuation_motivation', 'exercise_motivation',
  ]) {
    assert.ok(q(id), `${id} がありません`);
  }
  assert.ok(schema.questions.every((x) => x.publication && x.publication.visibility), '全設問が publication object を持つ');
  assert.ok(schema.questions.some((x) => x.options && x.options.some((o) => o.semanticCodes)), 'semanticCodes');
  assert.ok(schema.questions.some((x) => x.options && x.options.some((o) => o.reassuranceFor)), 'reassuranceFor');
});

test('retention は launch blocker のまま（期限を勝手に決めない）', () => {
  assert.equal(schema.respondentNotice.retention.status, 'must_set_before_launch');
  assert.ok(!JSON.stringify(schema.respondentNotice.retention).match(/\d+\s*(日|か月|ヶ月|年|days|months|years)/));
});

// ---- v2.17 回帰: 過去に実際に参照不整合が出た箇所 ----

test('catchball_interest は 5 段階の正式 option ID', () => {
  assert.deepEqual(q('catchball_interest').options.map((o) => o.id), [
    'very_interested', 'if_conditions', 'some_interest', 'low_interest', 'not_interested',
  ]);
});

test('回帰1: uniform_social_interest.showIf が low_interest / not_interested を参照', () => {
  assert.deepEqual(q('uniform_social_interest').showIf, {
    all: [
      { question: 'club_awareness', in: ['aware_not_attended', 'name_only', 'first_time'] },
      { question: 'catchball_interest', in: ['low_interest', 'not_interested'] },
    ],
  });
});

test('回帰2: sectionUx.lowInterestAcknowledgement.trigger が同じ 2 値を参照', () => {
  assert.deepEqual(schema.sectionUx.lowInterestAcknowledgement.trigger, {
    question: 'catchball_interest',
    in: ['low_interest', 'not_interested'],
  });
});

test('回帰3: routeUx.pure_uniform_short_route.trigger が同じ 2 値を参照', () => {
  assert.deepEqual(schema.routeUx.pure_uniform_short_route.trigger, {
    all: [
      { question: 'club_awareness', in: ['aware_not_attended', 'name_only', 'first_time'] },
      { question: 'catchball_interest', in: ['low_interest', 'not_interested'] },
    ],
  });
});

test('低関心 route の 3 参照が一致し、catchball_interest の実在 option である', () => {
  const refs = lowInterestOptionIds(schema);
  const all = Object.values(refs);
  assert.equal(all.length, 3);
  const ids = q('catchball_interest').options.map((o) => o.id);
  for (const list of all) {
    assert.deepEqual([...list].sort(), ['low_interest', 'not_interested']);
    for (const id of list) assert.ok(ids.includes(id));
  }
});

test('低関心 route と参加関心あり route は catchball_interest を過不足なく二分する', () => {
  const interested = schema.conditions.nonattendee_interested.all
    .find((c) => c.question === 'catchball_interest').in;
  const low = lowInterestOptionIds(schema)['uniform_social_interest.showIf'];
  const ids = q('catchball_interest').options.map((o) => o.id);
  assert.deepEqual([...interested, ...low].sort(), [...ids].sort());
});

test('回帰4: activity_stopped_reasons = activity_history_eligible AND activity_stopped == yes', () => {
  assert.deepEqual(q('activity_stopped_reasons').showIf, {
    all: [
      { conditionRef: 'activity_history_eligible' },
      { question: 'activity_stopped', equals: 'yes' },
    ],
  });
});

test('回帰5: adult_context = activity_history_eligible AND adult_sports hasAnyExcept [none]', () => {
  assert.deepEqual(q('adult_context').showIf, {
    all: [
      { conditionRef: 'activity_history_eligible' },
      { question: 'adult_sports', hasAnyExcept: ['none'] },
    ],
  });
});

test('exercise_frequency は全層共通（showIf なし・pure uniform route にも含まれる）', () => {
  const freq = q('exercise_frequency');
  assert.equal(freq.showIf, undefined);
  assert.equal(freq.required, true);
  assert.equal(freq.publication.visibility, 'public');
  assert.ok(schema.routeUx.pure_uniform_short_route.flow.includes('exercise_frequency'));
});

test('exercise_continuation_motivation と exercise_motivation は分離されている', () => {
  const cont = q('exercise_continuation_motivation');
  const future = q('exercise_motivation');
  assert.notEqual(cont.id, future.id);
  assert.deepEqual(cont.showIf, {
    question: 'exercise_frequency',
    in: ['three_plus_week', 'one_two_week', 'one_three_month', 'less_monthly'],
  });
  assert.equal(future.showIf, undefined);
  assert.ok(schema.routeUx.pure_uniform_short_route.flow.includes('exercise_motivation'));
  assert.ok(!schema.routeUx.pure_uniform_short_route.flow.includes('exercise_continuation_motivation'));
});

test('長期離脱は conditions.lapsed_attendee を唯一の正本として参照する', () => {
  assert.ok(schema.conditions.lapsed_attendee);
  for (const id of ['attendance_lapse_reasons', 'rejoin_conditions']) {
    assert.deepEqual(q(id).showIf, { conditionRef: 'lapsed_attendee' }, id);
  }
  // 質問側に lapsed の判定ロジックを再定義していない
  for (const x of schema.questions) {
    if (['attendance_lapse_reasons', 'rejoin_conditions'].includes(x.id)) continue;
    assert.ok(!JSON.stringify(x.showIf || {}).includes('last_attended'), `${x.id} が last_attended を再定義`);
  }
});

test('dynamic option 由来の設問は静的 option 検査で誤検知されない', () => {
  // top_uniform は options を持たず、showIf で参照されても favorite_uniforms 由来で検証される
  assert.equal(q('top_uniform').options, undefined);
  const ref = q('top_uniform_sport_experience').showIf;
  assert.equal(ref.question, 'top_uniform');
  assert.ok(!ref.in.includes('none'));
  assert.deepEqual(validateSchema(schema).filter((e) => /top_uniform|main_barrier/.test(e.message)), []);
});

test('testModes.activation: preview_no_submit / closed_view は client-only、submit_excluded のみ server 検証', () => {
  const a = schema.testModes.activation;
  assert.deepEqual([...a.clientOnlyModes].sort(), ['closed_view', 'preview_no_submit']);
  assert.deepEqual(a.serverVerifiedModes, ['submit_excluded']);
  assert.equal(schema.testModes.modes.preview_no_submit.submitBehavior, 'simulate_success_without_save');
  assert.equal(schema.testModes.modes.closed_view.submitBehavior, 'disabled');
  assert.equal(schema.testModes.modes.submit_excluded.submitBehavior, 'save_as_test');
});

test('公開 repo 上の注意: survey ディレクトリに実データ・secret を置かない', () => {
  const allowed = new Set(['.json', '.js', '.md']);
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.name === 'node_modules') return [];
    return e.isDirectory() ? walk(p) : [p];
  });
  for (const file of walk(SURVEY_DIR)) {
    assert.ok(allowed.has(path.extname(file)), `許可されない拡張子: ${path.relative(SURVEY_DIR, file)}`);
  }
  assert.ok(!/(?:salt|secret|token)\s*["']?\s*[:=]\s*["'][A-Za-z0-9+/_-]{16,}/i.test(raw), 'secret らしき値');
});
