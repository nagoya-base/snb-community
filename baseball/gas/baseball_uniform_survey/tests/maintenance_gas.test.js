'use strict';
// 独立した maintenance GAS（Issue #383）。実Google・本番Spreadsheetへは接続しない。入力はすべて架空の fixture。
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createMaintenanceEnv, confirmedRetention, ROOT, AFTER_CLOSE, BEFORE_CLOSE, RECEPTION } = require('./helpers/maintenance-env');
const { schema, core, aggregate, rowsFrom, header } = require('./helpers/fixtures');
const maintenanceCore = require('../src/maintenance-core.js');
const { renderMaintenance, MAINTENANCE_TARGET } = require('../tools/build-public-gas');

const plain = (x) => JSON.parse(JSON.stringify(x));
const INTERESTED = { club_awareness: 'aware_not_attended', catchball_interest: 'very_interested' };
const ATTENDEE = { club_awareness: 'attended', last_attended: 'within_3m' };
const SECRET_TEXT = 'GAS-SECRET-FREE-TEXT';
const REPO = path.join(ROOT, '..', '..', '..');
const dir = path.join(ROOT, 'maintenance');
const strip = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const sources = () => fs.readdirSync(dir).filter((f) => /\.(gs|html)$/.test(f) && f !== 'SurveyGenerated.gs').map((f) => ({ name: f, code: strip(fs.readFileSync(path.join(dir, f), 'utf8')) }));

const fixtureRows = () => rowsFrom([
  { count: 32, overrides: Object.assign({ feedback: SECRET_TEXT }, INTERESTED) },
  { count: 21, overrides: ATTENDEE },
  { count: 4, meta: { response_mode: 'test', test_run_id: 'run' } }
]);
const writesTo = (env, prefix) => env.events.filter((e) => e.startsWith(prefix));
const responsesText = (env) => JSON.stringify(env.sheets.get('responses') ? env.sheets.get('responses').values : []);

function finalizedEnv(options = {}) {
  const env = createMaintenanceEnv(fixtureRows(), Object.assign({ retention: confirmedRetention() }, options));
  const code = env.ctx.finalizePreflight().confirmation_code;
  env.ctx.finalizeSurvey(code);
  return env;
}

// ── 構成・責務の分離 ──

test('生成物 maintenance/SurveyGenerated.gs は schema + 受付期間 + retention 設定 + core + aggregate + maintenance-core から再生成した内容と一致する（generated drift）', () => {
  assert.equal(fs.readFileSync(MAINTENANCE_TARGET, 'utf8'), renderMaintenance());
  assert.match(fs.readFileSync(MAINTENANCE_TARGET, 'utf8'), /DO NOT EDIT/);
  const env = createMaintenanceEnv([]);
  assert.deepEqual(plain(env.ctx.SURVEY_SCHEMA), schema);
  assert.deepEqual(Object.keys(env.ctx.SurveyCore).sort(), Object.keys(core).sort());
  assert.deepEqual(Object.keys(env.ctx.SurveyAggregate).sort(), Object.keys(aggregate).sort());
  assert.deepEqual(Object.keys(env.ctx.SurveyMaintenance).sort(), Object.keys(maintenanceCore).sort());
  const survey = JSON.parse(fs.readFileSync(path.join(ROOT, 'survey.config.json'), 'utf8'));
  // 受付設定は reception だけ。通知設定・検証設定・salt/token は持ち込まない。
  const text = fs.readFileSync(MAINTENANCE_TARGET, 'utf8');
  assert.ok(text.includes('var SURVEY_RECEPTION = ' + JSON.stringify(survey.reception) + ';'));
  assert.equal(env.ctx.SURVEY_CONFIG, undefined);
  const configPart = text.slice(text.indexOf('var SURVEY_RECEPTION'), text.indexOf('var SurveyCore'));
  assert.ok(!/notification|minElapsedMs|payloadMaxBytes|NOTIFICATION_EMAIL|testRun/.test(configPart));
  assert.ok(!/RESPONDENT_SALT\s*=|TEST_TOKEN\s*=/.test(text));
});

test('manifest：OAuth scope は spreadsheets のみ、Web App は本人のみ。Public / Admin の scope は広げない', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'appsscript.json'), 'utf8'));
  assert.deepEqual(manifest.oauthScopes, ['https://www.googleapis.com/auth/spreadsheets']);
  assert.deepEqual(manifest.webapp, { executeAs: 'USER_DEPLOYING', access: 'MYSELF' });
  const admin = JSON.parse(fs.readFileSync(path.join(ROOT, 'admin', 'appsscript.json'), 'utf8'));
  assert.deepEqual(admin.oauthScopes, ['https://www.googleapis.com/auth/spreadsheets.readonly']);
  const prepare = require(path.join(REPO, 'scripts', 'baseball-uniform-survey', 'prepare-gas.js'));
  const publicManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'appsscript.json'), 'utf8'));
  assert.deepEqual([...publicManifest.oauthScopes].sort(), [...prepare.REQUIRED_SCOPES].sort());
  assert.ok(prepare.FILES.every((f) => !/maintenance|Finalize|Cleanup|Retention/i.test(f)), 'Public GAS の bundle に maintenance を含めない');
});

test('公開 endpoint を持たない：doPost・回答受付・回答の編集/削除 UI がなく、操作は運営者専用の関数だけ', () => {
  const env = createMaintenanceEnv([]);
  assert.equal(typeof env.ctx.doPost, 'undefined');
  ['doGet', 'getRetentionStatus', 'finalizePreflight', 'finalizeSurvey', 'getFinalizedStatus', 'getFinalSnapshot', 'cleanupDryRun', 'cleanupExecute', 'confirmManualCleanup']
    .forEach((name) => assert.equal(typeof env.ctx[name], 'function', name));
  assert.equal(env.ctx.doGet().name, 'Maintenance');
  const html = fs.readFileSync(path.join(dir, 'Maintenance.html'), 'utf8');
  assert.ok(!/innerHTML|respondent_hash|editResponse|deleteResponse|updateResponse/.test(html));
  const all = sources().map((s) => s.code).join('\n');
  assert.ok(!/editResponse|updateResponse|deleteResponse\b|setResponse/.test(all), '1件ずつの編集・削除 API を持たない');
});

test('不要な外部 API を使わない：CacheService / UrlFetch / Mail / Drive / 他の GAS の呼び出し・salt/token の参照がない', () => {
  for (const { name, code } of sources()) {
    assert.ok(!/(CacheService|UrlFetchApp|MailApp|GmailApp|DriveApp|SpreadsheetApp\.create|ScriptApp|\.copyTo)/.test(code), `${name}: 不要な外部 API`);
    assert.ok(!/getProperty_?\(\s*['"](RESPONDENT_SALT|TEST_TOKEN|NOTIFICATION_EMAIL|SPREADSHEET_ID|SNAPSHOT_STATE)['"]/.test(code), `${name}: 他 project の Script Property を参照しない`);
    assert.ok(!/GITHUB|github\.com|api\.github|git commit/i.test(code), `${name}: GitHub へ自動 commit しない`);
  }
  // Public / Admin は maintenance を呼ばず、CacheService も使わない（storage inventory の cache_service: not_used の根拠）。
  for (const sub of ['public', 'admin']) {
    const code = fs.readdirSync(path.join(ROOT, sub)).filter((f) => f.endsWith('.gs')).map((f) => strip(fs.readFileSync(path.join(ROOT, sub, f), 'utf8'))).join('\n');
    assert.ok(!/CacheService/.test(code), `${sub}: CacheService を使わない`);
    assert.ok(!/SurveyMaintenance|finalizeSurvey|cleanupExecute|FINALIZED_MARKER/.test(code), `${sub}: maintenance の責務を持たない`);
  }
});

// ── finalize ──

test('finalize は締切後だけ：締切前・closes_at 未設定は拒否し、行も保存先も触らない', () => {
  const before = createMaintenanceEnv(fixtureRows(), { now: BEFORE_CLOSE });
  assert.throws(() => before.ctx.finalizePreflight(), /not_closed_yet/);
  assert.throws(() => before.ctx.finalizeSurvey('x'), /not_closed_yet/);
  const unset = createMaintenanceEnv(fixtureRows(), { reception: Object.assign({}, RECEPTION, { closes_at: null }) });
  assert.throws(() => unset.ctx.finalizePreflight(), /closes_at_not_set/);
  const repoDefault = createMaintenanceEnv(fixtureRows());
  repoDefault.ctx.SURVEY_RECEPTION = JSON.parse(fs.readFileSync(path.join(ROOT, 'survey.config.json'), 'utf8')).reception;
  assert.throws(() => repoDefault.ctx.finalizePreflight(), /closes_at_not_set/);
  [before, unset, repoDefault].forEach((env) => {
    assert.deepEqual(env.events.filter((e) => !e.startsWith('lock:')), []);
    assert.equal(env.props.has('FINALIZED_MARKER'), false);
  });
});

test('finalize の永続化は final_snapshot Sheet → marker の順で、marker は最後。responses は書き換えない・Script Properties に JSON 本体を入れない', () => {
  const env = createMaintenanceEnv(fixtureRows(), { retention: confirmedRetention() });
  const preflight = plain(env.ctx.finalizePreflight());
  assert.equal(preflight.would, 'finalize');
  assert.deepEqual(env.events, [], 'preflight は書き込まない');
  const result = plain(env.ctx.finalizeSurvey(preflight.confirmation_code));
  assert.equal(result.status, 'finalized');
  const writes = env.events.filter((e) => !e.startsWith('lock:') && !e.endsWith(':setNumberFormat'));
  assert.deepEqual(writes, ['spreadsheet:insertSheet:final_snapshot', 'sheet:final_snapshot:clear', 'sheet:final_snapshot:setValues', 'property:FINALIZED_MARKER']);
  assert.equal(writes[writes.length - 1], 'property:FINALIZED_MARKER');
  assert.equal(writesTo(env, 'sheet:responses').length, 0, 'responses を書き換えない');
  assert.equal(env.sheets.has('responses_valid'), false, 'responses_valid（回答の複製）は作らない');
  assert.deepEqual([...env.props.keys()].sort(), ['FINALIZED_MARKER', 'RESPONSES_SPREADSHEET_ID']);
  assert.ok(env.props.get('FINALIZED_MARKER').length < 1000, 'Script Properties には小さい marker だけ');
  const marker = JSON.parse(env.props.get('FINALIZED_MARKER'));
  assert.deepEqual(Object.keys(marker).sort(), [...maintenanceCore.MARKER_KEYS].sort());
  assert.equal(marker.production_valid_total, 53);
  assert.equal(marker.closes_at, RECEPTION.closes_at);
  assert.equal(marker.finalized_at, AFTER_CLOSE.toISOString());
});

test('final snapshot は #382 の buildSnapshot と一致し、SHA-256 digest が marker と一致する。個票・自由記述・hash・salt は保存先のどこにもない', () => {
  const rows = fixtureRows();
  const env = finalizedEnv();
  const marker = JSON.parse(env.props.get('FINALIZED_MARKER'));
  const final = plain(env.ctx.getFinalSnapshot());
  const classification = aggregate.classifyRows(schema, rows);
  const expected = JSON.stringify(aggregate.buildSnapshot(schema, classification.valid, { generatedAt: new Date(RECEPTION.closes_at) }), null, 2) + '\n';
  assert.equal(final.json, expected);
  assert.equal(final.digest, crypto.createHash('sha256').update(expected, 'utf8').digest('hex'));
  assert.equal(final.digest, marker.snapshot_digest);
  assert.deepEqual(aggregate.validateSnapshot(schema, JSON.parse(final.json)), []);
  const stored = JSON.stringify([...env.sheets.get('final_snapshot').values]) + [...env.props.values()].join('\n') + env.logs.join('\n');
  assert.ok(!stored.includes(SECRET_TEXT));
  rows.forEach((r) => assert.ok(!stored.includes(r.respondent_hash)));
  assert.ok(!final.json.includes('respondent_hash') && !final.json.includes('other_texts') && !final.json.includes('feedback'));
});

test('大きな final JSON は複数チャンクに分割され、各セルは数式・数値として解釈されない接頭辞を持ち、読み戻しで完全一致する', () => {
  const env = createMaintenanceEnv(fixtureRows(), { retention: confirmedRetention(), chunkSize: 200 });
  env.ctx.finalizeSurvey(env.ctx.finalizePreflight().confirmation_code);
  const values = env.sheets.get('final_snapshot').values;
  assert.ok(values.length > 5, '複数チャンク');
  values.slice(1).forEach(([index, cell], i) => { assert.equal(index, i); assert.ok(cell.startsWith('c:')); assert.ok(cell.length <= 202); });
  assert.equal(plain(env.ctx.getFinalSnapshot()).digest, JSON.parse(env.props.get('FINALIZED_MARKER')).snapshot_digest);
  assert.equal(plain(env.ctx.getFinalizedStatus()).snapshot_verified, true);
  // 保存後に改ざんされた snapshot は検証に失敗する（marker があっても公開用に返さない）。
  env.sheets.get('final_snapshot').values[2][1] = 'c:tampered';
  assert.equal(plain(env.ctx.getFinalizedStatus()).snapshot_verified, false);
  assert.throws(() => env.ctx.getFinalSnapshot(), /snapshot_verify_failed/);
});

test('途中失敗時に finalized marker を残さない：snapshot 保存失敗・marker 保存失敗・整合不一致', () => {
  const saveFail = createMaintenanceEnv(fixtureRows(), { failSheetWrite: 'final_snapshot' });
  const code = saveFail.ctx.finalizePreflight().confirmation_code;
  assert.throws(() => saveFail.ctx.finalizeSurvey(code), /sheet_write_failed/);
  assert.equal(saveFail.props.has('FINALIZED_MARKER'), false);
  assert.equal(writesTo(saveFail, 'property:FINALIZED_MARKER').length, 0);
  assert.equal(plain(saveFail.ctx.getFinalizedStatus()).state, 'not_finalized');

  const markerFail = createMaintenanceEnv(fixtureRows(), { failSetProperty: 'FINALIZED_MARKER' });
  assert.throws(() => markerFail.ctx.finalizeSurvey(markerFail.ctx.finalizePreflight().confirmation_code), /property_write_failed/);
  assert.equal(markerFail.props.has('FINALIZED_MARKER'), false);
  assert.equal(plain(markerFail.ctx.getFinalizedStatus()).state, 'not_finalized');

  const headerBad = createMaintenanceEnv(fixtureRows(), { header: header().slice().reverse() });
  assert.throws(() => headerBad.ctx.finalizePreflight(), /header_mismatch/);
  const none = createMaintenanceEnv([], { noResponsesSheet: true });
  assert.throws(() => none.ctx.finalizePreflight(), /responses_sheet_missing/);
  const unconfigured = createMaintenanceEnv([]);
  unconfigured.props.delete('RESPONSES_SPREADSHEET_ID');
  assert.throws(() => unconfigured.ctx.finalizePreflight(), /not_configured/);
  [headerBad, none, unconfigured].forEach((env) => assert.equal(env.props.has('FINALIZED_MARKER'), false));
});

test('finalize は explicit confirmation が必要で、同内容の再実行は no-op、異なる内容は fail closed。lock を取る', () => {
  const env = createMaintenanceEnv(fixtureRows(), { retention: confirmedRetention() });
  assert.throws(() => env.ctx.finalizeSurvey(), /confirmation_mismatch/);
  assert.throws(() => env.ctx.finalizeSurvey('FINALIZE:2026-10:000000000000'), /confirmation_mismatch/);
  assert.equal(env.props.has('FINALIZED_MARKER'), false);
  const code = env.ctx.finalizePreflight().confirmation_code;
  env.ctx.finalizeSurvey(code);
  const markerBefore = env.props.get('FINALIZED_MARKER');
  env.events.length = 0;
  const again = plain(env.ctx.finalizeSurvey('whatever'));
  assert.equal(again.status, 'already_finalized');
  assert.equal(env.props.get('FINALIZED_MARKER'), markerBefore);
  assert.deepEqual(env.events.filter((e) => !e.startsWith('lock:')), [], 'no-op は何も書かない');
  assert.deepEqual(env.events.filter((e) => e.startsWith('lock:')), ['lock:acquire', 'lock:release']);
  // 回答が増えた → conflict（自動上書きしない）。
  const sheet = env.sheets.get('responses');
  rowsFrom([{ count: 20, overrides: ATTENDEE }]).forEach((row) => sheet.values.push(header().map((name) => (row[name] === undefined ? '' : row[name]))));
  assert.equal(plain(env.ctx.finalizePreflight()).would, 'conflict');
  assert.throws(() => env.ctx.finalizeSurvey(code), /finalized_conflict/);
  assert.equal(env.props.get('FINALIZED_MARKER'), markerBefore);
});

test('GAS：同一 marker で final_snapshot Sheet が正常/欠損/改変の3ケース（欠損・改変は再実行を成功扱いにしない）', () => {
  const env = finalizedEnv();
  const markerBefore = env.props.get('FINALIZED_MARKER');
  env.events.length = 0;
  // 正常
  assert.equal(plain(env.ctx.finalizePreflight()).would, 'noop');
  assert.equal(plain(env.ctx.finalizeSurvey('x')).status, 'already_finalized');
  // 改変
  const sheet = env.sheets.get('final_snapshot');
  const saved = JSON.stringify(sheet.values);
  sheet.values[1][1] = 'c:tampered';
  assert.equal(plain(env.ctx.finalizePreflight()).would, 'inconsistent');
  assert.throws(() => env.ctx.finalizeSurvey('x'), /final_snapshot_mismatch/);
  // 欠損（Sheet ごと・中身だけ）
  sheet.values = [['chunk_index', 'content']];
  assert.equal(plain(env.ctx.finalizePreflight()).problem, 'final_snapshot_missing');
  assert.throws(() => env.ctx.finalizeSurvey('x'), /final_snapshot_missing/);
  env.sheets.delete('final_snapshot');
  assert.equal(plain(env.ctx.finalizePreflight()).would, 'inconsistent');
  assert.throws(() => env.ctx.finalizeSurvey('x'), /final_snapshot_missing/);
  assert.throws(() => env.ctx.getFinalSnapshot(), /snapshot_verify_failed/);
  assert.equal(env.props.get('FINALIZED_MARKER'), markerBefore, 'marker は書き換えない');
  assert.deepEqual(env.events.filter((e) => !e.startsWith('lock:')), [], '不整合時は何も書かない');
  assert.ok(saved.length > 0);
});

// ── retention / cleanup ──

test('retention 設定状態：リポジトリの設定は未確定で launch_ready=false（production launch blocker のまま）。inventory が見える', () => {
  const env = createMaintenanceEnv([]);
  env.ctx.SURVEY_RECEPTION = JSON.parse(fs.readFileSync(path.join(ROOT, 'survey.config.json'), 'utf8')).reception;
  const status = plain(env.ctx.getRetentionStatus());
  assert.equal(status.owner, 'nagoya-base');
  assert.equal(status.status, 'unset');
  assert.equal(status.launch_ready, false);
  assert.equal(status.schema_retention_status, 'must_set_before_launch');
  assert.equal(status.inventory.length, maintenanceCore.STORAGE_INVENTORY.length);
  assert.ok(status.inventory.some((s) => s.id === 'spreadsheet_history_and_backups' && s.automation === 'manual_required'));
  assert.deepEqual(env.events, []);
});

const cleanupNow = new Date('2027-04-02T00:00:00+09:00');
function cleanupEnv(retention = confirmedRetention(), options = {}) {
  const env = createMaintenanceEnv(fixtureRows(), Object.assign({ retention, now: AFTER_CLOSE, extraSheets: ['responses_valid'] }, options));
  if (options.finalize !== false) env.ctx.finalizeSurvey(env.ctx.finalizePreflight().confirmation_code);
  env.now = cleanupNow;
  env.events.length = 0;
  return env;
}

test('cleanup dry-run は非破壊で、件数と storage 名のみ。回答本文・自由記述・hash を画面にもログにも出さない', () => {
  const env = cleanupEnv();
  const plan = plain(env.ctx.cleanupDryRun());
  assert.deepEqual(env.events, [], '何も書かない');
  const counts = Object.fromEntries(plan.storages.map((s) => [s.id, s.count]));
  assert.equal(counts.responses_production, 53);
  assert.equal(counts.responses_test, 4);
  assert.equal(counts.responses_valid_sheet, 1);
  assert.equal(plan.can_execute, true);
  const output = JSON.stringify(plan) + env.logs.join('\n');
  assert.ok(!output.includes(SECRET_TEXT));
  env.sheets.get('responses').values.slice(1).forEach((line) => line.filter((v) => typeof v === 'string' && v.length >= 20).forEach((v) => assert.ok(!output.includes(v))));
  assert.equal(responsesText(env).includes(SECRET_TEXT), true, 'dry-run 後も回答は残っている');
});

test('cleanup は retention 未確定・期限前・confirmation なしでは削除しない', () => {
  const unset = cleanupEnv(JSON.parse(fs.readFileSync(path.join(ROOT, 'retention.config.json'), 'utf8')), { finalize: false });
  assert.throws(() => unset.ctx.cleanupExecute('CLEANUP:x:000000000000'), /retention_policy_not_confirmed/);
  const early = cleanupEnv();
  early.now = new Date('2027-03-31T12:00:00+09:00');
  assert.throws(() => early.ctx.cleanupExecute('CLEANUP:fixture-1:000000000000'), /retention_not_reached/);
  const noConfirm = cleanupEnv();
  assert.throws(() => noConfirm.ctx.cleanupExecute(), /confirmation_required/);
  assert.throws(() => noConfirm.ctx.cleanupExecute('yes'), /confirmation_mismatch/);
  [unset, early, noConfirm].forEach((env) => {
    assert.deepEqual(env.events.filter((e) => !e.startsWith('lock:')), []);
    assert.equal(env.sheets.get('responses').values.length, 1 + 57);
    assert.equal(env.props.has('CLEANUP_AUDIT'), false);
  });
});

test('cleanup execute：production / test の行と派生 Sheet を削除し（ヘッダーは残す）、keep=true なら final snapshot を残し、再 scan して audit を記録する', () => {
  const env = cleanupEnv(confirmedRetention({ keep_final_snapshot: true }));
  const finalBefore = JSON.stringify(env.sheets.get('final_snapshot').values);
  const result = plain(env.ctx.cleanupExecute(env.ctx.cleanupDryRun().confirmation_code));
  assert.equal(result.status, 'completed_manual_required_pending');
  assert.equal(result.success, true);
  assert.deepEqual(env.sheets.get('responses').values, [header()], 'ヘッダー行だけが残る');
  assert.equal(env.sheets.has('responses_valid'), false);
  assert.equal(JSON.stringify(env.sheets.get('final_snapshot').values), finalBefore, 'final snapshot は残る');
  assert.equal(plain(env.ctx.getFinalizedStatus()).snapshot_verified, true);
  assert.ok(env.props.has('FINALIZED_MARKER'));
  assert.ok(writesTo(env, 'sheet:final_snapshot').length === 0);
  const audit = JSON.parse(env.props.get('CLEANUP_AUDIT'));
  assert.equal(audit.length, 1);
  assert.deepEqual(Object.keys(audit[0]).sort(), [...maintenanceCore.AUDIT_KEYS].sort());
  assert.equal(audit[0].success, true);
  const auditText = env.props.get('CLEANUP_AUDIT') + env.logs.join('\n');
  assert.ok(!auditText.includes(SECRET_TEXT));
  assert.equal(plain(env.ctx.cleanupDryRun()).storages.find((s) => s.id === 'responses_production').count, 0);
  assert.deepEqual(env.events.filter((e) => e.startsWith('lock:')).slice(0, 2), ['lock:acquire', 'lock:release']);
});

test('cleanup：keep=false なら final snapshot も削除。response_mode 不明の行も残さない。行削除は下から連続範囲ごと', () => {
  const rows = fixtureRows();
  rows[3].response_mode = 'staging';
  rows[10].response_mode = '';
  const env = createMaintenanceEnv(rows, { retention: confirmedRetention({ keep_final_snapshot: false }), now: cleanupNow });
  const result = plain(env.ctx.cleanupExecute(env.ctx.cleanupDryRun().confirmation_code));
  assert.equal(result.success, true);
  assert.deepEqual(env.sheets.get('responses').values, [header()]);
  assert.deepEqual(result.storages.map((s) => [s.id, s.deleted]).filter(([id]) => id.startsWith('responses_') && !id.endsWith('sheet')).sort(),
    [['responses_production', 51], ['responses_test', 4], ['responses_unclassified', 2]]);
  const deletes = writesTo(env, 'sheet:responses:deleteRows').length;
  assert.ok(deletes <= 6, '連続範囲ごとに削除する: ' + deletes);
});

test('cleanup：keep=true なのに未 finalize なら拒否し、header 不一致の Sheet は削除しない', () => {
  const unfinalized = cleanupEnv(confirmedRetention({ keep_final_snapshot: true }), { finalize: false });
  assert.throws(() => unfinalized.ctx.cleanupExecute('x'), /final_snapshot_required/);
  assert.equal(unfinalized.sheets.get('responses').values.length, 58);

  const wrong = createMaintenanceEnv(fixtureRows(), { retention: confirmedRetention({ keep_final_snapshot: false }), now: cleanupNow, header: header().slice().reverse() });
  assert.throws(() => wrong.ctx.cleanupDryRun(), /header_mismatch/);
  assert.throws(() => wrong.ctx.cleanupExecute('x'), /header_mismatch/);
  assert.deepEqual(writesTo(wrong, 'sheet:'), []);
});

test('cleanup の部分失敗・削除漏れは成功扱いにせず、audit も success:false', () => {
  const failing = createMaintenanceEnv(fixtureRows(), { retention: confirmedRetention({ keep_final_snapshot: false }), now: cleanupNow, failDeleteRows: 'responses' });
  const result = plain(failing.ctx.cleanupExecute(failing.ctx.cleanupDryRun().confirmation_code));
  assert.equal(result.status, 'failed');
  assert.equal(result.success, false);
  assert.equal(JSON.parse(failing.props.get('CLEANUP_AUDIT'))[0].success, false);

  const leftover = createMaintenanceEnv(fixtureRows(), { retention: confirmedRetention({ keep_final_snapshot: false }), now: cleanupNow, noopDeleteRows: 'responses' });
  const leftoverResult = plain(leftover.ctx.cleanupExecute(leftover.ctx.cleanupDryRun().confirmation_code));
  assert.equal(leftoverResult.status, 'failed', '削除 API が成功しても、再 scan で残っていれば失敗');
});

test('manual_required：完了記録まで completed にならず、未知の storage・自動削除対象は記録できない', () => {
  const env = cleanupEnv(confirmedRetention({ keep_final_snapshot: false }), { finalize: false });
  const first = plain(env.ctx.cleanupExecute(env.ctx.cleanupDryRun().confirmation_code));
  assert.equal(first.status, 'completed_manual_required_pending');
  assert.ok(first.manual_required_pending.includes('public_script_properties'));
  assert.throws(() => env.ctx.confirmManualCleanup('responses_production'), /invalid_request/);
  assert.throws(() => env.ctx.confirmManualCleanup('nope'), /invalid_request/);
  first.manual_required_pending.forEach((id) => env.ctx.confirmManualCleanup(id));
  const done = plain(env.ctx.cleanupDryRun());
  assert.ok(done.manual_required.every((m) => m.completed === true));
  const second = plain(env.ctx.cleanupExecute(done.confirmation_code));
  assert.equal(second.status, 'completed');
  const audit = JSON.parse(env.props.get('CLEANUP_AUDIT'));
  assert.equal(audit.length, 2);
  assert.ok(audit[1].manual_required.every((m) => m.completed === true));
});

test('Script Properties には回答由来の個票・自由記述・hash・salt が入らない（finalize → cleanup 後）', () => {
  const rows = fixtureRows();
  const env = cleanupEnv(confirmedRetention({ keep_final_snapshot: true }));
  env.ctx.cleanupExecute(env.ctx.cleanupDryRun().confirmation_code);
  const text = [...env.props.entries()].filter(([k]) => k !== 'RESPONSES_SPREADSHEET_ID').map(([, v]) => v).join('\n') + env.logs.join('\n');
  assert.ok(!text.includes(SECRET_TEXT));
  rows.forEach((r) => assert.ok(!text.includes(r.respondent_hash)));
  assert.ok(!/RESPONDENT_SALT|TEST_TOKEN/.test(text));
  assert.deepEqual([...env.props.keys()].sort(), ['CLEANUP_AUDIT', 'FINALIZED_MARKER', 'RESPONSES_SPREADSHEET_ID']);
});

// ── リポジトリ・CI ──

test('リポジトリに実データ・secret・本番 Spreadsheet ID・実メールアドレスを置かない（maintenance / retention 設定 / 生成物）', () => {
  const files = fs.readdirSync(dir).map((f) => path.join(dir, f)).concat([path.join(ROOT, 'retention.config.json'), path.join(ROOT, 'src', 'maintenance-core.js'), path.join(__dirname, 'maintenance_core.test.js'), __filename]);
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const rel = path.relative(REPO, file);
    assert.ok(!/docs\.google\.com\/spreadsheets|script\.google\.com\/macros/.test(text), `${rel}: URL`);
    assert.ok(!/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(text), `${rel}: メールアドレス`);
    assert.ok(!/(?<![A-Za-z0-9_-])1[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/.test(text), `${rel}: Spreadsheet ID 形式`);
    assert.ok(!/\b[0-9a-f]{64}\b/.test(text.replace(/FINALIZE|CLEANUP/g, '')), `${rel}: 64桁 hex（hash / digest）`);
  }
  const names = fs.readdirSync(dir);
  assert.ok(!names.some((n) => /\.(csv|tsv|xlsx|json)$/i.test(n) && n !== 'appsscript.json'), '回答 export を置かない');
});

test('CI：既存 baseball survey workflow が maintenance のテストを実行し、maintenance の本番 deploy は行わない', () => {
  const publicWorkflow = fs.readFileSync(path.join(REPO, '.github/workflows/baseball-uniform-survey-public-gas.yml'), 'utf8');
  const schemaWorkflow = fs.readFileSync(path.join(REPO, '.github/workflows/baseball-uniform-survey-schema.yml'), 'utf8');
  assert.match(publicWorkflow, /tests\/maintenance_core\.test\.js tests\/maintenance_gas\.test\.js/);
  assert.match(publicWorkflow, /npm run build:check/);
  assert.match(schemaWorkflow, /'baseball\/gas\/baseball_uniform_survey\/\*\*'/);
  assert.match(publicWorkflow, /'baseball\/gas\/baseball_uniform_survey\/\*\*'/);
  const workflows = fs.readdirSync(path.join(REPO, '.github/workflows')).filter((f) => /baseball-uniform-survey/.test(f));
  workflows.forEach((f) => {
    const text = fs.readFileSync(path.join(REPO, '.github/workflows', f), 'utf8');
    assert.ok(!/maintenance\//.test(text.replace(/baseball\/gas\/baseball_uniform_survey\/\*\*/g, '')), `${f}: maintenance を deploy 対象にしない`);
  });
  assert.ok(!workflows.some((f) => /maintenance/.test(f)), 'maintenance 用の deploy workflow を持たない（本番 deploy はこの Issue の対象外）');
  const deployScript = fs.readFileSync(path.join(REPO, 'scripts/baseball-uniform-survey/deploy-gas.sh'), 'utf8');
  assert.ok(!/maintenance/i.test(deployScript), 'Public GAS の Script ID / Environment / Secret を maintenance と共有しない');
});

test('Public GAS（#380）と Admin（#382）の受付・集計ロジックは #383 で変更されず、maintenance 側は #382 の関数を再利用している', () => {
  const publicCode = fs.readdirSync(path.join(ROOT, 'public')).filter((f) => f.endsWith('.gs')).map((f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8')).join('\n');
  assert.ok(!/FINALIZED_MARKER|SurveyMaintenance|final_snapshot/.test(publicCode));
  const finalizeSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'maintenance-core.js'), 'utf8');
  ['aggregate.classifyRows(', 'aggregate.buildSnapshot(', 'aggregate.validateSnapshot('].forEach((call) => assert.ok(finalizeSource.includes(call), call));
  assert.ok(!/function (classifyRows|buildSnapshot|validateSnapshot|suppressCells|evaluatePublication)\b/.test(finalizeSource), '別集計・別 suppression を持たない');
});
