/**
 * 名古屋野球ユニ部｜2026年9月キャッチボール会 日程クロス集計アンケート｜運営用匿名集計API
 * Issue #225 で新設。
 *
 * 目的：baseball/gas/enquete_202609_backend.gs が保存する responses Sheetの個票を
 * ブラウザへ返さず、開催日決定に必要なクロス集計だけをJSONで返す。
 * このスクリプトは回答受付GAS（enquete_202609_backend.gs）とは別のGoogle Apps Scriptプロジェクトとして、
 * 読み取り専用のWebアプリとしてデプロイする。学校セット撮影会用の集計GAS・Sheetとは完全に別。
 *
 * ── デプロイ手順 ──
 * 1. Google Apps Scriptで新しいスクリプトプロジェクトを作成する（回答受付用とは別プロジェクト）。
 * 2. このファイルの内容を貼り付ける。
 * 3. RESULTS_SPREADSHEET_ID を、baseball/gas/enquete_202609_backend.gs が書き込む
 *    野球ユニ部専用スプレッドシートのID（スプレッドシートURLの /d/ と /edit の間の文字列）に書き換える。
 *    回答受付用と同じスプレッドシートを指定すること（別のシートを指定しない）。
 * 4. 「デプロイ」→「新しいデプロイ」→「ウェブアプリ」。実行ユーザーは自分、
 *    アクセス権はダッシュボードからGETできる設定にする。
 * 5. 発行された /exec URL を baseball/enquete_202609_results.html の
 *    RESULTS_GAS_ENDPOINT に設定する。
 * 6. /exec?action=summary をブラウザで開き、{"ok":true, ...} のJSONが返ることを確認する。
 *
 * 受付上限について：baseball/enquete_202609.html の一時〆切は 2026/8/28（金）23:59 のみ。
 * 12名は通常参加枠の目安であり、回答数到達によるフォーム閉鎖・新規回答拒否は行わない
 * （13人目以降は補欠候補として運営が手動対応する。Issue #225 2026-08-15追記）。
 * そのため、このAPIに回答数到達を判定するための専用エンドポイントは設けていない。
 *
 * ── APIレベルのテストモード（?action=summary&test=1） ──
 * baseball/gas/enquete_202609_backend.gs 側のAPIレベルテストモード（POST先URLに ?test=1）で
 * test_responsesシートへ保存したテストデータを確認するための専用エンドポイント。
 * 本番の ?action=summary（responsesシートを集計）とはキャッシュ・レスポンスとも完全に分離しており、
 * 本番の集計結果には一切混ざらない。test_responsesシートがまだ存在しない場合はエラーにはせず、
 * total:0の空集計を返す（テスト送信がまだ1件もない状態でも安全に呼び出せるようにするため）。
 *
 * APIレスポンスへ絶対に含めないもの：
 * - display_name（お名前／ハンドルネーム）
 * - contact_email
 * - contact_x
 * - free_comment
 * - submission_id
 * - 個々の回答行（個票）
 */

var RESULTS_SPREADSHEET_ID = 'PLACEHOLDER_REPLACE_WITH_BASEBALL_RESULTS_SPREADSHEET_ID';
var RESULTS_SHEET_NAME = 'responses';
/* baseball/gas/enquete_202609_backend.gs の TEST_SHEET_NAME と同じ文字列にすること。
   APIレベルのテストモード（?action=summary&test=1）専用の集計対象。 */
var RESULTS_TEST_SHEET_NAME = 'test_responses';
var RESULTS_CACHE_SECONDS = 30;

/* 候補日は必ずこの6列のみ。9/12・9/26は候補日に含めない（Issue #225で明示的に禁止）。
   baseball/gas/enquete_202609_backend.gs の DATE_KEYS / DATE_LABELS と一致させること。 */
var RESULTS_DATE_COLUMNS = [
  ['date_0905', '9/5（土）'],
  ['date_0906', '9/6（日）'],
  ['date_0913', '9/13（日）'],
  ['date_0919', '9/19（土）'],
  ['date_0920', '9/20（日）'],
  ['date_0927', '9/27（日）']
];

/* baseball/gas/enquete_202609_backend.gs の ALLOWED_PARTICIPATION_INTENT と一致させること。 */
var RESULTS_INTENTS = [
  '日程が合えば参加したい',
  'たぶん参加したい',
  '条件次第で参加を検討したい',
  '今回は日程投票だけ'
];

/* baseball/gas/enquete_202609_backend.gs の ALLOWED_PARTICIPATION_HISTORY と一致させること。 */
var RESULTS_HISTORY_VALUES = ['初参加', '以前参加したことがある'];

function doGet(e) {
  var action = e && e.parameter ? String(e.parameter.action || '') : '';
  var isTestMode = !!(e && e.parameter && e.parameter.test === '1');

  if (action !== 'summary') {
    return resultsJson_({
      ok: true,
      service: 'baseball enquete_202609 anonymous summary API',
      usage: '?action=summary（運営用クロス集計。&test=1でテスト専用シートを参照）'
    });
  }

  try {
    var cacheKey = isTestMode ? 'summary_test_v1' : 'summary_v1';
    var cache = CacheService.getScriptCache();
    var cached = cache.get(cacheKey);
    if (cached) {
      return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON);
    }

    var summary = buildSurveySummary_(isTestMode);
    var encoded = JSON.stringify(summary);
    cache.put(cacheKey, encoded, RESULTS_CACHE_SECONDS);
    return ContentService.createTextOutput(encoded).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    // 内部例外の文言をクライアントへ返さない。詳細はサーバー側ログにのみ残す。
    console.error('[enquete_202609_results] summary_error: ' + err);
    return resultsJson_({ ok: false, error: 'summary_error' });
  }
}

/**
 * 運営用クロス集計を組み立てる。isTestMode=trueの場合、対象シートが本番のRESULTS_SHEET_NAMEでは
 * なくRESULTS_TEST_SHEET_NAMEになる（APIレベルのテストモード。ファイル冒頭コメント参照）。
 * - total: 総回答数（現在Sheetに保存されている行数。1人1行のupsert後の件数）
 * - date_counts: 候補日ごとの参加可能人数
 * - matrix: 候補日6日×6日の重複人数マトリクス。matrix[A][B] は「AもBも○」の人数。
 *   対角線 matrix[A][A] は date_counts[A] と一致する（その日自体の参加可能人数）。
 * - date_intent: 候補日 × 参加意向のクロス集計。
 * - history_counts: 初参加／既参加の内訳（付随情報）。
 * - no_available_count: 「9月は参加できない」の人数（付随情報）。
 * 個々の回答行・display_name・連絡先・自由記述・submission_idはいっさい読み出し対象に含めない
 * （必要な列のみ getRange で取得し、レスポンス組み立てにも使わない）。
 */
function buildSurveySummary_(isTestMode) {
  var ss = SpreadsheetApp.openById(RESULTS_SPREADSHEET_ID);
  var sheetName = isTestMode ? RESULTS_TEST_SHEET_NAME : RESULTS_SHEET_NAME;
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    // テストモードでは、まだ1件もテスト送信していない状態（test_responsesシート未作成）を
    // エラーにせず、空集計として返す。本番モードでresponsesシートが無いのは異常事態のため
    // 従来どおり例外にする。
    if (isTestMode) return emptySummary_(true);
    throw new Error('responses sheet not found');
  }

  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  if (lastColumn < 1) {
    if (isTestMode) return emptySummary_(true);
    throw new Error('header not found');
  }

  var headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  var index = {};
  headers.forEach(function (name, i) { index[String(name)] = i; });

  var dateKeys = RESULTS_DATE_COLUMNS.map(function (pair) { return pair[0]; });
  var required = dateKeys.concat(['participation_intent', 'participation_history', 'no_available_date']);
  required.forEach(function (name) {
    if (index[name] === undefined) throw new Error('required column missing: ' + name);
  });

  var rows = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues() : [];

  var dateCounts = zeroMap_(dateKeys);
  var matrix = makeMatrix_(dateKeys, dateKeys);
  var dateIntent = makeMatrix_(dateKeys, RESULTS_INTENTS);
  var historyCounts = zeroMap_(RESULTS_HISTORY_VALUES);
  var noAvailableCount = 0;

  rows.forEach(function (row) {
    var flags = dateKeys.map(function (key) { return row[index[key]] === true; });
    var intent = stringCell_(row[index.participation_intent]);
    var history = stringCell_(row[index.participation_history]);

    if (row[index.no_available_date] === true) noAvailableCount += 1;
    if (historyCounts[history] !== undefined) historyCounts[history] += 1;

    dateKeys.forEach(function (keyA, i) {
      if (!flags[i]) return;
      dateCounts[keyA] += 1;
      if (dateIntent[keyA] && dateIntent[keyA][intent] !== undefined) dateIntent[keyA][intent] += 1;
      dateKeys.forEach(function (keyB, j) {
        if (flags[j]) matrix[keyA][keyB] += 1;
      });
    });
  });

  return {
    ok: true,
    test_mode: isTestMode,
    total: rows.length,
    no_available_count: noAvailableCount,
    updated_at: Utilities.formatDate(new Date(), 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ssXXX"),
    labels: {
      dates: objectFromPairs_(RESULTS_DATE_COLUMNS),
      intents: RESULTS_INTENTS,
      history: RESULTS_HISTORY_VALUES
    },
    date_counts: dateCounts,
    matrix: matrix,
    date_intent: dateIntent,
    history_counts: historyCounts
  };
}

/**
 * テストモードで、まだtest_responsesシートが存在しない（＝テスト送信がまだ1件もない）場合の
 * 空集計レスポンス。本番相当の形状を保ったまま、全カウントを0として返す。
 */
function emptySummary_(isTestMode) {
  var dateKeys = RESULTS_DATE_COLUMNS.map(function (pair) { return pair[0]; });
  return {
    ok: true,
    test_mode: isTestMode,
    total: 0,
    no_available_count: 0,
    updated_at: Utilities.formatDate(new Date(), 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ssXXX"),
    labels: {
      dates: objectFromPairs_(RESULTS_DATE_COLUMNS),
      intents: RESULTS_INTENTS,
      history: RESULTS_HISTORY_VALUES
    },
    date_counts: zeroMap_(dateKeys),
    matrix: makeMatrix_(dateKeys, dateKeys),
    date_intent: makeMatrix_(dateKeys, RESULTS_INTENTS),
    history_counts: zeroMap_(RESULTS_HISTORY_VALUES)
  };
}

function zeroMap_(keys) {
  var map = {};
  keys.forEach(function (key) { map[key] = 0; });
  return map;
}

function makeMatrix_(rows, columns) {
  var matrix = {};
  rows.forEach(function (row) {
    matrix[row] = {};
    columns.forEach(function (column) { matrix[row][column] = 0; });
  });
  return matrix;
}

function stringCell_(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

function objectFromPairs_(pairs) {
  var obj = {};
  pairs.forEach(function (pair) { obj[pair[0]] = pair[1]; });
  return obj;
}

function resultsJson_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
