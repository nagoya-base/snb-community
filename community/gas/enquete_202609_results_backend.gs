/**
 * SNBC 2026年9月企画アンケート｜運営用匿名集計API
 * Issue #211
 *
 * 目的：responses Sheetの個票をブラウザへ返さず、開催判断に必要なクロス集計だけをJSONで返す。
 * このスクリプトは回答受付GASとは分離し、読み取り専用の別Web Appとしてデプロイする。
 *
 * ── デプロイ手順 ──
 * 1. Google Apps Scriptで新しいスクリプトプロジェクトを作成し、このファイルの内容を貼り付ける。
 * 2. 「デプロイ」→「新しいデプロイ」→「ウェブアプリ」。
 * 3. 実行ユーザーは自分、アクセス権はダッシュボードからGETできる設定にする。
 * 4. 発行された /exec URL を community/enquete_202609_results.html の
 *    RESULTS_GAS_ENDPOINT に設定する。
 * 5. /exec?action=summary を開き、{ok:true,...} のJSONが返ることを確認する。
 *
 * APIレスポンスへ絶対に含めないもの：
 * - submission_id
 * - contact_email
 * - contact_x
 * - free_comment
 * - 個々の回答行
 */

var RESULTS_SPREADSHEET_ID = '1xM5kAX53Vfv6buNSQ2Y2QvYTRrCNUtWa2Zt59j2iaFI';
var RESULTS_SHEET_NAME = 'responses';
var RESULTS_CACHE_SECONDS = 30;

var RESULTS_Q1_LABELS = {
  school_set: '学校セット撮影会',
  uniform_event: 'ユニフォーム交流会',
  either: 'どちらでもよい',
  not_interested: '今回は特に参加しない'
};

var RESULTS_INTENTS = [
  '日程が合えばかなり参加したい',
  '条件（料金・人数など）が合えば参加を検討したい',
  '興味はあるが参加までは分からない',
  '見るだけ・投票だけ'
];

var RESULTS_STRONG_INTENTS = [
  '日程が合えばかなり参加したい',
  '条件（料金・人数など）が合えば参加を検討したい'
];

var RESULTS_STYLE_LABELS = {
  style_4000_4_drink: '4人｜4,000円',
  style_3500_5to6_drink: '5〜6人｜3,500円',
  style_3000_7to8_nodrink: '7〜8人｜3,000円',
  style_2000_9to12_nodrink: '9〜12人｜2,000円'
};

var RESULTS_SOURCE_LABELS = {
  x_ataru: 'X：アタル',
  x_snb: 'X：Studio Nagoya Base',
  x_studio_x: 'X：Studio X',
  snbc_web: 'SNBCサイト',
  instagram: 'Instagram',
  friend: '知人から',
  other: 'その他'
};

var RESULTS_DATE_COLUMNS = [
  ['date_0905', '9/5（土）'],
  ['date_0906', '9/6（日）'],
  ['date_0912', '9/12（土）'],
  ['date_0913', '9/13（日）'],
  ['date_0919', '9/19（土）'],
  ['date_0920', '9/20（日）'],
  ['date_0926', '9/26（土）'],
  ['date_0927', '9/27（日）']
];

function doGet(e) {
  try {
    var action = e && e.parameter ? String(e.parameter.action || '') : '';
    if (action !== 'summary') {
      return resultsJson_({
        ok: true,
        service: 'SNBC enquete_202609 anonymous summary API',
        usage: '?action=summary'
      });
    }

    var cache = CacheService.getScriptCache();
    var cached = cache.get('summary_v1');
    if (cached) {
      return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON);
    }

    var summary = buildSurveySummary_();
    var encoded = JSON.stringify(summary);
    cache.put('summary_v1', encoded, RESULTS_CACHE_SECONDS);
    return ContentService.createTextOutput(encoded).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return resultsJson_({ ok: false, error: 'summary_error', message: String(err) });
  }
}

function buildSurveySummary_() {
  var ss = SpreadsheetApp.openById(RESULTS_SPREADSHEET_ID);
  var sheet = ss.getSheetByName(RESULTS_SHEET_NAME);
  if (!sheet) throw new Error('responses sheet not found');

  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  if (lastColumn < 1) throw new Error('header not found');

  var headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  var index = {};
  headers.forEach(function (name, i) { index[String(name)] = i; });

  var required = [
    'q1_first_choice', 'q2_wear_items', 'q3_participation_intent',
    'q4_price', 'source_channel'
  ];
  RESULTS_DATE_COLUMNS.forEach(function (pair) { required.push(pair[0]); });
  required.forEach(function (name) {
    if (index[name] === undefined) throw new Error('required column missing: ' + name);
  });

  var rows = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues() : [];

  var q1Codes = Object.keys(RESULTS_Q1_LABELS);
  var styleCodes = Object.keys(RESULTS_STYLE_LABELS);
  var sourceCodes = Object.keys(RESULTS_SOURCE_LABELS);

  var formatIntent = makeMatrix_(q1Codes, RESULTS_INTENTS);
  var formatStyle = makeMatrix_(q1Codes, styleCodes);
  var dateIntent = makeMatrix_(RESULTS_DATE_COLUMNS.map(function (pair) { return pair[0]; }), RESULTS_INTENTS);
  var wearIntent = {};
  var wearSource = {};
  var formatStrong = zeroMap_(q1Codes);
  var wearStrong = {};
  var dateStrong = zeroMap_(RESULTS_DATE_COLUMNS.map(function (pair) { return pair[0]; }));
  var strongIntentTotal = 0;
  var total = 0;

  rows.forEach(function (row) {
    var q1 = stringCell_(row[index.q1_first_choice]);
    var intent = stringCell_(row[index.q3_participation_intent]);
    var style = stringCell_(row[index.q4_price]);
    var source = stringCell_(row[index.source_channel]);
    var wears = splitMulti_(row[index.q2_wear_items]);
    var isStrong = RESULTS_STRONG_INTENTS.indexOf(intent) !== -1;

    // PR #210以降の新形式回答だけを集計対象にする。
    if (q1Codes.indexOf(q1) === -1) return;
    total += 1;
    if (isStrong) strongIntentTotal += 1;

    incrementMatrix_(formatIntent, q1, intent);
    incrementMatrix_(formatStyle, q1, style);
    if (isStrong) formatStrong[q1] += 1;

    RESULTS_DATE_COLUMNS.forEach(function (pair) {
      var key = pair[0];
      if (row[index[key]] === true) {
        incrementMatrix_(dateIntent, key, intent);
        if (isStrong) dateStrong[key] += 1;
      }
    });

    wears.forEach(function (wear) {
      ensureMatrixRow_(wearIntent, wear, RESULTS_INTENTS);
      ensureMatrixRow_(wearSource, wear, sourceCodes);
      if (wearStrong[wear] === undefined) wearStrong[wear] = 0;
      incrementMatrix_(wearIntent, wear, intent);
      incrementMatrix_(wearSource, wear, source);
      if (isStrong) wearStrong[wear] += 1;
    });
  });

  return {
    ok: true,
    total: total,
    strong_intent_total: strongIntentTotal,
    updated_at: Utilities.formatDate(new Date(), 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ssXXX"),
    labels: {
      q1: RESULTS_Q1_LABELS,
      intents: RESULTS_INTENTS,
      styles: RESULTS_STYLE_LABELS,
      sources: RESULTS_SOURCE_LABELS,
      dates: objectFromPairs_(RESULTS_DATE_COLUMNS)
    },
    format_intent: formatIntent,
    wear_intent: sortObjectKeys_(wearIntent),
    format_style: formatStyle,
    date_intent: dateIntent,
    wear_source: sortObjectKeys_(wearSource),
    strong: {
      format: formatStrong,
      wear: sortObjectKeys_(wearStrong),
      date: dateStrong
    }
  };
}

function makeMatrix_(rows, columns) {
  var matrix = {};
  rows.forEach(function (row) {
    matrix[row] = {};
    columns.forEach(function (column) { matrix[row][column] = 0; });
  });
  return matrix;
}

function zeroMap_(keys) {
  var map = {};
  keys.forEach(function (key) { map[key] = 0; });
  return map;
}

function ensureMatrixRow_(matrix, row, columns) {
  if (matrix[row]) return;
  matrix[row] = {};
  columns.forEach(function (column) { matrix[row][column] = 0; });
}

function incrementMatrix_(matrix, row, column) {
  if (!matrix[row] || matrix[row][column] === undefined) return;
  matrix[row][column] += 1;
}

function splitMulti_(value) {
  var text = stringCell_(value);
  if (!text) return [];
  return text.split('、').filter(function (item) { return item !== ''; });
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

function sortObjectKeys_(obj) {
  var sorted = {};
  Object.keys(obj).sort().forEach(function (key) { sorted[key] = obj[key]; });
  return sorted;
}

function resultsJson_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
