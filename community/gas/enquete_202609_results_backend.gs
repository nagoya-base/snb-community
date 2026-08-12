/**
 * SNBC 2026年9月企画アンケート｜運営用匿名集計API
 * Issue #211 で新設、Issue #213 で学校セット開催決定に伴い再構成
 * （開催形式系クロス集計を廃止し、開催スタイル分布・参加温度感「名古屋は遠い」件数を追加）。
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
 * - q2_wear_other（Issue #213で追加した自由記述）
 * - source_other（Issue #213で追加した自由記述）
 * - 個々の回答行
 *
 * ── 旧流入元コードの扱い（Issue #213） ──
 * Issue #213以前の回答には source_channel に x_snb / x_studio_x / instagram が
 * 保存されている可能性がある。運営からの明示指示（Issue #213コメント）に従い、これらを
 * 勝手に 'other' へ丸めず、'legacy_other_source'（旧流入元・整理前の回答）という
 * 別カテゴリへ明示的に分離して集計する。生コードそのものをAPIレスポンスへ出力することはない。
 */

var RESULTS_SPREADSHEET_ID = '1xM5kAX53Vfv6buNSQ2Y2QvYTRrCNUtWa2Zt59j2iaFI';
var RESULTS_SHEET_NAME = 'responses';
var RESULTS_CACHE_SECONDS = 30;

/* Q1はIssue #213で画面から削除し内部固定値'school_set'のみを新規保存するが、
   PR #210〜Issue #213の間に保存された行にはこの4値のいずれかが入っている。
   「新形式スキーマの行かどうか」を判定するためだけに使用し、
   値そのものをAPIレスポンスへ出力する用途にはもう使わない（開催形式別クロス集計は廃止）。 */
var RESULTS_VALID_Q1_CODES = ['school_set', 'uniform_event', 'either', 'not_interested'];

var RESULTS_INTENTS = [
  '日程が合えばかなり参加したい',
  '条件（料金・人数など）が合えば参加を検討したい',
  '参加してみたいが、名古屋は遠い', // Issue #213で追加。
  '興味はあるが参加までは分からない',
  '見るだけ・投票だけ'
];

var RESULTS_STRONG_INTENTS = [
  '日程が合えばかなり参加したい',
  '条件（料金・人数など）が合えば参加を検討したい'
];

/* 「参加してみたいが、名古屋は遠い」は単なる低関心と分離するため、強い参加意向には含めず、
   別カテゴリとして件数だけ提供する（Issue #213）。 */
var RESULTS_NAGOYA_FAR_INTENT = '参加してみたいが、名古屋は遠い';

var RESULTS_STYLE_LABELS = {
  style_4000_4_drink: '4人｜4,000円',
  style_3500_5to6_drink: '5〜6人｜3,500円',
  style_3000_7to8_nodrink: '7〜8人｜3,000円',
  style_2000_9to12_nodrink: '9〜12人｜2,000円'
};

/* 流入元：Issue #213でx_ataru/x_repost/snbc_web/friend/otherの5値に整理。 */
var RESULTS_SOURCE_LABELS = {
  x_ataru: 'X：アタル',
  x_repost: 'Xのリポストから',
  snbc_web: 'SNBCサイト',
  friend: '知人からの誘い',
  other: 'その他'
};
/* Issue #213以前にのみ存在しうる旧流入元コード。'other'へは丸めず、別カテゴリへ分離する。 */
var RESULTS_LEGACY_SOURCE_CODES = ['x_snb', 'x_studio_x', 'instagram'];
var RESULTS_LEGACY_SOURCE_KEY = 'legacy_other_source';
var RESULTS_LEGACY_SOURCE_LABEL = '旧流入元（整理前の回答）';

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

  // q2_wear_other / source_other はIssue #213のマイグレーション前の旧ヘッダーには
  // 存在しない場合があるため必須列には含めない（そもそもこのAPIは両者を返さない）。
  var required = [
    'q1_first_choice', 'q2_wear_items', 'q3_participation_intent',
    'q4_price', 'source_channel'
  ];
  RESULTS_DATE_COLUMNS.forEach(function (pair) { required.push(pair[0]); });
  required.forEach(function (name) {
    if (index[name] === undefined) throw new Error('required column missing: ' + name);
  });

  var rows = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues() : [];

  var styleCodes = Object.keys(RESULTS_STYLE_LABELS);
  var sourceCodes = Object.keys(RESULTS_SOURCE_LABELS);
  var wearSourceColumns = sourceCodes.concat([RESULTS_LEGACY_SOURCE_KEY]);
  var dateKeys = RESULTS_DATE_COLUMNS.map(function (pair) { return pair[0]; });

  var dateIntent = makeMatrix_(dateKeys, RESULTS_INTENTS);
  var wearIntent = {};
  var wearSource = {};
  var wearStrong = {};
  var dateStrong = zeroMap_(dateKeys);
  var styleDistribution = zeroMap_(styleCodes);
  var strongIntentTotal = 0;
  var nagoyaFarTotal = 0;
  var total = 0;

  rows.forEach(function (row) {
    var q1 = stringCell_(row[index.q1_first_choice]);
    // PR #210以降の新形式回答だけを集計対象にする（Q1のUI削除は集計対象の判定条件を変えない）。
    if (RESULTS_VALID_Q1_CODES.indexOf(q1) === -1) return;

    var intent = stringCell_(row[index.q3_participation_intent]);
    var style = stringCell_(row[index.q4_price]);
    var rawSource = stringCell_(row[index.source_channel]);
    // 新流入元コードはそのまま、旧流入元コードはlegacyキーへ明示的に分離、
    // それ以外の想定外の値はsourceをnullにしてwear_sourceの集計から除外する。
    var source = null;
    if (RESULTS_SOURCE_LABELS[rawSource] !== undefined) {
      source = rawSource;
    } else if (RESULTS_LEGACY_SOURCE_CODES.indexOf(rawSource) !== -1) {
      source = RESULTS_LEGACY_SOURCE_KEY;
    }
    var wears = splitMulti_(row[index.q2_wear_items]);
    var isStrong = RESULTS_STRONG_INTENTS.indexOf(intent) !== -1;
    var isNagoyaFar = intent === RESULTS_NAGOYA_FAR_INTENT;

    total += 1;
    if (isStrong) strongIntentTotal += 1;
    if (isNagoyaFar) nagoyaFarTotal += 1;
    if (styleDistribution[style] !== undefined) styleDistribution[style] += 1;

    RESULTS_DATE_COLUMNS.forEach(function (pair) {
      var key = pair[0];
      if (row[index[key]] === true) {
        incrementMatrix_(dateIntent, key, intent);
        if (isStrong) dateStrong[key] += 1;
      }
    });

    wears.forEach(function (wear) {
      ensureMatrixRow_(wearIntent, wear, RESULTS_INTENTS);
      if (wearStrong[wear] === undefined) wearStrong[wear] = 0;
      incrementMatrix_(wearIntent, wear, intent);
      if (isStrong) wearStrong[wear] += 1;

      if (source !== null) {
        ensureMatrixRow_(wearSource, wear, wearSourceColumns);
        incrementMatrix_(wearSource, wear, source);
      }
    });
  });

  var sourceLabelsForResponse = {};
  Object.keys(RESULTS_SOURCE_LABELS).forEach(function (key) { sourceLabelsForResponse[key] = RESULTS_SOURCE_LABELS[key]; });
  sourceLabelsForResponse[RESULTS_LEGACY_SOURCE_KEY] = RESULTS_LEGACY_SOURCE_LABEL;

  return {
    ok: true,
    total: total,
    strong_intent_total: strongIntentTotal,
    nagoya_far_total: nagoyaFarTotal,
    updated_at: Utilities.formatDate(new Date(), 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ssXXX"),
    labels: {
      intents: RESULTS_INTENTS,
      styles: RESULTS_STYLE_LABELS,
      sources: sourceLabelsForResponse,
      dates: objectFromPairs_(RESULTS_DATE_COLUMNS)
    },
    style_distribution: styleDistribution,
    wear_intent: sortObjectKeys_(wearIntent),
    date_intent: dateIntent,
    wear_source: sortObjectKeys_(wearSource),
    strong: {
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
