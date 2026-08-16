/**
 * SNBC 2026年9月教室撮影会（9/12開催）｜正式申込 リアルタイム集計API
 * Issue #229 で新設。
 *
 * 目的：community/gas/classroom_20260912_backend.gs が保存する entries シートの個票を
 * ブラウザへ返さず、公開向け最小限表示・運営向け匿名集計だけをJSONで返す。
 * このスクリプトは正式申込を保存する回答受付GAS（classroom_20260912_backend.gs）とは
 * 完全に分離した読み取り専用の別Web Appとしてデプロイする。既存の回答保存GASの
 * /exec URLは流用しない。回答保存GAS自体・entriesシートへの書き込みロジックは
 * このファイルでは一切変更しない（読み取り専用）。
 *
 * ── 初回デプロイ手順 ──
 * 1. 新しいGoogle Apps Scriptプロジェクトを作成する
 *    （community/gas/classroom_20260912_backend.gsとは別プロジェクト）。
 * 2. デフォルトのCode.gsの内容をこのファイルの内容で置き換える。
 * 3. 正式申込データが保存されているスプレッドシートのIDを
 *    RESULTS_SPREADSHEET_ID に設定する。
 * 4. RESULTS_SHEET_NAME が 'entries' になっていることを確認する
 *    （classroom_20260912_backend.gs のSHEET_NAMEと一致させる）。
 * 5. PUBLIC_ENTRY_STATUS を、community/classroom_20260912.html の
 *    ENTRY_STATUS と同じ値に設定する（'preparing' | 'open' | 'waitlist' | 'closed'）。
 * 6. 「デプロイ」→「新しいデプロイ」→種類「ウェブアプリ」を選択し、
 *    実行ユーザー「自分」、アクセスできるユーザー「全員」で新規デプロイする
 *    （既存の回答保存GASのデプロイを更新するのではなく、新規のWeb Appとして発行する）。
 * 7. 発行された /exec URL をブラウザで開き、action未指定時のデフォルトレスポンス
 *    {"ok":true,"service":"SNBC classroom_20260912 anonymous results API","usage":"..."}
 *    が返ることを確認する（doGet()のaction未指定分岐の実装と一致させている。
 *    回答保存GAS側の「backend: OK」というプレーンテキスト応答とは異なるので注意）。
 * 8. /exec?action=public を開き、{"ok":true, ...} のJSONが返ることを確認する。
 * 9. /exec?action=summary を開き、{"ok":true, ...} のJSONが返ることを確認する。
 * 10. 発行された /exec URL を、以下の両方に設定する。
 *     - community/enquete_202609.html（PUBLIC_STATUS ENDPOINT定数、9/12申込状況カード）
 *     - community/classroom_20260912_results.html（運営用ダッシュボード）
 *
 * ── 受付状態変更時の運用（重要） ──
 * 受付状態は募集ページと集計GASの2箇所を同時更新する。
 * 1. community/classroom_20260912.html の ENTRY_STATUS
 * 2. このファイルの PUBLIC_ENTRY_STATUS
 * 片方だけ変更すると、募集ページの実際の受付状態と公開カードの表示が食い違うため、
 * 必ず同じタイミングで両方を書き換えてデプロイ（clasp等を使わない場合は
 * Apps Scriptエディタで直接編集して保存）すること。
 *
 * ── APIレスポンスへ絶対に含めないもの（public / summary 共通） ──
 * - submission_id
 * - display_name
 * - contact_email
 * - contact_x
 * - wear_other（自由記述本文）
 * - concern_other（自由記述本文）
 * - free_comment
 * - timestampの個票値
 * - 個々の回答行
 *
 * 運営用ダッシュボードであっても、氏名・連絡先・自由記述の閲覧はGoogleスプレッドシートを
 * 正とする。GitHub Pages側（?action=summary含む）へPIIを一切持ち出さない設計にしている。
 *
 * ── 公開API（?action=public）の追加制約 ──
 * 今回のイベントは定員5〜6名程度の非常に小さい母集団のため、既存の
 * community/gas/enquete_202609_results_backend.gs の公開粒度よりさらに保守的にする。
 * - 衣装カテゴリ名・カテゴリ別票数・衣装内訳オブジェクトは、キー自体を一切含めない
 *   （母集団が小さいと、カテゴリ単位の1〜2票からでも残り人数との差し引きで
 *   個人の衣装傾向を推測できるため）。
 * - 希望・不安の内訳、初参加割合、衣装貸出希望件数、open/waitlistの件数内訳、
 *   entry_modeの個別内訳も一切返さない。
 * - 申込件数は、0件は正確な0件として返してよいが、1〜2件は「少数」とだけ表現し、
 *   正確な数（1か2か）をレスポンスから推測できないようにする。3件以上のみ実数を返す。
 *
 * ── エラー処理 ──
 * public / summary どちらも、GAS/Spreadsheet側の内部例外文言（スプレッドシートIDや
 * スタックトレース等）をレスポンスへ返さない。固定エラーコードのみ返し、詳細は
 * console.error() でGAS側の実行ログにのみ残す。
 */

var RESULTS_SPREADSHEET_ID = '1hyzWKssp6LVpP_KZlOucmKCZIMg7puooFYFaaz2hsNg';
var RESULTS_SHEET_NAME = 'entries';
var RESULTS_CACHE_SECONDS = 45; // 30〜60秒の目安内。public/summaryでキャッシュキーを分離して使う。

/* 公開受付状態フラグ。community/classroom_20260912.html の ENTRY_STATUS と同じ運営状態を
   表す。値を変更するときは、必ず募集ページ側のENTRY_STATUSも同時に変更すること
   （このファイル冒頭コメント「受付状態変更時の運用」を参照）。 */
var PUBLIC_ENTRY_STATUS = 'open'; // 'preparing' | 'open' | 'waitlist' | 'closed'
var ALLOWED_PUBLIC_ENTRY_STATUS = ['preparing', 'open', 'waitlist', 'closed'];

/* 公開APIの件数マスキング閾値。1〜2件（この値未満）は正確な数を返さず「少数」とする。 */
var PUBLIC_COUNT_MASK_THRESHOLD = 3;

/* ── entries シートの許可値allowlist（community/gas/classroom_20260912_backend.gsの
   allowlistと一致させること。フロント側HTMLの選択肢を変更した場合、保存GAS側の
   allowlistと合わせてこちらも必ず同時に更新する） ── */
var ALLOWED_WEAR_ITEMS = [
  '野球ユニフォーム', 'サッカーユニフォーム', '陸上ユニフォーム', 'ラグビー／アメフトウェア',
  'スイムウェア', 'シングレット', '制服・体操服', '私服', 'その他'
];
var ALLOWED_CONCERNS = [
  '一人参加が不安', '初対面の人との交流が不安', '撮られるのが苦手', '衣装を持っていない', '料金', 'その他'
];
var ALLOWED_FIRST_TIME = ['', 'yes', 'no'];
var ALLOWED_ENTRY_MODE = ['open', 'waitlist'];

function doGet(e) {
  var action = e && e.parameter ? String(e.parameter.action || '') : '';

  if (action === 'public') {
    return handlePublic_();
  }
  if (action === 'summary') {
    return handleSummary_();
  }

  return classroomJson_({
    ok: true,
    service: 'SNBC classroom_20260912 anonymous results API',
    usage: '?action=public（公開用）／ ?action=summary（運営用）'
  });
}

function handlePublic_() {
  try {
    var cache = CacheService.getScriptCache();
    var cached = cache.get('classroom_public_v1');
    if (cached) {
      return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON);
    }

    var publicSummary = buildPublicSummary_();
    var encoded = JSON.stringify(publicSummary);
    cache.put('classroom_public_v1', encoded, RESULTS_CACHE_SECONDS);
    return ContentService.createTextOutput(encoded).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    console.error('[classroom_20260912_results] public_error: ' + err);
    return classroomJson_({ ok: false, error: errorCodeFor_(err, 'public_error') });
  }
}

function handleSummary_() {
  try {
    var cache = CacheService.getScriptCache();
    var cached = cache.get('classroom_summary_v1');
    if (cached) {
      return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON);
    }

    var summary = buildSummary_();
    var encoded = JSON.stringify(summary);
    cache.put('classroom_summary_v1', encoded, RESULTS_CACHE_SECONDS);
    return ContentService.createTextOutput(encoded).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    console.error('[classroom_20260912_results] summary_error: ' + err);
    return classroomJson_({ ok: false, error: errorCodeFor_(err, 'summary_error') });
  }
}

/**
 * 意図的に投げた既知エラー（sheet_not_found / header_mismatch）はそのコードをそのまま使い、
 * それ以外の想定外の例外は内部文言を返さずfallbackコードに丸める。
 */
function errorCodeFor_(err, fallbackCode) {
  var message = err && err.message ? err.message : String(err);
  if (message === 'sheet_not_found' || message === 'header_mismatch') return message;
  return fallbackCode;
}

/**
 * entriesシートを開き、ヘッダー名から列位置を解決する。列番号固定には依存しない。
 * 戻り値：{ sheet: Sheet, index: {ヘッダー名: 0始まり列インデックス}, rows: 2行目以降の値 }
 */
function openEntriesSheet_(requiredColumns) {
  var ss = SpreadsheetApp.openById(RESULTS_SPREADSHEET_ID);
  var sheet = ss.getSheetByName(RESULTS_SHEET_NAME);
  if (!sheet) throw new Error('sheet_not_found');

  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  if (lastColumn < 1) throw new Error('header_mismatch');

  var headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  var index = {};
  headers.forEach(function (name, i) { index[String(name)] = i; });

  requiredColumns.forEach(function (name) {
    if (index[name] === undefined) throw new Error('header_mismatch');
  });

  var rows = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues() : [];
  return { index: index, rows: rows };
}

/**
 * 1行が集計対象として有効かどうかを判定する。
 * 保存GAS側では本来発生しないが、集計側でも盲信せず、agree_terms !== true や
 * entry_modeが許可値以外の不正行は安全に無視する。
 */
function isValidEntryRow_(row, index) {
  if (row[index.agree_terms] !== true) return false;
  var entryMode = stringCell_(row[index.entry_mode]);
  if (ALLOWED_ENTRY_MODE.indexOf(entryMode) === -1) return false;
  return true;
}

/**
 * 公開API（?action=public）向けレスポンスを組み立てる。
 * 母集団が5〜6名規模のため、受付状態＋申込総数の粒度だけにとどめる。
 * count_type: 'zero'（0件） | 'small'（1〜2件、正確な数は返さない） | 'exact'（3件以上、実数）
 */
function buildPublicSummary_() {
  var required = ['agree_terms', 'entry_mode'];
  var sheetData = openEntriesSheet_(required);
  var index = sheetData.index;

  var total = 0;
  sheetData.rows.forEach(function (row) {
    if (isValidEntryRow_(row, index)) total += 1;
  });

  var response = {
    ok: true,
    entry_status: ALLOWED_PUBLIC_ENTRY_STATUS.indexOf(PUBLIC_ENTRY_STATUS) !== -1 ? PUBLIC_ENTRY_STATUS : 'preparing',
    updated_at: nowIso_()
  };

  if (total === 0) {
    response.count_type = 'zero';
    response.count = 0;
  } else if (total < PUBLIC_COUNT_MASK_THRESHOLD) {
    response.count_type = 'small';
    response.count = null;
  } else {
    response.count_type = 'exact';
    response.count = total;
  }

  return response;
}

/**
 * 運営用API（?action=summary）向けレスポンスを組み立てる。
 * 単純集計のみを返し、1人単位の回答組み合わせを復元できるクロス集計は行わない。
 * wear_other / concern_other / free_comment の本文、display_name等のPIIは一切扱わない
 * （そもそも読み込む必要がないため、それらの列値は参照しない）。
 */
function buildSummary_() {
  var required = ['agree_terms', 'entry_mode', 'first_time', 'wear_items', 'wear_rental_requested', 'concerns'];
  var sheetData = openEntriesSheet_(required);
  var index = sheetData.index;

  var total = 0;
  var entryMode = { open: 0, waitlist: 0 };
  var firstTime = { yes: 0, no: 0, unanswered: 0 };
  var wearItems = zeroMapFromList_(ALLOWED_WEAR_ITEMS);
  var wearRentalRequested = { requested: 0, not_requested: 0 };
  var concerns = zeroMapFromList_(ALLOWED_CONCERNS);

  sheetData.rows.forEach(function (row) {
    if (!isValidEntryRow_(row, index)) return;
    total += 1;

    var mode = stringCell_(row[index.entry_mode]);
    entryMode[mode] += 1;

    var firstTimeValue = stringCell_(row[index.first_time]);
    if (ALLOWED_FIRST_TIME.indexOf(firstTimeValue) === -1) {
      firstTime.unanswered += 1;
    } else if (firstTimeValue === 'yes') {
      firstTime.yes += 1;
    } else if (firstTimeValue === 'no') {
      firstTime.no += 1;
    } else {
      firstTime.unanswered += 1;
    }

    splitAllowed_(row[index.wear_items], ALLOWED_WEAR_ITEMS).forEach(function (item) {
      wearItems[item] += 1;
    });

    // 保存GASはwear_rental_requestedを厳密なbooleanとしてのみ受け付けるため、
    // 集計側もtrue/falseだけを数え、異常値・空欄は「希望なし」へ丸めずに無視する
    // （集計対象外。not_requestedを不正確に膨らませない）。
    var rentalValue = row[index.wear_rental_requested];
    if (rentalValue === true) {
      wearRentalRequested.requested += 1;
    } else if (rentalValue === false) {
      wearRentalRequested.not_requested += 1;
    }

    splitAllowed_(row[index.concerns], ALLOWED_CONCERNS).forEach(function (item) {
      concerns[item] += 1;
    });
  });

  return {
    ok: true,
    updated_at: nowIso_(),
    total: total,
    entry_mode: entryMode,
    first_time: firstTime,
    wear_items: wearItems,
    wear_rental_requested: wearRentalRequested,
    concerns: concerns
  };
}

/**
 * '、'区切りの保存文字列を分解し、allowlistに存在する値だけを返す。
 * allowlist外の値（想定外データ）は静かに除外する。
 */
function splitAllowed_(value, allowlist) {
  var text = stringCell_(value);
  if (!text) return [];
  return text.split('、').filter(function (item) {
    return allowlist.indexOf(item) !== -1;
  });
}

function zeroMapFromList_(list) {
  var map = {};
  list.forEach(function (key) { map[key] = 0; });
  return map;
}

function stringCell_(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

function nowIso_() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function classroomJson_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
