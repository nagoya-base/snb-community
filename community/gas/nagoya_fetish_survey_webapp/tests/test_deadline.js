'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Issue #319：サーバー側の締切判定（submitSurvey / checkSubmissionStatus）と、
// 締切内有効回答だけの確定スナップショット（responses_valid）の検証。

const code = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');

let failures = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failures++; } else { console.log('OK:', msg); }
}

const JST = (s) => new Date(s + '+09:00');

function freshSandbox(clock) {
  // new Date() だけを制御できる Date（引数ありは本物の Date と同じ挙動）。
  class FakeDate extends Date {
    constructor(...args) { if (args.length === 0) { super(clock.now.getTime()); } else { super(...args); } }
  }
  const sandbox = {
    console, Date: FakeDate,
    PropertiesService: { getScriptProperties: () => { throw new Error('PropertiesService must not be touched'); } },
    SpreadsheetApp: {}, LockService: {}, CacheService: {},
    Utilities: {}, HtmlService: {}, ContentService: {},
    Logger: { log: () => {} }
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox;
}

/* ── 締切の境界（23:59:59.999 JSTは受付中、翌00:00:00.000 JSTから締切済み） ── */
{
  const sb = freshSandbox({ now: new Date() });
  assert(sb.isSurveyClosed_(JST('2026-09-30T23:59:59.999')) === false, '2026-09-30 23:59:59.999 JST はまだ受付中');
  assert(sb.isSurveyClosed_(JST('2026-10-01T00:00:00.000')) === true, '2026-10-01 00:00:00.000 JST は締切済み');
  assert(sb.isSurveyClosed_(JST('2026-09-15T12:00:00.000')) === false, '期限前の正当な回答時刻は受付中');
  // UTC換算でも同じ瞬間を指す（タイムゾーン依存でないこと）
  assert(sb.isSurveyClosed_(new Date('2026-09-30T14:59:59.999Z')) === false && sb.isSurveyClosed_(new Date('2026-09-30T15:00:00.000Z')) === true,
    '判定はUTC換算の15:00:00Zを境にする（実行環境のタイムゾーンに依存しない）');
}

/* ── submitSurvey：締切後は入力検証・シート・ロックに触れる前に CLOSED ── */
{
  const clock = { now: JST('2026-10-01T00:00:01') };
  const sb = freshSandbox(clock);
  sb.LockService = { getScriptLock: () => { throw new Error('lock must not be touched after the deadline'); } };
  let appended = 0;
  sb.appendResponseRow_ = () => { appended++; };
  const r1 = sb.submitSurvey('not-a-uuid', {});
  assert(r1 && r1.status === 'CLOSED', '締切後は不正な入力でも CLOSED を返す（検証より先に拒否）, got ' + JSON.stringify(r1));
  const r2 = sb.submitSurvey('11111111-1111-4111-8111-111111111111', { prefecture: '愛知県' });
  assert(r2 && r2.status === 'CLOSED', '締切後は形式上有効なUUID＋回答でも CLOSED');
  assert(appended === 0, '締切後は1行も保存されない');
  const st = sb.checkSubmissionStatus('11111111-1111-4111-8111-111111111111');
  assert(st && st.closed === true && st.answered === false, 'checkSubmissionStatus は締切後 closed:true を返す');
}

/* ── submitSurvey：締切前は従来どおり（不正UUIDはERROR、有効なら保存） ── */
{
  const clock = { now: JST('2026-09-30T23:59:00') };
  const sb = freshSandbox(clock);
  assert(sb.submitSurvey('bad', {}).status === 'ERROR', '締切前の不正UUIDは従来どおり ERROR');

  const saved = [];
  sb.validateAnswers_ = () => null;
  sb.getResponsesSheet_ = () => ({});
  sb.hashUuid_ = () => 'h';
  sb.isDuplicateHash_ = () => false;
  sb.invalidatePublicResultsCache_ = () => {};
  sb.appendResponseRow_ = (sheet, hash, answers, ts) => { saved.push(ts); };
  sb.LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) };
  const ok = sb.submitSurvey('11111111-1111-4111-8111-111111111111', {});
  assert(ok.status === 'SUCCESS' && saved.length === 1, '締切前(23:59:00)の正当な回答は受理・保存される');
  assert(saved[0] instanceof Date && saved[0].getTime() === clock.now.getTime(), '保存タイムスタンプは判定に使った時刻と同一');
}

/* ── ロック待機中に締切を跨いだ回答は保存しない ── */
{
  const clock = { now: JST('2026-09-30T23:59:59.000') };
  const sb = freshSandbox(clock);
  let appended = 0;
  sb.validateAnswers_ = () => null;
  sb.getResponsesSheet_ = () => ({});
  sb.hashUuid_ = () => 'h';
  sb.isDuplicateHash_ = () => false;
  sb.appendResponseRow_ = () => { appended++; };
  sb.LockService = {
    getScriptLock: () => ({
      tryLock: () => { clock.now = JST('2026-10-01T00:00:03.000'); return true; }, // 待機中に締切を過ぎる
      releaseLock: () => {}
    })
  };
  const r = sb.submitSurvey('11111111-1111-4111-8111-111111111111', {});
  assert(r.status === 'CLOSED' && appended === 0, 'ロック待機で締切を跨いだ送信は CLOSED となり保存されない');
}

/* ── filterDeadlineValidRows_：締切内のみ残し、個別情報列は複製しない ── */
{
  const sb = freshSandbox({ now: JST('2026-10-01T09:00:00') });
  const C = sb.COLUMNS;
  const mk = (ts, extra) => {
    const row = new Array(C.length).fill('');
    row[0] = ts;
    row[C.indexOf('respondent_hash')] = 'HASHVALUE';
    row[C.indexOf('free_comment')] = '自由記述の本文';
    row[C.indexOf('completion_stage')] = 'no_gate_reached';
    Object.keys(extra || {}).forEach((k) => { row[C.indexOf(k)] = extra[k]; });
    return row;
  };
  const values = [
    mk(JST('2026-09-01T10:00:00')),
    mk(JST('2026-09-30T23:59:59.500')),        // 有効（境界内）
    mk(JST('2026-10-01T00:00:00.000')),        // 締切後
    mk(JST('2026-10-01T08:00:00')),            // 締切後
    mk('壊れた日時'),                           // 解釈不能 → 公開に入れない
    mk(''),                                     // 空行 → 回答行ではない
    mk(JST('2026-09-10T10:00:00'), { completion_stage: '' }) // 旧回答（有効行だが新アンケートではない）
  ];
  const { rows, stats } = sb.filterDeadlineValidRows_(values);
  assert(rows.length === 3 && stats.validRows === 3, '有効行は締切内の3行のみ, got ' + rows.length);
  assert(stats.lateRows === 2, '締切後の行は2行として別集計, got ' + stats.lateRows);
  assert(stats.unparseableRows === 1, '解釈不能なtimestampは1行として別集計（公開数値に入れない）');
  assert(stats.responseRows === 6, '回答行数（空行除く）は6, got ' + stats.responseRows);
  assert(stats.validNewSurveyRows === 2, '有効な新アンケート回答（completion_stageあり）は2行, got ' + stats.validNewSurveyRows);
  assert(rows.every((r) => r[C.indexOf('respondent_hash')] === '' && r[C.indexOf('free_comment')] === ''),
    '有効行でも respondent_hash・free_comment は複製しない');
  assert(values[0][C.indexOf('respondent_hash')] === 'HASHVALUE', '入力（responses相当）の行は書き換えない');
}

/* ── buildDeadlineValidSnapshot_：responsesは読み取りのみ、responses_validを作り直す ── */
{
  const sb = freshSandbox({ now: JST('2026-10-01T09:00:00') });
  const C = sb.COLUMNS;
  const row = (ts) => { const r = new Array(C.length).fill(''); r[0] = ts; r[C.indexOf('completion_stage')] = 'x'; return r; };
  const data = [row(JST('2026-09-20T10:00:00')), row(JST('2026-10-01T01:00:00'))];
  let sourceWrites = 0;
  const source = {
    getLastRow: () => data.length + 1,
    getLastColumn: () => C.length,
    getRange: (r) => ({ getValues: () => (r === 1 ? [C] : data), setValues: () => { sourceWrites++; }, setValue: () => { sourceWrites++; }, clearContent: () => { sourceWrites++; } }),
    clear: () => { sourceWrites++; }, appendRow: () => { sourceWrites++; }
  };
  const written = { header: null, rows: null, deleted: [] };
  const oldValid = { name: 'old' };
  const target = {
    getRange: (r, c, nr) => ({ setValues: (v) => { if (r === 1) written.header = v[0]; else written.rows = v; } }),
    setFrozenRows: () => {}
  };
  const ss = {
    getSheetByName: (n) => n === 'responses' ? source : n === 'responses_valid' ? oldValid : null,
    deleteSheet: (s) => written.deleted.push(s),
    insertSheet: (n) => { assert(n === 'responses_valid', 'insertSheet creates responses_valid'); return target; }
  };
  const stats = sb.buildDeadlineValidSnapshot_(ss, JST('2026-10-01T09:00:00'));
  assert(sourceWrites === 0, 'responsesシートには一切書き込まない');
  assert(written.deleted[0] === oldValid, '既存のresponses_validは作り直される（べき等）');
  assert(JSON.stringify(written.header) === JSON.stringify(C), 'スナップショットのヘッダーはCOLUMNSと一致');
  assert(written.rows.length === 1, 'スナップショットには締切内の1行のみ入る');
  assert(stats.validRows === 1 && stats.lateRows === 1 && stats.closed === true, 'stats: valid=1, late=1, closed=true');
}

/* ── 集計式・公開結果の参照先は responses_valid（responses直参照が残っていないこと） ── */
{
  const sb = freshSandbox({ now: new Date() });
  assert(sb.respQueryRange_().indexOf("'responses_valid'!") === 0, 'respQueryRange_ は responses_valid を参照');
  assert(sb.respColRange_('B').indexOf("'responses_valid'!") === 0, 'respColRange_ は responses_valid を参照');
  const publicFn = code.slice(code.indexOf('function getPublicResults()'), code.indexOf('function invalidatePublicResultsCache_'));
  assert(publicFn.indexOf('getResponsesSheet_()') === -1 && publicFn.indexOf('getDeadlineValidSheet_') !== -1,
    'getPublicResults() は responses ではなくスナップショットを読む');
}

/* ── finalizeSurveyResults：締切前は実行できない ── */
{
  const sb = freshSandbox({ now: JST('2026-09-30T12:00:00') });
  let threw = false;
  try { sb.finalizeSurveyResults(); } catch (e) { threw = true; }
  assert(threw, '締切前は finalizeSurveyResults() がエラーになる（未確定値を最終化させない）');
}


/* ── 共通フェイク：スプレッドシート ── */
// どのメソッド呼び出しも受け付ける（集計_*シート用）。
const anyThing = () => new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : anyThing()), apply: () => anyThing() });

function makeEnv(clock, opts) {
  opts = opts || {};
  const sb = freshSandbox(clock);
  const C = sb.COLUMNS;
  const writes = []; // responsesへの書き込み試行（空であるべき）
  const respGrid = [C].concat(opts.rows || []);
  const guard = (name) => () => { writes.push(name); throw new Error('responses must be read-only: ' + name); };
  const responses = {
    getLastRow: () => respGrid.length,
    getLastColumn: () => C.length,
    getMaxRows: () => 1000,
    getRange: (r, c, nr, nc) => ({
      getValues: () => respGrid.slice(r - 1, r - 1 + (nr || 1)).map((row) => row.slice(c - 1, c - 1 + (nc || 1))),
      getValue: () => (respGrid[r - 1] || [])[c - 1] || '',
      setValue: guard('setValue'), setValues: guard('setValues'), setFormula: guard('setFormula'),
      setFormulas: guard('setFormulas'), clearContent: guard('clearContent'), clear: guard('clear'),
      setFontWeight: guard('setFontWeight')
    }),
    appendRow: guard('appendRow'), clear: guard('clear'), clearContents: guard('clearContents'),
    setFrozenRows: guard('setFrozenRows'), insertColumnAfter: guard('insertColumnAfter'), deleteRows: guard('deleteRows')
  };
  let valid = opts.validSheetExists ? makeGridSheet(C) : null;
  const created = [];
  const ss = {
    getSheetByName: (n) => (n === 'responses' ? responses : n === 'responses_valid' ? valid : null),
    deleteSheet: (sheet) => { if (sheet === valid) valid = null; },
    insertSheet: (n) => {
      if (n === 'responses_valid') { valid = makeGridSheet(C); return valid; }
      if (opts.failOnInsert && n === opts.failOnInsert) throw new Error('simulated failure inserting ' + n);
      created.push(n); return anyThing();
    }
  };
  const cacheStore = {};
  const cacheCalls = { get: 0, put: 0, remove: 0 };
  sb.CacheService = { getScriptCache: () => ({
    get: (k) => { cacheCalls.get++; return cacheStore[k] || null; },
    put: (k, v) => { cacheCalls.put++; cacheStore[k] = v; },
    remove: (k) => { cacheCalls.remove++; delete cacheStore[k]; }
  }) };
  const props = { SPREADSHEET_ID: 'SSID' };
  if (opts.finalizedMarker) props.SURVEY_RESULTS_FINALIZED_AT = '2026-10-01T00:00:00.000Z';
  sb.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => (k in props ? props[k] : null),
    setProperty: (k, v) => { props[k] = v; },
    deleteProperty: (k) => { delete props[k]; }
  }) };
  const flushCalls = [];
  sb.SpreadsheetApp = { openById: () => ss, flush: () => { flushCalls.push(true); } };
  return { sb, C, ss, props, flushCalls, writes, cacheStore, cacheCalls, created, getValid: () => valid };
}

function makeGridSheet(C) {
  const grid = [];
  return {
    _grid: grid,
    getLastRow: () => grid.length,
    getLastColumn: () => C.length,
    setFrozenRows: () => {},
    getRange: (r, c, nr, nc) => ({
      setValues: (v) => { v.forEach((row, i) => { grid[r - 1 + i] = row.slice(); }); },
      getValues: () => grid.slice(r - 1, r - 1 + nr).map((row) => row.slice(c - 1, c - 1 + nc))
    })
  };
}

/* ── キャッシュ防止：古いキャッシュがあっても、responses_validが無ければ返さずエラー ── */
{
  const env = makeEnv({ now: JST('2026-10-01T09:00:00') }, { validSheetExists: false, finalizedMarker: true });
  env.cacheStore['publicResultsV1'] = JSON.stringify({ total: 999, ready: true, stale: true });
  let result = null, error = null;
  try { result = env.sb.getPublicResults(); } catch (e) { error = e; }
  assert(result === null, '古いキャッシュ＋responses_validなし：古いキャッシュを返さない');
  assert(error && /finalizeSurveyResults/.test(error.message), 'エラーでfinalizeSurveyResults()の未実施を案内する, got ' + (error && error.message));
  assert(env.cacheCalls.get === 0, 'responses_validの存在確認はキャッシュ参照より前（cache.getを呼んでいない）');
  assert(env.cacheCalls.put === 0, 'エラー時はキャッシュへ書き込まない');
}

/* ── responses_validがあれば従来どおりキャッシュを使う／無ければ作ってキャッシュする ── */
{
  const env = makeEnv({ now: JST('2026-10-01T09:00:00') }, { validSheetExists: true, finalizedMarker: true });
  env.cacheStore['publicResultsV1'] = JSON.stringify({ total: 7, ready: false, fromCache: true });
  const r = env.sb.getPublicResults();
  assert(r.fromCache === true, 'responses_validがある場合はキャッシュ値を返す');
  delete env.cacheStore['publicResultsV1'];
  const r2 = env.sb.getPublicResults();
  assert(r2.total === 0 && env.cacheCalls.put === 1, 'キャッシュ無し：スナップショットから集計してキャッシュへ保存する');
}

/* ── finalizeSurveyResults：responsesへ一切書き込まず、確定件数を返す ── */
{
  const clock = { now: JST('2026-10-01T09:00:00') };
  const probe = freshSandbox(clock);
  const C = probe.COLUMNS;
  const mk = (ts, stage) => { const r = new Array(C.length).fill(''); r[0] = ts; r[C.indexOf('respondent_hash')] = 'H'; r[C.indexOf('free_comment')] = '自由記述'; r[C.indexOf('completion_stage')] = stage; return r; };
  const rows = [
    mk(JST('2026-09-20T10:00:00'), 'no_gate_reached'),
    mk(JST('2026-09-30T23:59:59.999'), 'no_gate_reached'),
    mk(JST('2026-10-01T00:00:00.000'), 'no_gate_reached'),
    mk(JST('2026-09-10T10:00:00'), '') // 旧回答
  ];
  const env = makeEnv(clock, { rows, validSheetExists: false });
  env.cacheStore['publicResultsV1'] = JSON.stringify({ total: 999, stale: true });
  const stats = env.sb.finalizeSurveyResults();
  assert(env.writes.length === 0, 'finalizeSurveyResults()中、responsesへのsetValue/setValues/setFormula/clear/appendRow等の書き込みが0件, got ' + JSON.stringify(env.writes));
  assert(stats.validRows === 3 && stats.lateRows === 1 && stats.validNewSurveyRows === 2, '件数内訳: valid=3(旧1含む)/late=1/validNew=2, got ' + JSON.stringify(stats));
  assert(stats.publicTotal === 2, 'publicTotal は validNewSurveyRows と一致, got ' + stats.publicTotal);
  assert(env.cacheStore['publicResultsV1'] === undefined || JSON.parse(env.cacheStore['publicResultsV1']).stale !== true,
    '確定時に古い公開結果キャッシュは破棄される');
  assert(env.created.length > 0, '集計_*シートは再生成される');
  const v = env.getValid()._grid;
  assert(v.length === 1 + 3 && v.slice(1).every((r) => r[C.indexOf('respondent_hash')] === '' && r[C.indexOf('free_comment')] === ''),
    'responses_validには締切内の3行のみ、respondent_hash・free_commentは空');
}

/* ── buildAggregationSheets が responses を書き換える関数を呼ばない（静的チェック） ── */
{
  const fn = code.slice(code.indexOf('function buildAggregationSheets()'), code.indexOf('function regionBucketFormulas_'));
  assert(!/ensureResidenceHelperColumn_\(/.test(fn) && !/getResponsesSheet_\(/.test(fn),
    'buildAggregationSheets() は ensureResidenceHelperColumn_ / getResponsesSheet_ を呼ばない');
  const setup = code.slice(code.indexOf('function setupSpreadsheet()'), code.indexOf('function ensureResidenceHelperColumn_'));
  assert(/ensureResidenceHelperColumn_\(sheet\)/.test(setup), '補助列の作成は初期化用 setupSpreadsheet() 側に限定される');
}


/* ── 確定マーカー（SURVEY_RESULTS_FINALIZED_AT） ── */
const MARKER = 'SURVEY_RESULTS_FINALIZED_AT';
function marker_rows(sbForCols) {
  const C = sbForCols.COLUMNS;
  const mk = (ts, stage) => { const r = new Array(C.length).fill(''); r[0] = ts; r[C.indexOf('completion_stage')] = stage; return r; };
  return [mk(JST('2026-09-20T10:00:00'), 'no_gate_reached'), mk(JST('2026-10-01T00:00:00.000'), 'no_gate_reached')];
}
const AFTER = { now: JST('2026-10-01T09:00:00') };
function expectBlocked(env, label) {
  let result = null, error = null;
  try { result = env.sb.getPublicResults(); } catch (e) { error = e; }
  assert(result === null && error && /finalizeSurveyResults/.test(error.message), label + '：getPublicResults()は公開せずエラー, got ' + (error && error.message));
  assert(env.cacheCalls.get === 0, label + '：キャッシュも参照しない');
}

{ // テスト1：古いキャッシュあり＋responses_validなし（＋マーカーなし）
  const env = makeEnv(AFTER, { validSheetExists: false });
  env.cacheStore['publicResultsV1'] = JSON.stringify({ total: 999, stale: true });
  expectBlocked(env, '古いキャッシュあり+responses_validなし');
}
{ // テスト2：responses_validあり＋マーカーなし（古いキャッシュもある）
  const env = makeEnv(AFTER, { validSheetExists: true, finalizedMarker: false });
  env.cacheStore['publicResultsV1'] = JSON.stringify({ total: 999, stale: true });
  expectBlocked(env, 'responses_validあり+マーカーなし');
}
{ // テスト3：buildAggregationSheets()だけ実行
  const probe = freshSandbox(AFTER);
  const env = makeEnv(AFTER, { rows: marker_rows(probe), validSheetExists: false });
  env.cacheStore['publicResultsV1'] = JSON.stringify({ total: 999, stale: true });
  env.sb.buildAggregationSheets();
  assert(env.getValid() !== null, 'buildAggregationSheets()単体でもresponses_validは作られる');
  assert(!(MARKER in env.props), 'buildAggregationSheets()単体ではマーカーは保存されない');
  expectBlocked(env, 'buildAggregationSheets()のみ実行');
}
{ // buildAggregationSheets()は既存マーカーを外す（再生成後は再確定が必要）
  const probe = freshSandbox(AFTER);
  const env = makeEnv(AFTER, { rows: marker_rows(probe), finalizedMarker: true });
  env.sb.buildAggregationSheets();
  assert(!(MARKER in env.props), 'buildAggregationSheets()は開始時に既存マーカーを削除する');
}
{ // テスト4：finalize途中で例外 → マーカーは残らない（既存マーカーも消える）
  const probe = freshSandbox(AFTER);
  const env = makeEnv(AFTER, { rows: marker_rows(probe), finalizedMarker: true, failOnInsert: '集計_衣装カテゴリ' });
  let threw = false;
  try { env.sb.finalizeSurveyResults(); } catch (e) { threw = /simulated failure/.test(e.message); }
  assert(threw, 'finalize途中の例外はそのまま伝播する');
  assert(!(MARKER in env.props), '途中で例外 → 確定マーカーは残らない（開始時に削除済みで保存もされない）');
  expectBlocked(env, 'finalize途中失敗後');
}
{ // テスト6：validNewSurveyRows !== publicTotal → 失敗・マーカー保存なし
  const probe = freshSandbox(AFTER);
  const env = makeEnv(AFTER, { rows: marker_rows(probe) });
  env.sb.buildPublicResultsPayload_ = () => ({ total: 99, ready: false });
  let msg = null;
  try { env.sb.finalizeSurveyResults(); } catch (e) { msg = e.message; }
  assert(msg && /最終回答数が一致しません/.test(msg), '件数不一致ならfinalizeが失敗する, got ' + msg);
  assert(!(MARKER in env.props), '件数不一致 → マーカーを保存しない');
  expectBlocked(env, '件数不一致後');
}
{ // テスト5：正常完了 → マーカー保存、getPublicResults()利用可能
  const probe = freshSandbox(AFTER);
  const env = makeEnv(AFTER, { rows: marker_rows(probe) });
  env.cacheStore['publicResultsV1'] = JSON.stringify({ total: 999, stale: true });
  expectBlocked(env, 'finalize前');
  const stats = env.sb.finalizeSurveyResults();
  assert(typeof stats.finalizedAt === 'string' && env.props[MARKER] === stats.finalizedAt,
    '正常完了後に確定マーカーが保存される');
  assert(stats.validNewSurveyRows === 1 && stats.publicTotal === 1, '最終回答数 validNewSurveyRows === publicTotal (=1), got ' + JSON.stringify(stats));
  assert(env.writes.length === 0, '正常完了までresponsesへ書き込まない');
  const r = env.sb.getPublicResults();
  assert(r && r.total === 1 && !r.stale, 'マーカー保存後は getPublicResults() が利用可能（古いキャッシュは破棄済み）');
}
{ // マーカーは全工程の最後にだけ保存される（保存直前までは不在）
  const probe = freshSandbox(AFTER);
  const env = makeEnv(AFTER, { rows: marker_rows(probe) });
  let markerSeenDuringCompute = null;
  const orig = env.sb.computePublicResultsForFinalize_;
  env.sb.computePublicResultsForFinalize_ = function () { markerSeenDuringCompute = MARKER in env.props; return orig(); };
  env.sb.finalizeSurveyResults();
  assert(markerSeenDuringCompute === false, '整合性確認の時点ではマーカー未保存（確認後に保存）');
  assert(MARKER in env.props, '確認後にマーカーが保存される');
}


/* ── finalizeSurveyResults：buildAggregationSheets → SpreadsheetApp.flush → computePublicResultsForFinalize_ の順序 ── */
{
  const probe = freshSandbox(AFTER);
  const env = makeEnv(AFTER, { rows: marker_rows(probe) });
  const order = [];
  const origBuild = env.sb.buildAggregationSheets;
  const origCompute = env.sb.computePublicResultsForFinalize_;
  env.sb.buildAggregationSheets = function () { order.push('build'); return origBuild.apply(this, arguments); };
  env.sb.SpreadsheetApp.flush = function () { order.push('flush'); };
  env.sb.computePublicResultsForFinalize_ = function () { order.push('compute'); return origCompute.apply(this, arguments); };
  env.sb.finalizeSurveyResults();
  assert(order.join(',') === 'build,flush,compute', 'finalizeSurveyResults()の順序は build → flush → compute, got ' + order.join(','));

  // 静的チェック：flushはbuildAggregationSheets()呼び出しの後、computePublicResultsForFinalize_()呼び出しの前
  const fn = code.slice(code.indexOf('function finalizeSurveyResults()'), code.indexOf('function computePublicResultsForFinalize_()'));
  const iBuild = fn.indexOf('buildAggregationSheets()');
  const iFlush = fn.indexOf('SpreadsheetApp.flush()');
  const iCompute = fn.indexOf('computePublicResultsForFinalize_()');
  assert(iBuild !== -1 && iFlush > iBuild && iCompute > iFlush, '静的チェック：build < flush < compute の順で記述されている');
}

if (failures > 0) { console.error('\ntest_deadline.js: ' + failures + ' failure(s)'); process.exit(1); }
console.log('\ntest_deadline.js: all checks passed');
