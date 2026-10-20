'use strict';
// Public GAS と多言語化（Issue #398）：server は表示言語を知らず、stable ID だけを受理する。
//  - ja / en / ko / zh-Hans / zh-Hant のどの画面から送られても、同じ answer ID なら同じ validation・同じ保存結果になる。
//  - 翻訳 label を回答として送っても受理しない（invalid_option）。
//  - 言語・locale の key は payload に受け付けない（unknown_field）。response_locale は保存しない（採用しない設計）。
const test = require('node:test');
const assert = require('node:assert');
const { loadPublic, validPayload, plain, TEST_TOKEN, NOW } = require('./helpers/gas-env');
const i18n = require('../tools/i18n');
const schema = require('../survey.schema.json');

const dicts = i18n.loadDicts();
const LOCALES = ['ja', 'en', 'ko', 'zh-Hans', 'zh-Hant'];
const submit = (ctx, payload) => plain(ctx.processSubmission_(JSON.stringify(payload), NOW));
const rows = (env) => env.spreadsheet.getSheetByName('responses').rows;
const fieldsOf = (result) => (result.fields || []).map((f) => `${f.field}:${f.code}`);
const labelIn = (locale, qid, oid) => (locale === 'ja' ? schema.questions.find((q) => q.id === qid).options.find((o) => o.id === oid).label : dicts[locale].questions[qid].options[oid]);

test('表示言語が違っても、同じ answer ID の payload は同じ validation・同じ保存行になる（5言語）', () => {
  const stored = [];
  for (const locale of LOCALES) {
    const { env, ctx } = loadPublic();
    // 言語ごとに別画面から送られた想定。payload は ID だけで言語を含まないので同一。
    const payload = validPayload(ctx, { favorite_uniforms: ['baseball', 'other'], top_uniform: 'baseball', feedback: `free text typed in ${locale}` }, { favorite_uniforms: `my own ${locale} text` });
    assert.deepStrictEqual(Object.keys(payload).sort(), ['answers', 'elapsed_ms', 'other_texts', 'schema_version', 'uuid']);
    assert.deepStrictEqual(submit(ctx, payload), { ok: true, status: 'accepted' }, locale);
    const [head, row] = rows(env);
    const record = {};
    head.forEach((name, i) => { record[name] = row[i]; });
    ['timestamp', 'respondent_hash'].forEach((k) => delete record[k]);
    stored.push(record);
  }
  // 保存列（回答 ID）は言語で分裂しない。自由記述だけが入力原文のまま異なる。
  stored.forEach((record) => {
    assert.strictEqual(record.favorite_uniforms, '|baseball|other|');
    assert.strictEqual(record.top_uniform, 'baseball');
    assert.strictEqual(record.age_confirmed, 'yes');
  });
  const strip = (r) => { const c = Object.assign({}, r); delete c.feedback; delete c.other_texts; return c; };
  stored.slice(1).forEach((record) => assert.deepStrictEqual(strip(record), strip(stored[0])));
  assert.deepStrictEqual(stored.map((r) => r.feedback), LOCALES.map((l) => `free text typed in ${l}`), '自由記述は入力原文');
});

test('client が翻訳 label を回答として送っても受理しない（どの言語の label も invalid_option）', () => {
  const targets = [['age_confirmed', 'yes'], ['club_awareness', 'attended'], ['prefecture', 'pref_23'], ['age', '30_39']];
  for (const locale of LOCALES) {
    for (const [qid, oid] of targets) {
      const { env, ctx } = loadPublic();
      const label = labelIn(locale, qid, oid);
      assert.notStrictEqual(label, oid);
      const payload = validPayload(ctx, {});
      payload.answers[qid] = label;
      const result = submit(ctx, payload);
      assert.strictEqual(result.ok, false, `${locale} ${qid}=${label}`);
      assert.ok(fieldsOf(result).includes(`${qid}:invalid_option`), `${locale} ${qid}: ${fieldsOf(result)}`);
      assert.strictEqual(rows(env).length, 1, '保存されない（ヘッダーのみ）');
    }
  }
});

test('multiple の翻訳 label・scale の anchor 文言・notApplicable の翻訳も受理しない', () => {
  for (const locale of LOCALES.filter((l) => l !== 'ja')) {
    const { ctx } = loadPublic();
    const multi = validPayload(ctx, {});
    multi.answers.favorite_uniforms = [labelIn(locale, 'favorite_uniforms', 'baseball')];
    assert.ok(fieldsOf(submit(ctx, multi)).some((f) => f.startsWith('favorite_uniforms:')), locale);

    const scaleAnchors = dicts[locale].questions.overall_satisfaction;
    for (const bad of [scaleAnchors.anchors['4'], scaleAnchors.notApplicable]) {
      const payload = validPayload(ctx, { club_awareness: 'attended', last_attended: 'within_3m' });
      payload.answers.overall_satisfaction = bad;
      const result = submit(ctx, payload);
      assert.strictEqual(result.ok, false, `${locale}: ${bad}`);
      assert.ok(fieldsOf(result).includes('overall_satisfaction:invalid_option'), fieldsOf(result).join(','));
    }
  }
  // 日本語 label も同様（表示 label は保存値にならない）
  const { ctx } = loadPublic();
  const ja = validPayload(ctx, {});
  ja.answers.age_confirmed = 'はい';
  assert.ok(fieldsOf(submit(ctx, ja)).includes('age_confirmed:invalid_option'));
});

test('stable ID だけを受理する：全 single 設問の全 option ID は受理され、label 文字列は 1 件も受理されない', () => {
  const { core } = require('./helpers/fixtures');
  const singles = schema.questions.filter((q) => q.type === 'single' && q.id !== 'age_confirmed');
  assert.ok(singles.length > 10);
  for (const q of singles) {
    const ids = q.options.map((o) => o.id);
    for (const locale of LOCALES) {
      q.options.forEach((o) => {
        const label = labelIn(locale, q.id, o.id);
        if (ids.includes(label)) return; // 例: 'x' のように label が ID と偶然同じものは対象外
        const result = core.validateAnswers(schema, { age_confirmed: 'yes', [q.id]: label }, {});
        assert.ok(result.errors.some((e) => e.field === q.id && (e.code === 'invalid_option' || e.code === 'hidden_field')), `${locale} ${q.id}=${label}`);
      });
    }
  }
});

test('言語・locale の key は payload に受け付けない（unknown_field）。response_locale は保存列にもない', () => {
  for (const key of ['locale', 'response_locale', 'lang', 'language', 'ui_locale']) {
    const { env, ctx } = loadPublic();
    const payload = validPayload(ctx, {});
    payload[key] = 'ko';
    const result = submit(ctx, payload);
    assert.strictEqual(result.ok, false, key);
    assert.ok(fieldsOf(result).includes(`${key}:unknown_field`), key);
    assert.strictEqual(rows(env).length, 1);
  }
  const { env } = loadPublic();
  assert.ok(!rows(env)[0].some((name) => /locale|lang/i.test(name)), '保存列に言語を持たない');
  assert.ok(!schema.persistenceSchema.systemFields.some((name) => /locale|lang/i.test(name)));
  assert.deepStrictEqual(rows(env)[0].slice(0, schema.persistenceSchema.systemFields.length), schema.persistenceSchema.systemFields);
});

test('answers / other_texts の中に言語キーを紛れ込ませても拒否する（unknown_field）', () => {
  const { ctx } = loadPublic();
  const payload = validPayload(ctx, {});
  payload.answers.locale = 'en';
  assert.ok(fieldsOf(submit(ctx, payload)).includes('locale:unknown_field'));
});

test('submit_excluded でも言語に関係なく同じ validation：translated label は拒否、ID は test として保存される', () => {
  const { env, ctx } = loadPublic();
  const bad = validPayload(ctx, {}, {}, { test_token: TEST_TOKEN, test_run_id: 'run_i18n' });
  bad.answers.age_confirmed = labelIn('en', 'age_confirmed', 'yes');
  assert.strictEqual(submit(ctx, bad).ok, false);
  const good = validPayload(ctx, {}, {}, { test_token: TEST_TOKEN, test_run_id: 'run_i18n' });
  assert.deepStrictEqual(submit(ctx, good), { ok: true, status: 'accepted_test', test: true });
  const head = rows(env)[0];
  assert.strictEqual(rows(env)[1][head.indexOf('response_mode')], 'test');
  // 言語を変えて同じ test_run_id で再送しても、重複 hash は言語に影響されず抑止される
  const again = validPayload(ctx, {}, {}, { test_token: TEST_TOKEN, test_run_id: 'run_i18n' });
  again.uuid = good.uuid; // 同じブラウザ（uuid）
  const result = submit(ctx, again);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error, 'duplicate_submission');
});

test('under18 は言語に関係なく無保存。重複 hash（uuid 単位）も言語に依存しない', () => {
  const { env, ctx } = loadPublic();
  const minor = validPayload(ctx, { age_confirmed: 'no' });
  assert.deepStrictEqual(submit(ctx, minor), { ok: true, status: 'ineligible' });
  assert.strictEqual(rows(env).length, 1);
  const first = validPayload(ctx, { feedback: '한국어로 작성' });
  assert.strictEqual(submit(ctx, first).ok, true);
  const second = validPayload(ctx, { feedback: 'Written in English' });
  second.uuid = first.uuid; // 同じブラウザで言語を変えて再送
  assert.strictEqual(submit(ctx, second).error, 'duplicate_submission');
  assert.strictEqual(rows(env).length, 2);
});

test('5言語の回答を Admin 集計へ通しても、選択肢は stable ID の同じセルに集まり、言語別に分裂しない（Admin は日本語 label）', () => {
  const aggregate = require('../src/survey-aggregate.js');
  const { env, ctx } = loadPublic();
  LOCALES.forEach((locale) => {
    const payload = validPayload(ctx, { favorite_uniforms: ['baseball'], top_uniform: 'baseball', feedback: `${locale} free text` });
    assert.strictEqual(submit(ctx, payload).ok, true, locale);
  });
  const [head, ...body] = rows(env);
  const objects = body.map((row) => { const o = {}; head.forEach((name, i) => { o[name] = row[i]; }); return o; });
  const { valid, counts } = aggregate.classifyRows(schema, objects);
  assert.strictEqual(counts.production_valid, 5);
  assert.strictEqual(valid.length, 5);
  const question = schema.questions.find((q) => q.id === 'favorite_uniforms');
  const tally = aggregate.tallyQuestion(schema, question, valid.map((r) => r.answers));
  assert.strictEqual(tally.targetCount, 5);
  assert.strictEqual(tally.counts.baseball, 5, '言語によらず 1 つのセル');
  assert.strictEqual(tally.defs.find((d) => d.id === 'baseball').label, '野球', 'Admin の label は日本語 schema');
  Object.keys(tally.counts).filter((id) => id !== 'baseball').forEach((id) => assert.strictEqual(tally.counts[id], 0, id));
  assert.deepStrictEqual(valid.map((r) => r.free_text.feedback).sort(), LOCALES.map((l) => `${l} free text`).sort(), '自由記述は原文のまま');
});
