'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ROOT, loadPublic, validPayload, plain } = require('./helpers/gas-env');
const { render, TARGETS } = require('../tools/build-survey');

const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'survey.schema.json'), 'utf8'));
const byId = Object.fromEntries(schema.questions.map((q) => [q.id, q]));
const optionsOf = (q) => q.options || schema.optionSets[q.optionSet] || [];

test('生成物（Frontend/Public/Admin）が survey.schema.json と一致する', () => {
  for (const target of TARGETS) {
    assert.strictEqual(fs.readFileSync(target.file, 'utf8'), render(target.label), target.label);
  }
});

test('schema_version / survey_version / question・option stable ID が揃っている', () => {
  assert.ok(schema.schema_version && schema.survey_version);
  const seen = new Set();
  for (const q of schema.questions) {
    assert.match(q.id, /^[a-z][a-z0-9_]*$/, q.id);
    assert.ok(!seen.has(q.id), 'duplicate question id ' + q.id);
    seen.add(q.id);
    assert.ok(['single', 'multi', 'matrix', 'text'].includes(q.type));
    assert.ok(['public', 'private'].includes(q.visibility));
    assert.strictEqual(typeof q.required, 'boolean');
    assert.ok(q.label);
    if (q.type === 'text') assert.ok(q.maxLength > 0);
    const ids = new Set();
    for (const o of q.type === 'matrix' ? q.rows.concat(q.scale) : optionsOf(q)) {
      assert.match(o.id, /^[a-z0-9_]+$/, `${q.id}.${o.id}`); // '|' を含まない
      assert.ok(o.label, `${q.id}.${o.id}`);
      assert.ok(!ids.has(o.id), `duplicate option ${q.id}.${o.id}`);
      ids.add(o.id);
    }
  }
});

test('選択式設問には原則「その他」がある（matrix・text以外は全設問）', () => {
  for (const q of schema.questions.filter((x) => x.type === 'single' || x.type === 'multi')) {
    // aichi_area は「その他 / わからない」を自由記述なしの固定選択肢として持つ（地域区分のため）。
    assert.strictEqual(optionsOf(q).filter((o) => o.other).length, q.id === 'aichi_area' ? 0 : 1, q.id);
  }
});

// Issue #334「必須 / 任意 / 分岐一覧」を、schemaとは独立に書き下した期待値。
const SPEC = {
  age_range: ['Q1', true], sexual_orientation: ['Q2', false], residence: ['Q3', true], aichi_area: ['Q3-1', true, 'residence:pref_23'], residence_country: ['Q3-2', true, 'residence:overseas'], travel_range: ['Q4', true],
  costume_interest: ['Q5', true], uniform_interest: ['Q5-1', true, 'costume_interest:uniform'],
  workwear_interest: ['Q5-2', true, 'costume_interest:workwear'],
  suit_interest: ['Q5-3', true, 'costume_interest:suit'], school_uniform_interest: ['Q5-4', true, 'costume_interest:school_uniform'],
  suit_wear: ['Q6-A-3', true, 'costume_wear:suit'], school_uniform_wear: ['Q6-A-4', true, 'costume_wear:school_uniform'],
  suit_photographed: ['Q6-B-3', true, 'costume_photographed:suit'], school_uniform_photographed: ['Q6-B-4', true, 'costume_photographed:school_uniform'],
  suit_shoot: ['Q7-3', true, 'costume_shoot:suit'], school_uniform_shoot: ['Q7-4', true, 'costume_shoot:school_uniform'],
  fetish_presentation: ['Q9-A', true],
  costume_wear: ['Q6-A', true], costume_photographed: ['Q6-B', true], costume_shoot: ['Q7', true],
  portrait_interest: ['Q8', true], portrait_styles: ['Q9', true], face_exposure: ['Q10', true], photo_usage: ['Q11', true],
  shoot_duration: ['Q12', true], weekdays: ['Q13', true], weekday_time_slots: ['Q14-1', true, 'weekdays:weekday'], photo_count: ['Q15', true],
  retouch: ['Q16', true], hesitation: ['Q16-A', true], backdrop: ['Q17', true], portrait_price: ['Q18', true],
  shooter_interest: ['Q20', true], studio_rental: ['Q21', true, 'gate'], party_size: ['Q22', true, 'gate'],
  equipment_wanted: ['Q23', true, 'gate'], equipment_experience: ['Q24', true, 'gate'],
  equipment_support: ['Q25', true, 'gate'], rental_price: ['Q26', true, 'gate'],
  intent_3m: ['Q27', true], free_ideas: ['Q28', false], free_themes: ['Q29', false], cheer_message: ['Q30', false]
};

test('必須/任意/分岐が Issue の一覧と一致する', () => {
  for (const [id, [no, required, cond]] of Object.entries(SPEC)) {
    const q = byId[id];
    assert.ok(q, id);
    assert.strictEqual(q.no, no, id);
    assert.strictEqual(q.required, required, id);
    if (cond === 'gate') {
      assert.deepStrictEqual(q.showIf, { question: 'shooter_interest', in: ['currently_shooting', 'want_to_try', 'slightly_interested'] }, id);
    } else if (cond) {
      const [parent, value] = cond.split(':');
      assert.deepStrictEqual(q.showIf, { question: parent, includes: value }, id);
    } else {
      assert.ok(!q.showIf, id + ' should always be shown');
    }
  }
  assert.strictEqual(byId.cheer_message.maxLength, 1000);
});

test('表示順は衣装設問から始まり、基本情報は後半（Q27の後）、自由回答が最後', () => {
  const order = schema.sections.map((s) => s.id);
  assert.strictEqual(order[0], 'interest');
  assert.deepStrictEqual(order.slice(0, 4), ['interest', 'wear', 'photographed', 'shoot']);
  assert.ok(order.indexOf('basic') > order.indexOf('intent'));
  assert.strictEqual(order[order.length - 1], 'free');
  // 質問の並び順が画面順と同じ（Q6-A→Q6-B→Q7→Q8…→Q27→Q1〜Q4→Q28〜Q30）
  const flat = schema.sections.flatMap((s) => s.questions);
  assert.deepStrictEqual(flat, schema.questions.map((q) => q.id));
  assert.ok(flat.indexOf('age_range') > flat.indexOf('intent_3m'));
  const studio = schema.sections.find((s) => s.id === 'studio');
  assert.deepStrictEqual(studio.questions, ['studio_rental', 'party_size', 'equipment_wanted', 'equipment_experience', 'equipment_support', 'rental_price']);
});

test('衣装定義は optionSet 1か所だけ（Q5/Q6-A/Q6-B/Q7 で共有）', () => {
  for (const id of ['costume_interest', 'costume_wear', 'costume_photographed', 'costume_shoot']) {
    assert.strictEqual(byId[id].optionSet, 'costume_category', id);
    assert.strictEqual(byId[id].options, undefined, id);
  }
  for (const prefix of ['interest', 'wear', 'photographed', 'shoot']) {
    assert.strictEqual(byId['uniform_' + prefix].optionSet, 'uniform_detail');
    assert.strictEqual(byId['workwear_' + prefix].optionSet, 'workwear_detail');
    assert.strictEqual(byId['suit_' + prefix].optionSet, 'suit_detail');
    assert.strictEqual(byId['school_uniform_' + prefix].optionSet, 'school_uniform_detail');
  }
  for (const id of ['costume_wear', 'costume_photographed', 'costume_shoot']) assert.strictEqual(byId[id].priorityFrom, 'costume_interest');
});

test('調査内容の受入条件（衣装・ユニフォーム・作業服の選択肢と表記）', () => {
  const labels = (set) => schema.optionSets[set].map((o) => o.label);
  const costume = labels('costume_category');
  for (const l of ['ユニフォーム', 'スーツ', '職業制服・作業服', '学生服・学校制服', 'ラバー', 'ゼンタイ（全身タイツ）', 'レザー', 'ヒーロースーツ', 'アニメ・ゲーム等のコスプレ', '和装', '女装', 'ふんどし', '下着', 'ヌード', 'その他']) {
    assert.ok(costume.includes(l), l);
  }
  assert.ok(!costume.includes('ゼンタイ'));
  const uniform = labels('uniform_detail');
  for (const l of ['野球', 'サッカー', 'ラグビー', 'アメリカンフットボール', 'バスケットボール', 'バレーボール', '陸上', '競パン', '柔道', '空手', '剣道', 'シングレット', 'その他']) {
    assert.ok(uniform.includes(l), l);
  }
  assert.ok(!uniform.includes('水泳') && !uniform.includes('学校ジャージ'), '学校系は school_uniform_detail へ');
  assert.deepStrictEqual(labels('workwear_detail'), ['警察', '消防', '自衛隊', '運送業者', 'ツナギ', '警備員', '鉄道・駅員', '航空・パイロット・空港制服', '医療・白衣', '工場・作業着', 'その他']);
  // 過度な深掘りをしていない（チーム別・メーカー別等の設問が無い）
  assert.ok(schema.questions.length <= 51); // 条件付き（aichi_area / residence_country / スーツ・学生服の枝8問）とQ9-Aを含む
  assert.ok(!schema.questions.some((q) => /ブランド|メーカー|チーム/.test(q.label)));
  // 緊縛・予約・決済に関する設問は無い
  assert.ok(!schema.questions.some((q) => /緊縛|予約|決済|Stripe/.test(q.label)));
});

test('マーケティング項目（価格・意向・撮影障壁・ファンサイト用途など）を取得する設問がある', () => {
  assert.ok(optionsOf(byId.hesitation).length >= 10);
  assert.ok(optionsOf(byId.photo_usage).some((o) => o.id === 'fansite_monetize'));
  for (const id of ['shoot_duration', 'weekdays', 'weekday_time_slots', 'holiday_time_slots', 'photo_count', 'retouch', 'backdrop', 'portrait_price', 'shooter_interest', 'studio_rental', 'rental_price', 'equipment_experience', 'equipment_support', 'intent_3m']) {
    assert.ok(byId[id], id);
  }
  assert.ok(optionsOf(byId.equipment_wanted).some((o) => o.id === 'monoblock_strobe'));
  assert.ok(optionsOf(byId.equipment_wanted).some((o) => o.id === 'led_video_light'));
  assert.strictEqual(byId.intent_3m.rows.length, 8);
  assert.strictEqual(byId.intent_3m.scale.length, 5);
  assert.ok(!byId.portrait_price_feel && !byId.q19, 'Q19は実装しない');
});

test('ファネル定義・クロス集計プリセットが実在する設問/選択肢だけを参照する', () => {
  const checkPred = (p) => {
    if (p.all) return p.all.forEach((x) => checkPred(typeof x === 'string' ? schema.funnels[x] : x));
    const q = byId[p.question];
    assert.ok(q, p.question);
    if (p.row) assert.ok(q.rows.some((r) => r.id === p.row));
    const valid = new Set((q.type === 'matrix' ? q.scale : optionsOf(q)).map((o) => o.id));
    for (const id of p.include || p.anyOf || []) assert.ok(valid.has(id), `${p.question}.${id}`);
  };
  Object.values(schema.funnels).forEach(checkPred);
  for (const flow of Object.values(schema.funnelFlows)) for (const s of flow.stages) assert.ok(schema.funnels[s], s);
  for (const name of ['portrait_interest', 'near_term_intent', 'price_7000_plus']) assert.ok(schema.funnels[name], name);
  assert.deepStrictEqual(schema.funnels.price_7000_plus.include, ['7000_8999', '9000_11999', '12000_14999', '15000_plus']);
  assert.ok(schema.crosstabs.length >= 13);
  for (const c of schema.crosstabs) for (const axis of [c.row, c.col]) {
    const q = byId[axis.question];
    assert.ok(q && q.type !== 'text', c.id);
    if (q.type === 'matrix') assert.ok(q.rows.some((r) => r.id === axis.row));
  }
});

test('公開結果の対象は allowlist 項目のみで、非公開すべき設問を含まない', () => {
  const privateIds = ['portrait_price', 'rental_price', 'intent_3m', 'residence', 'sexual_orientation', 'cheer_message', 'free_ideas', 'free_themes', 'travel_range', 'hesitation'];
  const publicQuestions = schema.publicResults.items.map((i) => i.question);
  for (const id of publicQuestions) assert.strictEqual(byId[id].visibility, 'public', id);
  for (const id of privateIds) {
    assert.strictEqual(byId[id].visibility, 'private', id);
    assert.ok(!publicQuestions.includes(id), id);
  }
  assert.strictEqual(schema.publicResults.minTotal, 30);
  assert.strictEqual(schema.publicResults.minCell, 3);
  // 年代は粗い区分へ再集約（全年代選択肢がちょうど1つの区分に属する）
  const members = schema.publicResults.ageGroups.flatMap((g) => g.members);
  assert.deepStrictEqual([...members].sort(), optionsOf(byId.age_range).map((o) => o.id).sort());
});

test('表示labelを変更しても保存値（stable ID）は変わらない', () => {
  const { env, ctx } = loadPublic();
  const modified = JSON.parse(JSON.stringify(ctx.SURVEY_SCHEMA));
  modified.optionSets.uniform_detail.find((o) => o.id === 'uniform_baseball').label = 'ベースボール（表示名変更）';
  const payload = validPayload(ctx, { costume_interest: ['uniform'], uniform_interest: ['uniform_baseball'] });
  const validation = ctx.validatePayload_(payload);
  const before = plain(ctx.buildRow_(validation.clean, 'h', new Date(0), 1));
  ctx.SURVEY_SCHEMA = modified;
  const after = plain(ctx.buildRow_(ctx.validatePayload_(payload).clean, 'h', new Date(0), 1));
  assert.deepStrictEqual(after, before);
  assert.ok(before.includes('|uniform_baseball|'));
  assert.ok(!JSON.stringify(before).includes('野球'));
  assert.ok(env);
});
