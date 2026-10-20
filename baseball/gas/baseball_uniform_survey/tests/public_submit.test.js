'use strict';
// Public GAS（Issue #380）：受信 → 検証 → 保存 → 重複抑止 → 通知。実Google APIは呼ばない。
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { loadPublic, validPayload, plain, SALT, TEST_TOKEN, NOW } = require('./helpers/gas-env');
const schema = require('../survey.schema.json');

const submit = (ctx, payload, now = NOW) => plain(ctx.processSubmission_(typeof payload === 'string' ? payload : JSON.stringify(payload), now));
const rows = (env) => env.spreadsheet.getSheetByName('responses').rows;
const header = (env) => rows(env)[0];
const cell = (env, name, line = 1) => rows(env)[line][header(env).indexOf(name)];
const testExtra = (runId = 'run_a') => ({ test_token: TEST_TOKEN, test_run_id: runId });
const fieldsOf = (result) => (result.fields || []).map((f) => `${f.field}:${f.code}`);
const sha = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

// ── 保存列・正常系 ──

test('列は persistenceSchema.systemFields を唯一の正本とし、別名列（created_at 等）を増やさない', () => {
  const { env, ctx } = loadPublic();
  const head = header(env);
  assert.deepStrictEqual(head.slice(0, schema.persistenceSchema.systemFields.length), schema.persistenceSchema.systemFields);
  assert.deepStrictEqual(head.slice(schema.persistenceSchema.systemFields.length), [...schema.questions.map((q) => q.id), 'other_texts']);
  for (const alias of ['created_at', 'survey_id']) assert.ok(!head.includes(alias), alias);
  assert.ok(ctx.responseHeader_().length === head.length);
});

test('production の有効回答が保存され、system fields と stable ID が入る', () => {
  const { env, ctx } = loadPublic();
  const payload = validPayload(ctx, { favorite_uniforms: ['baseball', 'soccer'], top_uniform: 'soccer', overall_satisfaction: 'cannot_rate' }, {}, { source_channel: 'x' });
  assert.deepStrictEqual(submit(ctx, payload), { ok: true, status: 'accepted' });
  assert.strictEqual(rows(env).length, 2);
  assert.strictEqual(cell(env, 'favorite_uniforms'), '|baseball|soccer|');
  assert.strictEqual(cell(env, 'top_uniform'), 'soccer');
  assert.strictEqual(cell(env, 'overall_satisfaction'), 'cannot_rate');
  assert.strictEqual(cell(env, 'satisfaction_atmosphere'), '3');
  assert.strictEqual(cell(env, 'age_confirmed'), 'yes');
  assert.strictEqual(cell(env, 'survey_version'), '2026-10');
  assert.strictEqual(cell(env, 'schema_version'), '1');
  assert.strictEqual(cell(env, 'design_version'), '2.18');
  assert.strictEqual(cell(env, 'response_mode'), 'production');
  assert.strictEqual(cell(env, 'test_run_id'), '');
  assert.strictEqual(cell(env, 'completion_status'), 'complete');
  assert.strictEqual(cell(env, 'source_channel'), 'x');
  assert.strictEqual(cell(env, 'client_elapsed_ms'), 90000);
  assert.strictEqual(cell(env, 'other_texts'), '{}');
  assert.ok(cell(env, 'timestamp') instanceof Date);
  // 表示labelは保存されない
  assert.ok(!JSON.stringify(rows(env).slice(1)).includes('野球'));
});

test('「その他」自由記述は other_texts 列へ、保存値は validateAnswers の clean（正規化後）のみ', () => {
  const { env, ctx } = loadPublic();
  const payload = validPayload(ctx, { favorite_uniforms: ['baseball', 'other'], feedback: '  ありがとう\r\nございます  ' }, { favorite_uniforms: '  ラグビー\r\n  ' });
  assert.strictEqual(submit(ctx, payload).ok, true);
  assert.strictEqual(cell(env, 'favorite_uniforms'), '|baseball|other|');
  assert.deepStrictEqual(JSON.parse(cell(env, 'other_texts')), { favorite_uniforms: 'ラグビー' });
  assert.strictEqual(cell(env, 'feedback'), 'ありがとう\nございます');
});

// ── server validation：sanitizeせず最初に validateAnswers ──

test('受信 answers を sanitize せず、そのまま最初に validateAnswers へ渡す', () => {
  const { ctx } = loadPublic();
  const core = ctx.SurveyCore;
  const calls = [];
  const original = core.validateAnswers;
  core.validateAnswers = (...args) => { calls.push(plain(args)); return original(...args); };
  core.sanitizeAnswers = () => { throw new Error('server must not sanitize'); };
  const payload = validPayload(ctx, { club_awareness: 'first_time', attendance_count: 'once' });
  const result = submit(ctx, payload);
  assert.strictEqual(result.error, 'invalid_request');
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0][1], payload.answers, 'hidden な値を含む受信payloadがそのまま渡される');
});

const REJECTIONS = {
  'hidden（非表示設問の値）': () => ({ overrides: { club_awareness: 'first_time', catchball_interest: 'low_interest', attendance_count: 'once' }, code: 'attendance_count:hidden_field' }),
  'unknown（未知の設問ID）': () => ({ overrides: {}, answersExtra: { no_such_question: 'x' }, code: 'no_such_question:unknown_field' }),
  'stale（候補外になった single_dynamic の旧値）': () => ({ overrides: { favorite_uniforms: ['baseball'], top_uniform: 'soccer' }, code: 'top_uniform:invalid_option' }),
  'invalid option（allowlist外）': () => ({ overrides: { age: 'not_an_option' }, code: 'age:invalid_option' }),
  'required 欠落': () => ({ overrides: { age: undefined }, code: 'age:required' }),
  'multiple の exclusive 併用': () => ({ overrides: { favorite_uniforms: ['none', 'baseball'] }, code: 'favorite_uniforms:exclusive_conflict' }),
  'multiple の重複': () => ({ overrides: { favorite_uniforms: ['baseball', 'baseball'] }, code: 'favorite_uniforms:duplicate_option' }),
  'other 選択時の本文欠落': () => ({ overrides: { favorite_uniforms: ['other'], top_uniform: 'other' }, code: 'favorite_uniforms:other_text_required' }),
  'other 非選択時の本文（stale other_text）': () => ({ overrides: {}, otherTexts: { favorite_uniforms: 'ラグビー' }, code: 'favorite_uniforms:other_text_unexpected' }),
  'other 本文の長さ超過': () => ({ overrides: { favorite_uniforms: ['other'], top_uniform: 'other' }, otherTexts: { favorite_uniforms: 'あ'.repeat(101) }, code: 'favorite_uniforms:too_long' }),
  'text の maxLength 超過': () => ({ overrides: { feedback: 'あ'.repeat(501) }, code: 'feedback:too_long' }),
  'scale の範囲外': () => ({ overrides: { overall_satisfaction: '6' }, code: 'overall_satisfaction:invalid_option' }),
  'scale の notApplicable 以外の独自値': () => ({ overrides: { overall_satisfaction: 'n/a' }, code: 'overall_satisfaction:invalid_option' }),
  'single の型違い': () => ({ overrides: { age: ['18_24'] }, code: 'age:invalid_type' })
};
for (const [name, build] of Object.entries(REJECTIONS)) {
  test(`拒否（黙って除去しない・保存しない）: ${name}`, () => {
    const { env, ctx } = loadPublic();
    const spec = build();
    const payload = validPayload(ctx, spec.overrides, spec.otherTexts || {});
    Object.assign(payload.answers, spec.answersExtra || {});
    const result = submit(ctx, payload);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, 'invalid_request');
    assert.ok(fieldsOf(result).includes(spec.code), JSON.stringify(result));
    assert.strictEqual(rows(env).length, 1, '保存されない');
    assert.deepStrictEqual(env.mails, []);
  });
}

test('single_dynamic（source optionから導出した候補）と scale の notApplicable は受理される', () => {
  const { env, ctx } = loadPublic();
  const payload = validPayload(ctx, { favorite_uniforms: ['baseball', 'soccer'], top_uniform: 'baseball', satisfaction_activity: 'cannot_rate' });
  assert.strictEqual(submit(ctx, payload).ok, true);
  assert.strictEqual(cell(env, 'satisfaction_activity'), 'cannot_rate');
});

test('envelope：未知のkey・client申告の response_mode・schema_version不一致・不正body・サイズ超過を拒否', () => {
  const { env, ctx } = loadPublic();
  assert.ok(fieldsOf(submit(ctx, validPayload(ctx, {}, {}, { unexpected: 1 }))).includes('unexpected:unknown_field'));
  assert.ok(fieldsOf(submit(ctx, validPayload(ctx, {}, {}, { response_mode: 'test' }))).includes('response_mode:unknown_field'));
  assert.ok(fieldsOf(submit(ctx, validPayload(ctx, {}, {}, { uuid: 'not-a-uuid' }))).includes('uuid:invalid_uuid'));
  assert.strictEqual(submit(ctx, validPayload(ctx, {}, {}, { schema_version: '0' })).error, 'schema_mismatch');
  assert.strictEqual(submit(ctx, '').error, 'invalid_request');
  assert.strictEqual(submit(ctx, '{not json').reason, 'malformed_json');
  assert.strictEqual(submit(ctx, '[]').reason, 'not_an_object');
  assert.strictEqual(submit(ctx, JSON.stringify({ pad: 'x'.repeat(70000) })).reason, 'payload_too_large');
  assert.strictEqual(rows(env).length, 1);
});

// ── 18歳未満 ──

test('18歳未満（age_confirmed=no）は回答本文・hash・メタ情報を一切保存せず、通知もしない', () => {
  const { env, ctx } = loadPublic();
  const minimal = { schema_version: '1', uuid: crypto.randomUUID(), answers: { age_confirmed: 'no' }, other_texts: {}, elapsed_ms: 90000 };
  assert.deepStrictEqual(submit(ctx, minimal), { ok: true, status: 'ineligible' });
  // 本文つき・他の項目が不正でも同じ（本文は保存されない）
  const withBody = validPayload(ctx, { age_confirmed: 'no', feedback: '秘密の本文', age: 'bad' });
  assert.deepStrictEqual(submit(ctx, withBody), { ok: true, status: 'ineligible' });
  assert.deepStrictEqual(submit(ctx, validPayload(ctx, { age_confirmed: 'no' }, {}, { elapsed_ms: 1 })), { ok: true, status: 'ineligible' });
  assert.strictEqual(rows(env).length, 1, 'Sheetに行が増えない');
  assert.ok(!JSON.stringify(rows(env)).includes('秘密の本文'));
  assert.deepStrictEqual(env.mails, []);
  assert.ok(!env.logs.join('\n').includes('秘密の本文'));
  // 母数・件数に含まれない
  assert.strictEqual(ctx.countProductionResponses_(env.spreadsheet.getSheetByName('responses')), 0);
  // ineligible のあとに同じ端末で成年として回答しても重複扱いにならない（hashを登録していない）
  const adult = validPayload(ctx, {}, {}, { uuid: minimal.uuid });
  assert.strictEqual(submit(ctx, adult).ok, true);
  assert.strictEqual(ctx.countProductionResponses_(env.spreadsheet.getSheetByName('responses')), 1);
});

test('18歳未満は test mode でも保存しない', () => {
  const { env, ctx } = loadPublic();
  const result = submit(ctx, validPayload(ctx, { age_confirmed: 'no' }, {}, testExtra()));
  assert.deepStrictEqual(result, { ok: true, status: 'ineligible' });
  assert.strictEqual(rows(env).length, 1);
});

// ── respondent_hash ──

test('UUID生値は保存・ログ・応答に出ず、hashは canonical serialization の SHA-256', () => {
  const { env, ctx } = loadPublic();
  const payload = validPayload(ctx);
  const result = submit(ctx, payload);
  const expectedInput = JSON.stringify(['snb-respondent-hash', 1, 'nagoya_baseball_uniform_club_2026', 'production', '', payload.uuid.toLowerCase(), SALT]);
  assert.strictEqual(cell(env, 'respondent_hash'), sha(expectedInput));
  assert.strictEqual(ctx.canonicalHashInput_('production', '', payload.uuid, SALT), expectedInput);
  const everything = JSON.stringify(rows(env)) + env.logs.join('\n') + JSON.stringify(result);
  assert.ok(!everything.includes(payload.uuid));
  assert.ok(!everything.includes(SALT));
  assert.ok(!JSON.stringify(result).includes(cell(env, 'respondent_hash')));
  assert.ok(!env.logs.join('\n').includes(cell(env, 'respondent_hash')));
});

test('canonical hash入力は要素境界が曖昧にならない（無区切り連結ではない）', () => {
  const { ctx } = loadPublic();
  const uuid = '00000000-0000-4000-8000-000000000000';
  const inputs = [
    ctx.canonicalHashInput_('test', 'ab', uuid, 'c'),
    ctx.canonicalHashInput_('test', 'a', uuid, 'bc'),
    ctx.canonicalHashInput_('test', 'a|b', uuid, 's'),
    ctx.canonicalHashInput_('test', 'a', uuid, 'b|s'),
    ctx.canonicalHashInput_('test', 'a","b', uuid, 's'),
    ctx.canonicalHashInput_('test', 'a', uuid, 'b","s'),
    ctx.canonicalHashInput_('production', '', uuid, 's'),
    ctx.canonicalHashInput_('test', '', uuid, 's')
  ];
  assert.strictEqual(new Set(inputs).size, inputs.length);
  inputs.forEach((input) => assert.strictEqual(JSON.parse(input).length, 7, '常に7要素の配列として復元できる'));
  assert.strictEqual(ctx.canonicalHashInput_('production', 'ignored-or-empty'.slice(0, 0), uuid.toUpperCase(), 's'), ctx.canonicalHashInput_('production', '', uuid, 's'));
});

test('salt 未設定/短い場合は保存せず fail closed', () => {
  for (const salt of [undefined, 'short']) {
    const { env, ctx } = loadPublic();
    if (salt === undefined) env.props.delete('RESPONDENT_SALT'); else env.props.set('RESPONDENT_SALT', salt);
    assert.strictEqual(submit(ctx, validPayload(ctx)).error, 'server_error');
    assert.strictEqual(rows(env).length, 1);
  }
});

test('production の重複submitは拒否される（UUIDの大文字小文字は同一）', () => {
  const { env, ctx } = loadPublic();
  const payload = validPayload(ctx);
  assert.strictEqual(submit(ctx, payload).ok, true);
  assert.strictEqual(submit(ctx, payload).error, 'duplicate_submission');
  assert.strictEqual(submit(ctx, Object.assign({}, payload, { uuid: payload.uuid.toUpperCase() })).error, 'duplicate_submission');
  assert.strictEqual(rows(env).length, 2);
  assert.strictEqual(env.mails.length, 1, '重複では通知しない');
});

test('production と test の hash namespace は分離し、test は test_run_id ごとに分離する', () => {
  const { env, ctx } = loadPublic();
  const uuid = crypto.randomUUID();
  assert.strictEqual(submit(ctx, validPayload(ctx, {}, {}, { uuid })).ok, true);
  assert.strictEqual(submit(ctx, validPayload(ctx, {}, {}, Object.assign({ uuid }, testExtra('run_a')))).status, 'accepted_test');
  assert.strictEqual(submit(ctx, validPayload(ctx, {}, {}, Object.assign({ uuid }, testExtra('run_b')))).status, 'accepted_test');
  assert.strictEqual(rows(env).length, 4, '同じUUIDでも production / run_a / run_b は別回答');
  const hashes = [1, 2, 3].map((i) => cell(env, 'respondent_hash', i));
  assert.strictEqual(new Set(hashes).size, 3);
  assert.deepStrictEqual([1, 2, 3].map((i) => cell(env, 'test_run_id', i)), ['', 'run_a', 'run_b']);
  // 同一 test_run_id 内では production と同等の重複抑止
  assert.strictEqual(submit(ctx, validPayload(ctx, {}, {}, Object.assign({ uuid }, testExtra('run_a')))).error, 'duplicate_submission');
  assert.strictEqual(rows(env).length, 4);
  // test hash は test_run_id を入力に含む
  assert.strictEqual(cell(env, 'respondent_hash', 2), sha(ctx.canonicalHashInput_('test', 'run_a', uuid, SALT)));
});

// ── 同時実行 ──

test('保存は LockService 内で行い、例外でも必ず解放する', () => {
  const { env, ctx } = loadPublic();
  assert.strictEqual(submit(ctx, validPayload(ctx)).ok, true);
  assert.deepStrictEqual(env.lockEvents, ['acquire', 'release']);
  env.lockEvents.length = 0;
  env.spreadsheet.getSheetByName('responses').hooks.onWrite = () => { throw new Error('write failed'); };
  assert.strictEqual(submit(ctx, validPayload(ctx)).error, 'server_error');
  assert.deepStrictEqual(env.lockEvents, ['acquire', 'release']);
  assert.strictEqual(env.lockHeld, false);
});

test('同時submit：ロック競合した側は保存されず、同じUUIDが2行にならない', () => {
  const { env, ctx } = loadPublic();
  const payload = validPayload(ctx);
  let nested;
  env.spreadsheet.getSheetByName('responses').hooks.onWrite = (_range, _values) => {
    env.spreadsheet.getSheetByName('responses').hooks.onWrite = null;
    nested = submit(ctx, payload); // 書き込み中（ロック保持中）に同じ回答が届く
  };
  assert.deepStrictEqual(submit(ctx, payload), { ok: true, status: 'accepted' });
  assert.strictEqual(nested.error, 'server_error', 'ロックを取れない側は保存せず再試行を促す');
  assert.strictEqual(rows(env).length, 2);
  assert.strictEqual(submit(ctx, payload).error, 'duplicate_submission');
});

test('ロックを取得できない場合は保存せず server_error', () => {
  const { env, ctx } = loadPublic();
  env.lockHeld = true;
  assert.strictEqual(submit(ctx, validPayload(ctx)).error, 'server_error');
  assert.strictEqual(rows(env).length, 1);
});

// ── source_channel ──

test('source_channel は allowlist のみ保存し、それ以外は unknown（受信値は保存しない）', () => {
  const { env, ctx } = loadPublic();
  const allowed = schema.persistenceSchema.sourceChannel.allowlist;
  assert.deepStrictEqual(allowed, ['x', 'line', 'website', 'instagram', 'email', 'direct', 'unknown']);
  allowed.forEach((channel, i) => {
    submit(ctx, validPayload(ctx, {}, {}, { source_channel: channel }));
    assert.strictEqual(cell(env, 'source_channel', i + 1), channel);
  });
  const personal = ['campaign-taro123', 'X', '', 42, null, ['x']];
  personal.forEach((value, i) => {
    const line = allowed.length + i + 1;
    submit(ctx, validPayload(ctx, {}, {}, { source_channel: value }));
    assert.strictEqual(cell(env, 'source_channel', line), 'unknown');
  });
  submit(ctx, validPayload(ctx));
  assert.strictEqual(cell(env, 'source_channel', rows(env).length - 1), 'unknown');
  assert.ok(!JSON.stringify(rows(env)).includes('taro123'));
});

// ── 最短回答時間 ──

test('最短回答時間は production のみ server で検証し、閾値は config の明示設定から読む', () => {
  const { env, ctx } = loadPublic();
  const min = ctx.SURVEY_CONFIG.validation.minElapsedMs;
  assert.strictEqual(typeof min, 'number');
  assert.ok(min > 0);
  assert.ok(fieldsOf(submit(ctx, validPayload(ctx, {}, {}, { elapsed_ms: min - 1 }))).includes('elapsed_ms:too_fast'));
  assert.strictEqual(rows(env).length, 1);
  assert.strictEqual(submit(ctx, validPayload(ctx, {}, {}, { elapsed_ms: min })).ok, true);
  // configを変えると閾値が変わる（コードにmagic numberがない）
  ctx.SURVEY_CONFIG.validation.minElapsedMs = 120000;
  assert.ok(fieldsOf(submit(ctx, validPayload(ctx, {}, {}, { elapsed_ms: 90000 }))).includes('elapsed_ms:too_fast'));
  // 欠損・型違い・負数・上限超過
  for (const value of [undefined, 'fast', -1, NaN, Infinity, ctx.SURVEY_CONFIG.validation.maxElapsedMs + 1]) {
    const payload = validPayload(ctx);
    if (value === undefined) delete payload.elapsed_ms; else payload.elapsed_ms = value;
    assert.ok(fieldsOf(submit(ctx, JSON.stringify(payload))).includes('elapsed_ms:invalid_type'), String(value));
  }
  // test（submit_excluded）は最短回答時間を免除
  assert.strictEqual(submit(ctx, validPayload(ctx, {}, {}, Object.assign({ elapsed_ms: 1 }, testExtra()))).status, 'accepted_test');
});

// ── 受付期間 ──

test('opens_at 前・closes_at 後の production submit は拒否（両端は受付中）', () => {
  const { env, ctx } = loadPublic();
  const at = (iso) => new Date(iso);
  assert.strictEqual(submit(ctx, validPayload(ctx), at('2026-10-31T23:59:59+09:00')).error, 'survey_not_open');
  assert.strictEqual(submit(ctx, validPayload(ctx), at('2026-11-01T00:00:00+09:00')).ok, true);
  assert.strictEqual(submit(ctx, validPayload(ctx), at('2026-11-30T23:59:59+09:00')).ok, true);
  assert.strictEqual(submit(ctx, validPayload(ctx), at('2026-11-30T23:59:59.001+09:00')).error, 'survey_closed');
  assert.strictEqual(rows(env).length, 3);
});

test('受付期間は survey config が正本：未設定・不正・保持期限未確定の production launch は fail closed', () => {
  assert.strictEqual(require('../survey.config.json').reception.opens_at, null, '本番開始前は未設定のまま');
  assert.strictEqual(require('../survey.config.json').reception.closes_at, null);
  assert.strictEqual(require('../survey.config.json').reception.timezone, 'Asia/Tokyo');
  // コミット済みの config / schema そのまま（未確定）では受け付けない
  const fresh = loadPublic({ launched: false });
  assert.strictEqual(fresh.ctx.receptionState_(NOW), 'not_configured');
  assert.strictEqual(submit(fresh.ctx, validPayload(fresh.ctx)).error, 'survey_not_configured');
  assert.strictEqual(rows(fresh.env).length, 1);

  const bad = {
    'opens_at のみ未設定': (r) => { r.opens_at = null; },
    'closes_at のみ未設定': (r) => { r.closes_at = null; },
    'offset が +09:00 以外': (r) => { r.closes_at = '2026-11-30T23:59:59Z'; },
    '秒なし': (r) => { r.opens_at = '2026-11-01T00:00+09:00'; },
    '存在しない日付': (r) => { r.closes_at = '2026-02-30T00:00:00+09:00'; },
    'opens_at >= closes_at': (r) => { r.opens_at = r.closes_at; },
    'timezone 違い': (r) => { r.timezone = 'UTC'; }
  };
  for (const [name, mutate] of Object.entries(bad)) {
    const { env, ctx } = loadPublic();
    mutate(ctx.SURVEY_CONFIG.reception);
    assert.strictEqual(ctx.receptionState_(NOW), 'not_configured', name);
    assert.strictEqual(submit(ctx, validPayload(ctx)).error, 'survey_not_configured', name);
    assert.strictEqual(rows(env).length, 1, name);
  }
  // 保持期限が未確定（schema の launch blocker）なら受付期間があっても受け付けない
  const retention = loadPublic();
  retention.ctx.SURVEY_SCHEMA.respondentNotice.retention.status = 'must_set_before_launch';
  assert.strictEqual(submit(retention.ctx, validPayload(retention.ctx)).error, 'survey_not_configured');
});

test('受付期間を Script Properties から読まない（survey config が正本）', () => {
  const { env, ctx } = loadPublic();
  env.props.set('SURVEY_CLOSES_AT', '2099-01-01T00:00:00+09:00');
  env.props.set('SURVEY_OPENS_AT', '2000-01-01T00:00:00+09:00');
  assert.strictEqual(submit(ctx, validPayload(ctx), new Date('2026-12-01T00:00:00+09:00')).error, 'survey_closed');
});

test('GET status は受付状態とversionだけを返す', () => {
  const { ctx } = loadPublic();
  const get = (params, now) => JSON.parse(ctx.doGet({ parameter: params }).getContent()).status;
  assert.strictEqual(plain(ctx.processStatus_(NOW)).status, 'open');
  assert.strictEqual(plain(ctx.processStatus_(new Date('2026-10-01T00:00:00+09:00'))).status, 'not_open');
  assert.strictEqual(plain(ctx.processStatus_(new Date('2026-12-01T00:00:00+09:00'))).status, 'closed');
  assert.deepStrictEqual(Object.keys(plain(ctx.processStatus_(NOW))).sort(), ['design_version', 'ok', 'schema_version', 'status', 'survey_version']);
  assert.strictEqual(typeof get({ action: 'status' }), 'string');
  const fresh = loadPublic({ launched: false });
  assert.strictEqual(plain(fresh.ctx.processStatus_(NOW)).status, 'not_configured');
});

// ── test mode / test token ──

test('submit_excluded：token検証後に response_mode=test として保存し、通知しない', () => {
  const { env, ctx } = loadPublic();
  const result = submit(ctx, validPayload(ctx, {}, {}, testExtra('run_2026_a')));
  assert.deepStrictEqual(result, { ok: true, status: 'accepted_test', test: true });
  assert.strictEqual(cell(env, 'response_mode'), 'test');
  assert.strictEqual(cell(env, 'test_run_id'), 'run_2026_a');
  assert.strictEqual(cell(env, 'notification_status'), 'not_applicable');
  assert.deepStrictEqual(env.mails, []);
  assert.ok(!env.logs.join('\n').includes(TEST_TOKEN));
  assert.ok(!JSON.stringify(rows(env)).includes(TEST_TOKEN));
});

test('test token 不正・未設定・短い場合は拒否し、productionとして保存しない', () => {
  const { env, ctx } = loadPublic();
  const bad = (extra) => submit(ctx, validPayload(ctx, {}, {}, extra));
  assert.ok(fieldsOf(bad({ test_token: 'wrong', test_run_id: 'run_a' })).includes('test_token:invalid_token'));
  assert.ok(fieldsOf(bad({ test_token: '', test_run_id: 'run_a' })).includes('test_token:invalid_token'));
  assert.ok(fieldsOf(bad({ test_token: 123, test_run_id: 'run_a' })).includes('test_token:invalid_token'));
  assert.ok(fieldsOf(bad({ test_token: null, test_run_id: 'run_a' })).includes('test_token:invalid_token'));
  env.props.delete('TEST_TOKEN');
  assert.ok(fieldsOf(bad({ test_token: '', test_run_id: 'run_a' })).includes('test_token:invalid_token'));
  env.props.set('TEST_TOKEN', 'short');
  assert.ok(fieldsOf(bad({ test_token: 'short', test_run_id: 'run_a' })).includes('test_token:invalid_token'));
  assert.strictEqual(rows(env).length, 1);
});

test('test_run_id は必須・形式制限あり、token無しの test_run_id は拒否', () => {
  const { env, ctx } = loadPublic();
  const send = (extra) => submit(ctx, validPayload(ctx, {}, {}, extra));
  assert.ok(fieldsOf(send({ test_token: TEST_TOKEN })).includes('test_run_id:invalid_test_run_id'));
  for (const id of ['', ' a', 'a b', '日本語', 'a'.repeat(41), '-a', 1]) {
    assert.ok(fieldsOf(send({ test_token: TEST_TOKEN, test_run_id: id })).includes('test_run_id:invalid_test_run_id'), String(id));
  }
  assert.ok(fieldsOf(send({ test_run_id: 'run_a' })).includes('test_run_id:unexpected'));
  assert.strictEqual(rows(env).length, 1);
});

test('test mode は受付期間の前後でも送信確認でき、production count / 通知から除外される', () => {
  const { env, ctx } = loadPublic();
  const before = new Date('2026-10-01T00:00:00+09:00');
  assert.strictEqual(submit(ctx, validPayload(ctx, {}, {}, testExtra('r1')), before).status, 'accepted_test');
  assert.strictEqual(submit(ctx, validPayload(ctx, {}, {}, testExtra('r2')), new Date('2027-01-01T00:00:00+09:00')).status, 'accepted_test');
  const sheet = env.spreadsheet.getSheetByName('responses');
  assert.strictEqual(ctx.countProductionResponses_(sheet), 0);
  assert.strictEqual(submit(ctx, validPayload(ctx)).ok, true);
  assert.strictEqual(ctx.countProductionResponses_(sheet), 1);
  assert.match(env.mails[0].body, /累計）：1件/, 'testは通知の累計に入らない');
  // 未確定（fail closed）の launch でも test 送信自体は production を開かない
  const fresh = loadPublic({ launched: false });
  assert.strictEqual(submit(fresh.ctx, validPayload(fresh.ctx, {}, {}, testExtra())).status, 'accepted_test');
  assert.strictEqual(submit(fresh.ctx, validPayload(fresh.ctx)).error, 'survey_not_configured');
});

// ── submit_excluded は production の受付状態（not_configured / not_open / closed）に依存しない（#390 実Google E2E） ──

const RECEPTION_STATES = {
  not_configured: { launched: false, now: NOW },
  not_open: { launched: true, now: new Date('2026-10-31T23:59:59+09:00') },
  closed: { launched: true, now: new Date('2026-11-30T23:59:59.001+09:00') }
};

for (const [state, spec] of Object.entries(RECEPTION_STATES)) {
  test(`受付 ${state}：有効な submit_excluded は保存され、同条件の production は拒否される`, () => {
    const { env, ctx } = loadPublic({ launched: spec.launched });
    assert.strictEqual(ctx.receptionState_(spec.now), state);
    const result = submit(ctx, validPayload(ctx, {}, {}, Object.assign({ elapsed_ms: 1 }, testExtra('run_e2e'))), spec.now);
    assert.deepStrictEqual(result, { ok: true, status: 'accepted_test', test: true });
    assert.strictEqual(rows(env).length, 2);
    assert.strictEqual(cell(env, 'response_mode'), 'test');
    assert.strictEqual(cell(env, 'test_run_id'), 'run_e2e');
    assert.strictEqual(ctx.countProductionResponses_(env.spreadsheet.getSheetByName('responses')), 0);
    assert.strictEqual(env.mails.length, 0, 'test は通知しない');
    // production は従来どおり受付判定が必須（fail closed）
    const production = submit(ctx, validPayload(ctx), spec.now);
    assert.strictEqual(production.error, { not_configured: 'survey_not_configured', not_open: 'survey_not_open', closed: 'survey_closed' }[state]);
    assert.strictEqual(rows(env).length, 2, 'production は保存されない');
  });
}

test('受付が未確定でも、test token が不正・未設定・24文字未満なら test 送信は拒否される（fail closed）', () => {
  const { env, ctx } = loadPublic({ launched: false });
  const send = (extra) => submit(ctx, validPayload(ctx, {}, {}, extra));
  assert.ok(fieldsOf(send({ test_token: 'wrong-token-0123456789abcdef-0123', test_run_id: 'r1' })).includes('test_token:invalid_token'));
  assert.ok(fieldsOf(send({ test_token: '', test_run_id: 'r1' })).includes('test_token:invalid_token'));
  env.props.delete('TEST_TOKEN');
  assert.ok(fieldsOf(send({ test_token: TEST_TOKEN, test_run_id: 'r1' })).includes('test_token:invalid_token'), 'TEST_TOKEN 未設定');
  const shortToken = 'a'.repeat(23);
  env.props.set('TEST_TOKEN', shortToken);
  assert.ok(fieldsOf(send({ test_token: shortToken, test_run_id: 'r1' })).includes('test_token:invalid_token'), '24文字未満');
  assert.strictEqual(rows(env).length, 1, '何も保存されない');
});

// ── 通知 ──

test('通知：production の有効回答のみ、安全な運営情報だけを text/plain で送る', () => {
  const { env, ctx } = loadPublic();
  const payload = validPayload(ctx, { feedback: '個人的な自由記述', support_message: '応援しています', favorite_uniforms: ['other'], top_uniform: 'other' }, { favorite_uniforms: 'ひみつの競技' });
  assert.strictEqual(submit(ctx, payload).ok, true);
  assert.strictEqual(env.mails.length, 1);
  const mail = env.mails[0];
  assert.strictEqual(mail.to, 'owner@example.com');
  assert.strictEqual(mail.subject, ctx.SURVEY_CONFIG.notification.subject);
  assert.strictEqual(mail.htmlBody, undefined);
  assert.match(mail.body, /新規の有効回答が1件/);
  assert.match(mail.body, /累計）：1件/);
  for (const secret of ['個人的な自由記述', '応援しています', 'ひみつの競技', payload.uuid, cell(env, 'respondent_hash'), SALT, TEST_TOKEN]) {
    assert.ok(!mail.body.includes(secret) && !mail.subject.includes(secret), secret);
  }
  assert.strictEqual(cell(env, 'notification_status'), 'sent');
});

test('通知の失敗（送信エラー・宛先未設定）は回答保存を失敗扱いにしない', () => {
  for (const mutate of [(env) => { env.failMail = true; }, (env) => { env.props.delete('NOTIFICATION_EMAIL'); }, (env) => { env.props.set('NOTIFICATION_EMAIL', 'not-an-email'); }]) {
    const { env, ctx } = loadPublic();
    mutate(env);
    assert.deepStrictEqual(submit(ctx, validPayload(ctx)), { ok: true, status: 'accepted' });
    assert.strictEqual(rows(env).length, 2, '回答は保存済み');
    assert.strictEqual(cell(env, 'notification_status'), 'failed');
    assert.ok(!env.logs.join('\n').includes('owner@example.com'));
  }
});

test('notification.enabled=false は明示的に無効：メールを送らず notification_status=disabled', () => {
  const { env, ctx } = loadPublic();
  ctx.SURVEY_CONFIG.notification.enabled = false;
  assert.strictEqual(submit(ctx, validPayload(ctx)).ok, true);
  assert.deepStrictEqual(env.mails, []);
  assert.strictEqual(cell(env, 'notification_status'), 'disabled');
  assert.strictEqual(typeof require('../survey.config.json').notification.enabled, 'boolean', '暗黙の未実装にしない');
});

test('通知しないケース：test・18歳未満・検証失敗・重複・受付期間外', () => {
  const { env, ctx } = loadPublic();
  submit(ctx, validPayload(ctx, {}, {}, testExtra()));
  submit(ctx, validPayload(ctx, { age_confirmed: 'no' }));
  submit(ctx, validPayload(ctx, { age: 'bad' }));
  submit(ctx, validPayload(ctx), new Date('2027-01-01T00:00:00+09:00'));
  const dup = validPayload(ctx);
  submit(ctx, dup);
  assert.strictEqual(env.mails.length, 1);
  submit(ctx, dup);
  assert.strictEqual(env.mails.length, 1);
});

// ── Formula Injection ──

test('Formula Injection：先頭が = + - @ 制御文字の文字列は先頭に \' を付けて保存', () => {
  const { env, ctx } = loadPublic();
  const evil = ['=HYPERLINK("http://evil","x")', '+cmd|calc', '-1+1', '@SUM(A1)', '\tTAB'];
  evil.forEach((text, i) => {
    const payload = validPayload(ctx, { feedback: text, support_message: text }, {});
    // normalizeText が前後空白を除くため、TAB始まりは除去後の内容で確認する
    assert.strictEqual(submit(ctx, payload).ok, true);
    const stored = cell(env, 'feedback', i + 1);
    assert.ok(!/^[=+\-@\t\r]/.test(stored), `${text} → ${stored}`);
  });
  assert.strictEqual(cell(env, 'feedback', 1), `'=HYPERLINK("http://evil","x")`);
  assert.strictEqual(cell(env, 'support_message', 3), "'-1+1");
  assert.strictEqual(ctx.sanitizeCell_('plain'), 'plain');
  assert.strictEqual(ctx.sanitizeCell_("'=x"), "'=x");
  assert.strictEqual(ctx.sanitizeCell_('\r=1'), "'\r=1");
  assert.strictEqual(ctx.sanitizeCell_(5), 5);
  // other_texts はJSON文字列（先頭が { ）
  const withOther = validPayload(ctx, { favorite_uniforms: ['other'], top_uniform: 'other' }, { favorite_uniforms: '=1+1' });
  submit(ctx, withOther);
  assert.ok(cell(env, 'other_texts', rows(env).length - 1).startsWith('{'));
});

// ── Spreadsheet / setup ──

test('新規Spreadsheet前提：ヘッダーがschemaと一致しない既存シートには書かない', () => {
  const { env, ctx } = loadPublic({ setup: false });
  const foreign = env.spreadsheet.insertSheet('responses');
  foreign.getRange(1, 1, 1, 4).setValues([['timestamp', 'survey_version', 'respondent_hash', 'completion_status']]);
  assert.strictEqual(submit(ctx, validPayload(ctx)).error, 'server_error');
  assert.strictEqual(foreign.rows.length, 1, '既存シートへ追記しない');
  assert.throws(() => ctx.setupSpreadsheet(), /ヘッダーがschemaと一致しません/);
  // シートが無い場合も書かない
  const empty = loadPublic({ setup: false });
  assert.strictEqual(submit(empty.ctx, validPayload(empty.ctx)).error, 'server_error');
  assert.strictEqual(empty.env.spreadsheet.getSheetByName('responses'), null);
});

test('setupSpreadsheet は冪等で、hash / 選択肢列を文字列書式にする。setupScriptProperties は saltを上書きしない', () => {
  const { env, ctx } = loadPublic({ setup: false });
  assert.strictEqual(ctx.setupSpreadsheet(), 'ok');
  const sheet = env.spreadsheet.getSheetByName('responses');
  const head = sheet.rows[0];
  assert.strictEqual(sheet.formats[head.indexOf('respondent_hash') + 1], '@');
  assert.strictEqual(sheet.formats[head.indexOf('overall_satisfaction') + 1], '@');
  assert.strictEqual(sheet.formats[head.indexOf('feedback') + 1], undefined, '自由記述は書式を変えない（\' プレフィックスが効く）');
  assert.strictEqual(ctx.setupSpreadsheet(), 'ok');
  assert.strictEqual(sheet.rows.length, 1);
  assert.match(ctx.setupScriptProperties(), /設定済み/);
  assert.strictEqual(env.props.get('RESPONDENT_SALT'), SALT);
  env.props.delete('RESPONDENT_SALT');
  ctx.setupScriptProperties();
  assert.ok(env.props.get('RESPONDENT_SALT').length >= 32);
});

test('ログに回答本文・UUID・hash・token・メールアドレスが出ない', () => {
  const { env, ctx } = loadPublic();
  const payload = validPayload(ctx, { feedback: '秘密の自由記述' });
  submit(ctx, payload);
  submit(ctx, payload);
  submit(ctx, validPayload(ctx, { age: 'bad', feedback: '秘密の自由記述2' }));
  submit(ctx, validPayload(ctx, {}, {}, { test_token: 'wrong-token-value', test_run_id: 'run_a' }));
  const logs = env.logs.join('\n');
  for (const secret of ['秘密の自由記述', payload.uuid, cell(env, 'respondent_hash'), TEST_TOKEN, 'wrong-token-value', 'owner@example.com', SALT]) {
    assert.ok(!logs.includes(secret), secret);
  }
});

test('doPost / doGet はJSONを返し、例外は server_error に丸める', () => {
  const { ctx } = loadPublic();
  const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: body } }).getContent());
  assert.deepStrictEqual(post(JSON.stringify(validPayload(ctx))).ok, false, '実時刻は受付期間外のため拒否');
  assert.strictEqual(post('{bad').error, 'invalid_request');
  assert.strictEqual(JSON.parse(ctx.doPost(undefined).getContent()).error, 'invalid_request');
  assert.strictEqual(JSON.parse(ctx.doGet({ parameter: {} }).getContent()).service, 'baseball-uniform-survey');
  assert.strictEqual(JSON.parse(ctx.doGet({ parameter: { action: 'results' } }).getContent()).status, undefined, '公開結果はこのGASの責務ではない');
});
