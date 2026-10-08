'use strict';
// 調査票改訂（曜日/時間帯の独立・愛知県の地域・海外の国名・顔出し・レタッチ・LED・Q29）の回帰テスト。
const test = require('node:test');
const assert = require('node:assert');
const schema = require('../survey.schema.json');
const { loadPublic, loadAdmin, validPayload, plain } = require('./helpers/gas-env');
const { openPage, settle, q, choose, setText, next, advanceToReview, fillVisible, pageTitle } = require('./helpers/dom');

const NOW = new Date('2026-11-01T12:00:00+09:00');
const CLOSED = new Date('2027-01-15T00:00:00+09:00');
const byId = Object.fromEntries(schema.questions.map((x) => [x.id, x]));
const optionIds = (id) => byId[id].options.map((o) => o.id);
const optionLabels = (id) => byId[id].options.map((o) => o.label);
const submit = (ctx, payload) => plain(ctx.processSubmission_(JSON.stringify(payload), NOW));
const fieldCodes = (r) => (r.fields || []).map((f) => f.field + ':' + f.code);
const rows = (env) => env.spreadsheet.getSheetByName('responses').rows;

/* ── schema ── */

const SLOT_IDS = ['t09_12', 't13_16', 't14_17', 't15_18', 't18_21', 't19_22', 't20_23', 'no_preference', 'other'];
const SLOT_LABELS = ['9:00〜12:00', '13:00〜16:00', '14:00〜17:00', '15:00〜18:00', '18:00〜21:00', '19:00〜22:00', '20:00〜23:00', '特に決まっていない', 'その他'];
const RETIRED_SLOT_IDS = ['morning', 't10_13', 't11_14', 't12_15', 'evening', 'night', 'after_21'];

test('Q13: 平日/土曜/日曜/祝日を独立して複数選択でき、「特に決まっていない」は排他、「その他」は自由記述', () => {
  assert.strictEqual(byId.weekdays.type, 'multi');
  assert.deepStrictEqual(optionIds('weekdays'), ['weekday', 'saturday', 'sunday', 'holiday', 'no_preference', 'other']);
  assert.deepStrictEqual(optionLabels('weekdays'), ['平日', '土曜日', '日曜日', '祝日', '特に決まっていない', 'その他']);
  assert.strictEqual(byId.weekdays.options.find((o) => o.id === 'no_preference').exclusive, true);
  assert.strictEqual(byId.weekdays.options.find((o) => o.id === 'other').other, true);
  assert.ok(!byId.weekdays.showIf);
});

test('平日用・土日祝用の時間帯は同じ選択肢で、別設問・複数選択。旧time_slotsと廃止IDは存在しない', () => {
  assert.ok(!byId.time_slots, '共通のtime_slotsは廃止');
  for (const id of ['weekday_time_slots', 'holiday_time_slots']) {
    assert.strictEqual(byId[id].type, 'multi', id);
    assert.strictEqual(byId[id].required, true, id);
    assert.deepStrictEqual(optionIds(id), SLOT_IDS, id);
    assert.deepStrictEqual(optionLabels(id), SLOT_LABELS, id);
    assert.strictEqual(byId[id].options.find((o) => o.id === 'no_preference').exclusive, true, id);
    assert.strictEqual(byId[id].options.find((o) => o.id === 'other').other, true, id);
    for (const gone of RETIRED_SLOT_IDS) assert.ok(!optionIds(id).includes(gone), id + ':' + gone);
    assert.ok(!optionLabels(id).some((l) => /午前|夕方|夜/.test(l)), id);
  }
  assert.ok(optionLabels('weekday_time_slots').includes('13:00〜16:00') && optionLabels('weekday_time_slots').includes('14:00〜17:00'));
  assert.notStrictEqual(byId.weekday_time_slots.label, byId.holiday_time_slots.label);
  assert.deepStrictEqual(byId.weekday_time_slots.showIf, { question: 'weekdays', includes: 'weekday' });
  assert.deepStrictEqual(byId.holiday_time_slots.showIf, { question: 'weekdays', in: ['saturday', 'sunday', 'holiday'] });
});

test('aichi_area / residence_country は residence への条件付き設問で、residence 自体のIDは維持', () => {
  assert.deepStrictEqual(byId.aichi_area.showIf, { question: 'residence', includes: 'pref_23' });
  assert.strictEqual(byId.aichi_area.required, true);
  assert.deepStrictEqual(optionIds('aichi_area'), ['nagoya_city', 'owari', 'mikawa', 'unknown_other']);
  assert.deepStrictEqual(optionLabels('aichi_area'), ['名古屋市内', '尾張地区', '三河地区', 'その他 / わからない']);
  assert.deepStrictEqual(byId.residence_country.showIf, { question: 'residence', includes: 'overseas' });
  assert.strictEqual(byId.residence_country.required, true);
  assert.strictEqual(byId.residence_country.type, 'text');
  assert.ok(byId.residence_country.maxLength > 0 && byId.residence_country.maxLength <= 100);
  assert.strictEqual(byId.residence.options.find((o) => o.id === 'pref_23').label, '愛知県');
  assert.strictEqual(byId.residence.options.find((o) => o.id === 'overseas').label, '海外');
  const basic = schema.sections.find((s) => s.id === 'basic').questions;
  assert.deepStrictEqual(basic.slice(basic.indexOf('residence'), basic.indexOf('residence') + 3), ['residence', 'aichi_area', 'residence_country']);
});

test('face_exposure に「SNS公開しない前提」があり、既存の意味と重ならない', () => {
  const opt = byId.face_exposure.options.find((o) => o.id === 'ok_if_not_public');
  assert.strictEqual(opt.label, 'SNSなどに公開しない前提なら、顔が写ってもよい');
  for (const id of ['full_face', 'partial_face', 'hidden_face', 'back_body_focus', 'depends', 'no_preference']) assert.ok(optionIds('face_exposure').includes(id), id);
  assert.strictEqual(new Set(optionLabels('face_exposure')).size, optionLabels('face_exposure').length);
});

test('retouch の「両方」は何と何かが明示されている（単なる「両方ほしい」ではない）', () => {
  const both = byId.retouch.options.find((o) => o.id === 'both');
  assert.notStrictEqual(both.label.trim(), '両方ほしい');
  const few = byId.retouch.options.find((o) => o.id === 'few_retouched').label;
  const many = byId.retouch.options.find((o) => o.id === 'many_adjusted').label;
  assert.match(both.label, /しっかりレタッチ/);
  assert.match(both.label, /明るさ・色等を調整/);
  assert.match(both.label, /両方/);
  assert.match(few, /しっかりレタッチ/);
  assert.match(many, /明るさ・色等を調整/);
  assert.deepStrictEqual(optionIds('retouch'), ['few_retouched', 'many_adjusted', 'both', 'none', 'unsure', 'other']);
});

test('LEDビデオライトは「（白色）」付きで、stable IDは不変・RGBとは別', () => {
  const led = byId.equipment_wanted.options.find((o) => o.id === 'led_video_light');
  assert.strictEqual(led.label, 'LEDビデオライト（白色）');
  assert.strictEqual(byId.equipment_wanted.options.find((o) => o.id === 'rgb_light').label, 'RGBカラーライト');
});

test('Q29は「調べてほしいテーマ」で、衣装撮影に限定せず、ID/列は不変', () => {
  const q29 = byId.free_themes;
  assert.strictEqual(q29.no, 'Q29');
  assert.strictEqual(q29.type, 'text');
  assert.strictEqual(q29.required, false);
  assert.strictEqual(q29.label, '今後、服装・フェチ・スポーツ・撮影などについて、調べてほしいテーマがあれば教えてください');
  assert.strictEqual(q29.help, '衣装・服装・フェチ・スポーツ・撮影スタイルなど、自由にお書きください。');
  assert.ok(q29.label.includes('調べてほしい'), '「調べてほしいテーマ」という元の目的を維持');
  assert.ok(!/やってみたい/.test(q29.label + q29.help));
  assert.ok(!/衣装撮影|衣装・撮影について/.test(q29.label + q29.help));
  for (const w of ['衣装', '服装', 'フェチ', 'スポーツ']) assert.ok(q29.help.includes(w), w);
});

test('新設問は非公開（公開allowlistに入らない）で、既存IDの欠落がない', () => {
  assert.strictEqual(byId.aichi_area.visibility, 'private');
  assert.strictEqual(byId.residence_country.visibility, 'private');
  const publicIds = schema.publicResults.items.map((i) => i.question);
  // 居住地・愛知県内エリアは設問がprivateのまま、基本属性（tier:basic）としてだけ公開allowlistに入る（Issue #367）。国名は入らない。
  assert.ok(!publicIds.includes('residence_country'));
  assert.strictEqual(byId.residence.visibility, 'private');
  for (const id of ['residence', 'aichi_area']) assert.strictEqual(schema.publicResults.items.find((i) => i.question === id).tier, 'basic');
  assert.strictEqual(schema.schema_version, '3');
});

/* ── core / Public GAS ── */

test('平日・土日祝の時間帯は別列に保存され、旧IDや排他違反は拒否される', () => {
  const { env, ctx } = loadPublic();
  const ok = validPayload(ctx, { weekdays: ['weekday', 'saturday', 'holiday'], weekday_time_slots: ['t13_16', 't19_22'], holiday_time_slots: ['t14_17'] });
  assert.deepStrictEqual(submit(ctx, ok), { ok: true, status: 'accepted' });
  const header = rows(env)[0];
  assert.strictEqual(rows(env)[1][header.indexOf('weekdays')], '|weekday|saturday|holiday|');
  assert.strictEqual(rows(env)[1][header.indexOf('weekday_time_slots')], '|t13_16|t19_22|');
  assert.strictEqual(rows(env)[1][header.indexOf('holiday_time_slots')], '|t14_17|');
  assert.ok(!header.includes('time_slots'));
  assert.ok(fieldCodes(submit(ctx, validPayload(ctx, { weekdays: ['weekday', 'no_preference'] }))).includes('weekdays:exclusive_conflict'));
  assert.ok(fieldCodes(submit(ctx, validPayload(ctx, { weekday_time_slots: ['t13_16', 'no_preference'] }))).includes('weekday_time_slots:exclusive_conflict'));
  for (const gone of RETIRED_SLOT_IDS) assert.ok(fieldCodes(submit(ctx, validPayload(ctx, { weekday_time_slots: [gone] }))).includes('weekday_time_slots:invalid_option'), gone);
  assert.strictEqual(rows(env).length, 2);
});

test('時間帯設問は該当区分を選んだ時だけ必須で、未選択区分の回答はhidden_fieldで拒否（Public GAS）', () => {
  const { env, ctx } = loadPublic();
  const miss = (answers) => fieldCodes(submit(ctx, validPayload(ctx, answers)));
  // 平日のみ: 平日時間帯が必須、土日祝時間帯は送れない
  assert.ok(miss({ weekdays: ['weekday'], weekday_time_slots: undefined }).includes('weekday_time_slots:required'));
  assert.ok(miss({ weekdays: ['weekday'], holiday_time_slots: ['t13_16'] }).includes('holiday_time_slots:hidden_field'));
  // 土/日/祝のいずれか: 土日祝時間帯が必須、平日時間帯は送れない
  for (const d of ['saturday', 'sunday', 'holiday']) {
    assert.ok(miss({ weekdays: [d], holiday_time_slots: undefined }).includes('holiday_time_slots:required'), d);
    assert.ok(miss({ weekdays: [d], weekday_time_slots: ['t13_16'] }).includes('weekday_time_slots:hidden_field'), d);
  }
  // 特に決まっていない / その他のみ: どちらも送れない
  for (const only of [['no_preference'], ['other']]) {
    const codes = fieldCodes(submit(ctx, validPayload(ctx, { weekdays: only }, only[0] === 'other' ? { weekdays: '平日夜のみ' } : {}, {})));
    assert.deepStrictEqual(codes, [], only.join());
    assert.ok(miss({ weekdays: only, weekday_time_slots: ['t13_16'] }).includes('weekday_time_slots:hidden_field'));
    assert.ok(miss({ weekdays: only, holiday_time_slots: ['t13_16'] }).includes('holiday_time_slots:hidden_field'));
  }
  // 両方選べば両方必須
  const both = miss({ weekdays: ['weekday', 'sunday'], weekday_time_slots: undefined, holiday_time_slots: undefined });
  assert.ok(both.includes('weekday_time_slots:required') && both.includes('holiday_time_slots:required'));
  assert.ok(rows(env).length >= 1);
});

test('愛知県を選んだ時だけ aichi_area が必須で、それ以外では送信不可（Public GAS）', () => {
  const { env, ctx } = loadPublic();
  const missing = validPayload(ctx, { residence: 'pref_23', aichi_area: undefined });
  assert.ok(fieldCodes(submit(ctx, missing)).includes('aichi_area:required'));
  const invalid = validPayload(ctx, { residence: 'pref_23', aichi_area: 'tokyo' });
  assert.ok(fieldCodes(submit(ctx, invalid)).includes('aichi_area:invalid_option'));
  assert.strictEqual(rows(env).length, 1);

  const ok = validPayload(ctx, { residence: 'pref_23', aichi_area: 'mikawa' });
  assert.deepStrictEqual(submit(ctx, ok), { ok: true, status: 'accepted' });
  const header = rows(env)[0];
  assert.strictEqual(rows(env)[1][header.indexOf('aichi_area')], 'mikawa');

  const notAichi = validPayload(ctx, { residence: 'pref_13', aichi_area: 'nagoya_city' });
  assert.ok(fieldCodes(submit(ctx, notAichi)).includes('aichi_area:hidden_field'));
  assert.strictEqual(rows(env).length, 2, '拒否された回答は保存されない');
  // 愛知県以外で aichi_area なしは通る
  assert.deepStrictEqual(submit(ctx, validPayload(ctx, { residence: 'pref_13' })), { ok: true, status: 'accepted' });
  assert.strictEqual(rows(env)[2][header.indexOf('aichi_area')], '');
});

test('海外を選んだ時だけ国名が必須で、それ以外では送信不可・文字数上限あり（Public GAS）', () => {
  const { env, ctx } = loadPublic();
  assert.ok(fieldCodes(submit(ctx, validPayload(ctx, { residence: 'overseas', residence_country: undefined }))).includes('residence_country:required'));
  assert.ok(fieldCodes(submit(ctx, validPayload(ctx, { residence: 'overseas', residence_country: '   ' }))).includes('residence_country:required'));
  const tooLong = 'あ'.repeat(byId.residence_country.maxLength + 1);
  assert.ok(fieldCodes(submit(ctx, validPayload(ctx, { residence: 'overseas', residence_country: tooLong }))).includes('residence_country:too_long'));
  assert.ok(fieldCodes(submit(ctx, validPayload(ctx, { residence: 'pref_23', aichi_area: 'owari', residence_country: 'タイ' }))).includes('residence_country:hidden_field'));
  assert.ok(fieldCodes(submit(ctx, validPayload(ctx, { residence: 'other', residence_country: 'タイ' }), NOW)).includes('residence_country:hidden_field'));
  assert.strictEqual(rows(env).length, 1);

  assert.deepStrictEqual(submit(ctx, validPayload(ctx, { residence: 'overseas', residence_country: ' タイ ' })), { ok: true, status: 'accepted' });
  const header = rows(env)[0];
  assert.strictEqual(rows(env)[1][header.indexOf('residence_country')], 'タイ');
  assert.strictEqual(rows(env)[1][header.indexOf('residence')], 'overseas');
});

test('residence を変えて非表示になった設問の回答は拒否される（hidden回答は保存しない）', () => {
  const { ctx } = loadPublic();
  const stale = validPayload(ctx, { residence: 'pref_13', aichi_area: 'owari', residence_country: 'タイ' });
  const codes = fieldCodes(submit(ctx, stale));
  assert.ok(codes.includes('aichi_area:hidden_field') && codes.includes('residence_country:hidden_field'));
});

test('国名は数式として解釈されないようsanitizeされる', () => {
  const { env, ctx } = loadPublic();
  submit(ctx, validPayload(ctx, { residence: 'overseas', residence_country: '=SUM(A1)' }));
  const header = rows(env)[0];
  assert.strictEqual(rows(env)[1][header.indexOf('residence_country')], "'=SUM(A1)");
});

test('Spreadsheet保存列は schema の設問列と一致し、新設問の列が含まれる', () => {
  const { env, ctx } = loadPublic();
  const header = rows(env)[0];
  const questionKeys = ctx.SurveyCore.questionColumns(ctx.SURVEY_SCHEMA).map((c) => c.key);
  assert.deepStrictEqual(plain(header.slice(6, 6 + questionKeys.length)), plain(questionKeys));
  assert.strictEqual(header.length, 6 + questionKeys.length + 3);
  assert.ok(questionKeys.includes('aichi_area') && questionKeys.includes('residence_country'));
  assert.ok(questionKeys.indexOf('residence') < questionKeys.indexOf('aichi_area'));
  // schemaの設問順を独立に展開した期待値（matrixは行ごとに1列）
  const expected = schema.questions.flatMap((x) => (x.type === 'matrix' ? x.rows.map((r) => x.id + '__' + r.id) : [x.id]));
  assert.deepStrictEqual(plain(questionKeys), expected);
  assert.deepStrictEqual(plain(header.slice(-3)), ['other_texts', 'client_elapsed_ms', 'notification_status']);
});

test('公開結果へ国名（residence_country）は混入しない（aichi_area・residenceは基本属性として公開）', () => {
  const { ctx } = loadPublic();
  for (let i = 0; i < 35; i++) {
    const overrides = i % 3 === 0 ? { residence: 'overseas', residence_country: '秘匿国名テスト' }
      : { residence: 'pref_23', aichi_area: i % 2 ? 'nagoya_city' : 'owari' };
    const r = submit(ctx, validPayload(ctx, overrides));
    assert.strictEqual(r.ok, true, JSON.stringify(r));
  }
  ctx.finalizeSurvey_(CLOSED);
  const text = JSON.stringify(plain(ctx.readPublicResults_()));
  // 居住地・愛知県内エリアは基本属性として公開されるが、国名（自由記述）は混入しない
  for (const forbidden of ['residence_country', '秘匿国名テスト']) assert.ok(!text.includes(forbidden), forbidden);
  const ids = plain(ctx.readPublicResults_()).results.items.map((i) => i.id);
  assert.ok(ids.includes('aichi_area') && ids.includes('residence') && !ids.includes('residence_country'));
});

/* ── Admin ── */

test('Adminで新設問（愛知の地域は集計、国名は自由記述一覧）を確認できる', () => {
  const pub = loadPublic();
  submit(pub.ctx, validPayload(pub.ctx, { residence: 'pref_23', aichi_area: 'nagoya_city' }));
  submit(pub.ctx, validPayload(pub.ctx, { residence: 'pref_23', aichi_area: 'mikawa' }));
  submit(pub.ctx, validPayload(pub.ctx, { residence: 'overseas', residence_country: '=タイ' }));
  const admin = loadAdmin();
  admin.env.spreadsheet = pub.env.spreadsheet;
  const data = plain(admin.ctx.getDashboardData());
  const area = data.sections.flatMap((s) => s.questions).find((x) => x.id === 'aichi_area');
  assert.ok(area, 'aichi_area が基本情報セクションに出る');
  assert.strictEqual(area.view.base, 2);
  assert.strictEqual(area.view.options.find((o) => o.id === 'nagoya_city').count, 1);
  assert.strictEqual(area.view.options.find((o) => o.id === 'mikawa').count, 1);
  const country = data.freeText.texts.find((t) => t.id === 'residence_country');
  assert.ok(country, '国名はAdminの自由記述一覧で確認できる');
  assert.deepStrictEqual(country.items.map((i) => i.text), ['=タイ'], 'sanitizeは表示時に戻る');
  assert.ok(data.freeText.texts.some((t) => t.id === 'free_themes' && t.label.includes('調べてほしい')));
});

/* ── Frontend ── */

test('Frontend：愛知県を選んだ時だけ aichi_area が表示・必須になり、送信payloadに残る', async () => {
  const { document, calls, window } = await openPage();
  await advanceToReview(document, (title, doc) => {
    if (title !== '基本情報') return;
    assert.ok(q(doc, 'aichi_area').hidden, '初期は非表示');
    choose(doc, 'residence', 'pref_23');
    assert.ok(!q(doc, 'aichi_area').hidden, '愛知県で表示');
    assert.ok(q(doc, 'residence_country').hidden);
    choose(doc, 'aichi_area', 'owari');
  });
  next(document);
  await settle();
  const post = calls.find((c) => c.options.method === 'POST');
  const payload = JSON.parse(post.options.body);
  assert.strictEqual(payload.answers.residence, 'pref_23');
  assert.strictEqual(payload.answers.aichi_area, 'owari');
  assert.ok(!('residence_country' in payload.answers));
  assert.ok(window);
});

test('Frontend：愛知県で地域未選択・海外で国名未入力だと基本情報から先へ進めない（必須）', async () => {
  const { document, window } = await openPage();
  document.getElementById('cp-age').click();
  next(document);
  for (let i = 0; i < 30 && pageTitle(document) !== '基本情報'; i++) { fillVisible(document); next(document); }
  assert.strictEqual(pageTitle(document), '基本情報');
  fillVisible(document);
  choose(document, 'residence', 'pref_23');
  next(document);
  assert.strictEqual(pageTitle(document), '基本情報', 'aichi_area 未回答では進めない');
  assert.ok(q(document, 'aichi_area').textContent.includes('必須') || q(document, 'aichi_area').querySelector('.cp-error'));
  choose(document, 'aichi_area', 'mikawa');
  choose(document, 'residence', 'overseas');
  next(document);
  assert.strictEqual(pageTitle(document), '基本情報', '国名未入力では進めない');
  setText(window, q(document, 'residence_country').querySelector('input[data-text-input]'), 'タイ');
  next(document);
  assert.notStrictEqual(pageTitle(document), '基本情報');
});

test('Frontend：海外を選ぶと国名が必須で、選び直すと国名がpayloadから消える', async () => {
  const { document, calls, window } = await openPage();
  await advanceToReview(document, (title, doc) => {
    if (title !== '基本情報') return;
    choose(doc, 'residence', 'overseas');
    assert.ok(!q(doc, 'residence_country').hidden, '海外で国名欄が表示');
    const input = q(doc, 'residence_country').querySelector('input[data-text-input]');
    assert.ok(input, '国名は1行入力');
    assert.strictEqual(input.tagName, 'INPUT');
    setText(window, input, 'タイ');
    assert.strictEqual(input.value, 'タイ');
    choose(doc, 'residence', 'pref_13');
    assert.ok(q(doc, 'residence_country').hidden, '海外以外で非表示');
    assert.strictEqual(q(doc, 'residence_country').querySelector('input[data-text-input]').value, '', '非表示時に入力を消す');
    choose(doc, 'residence', 'pref_23');
    choose(doc, 'aichi_area', 'owari');
    choose(doc, 'residence', 'pref_13');
    assert.ok(q(doc, 'aichi_area').hidden);
    assert.strictEqual(q(doc, 'aichi_area').querySelector('input:checked'), null, '愛知県以外へ変更したら地域をクリア');
  });
  next(document);
  await settle();
  const payload = JSON.parse(calls.find((c) => c.options.method === 'POST').options.body);
  assert.strictEqual(payload.answers.residence, 'pref_13');
  assert.ok(!('aichi_area' in payload.answers));
  assert.ok(!('residence_country' in payload.answers));
});

test('Frontend：時間帯設問は平日／土日祝の選択に応じて表示・必須になり、非表示にした回答はpayloadから消える', async () => {
  const { document, calls, window } = await openPage();
  const hidden = (id) => q(document, id).hidden;
  const checked = (id) => Array.from(q(document, id).querySelectorAll('input:checked')).map((i) => i.value);
  document.getElementById('cp-age').click();
  next(document);
  for (let i = 0; i < 30 && pageTitle(document) !== '撮影時間・曜日・時間帯'; i++) { fillVisible(document); next(document); }
  assert.strictEqual(pageTitle(document), '撮影時間・曜日・時間帯');
  assert.ok(hidden('weekday_time_slots') && hidden('holiday_time_slots'), '曜日未選択では両方非表示');

  choose(document, 'weekdays', 'weekday');
  assert.ok(!hidden('weekday_time_slots') && hidden('holiday_time_slots'), '平日のみ');
  choose(document, 'weekdays', 'saturday');
  assert.ok(!hidden('weekday_time_slots') && !hidden('holiday_time_slots'), '平日+土曜');
  choose(document, 'weekday_time_slots', 't13_16');
  choose(document, 'holiday_time_slots', 't14_17');
  assert.deepStrictEqual([checked('weekday_time_slots'), checked('holiday_time_slots')], [['t13_16'], ['t14_17']]);

  // 平日を外すと平日時間帯は非表示・クリア。土曜を外して「特に決まっていない」だけにすると土日祝時間帯も消える。
  choose(document, 'weekdays', 'weekday');
  assert.ok(hidden('weekday_time_slots') && !hidden('holiday_time_slots'));
  assert.deepStrictEqual(checked('weekday_time_slots'), []);
  choose(document, 'weekdays', 'sunday');
  choose(document, 'weekdays', 'saturday');
  assert.ok(!hidden('holiday_time_slots'), '日曜が残っている間は表示');
  choose(document, 'weekdays', 'no_preference');
  assert.ok(hidden('weekday_time_slots') && hidden('holiday_time_slots'), '「特に決まっていない」のみなら時間帯は不要');
  assert.deepStrictEqual(checked('holiday_time_slots'), []);

  // 必須: 平日を選んで時間帯未回答なら先へ進めない
  choose(document, 'weekdays', 'weekday');
  next(document);
  assert.strictEqual(pageTitle(document), '撮影時間・曜日・時間帯');
  assert.ok(q(document, 'weekday_time_slots').textContent.includes('必須'));
  choose(document, 'weekday_time_slots', 't19_22');
  fillVisible(document); // 同ページの他の必須設問（実撮影時間）
  next(document);
  assert.notStrictEqual(pageTitle(document), '撮影時間・曜日・時間帯');

  for (let i = 0; i < 30 && pageTitle(document) !== '送信前の確認'; i++) { fillVisible(document); next(document); }
  assert.strictEqual(pageTitle(document), '送信前の確認');
  next(document);
  await settle();
  const payload = JSON.parse(calls.find((c) => c.options.method === 'POST').options.body);
  assert.deepStrictEqual(payload.answers.weekdays, ['weekday']);
  assert.deepStrictEqual(payload.answers.weekday_time_slots, ['t19_22']);
  assert.ok(!('holiday_time_slots' in payload.answers), '非表示の土日祝時間帯は送らない');
  assert.ok(!('time_slots' in payload.answers));
  assert.ok(window);
});

test('Adminは平日と土日祝の時間帯を別々に集計し、混ぜない', () => {
  const pub = loadPublic();
  submit(pub.ctx, validPayload(pub.ctx, { weekdays: ['weekday'], weekday_time_slots: ['t13_16', 't18_21'], holiday_time_slots: undefined }));
  submit(pub.ctx, validPayload(pub.ctx, { weekdays: ['weekday', 'sunday'], weekday_time_slots: ['t13_16'], holiday_time_slots: ['t09_12'] }));
  submit(pub.ctx, validPayload(pub.ctx, { weekdays: ['holiday'], weekday_time_slots: undefined, holiday_time_slots: ['t20_23'] }));
  const admin = loadAdmin();
  admin.env.spreadsheet = pub.env.spreadsheet;
  const data = plain(admin.ctx.getDashboardData());
  const view = (id) => data.sections.flatMap((s) => s.questions).find((x) => x.id === id).view;
  const count = (v, id) => v.options.find((o) => o.id === id).count;
  const wd = view('weekday_time_slots');
  const hd = view('holiday_time_slots');
  assert.strictEqual(wd.base, 2);
  assert.strictEqual(hd.base, 2);
  assert.strictEqual(count(wd, 't13_16'), 2);
  assert.strictEqual(count(wd, 't18_21'), 1);
  assert.strictEqual(count(wd, 't09_12'), 0, '土日祝の回答が平日に混ざらない');
  assert.strictEqual(count(hd, 't09_12'), 1);
  assert.strictEqual(count(hd, 't20_23'), 1);
  assert.strictEqual(count(hd, 't13_16'), 0, '平日の回答が土日祝に混ざらない');
  assert.ok(!data.sections.flatMap((s) => s.questions).some((x) => x.id === 'time_slots'));
  const ids = data.crosstabPresets.map((p) => p.id);
  assert.ok(ids.includes('interest_x_weekday_time') && ids.includes('interest_x_holiday_time') && !ids.includes('interest_x_timeslot'));
});
