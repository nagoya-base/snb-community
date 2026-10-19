'use strict';
// 独立した read-only Admin GAS（Issue #382）。実Google・本番Spreadsheetへは接続しない。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createAdminEnv, ROOT } = require('./helpers/admin-env');
const { schema, core, aggregate, rowFor, rowsFrom, answersFor, header, NOW } = require('./helpers/fixtures');
const { renderAdmin, ADMIN_TARGET } = require('../tools/build-public-gas');

const plain = (x) => JSON.parse(JSON.stringify(x));
const INTERESTED = { club_awareness: 'aware_not_attended', catchball_interest: 'very_interested' };
const ATTENDEE = { club_awareness: 'attended', last_attended: 'within_3m' };
const adminDir = path.join(ROOT, 'admin');
const sources = () => fs.readdirSync(adminDir).filter((f) => f.endsWith('.gs') && f !== 'SurveyGenerated.gs').map((f) => ({ name: f, code: fs.readFileSync(path.join(adminDir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '') }));

const fixtureRows = () => rowsFrom([
  { count: 32, overrides: Object.assign({ feedback: 'ADMIN-ONLY-TEXT' }, INTERESTED) },
  { count: 21, overrides: ATTENDEE },
  { count: 4, meta: { response_mode: 'test', test_run_id: 'run' } }
]);

test('生成物 admin/SurveyGenerated.gs は schema + 専用 core + aggregate から再生成した内容と一致する（generated drift）', () => {
  assert.equal(fs.readFileSync(ADMIN_TARGET, 'utf8'), renderAdmin());
  assert.match(fs.readFileSync(ADMIN_TARGET, 'utf8'), /DO NOT EDIT/);
  const env = createAdminEnv([]);
  assert.deepEqual(plain(env.ctx.SURVEY_SCHEMA), schema);
  assert.deepEqual(Object.keys(env.ctx.SurveyCore).sort(), Object.keys(core).sort());
  assert.deepEqual(Object.keys(env.ctx.SurveyAggregate).sort(), Object.keys(aggregate).sort());
  // 受付設定・通知設定・salt/token は Admin に持ち込まない。
  assert.equal(env.ctx.SURVEY_CONFIG, undefined);
  assert.ok(!/RESPONDENT_SALT|TEST_TOKEN|NOTIFICATION_EMAIL/.test(fs.readFileSync(ADMIN_TARGET, 'utf8')));
});

test('manifest：OAuth scope は spreadsheets.readonly のみ、Web App は本人のみ（executeAs USER_DEPLOYING / access MYSELF）', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(adminDir, 'appsscript.json'), 'utf8'));
  assert.deepEqual(manifest.oauthScopes, ['https://www.googleapis.com/auth/spreadsheets.readonly']);
  assert.deepEqual(manifest.webapp, { executeAs: 'USER_DEPLOYING', access: 'MYSELF' });
});

test('read-only：Spreadsheet への書き込み・削除 API を呼ばない（コードにも存在しない）', () => {
  const env = createAdminEnv(fixtureRows());
  env.ctx.getAdminSummary();
  env.ctx.getSnapshot();
  env.ctx.getFreeText();
  assert.deepEqual(env.writes, []);
  assert.ok(env.reads > 0);
  for (const { name, code } of sources()) {
    assert.ok(!/\.(setValues?|appendRow|clearContent|clear|deleteRows?|deleteCells?|insertRow\w*|insertSheet|setFormula|setNumberFormat|getRange\([^)]*\)\.set)\b/.test(code), `${name}: 書き込み API`);
    assert.ok(!/(SpreadsheetApp\.create|\.copyTo|DriveApp|MailApp|UrlFetchApp|LockService)/.test(code), `${name}: 不要な外部 API`);
  }
  // 書き込み先は Admin 自身の Script Property（公開済み snapshot の記録）だけ。
  const setProps = sources().filter(({ code }) => /setProperty/.test(code)).map(({ name }) => name);
  assert.deepEqual(setProps, ['Snapshot.gs']);
});

test('回答の編集・削除・手動書き換えの UI / endpoint を持たない', () => {
  const html = fs.readFileSync(path.join(adminDir, 'Dashboard.html'), 'utf8');
  assert.ok(!/(deleteResponse|editResponse|updateResponse|setResponse|doPost)/.test(html + sources().map((s) => s.code).join('')));
  const env = createAdminEnv([]);
  assert.equal(typeof env.ctx.doPost, 'undefined');
  const globals = ['doGet', 'getAdminSummary', 'getSnapshot', 'confirmSnapshotPublished', 'getFreeText'];
  globals.forEach((name) => assert.equal(typeof env.ctx[name], 'function', name));
  assert.equal(env.ctx.doGet().name, 'Dashboard');
});

test('production 有効回答だけを標準集計し、test 回答は除外件数に出る', () => {
  const env = createAdminEnv(fixtureRows());
  const summary = plain(env.ctx.getAdminSummary());
  assert.equal(summary.production_valid_total, 53);
  assert.equal(summary.test_excluded, 4);
  assert.equal(summary.rows, 57);
  const q = Object.fromEntries(summary.questions.map((x) => [x.id, x]));
  assert.equal(q.barriers.targetCount, 32);
  assert.equal(q.overall_satisfaction.targetCount, 21);
  assert.equal(q.overall_satisfaction.publicState, 'published'); // targetCount 21 ≥ 20 かつ total 53 ≥ 30
});

test('publication 条件の達成/未達と public preview が Admin から確認できる', () => {
  const rows = rowsFrom([{ count: 32, overrides: INTERESTED }, { count: 19, overrides: ATTENDEE }]);
  const env = createAdminEnv(rows);
  const summary = plain(env.ctx.getAdminSummary());
  const q = Object.fromEntries(summary.questions.map((x) => [x.id, x]));
  assert.deepEqual([q.repeat_intent.targetCount, q.repeat_intent.targetMet, q.repeat_intent.totalMet], [19, false, true]);
  assert.equal(q.repeat_intent.publicState, 'sensitive_withheld');
  assert.deepEqual(q.repeat_intent.thresholds, { minTotal: 30, minTarget: 20, minCell: 3 });
  assert.equal(q.barriers.publicState, 'published');
  assert.equal(summary.publicPreview.questions.find((x) => x.id === 'repeat_intent').targetCount, null);
  assert.deepEqual(aggregate.validateSnapshot(schema, summary.publicPreview), []);
});

test('snapshot 生成：privacy-safe で検証済み。自由記述・hash を含まず、更新判定を返す', () => {
  const rows = fixtureRows();
  const env = createAdminEnv(rows);
  const result = plain(env.ctx.getSnapshot());
  assert.deepEqual(aggregate.validateSnapshot(schema, result.snapshot), []);
  assert.equal(JSON.parse(result.snapshotJson).generated_at, result.snapshot.generated_at);
  assert.equal(result.exactTotal, 53);
  assert.equal(result.decision.update, true);
  assert.equal(result.decision.reason, 'initial');
  assert.ok(!result.snapshotJson.includes('ADMIN-ONLY-TEXT'));
  rows.forEach((r) => assert.ok(!result.snapshotJson.includes(r.respondent_hash)));
  assert.equal(result.snapshot.production_valid_total, 50);
  assert.deepEqual(env.writes, []);
});

test('公開済み snapshot の記録後は、増分が足りない間は更新不要（submit ごとに更新しない）', () => {
  const env = createAdminEnv(fixtureRows());
  const first = plain(env.ctx.getSnapshot());
  env.ctx.confirmSnapshotPublished(first.snapshot.generated_at, first.exactTotal);
  const state = JSON.parse(env.props.get('SNAPSHOT_STATE'));
  assert.deepEqual(Object.keys(state).sort(), ['generated_at', 'production_valid_total']);
  const again = plain(env.ctx.getSnapshot());
  assert.equal(again.decision.update, false);
  assert.equal(again.decision.reason, 'insufficient_increment');
  assert.throws(() => env.ctx.confirmSnapshotPublished('not a date', 3), /invalid_request/);
  assert.throws(() => env.ctx.confirmSnapshotPublished(first.snapshot.generated_at, -1), /invalid_request/);
});

test('自由記述は Admin のみ・別操作：snapshot 生成コードは自由記述を呼ばない', () => {
  const env = createAdminEnv(fixtureRows());
  const items = plain(env.ctx.getFreeText());
  assert.equal(items.filter((i) => i.text === 'ADMIN-ONLY-TEXT').length, 32);
  items.forEach((item) => assert.deepEqual(Object.keys(item).sort().filter((k) => k !== 'kind'), ['label', 'questionId', 'text']));
  const snapshotCode = sources().find((s) => s.name === 'Snapshot.gs').code;
  assert.ok(!/listFreeText|getFreeText|free_text|other_texts|respondent_hash/.test(snapshotCode));
  const body = aggregate.buildSnapshot.toString();
  assert.ok(!/free_text|other_texts|respondent_hash/.test(body), 'buildSnapshot は自由記述・hash を参照しない');
  const dashboard = fs.readFileSync(path.join(adminDir, 'Dashboard.html'), 'utf8');
  assert.ok(!/respondent_hash|innerHTML/.test(dashboard));
});

test('ヘッダーが schema と一致しない Sheet・未設定は読まない（別 survey の Sheet を集計しない）', () => {
  const bad = createAdminEnv(fixtureRows(), { header: header().slice().reverse() });
  assert.throws(() => bad.ctx.getAdminSummary(), /header_mismatch/);
  const none = createAdminEnv([]);
  none.props.delete('RESPONSES_SPREADSHEET_ID');
  assert.throws(() => none.ctx.getAdminSummary(), /not_configured/);
  const empty = createAdminEnv([]);
  assert.equal(plain(empty.ctx.getAdminSummary()).production_valid_total, 0);
});

test('設問 ID・option ID・分岐・閾値を Admin にベタ書きしない', () => {
  const ids = new Set();
  schema.questions.forEach((q) => { ids.add(q.id); (q.options || []).forEach((o) => ids.add(o.id)); });
  const longIds = [...ids].filter((id) => id.length >= 8);
  const files = sources().concat([{ name: 'src/survey-aggregate.js', code: fs.readFileSync(path.join(ROOT, 'src', 'survey-aggregate.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '') }]);
  for (const { name, code } of files) {
    for (const id of longIds) assert.ok(!code.includes(`'${id}'`) && !code.includes(`"${id}"`), `${name} に設問/option ID '${id}' がベタ書きされている`);
    assert.ok(!/minTotal\s*[:=]\s*\d|minCell\s*[:=]\s*\d|minTarget\s*[:=]\s*\d/.test(code), `${name}: 閾値を持たない`);
  }
  // 唯一の閾値の下限（sensitive branch）だけは名前付き定数で持つ。
  assert.equal(aggregate.SENSITIVE_BRANCH_MIN_TARGET, 20);
});

test('Admin の画面・コードから respondent_hash を返さない（Admin summary / snapshot / freeText）', () => {
  const rows = fixtureRows();
  const env = createAdminEnv(rows);
  const outputs = [JSON.stringify(env.ctx.getAdminSummary()), JSON.stringify(env.ctx.getSnapshot()), JSON.stringify(env.ctx.getFreeText())].join('\n');
  rows.forEach((r) => assert.ok(!outputs.includes(r.respondent_hash)));
  assert.ok(!/(console|Logger)\.(log|error)\([^)]*(answers|row|hash)/i.test(sources().map((s) => s.code).join('\n')));
});

test('CI：既存の baseball survey workflow が #382 の paths と Admin / snapshot / 結果ページのテストを実行し、Admin は deploy 対象にしない', () => {
  const repo = path.join(ROOT, '..', '..', '..');
  const publicWorkflow = fs.readFileSync(path.join(repo, '.github/workflows/baseball-uniform-survey-public-gas.yml'), 'utf8');
  const schemaWorkflow = fs.readFileSync(path.join(repo, '.github/workflows/baseball-uniform-survey-schema.yml'), 'utf8');
  [publicWorkflow, schemaWorkflow].forEach((text) => {
    assert.match(text, /'baseball\/baseball-uniform-survey-results\.html'/);
    assert.match(text, /'baseball\/baseball-uniform-survey-results\/\*\*'/);
  });
  assert.match(publicWorkflow, /tests\/aggregate\.test\.js tests\/admin_gas\.test\.js tests\/results_page\.test\.js/);
  const prepare = require(path.join(repo, 'scripts', 'baseball-uniform-survey', 'prepare-gas.js'));
  assert.ok(prepare.FILES.every((f) => !/Dashboard|Snapshot|FreeText|admin/i.test(f)), 'Public GAS の bundle に Admin を含めない');
  assert.ok(!/SNAPSHOT_STATE|RESPONSES_SPREADSHEET_ID/.test(publicWorkflow));
});

test('Public GAS（#380）は #382 で変更されず、submit のたびに snapshot / cache を更新しない', () => {
  const dir = path.join(ROOT, 'public');
  const code = fs.readdirSync(dir).filter((f) => f.endsWith('.gs') && f !== 'SurveyGenerated.gs').map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  assert.ok(!/snapshot|CacheService|SurveyAggregate|results\.json/i.test(code));
  assert.ok(!/SurveyAggregate/.test(fs.readFileSync(path.join(dir, 'SurveyGenerated.gs'), 'utf8')));
});
