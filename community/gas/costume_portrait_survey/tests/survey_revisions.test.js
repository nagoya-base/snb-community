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

test('曜日（平日/土曜/日曜/祝日）は時間帯と独立した複数選択で、組み合わせ設問ではない', () => {
  assert.strictEqual(byId.weekdays.type, 'multi');
  assert.deepStrictEqual(optionIds('weekdays'), ['weekday', 'saturday', 'sunday', 'holiday', 'no_preference', 'other']);
  assert.deepStrictEqual(optionLabels('weekdays').slice(0, 5), ['平日', '土曜日', '日曜日', '祝日', '特に決まっていない']);
  assert.ok(!optionLabels('weekdays').some((l) => /[0-9]|午前|夕方|夜/.test(l)), '曜日設問に時間帯を含めない');
  assert.strictEqual(byId.time_slots.type, 'multi');
  assert.ok(!byId.time_slots.showIf && !byId.weekdays.showIf, '曜日と時間帯は互いに条件付けしない');
  // 既存 question ID は維持
  assert.ok(byId.weekdays && byId.time_slots);
});

test('時間帯に 13:00〜16:00 / 14:00〜17:00 を含む候補が揃っている', () => {
  assert.deepStrictEqual(optionLabels('time_slots'), ['午前', '10:00〜13:00', '11:00〜14:00', '12:00〜15:00', '13:00〜16:00', '14:00〜17:00', '15:00〜18:00', '夕方', '夜', '特に決まっていない', 'その他']);
  assert.ok(optionLabels('time_slots').includes('13:00〜16:00'));
  assert.ok(optionLabels('time_slots').includes('14:00〜17:00'));
  assert.strictEqual(new Set(optionIds('time_slots')).size, optionIds('time_slots').length);
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

test('Q29は「衣装撮影」限定でなく、衣装・服装・フェチ・スポーツ・企画を受け付けるが ID/列は不変', () => {
  const q29 = byId.free_themes;
  assert.strictEqual(q29.no, 'Q29');
  assert.strictEqual(q29.type, 'text');
  assert.strictEqual(q29.required, false);
  assert.strictEqual(q29.label, '今後やってみたい撮影テーマや企画があれば教えてください');
  assert.ok(!/衣装撮影|衣装・撮影について/.test(q29.label + q29.help));
  for (const w of ['衣装', '服装', 'フェチ', 'スポーツ']) assert.ok(q29.help.includes(w), w);
});

test('新設問は非公開（公開allowlistに入らない）で、既存IDの欠落がない', () => {
  assert.strictEqual(byId.aichi_area.visibility, 'private');
  assert.strictEqual(byId.residence_country.visibility, 'private');
  const publicIds = schema.publicResults.items.map((i) => i.question);
  assert.ok(!publicIds.includes('aichi_area') && !publicIds.includes('residence_country') && !publicIds.includes('residence'));
  assert.strictEqual(schema.schema_version, '2');
});

/* ── core / Public GAS ── */

test('平日/土曜/日曜/祝日を独立して複数選択でき、保存される。「特に決まっていない」は排他', () => {
  const { env, ctx } = loadPublic();
  const ok = validPayload(ctx, { weekdays: ['weekday', 'saturday', 'sunday', 'holiday'], time_slots: ['t13_16', 't14_17', 'evening'] });
  assert.deepStrictEqual(submit(ctx, ok), { ok: true, status: 'accepted' });
  const header = rows(env)[0];
  assert.strictEqual(rows(env)[1][header.indexOf('weekdays')], '|weekday|saturday|sunday|holiday|');
  assert.strictEqual(rows(env)[1][header.indexOf('time_slots')], '|t13_16|t14_17|evening|');
  const mixed = validPayload(ctx, { weekdays: ['weekday', 'no_preference'] });
  assert.ok(fieldCodes(submit(ctx, mixed)).includes('weekdays:exclusive_conflict'));
  const slotMixed = validPayload(ctx, { time_slots: ['t13_16', 'no_preference'] });
  assert.ok(fieldCodes(submit(ctx, slotMixed)).includes('time_slots:exclusive_conflict'));
  const oldId = validPayload(ctx, { time_slots: ['t09_12'] });
  assert.ok(fieldCodes(submit(ctx, oldId)).includes('time_slots:invalid_option'));
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

test('公開結果へ aichi_area・国名・地域値は混入しない（allowlist）', () => {
  const { ctx } = loadPublic();
  for (let i = 0; i < 35; i++) {
    const overrides = i % 3 === 0 ? { residence: 'overseas', residence_country: '秘匿国名テスト' }
      : { residence: 'pref_23', aichi_area: i % 2 ? 'nagoya_city' : 'owari' };
    const r = submit(ctx, validPayload(ctx, overrides));
    assert.strictEqual(r.ok, true, JSON.stringify(r));
  }
  ctx.finalizeSurvey_(CLOSED);
  const text = JSON.stringify(plain(ctx.readPublicResults_()));
  for (const forbidden of ['aichi_area', 'residence_country', 'residence', '秘匿国名テスト', 'nagoya_city', 'owari', 'mikawa', 'overseas', 'pref_23']) {
    assert.ok(!text.includes(forbidden), forbidden);
  }
  const ids = plain(ctx.readPublicResults_()).results.items.map((i) => i.id);
  assert.ok(!ids.includes('aichi_area') && !ids.includes('residence_country'));
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
  assert.ok(data.freeText.texts.some((t) => t.id === 'free_themes' && t.label.includes('今後やってみたい')));
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
