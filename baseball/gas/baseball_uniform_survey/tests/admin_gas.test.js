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
  // 読み取りは Advanced Sheets サービス（readonly scope のまま使える）。UrlFetchApp 用の external_request scope は足さない。
  assert.deepEqual(manifest.dependencies.enabledAdvancedServices, [{ userSymbol: 'Sheets', serviceId: 'sheets', version: 'v4' }]);
});

test('回帰防止：Admin コードに SpreadsheetApp（openById / openByUrl / open を含む）を再混入させない', () => {
  const all = fs.readdirSync(adminDir).filter((f) => f.endsWith('.gs') || f.endsWith('.html'))
    .map((f) => ({ name: f, code: fs.readFileSync(path.join(adminDir, f), 'utf8') }));
  const stripped = sources().concat(all.filter((f) => f.name === 'SurveyGenerated.gs'));
  for (const { name, code } of stripped) {
    assert.ok(!/\bSpreadsheetApp\b/.test(code), `${name}: SpreadsheetApp は spreadsheets.readonly では使えない`);
    assert.ok(!/\.(openById|openByUrl|getActiveSpreadsheet|getActive)\s*\(/.test(code), `${name}: Spreadsheet を開く API`);
    assert.ok(!/\bSpreadsheetApp\s*\.\s*open\s*\(/.test(code), `${name}: SpreadsheetApp.open`);
  }
  // 書き込み系の Sheets API（values.update / append / clear / batchUpdate 等）も持たない。
  for (const { name, code } of stripped) {
    assert.ok(!/Sheets\s*\.\s*Spreadsheets\s*\.\s*(batchUpdate|create)\b/.test(code), `${name}: Sheets 書き込み`);
    assert.ok(!/Values\s*\.\s*(update|append|clear|batchUpdate|batchClear|batchUpdateByDataFilter)\b/.test(code), `${name}: Sheets values 書き込み`);
  }
});

test('Sheets API（読み取りのみ）経由で responses を読む。SpreadsheetApp は sandbox に無い', () => {
  const env = createAdminEnv(fixtureRows());
  assert.equal(env.ctx.SpreadsheetApp, undefined);
  env.ctx.getAdminSummary();
  assert.deepEqual(env.calls.filter((c, i, a) => a.indexOf(c) === i), ['Spreadsheets.get', "Values.get 'responses'"]);
});

test('responses シートが無い場合は responses_sheet_missing', () => {
  const env = createAdminEnv(fixtureRows(), { sheetTitle: 'other' });
  assert.throws(() => env.ctx.getAdminSummary(), /responses_sheet_missing/);
});

test('回答 0 件（ヘッダーのみ）でも読める', () => {
  const env = createAdminEnv([]);
  assert.doesNotThrow(() => env.ctx.getAdminSummary());
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
    assert.ok(!/(SpreadsheetApp|\.copyTo|DriveApp|MailApp|UrlFetchApp|LockService)/.test(code), `${name}: 不要な外部 API`);
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

test('header 診断（#420）：正常・末尾空セル省略・期待列以降が空のみは読み込み成功', () => {
  const rows = fixtureRows();
  const total = plain(createAdminEnv(rows).ctx.getAdminSummary()).production_valid_total;
  assert.ok(total > 0);
  const short = createAdminEnv(rows); // Sheets API は末尾空セルを省く（helper が再現）
  const read = plain(short.ctx.readRows_());
  assert.equal(read.length, rows.length);
  read.forEach((r) => assert.deepEqual(Object.keys(r), header()));
  const padded = createAdminEnv(rows, { noTrim: true, transform: (v) => v.map((l) => l.concat(['', ''])) });
  assert.equal(plain(padded.ctx.getAdminSummary()).production_valid_total, total);
  assert.equal(padded.ctx.getResponsesDiagnostics().status, 'ok');
});

test('header 診断（#420）：列数不足・列名/順序不一致は header_mismatch', () => {
  const fewer = createAdminEnv(fixtureRows(), { header: header().slice(0, -2) });
  assert.throws(() => fewer.ctx.getAdminSummary(), /header_mismatch/);
  const d = plain(fewer.ctx.getResponsesDiagnostics());
  assert.equal(d.status, 'header_mismatch');
  assert.equal(d.expectedColumnCount, header().length);
  assert.equal(d.actualHeaderColumnCount, header().length - 2);
  assert.equal(d.firstMismatchColumn, header().length - 1);
  assert.equal(d.expectedColumnName, header()[header().length - 2]);
  assert.equal(d.actualHeaderColumnName, null);
  const swapped = header().slice();
  [swapped[1], swapped[2]] = [swapped[2], swapped[1]];
  const order = createAdminEnv(fixtureRows(), { header: swapped });
  assert.throws(() => order.ctx.getAdminSummary(), /header_mismatch/);
  const o = plain(order.ctx.getResponsesDiagnostics());
  assert.equal(o.firstMismatchColumn, 2);
  assert.equal(o.expectedColumnName, header()[1]);
  assert.equal(o.actualHeaderColumnName, swapped[1]);
});

test('header 診断（#420）：ヘッダーが正しく期待列以降に非空値があれば別エラーで fail-closed。回答値・hash は診断に出ない', () => {
  const rows = fixtureRows();
  const extra = createAdminEnv(rows, { transform: (v) => v.map((l, i) => (i === 3 ? l.concat(['LEAKED-EXTRA']) : l)) });
  assert.throws(() => extra.ctx.getAdminSummary(), /unexpected_extra_data_columns/);
  assert.throws(() => extra.ctx.getAdminSummary(), (e) => !/header_mismatch/.test(e.message));
  const d = plain(extra.ctx.getResponsesDiagnostics());
  assert.equal(d.status, 'unexpected_extra_data_columns');
  assert.equal(d.extraNonEmptyDataColumns, true);
  assert.equal(d.firstMismatchColumn, null);
  assert.equal(d.dataRowMaxWidth, header().length + 1);
  const out = JSON.stringify(d);
  assert.ok(!out.includes('LEAKED-EXTRA') && !out.includes('ADMIN-ONLY-TEXT') && !out.includes('responses-sheet-id'));
  rows.forEach((r) => assert.ok(!out.includes(r.respondent_hash)));
  assert.deepEqual(Object.keys(d).sort(), ['actualHeaderColumnCount', 'actualHeaderColumnName', 'dataRowMaxWidth', 'expectedColumnCount', 'expectedColumnName', 'extraNonEmptyDataColumns', 'firstMismatchColumn', 'status']);
  assert.deepEqual(extra.writes, []);
});

test('header 診断（#420）：responses シートが無ければ responses_sheet_missing を維持し、診断も別 status', () => {
  const missing = createAdminEnv(fixtureRows(), { sheetTitle: 'other' });
  assert.throws(() => missing.ctx.getAdminSummary(), /responses_sheet_missing/);
  assert.equal(missing.ctx.getResponsesDiagnostics().status, 'responses_sheet_missing');
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

test('CI：既存の baseball survey workflow が #382 の paths と Admin / snapshot / 結果ページのテストを実行し、Admin は専用 workflow・専用 bundle で deploy する（Public の bundle には含めない）', () => {
  const repo = path.join(ROOT, '..', '..', '..');
  const publicWorkflow = fs.readFileSync(path.join(repo, '.github/workflows/baseball-uniform-survey-public-gas.yml'), 'utf8');
  const schemaWorkflow = fs.readFileSync(path.join(repo, '.github/workflows/baseball-uniform-survey-schema.yml'), 'utf8');
  [publicWorkflow, schemaWorkflow].forEach((text) => {
    assert.match(text, /'baseball\/baseball-uniform-survey-results\.html'/);
    assert.match(text, /'baseball\/baseball-uniform-survey-results\/\*\*'/);
  });
  assert.match(publicWorkflow, /tests\/aggregate\.test\.js tests\/admin_gas\.test\.js tests\/results_page\.test\.js/);
  const prepare = require(path.join(repo, 'scripts', 'baseball-uniform-survey', 'prepare-gas.js'));
  assert.ok(prepare.TARGETS.public.files.every((f) => !/Dashboard|FreeText|admin/i.test(f)), 'Public GAS の bundle に Admin を含めない');
  assert.ok(!/SNAPSHOT_STATE|RESPONSES_SPREADSHEET_ID/.test(publicWorkflow));
});

test('Public GAS（#380）の回答保存仕様は #425 でも変わらない：snapshot は PublicSnapshot.gs に分離し、CacheService・Admin 機能・自由記述の参照を持たない', () => {
  const dir = path.join(ROOT, 'public');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.gs') && f !== 'SurveyGenerated.gs');
  for (const f of files) {
    const code = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/CacheService|results\.json|listFreeText|SNAPSHOT_STATE|RESPONSES_SPREADSHEET_ID/.test(code), `${f}: 不要な依存`);
    if (f !== 'PublicSnapshot.gs') assert.ok(!/SurveyAggregate|SnapshotStore/.test(code.replace(/refreshPublicSnapshot_/g, '')), `${f}: 集計は PublicSnapshot.gs だけが呼ぶ`);
  }
});

// ── version_mismatch 診断（Issue #422） ──

// Sheets が "2026-10" を日付へ自動変換した状態の再現：API（UNFORMATTED_VALUE）は日付シリアル値を返し、画面表示（FORMATTED_VALUE）は '2026-10' のまま。
const SERIAL_2026_10 = Math.round((Date.UTC(2026, 9, 1) - Date.UTC(1899, 11, 30)) / 86400000);
const convertedRows = (count = 6) => {
  const shown = rowsFrom([{ count: 20, overrides: Object.assign({ feedback: 'ADMIN-ONLY-TEXT' }, INTERESTED) }, { count, overrides: ATTENDEE }]);
  const raw = shown.map((r, i) => (i >= 20 ? Object.assign({}, r, { survey_version: SERIAL_2026_10 }) : r));
  return { shown, raw };
};

test('version 診断（#422）：表示は 2026-10 のまま API が月初日付シリアル値を返す 6 件は互換認識され production_valid、件数だけ legacy_date_serial_accepted で確認できる', () => {
  const { shown, raw } = convertedRows(6);
  const env = createAdminEnv(raw, { displayRows: shown });
  const summary = plain(env.ctx.getAdminSummary());
  assert.equal(summary.excluded.version_mismatch, 0);
  assert.deepEqual(summary.version_mismatch_fields, { survey_version: 0, schema_version: 0, design_version: 0 });
  assert.equal(summary.legacy_date_serial_accepted, 6);
  assert.equal(summary.production_valid_total, 26, '月初シリアルの既存行は互換認識して有効扱い');
  const d = plain(env.ctx.getVersionDiagnostics());
  assert.equal(d.status, 'ok');
  assert.deepEqual(d.expected, { survey_version: '2026-10', schema_version: '1', design_version: '2.18' });
  assert.equal(d.rows_checked, 26);
  assert.equal(d.mismatch_rows, 0);
  assert.equal(d.legacy_date_serial_accepted_rows, 6);
  assert.deepEqual(d.observed.survey_version, []);
});

test('version 診断（#422）：別月の日付シリアル値は version_mismatch のまま除外され、診断で date_serial_other と分かる', () => {
  const { shown, raw } = convertedRows(3);
  const other = Math.round((Date.UTC(2026, 10, 1) - Date.UTC(1899, 11, 30)) / 86400000);
  const rows = raw.map((r) => (r.survey_version === SERIAL_2026_10 ? Object.assign({}, r, { survey_version: other }) : r));
  const env = createAdminEnv(rows, { displayRows: shown });
  const summary = plain(env.ctx.getAdminSummary());
  assert.equal(summary.excluded.version_mismatch, 3);
  assert.equal(summary.legacy_date_serial_accepted, 0);
  assert.equal(summary.production_valid_total, 20);
  const d = plain(env.ctx.getVersionDiagnostics());
  assert.deepEqual(d.observed.survey_version, [{ api_type: 'number', shape: 'date_serial_other', display_matches_expected: true, count: 3 }]);
});

test('version 診断（#422）：read-only で、version 列（B:D）以外の表示値を読まない。Sheets の書き込み API を呼ばない', () => {
  const { shown, raw } = convertedRows(2);
  const env = createAdminEnv(raw, { displayRows: shown });
  env.ctx.getVersionDiagnostics();
  assert.deepEqual(env.writes, []);
  assert.deepEqual(env.ranges, ["'responses'!B:D"]);
  assert.deepEqual(env.renderOptions, ['UNFORMATTED_VALUE', 'FORMATTED_VALUE']);
  assert.equal(env.ctx.SpreadsheetApp, undefined);
});

test('version 診断（#422）：回答本文・自由記述・hash・timestamp・source_channel・Spreadsheet ID を出力しない（Admin summary の内訳も同様）', () => {
  const { shown, raw } = convertedRows(3);
  const env = createAdminEnv(raw, { displayRows: shown });
  const outputs = JSON.stringify(env.ctx.getVersionDiagnostics()) + JSON.stringify(plain(env.ctx.getAdminSummary()).version_mismatch_fields) + JSON.stringify(plain(env.ctx.getAdminSummary()).legacy_date_serial_accepted);
  ['ADMIN-ONLY-TEXT', 'responses-sheet-id', '2026-11-10 12:00', 'unknown', 'sent'].forEach((s) => assert.ok(!outputs.includes(s), s));
  raw.forEach((r) => assert.ok(!outputs.includes(r.respondent_hash)));
  const d = plain(env.ctx.getVersionDiagnostics());
  assert.deepEqual(Object.keys(d).sort(), ['display_equal_api_differs_rows', 'expected', 'legacy_date_serial_accepted_rows', 'mismatch_by_field', 'mismatch_rows', 'observed', 'rows_checked', 'status']);
});

test('version 診断（#422）：本当に異なる version は mismatch のまま、表示値も違うと分かる（Sheets の型変換が原因ではない）', () => {
  const base = rowsFrom([{ count: 5, overrides: INTERESTED }]);
  const rows = base.map((r, i) => (i < 2 ? Object.assign({}, r, { design_version: '2.17' }) : r));
  const env = createAdminEnv(rows, { displayRows: rows });
  const d = plain(env.ctx.getVersionDiagnostics());
  assert.deepEqual(d.mismatch_by_field, { survey_version: 0, schema_version: 0, design_version: 2 });
  assert.equal(d.display_equal_api_differs_rows, 0);
  assert.deepEqual(d.observed.design_version, [{ api_type: 'string', shape: 'string_other', display_matches_expected: false, count: 2 }]);
  assert.equal(plain(env.ctx.getAdminSummary()).excluded.version_mismatch, 2);
});

test('version 診断（#422）：正常な文字列 version と、Sheets が数値化した schema/design version は mismatch ゼロで production_valid', () => {
  const rows = rowsFrom([{ count: 4, overrides: INTERESTED }]).map((r, i) => (i % 2 ? Object.assign({}, r, { schema_version: 1, design_version: 2.18 }) : r));
  const env = createAdminEnv(rows);
  const d = plain(env.ctx.getVersionDiagnostics());
  assert.equal(d.mismatch_rows, 0);
  assert.equal(plain(env.ctx.getAdminSummary()).production_valid_total, 4);
});

test('version 診断（#422）：ヘッダー不一致・未設定・シート無しは回答を読まず status だけ返す', () => {
  assert.equal(plain(createAdminEnv(fixtureRows(), { header: header().slice().reverse() }).ctx.getVersionDiagnostics()).status, 'header_mismatch');
  assert.equal(plain(createAdminEnv(fixtureRows(), { sheetTitle: 'other' }).ctx.getVersionDiagnostics()).status, 'responses_sheet_missing');
  const none = createAdminEnv([]);
  none.props.delete('RESPONSES_SPREADSHEET_ID');
  assert.equal(plain(none.ctx.getVersionDiagnostics()).status, 'not_configured');
});

test('version 診断（#422）：既存行を書き換えない（診断前後で Sheets の読み取り内容も API 呼び出しも変わらない）', () => {
  const { shown, raw } = convertedRows(6);
  const env = createAdminEnv(raw, { displayRows: shown });
  const before = JSON.stringify(plain(env.ctx.readRows_()));
  env.ctx.getVersionDiagnostics();
  env.ctx.getAdminSummary();
  assert.equal(JSON.stringify(plain(env.ctx.readRows_())), before);
  assert.deepEqual(env.writes, []);
});

test('Dashboard（#422）：version_mismatch があれば内訳と診断を textContent で表示する（innerHTML・個別行の値なし）', () => {
  const html = fs.readFileSync(path.join(adminDir, 'Dashboard.html'), 'utf8');
  assert.match(html, /getVersionDiagnostics/);
  assert.match(html, /version_mismatch_fields/);
  assert.match(html, /legacy_date_serial_accepted/);
  assert.ok(!/innerHTML/.test(html));
});
