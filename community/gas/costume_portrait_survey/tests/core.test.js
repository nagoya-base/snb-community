'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadPublic, validPayload, plain } = require('./helpers/gas-env');

const { ctx } = loadPublic();
const schema = ctx.SURVEY_SCHEMA;
const core = ctx.SurveyCore;
const base = () => plain(validPayload(ctx));
const check = (answers, others) => plain(core.validateAnswers(schema, answers, others || {}));
const codes = (r) => r.errors.map((e) => `${e.field}:${e.code}`);

test('基本の有効回答は通る', () => {
  const p = base();
  const r = check(p.answers, p.other_texts);
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.ok, true);
});

test('必須の未入力を拒否する（選択・複数選択・matrix）', () => {
  for (const id of ['costume_interest', 'portrait_interest', 'hesitation', 'intent_3m', 'age_range']) {
    const p = base();
    delete p.answers[id];
    assert.ok(codes(check(p.answers)).includes(`${id}:required`), id);
  }
  const p = base();
  p.answers.costume_interest = [];
  assert.ok(codes(check(p.answers)).includes('costume_interest:required'));
  p.answers = base().answers;
  delete p.answers.intent_3m.meet_people;
  assert.ok(codes(check(p.answers)).includes('intent_3m.meet_people:required'));
});

test('任意設問（Q2・Q28〜Q30）は未入力でよい', () => {
  const p = base();
  for (const id of ['sexual_orientation', 'free_ideas', 'free_themes', 'cheer_message']) assert.ok(!(id in p.answers));
  assert.strictEqual(check(p.answers).ok, true);
});

test('invalid enum / 重複 / 型違い / 未知fieldを拒否する', () => {
  let p = base(); p.answers.age_range = 'label_not_id';
  assert.ok(codes(check(p.answers)).includes('age_range:invalid_option'));
  p = base(); p.answers.age_range = '18～19歳';
  assert.ok(codes(check(p.answers)).includes('age_range:invalid_option'), '表示labelは保存値として受け付けない');
  p = base(); p.answers.hesitation = ['none', 'price_concern'];
  assert.ok(codes(check(p.answers)).includes('hesitation:exclusive_conflict'));
  p = base(); p.answers.weekdays = ['saturday', 'saturday'];
  assert.ok(codes(check(p.answers)).includes('weekdays:duplicate_option'));
  p = base(); p.answers.weekdays = 'saturday';
  assert.ok(codes(check(p.answers)).includes('weekdays:invalid_type'));
  p = base(); p.answers.age_range = ['age_20_24'];
  assert.ok(codes(check(p.answers)).includes('age_range:invalid_type'));
  p = base(); p.answers.surprise = 'x';
  assert.ok(codes(check(p.answers)).includes('surprise:unknown_field'));
  p = base(); p.answers.intent_3m.hack = 'definitely';
  assert.ok(codes(check(p.answers)).includes('intent_3m.hack:unknown_field'));
  p = base(); p.answers.intent_3m.get_portrait = 'maybe';
  assert.ok(codes(check(p.answers)).includes('intent_3m.get_portrait:invalid_option'));
  assert.ok(codes(check('nope')).includes('answers:invalid_type'));
  assert.ok(codes(check([])).includes('answers:invalid_type'));
});

test('「その他」：選択時のみ自由記述が必須、未選択なら不要/不可', () => {
  let p = base(); p.answers.portrait_interest = 'other';
  assert.ok(codes(check(p.answers)).includes('portrait_interest:other_text_required'));
  assert.ok(codes(check(p.answers, { portrait_interest: '   ' })).includes('portrait_interest:other_text_required'));
  let r = check(p.answers, { portrait_interest: ' 気分次第 ' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.clean.other_texts.portrait_interest, '気分次第');
  p = base();
  assert.ok(codes(check(p.answers, { portrait_interest: 'x' })).includes('portrait_interest:other_text_unexpected'));
  // 複数選択でも同様
  p = base(); p.answers.backdrop = ['white', 'other'];
  assert.ok(codes(check(p.answers)).includes('backdrop:other_text_required'));
  assert.strictEqual(check(p.answers, { backdrop: '屋上' }).ok, true);
  // 100字上限
  assert.ok(codes(check(p.answers, { backdrop: 'あ'.repeat(101) })).includes('backdrop:too_long'));
  assert.strictEqual(check(p.answers, { backdrop: 'あ'.repeat(100) }).ok, true);
  // other_texts の未知キー
  assert.ok(codes(check(base().answers, { age_confirmed: 'x' })).includes('age_confirmed:unknown_field'));
  assert.ok(codes(check(base().answers, { portrait_price: 'x' })).includes('portrait_price:unknown_field') === false);
});

test('ユニフォーム/作業服の詳細は親を選んだ時だけ表示・必須、非表示時の回答は拒否', () => {
  let p = base(); p.answers.costume_interest = ['rubber'];
  delete p.answers.uniform_interest; delete p.answers.workwear_interest;
  assert.strictEqual(check(p.answers).ok, true);
  p.answers.uniform_interest = ['uniform_baseball'];
  assert.ok(codes(check(p.answers)).includes('uniform_interest:hidden_field'));
  p = base(); p.answers.costume_interest = ['uniform'];
  delete p.answers.uniform_interest;
  assert.ok(codes(check(p.answers)).includes('uniform_interest:required'));
  p.answers.costume_interest = ['workwear'];
  p.answers.workwear_interest = ['workwear_police'];
  assert.strictEqual(check(p.answers).ok, true);
  // 「その他」の自由記述キーは詳細設問ごと
  p.answers.workwear_interest = ['other'];
  assert.ok(codes(check(p.answers)).includes('workwear_interest:other_text_required'));
  assert.strictEqual(check(p.answers, { workwear_interest: '鉄道' }).ok, true);
  // Q6-A / Q6-B / Q7 の詳細も独立に分岐する
  p = base(); p.answers.costume_wear = ['uniform']; p.answers.uniform_wear = ['uniform_soccer'];
  assert.strictEqual(check(p.answers).ok, true);
  delete p.answers.uniform_wear;
  assert.ok(codes(check(p.answers)).includes('uniform_wear:required'));
});

test('Q21〜Q26 は撮影者意向（現在撮影/やってみたい/少し興味）の時だけ表示・必須', () => {
  for (const eligible of ['currently_shooting', 'want_to_try', 'slightly_interested']) {
    const p = base(); p.answers.shooter_interest = eligible;
    for (const id of ['studio_rental', 'party_size', 'equipment_wanted', 'equipment_experience', 'equipment_support', 'rental_price']) delete p.answers[id];
    assert.ok(codes(check(p.answers)).includes('studio_rental:required'), eligible);
    assert.ok(codes(check(p.answers)).includes('rental_price:required'), eligible);
  }
  for (const out of ['subject_only', 'not_interested']) {
    const p = base(); p.answers.shooter_interest = out;
    for (const id of ['studio_rental', 'party_size', 'equipment_wanted', 'equipment_experience', 'equipment_support', 'rental_price']) delete p.answers[id];
    assert.strictEqual(check(p.answers).ok, true, out);
    p.answers.rental_price = 'under_2000';
    assert.ok(codes(check(p.answers)).includes('rental_price:hidden_field'));
  }
  // 「その他」でも撮影者向け設問は出ない
  const p = base(); p.answers.shooter_interest = 'other';
  for (const id of ['studio_rental', 'party_size', 'equipment_wanted', 'equipment_experience', 'equipment_support', 'rental_price']) delete p.answers[id];
  assert.strictEqual(check(p.answers, { shooter_interest: 'x' }).ok, true);
});

test('自由記述の長さ（コードポイント数）と制御文字', () => {
  const p = base();
  p.answers.cheer_message = 'あ'.repeat(1000);
  assert.strictEqual(check(p.answers).ok, true);
  p.answers.cheer_message = 'あ'.repeat(1001);
  assert.ok(codes(check(p.answers)).includes('cheer_message:too_long'));
  p.answers.cheer_message = '😀'.repeat(1000); // UTF-16では2000だがコードポイントでは1000
  assert.strictEqual(check(p.answers).ok, true);
  p.answers.cheer_message = 'a\u0000b';
  assert.ok(codes(check(p.answers)).includes('cheer_message:invalid_text'));
  p.answers.cheer_message = '   \n  ';
  assert.strictEqual(check(p.answers).ok, true);
  assert.ok(!('cheer_message' in check(p.answers).clean.answers));
  p.answers.cheer_message = 12;
  assert.ok(codes(check(p.answers)).includes('cheer_message:invalid_type'));
});

test('複数選択の保存形式 |a|b| とdecode', () => {
  assert.strictEqual(core.encodeMulti(['baseball', 'soccer']), '|baseball|soccer|');
  assert.strictEqual(core.encodeMulti([]), '');
  assert.deepStrictEqual(plain(core.decodeMulti('|baseball|soccer|school_jersey|')), ['baseball', 'soccer', 'school_jersey']);
  assert.deepStrictEqual(plain(core.decodeMulti('')), []);
  assert.deepStrictEqual(plain(core.decodeMulti(undefined)), []);
});

const records = [
  { portrait_interest: 'very_interested', costume_photographed: ['uniform', 'suit'], backdrop: ['white', 'black'], intent_3m: { get_portrait: 'definitely' }, portrait_price: '7000_8999' },
  { portrait_interest: 'interested', costume_photographed: ['uniform'], backdrop: ['white'], intent_3m: { get_portrait: 'interested' }, portrait_price: '15000_plus' },
  { portrait_interest: 'neutral', costume_photographed: ['suit'], backdrop: ['black'], intent_3m: { get_portrait: 'definitely' }, portrait_price: 'under_3000' },
  { portrait_interest: 'very_interested', costume_photographed: ['uniform'], backdrop: [], intent_3m: { get_portrait: 'if_conditions_fit' }, portrait_price: '9000_11999' }
];

test('単純集計：count=選んだ回答者数、base=回答者数', () => {
  const t = plain(core.tally(schema, { question: 'backdrop' }, records));
  assert.strictEqual(t.base, 3);
  assert.strictEqual(t.counts.white, 2);
  assert.strictEqual(t.counts.black, 2);
  assert.strictEqual(t.counts.fantasy, 0);
  const m = plain(core.tally(schema, { question: 'intent_3m', row: 'get_portrait' }, records));
  assert.strictEqual(m.counts.definitely, 2);
});

test('クロス集計（複数選択×複数選択）：セルは「両方を選んだ回答者数」', () => {
  const x = plain(core.crosstab(schema, { question: 'costume_photographed' }, { question: 'backdrop' }, records));
  assert.strictEqual(x.rowBase.uniform, 3);
  assert.strictEqual(x.rowBase.suit, 2);
  assert.strictEqual(x.cells.uniform.white, 2);
  assert.strictEqual(x.cells.uniform.black, 1);
  assert.strictEqual(x.cells.suit.black, 2);
  // 1人が複数セルに入るため行の合計は人数を超えうる
  const rowSum = Object.values(x.cells.uniform).reduce((a, b) => a + b, 0);
  assert.ok(rowSum >= x.rowBase.uniform - 1);
  const y = plain(core.crosstab(schema, { question: 'portrait_interest' }, { question: 'intent_3m', row: 'get_portrait' }, records));
  assert.strictEqual(y.cells.very_interested.definitely, 1);
  assert.strictEqual(y.rowBase.very_interested, 2);
});

test('ファネルは schema の定義を使い、累積で絞り込む', () => {
  const flow = plain(core.funnelFlow(schema, 'portrait_demand', records));
  assert.deepStrictEqual(flow.map((s) => s.id), ['all', 'portrait_interest', 'wants_photographed', 'near_term_intent', 'price_7000_plus']);
  assert.deepStrictEqual(flow.map((s) => s.count), [4, 3, 3, 2, 2]);
  assert.strictEqual(core.evalPredicate(schema, 'price_7000_plus', { portrait_price: '7000_8999' }), true);
  assert.strictEqual(core.evalPredicate(schema, 'price_7000_plus', { portrait_price: '5000_6999' }), false);
  assert.strictEqual(core.evalPredicate(schema, 'near_term_intent', { intent_3m: { get_portrait: 'no' } }), false);
  assert.strictEqual(core.evalPredicate(schema, 'nonexistent', {}), false);
  const shooter = plain(core.funnelFlow(schema, 'shooter_demand', [
    { shooter_interest: 'want_to_try', studio_rental: 'want_to_try', equipment_wanted: ['monoblock_strobe'], equipment_experience: 'none', equipment_support: ['brief_explanation'] },
    { shooter_interest: 'want_to_try', studio_rental: 'wont_rent' }
  ]));
  assert.deepStrictEqual(shooter.map((s) => s.count), [2, 2, 1, 1, 1, 1]);
});
