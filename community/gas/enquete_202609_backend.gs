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
 * 5. Apps Scriptエディタ左側の関数選択で setupHeaderRow を選び、実行ボタン（▶）を押す。
 *    初回はGoogleの権限承認画面が出るので、自分のアカウントで承認する。
 *    これで1行目にヘッダー（列名）が書き込まれる。
 * 6. 右上「デプロイ」→「新しいデプロイ」。
 *    - 種類の選択：ウェブアプリ
 *    - 説明：任意（例：enquete_202609 v1）
 *    - 次のユーザーとして実行：自分
 *    - アクセスできるユーザー：全員
 * 7. 「デプロイ」を押すと「ウェブアプリのURL」が表示される（.../exec で終わるURL）。これをコピーする。
 * 8. コピーしたURLを community/enquete_202609.html 内の
 *    `GAS_ENDPOINT_URL = 'https://script.google.com/macros/s/PLACEHOLDER_REPLACE_WITH_DEPLOYED_WEB_APP_URL/exec'`
 *    の PLACEHOLDER_REPLACE_WITH_DEPLOYED_WEB_APP_URL 部分と置き換える。
 * 9. ブラウザで手順7のURLをそのまま開き、「SNBC enquete_202609 backend: OK」と表示されることを確認する
 *    （doGetの動作確認。POST自体はブラウザから直接テストできないため、実際のフォーム送信で確認する）。
 * 10. コードを後から修正した場合は、「デプロイ」→「デプロイを管理」→ 対象デプロイの編集（鉛筆アイコン）→
 *     バージョン「新バージョン」を選んで再デプロイする（URLを変えずにコードだけ更新するため）。
 * 11. 【submission_id列を追加した今回の更新を、既にデプロイ済みのシートに反映する場合】
 *     COLUMNS配列に'submission_id'列が増えたため、Apps Scriptエディタでコードを貼り替えた後、
 *     setupHeaderRow をもう一度実行してヘッダー行を更新すること。
 *     ただし setupHeaderRow は1行目（ヘッダー）のみを上書きし、既存のデータ行は移動しないため、
 *     もしテスト送信等で2行目以降にデータが既に入っている場合は、列がヘッダーとずれる。
 *     本番運用を始める前であれば、テスト行を削除してからヘッダーを更新すること。
 *     その後、手順10の通り「新バージョン」で再デプロイする（URLは変わらないためHTML側の再修正は不要）。
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
 */

var SHEET_NAME = 'responses';

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

/* ── 許可値のallowlist（フロント側HTMLの選択肢と1対1で一致させること。
   選択肢の文言をHTML側で変更した場合、ここも必ず同時に更新する） ── */
var ALLOWED_Q1 = [
  '学校セット撮影会（服装自由）', '野球ユニ交流会', 'サカユニ交流会',
  'ユニミックス交流会', '今回は特にない'
];
var ALLOWED_Q2 = [
  '学校セット撮影会（服装自由）', '野球ユニ交流会', 'サカユニ交流会',
  'ユニミックス交流会', '特になし', ''
];
var ALLOWED_Q3 = [
  '日程が合えばかなり参加したい',
  '条件（料金・人数など）が合えば参加を検討したい',
  '興味はあるが参加までは分からない',
  '見るだけ・投票だけ',
  'not_applicable'
];
var ALLOWED_Q4 = ['2,000円', '3,000円', '4,000円', '5,000円でも内容次第'];
var ALLOWED_Q6_ITEMS = [
  '一人参加が不安', '初対面の人との交流が不安', '撮られるのが苦手',
  '衣装を持っていない', '料金', '日程', '会場の広さ', '特になし', 'その他'
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
  return ContentService.createTextOutput('SNBC enquete_202609 backend: OK');
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
 * 指定したsubmission_idが既にシートに保存済みかどうかを調べる。
 * データ行が無い（ヘッダーのみ／空シート）場合は即falseを返し、無駄な読み取りを避ける。
 * 呼び出し元はLockServiceのロックを保持した状態で呼ぶこと（同時リクエストでの
 * 二重書き込みを防ぐため）。
 */
function isDuplicateSubmission(sheet, submissionId) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return false; // ヘッダー行のみ、またはデータなし
  var columnIndex = COLUMNS.indexOf('submission_id') + 1;
  var existingIds = sheet.getRange(2, columnIndex, lastRow - 1, 1).getValues();
  for (var i = 0; i < existingIds.length; i++) {
    if (existingIds[i][0] === submissionId) return true;
  }
  return false;
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

  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ ok: false, error: 'no_payload' });
    }

    var data;
    try {
      data = JSON.parse(e.postData.contents);
    } catch (parseError) {
      return jsonResponse({ ok: false, error: 'invalid_json' });
    }

    var validationError = validatePayload(data);
    if (validationError) {
      return jsonResponse({ ok: false, error: validationError });
    }

    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    if (!sheet) {
      return jsonResponse({ ok: false, error: 'sheet_not_found' });
    }

    // 冪等性：同じsubmission_idが既に保存済みなら、再送とみなし追記せず成功として返す。
    // LockService保持中に判定するため、同時リクエスト間でも競合しない。
    if (isDuplicateSubmission(sheet, data.submission_id)) {
      return jsonResponse({ ok: true });
    }

    var row = COLUMNS.map(function (key) {
      if (key === 'timestamp') return new Date();
      var value = data[key];
      if (value === undefined || value === null) return '';
      if (key === 'contact_email' || key === 'contact_x' || key === 'free_comment' || key === 'submission_id') {
        return sanitizeForSheet(value);
      }
      return value;
    });

    sheet.appendRow(row);

    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ ok: false, error: 'server_error', message: String(err) });
  } finally {
    if (gotLock) lock.releaseLock();
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * 初回セットアップ用ヘルパー。Apps Scriptエディタでこの関数を選んで実行すると、
 * SHEET_NAME のシートの1行目にヘッダー行を書き込む（シートが無ければ作成する）。
 * 手動で1回だけ実行すればよい（デプロイ手順5を参照）。
 */
function setupHeaderRow() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  sheet.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]);
}
