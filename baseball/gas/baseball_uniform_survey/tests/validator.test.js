'use strict';

// validator 自体の負例テスト。壊した schema を確実に検出できることを固定する（Issue #378）。
// 入力はすべて実 schema をメモリ上で書き換えた架空データで、実回答データは含まない。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { validateSchema, DEFAULT_SCHEMA_PATH } = require('../tools/validate-schema');

const base = fs.readFileSync(DEFAULT_SCHEMA_PATH, 'utf8');
const clone = () => JSON.parse(base);
const find = (s, id) => s.questions.find((x) => x.id === id);
const codes = (s) => validateSchema(s).map((e) => e.code);

function expectCode(mutate, code) {
  const s = clone();
  mutate(s);
  assert.ok(codes(s).includes(code), `${code} が検出されること: got [${codes(s).join(', ')}]`);
}

test('ベースラインはエラー 0', () => {
  assert.deepEqual(validateSchema(clone()), []);
});

test('question ID 重複', () => expectCode((s) => { s.questions.push({ ...find(s, 'age') }); }, 'question_id_duplicate'));
test('option ID 重複', () => expectCode((s) => { const o = find(s, 'age').options; o.push({ ...o[0] }); }, 'option_id_duplicate'));
test('showIf の question 参照切れ', () => expectCode((s) => { find(s, 'aichi_area').showIf.question = 'no_such_q'; }, 'showif_question_missing'));
test('showIf の option 参照切れ（equals）', () => expectCode((s) => { find(s, 'aichi_area').showIf.equals = 'pref_99'; }, 'showif_option_missing'));
test('showIf の option 参照切れ（in）', () => expectCode((s) => { find(s, 'uniform_social_interest').showIf.all[1].in = ['low_interest', 'no_such']; }, 'showif_option_missing'));
test('hasAnyExcept の option 参照切れ', () => expectCode((s) => { find(s, 'adult_context').showIf.all[1].hasAnyExcept = ['nope']; }, 'showif_option_missing'));
test('equals を multiple 設問へ使う型不整合', () => expectCode((s) => { find(s, 'adult_context').showIf.all[1] = { question: 'adult_sports', equals: 'none' }; }, 'condition_type'));
test('hasAnyExcept を single 設問へ使う型不整合', () => expectCode((s) => { find(s, 'aichi_area').showIf = { question: 'prefecture', hasAnyExcept: ['pref_23'] }; }, 'condition_type'));
test('conditionRef 参照切れ', () => expectCode((s) => { find(s, 'rejoin_conditions').showIf = { conditionRef: 'no_such_condition' }; }, 'condition_ref_missing'));
test('conditionRef 循環', () => expectCode((s) => { s.conditions.a = { conditionRef: 'b' }; s.conditions.b = { conditionRef: 'a' }; }, 'condition_ref_cycle'));
test('conditions 内の参照切れ', () => expectCode((s) => { s.conditions.lapsed_attendee.all[1].in.push('ghost'); }, 'showif_option_missing'));
test('sourceQuestion 参照切れ', () => expectCode((s) => { find(s, 'top_uniform').sourceQuestion = 'ghost'; }, 'source_question_missing'));
test('sourceQuestion が multiple でない', () => expectCode((s) => { find(s, 'top_uniform').sourceQuestion = 'age'; }, 'source_question_type'));
test('excludeOptionIds が source に存在しない', () => expectCode((s) => { find(s, 'top_uniform').excludeOptionIds = ['ghost']; }, 'exclude_option_missing'));
test('dynamic 由来 option の参照切れ（top_uniform の none は除外済み）', () => expectCode((s) => { find(s, 'top_uniform_sport_experience').showIf.in.push('none'); }, 'showif_option_missing'));
test('semanticCodes.primary が barrierCodes に未定義', () => expectCode((s) => { find(s, 'barriers').options[0].semanticCodes.primary = 'ghost'; }, 'semantic_code_undefined'));
test('semanticCodes.secondary が barrierCodes に未定義', () => expectCode((s) => { find(s, 'barriers').options[5].semanticCodes.secondary = ['ghost']; }, 'semantic_code_undefined'));
test('reassuranceFor が barrierCodes に未定義', () => expectCode((s) => { find(s, 'participation_conditions').options[0].reassuranceFor = ['ghost']; }, 'reassurance_code_undefined'));
test('publicResultsOrder の question 参照切れ', () => expectCode((s) => { s.publicResultsOrder.push('ghost'); }, 'public_order_question_missing'));
test('public 設問が publicResultsOrder から漏れる', () => expectCode((s) => { s.publicResultsOrder = s.publicResultsOrder.filter((x) => x !== 'barriers'); }, 'public_order_omitted'));
test('private 設問が publicResultsOrder に入る', () => expectCode((s) => { s.publicResultsOrder.push('age'); }, 'public_order_not_public'));
test('publicResultsOrder の重複', () => expectCode((s) => { s.publicResultsOrder.push('barriers'); }, 'public_order_duplicate'));
test('routeUx.flow の question 参照切れ', () => expectCode((s) => { s.routeUx.pure_uniform_short_route.flow.push('ghost'); }, 'route_flow_question_missing'));
test('required 設問の section 欠落', () => expectCode((s) => { delete find(s, 'age').section; }, 'required_section_missing'));
test('ordinal:true と sort の同時指定を拒否', () => expectCode((s) => { find(s, 'exercise_frequency').publication.sort = 'count_desc'; }, 'ordinal_with_sort'));
test('ordinal:false で sort なし', () => expectCode((s) => { delete find(s, 'barriers').publication.sort; }, 'nominal_without_sort'));
test('publication object 欠落', () => expectCode((s) => { delete find(s, 'age').publication; }, 'publication_missing'));
test('public の minCell < 3', () => expectCode((s) => { find(s, 'barriers').publication.minCell = 2; }, 'min_cell'));
test('public の minCell 欠落', () => expectCode((s) => { delete find(s, 'barriers').publication.minCell; }, 'min_cell'));
test('branch public の minTarget < 10', () => expectCode((s) => { find(s, 'barriers').publication.minTarget = 9; }, 'min_target'));
test('branch public の minTarget 欠落', () => expectCode((s) => { delete find(s, 'barriers').publication.minTarget; }, 'min_target'));
test('sensitive branch の minTarget < 20', () => expectCode((s) => { find(s, 'repeat_intent').publication.minTarget = 10; }, 'min_target_sensitive'));
test('低関心 route の trigger が実在しない option を参照', () => expectCode((s) => { s.routeUx.pure_uniform_short_route.trigger.all[1].in = ['low_interest', 'no_interest']; }, 'low_interest_option_missing'));
test('低関心 route の 3 参照の不一致', () => expectCode((s) => { s.sectionUx.lowInterestAcknowledgement.trigger.in = ['low_interest']; }, 'low_interest_mismatch'));
test('低関心 trigger が欠落', () => expectCode((s) => { delete s.sectionUx.lowInterestAcknowledgement; }, 'low_interest_trigger_missing'));
test('地方block の option 割り当て漏れ', () => expectCode((s) => { s.publicRegionAggregation.blocks[1].prefectureOptionIds.pop(); }, 'region_option_unmapped'));
test('testModes.activation の分類が欠落', () => expectCode((s) => { delete s.testModes.activation.clientOnlyModes; }, 'test_modes_activation'));
test('closed_view を server 検証対象へ移すと拒否', () => expectCode((s) => {
  s.testModes.activation.clientOnlyModes = ['preview_no_submit'];
  s.testModes.activation.serverVerifiedModes = ['closed_view', 'submit_excluded'];
}, 'test_modes_activation'));
test('test mode が本番集計に含まれると拒否', () => expectCode((s) => { s.testModes.modes.submit_excluded.includeInPublicResults = true; }, 'test_modes_isolation'));

test('schema の形が壊れていても例外にならない', () => {
  assert.deepEqual(codes({}), ['schema_shape']);
  assert.deepEqual(codes(null), ['schema_shape']);
});
