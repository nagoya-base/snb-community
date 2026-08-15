/**
 * 名古屋野球ユニ部｜2026年9月キャッチボール会 日程クロス集計アンケート バックエンド
 * Issue #225 で新設。
 *
 * baseball/enquete_202609.html から呼び出される。
 * 学校セット撮影会用（community/enquete_202609.html / community/gas/enquete_202609_backend.gs）とは
 * 完全に別のGoogleスプレッドシート・別のGoogle Apps Scriptプロジェクトとして運用すること。
 * 学校セット側のSheet・GAS・回答データには一切触れない。
 *
 * このファイルはリポジトリ内の正本だが、実行環境はGoogle Apps Script側。
 * GitHubへpushするだけでは反映されないため、次の順で手動反映する。
 *
 * ── デプロイ手順 ──
 * 1. 野球ユニ部専用の新規Googleスプレッドシートを作成する（学校セット用Sheetとは別ファイル）。
 * 2. 対象スプレッドシートの「拡張機能」→「Apps Script」を開き、Code.gsをこの内容に置き換える。
 * 3. NOTIFICATION_EMAIL を実運用の通知先アドレスに書き換える（プレースホルダー
 *    'YOUR_NOTIFICATION_EMAIL' のままだと通知メールは送信されない。doGet()を開くと警告が出る）。
 * 4. スクリプトエディタの関数選択で setupHeaderRow を選び、1回実行する。
 *    responses シートへヘッダー行（18列：submission_id 〜 free_comment）を作成する
 *    （既に回答がある状態で実行すると安全装置により例外で停止する）。
 * 5. 「デプロイ」→「新しいデプロイ」→「ウェブアプリ」。実行ユーザーは自分、
 *    アクセス権は「全員」にする。
 * 6. 発行された /exec URL を baseball/enquete_202609.html の GAS_ENDPOINT_URL に設定する。
 * 7. /exec URLをブラウザで開き、「baseball enquete_202609 backend: OK」と表示されることを確認する。
 * 8. 公開ページ（?test=1 を付けない本番URL）から1件だけ疎通し、Sheetsの保存内容（18列目まで）と
 *    通知メールの件名・本文を確認する。
 * 9. baseball/gas/enquete_202609_results_backend.gs の RESULTS_SPREADSHEET_ID に、
 *    このスプレッドシートのID（URLの /d/ と /edit の間の文字列）を設定して集計APIもデプロイする。
 *
 * ── APIレベルのテストモード（?test=1） ──
 * baseball/enquete_202609.html の画面側テストモード（?test=1）は、この節とは別に、
 * そもそもこのバックエンドへリクエストを送らない設計になっている（本番Sheet・通知・GA4を
 * 一切汚さず入力〜完了画面まで確認できるようにするため）。
 *
 * それとは別に、このバックエンド自体にもテストモードを用意する。デプロイ後の実疎通確認
 * （本物の /exec URLへ直接POSTして冪等性・upsert・contact_conflictの実挙動を確認する用途）で、
 * 本番の responses シートや運営への通知メールを一切汚さずに済むようにするためのもの。
 *
 * 使い方：POST先のURLに ?test=1 を付ける（例： {デプロイ後の/exec URL}?test=1）。
 * - 書き込み先が本番の 'responses' ではなく、専用の 'test_responses' シートになる
 *   （存在しなければCOLUMNSヘッダー付きで自動作成される）。冪等性・連絡先upsert・
 *   contact_conflict判定などのロジックはすべて本番と同一だが、対象データは
 *   test_responsesシート内に完結し、本番データには一切影響しない。
 * - 通知メールは送信されない（NOTIFICATION_EMAILの設定に関わらず）。
 * - レスポンスJSONに test_mode:true が含まれる。
 * - baseball/gas/enquete_202609_results_backend.gs 側も ?action=summary&test=1 で
 *   test_responsesシートだけを集計するテスト専用エンドポイントを持つ（本番集計には出ない）。
 * - QA・疎通確認が終わったら、スクリプトエディタの関数選択で resetTestSheet を実行すると、
 *   test_responsesシートの中身（ヘッダー以外）を一括で消せる。
 *
 * ── 同一人物1票・再回答upsertの方式（Issue #225） ──
 * submission_id は「送信操作」単位の冪等性キーとして維持する。同じsubmission_idの再送は
 * 行を増やさず、通知メールも送らない（processSubmission_内で最優先に判定する）。
 *
 * これとは別に、正規化した連絡先（メールアドレス／Xアカウント）を使って「同一人物」を判定し、
 * 一致する既存行があれば新規追記ではなく、その行を上書き更新する。
 *
 * 照合ルール：
 * - 送信された正規化メール・正規化Xのどちらも既存のどの行にも一致しない → 新規行として追記
 * - どちらか一方だけが1つの既存行に一致 → その行を更新
 * - メール・Xの両方が同じ1つの既存行を指す → その行を更新
 * - メールが指す既存行とXが指す既存行が別々（contact_conflict） → 書き込みを拒否する。
 *   既存のどちらの行もいっさい変更しない。
 *
 * 更新時の列の扱い：
 * - created_at … 初回保存時の値をそのまま維持する
 * - updated_at … 今回の受付時刻に更新する
 * - submission_id … 今回送信された新しい値に置き換える
 * - それ以外の回答列（display_name/contact_email/contact_x/participation_intent/
 *   日付6列/no_available_date/time_preferences/activity_preferences/
 *   participation_history/free_comment） … すべて今回送信された最新の内容に置き換える
 *   （前回値との差分マージは行わない。連絡先のどちらかを今回未入力にした場合、その列は
 *   空欄で上書きされる）。
 *
 * ── 連絡先の正規化 ──
 * メール：前後の空白を除去し、小文字化する（normalizeEmail_）。
 *
 * Xアカウント（normalizeXHandle_）：
 * @example / example / https://x.com/example / https://twitter.com/example を
 * すべて同一人物として扱えるよう、次の手順で正規化する。
 * 1. 前後の空白を除去する。空文字列はそのまま「未入力」として扱う。
 * 2. http(s):// で始まる場合はURL形式とみなし、クエリ・フラグメントを除いた上で、
 *    ホストが x.com / twitter.com（www. / mobile. サブドメイン許容）かつ
 *    パスが「/ハンドル」または「/ハンドル/」の1階層だけであることを確認する。
 *    ステータスURL（/ハンドル/status/123 等）、ホーム・検索等の非プロフィールパスを含む
 *    URLは、誤マッチを避けるため不正な形式として拒否する。
 * 3. URL形式でない場合はそのままハンドル文字列として扱い、先頭の @ があれば除去する。
 * 4. 最終的なハンドルが英数字・アンダースコアのみ・1〜15文字であること（Xのユーザー名仕様）を
 *    確認する。満たさない場合、または home/search 等の予約語に一致する場合は不正な形式として拒否する。
 * 5. 小文字化した値を、正規化後のXアカウントとして保存・照合に使う。
 *
 * URLとして解釈できない・不正な形式のXアカウントはバリデーションエラーとして送信自体を拒否し、
 * 誤って別人と同一視（誤マッチ）することがないようにする。
 *
 * フロント側 baseball/enquete_202609.html の normalizeXHandle() は、この関数と
 * 同じロジックを画面側の即時バリデーション用に複製している。仕様を変更する場合は両方を
 * 同期させること（最終的な正規化・照合の権威はこのファイル側）。
 *
 * ── この版で踏襲した安全設計 ──
 * ・submission_id による冪等性（同じsubmission_idの再送は行を増やさず、通知もしない）
 * ・LockService（既存照合〜書き込みまでロック内で完結させる。doPost→processSubmission_）
 * ・Formula Injection対策（sanitizeForSheet_。submission_id/display_name/contact_email/
 *   contact_x/free_comment に適用）
 * ・サーバー側allowlist（participation_intent/participation_history/time_preferences/
 *   activity_preferences はフロントの選択肢と1対1で一致させたallowlistで検証する）
 * ・型・文字数検証（display_name<=50 / contact_email<=200 / contact_x<=200 /
 *   free_comment<=300、日付6列とno_available_dateは厳密なboolean）
 * ・候補日は date_0905/date_0906/date_0913/date_0919/date_0920/date_0927 の6列のみ
 *   （9/12・9/26は列として存在しない）
 * ・送信失敗時に成功扱いしない（バリデーションエラー・contact_conflict・server_errorは
 *   すべて ok:false を返し、Sheetへは一切書き込まない）
 * ・duplicate時（同一submission_id再送）の重複保存・重複通知抑止
 * ・新規回答／更新回答で通知メールの件名を分ける
 * ・通知メール本文にはメール・X・自由記述・submission_idを含めない
 */

var SHEET_NAME = 'responses';

/* APIレベルのテストモード（POST先URLに ?test=1）専用の書き込み先。ファイル冒頭コメントの
   「APIレベルのテストモード」を参照。baseball/gas/enquete_202609_results_backend.gs の
   RESULTS_TEST_SHEET_NAME と同じ文字列にすること。 */
var TEST_SHEET_NAME = 'test_responses';

/* 新しい回答・更新回答が保存されたときの通知先。デプロイ手順3の通り、実際の運営者アドレスに書き換えること。 */
var NOTIFICATION_EMAIL = 'YOUR_NOTIFICATION_EMAIL';

var NOTIFICATION_EMAIL_SUBJECT_NEW = '【名古屋野球ユニ部】9月日程アンケートに新しい回答があります';
var NOTIFICATION_EMAIL_SUBJECT_UPDATE = '【名古屋野球ユニ部】9月日程アンケートの回答が更新されました';

/* Sheetの列構成（18列）。upsertの都合上 submission_id を先頭、created_at/updated_at を
   その直後に置く。列の並び・列名を変更する場合はsetupHeaderRow()実行前に必ずこの配列も
   更新し、既存回答がある状態でヘッダーだけ変えないこと（列ずれ事故防止）。 */
var COLUMNS = [
  'submission_id',
  'created_at',
  'updated_at',
  'display_name',
  'contact_email',
  'contact_x',
  'participation_intent',
  'date_0905',
  'date_0906',
  'date_0913',
  'date_0919',
  'date_0920',
  'date_0927',
  'no_available_date',
  'time_preferences',
  'activity_preferences',
  'participation_history',
  'free_comment'
];

/* 候補日は必ずこの6列のみ。9/12・9/26は候補日に含めない（Issue #225で明示的に禁止）。 */
var DATE_KEYS = ['date_0905', 'date_0906', 'date_0913', 'date_0919', 'date_0920', 'date_0927'];

/* 通知メール本文でQ4の参加可能日を人が読める形式で表示するためのラベル
   （baseball/enquete_202609.html の日付選択肢と1対1で一致させること）。 */
var DATE_LABELS = {
  date_0905: '9/5（土）',
  date_0906: '9/6（日）',
  date_0913: '9/13（日）',
  date_0919: '9/19（土）',
  date_0920: '9/20（日）',
  date_0927: '9/27（日）'
};

/* ── 許可値のallowlist（フロント側HTMLの選択肢と1対1で一致させること。
   選択肢の文言をHTML側で変更した場合、ここも必ず同時に更新する） ── */
var ALLOWED_PARTICIPATION_INTENT = [
  '日程が合えば参加したい',
  'たぶん参加したい',
  '条件次第で参加を検討したい',
  '今回は日程投票だけ'
];
var ALLOWED_PARTICIPATION_HISTORY = [
  '初参加',
  '以前参加したことがある'
];
var ALLOWED_TIME_PREFERENCES = [
  '午前', '13〜15時ごろ', '15〜17時ごろ', '夕方でも可', '時間は特にこだわらない'
];
var ALLOWED_ACTIVITY_PREFERENCES = [
  'キャッチボール', 'ノック', '守備・送球練習', '初心者向け練習', '軽く写真撮影', '練習後の銭湯', '練習後の飲み会'
];

var MAX_DISPLAY_NAME_LENGTH = 50; // フロントのmaxlengthと一致させる
var MAX_CONTACT_LENGTH = 200; // フロントのcontact-email/contact-xのmaxlengthと一致させる
var MAX_FREE_COMMENT_LENGTH = 300; // フロントのmaxlengthと一致させる
var MAX_SUBMISSION_ID_LENGTH = 100; // crypto.randomUUID()は36文字、フォールバック生成でも数十文字程度のため十分な余裕
var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; // 簡易チェック（RFC完全準拠ではない）
var X_HANDLE_PATTERN = /^[A-Za-z0-9_]{1,15}$/; // Xのユーザー名仕様（英数字・アンダースコア、1〜15文字）
var X_PROFILE_URL_PATTERN = /^https?:\/\/(?:www\.|mobile\.)?(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,15})\/?$/i;
/* プロフィールURLとして解釈すべきでない既知の非ハンドルパス（誤マッチ防止）。 */
var X_RESERVED_HANDLES = [
  'home', 'i', 'search', 'explore', 'notifications', 'messages', 'settings',
  'compose', 'intent', 'hashtag', 'share', 'login', 'logout', 'tos', 'privacy', 'about', 'download'
];

/**
 * Googleスプレッドシートの数式インジェクション対策。
 * 自由入力欄（submission_id / display_name / contact_email / contact_x / free_comment）は、
 * 先頭が =, +, -, @ の場合にスプレッドシート側で数式として解釈される可能性があるため、
 * 先頭に ' を付けて強制的に文字列として保存する。
 * allowlistで検証済みの participation_intent / participation_history /
 * time_preferences / activity_preferences / 日付各列には適用不要（許可された固定文言のみのため）。
 */
function sanitizeForSheet_(value) {
  if (typeof value !== 'string') return value;
  if (/^[=+\-@]/.test(value)) {
    return "'" + value;
  }
  return value;
}

function doGet(e) {
  var message = 'baseball enquete_202609 backend: OK';
  if (NOTIFICATION_EMAIL === 'YOUR_NOTIFICATION_EMAIL') {
    message += '\n[WARNING] NOTIFICATION_EMAIL が未設定です（プレースホルダーのままです）。' +
      'このままでは運営者への通知メールが送信されません。実際の宛先へ書き換えてください。';
  }
  message += '\n[INFO] POST先URLに ?test=1 を付けると、書き込み先が本番のresponsesではなく' +
    'test_responsesシートになり、通知メールも送信されません（疎通確認用。詳細はファイル冒頭コメント参照）。';
  return ContentService.createTextOutput(message);
}

function normalizeEmail_(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim().toLowerCase();
}

/**
 * Xアカウント文字列を正規化する。詳細な仕様はファイル冒頭コメントを参照。
 * 戻り値：
 *   { ok: true, value: '' }               … 未入力（空文字列）
 *   { ok: true, value: '正規化済みハンドル（小文字）' } … 正常
 *   { ok: false }                          … 不正な形式（誤マッチを避けるため拒否）
 */
function normalizeXHandle_(raw) {
  if (typeof raw !== 'string') return { ok: false };
  var trimmed = raw.trim();
  if (trimmed === '') return { ok: true, value: '' };

  var handle;
  if (/^https?:\/\//i.test(trimmed)) {
    var withoutQuery = trimmed.split(/[?#]/)[0];
    var match = withoutQuery.match(X_PROFILE_URL_PATTERN);
    if (!match) return { ok: false };
    handle = match[1];
  } else {
    handle = trimmed.charAt(0) === '@' ? trimmed.slice(1) : trimmed;
  }

  if (!X_HANDLE_PATTERN.test(handle)) return { ok: false };
  var lower = handle.toLowerCase();
  if (X_RESERVED_HANDLES.indexOf(lower) !== -1) return { ok: false };
  return { ok: true, value: lower };
}

/**
 * リクエストの内容を検証する。フロント側でも同じ制約を検証済みだが、このWebアプリは
 * 公開エンドポイントであり、フォームを介さず直接POSTされる可能性があるため、
 * 連絡先という個人情報を保存する以上、フロントを信用せずサーバー側でも同じ制約を再検証する。
 * 戻り値：{ error: null, normalizedEmail, normalizedX, displayName } … 問題なし
 *         { error: 'エラーコード文字列' } … 問題あり
 */
function validatePayload_(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { error: 'payload_invalid' };

  if (typeof data.submission_id !== 'string') return { error: 'submission_id_invalid_type' };
  if (data.submission_id.length === 0 || data.submission_id.length > MAX_SUBMISSION_ID_LENGTH) {
    return { error: 'submission_id_invalid_length' };
  }

  if (typeof data.display_name !== 'string') return { error: 'display_name_invalid_type' };
  if (data.display_name.length > MAX_DISPLAY_NAME_LENGTH) return { error: 'display_name_too_long' };
  var displayName = data.display_name.trim();
  if (displayName === '') return { error: 'display_name_required' };

  if (typeof data.contact_email !== 'string') return { error: 'contact_email_invalid_type' };
  if (data.contact_email.length > MAX_CONTACT_LENGTH) return { error: 'contact_email_too_long' };
  var normalizedEmail = normalizeEmail_(data.contact_email);
  if (normalizedEmail !== '' && !EMAIL_PATTERN.test(normalizedEmail)) return { error: 'contact_email_invalid_format' };

  if (typeof data.contact_x !== 'string') return { error: 'contact_x_invalid_type' };
  if (data.contact_x.length > MAX_CONTACT_LENGTH) return { error: 'contact_x_too_long' };
  var xResult = normalizeXHandle_(data.contact_x);
  if (!xResult.ok) return { error: 'contact_x_invalid_format' };
  var normalizedX = xResult.value;

  if (normalizedEmail === '' && normalizedX === '') return { error: 'contact_required' };

  if (ALLOWED_PARTICIPATION_INTENT.indexOf(data.participation_intent) === -1) return { error: 'participation_intent_invalid' };

  // 日付：各列は厳密にboolean型であること（文字列"true"等は許可しない）。
  var anyDateTrue = false;
  for (var i = 0; i < DATE_KEYS.length; i++) {
    var key = DATE_KEYS[i];
    var value = data[key];
    if (typeof value !== 'boolean') return { error: key + '_not_boolean' };
    if (value) anyDateTrue = true;
  }
  if (typeof data.no_available_date !== 'boolean') return { error: 'no_available_date_not_boolean' };

  // 排他関係：「9月は参加できない」がtrueの場合、日付は全てfalseでなければならない。
  if (data.no_available_date === true && anyDateTrue) return { error: 'date_exclusive_violation' };
  // どちらも埋まっていない（fetch改造等で両方false）場合も不正とする。
  if (data.no_available_date !== true && !anyDateTrue) return { error: 'date_missing' };

  if (typeof data.time_preferences !== 'string') return { error: 'time_preferences_invalid_type' };
  var timePrefRaw = data.time_preferences || '';
  var timePrefItems = timePrefRaw === '' ? [] : timePrefRaw.split('、');
  for (var t = 0; t < timePrefItems.length; t++) {
    if (ALLOWED_TIME_PREFERENCES.indexOf(timePrefItems[t]) === -1) return { error: 'time_preferences_invalid_item' };
  }

  if (typeof data.activity_preferences !== 'string') return { error: 'activity_preferences_invalid_type' };
  var activityRaw = data.activity_preferences || '';
  var activityItems = activityRaw === '' ? [] : activityRaw.split('、');
  for (var a = 0; a < activityItems.length; a++) {
    if (ALLOWED_ACTIVITY_PREFERENCES.indexOf(activityItems[a]) === -1) return { error: 'activity_preferences_invalid_item' };
  }

  if (ALLOWED_PARTICIPATION_HISTORY.indexOf(data.participation_history) === -1) return { error: 'participation_history_invalid' };

  if (typeof data.free_comment !== 'string') return { error: 'free_comment_invalid_type' };
  if (data.free_comment.length > MAX_FREE_COMMENT_LENGTH) return { error: 'free_comment_too_long' };

  return { error: null, normalizedEmail: normalizedEmail, normalizedX: normalizedX, displayName: displayName };
}

/**
 * 現在のヘッダーがCOLUMNSと完全一致するか確認する。
 * 旧ヘッダーのままappendすると列がずれるため、setupHeaderRowの実行漏れを保存前に明示的に止める。
 */
function hasExpectedHeader_(sheet) {
  var lastColumn = sheet.getLastColumn();
  if (lastColumn !== COLUMNS.length) return false;
  var header = sheet.getRange(1, 1, 1, COLUMNS.length).getValues()[0];
  for (var i = 0; i < COLUMNS.length; i++) {
    if (header[i] !== COLUMNS[i]) return false;
  }
  return true;
}

/**
 * APIレベルのテストモード（?test=1）用のシートを取得する。存在しなければCOLUMNSヘッダー付きで
 * 新規作成する（テスト用途のため、setupHeaderRowのような「既存回答があると例外停止」という
 * 安全装置は設けない＝疎通確認のたびに毎回気軽に使える設計）。
 * 既に存在するがヘッダーが一致しない場合は、呼び出し元のhasExpectedHeader_チェックに委ねる
 * （誤って重要なシートを同名で使っていた場合に、無言で上書きしないための安全策）。
 */
function getOrCreateTestSheet_(ss) {
  var sheet = ss.getSheetByName(TEST_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(TEST_SHEET_NAME);
    sheet.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]);
  }
  return sheet;
}

/**
 * ロック保持中に行う本体処理（payload検証・submission_id冪等性判定・連絡先による同一人物照合・
 * Sheetsへの追記または上書き更新まで）。Issue #225の要件により、既存照合から書き込みまでを
 * このLockService保持区間の中で完結させる。
 * isTestModeがtrueの場合、書き込み先は本番のSHEET_NAMEではなくTEST_SHEET_NAMEになる
 * （ファイル冒頭コメント「APIレベルのテストモード」を参照）。判定・照合ロジック自体は
 * 本番と同一で、対象データが異なるだけ。
 * メール送信はここでは行わない。MailApp.sendEmail()はネットワーク呼び出しを伴い遅延しうるため、
 * ロックを保持したまま呼ぶと後続リクエストの待ち時間が延び、busyになりやすくなる。
 * そのため通知が必要な場合は必要な情報を呼び出し元に返すだけにとどめ、実際の送信は
 * doPost側でロック解放後に行う（テストモード時はdoPost側で送信自体をスキップする）。
 * 戻り値：{ response: ContentServiceのレスポンス, notify: 保存が発生した場合のみ通知情報、それ以外はnull }
 */
function processSubmission_(e, isTestMode) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return { response: jsonResponse_({ ok: false, error: 'no_payload' }), notify: null };
    }

    var data;
    try {
      data = JSON.parse(e.postData.contents);
    } catch (parseError) {
      return { response: jsonResponse_({ ok: false, error: 'invalid_json' }), notify: null };
    }

    var validated = validatePayload_(data);
    if (validated.error) {
      return { response: jsonResponse_({ ok: false, error: validated.error }), notify: null };
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = isTestMode ? getOrCreateTestSheet_(ss) : ss.getSheetByName(SHEET_NAME);
    if (!sheet) {
      return { response: jsonResponse_({ ok: false, error: isTestMode ? 'test_sheet_not_found' : 'sheet_not_found' }), notify: null };
    }
    if (!hasExpectedHeader_(sheet)) {
      return { response: jsonResponse_({ ok: false, error: 'header_mismatch' }), notify: null };
    }

    var colIndex = {};
    COLUMNS.forEach(function (name, i) { colIndex[name] = i; });

    var lastRow = sheet.getLastRow();
    var dataRows = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, COLUMNS.length).getValues() : [];

    // 1) submission_id冪等性：送信操作そのものの再送は行を増やさず・通知もしない。
    for (var s = 0; s < dataRows.length; s++) {
      if (dataRows[s][colIndex.submission_id] === data.submission_id) {
        return { response: jsonResponse_({ ok: true, duplicate: true, test_mode: isTestMode }), notify: null };
      }
    }

    // 2) 連絡先の正規化値で既存行を照合する（同一人物1票の判定）。
    var emailRowIndex = -1;
    var xRowIndex = -1;
    if (validated.normalizedEmail !== '') {
      for (var m = 0; m < dataRows.length; m++) {
        if (dataRows[m][colIndex.contact_email] === validated.normalizedEmail) { emailRowIndex = m; break; }
      }
    }
    if (validated.normalizedX !== '') {
      for (var n = 0; n < dataRows.length; n++) {
        if (dataRows[n][colIndex.contact_x] === validated.normalizedX) { xRowIndex = n; break; }
      }
    }

    if (emailRowIndex !== -1 && xRowIndex !== -1 && emailRowIndex !== xRowIndex) {
      // メールが指す既存行とXが指す既存行が別々。自動更新すると誤って別人の回答を
      // 書き換える恐れがあるため、既存行はいっさい変更せず書き込みを拒否する。
      return { response: jsonResponse_({ ok: false, error: 'contact_conflict', test_mode: isTestMode }), notify: null };
    }

    var targetIndex = emailRowIndex !== -1 ? emailRowIndex : xRowIndex; // -1なら新規行
    var isUpdate = targetIndex !== -1;
    var now = new Date();
    var createdAt = isUpdate ? dataRows[targetIndex][colIndex.created_at] : now;

    var row = COLUMNS.map(function (key) {
      if (key === 'created_at') return createdAt;
      if (key === 'updated_at') return now;
      if (key === 'submission_id') return sanitizeForSheet_(data.submission_id);
      if (key === 'display_name') return sanitizeForSheet_(validated.displayName);
      if (key === 'contact_email') return sanitizeForSheet_(validated.normalizedEmail);
      if (key === 'contact_x') return sanitizeForSheet_(validated.normalizedX);
      if (key === 'free_comment') return sanitizeForSheet_(data.free_comment);
      var value = data[key];
      return value === undefined || value === null ? '' : value;
    });

    if (isUpdate) {
      sheet.getRange(targetIndex + 2, 1, 1, COLUMNS.length).setValues([row]);
    } else {
      sheet.appendRow(row);
    }

    return {
      response: jsonResponse_({ ok: true, duplicate: false, test_mode: isTestMode, action: isUpdate ? 'update' : 'new' }),
      notify: { data: data, displayName: validated.displayName, timestamp: now, isUpdate: isUpdate }
    };
  } catch (err) {
    return { response: jsonResponse_({ ok: false, error: 'server_error', message: String(err) }), notify: null };
  }
}

function doPost(e) {
  // APIレベルのテストモード。POST先URLに ?test=1 を付けた場合のみ有効になる
  // （ファイル冒頭コメント「APIレベルのテストモード」を参照）。
  var isTestMode = !!(e && e.parameter && e.parameter.test === '1');

  var lock = LockService.getScriptLock();
  var gotLock = false;
  try {
    gotLock = lock.tryLock(10000); // 最大10秒待機
  } catch (lockAcquireError) {
    gotLock = false;
  }

  if (!gotLock) {
    return jsonResponse_({ ok: false, error: 'busy' });
  }

  var result;
  try {
    result = processSubmission_(e, isTestMode);
  } finally {
    lock.releaseLock();
  }

  // 通知メールはSheets保存に対して補助処理であり、失敗しても回答自体は成功として返す。
  // ロック解放後に送ることで、メール送信の遅延が後続リクエストのbusy化に響かないようにする。
  // テストモードでは、本番運営者へ通知メールを一切送らない。
  if (result.notify && !isTestMode) {
    sendNotificationEmailSafely_(result.notify);
  }

  return result.response;
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Q4（参加可能日）を通知メール向けの短い文字列に整形する。
 * 「9月は参加できない」が選ばれている場合はそちらを優先して表示する
 * （validatePayload_により日付側とは排他であることが保証されている）。
 */
function formatDateSelectionForNotification_(data) {
  if (data.no_available_date === true) return '9月は参加できない';
  var selected = [];
  for (var i = 0; i < DATE_KEYS.length; i++) {
    var key = DATE_KEYS[i];
    if (data[key] === true) selected.push(DATE_LABELS[key]);
  }
  return selected.length > 0 ? selected.join('、') : '（未選択）';
}

/**
 * 通知メール本文を組み立てる。
 * 個人情報の保存場所を増やさないため、contact_email / contact_x / free_comment / submission_id は
 * 意図的に含めない。display_name（お名前／ハンドルネーム）は記名式アンケートの通知として
 * 運営が把握できるよう本文に含める。詳細な内容はGoogleスプレッドシート側で確認する運用とする。
 */
function buildNotificationBody_(notify) {
  var data = notify.data;
  var receivedAt = Utilities.formatDate(notify.timestamp, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  var lines = [
    '名古屋野球ユニ部 9月キャッチボール会 日程アンケートに' + (notify.isUpdate ? '更新回答' : '新しい回答') + 'がありました。',
    '',
    '受付日時: ' + receivedAt,
    '種別: ' + (notify.isUpdate ? '再回答（既存回答の更新）' : '新規回答'),
    'お名前／ハンドルネーム: ' + notify.displayName,
    '参加意向: ' + data.participation_intent,
    '参加可能日: ' + formatDateSelectionForNotification_(data),
    '希望時間帯: ' + (data.time_preferences || '（未回答）'),
    'やってみたいこと: ' + (data.activity_preferences || '（未回答）'),
    '参加経験: ' + data.participation_history,
    '',
    '詳細はGoogleスプレッドシートで確認してください。'
  ];
  return lines.join('\n');
}

/**
 * 運営者への通知メールを送る。呼び出し元（doPost）はsubmission_idの冪等性判定・連絡先照合を
 * appendRow/setValuesより前に済ませており、この関数は新規保存または更新保存が確定した後にしか
 * 呼ばれないため、通知メールは1回の保存につき1回だけ送られる。
 * メール送信失敗を回答送信失敗として扱わないため、失敗は握りつぶしログに残すだけにする。
 */
function sendNotificationEmailSafely_(notify) {
  if (NOTIFICATION_EMAIL === 'YOUR_NOTIFICATION_EMAIL') {
    console.error('[baseball_enquete_202609] NOTIFICATION_EMAIL がプレースホルダーのままのため、通知メール送信をスキップしました。デプロイ手順3の通り実際の運営者アドレスに書き換えてください。');
    return;
  }
  try {
    MailApp.sendEmail({
      to: NOTIFICATION_EMAIL,
      subject: notify.isUpdate ? NOTIFICATION_EMAIL_SUBJECT_UPDATE : NOTIFICATION_EMAIL_SUBJECT_NEW,
      body: buildNotificationBody_(notify)
    });
  } catch (mailError) {
    console.error('[baseball_enquete_202609] notification mail failed: ' + mailError);
  }
}

/**
 * ヘッダー再作成用。回答が0件（新規シート・空シート）のときだけ実行できる（デプロイ手順4）。
 * COLUMNS（18列：submission_id 〜 free_comment）でヘッダーを作成する。
 * データ行がある場合は、列ずれによる破損を避けるため明示的に停止する。
 */
function setupHeaderRow() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() > 1) {
    throw new Error('既存の回答があるためsetupHeaderRowは実行できません。列構成を変更する場合は非破壊マイグレーションを別途実装してください。');
  }
  var existingColumnCount = sheet.getLastColumn();
  if (existingColumnCount > 0) {
    sheet.getRange(1, 1, 1, existingColumnCount).clearContent();
  }
  sheet.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]);
}

/**
 * APIレベルのテストモード（?test=1）で溜まったtest_responsesシートのデータを、
 * ヘッダー行だけ残して一括で消す。QA・疎通確認が終わったら、スクリプトエディタの
 * 関数選択でこれを1回実行する。本番の'responses'シートには一切触れない。
 * test_responsesシート自体が存在しない場合は何もしない。
 */
function resetTestSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(TEST_SHEET_NAME);
  if (!sheet) return;
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  if (lastRow > 1 && lastColumn > 0) {
    sheet.getRange(2, 1, lastRow - 1, lastColumn).clearContent();
  }
}
