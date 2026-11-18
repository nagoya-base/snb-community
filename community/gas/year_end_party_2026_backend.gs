/**
 * 12/26 名古屋ユニ忘年会｜応募受付・主催者承認・定員管理 バックエンド（Issue #459）
 * community/year-end-party-2026/index.html から呼び出される。
 *
 * このファイルはリポジトリ内の正本だが、実行環境はGoogle Apps Script側。
 * GitHubへpushするだけでは反映されない。下記の手順で手動反映する（既存デプロイ・ワークフローは変更しない）。
 *
 * ══ 管理データの正本と権限設計 ══
 * ・正本：このスクリプトが紐づく「専用のGoogleスプレッドシート」の applications シート。
 *   既存の問い合わせ（FormSubmit）・他イベントの回答シートとは混在させない。
 * ・権限：スプレッドシートの共有は運営者（所有者）のみ。公開リポジトリには連絡先・PayPay受取情報・
 *   QRコード等の秘密／個人情報を一切置かない。
 * ・公開エンドポイント（Webアプリ「全員」アクセス）が返すのは受付状態（open/full/closed/cancelled）のみ。
 *   応募者数・承認済み人数・氏名・連絡先は一切返さない。
 * ・参加確定（承認）はスプレッドシート上で主催者が手動で行う。自動承認は存在しない。
 *   承認済みが定員（CAPACITY=7）に達している場合は、メニュー操作・セル直接編集のどちらでも
 *   LockServiceのロック内で再集計して承認を拒否する（定員超過を防止）。
 *
 * ══ 状態 ══
 *   応募受付 → 確認中 → 承認済み（＝参加確定）／見送り／キャンセル待ち／キャンセル
 *   フォーム送信直後は必ず「応募受付」。送信＝参加確定ではない。
 *
 * ══ 初回デプロイ手順 ══
 * 1. 新規のGoogleスプレッドシートを作成（このイベント専用。他シートとは別）。
 * 2. 「拡張機能」→「Apps Script」にこのファイルの内容を貼り付ける。
 * 3. 関数 setupSheets() を1回実行（applications / config シートと状態のプルダウンを作成）。
 * 4. トリガー設定で installable トリガーを追加：関数 onEditGuard を「スプレッドシートから」「編集時」。
 *    （直接セル編集による定員超過承認を防ぐ。承認はメニュー経由を推奨）
 * 5. 「デプロイ」→「新しいデプロイ」→ウェブアプリ（実行ユーザー：自分／アクセス：全員）。
 *    既存GASの /exec URL は流用しない。
 * 6. 発行された /exec URL を community/year-end-party-2026/index.html の GAS_ENDPOINT_URL へ設定する
 *    （設定されるまで、フォームは「準備中」表示で送信できない）。
 * 7. /exec?action=status を開き {"ok":true,"status":"open"} を確認 → 実際に1件送信して applications を確認。
 *
 * ══ 運営手順 ══
 * ・確認：applications シートの新着行（状態「応募受付」）を確認し、メニュー「忘年会管理」→「確認中にする」。
 * ・参加確定：行を選択 →「承認（参加確定）」。承認後、主催者が指定連絡方法（メール／XのDM）で個別通知する。
 *   通知文に参加費3,000円・当日現金またはPayPay支払い・会場詳細（参加確定後案内）を記載する。
 * ・見送り／キャンセル／キャンセル待ち：同メニューから。キャンセルで枠が空いたら、キャンセル待ちから承認する。
 * ・受付切替：config シートの entry_status を open / closed / cancelled に変更
 *   （closed＝受付終了、cancelled＝開催中止）。承認済みが定員に達すると自動で「満員」表示になる。
 * ・削除：メニュー「個人情報を削除」で選択行の氏名・連絡先・メッセージを消去（状態・日時のみ残す）。
 *   保持期間の運用案：開催日（2026-12-26）の翌日から30日以内に全行を消去する（運営確認の上で確定）。
 *
 * ══ スパム・重複対策 ══
 * ・honeypot（website）が埋まっている送信は保存せず成功を装う。
 * ・同一 submission_id の再送は保存せず duplicate:true を返す（二重送信対策）。
 * ・同じメールアドレス／Xアカウントでキャンセル以外の応募が既にある場合は already_applied で拒否。
 * ・全項目をサーバー側でも再検証（allowlist・文字数・連絡先整合）。数式インジェクション対策を適用。
 */

var EVENT_ID = 'year-end-party-2026';
var CAPACITY = 7; // 参加確定者（承認済み）の上限。7人が主催者を含むかは運営確認事項。
var APPLICATIONS_SHEET = 'applications';
var CONFIG_SHEET = 'config';

var STATUS_RECEIVED = '応募受付';
var STATUS_REVIEWING = '確認中';
var STATUS_APPROVED = '承認済み';
var STATUS_DECLINED = '見送り';
var STATUS_CANCELED = 'キャンセル';
var STATUS_WAITLIST = 'キャンセル待ち';
var ALL_STATUSES = [STATUS_RECEIVED, STATUS_REVIEWING, STATUS_APPROVED, STATUS_DECLINED, STATUS_CANCELED, STATUS_WAITLIST];

var COLUMNS = [
  'timestamp', 'submission_id', 'event_id', 'display_name', 'age_group',
  'contact_email', 'contact_x', 'preferred_contact', 'has_uniform', 'message',
  'agree_terms', 'status', 'status_updated_at', 'organizer_note'
];

var ALLOWED_AGE_GROUPS = ['10代', '20代', '30代', '40代', '50代', '60代以上'];
var ALLOWED_PREFERRED = ['メール', 'XのDM', 'どちらでもよい'];
var ALLOWED_UNIFORM = ['持参できる', '持参できない・相談したい'];
var PUBLIC_ENTRY_STATUSES = ['open', 'closed', 'cancelled'];

/* ── 純粋関数（GAS API非依存。Node.jsのテストから直接検証する） ── */

function sanitizeForSheet(value) {
  if (typeof value !== 'string') return value;
  return /^[=+\-@]/.test(value) ? "'" + value : value;
}

function normalizeEmail(v) { return String(v || '').trim().toLowerCase(); }
function normalizeX(v) { return String(v || '').trim().replace(/^@/, '').toLowerCase(); }

function validatePayload(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 'payload_invalid';
  if (data.event_id !== EVENT_ID) return 'event_mismatch';
  if (typeof data.submission_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9\-]{7,63}$/.test(data.submission_id)) return 'submission_id_invalid';
  var name = typeof data.display_name === 'string' ? data.display_name.trim() : '';
  if (!name || name.length > 30) return 'display_name_invalid';
  if (ALLOWED_AGE_GROUPS.indexOf(data.age_group) === -1) return 'age_group_invalid';
  var email = typeof data.contact_email === 'string' ? data.contact_email.trim() : '';
  var x = typeof data.contact_x === 'string' ? data.contact_x.trim() : '';
  if (email.length > 200 || x.length > 200) return 'contact_too_long';
  if (!email && !x) return 'contact_required';
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'email_invalid';
  if (x && !/^@?[A-Za-z0-9_]{1,15}$/.test(x)) return 'x_invalid';
  if (ALLOWED_PREFERRED.indexOf(data.preferred_contact) === -1) return 'preferred_contact_invalid';
  if (data.preferred_contact === 'メール' && !email) return 'preferred_contact_mismatch';
  if (data.preferred_contact === 'XのDM' && !x) return 'preferred_contact_mismatch';
  if (ALLOWED_UNIFORM.indexOf(data.has_uniform) === -1) return 'has_uniform_invalid';
  var msg = typeof data.message === 'string' ? data.message.trim() : '';
  if (!msg || msg.length > 500) return 'message_invalid';
  if (data.agree_terms !== true) return 'agree_required';
  return null;
}

function countApproved(rows, exceptIndex) {
  var n = 0;
  for (var i = 0; i < rows.length; i++) {
    if (i !== exceptIndex && rows[i].status === STATUS_APPROVED) n++;
  }
  return n;
}

/* rows: [{submission_id, contact_email, contact_x, status}]。キャンセル以外の同一連絡先があれば重複。 */
function findDuplicate(rows, data) {
  var email = normalizeEmail(data.contact_email);
  var x = normalizeX(data.contact_x);
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    /* submission_idの一致は状態に関係なく判定する（キャンセル後の古い画面からの再送で復活させない）。 */
    if (r.submission_id === data.submission_id) return { type: 'same_submission', index: i };
    if (r.status === STATUS_CANCELED) continue;
    if (email && normalizeEmail(r.contact_email) === email) return { type: 'same_contact', index: i };
    if (x && normalizeX(r.contact_x) === x) return { type: 'same_contact', index: i };
  }
  return null;
}

/* 公開する受付状態。承認済みが定員に達すれば満員。configが不正なら安全側のclosed。 */
function resolvePublicStatus(configStatus, approvedCount) {
  if (PUBLIC_ENTRY_STATUSES.indexOf(configStatus) === -1) return 'closed';
  if (configStatus === 'open' && approvedCount >= CAPACITY) return 'full';
  return configStatus;
}

/* 承認可否。exceptIndex＝承認しようとする行（既に承認済みでも二重計上しない）。 */
function canApprove(rows, targetIndex) {
  return countApproved(rows, targetIndex) < CAPACITY;
}

/* ── GAS I/O ── */

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function readRows(sheet) {
  var values = sheet.getDataRange().getValues();
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var o = {};
    for (var c = 0; c < COLUMNS.length; c++) o[COLUMNS[c]] = values[i][c];
    rows.push(o);
  }
  return rows;
}

function readConfigStatus(ss) {
  var sheet = ss.getSheetByName(CONFIG_SHEET);
  if (!sheet) return 'closed';
  var values = sheet.getDataRange().getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]).trim() === 'entry_status') return String(values[i][1]).trim();
  }
  return 'closed';
}

function hasExpectedHeader(sheet) {
  if (sheet.getLastRow() < 1) return false;
  var h = sheet.getRange(1, 1, 1, COLUMNS.length).getValues()[0];
  for (var i = 0; i < COLUMNS.length; i++) if (h[i] !== COLUMNS[i]) return false;
  return true;
}

function doGet(e) {
  var action = e && e.parameter && e.parameter.action;
  if (action === 'status') {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(APPLICATIONS_SHEET);
    var approved = sheet && hasExpectedHeader(sheet) ? countApproved(readRows(sheet)) : 0;
    return jsonResponse({ ok: true, status: resolvePublicStatus(readConfigStatus(ss), approved) });
  }
  return ContentService.createTextOutput('year-end-party-2026 backend: OK');
}

function doPost(e) {
  var data;
  try { data = JSON.parse(e.postData.contents); } catch (err) { return jsonResponse({ ok: false, error: 'payload_invalid' }); }
  if (data && typeof data === 'object' && data.website) return jsonResponse({ ok: true }); // honeypot：保存しない
  var invalid = validatePayload(data);
  if (invalid) return jsonResponse({ ok: false, error: invalid });

  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (err) { return jsonResponse({ ok: false, error: 'busy' }); }
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(APPLICATIONS_SHEET);
    if (!sheet || !hasExpectedHeader(sheet)) return jsonResponse({ ok: false, error: 'header_mismatch' });
    var rows = readRows(sheet);
    var status = resolvePublicStatus(readConfigStatus(ss), countApproved(rows));
    var dup = findDuplicate(rows, data);
    if (dup && dup.type === 'same_submission') return jsonResponse({ ok: true, duplicate: true }); // 二重送信：成功扱い
    if (status !== 'open') return jsonResponse({ ok: false, error: status === 'full' ? 'full' : status });
    if (dup) return jsonResponse({ ok: false, error: 'already_applied' });
    var now = new Date();
    var record = {
      timestamp: now, submission_id: data.submission_id, event_id: EVENT_ID,
      display_name: sanitizeForSheet(data.display_name.trim()), age_group: data.age_group,
      contact_email: sanitizeForSheet(String(data.contact_email || '').trim()),
      contact_x: sanitizeForSheet(String(data.contact_x || '').trim()),
      preferred_contact: data.preferred_contact, has_uniform: data.has_uniform,
      message: sanitizeForSheet(data.message.trim()), agree_terms: true,
      status: STATUS_RECEIVED, status_updated_at: now, organizer_note: ''
    };
    sheet.appendRow(COLUMNS.map(function (k) { return record[k]; }));
    return jsonResponse({ ok: true });
  } finally {
    SpreadsheetApp.flush(); // ロック解放前に書き込みを確定させる（次の実行が最新の承認数を読めるように）
    lock.releaseLock();
  }
}

/* ── 主催者操作（スプレッドシートのメニュー） ── */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('忘年会管理')
    .addItem('確認中にする', 'markReviewing')
    .addItem('承認（参加確定）', 'approveSelected')
    .addItem('見送りにする', 'markDeclined')
    .addItem('キャンセル待ちにする', 'markWaitlist')
    .addItem('キャンセルにする', 'markCanceled')
    .addSeparator()
    .addItem('個人情報を削除', 'purgeSelected')
    .addToUi();
}

function markReviewing() { changeSelectedStatus(STATUS_REVIEWING); }
function approveSelected() { changeSelectedStatus(STATUS_APPROVED); }
function markDeclined() { changeSelectedStatus(STATUS_DECLINED); }
function markWaitlist() { changeSelectedStatus(STATUS_WAITLIST); }
function markCanceled() { changeSelectedStatus(STATUS_CANCELED); }

function selectedRowOrAlert() {
  var sheet = SpreadsheetApp.getActiveSheet();
  var row = sheet.getActiveRange().getRow();
  if (sheet.getName() !== APPLICATIONS_SHEET || row < 2) {
    SpreadsheetApp.getUi().alert('applications シートの応募行を選択してください。');
    return null;
  }
  return { sheet: sheet, row: row };
}

function changeSelectedStatus(newStatus) {
  var sel = selectedRowOrAlert();
  if (!sel) return;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var rows = readRows(sel.sheet);
    var idx = sel.row - 2;
    if (newStatus === STATUS_APPROVED && !canApprove(rows, idx)) {
      SpreadsheetApp.getUi().alert('承認済みが定員（' + CAPACITY + '人）に達しているため承認できません。キャンセル待ちにするか、空きが出てから承認してください。');
      return;
    }
    var statusCol = COLUMNS.indexOf('status') + 1;
    sel.sheet.getRange(sel.row, statusCol).setValue(newStatus);
    sel.sheet.getRange(sel.row, statusCol + 1).setValue(new Date());
  } finally {
    SpreadsheetApp.flush(); // ロック解放前に書き込みを確定させる（次の実行が最新の承認数を読めるように）
    lock.releaseLock();
  }
}

/* 編集範囲（rows配列のindex first〜last）内の承認済みのうち、定員を超える行のindexを返す（先頭から定員内まで残す）。 */
function overCapacityIndexes(rows, first, last) {
  var kept = 0;
  for (var i = 0; i < rows.length; i++) {
    if ((i < first || i > last) && rows[i].status === STATUS_APPROVED) kept++;
  }
  var revert = [];
  for (var k = first; k <= last && k < rows.length; k++) {
    if (rows[k].status !== STATUS_APPROVED) continue;
    if (kept < CAPACITY) kept++; else revert.push(k);
  }
  return revert;
}

/* 直接セル編集・貼り付けで承認済みにされた場合も、定員超過分は元へ戻す（installableトリガー）。
   編集範囲がstatus列と交差すれば対象（複数列・複数行の貼り付けを含む）。 */
function onEditGuard(e) {
  var range = e && e.range;
  if (!range || range.getSheet().getName() !== APPLICATIONS_SHEET) return;
  var statusCol = COLUMNS.indexOf('status') + 1;
  if (range.getColumn() > statusCol || range.getColumn() + range.getNumColumns() - 1 < statusCol) return;
  var firstRow = Math.max(range.getRow(), 2);
  var lastRow = range.getRow() + range.getNumRows() - 1;
  if (lastRow < firstRow) return;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = range.getSheet();
    var rows = readRows(sheet);
    var revert = overCapacityIndexes(rows, firstRow - 2, lastRow - 2);
    if (!revert.length) return;
    var single = range.getNumRows() === 1 && range.getNumColumns() === 1;
    revert.forEach(function (idx) {
      sheet.getRange(idx + 2, statusCol).setValue(single && e.oldValue ? e.oldValue : STATUS_RECEIVED);
    });
    SpreadsheetApp.getActiveSpreadsheet().toast('定員' + CAPACITY + '人に達しているため、超過分の承認を取り消しました。', '忘年会管理', 8);
  } finally {
    SpreadsheetApp.flush(); // ロック解放前に書き込みを確定させる（次の実行が最新の承認数を読めるように）
    lock.releaseLock();
  }
}

function purgeSelected() {
  var sel = selectedRowOrAlert();
  if (!sel) return;
  var cols = ['display_name', 'contact_email', 'contact_x', 'message', 'organizer_note'];
  cols.forEach(function (k) { sel.sheet.getRange(sel.row, COLUMNS.indexOf(k) + 1).setValue(''); });
}

function setupSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(APPLICATIONS_SHEET) || ss.insertSheet(APPLICATIONS_SHEET);
  if (sheet.getLastRow() > 0 && !hasExpectedHeader(sheet)) throw new Error('applications に既存データがあり、ヘッダーが一致しません。');
  sheet.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]);
  sheet.setFrozenRows(1);
  var rule = SpreadsheetApp.newDataValidation().requireValueInList(ALL_STATUSES, true).setAllowInvalid(false).build();
  sheet.getRange(2, COLUMNS.indexOf('status') + 1, 1000, 1).setDataValidation(rule);
  var cfg = ss.getSheetByName(CONFIG_SHEET) || ss.insertSheet(CONFIG_SHEET);
  if (cfg.getLastRow() === 0) {
    cfg.getRange(1, 1, 2, 2).setValues([['entry_status', 'open'], ['# entry_status は open / closed（受付終了） / cancelled（開催中止）。満員は承認済み数から自動判定。', '']]);
  }
}
