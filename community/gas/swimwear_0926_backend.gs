/**
 * （競パン＆教室セット交流会）参加申込 バックエンド（form-builder自動生成テンプレート）
 * 生成元: tools/form-builder/（Issue #266）。生成元フォーム: community/swimwear_0926.html
 *
 * このファイルはform-builderが .form.json から自動生成したテンプレートである。
 * リポジトリへのpushだけでは反映されない。実行環境はGoogle Apps Script側のため、
 * 次の手順で運営者が手動反映すること（新規Apps Scriptプロジェクト作成・
 * Google側認可・初回Web Appデプロイ・/exec URL発行は自動化されない）。
 *
 * ── デプロイ手順 ──
 * 1. このフォーム専用の新規Googleスプレッドシートを作成する（他フォームとは別ファイル）。
 * 2. 「拡張機能」→「Apps Script」を開き、Code.gsをこの内容に置き換える。
 * 3. NOTIFICATION_EMAIL を実運用の通知先アドレスに書き換える（プレースホルダーの
 *    ままだと通知メールは送信されない。doGet()を開くと警告が出る）。
 * 4. スクリプトエディタの関数選択で setupHeaderRow を選び、1回実行する。
 *    responses シートへヘッダー行（14列）を作成する
 *    （既に回答がある状態で実行すると安全装置により例外で停止する）。
 * 5. 「デプロイ」→「新しいデプロイ」→「ウェブアプリ」。実行ユーザーは自分、
 *    アクセス権は「全員」にする。
 * 6. 発行された /exec URL を、form-builderの「GAS Web App連携」欄に設定してから
 *    PRを作成する（このテンプレートはURL確定前に生成しているため、URLの埋め込みはない）。
 * 7. /exec URLをブラウザで開き、「swimwear_0926_form backend: OK」と表示されることを確認する。
 * 8. 公開ページ（?test=1 を付けない本番URL）から1件だけ疎通し、Sheetsの保存内容と
 *    通知メールの件名・本文を確認する。
 *
 * ── 個人情報・通知メールに関する運用要件（Issue #266） ──
 * 通知メール本文には、保存対象項目のうち通知対象に選ばれた項目を日本語ラベル付きで
 * 掲載する（未回答も「（未入力）」として省略しない）。メールアドレス・Xアカウント・
 * 自由記述等のPIIが本文に含まれる運用であることに留意し、通知先は運営者用メールのみとし、
 * 応募者本人への自動返信とは分離すること。GA4等の外部サービスへは送信しない。
 *
 * ── この版で踏襲した安全設計 ──
 * ・submission_id による冪等性（同じsubmission_idの再送は行を増やさず、通知もしない）。
 * ・baseball方式の連絡先upsert（同一人物の再回答による行更新）は実装しない。
 *   再回答は新しい行として追記される（form-builderのスコープ外。手動拡張が必要な場合は
 *   baseball/gas/enquete_202609_backend.gs を参考に個別実装すること）。
 * ・LockService（重複チェック〜書き込みまでロック内で完結）。
 * ・Formula Injection対策（sanitizeForSheet_、文字列項目全体に適用）。
 * ・サーバー側allowlist（FIELD_SPECSのoptionsで選択肢系項目を検証。フロントの選択肢と
 *   1対1で一致させること。選択肢をform-builder側で変更した場合は再生成が必要）。
 * ・送信失敗時に成功扱いしない（バリデーションエラー・server_errorはok:falseを返し、
 *   Sheetへは一切書き込まない）。
 * ・duplicate時（同一submission_id再送）の重複保存・重複通知抑止。
 * ・メール送信失敗を回答送信失敗として扱わない（ログのみ）。
 * ・APIレベルのテストモード（POST先URLに ?test=1）：書き込み先が test_responses シートに
 *   なり、通知メールも送信されない。画面側の?test=1（forms.js）はそもそもこの
 *   バックエンドへリクエストを送らない設計のため、これとは別の仕組み。
 */

var SHEET_NAME = 'responses';
var TEST_SHEET_NAME = 'test_responses';

/* 新しい回答が保存されたときの通知先。デプロイ手順3の通り、実際の運営者アドレスに書き換えること。 */
var NOTIFICATION_EMAIL = 'YOUR_NOTIFICATION_EMAIL';
/* form-builderの通知メール設定（ON/OFF）。OFFの場合は保存のみ行い、メールは一切送らない。 */
var NOTIFICATION_ENABLED = true;
var NOTIFICATION_SUBJECT = "【SNBコミュニティ】（競パン＆教室セット交流会）参加申込に新しい回答がありました";

/* Sheetの列構成。form-builderの設定JSON（保存対象の全項目）から生成される。
   列の並び・列名を変更する場合はsetupHeaderRow()実行前に必ずこの配列も再生成し、
   既存回答がある状態でヘッダーだけ変えないこと（列ずれ事故防止）。 */
var COLUMNS = [
  "submission_id",
  "created_at",
  "updated_at",
  "display_name",
  "contact_email",
  "contact_x",
  "agree_terms",
  "wear_items",
  "wear_items_other",
  "wear_ownership",
  "first_time",
  "concerns",
  "concerns_other",
  "free_comment"
];

/* 通知メール本文にCOLUMNSを漏れなく掲載するための日本語ラベル（Issue #263 / #266）。 */
var COLUMN_LABELS = {
  "submission_id": "送信ID",
  "created_at": "初回受付日時",
  "updated_at": "今回受付日時",
  "display_name": "お名前／表示名",
  "contact_email": "メールアドレス",
  "contact_x": "Xアカウント",
  "agree_terms": "同意事項への同意",
  "wear_items": "当日の衣装",
  "wear_items_other": "当日の衣装（その他自由記述）",
  "wear_ownership": "衣装の準備状況",
  "first_time": "このイベントは初参加ですか",
  "concerns": "不安な点・気になる点",
  "concerns_other": "不安な点・気になる点（その他自由記述）",
  "free_comment": "運営への質問・応援メッセージ"
};

/* 通知メール対象の項目（キー・ラベル）。form-builderの「通知対象項目」設定から生成される
   （config.notification.fieldsのうちenabled!==falseのもの、順序も設定通り）。 */
var NOTIFICATION_FIELDS = [
  {
    "key": "submission_id",
    "label": "送信ID"
  },
  {
    "key": "created_at",
    "label": "初回受付日時"
  },
  {
    "key": "updated_at",
    "label": "今回受付日時"
  },
  {
    "key": "display_name",
    "label": "お名前／表示名"
  },
  {
    "key": "contact_email",
    "label": "メールアドレス"
  },
  {
    "key": "contact_x",
    "label": "Xアカウント"
  },
  {
    "key": "agree_terms",
    "label": "同意事項への同意"
  },
  {
    "key": "wear_items",
    "label": "当日の衣装"
  },
  {
    "key": "wear_items_other",
    "label": "当日の衣装（その他自由記述）"
  },
  {
    "key": "wear_ownership",
    "label": "衣装の準備状況"
  },
  {
    "key": "first_time",
    "label": "このイベントは初参加ですか"
  },
  {
    "key": "concerns",
    "label": "不安な点・気になる点"
  },
  {
    "key": "concerns_other",
    "label": "不安な点・気になる点（その他自由記述）"
  },
  {
    "key": "free_comment",
    "label": "運営への質問・応援メッセージ"
  }
];

/* system(submission_id/created_at/updated_at)を除く、保存対象項目のバリデーション仕様。
   kind: text/textarea/email/bool/radio/select/checkbox/dateRadio/dateBool。
   date系はpayloadの data.dates[dateKey] から値を読む（forms.jsのcollectPayload()参照）。 */
var FIELD_SPECS = [
  {
    "key": "display_name",
    "kind": "text",
    "required": true,
    "maxLength": 50
  },
  {
    "key": "contact_email",
    "kind": "email",
    "required": false,
    "maxLength": 200
  },
  {
    "key": "contact_x",
    "kind": "text",
    "required": false,
    "maxLength": 200
  },
  {
    "key": "agree_terms",
    "kind": "bool",
    "required": true
  },
  {
    "key": "wear_items",
    "kind": "checkbox",
    "required": true,
    "options": [
      "swim_wear"
    ],
    "allowOther": true
  },
  {
    "key": "wear_items_other",
    "kind": "text",
    "required": false,
    "maxLength": 100
  },
  {
    "key": "wear_ownership",
    "kind": "radio",
    "required": true,
    "options": [
      "have",
      "preparing",
      "none"
    ]
  },
  {
    "key": "first_time",
    "kind": "radio",
    "required": false,
    "options": [
      "yes",
      "no"
    ]
  },
  {
    "key": "concerns",
    "kind": "checkbox",
    "required": false,
    "options": [
      "first_time_anxiety",
      "talk",
      "photo",
      "nophoto",
      "erothic_expectation"
    ],
    "allowOther": true
  },
  {
    "key": "concerns_other",
    "kind": "text",
    "required": false,
    "maxLength": 100
  },
  {
    "key": "free_comment",
    "kind": "textarea",
    "required": false,
    "maxLength": 300
  }
];

var SUBMISSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/;
var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; // 簡易チェック（RFC完全準拠ではない）

/**
 * Googleスプレッドシートの数式インジェクション対策。先頭が =, +, -, @ の場合に
 * スプレッドシート側で数式として解釈される可能性があるため、先頭に ' を付けて
 * 強制的に文字列として保存する。
 */
function sanitizeForSheet_(value) {
  if (typeof value !== 'string') return value;
  if (/^[=+\-@]/.test(value)) {
    return "'" + value;
  }
  return value;
}

function doGet(e) {
  var message = SHEET_NAME + ' backend: OK';
  if (NOTIFICATION_EMAIL === 'YOUR_NOTIFICATION_EMAIL') {
    message += '\n[WARNING] NOTIFICATION_EMAIL が未設定です（プレースホルダーのままです）。' +
      'このままでは運営者への通知メールが送信されません。実際の宛先へ書き換えてください。';
  }
  message += '\n[INFO] POST先URLに ?test=1 を付けると、書き込み先が本番のresponsesではなく' +
    'test_responsesシートになり、通知メールも送信されません（疎通確認用）。';
  return ContentService.createTextOutput(message);
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * FIELD_SPECSの1件について、payloadから対応する生値を読み出す。
 * date系（dateRadio/dateBool）は data.dates[dateKey] から読む（forms.jsのcollectPayload()が
 * 候補日をネストしたdatesオブジェクトとして送信するため）。それ以外はdata[key]をそのまま読む。
 */
function readFieldValue_(data, spec) {
  if (spec.kind === 'dateRadio' || spec.kind === 'dateBool') {
    var dates = data.dates && typeof data.dates === 'object' ? data.dates : {};
    return dates[spec.dateKey];
  }
  return data[spec.key];
}

/**
 * FIELD_SPECS 1件分の値を検証・正規化する。
 * 戻り値: { error: null, value } または { error: 'エラーコード' }
 */
function validateField_(spec, raw) {
  if (spec.kind === 'bool') {
    return { error: null, value: !!raw };
  }
  if (spec.kind === 'dateBool') {
    return { error: null, value: !!raw };
  }
  if (spec.kind === 'dateRadio') {
    var dateAllowed = ['open', 'ng'];
    if (dateAllowed.indexOf(raw) === -1) {
      if (spec.required) return { error: 'required' };
      return { error: null, value: '' };
    }
    return { error: null, value: raw };
  }
  if (spec.kind === 'checkbox') {
    var arr = Array.isArray(raw) ? raw : [];
    if (arr.length > 30) return { error: 'too_many' };
    for (var i = 0; i < arr.length; i++) {
      var v = arr[i];
      if (typeof v !== 'string') return { error: 'invalid_item' };
      var okItem = spec.options && spec.options.indexOf(v) !== -1;
      if (!okItem && !(spec.allowOther && v === '__other__')) return { error: 'invalid_item' };
    }
    if (spec.required && arr.length === 0) return { error: 'required' };
    return { error: null, value: arr.join('、') };
  }
  if (spec.kind === 'radio' || spec.kind === 'select') {
    if (raw === undefined || raw === null || raw === '') {
      if (spec.required) return { error: 'required' };
      return { error: null, value: '' };
    }
    if (typeof raw !== 'string') return { error: 'invalid_type' };
    var okValue = spec.options && spec.options.indexOf(raw) !== -1;
    if (!okValue && !(spec.allowOther && raw === '__other__')) return { error: 'invalid' };
    return { error: null, value: raw };
  }
  // text / textarea / email
  if (typeof raw !== 'string') {
    if (spec.required) return { error: 'required' };
    raw = '';
  }
  if (spec.kind === 'email') raw = raw.trim().toLowerCase();
  if (spec.kind === 'text') raw = raw.trim();
  if (spec.maxLength && raw.length > spec.maxLength) return { error: 'too_long' };
  if (spec.required && raw.trim() === '') return { error: 'required' };
  if (spec.kind === 'email' && raw !== '' && !EMAIL_PATTERN.test(raw)) return { error: 'invalid_format' };
  return { error: null, value: raw };
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
 * 新規作成する（既存回答があると停止するsetupHeaderRowと異なり、疎通確認のたびに気軽に使える）。
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
 * ロック保持中に行う本体処理（payload検証・submission_id冪等性判定・Sheetsへの追記まで）。
 * baseball方式の連絡先upsertは実装しない。再回答は常に新しい行として追記される。
 * メール送信はここでは行わない（ロック解放後にdoPost側で行う。詳細はファイル冒頭コメント参照）。
 * 戻り値: { response, notify: 保存が発生した場合のみ通知情報、それ以外はnull }
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
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { response: jsonResponse_({ ok: false, error: 'payload_invalid' }), notify: null };
    }
    if (typeof data.submission_id !== 'string' || !SUBMISSION_ID_PATTERN.test(data.submission_id)) {
      return { response: jsonResponse_({ ok: false, error: 'submission_id_invalid' }), notify: null };
    }

    var values = { submission_id: data.submission_id };
    for (var i = 0; i < FIELD_SPECS.length; i++) {
      var spec = FIELD_SPECS[i];
      var raw = readFieldValue_(data, spec);
      var result = validateField_(spec, raw);
      if (result.error) {
        return { response: jsonResponse_({ ok: false, error: spec.key + '_' + result.error }), notify: null };
      }
      values[spec.key] = result.value;
    }
    if (!values.contact_email && !values.contact_x) {
      return { response: jsonResponse_({ ok: false, error: 'contact_required' }), notify: null };
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
    COLUMNS.forEach(function (name, idx) { colIndex[name] = idx; });
    var lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      var existingIds = sheet.getRange(2, colIndex.submission_id + 1, lastRow - 1, 1).getValues();
      for (var s = 0; s < existingIds.length; s++) {
        if (existingIds[s][0] === data.submission_id) {
          return { response: jsonResponse_({ ok: true, duplicate: true, test_mode: isTestMode }), notify: null };
        }
      }
    }

    var now = new Date();
    values.created_at = now;
    values.updated_at = now;

    var savedValues = {};
    var row = COLUMNS.map(function (key) {
      var sanitized = sanitizeForSheet_(values[key]);
      savedValues[key] = sanitized;
      return sanitized;
    });
    sheet.appendRow(row);

    return {
      response: jsonResponse_({ ok: true, duplicate: false, test_mode: isTestMode, action: 'new' }),
      notify: { data: savedValues, timestamp: now }
    };
  } catch (err) {
    return { response: jsonResponse_({ ok: false, error: 'server_error', message: String(err) }), notify: null };
  }
}

function doPost(e) {
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
  // テストモード・NOTIFICATION_ENABLED=falseでは、運営者へ通知メールを一切送らない。
  if (result.notify && !isTestMode && NOTIFICATION_ENABLED) {
    sendNotificationEmailSafely_(result.notify);
  }

  return result.response;
}

/**
 * 通知メール本文向けに1列分の表示値を決める。未入力・空文字列は「（未入力）」として
 * 明示し、省略しない（Issue #263 / #266）。created_at/updated_atはSheetへの実際の
 * 保存値（notify.timestamp）を日時文字列に整形して使う。真偽値は「はい」「いいえ」に整形する。
 */
function formatNotificationValue_(key, notify) {
  if (key === 'created_at' || key === 'updated_at') {
    return Utilities.formatDate(notify.timestamp, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  }
  var value = notify.data[key];
  if (typeof value === 'boolean') return value ? 'はい' : 'いいえ';
  return value === undefined || value === null || value === '' ? '（未入力）' : String(value);
}

/**
 * 通知メール本文を組み立てる。NOTIFICATION_FIELDS（form-builderの通知対象項目設定）に
 * 含まれる項目のみを、日本語ラベル付きで漏れなく掲載する（Issue #266）。
 * 実際にSheetへ保存された確定値（notify.data）を使う。
 */
function buildNotificationBody_(notify) {
  var lines = [
    NOTIFICATION_SUBJECT,
    '',
    '種別: 新規回答',
    ''
  ];
  NOTIFICATION_FIELDS.forEach(function (f) {
    lines.push((f.label || COLUMN_LABELS[f.key] || f.key) + ': ' + formatNotificationValue_(f.key, notify));
  });
  lines.push('');
  lines.push('詳細はGoogleスプレッドシートで確認してください。');
  return lines.join('\n');
}

/**
 * 運営者への通知メールを送る。呼び出し元（doPost）はsubmission_idの冪等性判定を
 * appendRowより前に済ませており、この関数は新規保存が確定した後にしか呼ばれないため、
 * 通知メールは1回の保存につき1回だけ送られる。
 * メール送信失敗を回答送信失敗として扱わないため、失敗は握りつぶしログに残すだけにする。
 */
function sendNotificationEmailSafely_(notify) {
  if (NOTIFICATION_EMAIL === 'YOUR_NOTIFICATION_EMAIL') {
    console.error('NOTIFICATION_EMAIL がプレースホルダーのままのため、通知メール送信をスキップしました。デプロイ手順3の通り実際の運営者アドレスに書き換えてください。');
    return;
  }
  try {
    MailApp.sendEmail({
      to: NOTIFICATION_EMAIL,
      subject: NOTIFICATION_SUBJECT,
      body: buildNotificationBody_(notify)
    });
  } catch (mailError) {
    console.error('notification mail failed: ' + mailError);
  }
}

/**
 * ヘッダー再作成用。回答が0件（新規シート・空シート）のときだけ実行できる（デプロイ手順4）。
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
 * ヘッダー行だけ残して一括で消す。QA・疎通確認が終わったら1回実行する。
 * 本番のresponsesシートには一切触れない。
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
