'use strict';
// 衣装カテゴリ改訂（学生服・学校制服 / スーツ枝 / 職業制服拡張 / フェチ表現Q9-A）の回帰テスト。
const test = require('node:test');
const assert = require('node:assert');
const schema = require('../survey.schema.json');
const { loadPublic, loadAdmin, validPayload, plain } = require('./helpers/gas-env');
const { openPage, settle, q, choose, next, advanceToReview, pageTitle } = require('./helpers/dom');

const NOW = new Date('2026-11-01T12:00:00+09:00');
const CLOSED = new Date('2027-01-15T00:00:00+09:00');
const byId = Object.fromEntries(schema.questions.map((x) => [x.id, x]));
const optionIds = (set) => schema.optionSets[set].map((o) => o.id);
const optionLabels = (set) => schema.optionSets[set].map((o) => o.label);
const submit = (ctx, payload) => plain(ctx.processSubmission_(JSON.stringify(payload), NOW));
const fieldCodes = (r) => (r.fields || []).map((f) => f.field + ':' + f.code);
const rows = (env) => env.spreadsheet.getSheetByName('responses').rows;

const STAGES = [['interest', 'costume_interest', 'Q5'], ['wear', 'costume_wear', 'Q6-A'], ['photographed', 'costume_photographed', 'Q6-B'], ['shoot', 'costume_shoot', 'Q7']];
const BRANCHES = [['suit', 'suit_detail', 3, 'suit_'], ['school_uniform', 'school_uniform_detail', 4, 'school_uniform_']];

/* ── schema ── */

test('トップカテゴリ：school_uniform を追加し、uniform / suit / workwear のIDは維持', () => {
  assert.deepStrictEqual(optionIds('costume_category').slice(0, 4), ['uniform', 'suit', 'workwear', 'school_uniform']);
  const labels = Object.fromEntries(schema.optionSets.costume_category.map((o) => [o.id, o.label]));
  assert.strictEqual(labels.school_uniform, '学生服・学校制服');
  assert.strictEqual(labels.workwear, '職業制服・作業服');
  assert.strictEqual(labels.suit, 'スーツ');
  assert.strictEqual(labels.uniform, 'スポーツユニフォーム');
  assert.deepStrictEqual(['uniform_interest', 'uniform_wear', 'uniform_photographed', 'uniform_shoot'].map((id) => byId[id].label),
    ['興味のあるスポーツユニフォーム', '着てみたいスポーツユニフォーム', '撮られてみたいスポーツユニフォーム', '撮ってみたいスポーツユニフォーム']);
  assert.strictEqual(byId.uniform_interest.optionSet, 'uniform_detail');
  assert.ok(!optionIds('uniform_detail').includes('uniform_school_jersey'), '学校ジャージは学生服側へ');
  assert.ok(!optionIds('uniform_detail').some((id) => /gakuran|sailor|blazer/.test(id)), '学生服をuniform_detailへ混ぜない');
});

test('school_uniform_detail / suit_detail / workwear_detail の選択肢', () => {
  assert.deepStrictEqual(optionIds('school_uniform_detail'), ['gakuran', 'school_blazer', 'sailor_uniform', 'gym_uniform', 'school_jersey', 'school_swimwear', 'school_shirt_slacks', 'other']);
  assert.deepStrictEqual(optionLabels('school_uniform_detail'), ['学ラン', '学校ブレザー', 'セーラー服', '体操服', '学校ジャージ', '学校・水泳部系スイムウェア', 'ワイシャツ＋スラックスの学生スタイル', 'その他']);
  assert.deepStrictEqual(optionIds('suit_detail'), ['business_suit', 'young_business', 'three_piece', 'formal_tuxedo', 'shirt_tie', 'shirt_slacks', 'vest_style', 'full_coordination', 'other']);
  assert.ok(optionLabels('suit_detail').includes('革靴・靴下まで含めた全身コーデ'));
  const work = optionIds('workwear_detail');
  for (const id of ['workwear_police', 'workwear_fire', 'workwear_sdf', 'workwear_delivery', 'workwear_jumpsuit']) assert.ok(work.includes(id), id + ' は維持');
  for (const id of ['security', 'railway', 'aviation', 'medical_whitecoat', 'factory_workwear']) assert.ok(work.includes(id), id);
  assert.ok(!work.some((id) => /shirt|tie|business/.test(id)), 'ワイシャツ・ネクタイ・ビジネスはスーツ枝で扱う');
  for (const set of ['school_uniform_detail', 'suit_detail', 'workwear_detail']) {
    const other = schema.optionSets[set].filter((o) => o.other);
    assert.deepStrictEqual(other.map((o) => o.id), ['other'], set + ' は other:true で自由記述');
  }
});

test('枝設問：番号・親の分岐・公開区分・優先表示がuniform/workwearと同じ構造', () => {
  for (const [cat, set, n, prefix] of BRANCHES) {
    for (const [stage, parent, no] of STAGES) {
      const x = byId[prefix + stage];
      assert.ok(x, prefix + stage);
      assert.strictEqual(x.no, `${no}-${n}`);
      assert.strictEqual(x.type, 'multi');
      assert.strictEqual(x.required, true);
      assert.strictEqual(x.optionSet, set);
      assert.deepStrictEqual(x.showIf, { question: parent, includes: cat });
      assert.strictEqual(x.visibility, byId['uniform_' + stage].visibility, 'uniform枝と同じprivacy方針');
      assert.strictEqual(x.priorityFrom, byId['uniform_' + stage].priorityFrom ? prefix + 'interest' : undefined);
    }
  }
  const wording = { suit: 'スーツ・ビジネススタイル', school_uniform: '学生服・学校制服' };
  for (const [cat] of BRANCHES) {
    assert.strictEqual(byId[cat + '_interest'].label, '興味のある' + wording[cat]);
    assert.strictEqual(byId[cat + '_wear'].label, '自分が着てみたい' + wording[cat]);
    assert.strictEqual(byId[cat + '_photographed'].label, '自分がその姿を撮られてみたい' + wording[cat]);
    assert.strictEqual(byId[cat + '_shoot'].label, '他の人が着ている姿を撮ってみたい' + wording[cat]);
  }
  // 既存のQ5-1/Q5-2等の番号・IDは変更しない
  assert.deepStrictEqual(['uniform_interest', 'workwear_interest', 'uniform_shoot', 'workwear_shoot'].map((id) => byId[id].no), ['Q5-1', 'Q5-2', 'Q7-1', 'Q7-2']);
});

test('Q9-A fetish_presentation：Q9直後・multi・private・必須・排他/その他', () => {
  const ids = schema.questions.map((x) => x.id);
  assert.strictEqual(ids.indexOf('fetish_presentation'), ids.indexOf('portrait_styles') + 1);
  const x = byId.fetish_presentation;
  assert.strictEqual(x.no, 'Q9-A');
  assert.strictEqual(x.type, 'multi');
  assert.strictEqual(x.required, true);
  assert.strictEqual(x.visibility, 'private');
  assert.strictEqual(x.label, 'どのような見せ方・シチュエーションに惹かれますか？');
  assert.deepStrictEqual(x.options.map((o) => o.id), ['sweaty_post_workout', 'mid_change', 'shoes_feet', 'socks', 'back_view', 'body_detail', 'uniform_dressed_down', 'suit_dressed_down', 'clothing_detail', 'clean_formal', 'no_preference', 'other']);
  assert.deepStrictEqual(x.options.filter((o) => o.exclusive).map((o) => o.id), ['no_preference']);
  assert.deepStrictEqual(x.options.filter((o) => o.other).map((o) => o.id), ['other']);
  // Q9 は作品全体の写真スタイルのまま（見せ方の選択肢を混ぜない）
  assert.ok(!byId.portrait_styles.options.some((o) => x.options.some((p) => p.id === o.id && o.id !== 'other')));
  assert.ok(schema.sections.find((s) => s.id === 'portrait').questions.join().includes('portrait_styles,fetish_presentation'));
});

test('公開allowlist：Q5の新詳細は公開、fetish_presentationと私的な枝は入らない', () => {
  const items = schema.publicResults.items.map((i) => i.question);
  assert.ok(items.includes('suit_interest') && items.includes('school_uniform_interest'));
  assert.ok(!items.includes('fetish_presentation'));
  for (const id of items) assert.strictEqual(byId[id].visibility, 'public', id);
  for (const [, , , prefix] of BRANCHES) for (const s of ['wear', 'photographed', 'shoot']) assert.ok(!items.includes(prefix + s));
});

test('schema_version は構造変更に合わせて 3、survey_version は据え置き', () => {
  assert.strictEqual(schema.schema_version, '3');
  assert.strictEqual(schema.survey_version, '2026-10');
});

/* ── Public GAS ── */

test('学生服・スーツ：親を選んだ時だけ枝が必須、未選択時の回答はGASが hidden_field で拒否する', () => {
  for (const [cat, set, , prefix] of BRANCHES) {
    for (const [stage, parent] of STAGES) {
      const { ctx, env } = loadPublic();
      const overrides = { [parent]: ['rubber'], ['uniform_' + stage]: undefined, ['workwear_' + stage]: undefined };
      // 親にカテゴリなし：枝なしで通る・枝あり（hidden）は拒否
      const base_ = submit(ctx, validPayload(ctx, overrides)); assert.strictEqual(base_.ok, true, JSON.stringify(base_));
      const hidden = submit(ctx, validPayload(ctx, Object.assign({}, overrides, { [prefix + stage]: [optionIds(set)[0]] })));
      assert.ok(fieldCodes(hidden).includes(`${prefix}${stage}:hidden_field`), `${cat}.${stage}`);
      // 親にカテゴリあり：枝なしは必須エラー、あれば通る
      const shown = Object.assign({}, overrides, { [parent]: [cat] });
      assert.ok(fieldCodes(submit(ctx, validPayload(ctx, Object.assign({}, shown, { [prefix + stage]: undefined })))).includes(`${prefix}${stage}:required`));
      assert.strictEqual(submit(ctx, validPayload(ctx, shown)).ok, true);
      // 許可外の値・他のoptionSetの値は拒否
      assert.ok(fieldCodes(submit(ctx, validPayload(ctx, Object.assign({}, shown, { [prefix + stage]: ['uniform_baseball'] })))).length > 0);
      assert.ok(rows(env).length >= 2);
    }
  }
});

test('学生服の「その他」は自由記述必須、schoolジャージ等の新IDで保存できる', () => {
  const { ctx, env } = loadPublic();
  const answers = { costume_interest: ['school_uniform'], school_uniform_interest: ['other', 'school_jersey'] };
  assert.ok(fieldCodes(submit(ctx, validPayload(ctx, answers))).includes('school_uniform_interest:other_text_required'));
  assert.strictEqual(submit(ctx, validPayload(ctx, answers, { school_uniform_interest: 'ブルマ風' })).ok, true);
  const header = rows(env)[0];
  assert.strictEqual(rows(env)[1][header.indexOf('school_uniform_interest')], '|other|school_jersey|');
});

test('職業制服の追加選択肢が保存できる', () => {
  const { ctx } = loadPublic();
  const answers = { costume_interest: ['workwear'], workwear_interest: ['security', 'railway', 'aviation', 'medical_whitecoat', 'factory_workwear'] };
  assert.strictEqual(submit(ctx, validPayload(ctx, answers)).ok, true);
});

test('fetish_presentation：必須・排他・その他自由記述・不正値拒否、列はschema順（Q9直後）で保存', () => {
  const { ctx, env } = loadPublic();
  assert.ok(fieldCodes(submit(ctx, validPayload(ctx, { fetish_presentation: undefined }))).includes('fetish_presentation:required'));
  assert.ok(fieldCodes(submit(ctx, validPayload(ctx, { fetish_presentation: ['socks', 'no_preference'] }))).includes('fetish_presentation:exclusive_conflict'));
  assert.ok(fieldCodes(submit(ctx, validPayload(ctx, { fetish_presentation: ['other'] }))).includes('fetish_presentation:other_text_required'));
  assert.ok(fieldCodes(submit(ctx, validPayload(ctx, { fetish_presentation: ['nonexistent'] }))).length > 0);
  assert.strictEqual(submit(ctx, validPayload(ctx, { fetish_presentation: ['other', 'socks'] }, { fetish_presentation: '制帽' })).ok, true);
  assert.strictEqual(submit(ctx, validPayload(ctx, { fetish_presentation: ['no_preference'] })).ok, true);
  const header = rows(env)[0];
  assert.strictEqual(header.indexOf('fetish_presentation'), header.indexOf('portrait_styles') + 1);
  assert.strictEqual(rows(env)[1][header.indexOf('fetish_presentation')], '|other|socks|');
});

test('Spreadsheet：新規設問列がschema順に並び、旧ヘッダー（回答入り）のシートは安全停止する', () => {
  const { ctx, env } = loadPublic();
  const expected = schema.questions.flatMap((x) => (x.type === 'matrix' ? x.rows.map((r) => x.id + '__' + r.id) : [x.id]));
  const header = rows(env)[0];
  assert.deepStrictEqual(plain(header.slice(6, 6 + expected.length)), expected);
  for (const id of ['suit_interest', 'school_uniform_interest', 'suit_wear', 'school_uniform_wear', 'suit_photographed', 'school_uniform_photographed', 'suit_shoot', 'school_uniform_shoot', 'fetish_presentation']) assert.ok(header.includes(id), id);
  // 旧スキーマ（新列なし）の回答入りシートへは保存せず停止する
  const sheet = env.spreadsheet.getSheetByName('responses');
  const legacy = header.filter((h) => !/^(suit_|school_uniform_|fetish_presentation)/.test(h));
  sheet.rows.length = 0;
  sheet.rows.push(legacy, legacy.map(() => 'x'));
  const r = submit(ctx, validPayload(ctx));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(sheet.rows.length, 2, '回答済みの旧ヘッダーのシートは変更しない');
});

test('公開結果：fetish_presentation・私的な枝は公開されず、Q5の新詳細だけが出る', () => {
  const { ctx } = loadPublic();
  for (let i = 0; i < 35; i++) {
    const r = submit(ctx, validPayload(ctx, { costume_interest: ['suit', 'school_uniform'], fetish_presentation: ['socks'], suit_interest: ['business_suit'], school_uniform_interest: ['gakuran'] }));
    assert.strictEqual(r.ok, true, JSON.stringify(r));
  }
  ctx.finalizeSurvey_(CLOSED);
  const body = plain(ctx.readPublicResults_());
  const text = JSON.stringify(body);
  for (const forbidden of ['fetish_presentation', 'socks', 'suit_wear', 'school_uniform_wear', 'suit_photographed', 'school_uniform_photographed', 'suit_shoot', 'school_uniform_shoot']) assert.ok(!text.includes(forbidden), forbidden);
  const ids = body.results.items.map((i) => i.id);
  assert.ok(ids.includes('suit_interest') && ids.includes('school_uniform_interest'));
  assert.ok(!ids.includes('fetish_presentation'));
  assert.throws(() => ctx.assertPublicPayload_({ status: 'final', schema_version: '3', survey_version: 'x', total: 30, items: [{ id: 'fetish_presentation', title: 'x', type: 'multi', base: 30, suppressed: false, categories: [] }] }));
});

/* ── Admin ── */

test('Admin：新設問が独立集計され、クロス集計候補が追加される', () => {
  const pub = loadPublic();
  const variants = [
    { costume_interest: ['suit', 'school_uniform', 'workwear'], suit_interest: ['three_piece'], school_uniform_interest: ['gakuran'], workwear_interest: ['railway'], fetish_presentation: ['socks', 'mid_change'], portrait_interest: 'very_interested', suit_photographed: ['shirt_tie'], costume_photographed: ['suit'] },
    { costume_interest: ['suit'], suit_interest: ['three_piece', 'vest_style'], fetish_presentation: ['no_preference'] }
  ];
  variants.forEach((v) => assert.strictEqual(submit(pub.ctx, validPayload(pub.ctx, v)).ok, true));
  const admin = loadAdmin();
  admin.env.spreadsheet = pub.env.spreadsheet;
  const data = plain(admin.ctx.getDashboardData(admin.owner()));
  const view = (id) => data.sections.flatMap((s) => s.questions).find((x) => x.id === id).view;
  const count = (id, opt) => view(id).options.find((o) => o.id === opt).count;
  assert.strictEqual(count('suit_interest', 'three_piece'), 2);
  assert.strictEqual(count('suit_interest', 'vest_style'), 1);
  assert.strictEqual(count('school_uniform_interest', 'gakuran'), 1);
  assert.strictEqual(count('workwear_interest', 'railway'), 1);
  assert.strictEqual(count('fetish_presentation', 'socks'), 1);
  assert.strictEqual(count('fetish_presentation', 'no_preference'), 1);
  assert.strictEqual(count('costume_interest', 'school_uniform'), 1);
  const ids = data.crosstabPresets.map((p) => p.id);
  for (const id of ['interest_x_suit_photographed', 'interest_x_school_photographed', 'interest_x_fetish_presentation']) assert.ok(ids.includes(id), id);
  const ct = data.crosstabPresets.find((p) => p.id === 'interest_x_fetish_presentation');
  assert.ok(ct.cols.some((c) => c.id === 'socks'));
});

/* ── Frontend ── */

test('Frontend：学生服・スーツの枝は親選択で表示され、親を外すと回答が消えpayloadにも残らない', async () => {
  const { document, calls } = await openPage();
  await advanceToReview(document, (title, doc) => {
    if (title !== '興味のある衣装') return;
    choose(doc, 'costume_interest', 'uniform'); // fillVisibleが選んだ既定を外す
    for (const [, , , prefix] of BRANCHES) assert.strictEqual(q(doc, prefix + 'interest').hidden, true);
    choose(doc, 'costume_interest', 'suit');
    assert.strictEqual(q(doc, 'suit_interest').hidden, false);
    assert.strictEqual(q(doc, 'school_uniform_interest').hidden, true);
    next(doc);
    assert.strictEqual(pageTitle(doc), '興味のある衣装', '枝が未選択なら進めない');
    assert.strictEqual(q(doc, 'suit_interest').querySelector('.cp-err').hidden, false);
    choose(doc, 'suit_interest', 'three_piece');
    choose(doc, 'costume_interest', 'school_uniform');
    assert.strictEqual(q(doc, 'school_uniform_interest').hidden, false);
    choose(doc, 'school_uniform_interest', 'gakuran');
    // 親を外すと枝が隠れ、回答もクリアされる
    choose(doc, 'costume_interest', 'suit');
    assert.strictEqual(q(doc, 'suit_interest').hidden, true);
    assert.ok(!Array.from(q(doc, 'suit_interest').querySelectorAll('input')).some((i) => i.checked));
    choose(doc, 'costume_interest', 'school_uniform');
    assert.strictEqual(q(doc, 'school_uniform_interest').hidden, true);
    assert.ok(!Array.from(q(doc, 'school_uniform_interest').querySelectorAll('input')).some((i) => i.checked));
    choose(doc, 'costume_interest', 'rubber');
  });
  next(document);
  await settle();
  const post = calls.find((c) => c.options.method === 'POST');
  const payload = JSON.parse(post.options.body);
  for (const [, , , prefix] of BRANCHES) for (const [s] of STAGES) assert.ok(!(prefix + s in payload.answers), prefix + s);
  assert.deepStrictEqual(payload.answers.costume_interest, ['rubber']);
  assert.ok(Array.isArray(payload.answers.fetish_presentation));
});

test('Frontend：Q5で選んだスーツ詳細がQ6-Aで優先表示される', async () => {
  const { document } = await openPage();
  document.getElementById('cp-age').click();
  next(document);
  choose(document, 'costume_interest', 'suit');
  choose(document, 'suit_interest', 'three_piece');
  next(document);
  choose(document, 'costume_wear', 'suit');
  const primary = Array.from(q(document, 'suit_wear').querySelectorAll(':scope > .cp-options input')).map((i) => i.value);
  assert.deepStrictEqual(primary, ['three_piece']);
  const rest = Array.from(q(document, 'suit_wear').querySelectorAll('details.cp-more input')).map((i) => i.value);
  assert.ok(rest.includes('business_suit') && rest.includes('other') && !rest.includes('three_piece'));
});

test('Frontend：Q9-Aは「特にこだわらない」が排他、「その他」で自由記述欄が出る', async () => {
  const { document } = await openPage();
  await advanceToReview(document, (title, doc) => {
    if (!q(doc, 'fetish_presentation') || q(doc, 'fetish_presentation').hidden) return;
    const input = (v) => Array.from(q(doc, 'fetish_presentation').querySelectorAll('input')).find((i) => i.value === v);
    choose(doc, 'fetish_presentation', 'socks');
    choose(doc, 'fetish_presentation', 'no_preference');
    assert.strictEqual(input('socks').checked, false, '排他選択で他が外れる');
    assert.strictEqual(input('no_preference').checked, true);
    assert.strictEqual(q(doc, 'fetish_presentation').querySelector('[data-other-for]').hidden, true);
    choose(doc, 'fetish_presentation', 'other');
    assert.strictEqual(q(doc, 'fetish_presentation').querySelector('[data-other-for]').hidden, false);
    assert.strictEqual(input('no_preference').checked, false);
    choose(doc, 'fetish_presentation', 'other');
    choose(doc, 'fetish_presentation', 'socks');
  });
});
