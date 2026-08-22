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
 *    responses シートへヘッダー行（24列：submission_id 〜 x_contact_method）を作成する
 *    （既に回答がある状態で実行すると安全装置により例外で停止する）。
 * 5. 「デプロイ」→「新しいデプロイ」→「ウェブアプリ」。実行ユーザーは自分、
 *    アクセス権は「全員」にする。
 * 6. 発行された /exec URL を baseball/enquete_202609.html の GAS_ENDPOINT_URL に設定する。
 * 7. /exec URLをブラウザで開き、「baseball enquete_202609 backend: OK」と表示されることを確認する。
 * 8. 公開ページ（?test=1 を付けない本番URL）から1件だけ疎通し、Sheetsの保存内容（24列目まで）と
 *    通知メールの件名・本文を確認する。
 * 9. baseball/gas/enquete_202609_results_backend.gs の RESULTS_SPREADSHEET_ID に、
 *    このスプレッドシートのID（URLの /d/ と /edit の間の文字列）を設定して集計APIもデプロイする。
 *
 * ── Issue #234 追記：22列→24列への切替手順（既存 /exec URL を維持する場合） ──
 * 既にデプロイ済みの本番プロジェクトへこのコード（24列版）を反映する場合、上の「デプロイ手順」
 * 1〜9はそのまま使わず、必ず次の順で行う。schemaを先に安全な状態にしてからコードを差し替えないと、
 * 22列のシートに24列前提のコードが乗る一瞬が生まれ、hasExpectedHeader_ の不一致で本番受付が
 * 一時的に失敗する（ok:false, error:'header_mismatch'）おそれがある。
 *
 * 1. 本番 responses シートの実データ行数を確認する（0件かどうか）。
 * 2a. 0件の場合：スクリプトエディタの関数選択で setupHeaderRow を選び、1回実行して
 *     24列ヘッダーを作成する。
 * 2b. 1件以上ある場合：setupHeaderRow は使わない（既存データがあると例外で停止する安全設計）。
 *     スプレッドシート上で x_follow_approval_ack / x_contact_method の2列をシート右端に
 *     手動追加する（既存データ行は空文字列のままでよい）。
 * 3. スプレッドシートの実際の列構成（1行目）が、この時点で新しい COLUMNS 配列（24列）と
 *    完全一致していることを確認する（hasExpectedHeader_ が判定に使う内容と同じ）。
 * 4. 「拡張機能」→「Apps Script」を開き、Code.gs の内容をこのファイルの内容に置き換える。
 * 5. 「デプロイ」→「デプロイを管理」を開き、既存のウェブアプリのデプロイを選んで編集アイコンから
 *    「バージョン」を「新バージョン」にして更新する。既存の /exec URL を維持するため、
 *    「デプロイ」→「新しいデプロイ」は使わない（新しいデプロイを作ると /exec URL が変わり、
 *    baseball/enquete_202609.html 側の GAS_ENDPOINT_URL 更新が別途必要になる）。
 * 6. /exec URL をブラウザで開き、「baseball enquete_202609 backend: OK」と表示されることを
 *    確認したうえで、/exec?test=1 への直接POSTで受理/拒否ケースの疎通確認を行う。
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
 * - それ以外の回答列（display_name/participation_history/first_time_motivation/
 *   age_group/sports_experience/uniform_status/glove_availability/contact_email/
 *   contact_x/participation_intent/日付6列/time_preferences/activity_preferences/
 *   free_comment） … すべて今回送信された最新の内容に置き換える（前回値との差分マージは
 *   行わない。連絡先のどちらかを今回未入力にした場合、その列は空欄で上書きされる）。
 *   participation_history が「以前参加したことがある」の場合、first_time_motivation /
 *   age_group / sports_experience / uniform_status / glove_availability は空文字列に
 *   正規化して保存する（旧回答が初参加だった場合でも、再回答upsert時に旧値を残さない）。
 *
 * ── 連絡先の正規化 ──
 * メール：前後の空白を除去し、小文字化する（normalizeEmail_）。
 *
 * Xアカウント（normalizeXHandle_、Issue #234でURL形式の受理を撤回し簡素化）：
 * 利用者にURL入力は求めない。@example / ＠example / example の文字列だけを受け付け、
 * 次の手順で正規化する。
 * 1. 前後の空白をtrimする。空文字列はそのまま「未入力」として扱う。
 * 2. Unicode NFKC正規化を行う（全角＠→半角@、全角英数字→半角ASCII等）。
 * 3. ​〜‍（ゼロ幅スペース等）・﻿（BOM）などのゼロ幅文字を除去し、再度trimする。
 * 4. 先頭の半角 @ が1文字だけあれば除去する（＠@example のような二重記号は除去されず
 *    不正な形式として拒否される。全角＠はNFKC正規化で半角@になった上でこの手順に入る）。
 * 5. 最終的なハンドルが英数字・アンダースコアのみ・1〜15文字であること（Xのユーザー名仕様）を
 *    確認する。満たさない場合、または home/search 等の予約語に一致する場合は不正な形式として拒否する。
 * 6. 小文字化した値を、正規化後のXアカウントとして保存・照合に使う。
 *
 * https://x.com/example・https://twitter.com/example・x.com/example 等のURL形式は
 * 一切受理しない（Issue #234で撤回。今後URL入力を促す案内・placeholderも出さない）。
 * 不正な形式のXアカウントはバリデーションエラーとして送信自体を拒否し、
 * 誤って別人と同一視（誤マッチ）することがないようにする。
 *
 * フロント側 baseball/enquete_202609.html の normalizeXHandle() は、この関数と
 * 同じロジックを画面側の即時バリデーション用に複製している。仕様を変更する場合は両方を
 * 同期させること（最終的な正規化・照合の権威はこのファイル側）。
 *
 * 互換性に関する注意（Issue #234）：現行コードは以前 https://x.com/example 形式のURLも
 * 受理していた。既に本番に、その形式で登録された実回答が含まれている可能性がある
 * （正規化済みのハンドル文字列として保存済みのため保存データ自体への影響はない）。
 * ただしその人物が今後同じURL文字列で再回答（upsert）しようとすると、この変更以降は
 * 拒否される（@handle形式で入力し直せば再回答できる）。
 *
 * ── この版で踏襲した安全設計 ──
 * ・submission_id による冪等性（同じsubmission_idの再送は行を増やさず、通知もしない）。
 *   submission_idはSUBMISSION_ID_PATTERN（先頭英数字＋英数字・ハイフンのみ、最大100文字）で
 *   検証し、sanitizeForSheet_()の変換対象となる先頭文字（=+-@）を許容しない。これにより、
 *   Sheetへの保存値と、冪等性判定に使う受信直後の生値（data.submission_id）が常に一致する。
 * ・LockService（既存照合〜書き込みまでロック内で完結させる。doPost→processSubmission_）
 * ・Formula Injection対策（sanitizeForSheet_。submission_id/display_name/contact_email/
 *   contact_x/first_time_motivation/free_comment に適用）
 * ・サーバー側allowlist（participation_intent/participation_history/age_group/
 *   sports_experience/uniform_status/glove_availability/time_preferences/
 *   activity_preferences はフロントの選択肢と1対1で一致させたallowlistで検証する。
 *   日付6列のうち開催しない4日は ['〇','△','×']、開催2日（date_0905/date_0913）は
 *   ['〇','×'] のallowlistで検証する。既存Sheetの過去△行は書き換えない（Issue #250）。）
 * ・型・文字数検証（display_name<=50 / contact_email<=200 / contact_x<=200 /
 *   first_time_motivation<=100 / free_comment<=300、日付6列は厳密に '〇'/'△'/'×' のいずれか、
 *   ただし開催2日は新規入力を '〇'/'×' のいずれかに限定、Issue #250）
 * ・participation_history === '初参加' の場合のみ first_time_motivation 以外の追加4項目
 *   （age_group/sports_experience/uniform_status/glove_availability）を必須検証し、
 *   '以前参加したことがある' の場合はクライアントから値が来ても空文字列に正規化して保存する
 * ・participation_history === '初参加' かつ正規化後 contact_x !== '' の場合のみ、
 *   x_follow_approval_ack（'確認済み'のみ許可）/ x_contact_method（DMグループ追加／個別DMの
 *   2値allowlist）を必須検証する（Issue #234）。非該当（以前参加、またはXなし・メールのみ）の
 *   場合はクライアントから値が来ても空文字列に正規化して保存し、upsertで条件が外れた
 *   再回答でも旧値を残さない。
 * ・候補日は date_0905/date_0906/date_0913/date_0919/date_0920/date_0927 の6列のみ
 *   （9/12・9/26は列として存在しない）
 * ・送信失敗時に成功扱いしない（バリデーションエラー・contact_conflict・server_errorは
 *   すべて ok:false を返し、Sheetへは一切書き込まない）
 * ・duplicate時（同一submission_id再送）の重複保存・重複通知抑止
 * ・新規回答／更新回答で通知メールの件名を分ける
 * ・通知メール本文にはCOLUMNS（24列）すべてを日本語ラベル付きで掲載する（Issue #263）。
 *   メールアドレス・Xアカウント文字列・自由記述・submission_id・DMグループ希望
 *   （x_contact_method）・x_follow_approval_ackも含め、未入力の項目も省略せず
 *   「（未入力）」として明示する。運営が受信メールだけで全項目を確認できるようにするため。
 *   実際にSheetへ保存された確定値（created_at/updated_at含む）を使用する。
 */

var SHEET_NAME = 'responses';

/* APIレベルのテストモード（POST先URLに ?test=1）専用の書き込み先。ファイル冒頭コメントの
   「APIレベルのテストモード」を参照。baseball/gas/enquete_202609_results_backend.gs の
   RESULTS_TEST_SHEET_NAME と同じ文字列にすること。 */
var TEST_SHEET_NAME = 'test_responses';

/* 新しい回答・更新回答が保存されたときの通知先。デプロイ手順3の通り、実際の運営者アドレスに書き換えること。 */
var NOTIFICATION_EMAIL = 'bbuni.ngo@gmail.com';

var NOTIFICATION_EMAIL_SUBJECT_NEW = '【名古屋野球ユニ部】9月日程アンケートに新しい回答があります';
var NOTIFICATION_EMAIL_SUBJECT_UPDATE = '【名古屋野球ユニ部】9月日程アンケートの回答が更新されました';

/* Sheetの列構成（24列）。upsertの都合上 submission_id を先頭、created_at/updated_at を
   その直後に置く。列の並び・列名を変更する場合はsetupHeaderRow()実行前に必ずこの配列も
   更新し、既存回答がある状態でヘッダーだけ変えないこと（列ずれ事故防止）。
   Issue #232 で participation_history を display_name の直後に移動し、初参加者向け追加4項目
   （age_group/sports_experience/uniform_status/glove_availability）と任意項目
   （first_time_motivation）を新設。日程6列は旧来のboolean（true/false）から
   '〇'/'△'/'×' の3値へ変更し、no_available_date列は廃止した（実データなしで移行不要のため
   非破壊マイグレーションは行わず、setupHeaderRow()で作り直す）。
   Issue #234 で末尾に x_follow_approval_ack / x_contact_method の2列を追加（22列→24列）。
   既に実回答がある状態でこの列追加をデプロイする場合はsetupHeaderRow()を使わず、
   ファイル冒頭コメント「Issue #234 追記」の安全な手順に従うこと。 */
var COLUMNS = [
  'submission_id',
  'created_at',
  'updated_at',
  'display_name',
  'participation_history',
  'first_time_motivation',
  'age_group',
  'sports_experience',
  'uniform_status',
  'glove_availability',
  'contact_email',
  'contact_x',
  'participation_intent',
  'date_0905',
  'date_0906',
  'date_0913',
  'date_0919',
  'date_0920',
  'date_0927',
  'time_preferences',
  'activity_preferences',
  'free_comment',
  'x_follow_approval_ack',
  'x_contact_method'
];

/* 候補日は必ずこの6列のみ。9/12・9/26は候補日に含めない（Issue #225で明示的に禁止）。
   Sheet保存値としては引き続き '〇'/'△'/'×' の3値をとりうる（Issue #232／既存行の過去△を
   保持するため）。ただしIssue #250により、9/5・9/13（EVENT_DATE_KEYS）へ新規に入力できる値は
   '〇'/'×' の2値に制限する。ALLOWED_DATE_VALUESは既存行の値の妥当性確認（resolveEventDates_）
   にのみ引き続き使う。 */
var DATE_KEYS = ['date_0905', 'date_0906', 'date_0913', 'date_0919', 'date_0920', 'date_0927'];
/* 日程各列（保存値）に許容する値。既存行に残る過去の△を有効な値として扱うために維持する。 */
var ALLOWED_DATE_VALUES = ['〇', '△', '×'];

/* Issue #247：9月は9/5・9/13の2回開催に確定。開催2日前23:59(JST)で個別に締め切る。
   締切後は、既存行があればその日の値を保持（過去の実回答を締切だけを理由に上書きしない）、
   新規行なら'×'固定にする。全ての締切を過ぎた場合はエントリー自体を受け付けない。 */
var EVENT_DATES = [
  { key: 'date_0905', deadline: '2026-09-03T23:59:59+09:00' },
  { key: 'date_0913', deadline: '2026-09-11T23:59:59+09:00' }
];
var EVENT_DATE_KEYS = EVENT_DATES.map(function (d) { return d.key; });
/* 開催しない4日。新規・更新いずれも常に'×'を強制する（バックエンド側の安全策。Issue #247）。 */
var NON_HOSTED_DATE_KEYS = ['date_0906', 'date_0919', 'date_0920', 'date_0927'];
/* Issue #250：9/5・9/13は〇／×の2択に簡略化。新規送信・再送信でクライアントから△が
   送られても受理しない。既存Sheetの過去△（ALLOWED_DATE_VALUES）はそのまま保持してよい。 */
var ALLOWED_EVENT_DATE_VALUES = ['〇', '×'];

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

/* 通知メール本文にCOLUMNS（24列）を漏れなく掲載するための日本語ラベル（Issue #263）。
   COLUMNSと1対1で対応させること。日付6列は上のDATE_LABELSをそのまま流用する。 */
var NOTIFICATION_COLUMN_LABELS = {
  submission_id: '送信ID',
  created_at: '初回受付日時',
  updated_at: '今回受付日時',
  display_name: 'お名前／ハンドルネーム',
  participation_history: '参加経験',
  first_time_motivation: '参加のきっかけ',
  age_group: '年代',
  sports_experience: '運動経験',
  uniform_status: 'ユニフォーム着用予定',
  glove_availability: 'グローブ準備状況',
  contact_email: 'メールアドレス',
  contact_x: 'Xアカウント',
  participation_intent: '参加意向',
  date_0905: DATE_LABELS.date_0905,
  date_0906: DATE_LABELS.date_0906,
  date_0913: DATE_LABELS.date_0913,
  date_0919: DATE_LABELS.date_0919,
  date_0920: DATE_LABELS.date_0920,
  date_0927: DATE_LABELS.date_0927,
  time_preferences: '希望時間帯',
  activity_preferences: 'やってみたいこと',
  free_comment: '自由記述',
  x_follow_approval_ack: 'Xフォロー確認',
  x_contact_method: 'X連絡方法（DMグループ希望など）'
};

/* ── 許可値のallowlist（フロント側HTMLの選択肢と1対1で一致させること。
   選択肢の文言をHTML側で変更した場合、ここも必ず同時に更新する） ── */
/* Issue #254：参加意向の設問はUIから廃止し、参加確定者のみを受け付けるフォームになった。
   新規payload検証はこのallowlistで判定するため、'参加する'のみを許可する。旧4値
   （'日程が合えば参加したい' 等）は直接POSTされても新規に受理してはならない。
   既存Sheetに保存済みの旧4値は書き換えない（migrationしない）ため、そのまま残り続けるが、
   それはこの受信allowlistとは無関係。 */
var ALLOWED_PARTICIPATION_INTENT = ['参加する'];
var ALLOWED_PARTICIPATION_HISTORY = [
  '初参加',
  '以前参加したことがある'
];
var ALLOWED_TIME_PREFERENCES = [
  '午前中', '13〜15時ごろ', '時間は特にこだわらない'
];
var ALLOWED_ACTIVITY_PREFERENCES = [
  'キャッチボール', 'ノック', '守備・送球練習', '初心者向け練習', '軽く写真撮影', '練習後の銭湯'
];
/* 初参加者向け追加4項目（Issue #232実装指示コメントで確定した選択肢）。 */
var ALLOWED_AGE_GROUPS = ['10代', '20代', '30代', '40代', '50代以上'];
var ALLOWED_SPORTS_EXPERIENCE = [
  '運動経験はほとんどない',
  '学生時代など少し前に運動していた',
  '最近（1年以内）まで運動していた',
  '今も定期的に運動している'
];
var ALLOWED_UNIFORM_STATUS = [
  '着用する予定',
  '着用しない予定（動きやすい服装で参加）',
  'まだ決めていない'
];
var ALLOWED_GLOVE_AVAILABILITY = [
  '持参できる',
  '持っていない（相談したい）',
  'まだわからない'
];
/* 初参加×X連絡時の追加確認2項目（Issue #234実装指示コメントで確定した選択肢）。
   参加経験==='初参加' かつ正規化後contact_xが空でない場合のみ必須検証する。 */
var ALLOWED_X_FOLLOW_APPROVAL_ACK = ['確認済み'];
var ALLOWED_X_CONTACT_METHOD = ['当日用DMグループへの追加を希望する', '個別DMで連絡してほしい'];

var MAX_DISPLAY_NAME_LENGTH = 50; // フロントのmaxlengthと一致させる
var MAX_CONTACT_LENGTH = 200; // フロントのcontact-email/contact-xのmaxlengthと一致させる
var MAX_FIRST_TIME_MOTIVATION_LENGTH = 100; // フロントのfirst-time-motivationのmaxlengthと一致させる
var MAX_FREE_COMMENT_LENGTH = 300; // フロントのmaxlengthと一致させる
/* submission_idの文字種・長さ制限。先頭は英数字固定、以降は英数字・ハイフンのみ、
   最大100文字（crypto.randomUUID()は36文字、フォールバック生成でも数十文字程度のため十分な余裕）。
   先頭を英数字に限定することで、sanitizeForSheet_()が対象とする =+-@ のいずれも
   submission_idの先頭に来なくなり、Sheetへの保存値（sanitize後）と冪等性判定に使う
   受信直後の生値（data.submission_id）が常に一致することを保証する（レビュー指摘対応：
   例えば "-abc" のようなIDは保存時に "'-abc" へ変換されるため、加工前の値と比較する
   duplicate判定が一致せず、同一submission_idの再送を検出できなくなっていた）。 */
var SUBMISSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/;
var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; // 簡易チェック（RFC完全準拠ではない）
var X_HANDLE_PATTERN = /^[A-Za-z0-9_]{1,15}$/; // Xのユーザー名仕様（英数字・アンダースコア、1〜15文字）
/* ゼロ幅文字（ゼロ幅スペース〜結合子・BOM）。コピペ混入対策として正規化時に除去する（Issue #234）。 */
var X_ZERO_WIDTH_PATTERN = /[​-‍﻿]/g;
/* Xの予約語（システムパス名）。実在の個人ハンドルと誤認しないよう拒否する（誤マッチ防止）。 */
var X_RESERVED_HANDLES = [
  'home', 'i', 'search', 'explore', 'notifications', 'messages', 'settings',
  'compose', 'intent', 'hashtag', 'share', 'login', 'logout', 'tos', 'privacy', 'about', 'download'
];

/**
 * Googleスプレッドシートの数式インジェクション対策。
 * 自由入力欄（submission_id / display_name / contact_email / contact_x /
 * first_time_motivation / free_comment）は、先頭が =, +, -, @ の場合にスプレッドシート側で
 * 数式として解釈される可能性があるため、先頭に ' を付けて強制的に文字列として保存する。
 * allowlistで検証済みの participation_intent / participation_history / age_group /
 * sports_experience / uniform_status / glove_availability / time_preferences /
 * activity_preferences / 日付各列には適用不要（許可された固定文言のみのため）。
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
  if (trimmed.normalize) trimmed = trimmed.normalize('NFKC');
  trimmed = trimmed.replace(X_ZERO_WIDTH_PATTERN, '').trim();
  if (trimmed === '') return { ok: true, value: '' };

  var handle = /^@/.test(trimmed) ? trimmed.slice(1) : trimmed;

  if (!X_HANDLE_PATTERN.test(handle)) return { ok: false };
  var lower = handle.toLowerCase();
  if (X_RESERVED_HANDLES.indexOf(lower) !== -1) return { ok: false };
  return { ok: true, value: lower };
}

/**
 * 9/5・9/13の締切状態を踏まえて、実際にSheetへ保存する値を決定する。
 * - 締切前：クライアント送信値をそのまま採用する（validatePayload_の
 *   ALLOWED_DATE_VALUESチェックを既に通過済みの値のみここに来る）。
 * - 締切後：既存行（upsert対象）があればその日の既存値を保持する。
 *   既存行がない、または既存値が不正な場合は'×'固定にする。
 * 戻り値：{ values: {date_0905, date_0913}, anyOpen: boolean }
 * anyOpenがfalse（=両日とも締切済み）の場合、呼び出し側は書き込みをせず
 * 'entry_closed'エラーを返すこと。
 */
function resolveEventDates_(data, existingRow, colIndex, now) {
  var values = {};
  var anyOpen = false;
  EVENT_DATES.forEach(function (d) {
    var deadlineMs = new Date(d.deadline).getTime();
    var isOpen = !isNaN(deadlineMs) && now.getTime() < deadlineMs;
    if (isOpen) {
      anyOpen = true;
      values[d.key] = data[d.key];
    } else if (existingRow && ALLOWED_DATE_VALUES.indexOf(existingRow[colIndex[d.key]]) !== -1) {
      values[d.key] = existingRow[colIndex[d.key]];
    } else {
      values[d.key] = '×';
    }
  });
  return { values: values, anyOpen: anyOpen };
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
  if (!SUBMISSION_ID_PATTERN.test(data.submission_id)) return { error: 'submission_id_invalid_format' };

  if (typeof data.display_name !== 'string') return { error: 'display_name_invalid_type' };
  if (data.display_name.length > MAX_DISPLAY_NAME_LENGTH) return { error: 'display_name_too_long' };
  var displayName = data.display_name.trim();
  if (displayName === '') return { error: 'display_name_required' };

  if (ALLOWED_PARTICIPATION_HISTORY.indexOf(data.participation_history) === -1) return { error: 'participation_history_invalid' };
  var isFirstTime = data.participation_history === '初参加';

  if (typeof data.first_time_motivation !== 'string') return { error: 'first_time_motivation_invalid_type' };
  if (data.first_time_motivation.length > MAX_FIRST_TIME_MOTIVATION_LENGTH) return { error: 'first_time_motivation_too_long' };

  // 初参加者向け追加4項目：participation_history==='初参加'の場合のみ必須検証する。
  // '以前参加したことがある'の場合はクライアントから値が来ても空文字列に正規化して保存する
  // （保存直前のprocessSubmission_内、firstTimeFieldKeysの分岐で正規化する）。
  if (isFirstTime) {
    if (ALLOWED_AGE_GROUPS.indexOf(data.age_group) === -1) return { error: 'age_group_invalid' };
    if (ALLOWED_SPORTS_EXPERIENCE.indexOf(data.sports_experience) === -1) return { error: 'sports_experience_invalid' };
    if (ALLOWED_UNIFORM_STATUS.indexOf(data.uniform_status) === -1) return { error: 'uniform_status_invalid' };
    if (ALLOWED_GLOVE_AVAILABILITY.indexOf(data.glove_availability) === -1) return { error: 'glove_availability_invalid' };
  }

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

  // 初参加×X連絡時の追加確認2項目：participation_history==='初参加' かつ 正規化後
  // contact_xが空でない場合のみ必須検証する。非該当時はクライアントから値が来ても
  // 保存直前のprocessSubmission_内、xContactFieldKeysの分岐で空文字列に正規化する。
  var xContactApplicable = isFirstTime && normalizedX !== '';
  if (xContactApplicable) {
    if (ALLOWED_X_FOLLOW_APPROVAL_ACK.indexOf(data.x_follow_approval_ack) === -1) {
      return { error: 'x_follow_approval_ack_invalid' };
    }
    if (ALLOWED_X_CONTACT_METHOD.indexOf(data.x_contact_method) === -1) {
      return { error: 'x_contact_method_invalid' };
    }
  }

  if (ALLOWED_PARTICIPATION_INTENT.indexOf(data.participation_intent) === -1) return { error: 'participation_intent_invalid' };

  // 日付：6日すべてを検証する。開催2日（date_0905/date_0913）はIssue #250により新規入力を
  // '〇'/'×' の2値に限定し、△は受理しない。開催しない4日は引き続き '〇'/'△'/'×' を許容する
  // （どのみちNON_HOSTED_DATE_KEYSとして後段で強制的に'×'へ上書きされる）。
  for (var i = 0; i < DATE_KEYS.length; i++) {
    var key = DATE_KEYS[i];
    var allowedValues = EVENT_DATE_KEYS.indexOf(key) !== -1 ? ALLOWED_EVENT_DATE_VALUES : ALLOWED_DATE_VALUES;
    if (allowedValues.indexOf(data[key]) === -1) return { error: key + '_invalid' };
  }

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

  if (typeof data.free_comment !== 'string') return { error: 'free_comment_invalid_type' };
  if (data.free_comment.length > MAX_FREE_COMMENT_LENGTH) return { error: 'free_comment_too_long' };

  return {
    error: null,
    normalizedEmail: normalizedEmail,
    normalizedX: normalizedX,
    displayName: displayName,
    isFirstTime: isFirstTime,
    xContactApplicable: xContactApplicable
  };
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

    // 9/5・9/13の締切状態を解決する（Issue #247）。両日とも締切済みならエントリー自体を拒否する。
    var eventDateResolution = resolveEventDates_(data, isUpdate ? dataRows[targetIndex] : null, colIndex, now);
    if (!eventDateResolution.anyOpen) {
      return { response: jsonResponse_({ ok: false, error: 'entry_closed', test_mode: isTestMode }), notify: null };
    }
    var resolvedDates = eventDateResolution.values;
    if (resolvedDates.date_0905 === '×' && resolvedDates.date_0913 === '×') {
      return { response: jsonResponse_({ ok: false, error: 'both_dates_unavailable', test_mode: isTestMode }), notify: null };
    }

    // 初参加者向け追加5項目：'以前参加したことがある'の場合は、クライアントから値が来ていても
    // 保存しない（空文字列に正規化する）。再回答upsert時、旧回答が初参加だった場合でも
    // 今回が以前参加であれば旧値を残さずここで空に上書きする。
    var firstTimeFieldKeys = ['first_time_motivation', 'age_group', 'sports_experience', 'uniform_status', 'glove_availability'];
    // 初参加×X連絡時の追加確認2項目：xContactApplicableがfalseの場合（以前参加、または
    // Xなし・メールのみ）は、クライアントから値が来ていても保存しない（空文字列に正規化する）。
    // 再回答upsert時、旧回答が該当していた場合でも今回が非該当であれば旧値を残さずここで
    // 空に上書きする（Issue #234）。
    var xContactFieldKeys = ['x_follow_approval_ack', 'x_contact_method'];
    // 列ごとの確定値（Sheetの数式インジェクション対策=sanitizeForSheet_を適用する前の、
    // 論理的な値）をここで一度だけ計算する。Sheetへの書き込み（row）と通知メール本文
    // （notifyData）の両方がこの同じ値を参照することで、メールが必ずSheetの保存内容と
    // 一致するようにする（Issue #263：以前はnotifyDataがdataを生のままコピーしており、
    // display_name/contact_email/contact_xがtrim・正規化前の値になりうる不整合があった）。
    var resolvedFieldValues = {};
    COLUMNS.forEach(function (key) {
      if (key === 'created_at') { resolvedFieldValues[key] = createdAt; return; }
      if (key === 'updated_at') { resolvedFieldValues[key] = now; return; }
      if (key === 'submission_id') { resolvedFieldValues[key] = data.submission_id; return; }
      if (key === 'display_name') { resolvedFieldValues[key] = validated.displayName; return; }
      if (key === 'contact_email') { resolvedFieldValues[key] = validated.normalizedEmail; return; }
      if (key === 'contact_x') { resolvedFieldValues[key] = validated.normalizedX; return; }
      if (firstTimeFieldKeys.indexOf(key) !== -1) {
        resolvedFieldValues[key] = validated.isFirstTime ? data[key] : '';
        return;
      }
      if (xContactFieldKeys.indexOf(key) !== -1) {
        resolvedFieldValues[key] = validated.xContactApplicable ? data[key] : '';
        return;
      }
      if (key === 'date_0905' || key === 'date_0913') { resolvedFieldValues[key] = resolvedDates[key]; return; }
      if (NON_HOSTED_DATE_KEYS.indexOf(key) !== -1) { resolvedFieldValues[key] = '×'; return; }
      var value = data[key];
      resolvedFieldValues[key] = value === undefined || value === null ? '' : value;
    });

    var row = COLUMNS.map(function (key) {
      return sanitizeForSheet_(resolvedFieldValues[key]);
    });

    if (isUpdate) {
      sheet.getRange(targetIndex + 2, 1, 1, COLUMNS.length).setValues([row]);
    } else {
      sheet.appendRow(row);
    }

    // 通知メールは実際にSheetへ保存された確定値（resolvedFieldValues）をそのまま使う
    // （Issue #247：締切済み日程はクライアント送信値と実際の保存値が異なりうる。
    // Issue #263：display_name等もtrim・正規化後の確定値で一致させる）。
    var notifyData = resolvedFieldValues;

    return {
      response: jsonResponse_({ ok: true, duplicate: false, test_mode: isTestMode, action: isUpdate ? 'update' : 'new' }),
      notify: {
        data: notifyData,
        timestamp: now,
        createdAt: createdAt,
        isUpdate: isUpdate
      }
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
 * 通知メール本文向けに1列分の表示値を決める。未入力・空文字列は「（未入力）」として
 * 明示し、省略しない（Issue #263）。created_at/updated_atはSheetへの実際の保存値
 * （notify.createdAt / notify.timestamp）を日時文字列に整形して使う。
 */
function formatNotificationValue_(key, notify) {
  if (key === 'created_at') {
    return Utilities.formatDate(notify.createdAt, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  }
  if (key === 'updated_at') {
    return Utilities.formatDate(notify.timestamp, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  }
  var value = notify.data[key];
  return value === undefined || value === null || value === '' ? '（未入力）' : String(value);
}

/**
 * 通知メール本文を組み立てる。
 * Issue #263：以前は個人情報の保存場所を増やさない方針でメール・Xアカウント・自由記述・
 * submission_id・初参加者向け追加項目などを意図的に除外していたが、運営から
 * 「メール本文だけで全項目を確認したい」との要望を受け、COLUMNS（24列）すべてを
 * 日本語ラベル付きで漏れなく掲載する方針に変更した。実際にSheetへ保存された確定値
 * （notify.data。締切済み日程などサーバー側で確定させた値を反映済み）を使う。
 */
function buildNotificationBody_(notify) {
  var lines = [
    '名古屋野球ユニ部 9月キャッチボール会 日程アンケートに' + (notify.isUpdate ? '更新回答' : '新しい回答') + 'がありました。',
    '',
    '種別: ' + (notify.isUpdate ? '再回答（既存回答の更新）' : '新規回答'),
    ''
  ];
  COLUMNS.forEach(function (key) {
    lines.push(NOTIFICATION_COLUMN_LABELS[key] + ': ' + formatNotificationValue_(key, notify));
  });
  lines.push('');
  lines.push('詳細はGoogleスプレッドシートで確認してください。');
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
 * COLUMNS（24列：submission_id 〜 x_contact_method）でヘッダーを作成する。
 * データ行がある場合は、列ずれによる破損を避けるため明示的に停止する。
 * 既に24列より前のバージョン（22列）でデータがある場合はこの関数は使わず、
 * ファイル冒頭コメント「Issue #234 追記」の安全な列追加手順に従うこと。
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
