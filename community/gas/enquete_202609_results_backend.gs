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
 *    /exec?action=public も開き、{ok:true,...} のJSONが返ることを確認する
 *    （community/enquete_202609.html の公開表示が同じ /exec URLを使う）。
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
 * ── 公開API（Issue #215） ──
 * ?action=public は、community/enquete_202609.html の一般公開セクション向けの
 * 読み取り専用レスポンスを返す。?action=summary（運営用）とはキャッシュ・レスポンス内容とも
 * 完全に分離しており、以下を追加で絶対に返さない：
 * - source_channel（流入元）
 * - 個人単位の参加温度感
 * - 実回答人数が3人未満（0〜2人）の日の正確な人数（raw_countをnullにし、raw_count_labelで
 *   「少数」とのみ表現する。0/1/2のどれかをレスポンスから推測できない設計にする）
 * - 参加見込み人数（熱量補正）が内部未丸め値で4.0以下の日の衣装カテゴリ・票数
 *   （該当日はレスポンスにwear_votesキー自体を含めない）
 * 詳細はbuildPublicSummary_()のコメントを参照。
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

/* 公開ダッシュボード（Issue #215）の「参加見込み人数（参考）」＝熱量補正の係数。
   調整しやすいよう、係数はこの1箇所にだけ定義する。「名古屋は遠い」は強い参加意向とは
   独立した係数（0.20）として扱い、他のどのカテゴリとも合算しない。 */
var PUBLIC_INTENT_WEIGHTS = {
  '日程が合えばかなり参加したい': 1.00,
  '条件（料金・人数など）が合えば参加を検討したい': 0.70,
  '興味はあるが参加までは分からない': 0.35,
  '参加してみたいが、名古屋は遠い': 0.20,
  '見るだけ・投票だけ': 0.10
};

/* 公開ダッシュボードの実回答人数マスキング閾値。この人数未満（0〜2人）は
   正確な数を返さず「少数」ラベルのみ返す。 */
var PUBLIC_RAW_COUNT_MASK_THRESHOLD = 3;

/* 公開ダッシュボードの衣装カテゴリ公開ゲート。日付ごとの参加見込み人数（内部の未丸め値）が
   この値を「超えた」場合だけ衣装カテゴリ・票数を公開する（4.0ちょうどは非公開）。
   表示用に小数第2位以下切り捨てした値ではなく、必ず内部未丸め値で判定すること。 */
var PUBLIC_ADJUSTED_GATE_THRESHOLD = 4.0;

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
  var action = e && e.parameter ? String(e.parameter.action || '') : '';

  if (action === 'public') {
    try {
      var publicCache = CacheService.getScriptCache();
      var cachedPublic = publicCache.get('public_v1');
      if (cachedPublic) {
        return ContentService.createTextOutput(cachedPublic).setMimeType(ContentService.MimeType.JSON);
      }

      var publicSummary = buildPublicSummary_();
      var encodedPublic = JSON.stringify(publicSummary);
      publicCache.put('public_v1', encodedPublic, RESULTS_CACHE_SECONDS);
      return ContentService.createTextOutput(encodedPublic).setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
      // 公開APIは必要最小限の方針のため、GAS/Spreadsheet側の内部例外文言をクライアントへ
      // 返さない（レビュー指摘）。詳細はサーバー側ログにのみ残す。
      console.error('[enquete_202609_results] public_error: ' + err);
      return resultsJson_({ ok: false, error: 'public_error' });
    }
  }

  if (action !== 'summary') {
    return resultsJson_({
      ok: true,
      service: 'SNBC enquete_202609 anonymous summary API',
      usage: '?action=summary（運営用）／ ?action=public（公開用）'
    });
  }

  try {
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

/**
 * 公開ダッシュボード（Issue #215）向けの読み取り専用レスポンスを組み立てる。
 * buildSurveySummary_()（運営用）とはロジックを分離し、日付ごとに必要最小限だけを返す。
 *
 * 各日付について：
 * - raw_count / raw_count_label：実回答人数。3人未満（0〜2人）は正確な数を返さず、
 *   raw_countをnull、raw_count_labelを「少数」とする（HTML側だけで隠すのではなく
 *   レスポンス自体から除外する）。
 * - adjusted_count：参加見込み人数（熱量補正）。表示用に小数第2位以下を切り捨てた値。
 *   四捨五入はしない。
 * - wear_votes：衣装カテゴリごとの票数（Q2の複数回答を1選択＝1票として積算、熱量係数は
 *   掛けない）。内部の未丸め熱量補正値が PUBLIC_ADJUSTED_GATE_THRESHOLD を「超えた」日だけ
 *   キー自体を含める。超えない日はwear_votesキーをレスポンスに含めない
 *   （正確な票数をNetwork/JSONから推測できる構造にしない）。
 * - has_responses：サーベイ全体で有効な回答が1件でもあるか（0件時の空状態表示に使う、
 *   個々の日付人数は含まない集計済みbooleanのみ）。
 */
function buildPublicSummary_() {
  var ss = SpreadsheetApp.openById(RESULTS_SPREADSHEET_ID);
  var sheet = ss.getSheetByName(RESULTS_SHEET_NAME);
  if (!sheet) throw new Error('responses sheet not found');

  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  if (lastColumn < 1) throw new Error('header not found');

  var headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  var index = {};
  headers.forEach(function (name, i) { index[String(name)] = i; });

  var required = ['q1_first_choice', 'q2_wear_items', 'q3_participation_intent'];
  RESULTS_DATE_COLUMNS.forEach(function (pair) { required.push(pair[0]); });
  required.forEach(function (name) {
    if (index[name] === undefined) throw new Error('required column missing: ' + name);
  });

  var rows = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues() : [];

  var dateKeys = RESULTS_DATE_COLUMNS.map(function (pair) { return pair[0]; });
  var rawCount = zeroMap_(dateKeys);
  var adjustedCount = zeroMap_(dateKeys); // 内部未丸め値（熱量補正の合計）
  var wearVotesByDate = {};
  dateKeys.forEach(function (key) { wearVotesByDate[key] = {}; });

  var hasResponses = false;

  rows.forEach(function (row) {
    var q1 = stringCell_(row[index.q1_first_choice]);
    if (RESULTS_VALID_Q1_CODES.indexOf(q1) === -1) return;
    hasResponses = true;

    var intent = stringCell_(row[index.q3_participation_intent]);
    var weight = PUBLIC_INTENT_WEIGHTS[intent];
    if (weight === undefined) weight = 0; // 想定外・空欄の参加温度感は熱量補正0として扱う
    var wears = splitMulti_(row[index.q2_wear_items]);

    RESULTS_DATE_COLUMNS.forEach(function (pair) {
      var key = pair[0];
      if (row[index[key]] !== true) return;
      rawCount[key] += 1;
      adjustedCount[key] += weight;
      wears.forEach(function (wear) {
        wearVotesByDate[key][wear] = (wearVotesByDate[key][wear] || 0) + 1;
      });
    });
  });

  var dates = RESULTS_DATE_COLUMNS.map(function (pair) {
    var key = pair[0];
    var label = pair[1];
    var raw = rawCount[key];
    var internalAdjusted = adjustedCount[key];
    // 浮動小数点の丸め誤差でゲート判定がぶれないよう、比較直前だけ丸めてから判定する
    // （係数はすべて0.05刻みのため、この丸めが実際の値をねじ曲げることはない）。
    var comparableAdjusted = Math.round(internalAdjusted * 1e6) / 1e6;
    var gateOpen = comparableAdjusted > PUBLIC_ADJUSTED_GATE_THRESHOLD;

    var entry = {
      date_code: key,
      date_label: label,
      adjusted_count: truncate1_(internalAdjusted)
    };

    if (raw < PUBLIC_RAW_COUNT_MASK_THRESHOLD) {
      entry.raw_count = null;
      entry.raw_count_label = '少数';
    } else {
      entry.raw_count = raw;
      entry.raw_count_label = raw + '人';
    }

    if (gateOpen) {
      entry.wear_votes = sortObjectKeys_(wearVotesByDate[key]);
    }
    // gateOpenがfalseの場合はwear_votesキー自体を含めない（意図的）。

    return entry;
  });

  return {
    ok: true,
    updated_at: Utilities.formatDate(new Date(), 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ssXXX"),
    has_responses: hasResponses,
    dates: dates
  };
}

/**
 * 小数第2位以下を切り捨てて小数第1位までにする（四捨五入しない）。
 * 例：3.79→3.7、3.75→3.7、4.09→4.0、4.19→4.1。
 * 表示専用の丸めであり、公開ゲート判定には使わない値（呼び出し元で内部未丸め値を別途保持する）。
 */
function truncate1_(value) {
  return Math.floor(value * 10 + 1e-9) / 10;
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
