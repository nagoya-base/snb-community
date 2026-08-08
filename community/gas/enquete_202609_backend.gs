/**
 * SNBC 次回企画アンケート（2026年9月開催分）バックエンド
 * Issue #188 対応。community/enquete_202609.html から呼び出される。
 *
 * このファイルはリポジトリ内には保存されるが、実行環境はGoogle Apps Script側であり、
 * ここに置いたコードを直接pushしても動作しない。以下の手順で先輩が手動でデプロイすること。
 *
 * ── デプロイ手順（先輩が実施） ──
 * 1. 保存先にしたいGoogleスプレッドシートを新規作成する（例：「SNBCアンケート_202609」）。
 * 2. スプレッドシートのメニュー「拡張機能」→「Apps Script」を開く。
 * 3. デフォルトで生成される Code.gs の内容を全て削除し、このファイルの内容を貼り付ける。
 * 4. SHEET_NAME（下記）が実際に使うシート（タブ）名と一致していることを確認する
 *    （既定 "responses"。スプレッドシート下部のタブ名をこれに合わせるか、コード側を変更する）。
 * 5. NOTIFICATION_EMAIL（下記）を、新しい回答があった際に通知を受け取りたい運営者の
 *    実際のメールアドレスに書き換える（新しい回答が保存されるたびにこの宛先へメール通知が届く）。
 * 6. Apps Scriptエディタ左側の関数選択で setupHeaderRow を選び、実行ボタン（▶）を押す。
 *    初回はGoogleの権限承認画面が出るので、自分のアカウントで承認する。
 *    これで1行目にヘッダー（列名）が書き込まれる。
 * 7. 右上「デプロイ」→「新しいデプロイ」。
 *    - 種類の選択：ウェブアプリ
 *    - 説明：任意（例：enquete_202609 v1）
 *    - 次のユーザーとして実行：自分
 *    - アクセスできるユーザー：全員
 * 8. 「デプロイ」を押すと「ウェブアプリのURL」が表示される（.../exec で終わるURL）。これをコピーする。
 * 9. コピーしたURLを community/enquete_202609.html 内の
 *    `GAS_ENDPOINT_URL = 'https://script.google.com/macros/s/PLACEHOLDER_REPLACE_WITH_DEPLOYED_WEB_APP_URL/exec'`
 *    の PLACEHOLDER_REPLACE_WITH_DEPLOYED_WEB_APP_URL 部分と置き換える。
 * 10. ブラウザで手順8のURLをそのまま開き、「SNBC enquete_202609 backend: OK」と表示されることを確認する
 *     （doGetの動作確認。POST自体はブラウザから直接テストできないため、実際のフォーム送信で確認する）。
 *     このとき2行目に「[WARNING] NOTIFICATION_EMAILが未設定です」等の警告が出ていないかも
 *     必ず確認すること。出ている場合は手順5のNOTIFICATION_EMAIL書き換えが漏れており、
 *     このままではSheets保存は成功する一方で運営者への通知メールが一切届かない。
 * 11. コードを後から修正した場合は、「デプロイ」→「デプロイを管理」→ 対象デプロイの編集（鉛筆アイコン）→
 *     バージョン「新バージョン」を選んで再デプロイする（URLを変えずにコードだけ更新するため）。
 *     このメール通知機能（Issue #192）を、メール送信を使っていなかった既存デプロイに反映する場合、
 *     MailApp（メール送信）の権限が新たに必要になるため、新バージョンの実行時にGoogleの追加の
 *     権限承認画面が表示されることがある。表示されたら内容を確認し、自分のアカウントで承認すること。
 * 12. 【submission_id列を追加した今回の更新を、既にデプロイ済みのシートに反映する場合】
 *     COLUMNS配列に'submission_id'列が増えたが、データが既にあるシートで setupHeaderRow を
 *     再実行すると、1行目（ヘッダー）だけが上書きされ既存のデータ行とは列がズレてしまうため
 *     絶対に再実行しないこと。代わりに、スプレッドシート上で timestamp列（A列）の右隣に
 *     列を1列手動で挿入し（該当列を右クリック→「左に1列を挿入」）、ヘッダーセル（1行目）に
 *     半角で「submission_id」と入力すること。データが無い新規シートの場合のみ、
 *     引き続き setupHeaderRow の実行で問題ない（何もない状態にヘッダーを書き込むだけのため）。
 *     コード側は貼り替えた後、手順11の通り「新バージョン」で再デプロイする
 *     （URLは変わらないためHTML側の再修正は不要）。
 *
 * ── 既知の制約（正直な申告） ──
 * ・GAS Web AppのCORS挙動はGoogle側の実装に依存する。本コードは「text/plainでPOSTしプリフライトを
 *   発生させない」という広く使われる回避策を前提にしているが、実際にfetchでレスポンスを読めるかは
 *   環境依存の可能性がゼロではない。手順9のdoGet確認に加え、実際にフォームから送信して
 *   スプレッドシートに1行追加されること・ブラウザ側で成功表示が出ることの両方を必ず確認すること。
 * ・通信が途中で切れた場合（サーバー側の追記は成功したがレスポンスをブラウザが受け取れなかった場合）に
 *   利用者が再送信しても、フロント側が同じ submission_id を使い回すため、GAS側で重複と判定し
 *   追記せず成功扱いを返す（冪等性）。ページを再読み込みして最初から回答し直した場合は
 *   新しい submission_id になるため、それは「別の送信」として扱われる（意図通り）。
 * ・この重複判定はシート上の submission_id 列を毎回スキャンして行う簡易な実装であり、
 *   件数が少ないアンケートを前提にしている（数千件規模の応答には向かない）。
 * ・submission_id列の位置はCOLUMNS配列の並び順を決め打ちにせず、ヘッダー行（1行目）を
 *   毎回検索して求める。ヘッダーに「submission_id」という列が見つからない場合は
 *   （手順12の対応漏れ等）、重複判定ができないまま追記してしまう事故を防ぐため、
 *   保存を行わずエラー（submission_id_column_not_found）を返す。
 * ・新しい回答がSheetsへ保存されたときのみ、NOTIFICATION_EMAIL宛に確認用の通知メールを送る
 *   （Issue #192）。Sheetsへの保存が主処理、メール通知はあくまで補助処理であり、メール送信が
 *   失敗しても保存が完了していれば回答自体は成功として扱う（失敗はApps Scriptログに残すのみ）。
 *   同一submission_idの再送（重複）と判定された場合は、Sheetsへの追記と同様にメールも送らない
 *   （回答1件につきメール1通を保証する）。通知メール本文にはcontact_email／contact_x／
 *   free_comment／submission_idを含めない（個人情報の保存場所を増やさないため。詳細はSheets参照）。
 * ・GASの MailApp にはGoogleアカウント側の送信クォータがあるため、大量送信は想定していない
 *   （本アンケートのような少数回答の運用を前提にしている）。
 * ・NOTIFICATION_EMAILが手順5の書き換えを忘れてプレースホルダー（'YOUR_NOTIFICATION_EMAIL'）の
 *   ままの場合、送信自体を試みずスキップし専用のエラーをApps Scriptログに残す（レビュー指摘 /
 *   PR #193）。doGetのレスポンスにも[WARNING]を出すため、手順10の確認で気付けるようにしている。
 *   ただしSheets保存自体は成功として扱われるため、ログ／doGetを見ない限り気付けない点に注意。
 * ・重複判定・Sheetsへの追記はLockService保持中に行うが、MailApp.sendEmail()はロック解放後に
 *   呼ぶ（レビュー指摘 / PR #193）。メール送信の遅延で後続リクエストの待ち時間が延び busy に
 *   なりやすくなることを避けるためで、通知が新規保存と1対1になる保証（processSubmissionが
 *   新規保存確定時にのみnotify情報を返す）は変えていない。
 */

var SHEET_NAME = 'responses';

/* 新しい回答が保存されたときの通知先。デプロイ手順5の通り、実際の運営者アドレスに書き換えること。 */
var NOTIFICATION_EMAIL = 'bbuni.ngo@gmail.com';

var NOTIFICATION_EMAIL_SUBJECT = '【SNBC】9月企画アンケートに新しい回答があります';

var COLUMNS = [
  'timestamp',
  'submission_id',
  'q1_first_choice',
  'q2_second_choice',
  'q3_participation_intent',
  'q4_price',
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
  'contact_email',
  'contact_x',
  'free_comment'
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
var ALLOWED_Q1 = [
  '学校セット撮影会（服装自由）', '野球ユニ撮影交流会', 'サカユニ撮影交流会',
  'ユニミックス撮影交流会', '今回は特にない'
];
var ALLOWED_Q2 = [
  '学校セット撮影会（服装自由）', '野球ユニ撮影交流会', 'サカユニ撮影交流会',
  'ユニミックス撮影交流会', '特になし', ''
];
var ALLOWED_Q3 = [
  '日程が合えばかなり参加したい',
  '条件（料金・人数など）が合えば参加を検討したい',
  '興味はあるが参加までは分からない',
  '見るだけ・投票だけ',
  'not_applicable'
];
var ALLOWED_Q4 = ['2,500円', '3,000円', '3,500円', '4,000円'];
var ALLOWED_Q6_ITEMS = [
  '一人参加が不安', '初対面の人との交流が不安', '撮られるのが苦手',
  'ユニフォームを持っていない', 'お酒も飲めると良い', '料金', '日程', '会場の広さ', '特になし', 'その他'
];

var MAX_FREE_COMMENT_LENGTH = 300; // フロントのmaxlengthと一致させる
var MAX_CONTACT_LENGTH = 200; // フロントのmaxlengthとも一致させる（HTML側にも設定必須）
var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; // 簡易チェック（RFC完全準拠ではない）
var MAX_SUBMISSION_ID_LENGTH = 100; // crypto.randomUUID()は36文字、フォールバック生成でも数十文字程度のため十分な余裕

/**
 * Googleスプレッドシートの数式インジェクション対策。
 * 自由入力欄（contact_email / contact_x / free_comment）は、
 * 先頭が =, +, -, @ の場合にスプレッドシート側で数式として解釈される可能性があるため、
 * 先頭に ' を付けて強制的に文字列として保存する。
 * allowlistで検証済みのQ1〜Q4等には適用不要（許可された固定文言のみのため）。
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
    // デプロイ手順10でこのURLを開いて確認する際に、NOTIFICATION_EMAILの設定忘れに
    // 気付けるようにする（レビュー指摘 / PR #193）。利用者向けのdoPostレスポンスには
    // 影響しないが、ここに出れば本番運用前に気付ける。
    message += '\n[WARNING] NOTIFICATION_EMAIL が未設定です（プレースホルダーのままです）。' +
      'このままでは運営者への通知メールが送信されません。デプロイ手順5の通り書き換えてください。';
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
  // submission_id：冪等性のキーとして使うため、型・長さだけ検証する（文字の内容自体は
  // allowlist化できない自由な識別子のため、シート書き込み時にsanitizeForSheetで防御する）。
  if (typeof data.submission_id !== 'string') return 'submission_id_invalid_type';
  if (data.submission_id.length === 0 || data.submission_id.length > MAX_SUBMISSION_ID_LENGTH) {
    return 'submission_id_invalid_length';
  }

  if (ALLOWED_Q1.indexOf(data.q1_first_choice) === -1) return 'q1_invalid';
  if (ALLOWED_Q2.indexOf(data.q2_second_choice || '') === -1) return 'q2_invalid';

  var q1IsNone = data.q1_first_choice === '今回は特にない';
  if (q1IsNone) {
    // Q1が「今回は特にない」の場合、Q3は必ずnot_applicableで保存する（通常回答と混在させない）。
    if (data.q3_participation_intent !== 'not_applicable') return 'q3_should_be_not_applicable';
  } else {
    // Q1が具体的な企画の場合、Q3はnot_applicable以外の許可値のいずれかである必要がある。
    if (data.q3_participation_intent === 'not_applicable') return 'q3_not_applicable_not_allowed';
    if (ALLOWED_Q3.indexOf(data.q3_participation_intent) === -1) return 'q3_invalid';
  }

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

  // 連絡先・自由記述：型チェック（同様の理由）→ 文字数上限 → メールの簡易形式チェック。
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

  return null; // 問題なし
}

/**
 * ヘッダー行（1行目）を実際に読み取り、submission_id列の位置を探す。
 * COLUMNS配列の並び順を決め打ちにしない（レビュー指摘）。これにより、既存シートに
 * 手動で列を追加した場合でも、ヘッダーのラベルさえ一致していれば安全に動作する。
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

    // 冪等性の前提として、シートのヘッダーに submission_id 列が実在することを確認する。
    // 列が見つからない状態で処理を続けると、重複判定ができないまま無条件に追記して
    // しまう（＝冪等性が黙って効かなくなる）ため、事故を防ぐために明示的にエラーとする。
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
 * Q3（参加可能性）を通知メール向けの短い文字列に整形する。
 * Q1が「今回は特にない」の場合、Q3は常に 'not_applicable' で保存されている（validatePayload参照）
 * ため、そのまま出すと分かりにくい文字列になる。表示用に補足を添える。
 */
function formatQ3ForNotification(data) {
  if (data.q3_participation_intent === 'not_applicable') {
    return '（Q1で「今回は特にない」を選択のため対象外）';
  }
  return data.q3_participation_intent;
}

/**
 * 通知メール本文を組み立てる。
 * 個人情報の保存場所を増やさないため、contact_email / contact_x / free_comment / submission_id は
 * 意図的に含めない（Issue #192）。詳細な内容はGoogleスプレッドシート側で確認する運用とする。
 */
function buildNotificationBody(data, timestamp) {
  var receivedAt = Utilities.formatDate(timestamp, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  var lines = [
    'SNBC 次回企画アンケートに新しい回答がありました。',
    '',
    '受付日時: ' + receivedAt,
    'Q1 最も参加したい企画: ' + data.q1_first_choice,
    'Q3 参加可能性: ' + formatQ3ForNotification(data),
    'Q4 参加しやすい料金: ' + data.q4_price,
    'Q5 参加可能日: ' + formatQ5ForNotification(data),
    'Q6 気になる点: ' + (data.q6_concerns || '（該当なし）'),
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
 * 初回セットアップ用ヘルパー。Apps Scriptエディタでこの関数を選んで実行すると、
 * SHEET_NAME のシートの1行目にヘッダー行を書き込む（シートが無ければ作成する）。
 * 手動で1回だけ実行すればよい（デプロイ手順6を参照）。
 */
function setupHeaderRow() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  sheet.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]);
}
