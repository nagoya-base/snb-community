/**
 * SNBC 2026年9月教室撮影会（9/12開催）｜正式申込フォーム バックエンド
 * Issue #224 で新設。
 * community/classroom_20260912.html から呼び出される。
 *
 * このファイルはリポジトリ内の正本だが、実行環境はGoogle Apps Script側。
 * GitHubへpushするだけでは反映されないため、次の順で手動反映する。
 *
 * ── 初回デプロイ手順 ──
 * 1. 新規のGoogleスプレッドシートを作成する（既存9月アンケートの回答シートとは
 *    別のスプレッドシートにする。正式申込データを既存アンケート回答と混在させないため）。
 * 2. 「拡張機能」→「Apps Script」を開き、デフォルトのCode.gsの内容をこのファイルの
 *    内容で置き換える。
 * 3. NOTIFICATION_EMAIL が実運用の通知先アドレスになっていることを確認する。
 * 4. Apps Scriptエディタの関数選択で setupHeaderRow() を選び、実行してヘッダー行
 *    （14列：timestamp 〜 entry_mode）を作成する。
 * 5. 「デプロイ」→「新しいデプロイ」→種類「ウェブアプリ」を選択し、
 *    実行ユーザー「自分」、アクセスできるユーザー「全員」でデプロイする
 *    （これは新規の正式申込バックエンドであり、既存9月アンケートGASの更新ではない。
 *    既存アンケートの /exec URLは流用しない）。
 * 6. デプロイ完了時に発行される新しい /exec URLを、
 *    community/classroom_20260912.html の GAS_ENDPOINT_URL に設定する
 *    （現在はプレースホルダーが入っている）。
 * 7. /exec URLをブラウザで開き、backend: OK と表示されることを確認する。
 * 8. 公開後、実際のページ（?test=1を付けずに）から実申込を1件送信し、
 *    Sheets保存内容（14列目まで）と通知メールを確認する。
 *
 * ── この版の仕様 ──
 * ・display_name（表示名／ハンドルネーム）は必須・30文字以内。
 * ・contact_email / contact_x はそれぞれ200文字以内。どちらか1つ以上が必須。
 * ・wear_items（参加予定の衣装）は複数選択必須（`、`区切りの文字列、1件以上）。
 *   「その他」を含む場合は wear_other（50文字以内）が必須、含まない場合は空文字列のみ許可する。
 * ・wear_rental_requested（衣装貸出希望）・first_time（初参加かどうか）は任意。
 * ・concerns（撮影についての希望・不安）は複数選択・任意。
 *   「その他」を含む場合は concern_other（200文字以内）が必須、含まない場合は空文字列のみ許可する。
 * ・free_comment（自由記述）は任意・300文字以内。
 * ・agree_terms（利用規約・参加ルールへの同意）は必須（true固定）。
 * ・entry_mode（open / waitlist）はフロント側のENTRY_STATUSに連動する参考値。
 *   運営が実際の対応（通常受付／キャンセル待ち）を判断するための補助情報であり、
 *   このファイル側で受付可否そのものを制御するものではない。
 * ・自由入力（display_name / contact_email / contact_x / wear_other / concern_other /
 *   free_comment）は数式インジェクション対策をしてSheetsへ保存する。
 * ・submission_id、LockService、重複送信時の保存・通知抑止を維持する
 *   （community/gas/enquete_202609_backend.gsと同じ安全な送信実装を踏襲）。
 * ・通知メール本文には連絡先・自由記述・submission_idを含めない
 *   （既存9月アンケートGAS・Issue #192の方針を踏襲。詳細はSheets側で確認する運用とする）。
 */

var SHEET_NAME = 'entries';

/* 新しい申込が保存されたときの通知先。デプロイ手順3の通り、実際の運営者アドレスであることを確認すること。 */
var NOTIFICATION_EMAIL = 'bbuni.ngo@gmail.com';

var NOTIFICATION_EMAIL_SUBJECT = '【SNBC】9月12日教室撮影会に新しい参加申込があります';

/* デプロイ手順4の通りsetupHeaderRow()でヘッダーを作成するまでは、
   新ヘッダー（14列）と一致しないため保存は成功しない
   （hasExpectedHeaderが列数・列名の完全一致を要求するため）。 */
var COLUMNS = [
  'timestamp',
  'submission_id',
  'display_name',
  'contact_email',
  'contact_x',
  'wear_items',
  'wear_other',
  'wear_rental_requested',
  'first_time',
  'concerns',
  'concern_other',
  'free_comment',
  'agree_terms',
  'entry_mode'
];

/* ── 許可値のallowlist（フロント側HTMLの選択肢と1対1で一致させること。
   選択肢の文言をHTML側で変更した場合、ここも必ず同時に更新する） ── */
/* 参加予定の衣装：現行9月アンケートq2_wear_itemsの語彙とできるだけ共通化している（Issue #224）。 */
var ALLOWED_WEAR_ITEMS = [
  '野球ユニフォーム', 'サッカーユニフォーム', '陸上ユニフォーム', 'ラグビー／アメフトウェア',
  'スイムウェア', 'シングレット', '制服・体操服', '私服', 'その他'
];
var WEAR_OTHER_VALUE = 'その他';

var ALLOWED_CONCERNS = [
  '一人参加が不安', '初対面の人との交流が不安', '撮られるのが苦手', '衣装を持っていない', '料金', 'その他'
];
var CONCERN_OTHER_VALUE = 'その他';

var ALLOWED_FIRST_TIME = ['', 'yes', 'no'];

var ALLOWED_ENTRY_MODE = ['open', 'waitlist'];

var MAX_DISPLAY_NAME_LENGTH = 30; // フロントのentry-name maxlengthと一致させる
var MAX_CONTACT_LENGTH = 200; // フロントのentry-email / entry-x maxlengthと一致させる
var MAX_WEAR_OTHER_LENGTH = 50; // フロントのwear-other maxlengthと一致させる
var MAX_CONCERN_OTHER_LENGTH = 200; // フロントのconcern-other maxlengthと一致させる
var MAX_FREE_COMMENT_LENGTH = 300; // フロントのfree-comment maxlengthと一致させる
var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; // 簡易チェック（RFC完全準拠ではない）
var MAX_SUBMISSION_ID_LENGTH = 100; // crypto.randomUUID()は36文字、フォールバック生成でも数十文字程度のため十分な余裕
/* submission_idの文字集合を英数字・ハイフンのみ、かつ先頭は英数字に制限する（PR #227レビュー指摘）。
   sanitizeForSheetは先頭が =, +, -, @ の場合に保存値の先頭へ'を付与するが、isDuplicateSubmissionは
   保存前の生のsubmission_idと既存シート値（＝sanitizeForSheet適用後の値）を比較しているため、
   もしsubmission_idの先頭文字を制限しないと、細工したPOSTで「保存値と比較値が食い違う」ことで
   重複判定をすり抜けられてしまう。この正規表現により、正規のUUID／フォールバック生成値はそのまま
   許可しつつ、先頭が =, +, -, @ になり得る値を根本的に拒否し、sanitizeForSheetが
   submission_idに対して実質的に無害（no-op）であることを保証する。 */
var SUBMISSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/;

/**
 * Googleスプレッドシートの数式インジェクション対策。
 * 自由入力欄（display_name / contact_email / contact_x / wear_other / concern_other /
 * free_comment / submission_id）は、先頭が =, +, -, @ の場合にスプレッドシート側で
 * 数式として解釈される可能性があるため、先頭に ' を付けて強制的に文字列として保存する。
 * allowlistで検証済みのwear_items / concerns / first_time / entry_mode等には適用不要
 * （許可された固定文言のみのため）。
 */
function sanitizeForSheet(value) {
  if (typeof value !== 'string') return value;
  if (/^[=+\-@]/.test(value)) {
    return "'" + value;
  }
  return value;
}

function doGet(e) {
  var message = 'SNBC classroom_20260912 backend: OK';
  if (NOTIFICATION_EMAIL === 'YOUR_NOTIFICATION_EMAIL') {
    message += '\n[WARNING] NOTIFICATION_EMAIL が未設定です（プレースホルダーのままです）。' +
      'このままでは運営者への通知メールが送信されません。実際の宛先へ書き換えてください。';
  }
  return ContentService.createTextOutput(message);
}

/**
 * リクエストの内容を検証する。フロント側でも同じ制約を検証済みだが、
 * このWebアプリは公開エンドポイントであり、フォームを介さず直接POSTされる可能性がある
 * ため、連絡先という個人情報を保存する以上、フロントを信用せずサーバー側でも
 * 同じ制約を再検証する。
 * 戻り値：問題なければnull、問題があればエラーコード文字列。
 */
function validatePayload(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 'payload_invalid';

  // submission_id：冪等性のキーとして使うため、型・長さに加えて文字集合も検証する。
  // 英数字・ハイフンのみ（先頭は英数字）に制限することで、sanitizeForSheetによる
  // 保存値の書き換えが発生しないことを保証し、重複判定（生値 vs 保存値）のズレを防ぐ
  // （PR #227レビュー指摘）。
  if (typeof data.submission_id !== 'string') return 'submission_id_invalid_type';
  if (data.submission_id.length === 0 || data.submission_id.length > MAX_SUBMISSION_ID_LENGTH) {
    return 'submission_id_invalid_length';
  }
  if (!SUBMISSION_ID_PATTERN.test(data.submission_id)) return 'submission_id_invalid_format';

  // 表示名：必須・型・長さ。
  if (typeof data.display_name !== 'string') return 'display_name_invalid_type';
  if (data.display_name.trim() === '') return 'display_name_required';
  if (data.display_name.length > MAX_DISPLAY_NAME_LENGTH) return 'display_name_too_long';

  // 連絡先：型・長さ・メール簡易形式チェック → どちらか1つ以上必須。
  if (typeof data.contact_email !== 'string') return 'contact_email_invalid_type';
  if (typeof data.contact_x !== 'string') return 'contact_x_invalid_type';
  var email = data.contact_email || '';
  var xAccount = data.contact_x || '';
  if (email.length > MAX_CONTACT_LENGTH) return 'contact_email_too_long';
  if (xAccount.length > MAX_CONTACT_LENGTH) return 'contact_x_too_long';
  if (email !== '' && !EMAIL_PATTERN.test(email)) return 'contact_email_invalid_format';
  if (email === '' && xAccount === '') return 'contact_required';

  // wear_items：joined文字列を分解し、全要素が許可値であることを確認する（1件以上必須）。
  if (typeof data.wear_items !== 'string') return 'wear_items_invalid_type';
  var wearRaw = data.wear_items || '';
  var wearItems = wearRaw === '' ? [] : wearRaw.split('、');
  if (wearItems.length === 0) return 'wear_items_required';
  for (var i = 0; i < wearItems.length; i++) {
    if (ALLOWED_WEAR_ITEMS.indexOf(wearItems[i]) === -1) return 'wear_items_invalid_item';
  }

  // wear_other：型・長さを検証する。wear_itemsに「その他」が含まれる場合は必須（空文字列不可）、
  // 含まれない場合は逆に空文字列のみ許可する。
  if (typeof data.wear_other !== 'string') return 'wear_other_invalid_type';
  if (data.wear_other.length > MAX_WEAR_OTHER_LENGTH) return 'wear_other_too_long';
  var wearOtherSelected = wearItems.indexOf(WEAR_OTHER_VALUE) !== -1;
  if (wearOtherSelected && data.wear_other.trim() === '') return 'wear_other_required';
  if (!wearOtherSelected && data.wear_other !== '') return 'wear_other_requires_other_selected';

  // wear_rental_requested：厳密なboolean。
  if (typeof data.wear_rental_requested !== 'boolean') return 'wear_rental_requested_not_boolean';

  // first_time：任意。空文字列 or yes/no のみ許可する。
  if (typeof data.first_time !== 'string') return 'first_time_invalid_type';
  if (ALLOWED_FIRST_TIME.indexOf(data.first_time) === -1) return 'first_time_invalid';

  // concerns：joined文字列を分解し、全要素が許可値であることを確認する（任意項目のため空文字列は許可）。
  if (typeof data.concerns !== 'string') return 'concerns_invalid_type';
  var concernRaw = data.concerns || '';
  var concernItems = concernRaw === '' ? [] : concernRaw.split('、');
  for (var j = 0; j < concernItems.length; j++) {
    if (ALLOWED_CONCERNS.indexOf(concernItems[j]) === -1) return 'concerns_invalid_item';
  }

  // concern_other：型・長さを検証する。concernsに「その他」が含まれる場合は必須（空文字列不可）、
  // 含まれない場合は逆に空文字列のみ許可する。
  if (typeof data.concern_other !== 'string') return 'concern_other_invalid_type';
  if (data.concern_other.length > MAX_CONCERN_OTHER_LENGTH) return 'concern_other_too_long';
  var concernOtherSelected = concernItems.indexOf(CONCERN_OTHER_VALUE) !== -1;
  if (concernOtherSelected && data.concern_other.trim() === '') return 'concern_other_required';
  if (!concernOtherSelected && data.concern_other !== '') return 'concern_other_requires_other_selected';

  // free_comment：型・長さ。
  if (typeof data.free_comment !== 'string') return 'free_comment_invalid_type';
  if (data.free_comment.length > MAX_FREE_COMMENT_LENGTH) return 'free_comment_too_long';

  // agree_terms：厳密にtrueであること（利用規約・参加ルールへの同意は必須）。
  if (data.agree_terms !== true) return 'agree_terms_required';

  // entry_mode：フロントのENTRY_STATUSに連動する参考値。open/waitlistのみ許可する。
  if (typeof data.entry_mode !== 'string') return 'entry_mode_invalid_type';
  if (ALLOWED_ENTRY_MODE.indexOf(data.entry_mode) === -1) return 'entry_mode_invalid';

  return null; // 問題なし
}

/**
 * 現在のヘッダーがCOLUMNSと完全一致するか確認する。
 * 旧ヘッダーのままappendすると列がずれるため、setupHeaderRowの実行漏れを保存前に明示的に止める。
 */
function hasExpectedHeader(sheet) {
  var lastColumn = sheet.getLastColumn();
  if (lastColumn !== COLUMNS.length) return false;
  var header = sheet.getRange(1, 1, 1, COLUMNS.length).getValues()[0];
  for (var i = 0; i < COLUMNS.length; i++) {
    if (header[i] !== COLUMNS[i]) return false;
  }
  return true;
}

/**
 * ヘッダー行（1行目）からsubmission_id列の位置を探す。
 * hasExpectedHeader()を通過した後に呼び出すため、ここは冪等性の確認だけを担う。
 * 見つからない場合は -1 を返す。
 */
function findSubmissionIdColumnIndex(sheet) {
  var lastColumn = sheet.getLastColumn();
  if (lastColumn < 1) return -1;
  var header = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  var idx = header.indexOf('submission_id');
  return idx === -1 ? -1 : idx + 1; // シートの列番号は1始まり
}

/**
 * 指定したsubmission_idが既にシートに保存済みかどうかを調べる。
 * データ行が無い（ヘッダーのみ／空シート）場合は即falseを返し、無駄な読み取りを避ける。
 * 呼び出し元はLockServiceのロックを保持した状態で呼ぶこと（同時リクエストでの
 * 二重書き込みを防ぐため）。
 */
function isDuplicateSubmission(sheet, submissionId, columnIndex) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return false; // ヘッダー行のみ、またはデータなし
  var existingIds = sheet.getRange(2, columnIndex, lastRow - 1, 1).getValues();
  for (var i = 0; i < existingIds.length; i++) {
    if (existingIds[i][0] === submissionId) return true;
  }
  return false;
}

/**
 * ロック保持中に行う本体処理（payload検証・重複判定・Sheetsへの追記まで）。
 * メール送信はここでは行わない。MailApp.sendEmail()はネットワーク呼び出しを伴い遅延しうるため、
 * ロックを保持したまま呼ぶと後続リクエストの待ち時間が延び、busyになりやすくなる
 * （community/gas/enquete_202609_backend.gsと同じ設計）。そのため通知が必要な場合は
 * data/timestampを呼び出し元に返すだけにとどめ、実際の送信はdoPost側でロック解放後に行う。
 * 戻り値：{ response: ContentServiceのレスポンス, notify: 新規保存時は{data, timestamp}、それ以外はnull }
 */
function processSubmission(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return { response: jsonResponse({ ok: false, error: 'no_payload' }), notify: null };
    }

    var data;
    try {
      data = JSON.parse(e.postData.contents);
    } catch (parseError) {
      return { response: jsonResponse({ ok: false, error: 'invalid_json' }), notify: null };
    }

    var validationError = validatePayload(data);
    if (validationError) {
      return { response: jsonResponse({ ok: false, error: validationError }), notify: null };
    }

    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    if (!sheet) {
      return { response: jsonResponse({ ok: false, error: 'sheet_not_found' }), notify: null };
    }

    // 旧ヘッダーのまま保存して列がずれる事故を防ぐ。まずsetupHeaderRowを実行すること。
    if (!hasExpectedHeader(sheet)) {
      return { response: jsonResponse({ ok: false, error: 'header_mismatch' }), notify: null };
    }

    // 冪等性の前提としてsubmission_id列が実在することを確認する。
    var submissionIdColumn = findSubmissionIdColumnIndex(sheet);
    if (submissionIdColumn === -1) {
      return { response: jsonResponse({ ok: false, error: 'submission_id_column_not_found' }), notify: null };
    }

    // 冪等性：同じsubmission_idが既に保存済みなら、再送とみなし追記せず成功として返す。
    // LockService保持中に判定するため、同時リクエスト間でも競合しない。
    if (isDuplicateSubmission(sheet, data.submission_id, submissionIdColumn)) {
      return { response: jsonResponse({ ok: true, duplicate: true }), notify: null };
    }

    var now = new Date();
    var row = COLUMNS.map(function (key) {
      if (key === 'timestamp') return now;
      var value = data[key];
      if (value === undefined || value === null) return '';
      if (key === 'display_name' || key === 'contact_email' || key === 'contact_x' ||
        key === 'wear_other' || key === 'concern_other' || key === 'free_comment' ||
        key === 'submission_id') {
        return sanitizeForSheet(value);
      }
      return value;
    });

    sheet.appendRow(row);

    // 通知が必要（＝新規保存が確定した）ことを呼び出し元に伝える。
    // ここに到達するのは新規保存のときだけ（重複はすでに上でreturn済み）のため、
    // メール送信は新規保存と1対1のままになる。
    return {
      response: jsonResponse({ ok: true, duplicate: false }),
      notify: { data: data, timestamp: now }
    };
  } catch (err) {
    return { response: jsonResponse({ ok: false, error: 'server_error', message: String(err) }), notify: null };
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  var gotLock = false;
  try {
    gotLock = lock.tryLock(10000); // 最大10秒待機
  } catch (lockAcquireError) {
    gotLock = false;
  }

  if (!gotLock) {
    return jsonResponse({ ok: false, error: 'busy' });
  }

  var result;
  try {
    result = processSubmission(e);
  } finally {
    lock.releaseLock();
  }

  // 通知メールはSheets保存に対して補助処理であり、失敗しても申込自体は成功として返す。
  // ロック解放後に送ることで、メール送信の遅延が後続リクエストのbusy化に響かないようにする。
  if (result.notify) {
    sendNotificationEmailSafely(result.notify.data, result.notify.timestamp);
  }

  return result.response;
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * 通知メール本文を組み立てる。
 * 個人情報の保存場所を増やさないため、contact_email / contact_x / free_comment /
 * display_name / submission_id は意図的に含めない
 * （community/gas/enquete_202609_backend.gs・Issue #192と同じ方針）。
 * 詳細な内容・連絡先はGoogleスプレッドシート側で確認する運用とする。
 */
function buildNotificationBody(data, timestamp) {
  var receivedAt = Utilities.formatDate(timestamp, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  var lines = [
    'SNBC 2026年9月教室撮影会（9/12開催）に新しい参加申込がありました。',
    '',
    '受付日時: ' + receivedAt,
    '参加予定の衣装: ' + (data.wear_items || '（未回答）'),
    '衣装の貸出希望: ' + (data.wear_rental_requested ? '希望する' : '希望しない'),
    '参加ははじめてか: ' + (data.first_time === 'yes' ? 'はじめて' : (data.first_time === 'no' ? '参加したことがある' : '（未回答）')),
    '希望・不安なこと: ' + (data.concerns || '（該当なし）'),
    '受付区分: ' + (data.entry_mode === 'waitlist' ? 'キャンセル待ち' : '通常受付'),
    '',
    '氏名・連絡先・自由記述の詳細はGoogleスプレッドシートで確認してください。'
  ];
  return lines.join('\n');
}

/**
 * 運営者への通知メールを送る。呼び出し元（doPost）はisDuplicateSubmissionによる重複判定を
 * appendRowより前に済ませており、この関数は新規保存が確定した後にしか呼ばれないため、
 * 通知メールは新規保存1件につき1回だけ送られる。
 * メール送信失敗を申込送信失敗として扱わないため、失敗は握りつぶしログに残すだけにする。
 */
function sendNotificationEmailSafely(data, timestamp) {
  if (NOTIFICATION_EMAIL === 'YOUR_NOTIFICATION_EMAIL') {
    console.error('[classroom_20260912] NOTIFICATION_EMAIL がプレースホルダーのままのため、通知メール送信をスキップしました。デプロイ手順3の通り実際の運営者アドレスに書き換えてください。');
    return;
  }
  try {
    MailApp.sendEmail({
      to: NOTIFICATION_EMAIL,
      subject: NOTIFICATION_EMAIL_SUBJECT,
      body: buildNotificationBody(data, timestamp)
    });
  } catch (mailError) {
    console.error('[classroom_20260912] notification mail failed: ' + mailError);
  }
}

/**
 * ヘッダー再作成用。新規スプレッドシートでの初回デプロイ時（デプロイ手順4）に1回だけ実行する。
 * 新COLUMNS（14列：timestamp 〜 entry_mode）でヘッダーを作成する。
 * 既に回答が入っている状態で誤って実行すると列がずれて破損するため、
 * データ行がある場合は明示的に停止する。
 */
function setupHeaderRow() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() > 1) {
    throw new Error('既に回答が入っているシートのため、setupHeaderRowの実行を中断しました。ヘッダーを目視確認してください。');
  }
  var existingColumnCount = sheet.getLastColumn();
  if (existingColumnCount > 0) {
    sheet.getRange(1, 1, 1, existingColumnCount).clearContent();
  }
  sheet.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]);
}
