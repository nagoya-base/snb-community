/**
 * SNBC 学校セット＆ユニフォーム交流会｜2026年9月開催アンケート バックエンド
 * Issue #205 で新設、Issue #209 で再設計（開催形式Q1／着用衣装Q2／流入元を分離取得）。
 * community/enquete_202609.html から呼び出される。
 *
 * このファイルはリポジトリ内の正本だが、実行環境はGoogle Apps Script側。
 * GitHubへpushするだけでは反映されないため、次の順で手動反映する。
 *
 * ── デプロイ手順（Issue #209 再設計版） ──
 * 1. 対象Googleスプレッドシートの「拡張機能」→「Apps Script」を開き、Code.gsをこの内容に置き換える。
 * 2. SHEET_NAME と NOTIFICATION_EMAIL が実運用の値であることを確認する。
 * 3. 【重要・手動作業】既存シートに回答が既にある前提で移行すること。ゼロ件と決め打ちしない。
 *    a. 現在のヘッダー行（1行目）が、旧COLUMNS（19列：timestamp 〜 free_comment）と一致しているか確認する。
 *    b. 一致していれば、末尾（20列目・21列目）に `q2_wear_items`, `source_channel` を
 *       このスペルのまま手動で追加する（既存列の並び替え・削除は絶対に行わない）。
 *    c. ヘッダーが上記と異なる場合は、実際の列構成を確認したうえで個別に移行方法を検討する。
 *    d. populated シートに対して setupHeaderRow() を実行しない（安全装置により例外で停止する）。
 * 4. 「デプロイ」→「デプロイを管理」→既存ウェブアプリの編集（鉛筆）で、
 *    バージョンに「新バージョン」を選んで再デプロイする。/exec URLは変更しない。
 * 5. /exec URLを開き、backend: OK と表示されることを確認する。
 * 6. 公開ページから1件だけ疎通し、Sheets保存内容（21列目まで）と通知メールを確認する。
 *
 * ── この版の仕様（Issue #209） ──
 * ・Q1（q1_first_choice）は「開催形式」の4択コード（school_set等）のみを受け付ける。
 *   旧仕様（衣装テーマの生日本語文字列）の回答は過去データとして列に残るが、新規回答には適用しない。
 * ・Q2（q2_wear_items）はユニフォーム系で着たい衣装の複数選択（`、`区切り文字列）。空文字列＝未回答を許可する任意項目。
 * ・source_channel は流入元の単一選択・必須（固定コード）。「ユニ航空」という表記は使用しない。
 * ・notification_requested は厳密なboolean。false時の連絡先は空欄のみ許可する。
 * ・自由入力は数式インジェクション対策をしてSheetsへ保存する。
 * ・submission_id、LockService、重複送信時の保存・通知抑止を維持する。
 * ・通知メール本文には連絡先、自由記述、submission_id を含めない。
 */

var SHEET_NAME = 'responses';

/* 新しい回答が保存されたときの通知先。デプロイ手順5の通り、実際の運営者アドレスに書き換えること。 */
var NOTIFICATION_EMAIL = 'bbuni.ngo@gmail.com';

var NOTIFICATION_EMAIL_SUBJECT = '【SNBC】9月企画アンケートに新しい回答があります';

/* 末尾のq2_wear_items, source_channelはIssue #209で追加した新規列。
   populated Sheetでは手動でヘッダーへ追加するまでnew列を含む保存は成功しない
   （hasExpectedHeaderが列数・列名の完全一致を要求するため）。 */
var COLUMNS = [
  'timestamp',
  'submission_id',
  'q1_first_choice', // 保存値はIssue #209以降、開催形式の固定コード（school_set等）。
  'q3_participation_intent',
  'q4_price', // 保存値は開催スタイルの固定コード。
  'date_0905',
  'date_0906',
  'date_0912',
  'date_0913',
  'date_0919',
  'date_0920',
  'date_0926',
  'date_0927',
  'no_available_weekend',
  'q6_concerns',
  'notification_requested',
  'contact_email',
  'contact_x',
  'free_comment',
  'q2_wear_items', // Issue #209で追加。着て参加したい衣装の複数選択（`、`区切り、任意）。
  'source_channel' // Issue #209で追加。流入元の単一選択・固定コード（必須）。
];

var DATE_KEYS = [
  'date_0905', 'date_0906', 'date_0912', 'date_0913',
  'date_0919', 'date_0920', 'date_0926', 'date_0927'
];

/* 通知メール本文でQ5の参加可能日を人が読める形式で表示するためのラベル
   （community/enquete_202609.html の日付選択肢と1対1で一致させること）。 */
var DATE_LABELS = {
  date_0905: '9/5（土）',
  date_0906: '9/6（日）',
  date_0912: '9/12（土）',
  date_0913: '9/13（日）',
  date_0919: '9/19（土）',
  date_0920: '9/20（日）',
  date_0926: '9/26（土）',
  date_0927: '9/27（日）'
};

/* ── 許可値のallowlist（フロント側HTMLの選択肢と1対1で一致させること。
   選択肢の文言をHTML側で変更した場合、ここも必ず同時に更新する） ── */
/* Q1：Issue #209以降は「開催形式」の固定コード。衣装テーマの投票ではない。 */
var ALLOWED_Q1 = [
  'school_set', 'uniform_event', 'either', 'not_interested'
];
/* Q1の固定コードを通知メール向けの人が読める表記に変換する対応表。 */
var Q1_FORMAT_LABELS = {
  school_set: '学校セット撮影会',
  uniform_event: 'ユニフォーム交流会',
  either: 'どちらでもよい',
  not_interested: '今回は特に参加しない'
};
/* Q2：ユニフォーム系で着て参加したい衣装（複数選択・任意）。フロントでは`、`区切りの文字列で送られる。 */
var ALLOWED_Q2_ITEMS = [
  '野球ユニフォーム', 'サッカーユニフォーム', '陸上ユニフォーム', 'ラグビー／アメフトウェア',
  'スイムウェア', 'シングレット', '制服・体操服', '私服', 'その他'
];
var ALLOWED_Q3 = [
  '日程が合えばかなり参加したい',
  '条件（料金・人数など）が合えば参加を検討したい',
  '興味はあるが参加までは分からない',
  '見るだけ・投票だけ'
];
/* Q4：価格だけではなく、人数・撮影時間・ドリンクを含む開催スタイルの固定コード。 */
var ALLOWED_Q4 = [
  'style_2000_9to12_nodrink',
  'style_3000_7to8_nodrink',
  'style_3500_5to6_drink',
  'style_4000_4_drink'
];

/* Q4の固定コードを通知メール向けの人が読める表記に変換する対応表。 */
var Q4_STYLE_LABELS = {
  style_2000_9to12_nodrink: '2,000円｜9〜12人｜交流メイン｜撮影時間なし｜ドリンクなし',
  style_3000_7to8_nodrink: '3,000円｜7〜8人｜交流メイン＋希望者のみ撮影｜ドリンクなし',
  style_3500_5to6_drink: '3,500円｜5〜6人｜交流＋希望者のみ撮影｜撮影時間しっかり｜ドリンクあり',
  style_4000_4_drink: '4,000円｜4人｜少人数｜希望者のみ撮影｜撮影時間多め｜ドリンクあり'
};
var ALLOWED_Q6_ITEMS = [
  '一人参加が不安', '初対面の人との交流が不安', '撮られるのが苦手',
  'ユニフォームを持っていない', 'お酒も飲めると良い', '料金', '日程', '会場の広さ', '特になし', 'その他'
];
/* 流入元：Issue #209で追加。固定コードのみ許可し、単一選択・必須。
   「ユニ航空」という表記は使用しない（Issue #209コメントで明示的に禁止）。 */
var ALLOWED_SOURCE_CHANNEL = [
  'x_ataru', 'x_snb', 'x_studio_x', 'snbc_web', 'instagram', 'friend', 'other'
];
/* 流入元の固定コードを通知メール向けの人が読める表記に変換する対応表。 */
var SOURCE_CHANNEL_LABELS = {
  x_ataru: 'X：アタル（@baseballuni2022）',
  x_snb: 'X：Studio Nagoya Base',
  x_studio_x: 'X：Studio X',
  snbc_web: 'SNBCサイト',
  instagram: 'Instagram',
  friend: '知人から',
  other: 'その他'
};

var MAX_FREE_COMMENT_LENGTH = 300; // フロントのmaxlengthと一致させる
var MAX_CONTACT_LENGTH = 200; // フロントのmaxlengthとも一致させる（HTML側にも設定必須）
var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; // 簡易チェック（RFC完全準拠ではない）
var MAX_SUBMISSION_ID_LENGTH = 100; // crypto.randomUUID()は36文字、フォールバック生成でも数十文字程度のため十分な余裕

/**
 * Googleスプレッドシートの数式インジェクション対策。
 * 自由入力欄（contact_email / contact_x / free_comment）は、
 * 先頭が =, +, -, @ の場合にスプレッドシート側で数式として解釈される可能性があるため、
 * 先頭に ' を付けて強制的に文字列として保存する。
 * allowlistで検証済みのQ1〜Q4・Q6・Q2（q2_wear_items）・source_channel等には適用不要（許可された固定文言のみのため）。
 */
function sanitizeForSheet(value) {
  if (typeof value !== 'string') return value;
  if (/^[=+\-@]/.test(value)) {
    return "'" + value;
  }
  return value;
}

function doGet(e) {
  var message = 'SNBC enquete_202609 backend: OK';
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
 * 同じ制約を再検証する（レビュー指摘）。
 * 戻り値：問題なければnull、問題があればエラーコード文字列。
 */
function validatePayload(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 'payload_invalid';

  // submission_id：冪等性のキーとして使うため、型・長さだけ検証する（文字の内容自体は
  // allowlist化できない自由な識別子のため、シート書き込み時にsanitizeForSheetで防御する）。
  if (typeof data.submission_id !== 'string') return 'submission_id_invalid_type';
  if (data.submission_id.length === 0 || data.submission_id.length > MAX_SUBMISSION_ID_LENGTH) {
    return 'submission_id_invalid_length';
  }

  if (ALLOWED_Q1.indexOf(data.q1_first_choice) === -1) return 'q1_invalid';

  // Q2：joined文字列を分解し、全要素が許可値であることを確認する（任意項目のため空文字列は許可）。
  if (typeof data.q2_wear_items !== 'string') return 'q2_invalid_type';
  var q2Raw = data.q2_wear_items || '';
  var q2Items = q2Raw === '' ? [] : q2Raw.split('、');
  for (var m = 0; m < q2Items.length; m++) {
    if (ALLOWED_Q2_ITEMS.indexOf(q2Items[m]) === -1) return 'q2_invalid_item';
  }

  if (ALLOWED_Q3.indexOf(data.q3_participation_intent) === -1) return 'q3_invalid';

  if (ALLOWED_Q4.indexOf(data.q4_price) === -1) return 'q4_invalid';

  // 日付：各列は厳密にboolean型であること（文字列"true"等は許可しない）。
  var anyDateTrue = false;
  for (var i = 0; i < DATE_KEYS.length; i++) {
    var key = DATE_KEYS[i];
    var value = data[key];
    if (typeof value !== 'boolean') return key + '_not_boolean';
    if (value) anyDateTrue = true;
  }
  if (typeof data.no_available_weekend !== 'boolean') return 'no_available_weekend_not_boolean';

  // 排他関係：「参加できない」が true の場合、日付は全てfalseでなければならない。
  if (data.no_available_weekend === true && anyDateTrue) return 'q5_exclusive_violation';
  // どちらも埋まっていない（fetch改造等で両方false）場合も不正とする。
  if (data.no_available_weekend !== true && !anyDateTrue) return 'q5_missing';

  // Q6：joined文字列を分解し、全要素が許可値であることを確認する。
  // .split()を呼ぶ前に型を確認しておく（数値・真偽値・配列等が送られると例外でserver_errorに
  // なってしまい、クリーンに拒否できないため。レビュー指摘）。
  if (typeof data.q6_concerns !== 'string') return 'q6_invalid_type';
  var q6Raw = data.q6_concerns || '';
  var q6Items = q6Raw === '' ? [] : q6Raw.split('、');
  for (var j = 0; j < q6Items.length; j++) {
    if (ALLOWED_Q6_ITEMS.indexOf(q6Items[j]) === -1) return 'q6_invalid_item';
  }
  // Q6の排他関係：「特になし」を含む場合、他の項目と同時には保存できない。
  if (q6Items.indexOf('特になし') !== -1 && q6Items.length > 1) return 'q6_exclusive_violation';

  // 流入元：単一選択・必須の固定コード。
  if (ALLOWED_SOURCE_CHANNEL.indexOf(data.source_channel) === -1) return 'source_channel_invalid';

  // 通知希望は文字列"true"等を受け入れず、厳密なbooleanだけを許可する。
  if (typeof data.notification_requested !== 'boolean') return 'notification_requested_not_boolean';

  // 連絡先・自由記述：型チェック → 文字数上限 → メールの簡易形式チェック。
  if (typeof data.contact_email !== 'string') return 'contact_email_invalid_type';
  if (typeof data.contact_x !== 'string') return 'contact_x_invalid_type';
  if (typeof data.free_comment !== 'string') return 'free_comment_invalid_type';
  var email = data.contact_email || '';
  var xAccount = data.contact_x || '';
  var freeComment = data.free_comment || '';
  if (email.length > MAX_CONTACT_LENGTH) return 'contact_email_too_long';
  if (xAccount.length > MAX_CONTACT_LENGTH) return 'contact_x_too_long';
  if (freeComment.length > MAX_FREE_COMMENT_LENGTH) return 'free_comment_too_long';
  if (email !== '' && !EMAIL_PATTERN.test(email)) return 'contact_email_invalid_format';

  if (data.notification_requested === true && email === '' && xAccount === '') {
    return 'notification_contact_required';
  }
  // 通知を希望しない回答に連絡先を保存しない。フロントもoffに切り替えた時点で空欄に戻す。
  if (data.notification_requested === false && (email !== '' || xAccount !== '')) {
    return 'notification_contact_must_be_blank';
  }

  return null; // 問題なし
}

/**
 * 現在のヘッダーがCOLUMNSと完全一致するか確認する。
 * 今回の列構成で旧ヘッダーのままappendすると列がずれるため、
 * setupHeaderRowの実行漏れを保存前に明示的に止める。
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
 * （レビュー指摘 / PR #193）。そのため通知が必要な場合は data/timestamp を呼び出し元に返すだけに
 * とどめ、実際の送信は doPost 側でロック解放後に行う。
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
    // duplicateフラグはフロント側がGA4のsurvey_submitを再計上しないために使う。
    if (isDuplicateSubmission(sheet, data.submission_id, submissionIdColumn)) {
      return { response: jsonResponse({ ok: true, duplicate: true }), notify: null };
    }

    var now = new Date();
    var row = COLUMNS.map(function (key) {
      if (key === 'timestamp') return now;
      var value = data[key];
      if (value === undefined || value === null) return '';
      if (key === 'contact_email' || key === 'contact_x' || key === 'free_comment' || key === 'submission_id') {
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

  // 通知メールはSheets保存に対して補助処理であり、失敗しても回答自体は成功として返す
  // （Issue #192）。ロック解放後に送ることで、メール送信の遅延が後続リクエストの
  // busy化に響かないようにする（レビュー指摘 / PR #193）。
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
 * Q5（参加可能日）を通知メール向けの短い文字列に整形する。
 * 「9月の土日は参加できない」が選ばれている場合はそちらを優先して表示する
 * （validatePayloadにより日付側とは排他であることが保証されている）。
 */
function formatQ5ForNotification(data) {
  if (data.no_available_weekend === true) return '9月の土日は参加できない';
  var selected = [];
  for (var i = 0; i < DATE_KEYS.length; i++) {
    var key = DATE_KEYS[i];
    if (data[key] === true) selected.push(DATE_LABELS[key]);
  }
  return selected.length > 0 ? selected.join('、') : '（未選択）';
}

/**
 * Q4（開催スタイルの固定コード）を通知メール向けの人が読める表記に変換する。
 * Q4_STYLE_LABELSに無い値（想定外の値）が来た場合も、通知自体は落とさず
 * コードをそのまま表示する（validatePayloadで既にallowlist検証済みのため通常は発生しない）。
 */
function formatQ4ForNotification(data) {
  return Q4_STYLE_LABELS[data.q4_price] || data.q4_price;
}

/**
 * Q1（開催形式の固定コード）を通知メール向けの人が読める表記に変換する。
 */
function formatQ1ForNotification(data) {
  return Q1_FORMAT_LABELS[data.q1_first_choice] || data.q1_first_choice;
}

/**
 * 流入元の固定コードを通知メール向けの人が読める表記に変換する。
 */
function formatSourceChannelForNotification(data) {
  return SOURCE_CHANNEL_LABELS[data.source_channel] || data.source_channel;
}

/**
 * 通知メール本文を組み立てる。
 * 個人情報の保存場所を増やさないため、contact_email / contact_x / free_comment / submission_id は
 * 意図的に含めない（Issue #192）。詳細な内容はGoogleスプレッドシート側で確認する運用とする。
 */
function buildNotificationBody(data, timestamp) {
  var receivedAt = Utilities.formatDate(timestamp, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  var lines = [
    'SNBC 9月企画アンケートに新しい回答がありました。',
    '',
    '受付日時: ' + receivedAt,
    'Q1 参加したい開催形式: ' + formatQ1ForNotification(data),
    'Q2 着て参加したい衣装: ' + (data.q2_wear_items || '（未回答）'),
    'Q3 参加の温度感: ' + data.q3_participation_intent,
    'Q4 希望する開催スタイル: ' + formatQ4ForNotification(data),
    'Q5 参加可能日: ' + formatQ5ForNotification(data),
    'Q6 気になる点: ' + (data.q6_concerns || '（該当なし）'),
    'どこで知ったか: ' + formatSourceChannelForNotification(data),
    '開催決定時の連絡: ' + (data.notification_requested ? '希望する' : '希望しない'),
    '',
    '詳細はGoogleスプレッドシートで確認してください。'
  ];
  return lines.join('\n');
}

/**
 * 運営者への通知メールを送る。呼び出し元（doPost）はisDuplicateSubmissionによる重複判定を
 * appendRowより前に済ませており、この関数は新規保存が確定した後にしか呼ばれないため、
 * 通知メールは新規保存1件につき1回だけ送られる。
 * メール送信失敗を回答送信失敗として扱わないため、失敗は握りつぶしログに残すだけにする
 * （Issue #192の「メール失敗時の扱い」）。
 */
function sendNotificationEmailSafely(data, timestamp) {
  if (NOTIFICATION_EMAIL === 'YOUR_NOTIFICATION_EMAIL') {
    // プレースホルダーのまま送信を試みると「無効な宛先」的なエラーがMailApp失敗ログに
    // 紛れて分かりにくくなるため、原因が一目で分かる専用のログを出して送信自体は行わない
    // （レビュー指摘 / PR #193）。doGetの[WARNING]表示と合わせて設定忘れに気付けるようにする。
    console.error('[enquete_202609] NOTIFICATION_EMAIL がプレースホルダーのままのため、通知メール送信をスキップしました。デプロイ手順5の通り実際の運営者アドレスに書き換えてください。');
    return;
  }
  try {
    MailApp.sendEmail({
      to: NOTIFICATION_EMAIL,
      subject: NOTIFICATION_EMAIL_SUBJECT,
      body: buildNotificationBody(data, timestamp)
    });
  } catch (mailError) {
    console.error('[enquete_202609] notification mail failed: ' + mailError);
  }
}

/**
 * ヘッダー再作成用。回答が0件のときだけ実行できる。
 * データ行がある場合は、列ずれによる破損を避けるため明示的に停止する。
 */
function setupHeaderRow() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() > 1) {
    throw new Error('既存の回答があるためsetupHeaderRowは実行できません。ヘッダーを上書きしないでください。');
  }
  var existingColumnCount = sheet.getLastColumn();
  if (existingColumnCount > 0) {
    sheet.getRange(1, 1, 1, existingColumnCount).clearContent();
  }
  sheet.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]);
}
