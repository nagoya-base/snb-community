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
    getRange: () => ({ getValues: () => data, setValues: () => { sourceWrites++; }, setValue: () => { sourceWrites++; }, clearContent: () => { sourceWrites++; } }),
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

if (failures > 0) { console.error('\ntest_deadline.js: ' + failures + ' failure(s)'); process.exit(1); }
console.log('\ntest_deadline.js: all checks passed');
