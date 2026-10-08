'use strict';
// Issue #361: Admin（OWNER専用）の需要ファネル。既存設問・stable IDだけで集計し、設問/schema/Spreadsheet列/Public結果は変えない。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadAdmin, loadPublic, validPayload, plain } = require('./helpers/gas-env');

const ROOT = path.join(__dirname, '..');
const NOW = new Date('2026-11-01T12:00:00+09:00');
const MATRIX_DEFAULT = 'interested'; // validPayload の既定（scale[2]）。近い将来の意向には含めない値

function m(rows) {
  const base = {};
  ['get_portrait', 'shoot_model', 'rent_studio', 'join_shoot_event', 'join_small_session', 'try_lighting', 'learn_shooting', 'meet_people']
    .forEach((r) => { base[r] = MATRIX_DEFAULT; });
  return Object.assign(base, rows);
}

/* 6人（手計算で期待値を固定）。R3/R5 は Q20 で対象外のため Q21〜Q26 は null（非表示） */
const RESPONDENTS = [
  { // R1
    portrait_interest: 'very_interested', costume_photographed: ['uniform'], portrait_price: '7000_8999', age_range: 'age_20_24',
    residence: 'pref_23', aichi_area: 'nagoya_city', shooter_interest: 'currently_shooting', studio_rental: 'want_to_try',
    equipment_wanted: ['monoblock_strobe', 'clip_on_strobe'], rental_price: '4000_4999',
    intent_3m: m({ get_portrait: 'definitely', rent_studio: 'if_conditions_fit', try_lighting: 'definitely', shoot_model: 'definitely' })
  },
  { // R2
    portrait_interest: 'interested', costume_photographed: ['suit'], portrait_price: '5000_6999', age_range: 'age_20_24',
    residence: 'pref_23', aichi_area: 'owari', shooter_interest: 'want_to_try', studio_rental: 'if_conditions_fit',
    equipment_wanted: ['led_video_light', 'rgb_light'], equipment_experience: 'almost_cannot', equipment_support: ['brief_explanation'],
    rental_price: '3000_3999',
    intent_3m: m({ get_portrait: 'if_conditions_fit', join_small_session: 'definitely', try_lighting: 'if_conditions_fit' })
  },
  { // R3: 興味は薄いが3か月以内に撮られたい。撮影者ではない（Q21〜Q26は対象外）
    portrait_interest: 'neutral', costume_photographed: ['uniform'], portrait_price: 'under_3000', age_range: 'age_30_34',
    residence: 'pref_13', shooter_interest: 'subject_only', intent_3m: m({ get_portrait: 'definitely' })
  },
  { // R4
    portrait_interest: 'very_interested', costume_photographed: ['suit', 'uniform'], portrait_price: '12000_14999', age_range: 'age_30_34',
    residence: 'pref_27', shooter_interest: 'slightly_interested', studio_rental: 'not_really',
    equipment_wanted: ['monoblock_strobe', 'rgb_light'], rental_price: 'under_2000',
    intent_3m: m({ join_small_session: 'if_conditions_fit', meet_people: 'definitely' })
  },
  { // R5
    portrait_interest: 'not_at_all', shooter_interest: 'not_interested', age_range: 'age_40_49', intent_3m: m({ get_portrait: 'no' })
  },
  { // R6
    portrait_interest: 'interested', costume_photographed: ['uniform'], portrait_price: '9000_11999', age_range: 'age_20_24',
    residence: 'pref_23', aichi_area: 'mikawa', shooter_interest: 'want_to_try', studio_rental: 'already_using',
    equipment_wanted: ['softbox'], rental_price: '8000_plus',
    intent_3m: m({ get_portrait: 'if_conditions_fit', rent_studio: 'definitely', shoot_model: 'if_conditions_fit' })
  }
];

function setup(respondents = RESPONDENTS) {
  const pub = loadPublic();
  respondents.forEach((overrides) => {
    const payload = validPayload(pub.ctx, overrides);
    const result = plain(pub.ctx.processSubmission_(JSON.stringify(payload), NOW));
    assert.strictEqual(result.ok, true, JSON.stringify(result));
  });
  const admin = loadAdmin();
  admin.env.spreadsheet = pub.env.spreadsheet;
  // google.script.run は値をJSONで受け渡すため、往復させて同じ形にする。
  const call = () => ({ data: JSON.parse(JSON.stringify(admin.ctx.getDashboardData())) });
  return { pub, admin, call };
}

const funnelOf = (data, id) => data.demandFunnels.funnels.find((f) => f.id === id);
const counts = (stages) => stages.map((s) => s.count);
const cross = (funnel, segId, axis) => funnel.segments.find((s) => s.id === segId).crosses.find((c) => c.axis === axis);
const byId = (cr) => Object.fromEntries(cr.options.map((o) => [o.id, o.count]));

test('①撮られたい：ファネル段階・3か月以内層（Q27の定義と一致）と前段階比／全回答者比', () => {
  const { call } = setup();
  const data = call().data;
  const f = funnelOf(data, 'photographed');
  assert.deepStrictEqual(counts(f.stages), [6, 4, 4, 3, 3, 2]);
  assert.deepStrictEqual(f.stages.map((s) => s.prevPct), [null, 66.7, 100, 75, 100, 66.7]);
  assert.deepStrictEqual(f.stages.map((s) => s.allPct), [100, 66.7, 66.7, 50, 50, 33.3]);
  const seg = f.segments[0];
  // 「ぜひやりたい」「条件が合えばやりたい」のみ。興味が薄いR3も含み、「興味はある」(R4)・「しない」(R5)は含まない
  assert.strictEqual(seg.count, 4);
  assert.strictEqual(data.demandFunnels.base, 6);
});

test('①撮られたい：3か月以内層 × 年代・地域・愛知県内地域・衣装・価格のクロス', () => {
  const f = funnelOf(setup().call().data, 'photographed');
  const age = cross(f, 'near_term_photographed', 'age_range');
  assert.strictEqual(age.answered, 4);
  assert.deepStrictEqual({ a: byId(age).age_20_24, b: byId(age).age_30_34, c: byId(age).age_40_49 }, { a: 3, b: 1, c: 0 });
  assert.strictEqual(age.options.find((o) => o.id === 'age_20_24').pct, 75);
  const residence = cross(f, 'near_term_photographed', 'residence');
  assert.deepStrictEqual(residence.options.map((o) => [o.id, o.count]), [['pref_13', 1], ['pref_23', 3]]); // 0件は出さない
  const aichi = cross(f, 'near_term_photographed', 'aichi_area');
  assert.strictEqual(aichi.answered, 3);
  assert.strictEqual(aichi.notApplicable, 1); // 愛知県外（R3）は分岐対象外。母数に入れない
  assert.deepStrictEqual([byId(aichi).nagoya_city, byId(aichi).owari, byId(aichi).mikawa], [1, 1, 1]);
  assert.strictEqual(aichi.options.find((o) => o.id === 'owari').pct, 33.3);
  const costume = byId(cross(f, 'near_term_photographed', 'costume_photographed'));
  assert.deepStrictEqual([costume.uniform, costume.suit], [3, 1]);
  const price = byId(cross(f, 'near_term_photographed', 'portrait_price'));
  assert.deepStrictEqual([price.under_3000, price['5000_6999'], price['7000_8999'], price['9000_11999'], price['12000_14999']], [1, 1, 1, 1, 0]);
  ['portrait_styles', 'shoot_duration', 'weekdays', 'weekday_time_slots', 'holiday_time_slots', 'hesitation', 'face_exposure', 'photo_usage']
    .forEach((axis) => assert.ok(cross(f, 'near_term_photographed', axis), axis));
  const triple = f.triples[0];
  assert.strictEqual(triple.included, 4);
  assert.deepStrictEqual(triple.axisLabels, ['年代', '居住地域', 'ポートレート価格']);
  assert.strictEqual(triple.rows.length, 4);
  assert.ok(triple.rows.every((r) => r.count === 1 && r.labels.length === 3));
});

test('①撮影経験は既存設問に無いため集計せず、判定不能として明示する', () => {
  const data = setup().call().data;
  const f = funnelOf(data, 'photographed');
  assert.ok(!f.segments[0].crosses.some((c) => /経験/.test(c.label)));
  const ids = data.demandFunnels.unavailable.map((u) => u.id);
  assert.deepStrictEqual(ids, ['subject_experience', 'self_shoot_video']);
});

test('②スタジオ：ファネル件数と、利用意向 / 3か月以内 × 価格・地域・人数・背景・機材のクロス', () => {
  const f = funnelOf(setup().call().data, 'studio');
  assert.deepStrictEqual(counts(f.stages), [6, 4, 3, 2, 2]);
  assert.deepStrictEqual(f.stages.map((s) => s.prevPct), [null, 66.7, 75, 66.7, 100]);
  const wanted = f.segments.find((s) => s.id === 'studio_wanted');
  assert.strictEqual(wanted.count, 3);
  ['age_range', 'residence', 'party_size', 'rental_price', 'backdrop', 'equipment_wanted'].forEach((a) => assert.ok(cross(f, 'studio_wanted', a), a));
  const price = byId(cross(f, 'studio_wanted', 'rental_price'));
  assert.deepStrictEqual([price['4000_4999'], price['3000_3999'], price['8000_plus'], price.under_2000], [1, 1, 1, 0]); // R4(不要)は含まれない
  const near = f.segments.find((s) => s.id === 'near_term_studio');
  assert.strictEqual(near.count, 2);
  const nearPrice = byId(cross(f, 'near_term_studio', 'rental_price'));
  assert.deepStrictEqual([nearPrice['4000_4999'], nearPrice['8000_plus'], nearPrice['3000_3999']], [1, 1, 0]);
  assert.deepStrictEqual(cross(f, 'near_term_studio', 'residence').options.map((o) => [o.id, o.count]), [['pref_23', 2]]);
});

test('③照明：ストロボ系／常時光系／両方／常時光のみ／ストロボのみ。複数選択は1人1回だけ数える', () => {
  const f = funnelOf(setup().call().data, 'lighting');
  assert.strictEqual(f.breakdownBase.count, 4); // Q23に回答した人（Q20で撮影に興味あり）。R3/R5(対象外=null)は入らない
  const get = (prefix) => f.breakdown.find((x) => x.label.startsWith(prefix));
  assert.strictEqual(get('ストロボ系を使いたい').count, 2); // R1はストロボを2つ選んでも1人
  assert.strictEqual(get('常時光系を使いたい').count, 2);
  assert.strictEqual(get('両方').count, 1);
  assert.strictEqual(get('常時光のみ').count, 1);
  assert.strictEqual(get('ストロボのみ').count, 1);
  assert.strictEqual(get('どちらも選ばず').count, 1); // R6（ソフトボックスのみ）。null(R3/R5)は含めない
  assert.strictEqual(get('（内訳）RGB').count, 2);
  assert.strictEqual(get('（内訳）LED').count, 1);
  assert.strictEqual(get('ストロボ系を使いたい').pct, 50);
  assert.deepStrictEqual(counts(f.stages), [6, 4, 3, 2]);
});

test('③照明：種別 × 年代・機材経験・サポート需要・3か月以内の機材利用意向', () => {
  const f = funnelOf(setup().call().data, 'lighting');
  const strobeAge = byId(cross(f, 'strobe_wanted', 'age_range'));
  assert.deepStrictEqual([strobeAge.age_20_24, strobeAge.age_30_34], [1, 1]);
  const constantAge = byId(cross(f, 'constant_wanted', 'age_range'));
  assert.deepStrictEqual([constantAge.age_20_24, constantAge.age_30_34], [1, 1]);
  const constantExp = byId(cross(f, 'constant_wanted', 'equipment_experience'));
  assert.deepStrictEqual([constantExp.almost_cannot, constantExp.fluent], [1, 1]);
  const strobeExp = byId(cross(f, 'strobe_wanted', 'equipment_experience'));
  assert.strictEqual(strobeExp.fluent, 2);
  const support = byId(cross(f, 'constant_wanted', 'equipment_support'));
  assert.deepStrictEqual([support.brief_explanation, support.gear_only], [1, 1]);
  const rgbSupport = byId(cross(f, 'rgb_wanted', 'equipment_support'));
  assert.deepStrictEqual([rgbSupport.brief_explanation, rgbSupport.gear_only], [1, 1]);
  const strobe3m = byId(cross(f, 'strobe_wanted', 'intent_3m:try_lighting'));
  assert.deepStrictEqual([strobe3m.definitely, strobe3m.interested], [1, 1]);
  const constant3m = byId(cross(f, 'constant_wanted', 'intent_3m:try_lighting'));
  assert.deepStrictEqual([constant3m.if_conditions_fit, constant3m.interested], [1, 1]);
  const near = f.segments.find((s) => s.id === 'near_term_lighting');
  assert.strictEqual(near.count, 2);
  const type = byId(cross(f, 'near_term_lighting', 'lighting_type'));
  assert.deepStrictEqual([type.strobe_only, type.constant_only, type.both, type.neither], [1, 1, 0, 0]);
});

test('④撮りたい人：ファネルと撮影者意向 × 年代・地域・衣装・スタジオ・照明種別・機材経験・サポート', () => {
  const f = funnelOf(setup().call().data, 'shooter');
  assert.deepStrictEqual(counts(f.stages), [6, 4, 3, 3, 2, 1]);
  const seg = f.segments[0];
  assert.strictEqual(seg.count, 4);
  assert.deepStrictEqual(seg.crosses.map((c) => c.axis),
    ['age_range', 'residence', 'costume_shoot', 'studio_rental', 'lighting_type', 'equipment_experience', 'equipment_support']);
  const studio = byId(cross(f, 'shooter_interest', 'studio_rental'));
  assert.deepStrictEqual([studio.already_using, studio.want_to_try, studio.if_conditions_fit, studio.not_really], [1, 1, 1, 1]);
  const type = byId(cross(f, 'shooter_interest', 'lighting_type'));
  assert.deepStrictEqual([type.both, type.constant_only, type.strobe_only, type.neither], [1, 1, 1, 1]);
});

test('⑤イベント：撮影イベント／少人数撮影会／交流を分離し、少人数撮影会意向 × 年代・地域・衣装・価格・不安', () => {
  const f = funnelOf(setup().call().data, 'event');
  assert.deepStrictEqual(f.parallel.map((p) => p.count), [0, 2, 1]);
  assert.deepStrictEqual(f.parallel[1].parts.map((p) => p.count), [1, 1]); // ぜひやりたい / 条件が合えばやりたい
  assert.strictEqual(f.parallelAny.count, 2); // R2, R4（重複なし）
  const seg = f.segments.find((s) => s.id === 'event_small_session');
  assert.strictEqual(seg.count, 2);
  assert.deepStrictEqual(seg.crosses.map((c) => c.axis), ['age_range', 'residence', 'costume_photographed', 'portrait_price', 'hesitation']);
  const age = byId(cross(f, 'event_small_session', 'age_range'));
  assert.deepStrictEqual([age.age_20_24, age.age_30_34], [1, 1]);
  const price = byId(cross(f, 'event_small_session', 'portrait_price'));
  assert.deepStrictEqual([price['5000_6999'], price['12000_14999']], [1, 1]);
});

test('null・未回答を否定回答として扱わない／分岐対象外は母数に入らない（record直接）', () => {
  const { admin } = setup([]);
  const ev = (pred, record) => admin.ctx.demandEval_(pred, record);
  assert.strictEqual(ev('lighting_neither', {}), false);
  assert.strictEqual(ev('strobe_only', {}), false);
  assert.strictEqual(ev('constant_only', {}), false);
  assert.strictEqual(ev('lighting_both', {}), false);
  assert.strictEqual(ev('near_term_intent', {}), false);
  assert.strictEqual(ev('near_term_intent', { intent_3m: {} }), false);
  assert.strictEqual(ev('lighting_neither', { equipment_wanted: ['softbox'] }), true);
  assert.strictEqual(ev('strobe_only', { equipment_wanted: ['monoblock_strobe', 'clip_on_strobe', 'softbox'] }), true);
  assert.strictEqual(ev('lighting_both', { equipment_wanted: ['clip_on_strobe', 'rgb_light'] }), true);
  const data = plain(admin.ctx.buildDemandFunnels_([{}, { equipment_wanted: ['rgb_light'] }]));
  const f = data.funnels.find((x) => x.id === 'lighting');
  assert.strictEqual(f.breakdownBase.count, 1); // 空の回答は「どれも選ばなかった」ではなく対象外
  assert.strictEqual(f.breakdown.find((b) => b.label.startsWith('どちらも選ばず')).count, 0);
  const empty = plain(admin.ctx.buildDemandFunnels_([]));
  assert.strictEqual(empty.base, 0);
  assert.ok(empty.funnels.every((fn) => (fn.stages || []).every((s) => s.allPct === null || s.count === 0)));
});

test('定義が実在する設問・選択肢・Q27行だけを参照する（新規設問なし）', () => {
  const { admin } = setup([]);
  const ctx = admin.ctx;
  const schema = ctx.SURVEY_SCHEMA;
  const leaves = [];
  const walk = (p) => {
    const def = typeof p === 'string' ? (ctx.DEMAND_PREDICATES[p] || schema.funnels[p]) : p;
    assert.ok(def, 'unknown predicate ' + JSON.stringify(p));
    if (def.not !== undefined) return walk(def.not);
    if (def.all) return def.all.forEach(walk);
    if (def.any) return def.any.forEach(walk);
    leaves.push(def);
  };
  const preds = [];
  ctx.DEMAND_FUNNELS.forEach((f) => {
    (f.stages || []).forEach((s) => preds.push(s.predicate));
    (f.parallel || []).forEach((s) => preds.push(s.predicate));
    (f.breakdown || []).forEach((s) => preds.push(s.predicate));
    if (f.breakdownBase) preds.push(f.breakdownBase.predicate);
    (f.segments || []).forEach((s) => preds.push(s.predicate));
  });
  Object.keys(ctx.DEMAND_PREDICATES).forEach((k) => preds.push(k));
  preds.forEach(walk);
  leaves.forEach((def) => {
    const q = schema.questions.find((x) => x.id === def.question);
    assert.ok(q, def.question);
    const options = q.type === 'matrix' ? q.scale : (q.options || schema.optionSets[q.optionSet]);
    if (q.type === 'matrix') assert.ok(q.rows.some((r) => r.id === def.row), def.row);
    (def.include || def.anyOf || []).forEach((id) => assert.ok(options.some((o) => o.id === id), def.question + ':' + id));
  });
  // クロス軸も実在する
  ctx.DEMAND_FUNNELS.forEach((f) => (f.segments || []).forEach((s) => (s.crosses || []).forEach((c) => {
    if (ctx.DEMAND_VIRTUAL_AXES[c.axis]) return;
    assert.doesNotThrow(() => ctx.parseAxisKey_(c.axis), c.axis);
  })));
  // ストロボ系 / 常時光系の分類
  assert.deepStrictEqual(plain(ctx.DEMAND_PREDICATES.strobe_wanted.anyOf), ['monoblock_strobe', 'clip_on_strobe']);
  assert.deepStrictEqual(plain(ctx.DEMAND_PREDICATES.constant_wanted.anyOf), ['led_video_light', 'rgb_light']);
});

test('OWNER dashboard は需要ファネル5種を返す（認証・配信経路の変更後も維持。Issue #363）', () => {
  const { call } = setup();
  const data = call().data;
  assert.ok(!('role' in data));
  assert.deepStrictEqual(data.demandFunnels.funnels.map((f) => f.id), ['photographed', 'studio', 'lighting', 'shooter', 'event']);
});

test('設問・schema・Spreadsheet列・Public結果は変更していない', () => {
  const { pub } = setup([]);
  const schema = pub.ctx.SURVEY_SCHEMA;
  assert.strictEqual(String(schema.schema_version), '3');
  assert.ok(!('demandFunnels' in schema) && !JSON.stringify(schema).includes('DEMAND_'));
  assert.deepStrictEqual(Object.keys(schema.funnelFlows), ['portrait_demand', 'shooter_demand']); // 既存ファネル定義は据え置き
  assert.ok(!fs.readFileSync(path.join(ROOT, 'public', 'SurveyGenerated.gs'), 'utf8').includes('DEMAND_'));
  assert.ok(!fs.readFileSync(path.join(ROOT, '..', '..', 'costume-portrait-survey', 'survey.generated.js'), 'utf8').includes('DEMAND_'));
  const publicSource = fs.readdirSync(path.join(ROOT, 'public')).filter((f) => f.endsWith('.gs'))
    .map((f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8')).join('\n');
  assert.ok(!/demandFunnel|DEMAND_FUNNELS|buildDemandFunnels_/.test(publicSource));
  const page = fs.readFileSync(path.join(ROOT, '..', '..', 'costume-portrait-survey-results.html'), 'utf8') +
    fs.readFileSync(path.join(ROOT, '..', '..', 'costume-portrait-survey', 'results.js'), 'utf8');
  assert.ok(!/demand|需要ファネル/.test(page));
});

test('Public結果payload（途中集計）に需要ファネル・3か月意向・価格・国名が出ない', () => {
  const respondents = [];
  for (let i = 0; i < 31; i++) respondents.push(Object.assign({}, RESPONDENTS[i % RESPONDENTS.length]));
  const { pub } = setup(respondents);
  const raw = pub.ctx.doGet({ parameter: { action: 'results' } }).getContent();
  const results = JSON.parse(raw);
  assert.strictEqual(results.ok, true);
  assert.ok(!/demand|funnel|intent_3m|portrait_price|rental_price|residence_country|equipment_wanted/.test(raw));
});
