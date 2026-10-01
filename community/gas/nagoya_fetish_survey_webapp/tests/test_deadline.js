'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Issue #319：受付終了モード（submitSurvey / checkSubmissionStatus は常にCLOSED）と、
// 締切内有効回答の確定スナップショット（responses_valid）・確定結果の固定（SURVEY_FINAL_RESULTS_META/_000…のチャンク保存）の検証。

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

/* ── submitSurvey / checkSubmissionStatus：常にCLOSED（時刻・UUID・回答内容に関係なく、何にも触れない） ── */
{
  const touched = [];
  const trap = (name) => new Proxy({}, { get: (t, k) => { touched.push(name + '.' + String(k)); throw new Error(name + ' must not be touched'); } });
  const inputs = [
    ['not-a-uuid', {}],
    ['11111111-1111-4111-8111-111111111111', { prefecture: '愛知県' }],
    ['11111111-1111-4111-8111-111111111111', null],
    [undefined, undefined],
    [12345, 'string-answers']
  ];
  // 締切前・締切直前・締切後のいずれの時刻でも同じ（今後アンケートは再開しない）。
  ['2026-09-15T12:00:00', '2026-09-30T23:59:59.999', '2026-10-01T00:00:01', '2027-01-01T00:00:00'].forEach((t) => {
    const sb = freshSandbox({ now: JST(t) });
    sb.SpreadsheetApp = trap('SpreadsheetApp'); sb.LockService = trap('LockService');
    sb.CacheService = trap('CacheService'); sb.Utilities = trap('Utilities');
    sb.PropertiesService = trap('PropertiesService');
    let internalCalls = 0;
    ['isValidUuid_', 'validateAnswers_', 'hashUuid_', 'getResponsesSheet_', 'isDuplicateHash_', 'appendResponseRow_', 'getServerSalt_']
      .forEach((fn) => { sb[fn] = () => { internalCalls++; throw new Error(fn + ' must not be called'); }; });
    inputs.forEach((args) => {
      const r = sb.submitSurvey(args[0], args[1]);
      assert(r && Object.keys(r).length === 1 && r.status === 'CLOSED', 'submitSurvey は常に { status: "CLOSED" } のみ (' + t + ', ' + JSON.stringify(args[0]) + '), got ' + JSON.stringify(r));
      const st = sb.checkSubmissionStatus(args[0]);
      assert(st && st.answered === false && st.closed === true && Object.keys(st).length === 2,
        'checkSubmissionStatus は常に { answered:false, closed:true } (' + t + '), got ' + JSON.stringify(st));
    });
    assert(touched.length === 0 && internalCalls === 0, 'submitSurvey/checkSubmissionStatus は Spreadsheet・LockService・Cache・Utilities・Properties・検証・ハッシュ・append のいずれにも触れない (' + t + ') touched=' + touched.join(','));
  });
  // 静的チェック：関数本体は即returnのみ。
  const body = (name, next) => code.slice(code.indexOf('function ' + name + '('), code.indexOf(next)).replace(/\/\*[\s\S]*?\*\//g, '').trim();
  assert(/^function submitSurvey\(uuid, answers\) \{\s*return \{ status: 'CLOSED' \};\s*\}$/.test(body('submitSurvey', '/**\n * `?view=results`')),
    'submitSurvey() の本体は return { status: "CLOSED" } のみ');
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
  const publicFn = code.slice(code.indexOf('function getPublicResults()'), code.indexOf('function buildPublicResultsPayload_'));
  assert(!/SpreadsheetApp|getResponsesSheet_|getDeadlineValidSheet_|CacheService|buildPublicResultsPayload_/.test(publicFn.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')),
    'getPublicResults() のコードはSpreadsheet・集計・CacheServiceを参照しない（確定JSONを読むだけ）');
}

/* ── finalizeSurveyResults：締切前は実行できない ── */
{
  const sb = freshSandbox({ now: JST('2026-09-30T12:00:00') });
  let threw = false;
  try { sb.finalizeSurveyResults(); } catch (e) { threw = true; }
  assert(threw, '締切前は finalizeSurveyResults() がエラーになる（未確定値を最終化させない）');
}


const AFTER0 = { now: JST('2026-10-01T09:00:00') };

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
  let seeding = false;
  const propOps = []; // 書き込み系の操作順 [{op, key}]
  sb.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => (k in props ? props[k] : null),
    // 本物のScript Propertiesと同様、1値が9KB（9216バイト）を超えると失敗する。
    setProperty: (k, v) => {
      if (Buffer.byteLength(String(v), 'utf8') > 9216) throw new Error('simulated Script Properties limit: value of ' + k + ' exceeds 9KB');
      if (!seeding && opts.failOnSetKey && opts.failOnSetKey(k, props)) throw new Error('simulated failure setting ' + k);
      propOps.push({ op: 'set', key: k }); props[k] = String(v);
    },
    deleteProperty: (k) => { propOps.push({ op: 'delete', key: k }); delete props[k]; },
    getKeys: () => Object.keys(props)
  }) };
  if (opts.finalJson) { // 既存の確定スナップショット（チャンク形式）を用意しておく
    seeding = true;
    sb.writeFinalResultsSnapshot_(sb.PropertiesService.getScriptProperties(), JSON.parse(opts.finalJson));
    propOps.length = 0;
    seeding = false;
  }
  const flushCalls = [];
  const access = { openById: 0 };
  sb.SpreadsheetApp = { openById: () => { access.openById++; return ss; }, flush: () => { flushCalls.push(true); } };
  return { sb, C, ss, props, propOps, access, flushCalls, writes, cacheStore, cacheCalls, created, getValid: () => valid };
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

/* ── 未確定：確定JSONが無ければ（古いキャッシュ・responses_validがあっても）明示エラー ── */
{
  const env = makeEnv(AFTER0, { validSheetExists: true });
  env.cacheStore['publicResultsV1'] = JSON.stringify({ total: 999, ready: true, stale: true });
  let result = null, error = null;
  try { result = env.sb.getPublicResults(); } catch (e) { error = e; }
  assert(result === null, '未確定：古いキャッシュを返さない');
  assert(error && /未確定/.test(error.message) && /finalizeSurveyResults/.test(error.message), '「未確定」と分かるエラーでfinalizeSurveyResults()を案内する, got ' + (error && error.message));
  assert(env.cacheCalls.get === 0 && env.cacheCalls.put === 0, 'CacheServiceを参照・更新しない');
  assert(env.access.openById === 0, '未確定エラーの判定でSpreadsheetを開かない');
}

/* ── getPublicResults()：確定JSONをJSON.parseして返すだけ（Spreadsheet非依存・キャッシュ非依存） ── */
{
  const fixed = { total: 5, ready: false, generatedAt: '2026-10-01T00:00:00.000Z', fixedMarker: 'snapshot' };
  const env = makeEnv(AFTER0, { finalizedMarker: true, finalJson: JSON.stringify(fixed) });
  env.sb.SpreadsheetApp = new Proxy({}, { get: (t, k) => { throw new Error('SpreadsheetApp must not be touched: ' + String(k)); } });
  env.sb.CacheService = new Proxy({}, { get: (t, k) => { throw new Error('CacheService must not be touched: ' + String(k)); } });
  const r = env.sb.getPublicResults();
  assert(JSON.stringify(r) === JSON.stringify(fixed), 'getPublicResults() は確定JSONの内容をそのまま返す');
  // JSONだけがあってマーカーが無い（確定処理が最後まで終わっていない）場合は公開しない。
  const env2 = makeEnv(AFTER0, { finalJson: JSON.stringify(fixed) });
  let err2 = null; try { env2.sb.getPublicResults(); } catch (e) { err2 = e; }
  assert(err2 && /未確定/.test(err2.message), '確定マーカーが無ければJSONがあっても未確定エラー');
}

/* ── doGet format=json：getPublicResults() と同じ確定payload（Spreadsheetを開かない） ── */
{
  const fixed = { total: 3, ready: false, generatedAt: '2026-10-01T00:00:00.000Z' };
  const env = makeEnv(AFTER0, { finalizedMarker: true, finalJson: JSON.stringify(fixed) });
  env.sb.ContentService = { MimeType: { JSON: 'JSON' }, createTextOutput: (t) => ({ _text: t, setMimeType: function () { return this; } }) };
  env.sb.SpreadsheetApp = new Proxy({}, { get: () => { throw new Error('SpreadsheetApp must not be touched'); } });
  const out = env.sb.doGet({ parameter: { view: 'results', format: 'json' } });
  assert(out._text === JSON.stringify(fixed), 'format=json は確定payloadを返す');
  assert(out._text === JSON.stringify(env.sb.getPublicResults()), 'format=json と getPublicResults() は同一payload');
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
  const stats = env.sb.finalizeSurveyResults();
  assert(env.writes.length === 0, 'finalizeSurveyResults()中、responsesへのsetValue/setValues/setFormula/clear/appendRow等の書き込みが0件, got ' + JSON.stringify(env.writes));
  assert(stats.validRows === 3 && stats.lateRows === 1 && stats.validNewSurveyRows === 2, '件数内訳: valid=3(旧1含む)/late=1/validNew=2, got ' + JSON.stringify(stats));
  assert(stats.publicTotal === 2, 'publicTotal は validNewSurveyRows と一致, got ' + stats.publicTotal);
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
const META = 'SURVEY_FINAL_RESULTS_META';
const snapKeys = (props) => Object.keys(props).filter((k) => k === META || /^SURVEY_FINAL_RESULTS_\d+$/.test(k));
const hasSnap = (props) => snapKeys(props).length > 0;
// テスト側の独立した復元（Code.gsの実装に依存しない）：メタ情報どおりにチャンクを番号順に連結する。
const readSnap = (props) => {
  const meta = JSON.parse(props[META]);
  let out = '';
  for (let i = 0; i < meta.chunks; i++) out += props['SURVEY_FINAL_RESULTS_' + String(i).padStart(3, '0')];
  return out;
};
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
  const env = makeEnv(AFTER, { rows: marker_rows(probe), finalizedMarker: true, finalJson: '{"total":999,"old":true}', failOnInsert: '集計_衣装カテゴリ' });
  let threw = false;
  try { env.sb.finalizeSurveyResults(); } catch (e) { threw = /simulated failure/.test(e.message); }
  assert(threw, 'finalize途中の例外はそのまま伝播する');
  assert(!(MARKER in env.props) && !hasSnap(env.props), '途中で例外 → 確定マーカー・メタ・全チャンクは残らない（開始時に削除済みで保存もされない）');
  expectBlocked(env, 'finalize途中失敗後');
}
{ // テスト6：validNewSurveyRows !== publicTotal → 失敗・マーカー保存なし
  const probe = freshSandbox(AFTER);
  const env = makeEnv(AFTER, { rows: marker_rows(probe), finalizedMarker: true, finalJson: '{"total":999,"old":true}' });
  env.sb.buildPublicResultsPayload_ = () => ({ total: 99, ready: false });
  let msg = null;
  try { env.sb.finalizeSurveyResults(); } catch (e) { msg = e.message; }
  assert(msg && /最終回答数が一致しません/.test(msg), '件数不一致ならfinalizeが失敗する, got ' + msg);
  assert(!(MARKER in env.props) && !hasSnap(env.props), '件数不一致 → 確定チャンク・メタ・マーカーを保存しない（既存分も残さない）');
  expectBlocked(env, '件数不一致後');
}
{ // テスト5：正常完了 → 確定JSON・マーカー保存、getPublicResults()は確定JSONだけを返す
  const probe = freshSandbox(AFTER);
  const env = makeEnv(AFTER, { rows: marker_rows(probe) });
  env.cacheStore['publicResultsV1'] = JSON.stringify({ total: 999, stale: true });
  expectBlocked(env, 'finalize前');
  const stats = env.sb.finalizeSurveyResults();
  assert(typeof stats.finalizedAt === 'string' && env.props[MARKER] === stats.finalizedAt,
    '正常完了後に確定マーカーが保存される');
  assert(typeof env.props[META] === 'string' && typeof env.props['SURVEY_FINAL_RESULTS_000'] === 'string', 'SURVEY_FINAL_RESULTS_META と _000 チャンクが保存される');
  const saved = JSON.parse(readSnap(env.props));
  assert(saved.total === 1 && stats.validNewSurveyRows === 1 && stats.publicTotal === 1, '最終回答数 validNewSurveyRows === publicTotal === saved.total (=1), got ' + JSON.stringify(stats));
  assert(env.writes.length === 0, '正常完了までresponsesへ書き込まない');
  assert(env.cacheCalls.get === 0 && env.cacheCalls.put === 0, '確定処理・公開APIはCacheServiceを使わない');

  // 確定後：Spreadsheet・集計シートを一切開かず、同じ固定payloadを返す（シートが変わっても不変）。
  const opened = env.access.openById;
  env.sb.SpreadsheetApp = new Proxy({}, { get: () => { throw new Error('SpreadsheetApp must not be touched after finalize'); } });
  const r1 = env.sb.getPublicResults();
  const r2 = env.sb.getPublicResults();
  assert(JSON.stringify(r1) === readSnap(env.props) && JSON.stringify(r2) === readSnap(env.props), 'getPublicResults() は保存済みJSONと完全一致する固定payloadを返す');
  assert(env.access.openById === opened, 'finalize後のgetPublicResults()はSpreadsheetを開かない');
}
{ // 公開payloadに個人情報が混入しない（responses行に個人情報を入れて確定し、allowlistバリデータと全文走査で確認）
  const { validatePublicResultsPayload } = require('../tools/validate-public-results-payload.js');
  const probe = freshSandbox(AFTER);
  const C = probe.COLUMNS;
  const row = new Array(C.length).fill('');
  row[0] = JST('2026-09-20T10:00:00');
  row[C.indexOf('respondent_hash')] = 'SECRETHASH0123456789';
  row[C.indexOf('free_comment')] = 'SECRET自由記述メール@example.com';
  row[C.indexOf('completion_stage')] = 'no_gate_reached';
  const env = makeEnv(AFTER, { rows: [row] });
  env.sb.finalizeSurveyResults();
  const json = readSnap(env.props);
  assert(!/SECRET|example\.com|respondent_hash|free_comment|uuid|email/i.test(json), '確定JSONに respondent_hash・自由記述・email・UUID関連が含まれない');
  assert(!/2026-09-20/.test(json), '確定JSONに個別回答のtimestampが含まれない');
  const v = validatePublicResultsPayload(JSON.parse(json));
  assert(v && (v.ok === true || (Array.isArray(v.errors) && v.errors.length === 0)), '確定JSONはallowlistバリデータを通過する, got ' + JSON.stringify(v));
}
{ // 確定JSONは集計済みpayload（targetCount等を含む）をそのまま固定する
  const probe = freshSandbox(AFTER);
  const env = makeEnv(AFTER, { rows: marker_rows(probe) });
  const stub = { total: 1, ready: false, step3: { targetCount: 20, items: [] } };
  env.sb.buildPublicResultsPayload_ = () => stub;
  env.sb.finalizeSurveyResults();
  assert(JSON.stringify(JSON.parse(readSnap(env.props))) === JSON.stringify(stub), '確定JSONは集計payload（分岐設問のtargetCount含む）をそのまま保存する');
}
{ // マーカーは全工程の最後にだけ保存される（確定JSON保存の後）
  const probe = freshSandbox(AFTER);
  const env = makeEnv(AFTER, { rows: marker_rows(probe), finalizedMarker: true, finalJson: '{"old":true}' });
  let seenDuringCompute = null;
  const orig = env.sb.computePublicResultsForFinalize_;
  env.sb.computePublicResultsForFinalize_ = function () { seenDuringCompute = { marker: MARKER in env.props, json: hasSnap(env.props) }; return orig(); };
  env.sb.finalizeSurveyResults();
  assert(seenDuringCompute && seenDuringCompute.marker === false && seenDuringCompute.json === false, '集計・件数確認の時点では既存の確定マーカー・確定JSONは外れている');
  const ops = env.propOps.map((o) => o.op + ':' + o.key);
  const iSetJson = ops.lastIndexOf('set:' + META), iSetMarker = ops.indexOf('set:' + MARKER);
  const iFirstChunk = ops.indexOf('set:SURVEY_FINAL_RESULTS_000');
  assert(iFirstChunk !== -1 && iFirstChunk < iSetJson && iSetJson < iSetMarker, '全チャンク保存 → メタ保存 → 確定マーカー保存の順');
  assert(iSetMarker === ops.length - 1 || ops.slice(iSetMarker + 1).every((o) => o.indexOf('delete') !== 0), 'SURVEY_RESULTS_FINALIZED_AT は最後に保存される, got ' + ops.join(' > '));
  assert(ops.indexOf('delete:' + MARKER) < iFirstChunk && ops.indexOf('delete:' + META) < iFirstChunk, '保存前に既存マーカー・メタが解除されている');
}


/* ══ Script Properties 9KB/value 制限対応：確定JSONのチャンク保存・復元 ══ */
const bigPayload = (n) => {
  const categories = [];
  for (let i = 0; i < n; i++) categories.push({ name: '日本語カテゴリ' + i + '・𠮷野家😀', count: i, percent: Math.round(i * 1000 / n) / 10 });
  return { total: 1, ready: false, generatedAt: '2026-10-01T00:00:00.000Z', categories, step3: { targetCount: 20, items: categories.slice(0, 3) } };
};
const chunkKeysOf = (props) => snapKeys(props).filter((k) => k !== META).sort();

{ // 分割関数単体：UTF-8バイト上限・欠損なし・順序維持・サロゲートペアを切らない
  const sb = freshSandbox(AFTER);
  const text = Array.from({ length: 3000 }, (_, i) => ['あ', 'a', '𠮷', '😀', 'é', '漢'][i % 6] + (i % 10)).join('');
  [10, 100, 6000].forEach((max) => {
    const parts = sb.splitByUtf8Bytes_(text, max);
    assert(parts.join('') === text, 'splitByUtf8Bytes_(max=' + max + ') は連結すると元の文字列と完全一致（欠損・重複・順序入れ替えなし）');
    assert(parts.every((c) => Buffer.byteLength(c, 'utf8') <= max), '各チャンクはUTF-8で ' + max + ' バイト以下');
    assert(parts.every((c) => Buffer.from(c, 'utf8').toString('utf8') === c), '各チャンクは文字（サロゲートペア含む）の途中で切れていない');
  });
  assert(sb.utf8ByteLength_(text) === Buffer.byteLength(text, 'utf8'), 'utf8ByteLength_ はUTF-8バイト数と一致（日本語・絵文字含む）');
  assert(sb.FINAL_RESULTS_CHUNK_MAX_BYTES <= 6000 && sb.FINAL_RESULTS_CHUNK_MAX_BYTES < 9216, '1チャンクの上限は9KB（9216バイト）より十分小さい');
}

{ // 9KBを超える日本語payloadでもfinalizeで保存でき、getPublicResults()で欠損なく復元できる
  const probe = freshSandbox(AFTER);
  const payload = bigPayload(400);
  const json = JSON.stringify(payload);
  assert(Buffer.byteLength(json, 'utf8') > 9216 * 3, '模擬payloadは9KBを大きく超える（' + Buffer.byteLength(json, 'utf8') + 'バイト）');
  const env = makeEnv(AFTER, { rows: marker_rows(probe) });
  env.sb.buildPublicResultsPayload_ = () => payload;
  env.sb.finalizeSurveyResults(); // モックは9KB超のsetPropertyで例外を投げる＝チャンク化されていなければここで失敗する
  const keys = chunkKeysOf(env.props);
  assert(keys.length >= 2, '複数チャンクに分割されている（' + keys.length + '個）');
  assert(keys.every((k, i) => k === 'SURVEY_FINAL_RESULTS_' + String(i).padStart(3, '0')), 'チャンクキーは000から連番');
  assert(keys.every((k) => Buffer.byteLength(env.props[k], 'utf8') <= 6000), '全チャンクがUTF-8で6000バイト以下（9KB上限に十分な余裕）');
  const meta = JSON.parse(env.props[META]);
  assert(meta.chunks === keys.length && meta.bytes === Buffer.byteLength(json, 'utf8') && meta.length === json.length, 'メタ情報（chunks/bytes/length）が実データと一致');
  assert(readSnap(env.props) === json, 'チャンクを順番に結合すると元のJSON文字列と完全一致（順序維持）');
  // 確定後はSpreadsheet・Cacheに触れず、deep-equalで復元できる。
  env.sb.SpreadsheetApp = new Proxy({}, { get: () => { throw new Error('SpreadsheetApp must not be touched'); } });
  env.sb.CacheService = new Proxy({}, { get: () => { throw new Error('CacheService must not be touched'); } });
  const restored = env.sb.getPublicResults();
  assert(JSON.stringify(restored) === json && restored.categories.length === 400 && restored.categories[399].name === payload.categories[399].name,
    'getPublicResults() は日本語・サロゲートペアを含む全payloadを欠損なく復元する（Spreadsheet非依存）');
  assert(restored.step3.targetCount === 20, '分岐設問のtargetCountも保持される');
}

{ // チャンク欠損・改ざん・メタ欠損は公開しない
  const probe = freshSandbox(AFTER);
  const mkFinalized = () => {
    const env = makeEnv(AFTER, { rows: marker_rows(probe) });
    env.sb.buildPublicResultsPayload_ = () => bigPayload(400);
    env.sb.finalizeSurveyResults();
    return env;
  };
  const expectNotPublished = (env, label) => {
    let r = null, err = null;
    try { r = env.sb.getPublicResults(); } catch (e) { err = e; }
    assert(r === null && err && /未確定/.test(err.message), label + '：公開せず「未確定」エラー, got ' + (err && err.message));
  };
  let env = mkFinalized();
  delete env.props['SURVEY_FINAL_RESULTS_001'];
  expectNotPublished(env, '途中のチャンク欠損');
  env = mkFinalized();
  delete env.props['SURVEY_FINAL_RESULTS_' + String(JSON.parse(env.props[META]).chunks - 1).padStart(3, '0')];
  expectNotPublished(env, '最終チャンク欠損');
  env = mkFinalized();
  delete env.props[META];
  expectNotPublished(env, 'メタ情報欠損');
  env = mkFinalized();
  env.props['SURVEY_FINAL_RESULTS_000'] = env.props['SURVEY_FINAL_RESULTS_000'].slice(0, -5);
  expectNotPublished(env, 'チャンク内容の切り詰め（サイズ不一致）');
  env = mkFinalized();
  env.props[META] = '{broken';
  expectNotPublished(env, 'メタ情報が壊れている');
  env = mkFinalized();
  delete env.props[MARKER];
  expectNotPublished(env, '確定マーカー欠損（チャンクが揃っていても）');
}

{ // finalize途中の失敗（チャンク保存中／メタ保存／マーカー保存）では不完全なsnapshotを残さない
  const probe = freshSandbox(AFTER);
  const cases = [
    ['チャンク3の保存で失敗', (k) => k === 'SURVEY_FINAL_RESULTS_003'],
    ['メタ情報の保存で失敗', (k) => k === META],
    ['確定マーカーの保存で失敗', (k) => k === MARKER]
  ];
  cases.forEach(([label, failOn]) => {
    const env = makeEnv(AFTER, { rows: marker_rows(probe), finalizedMarker: true, finalJson: JSON.stringify(bigPayload(300)),
      failOnSetKey: failOn });
    env.sb.buildPublicResultsPayload_ = () => bigPayload(400);
    let threw = false;
    try { env.sb.finalizeSurveyResults(); } catch (e) { threw = /simulated failure/.test(e.message); }
    assert(threw, label + '：例外が伝播する');
    assert(!hasSnap(env.props) && !(MARKER in env.props), label + '：新規チャンク・メタ・確定マーカー・旧スナップショットが1つも残らない, keys=' + Object.keys(env.props).join(','));
    let r = null, err = null;
    try { r = env.sb.getPublicResults(); } catch (e) { err = e; }
    assert(r === null && err && /未確定/.test(err.message), label + '：getPublicResults() は何も公開しない');
  });
}

{ // 古い余剰チャンク（以前の大きいsnapshot・孤立チャンク）は再finalizeで残らない
  const probe = freshSandbox(AFTER);
  const env = makeEnv(AFTER, { rows: marker_rows(probe), finalizedMarker: true, finalJson: JSON.stringify(bigPayload(400)) });
  env.props['SURVEY_FINAL_RESULTS_099'] = 'orphan'; // メタに載っていない孤立チャンク
  const before = chunkKeysOf(env.props).length;
  assert(before > 3, '準備：古いsnapshotは多数のチャンクを持つ（' + before + '個）');
  env.sb.buildPublicResultsPayload_ = () => ({ total: 1, ready: false, small: true });
  env.sb.finalizeSurveyResults();
  assert(chunkKeysOf(env.props).join(',') === 'SURVEY_FINAL_RESULTS_000', '再finalize後のチャンクは新snapshotの1個だけ（余剰・孤立チャンクなし）, got ' + chunkKeysOf(env.props).join(','));
  assert(JSON.stringify(env.sb.getPublicResults()) === '{"total":1,"ready":false,"small":true}', '新しいsnapshotだけが復元される');
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
  // コメント行は除き、実コードの呼び出し位置だけで比較する。
  const codeOnly = fn.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const iBuild = codeOnly.indexOf('= buildAggregationSheets()');
  const iFlush = codeOnly.indexOf('SpreadsheetApp.flush()');
  const iCompute = codeOnly.indexOf('= computePublicResultsForFinalize_()');
  assert(iBuild !== -1 && iFlush > iBuild && iCompute > iFlush, '静的チェック：build < flush < compute の順で記述されている');
}

if (failures > 0) { console.error('\ntest_deadline.js: ' + failures + ' failure(s)'); process.exit(1); }
console.log('\ntest_deadline.js: all checks passed');
