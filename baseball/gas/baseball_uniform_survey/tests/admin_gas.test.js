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
  assert.equal(items.filter((i) => i.text.startsWith('ADMIN-ONLY-TEXT ')).length, 32);
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

// ── Admin を結果閲覧中心・スマホ前提で再設計（Issue #426） ──

const { JSDOM } = require('jsdom');

/* 実際の getAdminSummary() の返却値で Dashboard.html を描画する（google.script.run だけ差し替え）。 */
function renderDashboard(rows, options) {
  const env = createAdminEnv(rows);
  const summary = plain(env.ctx.getAdminSummary());
  const html = fs.readFileSync(path.join(adminDir, 'Dashboard.html'), 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    beforeParse(window) {
      const chain = () => {
        const handlers = {};
        const run = new Proxy({}, {
          get(_, name) {
            if (name === 'withSuccessHandler') return (fn) => { handlers.ok = fn; return run; };
            if (name === 'withFailureHandler') return (fn) => { handlers.ng = fn; return run; };
            return (...args) => {
              if (name === 'getAdminSummary') handlers.ok(summary);
              else if (handlers.ok) {
                const value = options && options[name] !== undefined ? options[name] : {};
                handlers.ok(typeof value === 'function' ? value(...args) : value);
              }
            };
          }
        });
        return run;
      };
      Object.defineProperty(window, 'google', { value: { script: { get run() { return chain(); } } } });
    }
  });
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
  dom.window.eval(script);
  return { document: dom.window.document, summary, html };
}

test('Dashboard（#426）：デフォルトは「集計結果」タブで、設問ごとの縦カードに件数と割合を表示する', () => {
  const { document, summary } = renderDashboard(fixtureRows());
  assert.equal(document.querySelector('[data-tab="results"]').getAttribute('aria-selected'), 'true');
  assert.equal(document.getElementById('tab-results').hidden, false);
  assert.equal(document.getElementById('tab-publication').hidden, true);
  const cards = document.querySelectorAll('#results > .card');
  assert.equal(cards.length, summary.questions.length + summary.internalQuestions.length);
  const q = summary.questions.find((x) => x.id === 'baseball_experience');
  const card = [...cards].find((c) => c.querySelector('h3').textContent === q.label);
  const answered = q.answeredCount;
  assert.ok(answered > 0);
  const text = card.textContent;
  assert.match(text, new RegExp(`回答 ${answered} 件`));
  q.tally.forEach((c) => {
    const pct = Math.round((c.count * 100) / answered);
    assert.ok(text.includes(`${c.label}${c.count}件 ${pct}%`), `${c.label}`);
  });
  assert.ok(!/合計100%にはなりません/.test(text), 'single に複数選択の注記は出さない');
});

test('Dashboard（#426）：件数未達・公開保留でも Admin の内部集計（件数・割合）は隠さない。公開可否は補助表示', () => {
  const rows = rowsFrom([{ count: 5, overrides: INTERESTED }]); // production 5 件 < minTotal
  const { document, summary } = renderDashboard(rows);
  const q = summary.questions.find((x) => x.id === 'catchball_interest');
  assert.notEqual(q.publicState, 'published');
  assert.ok(q.tally.some((c) => c.count > 0), 'summary の tally は閾値と無関係に exact');
  const card = [...document.querySelectorAll('#results > .card')].find((c) => c.querySelector('h3').textContent === q.label);
  const top = q.tally.find((c) => c.count > 0);
  assert.ok(card.textContent.includes(`${top.label}${top.count}件 ${Math.round((top.count * 100) / q.answeredCount)}%`));
  assert.match(card.querySelector('.meta').textContent, /一般公開: 未達/);
});

test('Dashboard（#426）：multiple は回答者数ベースの比率で、合計100%にならない旨を表示する', () => {
  const rows = rowsFrom([{ count: 4, overrides: Object.assign({}, INTERESTED, { barriers: ['schedule', 'cost'], main_barrier: 'schedule' }) }, { count: 6, overrides: Object.assign({}, INTERESTED, { barriers: ['schedule'], main_barrier: 'schedule' }) }]);
  const { document, summary } = renderDashboard(rows);
  const q = summary.questions.find((x) => x.id === 'barriers');
  assert.equal(q.type, 'multiple');
  const card = [...document.querySelectorAll('#results > .card')].find((c) => c.querySelector('h3').textContent === q.label);
  assert.match(card.textContent, /複数選択のため合計100%にはなりません/);
  const sum = q.tally.reduce((n, c) => n + Math.round((c.count * 100) / q.answeredCount), 0);
  assert.ok(sum > 100, '選択肢の割合の合計は 100% を超えうる');
  const lines = [...card.querySelectorAll('.opt-num')].map((n) => n.textContent);
  assert.ok(lines.length === q.tally.length);
});

test('Dashboard（#426）：question ID は通常表示に出さず、公開条件の詳細（details）の中にだけ置く', () => {
  const { document, summary } = renderDashboard(fixtureRows());
  const cards = [...document.querySelectorAll('#results > .card')];
  cards.forEach((card) => {
    const visible = [...card.childNodes].filter((n) => !(n.nodeName === 'DETAILS')).map((n) => n.textContent).join(' ');
    assert.ok(!/question_id|\[[a-z_]+\]/.test(visible), card.querySelector('h3').textContent);
    const details = card.querySelector('details');
    assert.equal(details.hasAttribute('open'), false, '折りたたみ');
    assert.match(details.textContent, /question_id/);
    const internal = summary.internalQuestions.some((q) => q.label === card.querySelector('h3').textContent);
    ['minTotal', 'minTarget', 'minCell', 'Tier'].forEach((k) => assert.equal(details.textContent.includes(k), !internal, k)); // 対象外設問に公開条件は付けない
  });
  const region = summary.questions.find((x) => x.id === 'region_blocks');
  assert.equal(region.type, 'region');
  assert.ok(cards.some((c) => c.querySelector('h3').textContent === region.label));
  assert.ok(!/\[region_blocks\]|\[baseball_experience\]/.test(document.body.textContent));
});

test('Dashboard（#426）：公開判定ビューは definition list のカード（table なし）で、障壁も設問名で表示する', () => {
  const { document, summary, html } = renderDashboard(fixtureRows());
  assert.equal(document.querySelectorAll('#publication > .card').length, summary.questions.length);
  const first = document.querySelector('#publication > .card dl.facts').textContent;
  ['公開状態', '対象数', 'minTotal', 'minTarget', 'minCell', 'Tier'].forEach((k) => assert.ok(first.includes(k), k));
  assert.equal(document.querySelectorAll('table').length, 0);
  assert.ok(!/<table|overflow-x\s*:\s*(auto|scroll)|white-space\s*:\s*nowrap\s*;[^}]*th/.test(html.replace(/\.opt-num[^}]*}/, '')), '横スクロールを生む table / overflow-x を使わない');
  const semanticText = document.getElementById('semantic').textContent;
  assert.ok(!/participation_conditions|\bbarriers\b/.test(semanticText.replace(/code: [a-z_]+/g, '')), '設問 ID を主表示にしない');
});

test('Dashboard（#426）：スマホ幅（320〜430px）で横スクロールを生まない CSS（折り返し・min-width:0・可変グリッド）', () => {
  const html = fs.readFileSync(path.join(adminDir, 'Dashboard.html'), 'utf8');
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.match(html, /name="viewport"|width=device-width/);
  assert.match(css, /overflow-wrap\s*:\s*anywhere/);
  assert.ok(!/overflow-x/.test(css));
  assert.ok(!/\bwidth\s*:\s*\d{3,}px|min-width\s*:\s*(?:[3-9]\d\d|\d{4,})px/.test(css), '320px を超える固定幅を使わない');
  [...css.matchAll(/minmax\((\d+)px/g)].forEach((m) => assert.ok(Number(m[1]) <= 140, 'grid の最小幅は 320px で 2 列以上入る値'));
  assert.match(css, /\.card\s*\{[^}]*min-width\s*:\s*0/);
});

test('Dashboard（#426）：上部サマリー（production・test・除外・version 互換認識・snapshot 状態）と診断の折りたたみ', () => {
  const ok = answersFor({});
  const rows = [rowFor(ok), rowFor(ok, { survey_version: 46296 }), rowFor(ok, { response_mode: 'test', test_run_id: 'r' }), rowFor(ok, { schema_version: '2' })];
  const { document } = renderDashboard(rows);
  const top = document.querySelector('#totals .kpis').textContent;
  assert.match(top, /production 有効回答2 件/);
  assert.match(top, /test 回答1 件/);
  assert.match(top, /除外1 件/);
  assert.match(top, /version 互換認識1 件/);
  assert.match(document.getElementById('totals').textContent, /snapshot: 更新(可|不要)/);
  const det = document.querySelector('#totals details');
  assert.equal(det.hasAttribute('open'), false);
  assert.match(det.textContent, /legacy_date_serial_accepted/);
  assert.match(det.textContent, /version_mismatch の内訳/);
  const none = renderDashboard(rowsFrom([{ count: 2, overrides: {} }])).document.querySelector('#totals .kpis').textContent;
  assert.ok(!/version 互換認識/.test(none), '0 件のときは出さない');
});

test('Dashboard（#426）：集計カードに自由記述本文・hash・Spreadsheet ID を出さず、自由記述は専用タブのまま', () => {
  const rows = fixtureRows();
  const { document, summary, html } = renderDashboard(rows);
  const cardsText = document.getElementById('results').textContent + document.getElementById('publication').textContent + document.getElementById('semantic').textContent;
  assert.ok(!cardsText.includes('ADMIN-ONLY-TEXT'));
  rows.forEach((r) => assert.ok(!cardsText.includes(r.respondent_hash)));
  assert.ok(!cardsText.includes('SPREADSHEET'), 'Spreadsheet ID を出さない');
  assert.ok(!JSON.stringify(summary).includes('ADMIN-ONLY-TEXT'));
  assert.equal(document.querySelector('[data-tab="freetext"]').textContent, '自由記述（運営者のみ）');
  assert.equal(document.getElementById('tab-freetext').hidden, true);
  assert.deepEqual([...document.querySelectorAll('[data-tab]')].map((b) => b.getAttribute('data-tab')), ['results', 'publication', 'semantic', 'funnel', 'cross', 'snapshot', 'freetext']);
  assert.ok(!/innerHTML|respondent_hash/.test(html));
});

test('summary（#426）：type / answeredCount を追加しても公開判定・public preview（snapshot）は変わらない', () => {
  const rows = fixtureRows();
  const classification = aggregate.classifyRows(schema, rows);
  const summary = aggregate.buildAdminSummary(schema, classification, { now: NOW });
  assert.deepEqual(summary.publicPreview, aggregate.buildSnapshot(schema, classification.valid, { generatedAt: NOW }));
  summary.questions.forEach((q) => {
    assert.ok(['single', 'single_dynamic', 'multiple', 'scale', 'region'].includes(q.type), q.id);
    assert.ok(q.answeredCount <= q.targetCount, q.id);
    const pub = summary.publicPreview.questions.find((x) => x.id === q.id);
    assert.equal(pub.state, q.publicState);
    if (pub.state !== 'published') assert.equal(pub.targetCount, null, '非公開のとき public 側は件数を含まない');
  });
});

test('Dashboard（#426 レビュー）：公開対象外の non-text 設問も Admin 内部集計に含め「一般公開: 対象外」。自由記述は含めない', () => {
  const rows = rowsFrom([{ count: 12, overrides: Object.assign({ feedback: 'ADMIN-ONLY-TEXT' }, INTERESTED) }]);
  const { document, summary } = renderDashboard(rows);
  const publicIds = new Set(aggregate.publicEntries(schema).map((e) => e.id));
  const expected = core.getQuestions(schema).filter((q) => q.type !== 'text' && !publicIds.has(q.id)).map((q) => q.id);
  assert.deepEqual(summary.internalQuestions.map((q) => q.id), expected);
  ['age', 'prefecture', 'aichi_area'].forEach((id) => assert.ok(expected.includes(id), id));
  assert.ok(summary.internalQuestions.every((q) => q.type !== 'text' && q.publicState === 'not_public'));
  const cards = [...document.querySelectorAll('#results > .card')];
  assert.equal(cards.length, summary.questions.length + expected.length);
  const age = summary.internalQuestions.find((q) => q.id === 'age');
  const card = cards.find((c) => c.querySelector('h3').textContent === age.label);
  assert.match(card.querySelector('.meta').textContent, /一般公開: 対象外/);
  assert.match(card.querySelector('details').textContent, /question_id/);
  assert.ok(!/\[age\]/.test(card.textContent.replace(card.querySelector('details').textContent, '')));
  assert.ok(age.tally.some((c) => c.count > 0), '回答があれば件数が出る');
  const visible = document.getElementById('results').textContent;
  assert.ok(!visible.includes('ADMIN-ONLY-TEXT'));
  assert.equal(document.querySelectorAll('#publication > .card').length, summary.questions.length, '公開判定タブに対象外設問は混ぜない');
  assert.equal(document.querySelectorAll('table').length, 0);
});

test('summary（#426 レビュー）：公開対象外設問は publicPreview / snapshot に一切出ず、snapshot 検証も通る', () => {
  const rows = fixtureRows();
  const classification = aggregate.classifyRows(schema, rows);
  const summary = aggregate.buildAdminSummary(schema, classification, { now: NOW });
  const publicIds = new Set(aggregate.publicEntries(schema).map((e) => e.id));
  assert.deepEqual(summary.questions.map((q) => q.id), [...publicIds]);
  assert.deepEqual(summary.publicPreview, aggregate.buildSnapshot(schema, classification.valid, { generatedAt: NOW }));
  assert.deepEqual(aggregate.validateSnapshot(schema, summary.publicPreview), []);
  const previewText = JSON.stringify(summary.publicPreview);
  summary.internalQuestions.forEach((q) => assert.ok(!previewText.includes(`"${q.id}"`), q.id));
  const snapshot = JSON.parse(plain(createAdminEnv(rows).ctx.getSnapshot()).snapshotJson);
  summary.internalQuestions.forEach((q) => assert.ok(!JSON.stringify(snapshot).includes(`"${q.id}"`), q.id));
  assert.ok(!JSON.stringify(summary).includes('ADMIN-ONLY-TEXT'));
});

/* ── Issue #436：「その他」自由記述の展開・都道府県降順・応援メッセージ属性 ── */

const otherRows = () => {
  const withOther = (extra, others) => rowFor(answersFor(Object.assign({ favorite_uniforms: ['baseball', 'other'] }, INTERESTED, extra)), {}, others);
  return [
    withOther({}, { favorite_uniforms: 'OTHER-A <b>bold</b>' }),
    withOther({}, { favorite_uniforms: 'OTHER-B' }),
    rowFor(answersFor(Object.assign({ favorite_uniforms: ['baseball'] }, INTERESTED))),
    rowFor(answersFor(Object.assign({ favorite_uniforms: ['baseball', 'other'], uniform_appeal: ['other'] }, INTERESTED)), {}, { favorite_uniforms: 'OTHER-C', uniform_appeal: 'OTHER-APPEAL' })
  ];
};

test('#436：getAdminSummary は「その他」の件数だけ返し、本文を含めない（lazy-load 前）', () => {
  const env = createAdminEnv(otherRows());
  const summary = plain(env.ctx.getAdminSummary());
  const all = summary.questions.concat(summary.internalQuestions);
  assert.equal(all.find((q) => q.id === 'favorite_uniforms').otherTextCount, 3);
  assert.ok(all.every((q) => Number.isInteger(q.otherTextCount)));
  assert.ok(all.some((q) => q.otherTextCount === 0));
  assert.ok(!JSON.stringify(summary).includes('OTHER-'));
});

test('#436：getOtherTexts(questionId) はその設問の「その他」本文だけを返し、個票の識別情報・他設問の本文を含めない', () => {
  const env = createAdminEnv(otherRows());
  const result = plain(env.ctx.getOtherTexts('favorite_uniforms'));
  assert.deepEqual(Object.keys(result).sort(), ['questionId', 'texts']);
  assert.deepEqual(result.texts, ['OTHER-A <b>bold</b>', 'OTHER-B', 'OTHER-C']);
  const json = JSON.stringify(result);
  assert.ok(!json.includes('OTHER-APPEAL'));
  otherRows().forEach((r) => assert.ok(!json.includes(r.respondent_hash)));
  assert.ok(!/timestamp|respondent_hash|test_run_id|source_channel|2026-11-10/.test(json));
  assert.deepEqual(plain(env.ctx.getOtherTexts('uniform_appeal')).texts, ['OTHER-APPEAL']);
  assert.deepEqual(plain(env.ctx.getOtherTexts('age')).texts, []);
  assert.throws(() => env.ctx.getOtherTexts('no_such_question'), /invalid_request/);
  assert.throws(() => env.ctx.getOtherTexts(undefined), /invalid_request/);
  assert.deepEqual(env.writes, []);
});

test('#436：getOtherTexts は回答順で並ばない（本文の昇順）', () => {
  const rows = ['Z', 'M', 'A'].map((t) => rowFor(answersFor(Object.assign({ favorite_uniforms: ['baseball', 'other'] }, INTERESTED)), {}, { favorite_uniforms: t }));
  assert.deepEqual(plain(createAdminEnv(rows).ctx.getOtherTexts('favorite_uniforms')).texts, ['A', 'M', 'Z']);
});

test('#436 Dashboard：「その他」が 1 件以上の設問だけ折りたたみを出し、初回展開時のみ取得・以後は再利用・textContent で描画', () => {
  const env = createAdminEnv(otherRows());
  let calls = [];
  const { document } = renderDashboard(otherRows(), { getOtherTexts: (id) => { calls.push(id); return plain(env.ctx.getOtherTexts(id)); } });
  const cards = [...document.querySelectorAll('#results > .card')];
  const withDetails = cards.filter((c) => c.querySelector('details.other-texts'));
  assert.deepEqual(withDetails.map((c) => c.querySelector('details.other-texts summary').textContent).sort(), ['その他の自由記述 1件', 'その他の自由記述 3件']);
  assert.ok(cards.length > withDetails.length, '0 件の設問には展開 UI を出さない');
  assert.equal(calls.length, 0);
  assert.ok(!document.getElementById('results').textContent.includes('OTHER-'));
  const card = withDetails.find((c) => c.querySelector('summary').textContent === 'その他の自由記述 3件');
  const details = card.querySelector('details.other-texts');
  const open = () => { details.open = !details.open; details.dispatchEvent(new document.defaultView.Event('toggle')); };
  open(); open(); open();
  assert.deepEqual(calls, ['favorite_uniforms']);
  assert.deepEqual([...details.querySelectorAll('li')].map((li) => li.textContent), ['OTHER-A <b>bold</b>', 'OTHER-B', 'OTHER-C']);
  assert.equal(details.querySelector('b'), null, 'HTML として解釈しない');
  assert.ok(!card.textContent.includes('OTHER-APPEAL'));
});

const prefSpecs = () => {
  const row = (pref, n) => ({ count: n, overrides: Object.assign({ prefecture: pref, aichi_area: pref === 'pref_23' ? 'nagoya' : undefined, residence_country: pref === 'overseas' ? 'X' : undefined }, INTERESTED) });
  return rowsFrom([row('pref_13', 2), row('pref_23', 3), row('pref_27', 2), row('overseas', 3), row('prefer_not_to_say', 1)]);
};

test('#436：Admin の都道府県 tally は件数降順（同数は schema 順・0 件も末尾に残す）。canonical な defs は並べ替えない', () => {
  const env = createAdminEnv(prefSpecs());
  const summary = plain(env.ctx.getAdminSummary());
  const pref = summary.internalQuestions.find((q) => q.id === 'prefecture');
  const ids = pref.tally.map((c) => c.id);
  assert.deepEqual(ids.slice(0, 5), ['pref_23', 'overseas', 'pref_13', 'pref_27', 'prefer_not_to_say']);
  const schemaOrder = schema.questions.find((q) => q.id === 'prefecture').options.map((o) => o.id);
  assert.equal(ids.length, schemaOrder.length);
  const zero = ids.slice(5);
  assert.deepEqual(zero, schemaOrder.filter((id) => zero.includes(id)));
  assert.ok(pref.tally.slice(5).every((c) => c.count === 0));
  assert.equal(aggregate.tallyQuestion(schema, schema.questions.find((q) => q.id === 'prefecture'), []).defs[0].id, schemaOrder[0]);
});

test('#436：Public 側（snapshot の地域）は順序・内容が変わらない（Admin 降順の影響を受けない）', () => {
  const env = createAdminEnv(prefSpecs());
  const summary = plain(env.ctx.getAdminSummary());
  const valid = aggregate.classifyRows(schema, prefSpecs()).valid;
  assert.deepEqual(summary.publicPreview, plain(aggregate.buildSnapshot(schema, valid, { generatedAt: new Date(summary.publicPreview.generated_at) })));
  assert.ok(!JSON.stringify(summary.publicPreview).includes('pref_'));
});

const supportRow = (overrides, text) => rowFor(answersFor(Object.assign({ support_message: text }, INTERESTED, overrides)));

/* ── Issue #438：Admin 自由記述一覧の全項目に「 （都道府県・国・年代）」を付与 ── */

const attrRow = (overrides, free, others) => rowFor(answersFor(Object.assign({ favorite_uniforms: others && others.favorite_uniforms ? ['baseball', 'other'] : ['baseball'] }, INTERESTED, free, overrides)), {}, others);
const freeTextOf = (rows) => plain(createAdminEnv(rows).ctx.getFreeText());

test('#438：feedback / support_message に本文末尾へ「 （都道府県・国・年代）」を表示ラベルで添える（raw ID・詳細居住地なし）', () => {
  const items = freeTextOf([attrRow({ prefecture: 'pref_23', aichi_area: 'nagoya', age: '40_49' }, { feedback: 'FB', support_message: 'また参加したいです。' })]);
  assert.equal(items.find((i) => i.questionId === 'support_message').text, 'また参加したいです。 （愛知県・日本・40〜49歳）');
  assert.equal(items.find((i) => i.questionId === 'feedback').text, 'FB （愛知県・日本・40〜49歳）');
  items.forEach((i) => {
    assert.ok(!/pref_23|40_49|nagoya|名古屋市/.test(i.text), i.text);
    assert.deepEqual(Object.keys(i).sort().filter((k) => k !== 'kind'), ['label', 'questionId', 'text']);
  });
});

test('#438：「その他」の自由記述（other_texts）の全項目にも同形式で付く', () => {
  const rows = [attrRow({ prefecture: 'pref_01', age: '25_29', uniform_appeal: ['other'] }, {}, { favorite_uniforms: 'OTHER-F', uniform_appeal: 'OTHER-A' })];
  const others = freeTextOf(rows).filter((i) => i.kind === 'other');
  assert.deepEqual(others.map((i) => i.text).sort(), ['OTHER-A （北海道・日本・25〜29歳）', 'OTHER-F （北海道・日本・25〜29歳）']);
});

test('#438：海外は residence_country の保存原文、回答しない・未回答は国を推測せず「未回答」。同一 row 内だけで紐付ける', () => {
  const rows = [
    attrRow({ prefecture: 'overseas', residence_country: '韓国', age: '30_39' }, { support_message: 'M1' }),
    attrRow({ prefecture: 'prefer_not_to_say', age: 'prefer_not_to_say' }, { support_message: 'M2' }),
    attrRow({ prefecture: 'pref_27', age: '18_24' }, { support_message: 'M3' })
  ];
  const texts = freeTextOf(rows).filter((i) => i.questionId === 'support_message').map((i) => i.text);
  assert.deepEqual(texts, ['M1 （海外・韓国・30〜39歳）', 'M2 （回答しない・未回答・回答しない）', 'M3 （大阪府・日本・18〜24歳）']);
  const classified = aggregate.classifyRows(schema, [attrRow({ prefecture: 'overseas', residence_country: '韓国', age: '30_39' }, { support_message: 'M4' })]);
  const record = classified.valid[0];
  const text = () => aggregate.listFreeText(schema, classified).find((i) => i.questionId === 'support_message').text;
  delete record.free_text.residence_country;
  assert.equal(text(), 'M4 （海外・未回答・30〜39歳）');
  record.free_text.residence_country = '  ';
  assert.equal(text(), 'M4 （海外・未回答・30〜39歳）');
  delete record.answers.prefecture;
  delete record.answers.age;
  assert.equal(text(), 'M4 （未回答・未回答・未回答）');
  record.answers.age = 'bogus_id';
  assert.equal(text(), 'M4 （未回答・未回答・未回答）');
});

test('#438：属性は schema の adminFreeTextAttribution で決まり、無ければ付かない。getOtherTexts（lazy-load）・snapshot・summary には波及せず hash/timestamp も返さない', () => {
  const rows = [attrRow({ prefecture: 'pref_23', aichi_area: 'nagoya', age: '40_49' }, { support_message: 'SUPPORT-X', feedback: 'FEEDBACK-X' }, { favorite_uniforms: 'OTHER-X' })];
  const env = createAdminEnv(rows);
  const items = plain(env.ctx.getFreeText());
  assert.ok(items.length >= 3 && items.every((i) => i.text.endsWith(' （愛知県・日本・40〜49歳）')));
  assert.deepEqual(plain(env.ctx.getOtherTexts('favorite_uniforms')).texts, ['OTHER-X']);
  const outputs = JSON.stringify(items) + JSON.stringify(env.ctx.getAdminSummary()) + JSON.stringify(env.ctx.getSnapshot());
  assert.ok(!outputs.includes(rows[0].respondent_hash) && !JSON.stringify(items).includes('2026-11-10'));
  assert.ok(!JSON.stringify(env.ctx.getAdminSummary()).includes('SUPPORT-X') && !JSON.stringify(env.ctx.getSnapshot()).includes('SUPPORT-X'));
  assert.ok(!JSON.stringify(env.ctx.getSnapshot()).includes('日本'));
  assert.ok(!sources().find((s) => s.name === 'Snapshot.gs').code.includes('getOtherTexts'));
  const bare = Object.assign({}, schema);
  delete bare.adminFreeTextAttribution;
  assert.equal(aggregate.listFreeText(bare, aggregate.classifyRows(schema, rows))[0].text.includes('（'), false);
});

test('#436 Dashboard：応援メッセージは getFreeText の本文末尾の属性ごと textContent で表示し、カード内の自由記述 UI も横スクロールを生まない', () => {
  const items = [{ questionId: 'support_message', label: 'L', text: '<i>応援</i> （愛知県・40〜49歳）' }];
  const { document, html } = renderDashboard(fixtureRows(), { getFreeText: items });
  document.getElementById('loadText').click();
  const li = document.querySelector('#texts li');
  assert.equal(li.textContent, 'L：<i>応援</i> （愛知県・40〜49歳）');
  assert.equal(li.querySelector('i'), null);
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.match(css, /\.other-list\s*\{[^}]*white-space\s*:\s*pre-wrap/);
  assert.ok(!/overflow-x/.test(css));
});
