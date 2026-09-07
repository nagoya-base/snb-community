/**
 * 名古屋のフェチ・衣装交流に関するアンケート｜匿名アンケートWebアプリ（バックエンド）
 *
 * 【方式】
 * 以前のバージョンはGoogleフォームを自動生成する方式だったが、
 * 「同一人物による意図的な繰り返し回答を抑止する」ためにApps ScriptのHTML Serviceで
 * 独自のWebアプリとして作り直したもの。Googleフォームは使わない。
 *
 * 【重要：このスクリプトが保証すること／しないこと】
 * ・保証すること：ブラウザにローカル保存されるランダムなUUID（localStorage / Cookie）を手がかりに、
 *   「同じブラウザから連打・再送信するような、ごく普通の重複回答」を十分面倒にして防ぐ。
 * ・保証しないこと：Cookie削除・localStorage削除・シークレットモード・別ブラウザ・別端末を使った
 *   意図的な突破は防げない（そもそも匿名調査でメールアドレス等の個人識別情報を一切集めない設計のため、
 *   技術的に完全な1人1回答保証はできない）。詳細は本ファイル末尾のコメントを参照。
 *
 * 【ファイル構成】
 * ・Code.gs      … このファイル。サーバー側ロジック（保存・重複判定・集計シート生成）。
 * ・Index.html   … ページ全体の骨組み（Styles.html / Script.htmlを読み込む）。
 * ・Styles.html  … <style>のみ。
 * ・Script.html  … <script>のみ。設問定義・UUID処理・送信処理などクライアント側ロジック。
 *
 * 【デプロイ手順】
 * 1. script.google.com で新規スタンドアロンのApps Scriptプロジェクトを作成する。
 *    このリポジトリの Code.gs / Index.html / Styles.html / Script.html を
 *    同じファイル名でそれぞれ貼り付ける（拡張子.htmlのファイルとして追加すること）。
 * 2. 回答を保存するGoogleスプレッドシートを別途1つ用意する（新規作成でよい）。
 *    スプレッドシートのURL中の /d/ と /edit の間の文字列がスプレッドシートIDなので、
 *    それをコピーしておく。
 * 3. Apps Scriptエディタ左側の「プロジェクトの設定」（歯車アイコン）→
 *    「スクリプト プロパティ」で、キー SPREADSHEET_ID・値に手順2でコピーしたIDを追加して保存する
 *    （SERVER_SALTは未設定でよい。初回アクセス時にスクリプトが自動生成して保存する）。
 * 4. Apps Scriptエディタの関数選択で initializeAll を選び、実行（▷）する。
 *    初回はGoogleアカウントの権限承認が必要（下記「初回権限承認」参照）。
 *    これでスプレッドシートに responses シート（ヘッダー行と居住地4分類の補助列）と、
 *    集計_*シート群が作成される。
 * 5. 「デプロイ」→「新しいデプロイ」→種類の選択で「ウェブアプリ」を選ぶ。
 *    ・実行ユーザー：自分
 *    ・アクセスできるユーザー：全員（リンクを知っている全員相当。匿名回答が目的のため
 *      「Googleアカウントが必要」系の設定は選ばないこと）
 * 6. デプロイ後に表示される「ウェブアプリのURL」（/exec で終わるURL）が回答用URL。
 *    SNB/SNBCサイトからはこのURLへリンクすればよい（URLをそのまま案内するだけでよく、
 *    このリポジトリ側での実装は不要）。
 * 7. 動作確認：URLを開き、フォームが表示されること、1件テスト回答を送信して
 *    スプレッドシートのresponsesシートに1行追加されること、同じブラウザで再度開くと
 *    「回答済み」表示になることを確認する。
 * 8. 設問や選択肢を変更した場合は、再デプロイ（同じデプロイの「新しいバージョン」を選択）
 *    をしないと本番URLへ反映されない。
 *
 * 【初回権限承認】
 * initializeAllの初回実行時、またはWebアプリへの初回アクセス時にGoogleの承認ダイアログが出る。
 * 「権限を確認」→アカウント選択→「このアプリは確認されていません」の警告が出たら
 * 「詳細」→「（プロジェクト名）に移動」→「許可」の順に進める（自作の未公開スクリプトのため
 * 想定通りの警告）。要求される権限はスプレッドシートの読み書きとWebアプリの実行のみ。
 */

/* ══════════════════════════════════════════════════════════════
 * 設定値
 * ══════════════════════════════════════════════════════════════ */

var FORM_TITLE = '名古屋のフェチ・衣装交流に関するアンケート';

var PROP_SPREADSHEET_ID = 'SPREADSHEET_ID';
var PROP_SERVER_SALT = 'SERVER_SALT';

var RESPONSES_SHEET_NAME = 'responses';

/* 生回答の列。意味の分かる固定キーをヘッダとして使う。
   ここに列を追加する場合はCOLUMNS配列とbuildRowValues_()、Script.html側のQUESTIONS定義を
   同時に更新すること。集計コード側は列番号ではなくこのCOLUMNSに対する
   columnLetterForHeader_()（ヘッダ名→列文字への変換）を経由して参照するため、
   「列A〜O固定」という実装にはしていない。 */
var COLUMNS = [
  'timestamp',
  'respondent_hash',
  'prefecture',
  'aichi_area',
  'age',
  'clothing_interests',
  'preferred_frequency',
  'preferred_price',
  'preferred_group_size',
  'preferred_format',
  'event_awareness',
  'barriers',
  'helpful_information',
  'preferred_atmosphere',
  'hypothetical_intent',
  'survey_to_signup_gap',
  'gap_reasons',
  'free_comment'
];

/* 集計用の補助列（生データではなく、prefecture/aichi_areaから機械的に算出する値）。
   COLUMNSの直後（COLUMNS.length + 1列目）に配置する。 */
var RESIDENCE_HELPER_HEADER = '居住地4分類（集計用）';

var RESPONDENT_HASH_COLUMN_INDEX = COLUMNS.indexOf('respondent_hash') + 1; // 1始まり

/* 複数選択設問で「その他」を自由記述として保存するときのプレフィックス。
   選択肢そのものと衝突しないよう、選択肢配列には含めない固定文字列にしている。 */
var OTHER_PREFIX = 'その他:';
var MAX_OTHER_TEXT_LENGTH = 100;
var MAX_FREE_COMMENT_LENGTH = 300;

/* ── 選択肢の定義（Script.html側のQUESTIONS定義と必ず一致させること） ──
   フロントを信用せず、送信されたデータをサーバー側でも必ずこのallowlistで検証する。 */

var PREFECTURES = [
  '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
  '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
  '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県',
  '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県',
  '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県',
  '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県',
  '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県', '海外'
];

/* Q1で愛知県を選んだ人だけに表示する設問のため、「愛知県外」は選択肢に含めない
   （含めるとQ1=愛知県・Q2=愛知県外という矛盾回答をサーバー側で許してしまうため）。 */
var AICHI_AREA_OPTIONS = [
  '名古屋市', '尾張地域（名古屋市以外）', '知多地域', '西三河地域',
  '東三河地域', 'わからない・その他'
];

var AGE_OPTIONS = [
  '18〜24歳', '25〜29歳', '30〜39歳', '40〜49歳', '50〜59歳', '60歳以上', '回答しない'
];

var CLOTHING_OPTIONS = [
  '野球ユニフォーム', 'サッカーユニフォーム', 'バスケットボールユニフォーム',
  'ラグビー・アメリカンフットボール', '陸上競技ウェア', 'スイムウェア',
  'レスリング・シングレット', '学校制服', 'ジャージ・トレーニングウェア',
  'スーツ', '作業着・職業制服', 'コスプレ衣装'
];

var FREQUENCY_OPTIONS = [
  '月2回程度', '月1回程度', '1〜2か月に1回程度', '2〜3か月に1回程度',
  '半年に1回程度', '頻度はあまり関係ない', 'わからない'
];

var PRICE_OPTIONS = [
  '2,000円以下', '2,500円程度', '3,000円程度', '3,500円程度',
  '4,000円程度', '5,000円程度', '内容によっては5,000円以上でもよい'
];

var GROUP_SIZE_OPTIONS = [
  '3〜4人', '5〜6人', '7〜8人', '9〜10人', '11人以上', '人数はあまり気にならない'
];

/* 新規設問：参加形式（人数だけでなく「関係性の近さ」を尋ねる）。
   「個室で1対1」という表現は個人セッション予約の募集だと誤認されるリスクが高いため
   使わず、「少人数の部屋で2人だけ」という、あくまで人数の目安としての表現に統一する
   （レビュー指摘）。「1対1」という語自体をFORMAT_OPTIONS全体から排除している。
   フォーム冒頭・この設問の補足テキストの両方でも「募集ではない」旨を明記する。 */
var FORMAT_OPTIONS = [
  '少人数の部屋で2人だけ',
  '3〜4人程度のごく少人数',
  '5〜6人程度の少人数',
  '7〜10人程度',
  '10人以上の交流会',
  'まず2人だけや少人数で知り合ってから、大人数にも参加したい',
  '知り合いと一緒なら大人数でも参加しやすい',
  '人数より、参加者の雰囲気や内容の方が重要',
  'わからない'
];

var EVENT_AWARENESS_OPTIONS = [
  '見たことがあり、実際に参加したことがある',
  '見たことはあるが、申し込んだことはない',
  '申し込もうと思ったが見送ったことがある',
  '告知を見たことがない',
  '覚えていない'
];

/* 参加障壁：既存項目に加え、雰囲気・年齢体型・性的方向性への不安に関する項目を追加。
   「イケメンがいない」等の直接的な表現は使わず、間接的な言い回しに統一している。
   この設問は必須（「該当しない」で回避可能）。
   レビュー指摘を反映し、以下の2点を調整：
   ・旧「どんな人が来るか分からなかった」は「参加者の雰囲気やタイプが分からなかった」と
     ほぼ同義のため統合し、後者の表現に一本化した（重複による過大集計を防ぐ）。
   ・本音に近い項目（年齢体型・雰囲気タイプ・常連感・健全すぎ・エロ展開不安）を、
     日程/料金等の表層的な項目のすぐ後ろへ前倒しし、24択の後半に埋もれて
     読み飛ばされないようにした。 */
var BARRIER_OPTIONS = [
  '日程が合わなかった', '開催時間が合わなかった', '開催場所が遠かった',
  '料金が高いと感じた', '一人参加が不安だった', '知り合いがいなかった',
  '自分の年齢や体型が、その場に合うか不安だった',
  '参加者の雰囲気やタイプが分からなかった',
  '参加者の年齢層が分からなかった',
  '常連同士ですでに仲良さそうに見えた',
  '自分の好きなジャンルと合うか不安だった',
  '内容が健全・真面目すぎて、参加するほどの魅力を感じなかった',
  '逆に、性的な雰囲気や接触に発展しそうで不安だった',
  '何をするイベントなのか分かりにくかった',
  '写真撮影が不安だった', 'SNS掲載が不安だった', '衣装を用意するのが面倒だった',
  '申し込み方法が面倒だった', '予定を早く決められなかった',
  '直前になると行く気がなくなった',
  '嫌なことを断ったときに気まずくなりそうだった',
  '興味はあるが、実際に参加するほどではなかった',
  '該当しない'
];

/* レビュー指摘を反映し、旧「初参加者が何人いるか」と新「初参加者がどの程度いるか」が
   ほぼ同義で重複していたため、前者の表現に一本化した（後者は削除）。 */
var HELPFUL_INFO_OPTIONS = [
  '参加予定人数', '参加者の年代', '一人参加者が何人いるか', '初参加者が何人いるか',
  '常連と初参加者の割合', '参加者の雰囲気や年代の目安',
  '当日の流れ', 'その回が交流中心か撮影中心か', 'どんな衣装の人が参加するか',
  '写真撮影のルール', 'SNS掲載ルール',
  '身体的接触の有無についてのルール', '嫌なことを断っても問題ないというルール',
  '会場の写真', '更衣・撮影スペースの使い方',
  '主催者についての情報', '過去開催の様子', '過去参加者の感想',
  'キャンセル規定', '初参加者が孤立しない進行方法',
  '特にない'
];

/* 新規設問：場の温度感。具体的な性的行為・プレイ内容の選択肢にはせず、
   「健全すぎて魅力不足なのか／性的な雰囲気に不安があるのか／温度が読めないのが
   問題なのか」を切り分けられる粒度にとどめている。
   レビュー指摘を反映し、「身体的接触への許容度」と「雰囲気・空気感の刺激度」を
   別軸として明確に切り分けた（旧文言は両方に該当しうる回答者がどちらか一方しか
   選べず、中間帯の回答が溶けてしまっていたため）。 */
var ATMOSPHERE_OPTIONS = [
  '会話や衣装を楽しむことが中心',
  'フェチについて気軽に話せるが、身体的な接触はない',
  '撮影やポーズなど、少し踏み込んだ表現も楽しめる（接触は求めない）',
  '身体的な接触はなくても、雰囲気が少し刺激的な方が参加したくなる',
  'お互いの同意があれば、多少の身体的な接触を伴う交流もあってよい',
  '性的な雰囲気を感じる企画には参加しにくい',
  '事前に雰囲気が明確ならどちらでもよい',
  'わからない'
];

var HYPOTHETICAL_INTENT_OPTIONS = [
  '日程が合えば申し込む可能性が高い', '内容や参加者を見てから決める',
  '興味はあるが、たぶん申し込まない', '参加しない', 'わからない'
];

var GAP_OPTIONS = [
  'よくある', 'ときどきある', 'あまりない', 'ない', 'わからない'
];

var GAP_REASON_OPTIONS = [
  'アンケートでは予定を具体的に考えていない', '実際の日程になると都合が合わない',
  '実際にお金を払う段階になると迷う', '知らない人と会うことに不安を感じる',
  '申し込み後に断りづらくなるのが嫌', '当日まで参加する気分が続くか不安',
  '興味を示すことと、実際に参加することは別だと思っている',
  '告知を詳しく見ると、自分が想像していた雰囲気と違った',
  '参加者の顔ぶれや雰囲気が分からず、申し込む決め手がなかった',
  '思ったより性的な方向に進みそうで不安になった',
  '逆に、わざわざ参加するほど魅力のある内容に見えなかった',
  'その場で嫌なことを断れる自信がなかった',
  '大人数より1対1や少人数の方が自分には合っていると思った',
  '該当しない'
];

/* ══════════════════════════════════════════════════════════════
 * Webアプリのエントリーポイント
 * ══════════════════════════════════════════════════════════════ */

function doGet(e) {
  var template = HtmlService.createTemplateFromFile('Index');
  return template.evaluate()
    .setTitle(FORM_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/**
 * Index.html内の <?!= include('Styles'); ?> 等から呼び出すテンプレート結合用ヘルパー。
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/* ══════════════════════════════════════════════════════════════
 * クライアントから呼び出すAPI（google.script.run）
 * ══════════════════════════════════════════════════════════════ */

/**
 * ページ表示時に呼び出す。渡されたUUIDのハッシュが既に保存済みかどうかだけを返す。
 * ここでの判定はあくまでUXのため（回答済みなら最初からフォームを見せない）であり、
 * 最終的な二重回答の拒否はsubmitSurvey()側で必ず行う（クライアントを信用しない）。
 */
function checkSubmissionStatus(uuid) {
  try {
    if (typeof uuid !== 'string' || !isValidUuid_(uuid)) {
      return { answered: false };
    }
    var sheet = getResponsesSheet_();
    var hash = hashUuid_(uuid);
    return { answered: isDuplicateHash_(sheet, hash) };
  } catch (err) {
    // ここで例外を投げるとページ初期表示がエラーになってしまうため、
    // 状態不明時は「未回答」として扱い、フォームを表示する
    // （最終的な重複防止はsubmitSurvey側のLockService内判定が担保する）。
    return { answered: false };
  }
}

/**
 * 回答を送信する。UUID検証 → 入力検証 → ロック取得 → 重複判定 → 保存、の順で処理する。
 * 戻り値は { status: 'SUCCESS' | 'DUPLICATE' | 'ERROR', message?: string } の形に統一し、
 * GAS側の例外をそのままクライアントへ投げない（クライアントは常にこの形のオブジェクトを扱える）。
 */
function submitSurvey(uuid, answers) {
  try {
    if (typeof uuid !== 'string' || !isValidUuid_(uuid)) {
      return { status: 'ERROR', message: 'invalid_uuid' };
    }

    var validationError = validateAnswers_(answers);
    if (validationError) {
      return { status: 'ERROR', message: validationError };
    }

    // 同時送信（連打・複数タブ）による競合を防ぐため、
    // 「重複チェック」と「保存」を同一ロック内で行う。
    var lock = LockService.getScriptLock();
    var gotLock = false;
    try {
      gotLock = lock.tryLock(10000); // 最大10秒待機
    } catch (lockAcquireError) {
      gotLock = false;
    }
    if (!gotLock) {
      return { status: 'ERROR', message: 'busy' };
    }

    try {
      var sheet = getResponsesSheet_();
      var hash = hashUuid_(uuid);
      if (isDuplicateHash_(sheet, hash)) {
        return { status: 'DUPLICATE' };
      }
      sheet.appendRow(buildRowValues_(hash, answers));
      return { status: 'SUCCESS' };
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return { status: 'ERROR', message: 'server_error' };
  }
}

/* ══════════════════════════════════════════════════════════════
 * UUID・ハッシュ関連
 * ══════════════════════════════════════════════════════════════ */

var UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid_(uuid) {
  return UUID_PATTERN.test(uuid);
}

/**
 * respondent_hash = SHA-256(UUID + SERVER_SALT) の16進文字列。
 * 生UUIDそのものはどこにも保存しない。
 */
function hashUuid_(uuid) {
  var salt = getServerSalt_();
  var digestBytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, uuid + salt, Utilities.Charset.UTF_8);
  var hex = '';
  for (var i = 0; i < digestBytes.length; i++) {
    var byteValue = digestBytes[i];
    if (byteValue < 0) byteValue += 256;
    var byteHex = byteValue.toString(16);
    hex += byteHex.length === 1 ? '0' + byteHex : byteHex;
  }
  return hex;
}

/**
 * SERVER_SALTが未設定の場合、安全なランダム文字列を自動生成してスクリプトプロパティに保存する
 * （初回起動時に自動生成してよい、という要件に対応）。
 */
function getServerSalt_() {
  var props = PropertiesService.getScriptProperties();
  var salt = props.getProperty(PROP_SERVER_SALT);
  if (!salt) {
    salt = Utilities.getUuid() + '-' + Utilities.getUuid() + '-' + Utilities.getUuid();
    props.setProperty(PROP_SERVER_SALT, salt);
  }
  return salt;
}

function isDuplicateHash_(sheet, hash) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  var hashes = sheet.getRange(2, RESPONDENT_HASH_COLUMN_INDEX, lastRow - 1, 1).getValues();
  for (var i = 0; i < hashes.length; i++) {
    if (hashes[i][0] === hash) return true;
  }
  return false;
}

/* ══════════════════════════════════════════════════════════════
 * 入力検証
 * ══════════════════════════════════════════════════════════════ */

/**
 * answersの内容をサーバー側で検証する。問題なければnull、問題があればエラーコード文字列を返す。
 * クライアント側でも同じ制約を検証しているが、Webアプリは公開エンドポイントであり、
 * google.script.runを介さない直接POST等は行えないものの、フロントの改変やバグに備えて
 * サーバー側でも必ず同じ制約を再検証する。
 */
function validateAnswers_(a) {
  if (!a || typeof a !== 'object') return 'payload_invalid';

  var singleRequired = [
    ['prefecture', PREFECTURES],
    ['age', AGE_OPTIONS],
    ['preferredFrequency', FREQUENCY_OPTIONS],
    ['preferredPrice', PRICE_OPTIONS],
    ['preferredGroupSize', GROUP_SIZE_OPTIONS],
    ['eventAwareness', EVENT_AWARENESS_OPTIONS],
    ['hypotheticalIntent', HYPOTHETICAL_INTENT_OPTIONS],
    ['surveyToSignupGap', GAP_OPTIONS]
  ];
  for (var i = 0; i < singleRequired.length; i++) {
    var key = singleRequired[i][0];
    var options = singleRequired[i][1];
    if (typeof a[key] !== 'string' || options.indexOf(a[key]) === -1) return key + '_invalid';
  }

  // preferredAtmosphereは今回の調査の核心的な設問のため必須（「わからない」で回避可能）。
  if (typeof a.preferredAtmosphere !== 'string' || ATMOSPHERE_OPTIONS.indexOf(a.preferredAtmosphere) === -1) {
    return 'preferred_atmosphere_invalid';
  }

  // aichiArea：prefectureが愛知県のときのみ有効な選択肢が必須。それ以外は空文字列必須。
  if (typeof a.aichiArea !== 'string') return 'aichi_area_invalid_type';
  if (a.prefecture === '愛知県') {
    if (AICHI_AREA_OPTIONS.indexOf(a.aichiArea) === -1) return 'aichi_area_required';
  } else if (a.aichiArea !== '') {
    return 'aichi_area_must_be_blank';
  }

  var clothing = validateMultiSelect_(a.clothingInterests, CLOTHING_OPTIONS, true);
  if (clothing.error) return 'clothing_interests_' + clothing.error;

  // preferredFormatも今回の調査の核心的な設問のため必須（「人数より雰囲気や内容が重要」
  // 「わからない」があるため、必須化しても1対1・大人数のどちらかに無理に誘導することにはならない）。
  var format = validateMultiSelect_(a.preferredFormat, FORMAT_OPTIONS, true);
  if (format.error) return 'preferred_format_' + format.error;

  // barriersはこのバージョンから必須（「該当しない」で回避可能）。
  var barriers = validateMultiSelect_(a.barriers, BARRIER_OPTIONS, true);
  if (barriers.error) return 'barriers_' + barriers.error;

  var helpfulInfo = validateMultiSelect_(a.helpfulInformation, HELPFUL_INFO_OPTIONS, false);
  if (helpfulInfo.error) return 'helpful_information_' + helpfulInfo.error;

  var gapReasons = validateMultiSelect_(a.gapReasons, GAP_REASON_OPTIONS, false);
  if (gapReasons.error) return 'gap_reasons_' + gapReasons.error;

  if (typeof a.freeComment !== 'string') return 'free_comment_invalid_type';
  if (a.freeComment.length > MAX_FREE_COMMENT_LENGTH) return 'free_comment_too_long';

  return null;
}

/**
 * 複数選択設問（配列）を検証する。各要素は「許可された選択肢そのもの」か、
 * 「OTHER_PREFIXで始まる自由記述（1〜MAX_OTHER_TEXT_LENGTH文字）」のいずれかのみ許可する。
 * 重複選択・配列以外の型・空文字列要素は不正として扱う。
 */
function validateMultiSelect_(value, allowedOptions, required) {
  if (!Array.isArray(value)) return { error: 'invalid_type' };
  if (required && value.length === 0) return { error: 'required' };

  var seen = {};
  for (var i = 0; i < value.length; i++) {
    var item = value[i];
    if (typeof item !== 'string' || item === '') return { error: 'invalid_item' };
    if (seen[item]) return { error: 'duplicate_item' };
    seen[item] = true;

    if (allowedOptions.indexOf(item) !== -1) continue;

    if (item.indexOf(OTHER_PREFIX) === 0) {
      var freeText = item.slice(OTHER_PREFIX.length).trim();
      if (freeText === '' || freeText.length > MAX_OTHER_TEXT_LENGTH) return { error: 'other_text_invalid' };
      continue;
    }

    return { error: 'invalid_item' };
  }

  return { ok: true };
}

/* ══════════════════════════════════════════════════════════════
 * スプレッドシートの数式インジェクション対策
 * ══════════════════════════════════════════════════════════════ */

/**
 * セルの先頭が =, +, -, @ の場合にスプレッドシート側で数式扱いされないよう、
 * 強制的に文字列として保存する。自由記述を含みうる列にのみ適用する。
 */
function sanitizeForSheet_(value) {
  if (typeof value !== 'string') return value;
  if (/^[=+\-@]/.test(value)) return "'" + value;
  return value;
}

/* ══════════════════════════════════════════════════════════════
 * 回答行の組み立て
 * ══════════════════════════════════════════════════════════════ */

function buildRowValues_(hash, a) {
  return [
    new Date(),
    hash,
    a.prefecture,
    a.aichiArea,
    a.age,
    sanitizeForSheet_(a.clothingInterests.join('、')),
    a.preferredFrequency,
    a.preferredPrice,
    a.preferredGroupSize,
    sanitizeForSheet_((a.preferredFormat || []).join('、')),
    a.eventAwareness,
    sanitizeForSheet_(a.barriers.join('、')),
    sanitizeForSheet_((a.helpfulInformation || []).join('、')),
    a.preferredAtmosphere, // 必須設問のためvalidateAnswers_通過後は常に非空文字列
    a.hypotheticalIntent,
    a.surveyToSignupGap,
    sanitizeForSheet_((a.gapReasons || []).join('、')),
    sanitizeForSheet_(a.freeComment || '')
  ];
}

/* ══════════════════════════════════════════════════════════════
 * スプレッドシートの初期化・メンテナンス用関数
 * （Apps Scriptエディタから手動で実行する。Webアプリの一般利用者からは呼べない）
 * ══════════════════════════════════════════════════════════════ */

/**
 * デプロイ手順4で1回実行する想定のラッパー。
 * responsesシートの準備 → 集計シート群の再生成、を順番に行う。
 */
function initializeAll() {
  setupSpreadsheet();
  buildAggregationSheets();
  Logger.log('初期化が完了しました。スプレッドシートを開いて responses / 集計_* シートを確認してください。');
}

function getResponsesSheet_() {
  var spreadsheetId = PropertiesService.getScriptProperties().getProperty(PROP_SPREADSHEET_ID);
  if (!spreadsheetId) {
    throw new Error('スクリプトプロパティSPREADSHEET_IDが未設定です。デプロイ手順3を確認してください。');
  }
  var ss = SpreadsheetApp.openById(spreadsheetId);
  var sheet = ss.getSheetByName(RESPONSES_SHEET_NAME);
  if (!sheet) {
    throw new Error('responsesシートが見つかりません。setupSpreadsheet()を実行してください。');
  }
  if (!hasExpectedHeader_(sheet)) {
    throw new Error('responsesシートのヘッダーがCOLUMNSと一致しません。setupSpreadsheet()を実行するか、ヘッダーを手動確認してください。');
  }
  return sheet;
}

function hasExpectedHeader_(sheet) {
  var lastColumn = sheet.getLastColumn();
  if (lastColumn < COLUMNS.length) return false;
  var header = sheet.getRange(1, 1, 1, COLUMNS.length).getValues()[0];
  for (var i = 0; i < COLUMNS.length; i++) {
    if (header[i] !== COLUMNS[i]) return false;
  }
  return true;
}

/**
 * responsesシートを準備する。
 * ・シートが無ければ作成する。
 * ・データ行が無い（ヘッダーのみ／空）場合のみヘッダーを(再)作成する
 *   （実回答があるのに列がずれる事故を防ぐための安全装置。既存データがある状態で
 *   ヘッダーが一致しない場合は、自動更新せず例外で止める）。
 * ・居住地4分類の補助列（RESIDENCE_HELPER_HEADER）を末尾に用意する。
 */
function setupSpreadsheet() {
  var spreadsheetId = PropertiesService.getScriptProperties().getProperty(PROP_SPREADSHEET_ID);
  if (!spreadsheetId) {
    throw new Error('先にスクリプトプロパティSPREADSHEET_IDを設定してください（デプロイ手順2・3）。');
  }
  var ss = SpreadsheetApp.openById(spreadsheetId);
  var sheet = ss.getSheetByName(RESPONSES_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(RESPONSES_SHEET_NAME);
  }

  if (sheet.getLastRow() > 1) {
    if (!hasExpectedHeader_(sheet)) {
      throw new Error(
        '既に回答が入っているresponsesシートのヘッダーがCOLUMNSと一致しません。' +
          '列がずれる事故を防ぐため自動更新を中止しました。ヘッダー行を手動で確認してください。'
      );
    }
  } else {
    var existingColumnCount = sheet.getLastColumn();
    if (existingColumnCount > 0) {
      sheet.getRange(1, 1, 1, existingColumnCount).clearContent();
    }
    sheet.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]);
    sheet.setFrozenRows(1);
  }

  ensureResidenceHelperColumn_(sheet);
  Logger.log('setupSpreadsheet: responsesシートを準備しました。');
}

/**
 * 「居住地4分類」補助列（名古屋市 / 愛知県（名古屋市以外） / 岐阜県・三重県 / その他地域）を
 * COLUMNSの直後の列に用意する。ARRAYFORMULAのスピル式1本のみを配置するため、
 * 行の追加に対して自動で追従する（コピー式より壊れにくい）。
 * 既に正しいヘッダーが設定済みなら何もしない（べき等）。
 */
function ensureResidenceHelperColumn_(sheet) {
  var colIndex = COLUMNS.length + 1;
  var headerCell = sheet.getRange(1, colIndex);
  if (headerCell.getValue() === RESIDENCE_HELPER_HEADER) return;

  headerCell.setValue(RESIDENCE_HELPER_HEADER);
  headerCell.setFontWeight('bold');

  var prefectureCol = columnLetterForHeader_('prefecture');
  var aichiCol = columnLetterForHeader_('aichi_area');
  var formulaCell = sheet.getRange(2, colIndex);
  formulaCell.setFormula(
    '=ARRAYFORMULA(IF(' + prefectureCol + '2:' + prefectureCol + '="","",' +
      'IF(' + aichiCol + '2:' + aichiCol + '="名古屋市","名古屋市",' +
      'IF(' + prefectureCol + '2:' + prefectureCol + '="愛知県","愛知県（名古屋市以外）",' +
      'IF((' + prefectureCol + '2:' + prefectureCol + '="岐阜県")+(' + prefectureCol + '2:' + prefectureCol + '="三重県")>0,' +
      '"岐阜県・三重県","その他地域")))))'
  );
}

/* ── ヘッダ名 → 列文字 変換（「列A〜O固定」の実装を避けるためのヘルパー） ── */

function columnLetterForHeader_(headerName) {
  var index = COLUMNS.indexOf(headerName);
  if (index === -1) throw new Error('未知のヘッダー名です: ' + headerName);
  return columnToLetter_(index + 1);
}

function columnToLetter_(colIndex) {
  var letter = '';
  while (colIndex > 0) {
    var remainder = (colIndex - 1) % 26;
    letter = String.fromCharCode(65 + remainder) + letter;
    colIndex = Math.floor((colIndex - 1) / 26);
  }
  return letter;
}

function residenceHelperColumnLetter_() {
  return columnToLetter_(COLUMNS.length + 1);
}

/* ══════════════════════════════════════════════════════════════
 * 集計シート生成
 * 個票を複製せず、QUERY関数・SUMPRODUCT+SEARCH関数だけで responses シートを参照する。
 * 複数選択項目（カンマ区切りではなく「、」区切りで1セルに保存）は
 * セル内文字列の完全一致ではなく SEARCH による部分一致で数えるため、
 * 選択順序や他項目との組み合わせに影響されない。
 * ══════════════════════════════════════════════════════════════ */

var SHEET_RESIDENCE = '集計_居住地';
var SHEET_AGE = '集計_年代';
var SHEET_FORMAT = '集計_参加形式';
var SHEET_BARRIER = '集計_参加障壁';
var SHEET_ATMOSPHERE = '集計_温度感';
var SHEET_GAP = '集計_ギャップ';
var SHEET_WEAR = '集計_服装';
var SHEET_INFO = '集計_情報要望';
var SHEET_BASIC = '集計_基本属性';

var BLOCK_ROW_STEP = 60;

/**
 * 既存の集計_*シートを作り直す（中身は数式のみで生データを含まないため、
 * 削除して再生成しても安全＝壊れにくい）。何度実行しても複製されない。
 */
function buildAggregationSheets() {
  var ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty(PROP_SPREADSHEET_ID));
  var sheet = getResponsesSheet_();
  ensureResidenceHelperColumn_(sheet);

  var range = respQueryRange_();
  var P = residenceHelperColumnLetter_(); // 居住地4分類
  var col = {}; // ヘッダ名 → 列文字
  ['timestamp', 'age', 'clothing_interests', 'preferred_frequency', 'preferred_price',
    'preferred_group_size', 'preferred_format', 'event_awareness', 'barriers',
    'helpful_information', 'preferred_atmosphere', 'hypothetical_intent',
    'survey_to_signup_gap', 'gap_reasons'].forEach(function (name) {
    col[name] = columnLetterForHeader_(name);
  });

  recreateSheet_(ss, SHEET_RESIDENCE, function (s) {
    writeTitledFormula_(s, 0, '居住地4分類 単純集計',
      queryFormula_(range, "select " + P + ", count(" + col.timestamp + ") group by " + P + " label count(" + col.timestamp + ") '回答数'"));
    writeTitledFormula_(s, 1, '居住地4分類 × 希望頻度',
      queryFormula_(range, "select " + P + ", count(" + col.timestamp + ") group by " + P + " pivot " + col.preferred_frequency + " label count(" + col.timestamp + ") '回答数'"));
    writeTitledFormula_(s, 2, '居住地4分類 × 価格',
      queryFormula_(range, "select " + P + ", count(" + col.timestamp + ") group by " + P + " pivot " + col.preferred_price + " label count(" + col.timestamp + ") '回答数'"));
    writeTitledFormula_(s, 3, '居住地4分類 × 希望人数',
      queryFormula_(range, "select " + P + ", count(" + col.timestamp + ") group by " + P + " pivot " + col.preferred_group_size + " label count(" + col.timestamp + ") '回答数'"));
    writeMultiVsSingleGrid_(s, 4, '居住地4分類 × 参加形式　※列=居住地4分類、行=参加形式、延べ件数',
      respColRange_(col.preferred_format), FORMAT_OPTIONS, respColRange_(P), ['名古屋市', '愛知県（名古屋市以外）', '岐阜県・三重県', 'その他地域']);
  });

  recreateSheet_(ss, SHEET_AGE, function (s) {
    writeTitledFormula_(s, 0, '年代 × 希望頻度',
      queryFormula_(range, "select " + col.age + ", count(" + col.timestamp + ") group by " + col.age + " pivot " + col.preferred_frequency + " label count(" + col.timestamp + ") '回答数'"));
    writeTitledFormula_(s, 1, '年代 × 価格',
      queryFormula_(range, "select " + col.age + ", count(" + col.timestamp + ") group by " + col.age + " pivot " + col.preferred_price + " label count(" + col.timestamp + ") '回答数'"));
    writeTitledFormula_(s, 2, '年代 × 温度感',
      queryFormula_(range, "select " + col.age + ", count(" + col.timestamp + ") group by " + col.age + " pivot " + col.preferred_atmosphere + " label count(" + col.timestamp + ") '回答数'"));
    writeMultiVsSingleGrid_(s, 3, '年代 × 参加形式　※列=年代、行=参加形式、延べ件数',
      respColRange_(col.preferred_format), FORMAT_OPTIONS, respColRange_(col.age), AGE_OPTIONS);
    writeMultiVsSingleGrid_(s, 4, '年代 × 好きな服装　※列=年代、行=服装、延べ件数',
      respColRange_(col.clothing_interests), CLOTHING_OPTIONS, respColRange_(col.age), AGE_OPTIONS);
  });

  recreateSheet_(ss, SHEET_FORMAT, function (s) {
    writeMultiTally_(s, 0, '参加形式 単純集計（複数回答、延べ件数）', respColRange_(col.preferred_format), FORMAT_OPTIONS);
    writeMultiVsSingleGrid_(s, 1, '参加形式 × 仮定企画への参加意向　※列=参加意向、行=参加形式、延べ件数',
      respColRange_(col.preferred_format), FORMAT_OPTIONS, respColRange_(col.hypothetical_intent), HYPOTHETICAL_INTENT_OPTIONS);
    writeMultiVsSingleGrid_(s, 2, '「2人だけ」志向 と「5〜6人程度」志向 の比較 × 仮定企画への参加意向',
      respColRange_(col.preferred_format), ['少人数の部屋で2人だけ', '5〜6人程度の少人数'], respColRange_(col.hypothetical_intent), HYPOTHETICAL_INTENT_OPTIONS);
  });

  recreateSheet_(ss, SHEET_BARRIER, function (s) {
    writeMultiTally_(s, 0, '参加障壁 単純集計（複数回答、延べ件数）', respColRange_(col.barriers), BARRIER_OPTIONS);
    writeMultiVsSingleGrid_(s, 1, '参加障壁 × 仮定企画への参加意向　※列=参加意向、行=障壁、延べ件数',
      respColRange_(col.barriers), BARRIER_OPTIONS, respColRange_(col.hypothetical_intent), HYPOTHETICAL_INTENT_OPTIONS);
  });

  recreateSheet_(ss, SHEET_ATMOSPHERE, function (s) {
    writeTitledFormula_(s, 0, '温度感 単純集計',
      queryFormula_(range, "select " + col.preferred_atmosphere + ", count(" + col.timestamp + ") group by " + col.preferred_atmosphere + " label count(" + col.timestamp + ") '回答数'"));
    writeTitledFormula_(s, 1, '温度感 × 仮定企画への参加意向',
      queryFormula_(range, "select " + col.preferred_atmosphere + ", count(" + col.timestamp + ") group by " + col.preferred_atmosphere + " pivot " + col.hypothetical_intent + " label count(" + col.timestamp + ") '回答数'"));
  });

  recreateSheet_(ss, SHEET_GAP, function (s) {
    writeTitledFormula_(s, 0, 'Q12相当（アンケートと実申込のギャップ） 単純集計',
      queryFormula_(range, "select " + col.survey_to_signup_gap + ", count(" + col.timestamp + ") group by " + col.survey_to_signup_gap + " label count(" + col.timestamp + ") '回答数'"));
    writeMultiVsSingleGrid_(s, 1, 'Q12相当 × ギャップの理由　※列=Q12相当、行=理由、延べ件数',
      respColRange_(col.gap_reasons), GAP_REASON_OPTIONS, respColRange_(col.survey_to_signup_gap), GAP_OPTIONS);
  });

  recreateSheet_(ss, SHEET_WEAR, function (s) {
    writeMultiTally_(s, 0, '好きな服装 単純集計（複数回答、延べ件数）', respColRange_(col.clothing_interests), CLOTHING_OPTIONS);
    writeMultiVsSingleGrid_(s, 1, '好きな服装 × 仮定企画への参加意向　※列=参加意向、行=服装、延べ件数',
      respColRange_(col.clothing_interests), CLOTHING_OPTIONS, respColRange_(col.hypothetical_intent), HYPOTHETICAL_INTENT_OPTIONS);
  });

  recreateSheet_(ss, SHEET_INFO, function (s) {
    writeMultiTally_(s, 0, '申込をためらう情報不足 単純集計（複数回答、延べ件数）', respColRange_(col.helpful_information), HELPFUL_INFO_OPTIONS);
  });

  recreateSheet_(ss, SHEET_BASIC, function (s) {
    writeTitledFormula_(s, 0, '告知の認知・参加経験 単純集計',
      queryFormula_(range, "select " + col.event_awareness + ", count(" + col.timestamp + ") group by " + col.event_awareness + " label count(" + col.timestamp + ") '回答数'"));
    writeTitledFormula_(s, 1, '仮定企画への参加意向 単純集計',
      queryFormula_(range, "select " + col.hypothetical_intent + ", count(" + col.timestamp + ") group by " + col.hypothetical_intent + " label count(" + col.timestamp + ") '回答数'"));
  });

  Logger.log('buildAggregationSheets: 集計シートを再生成しました。');
}

/**
 * 指定名のシートが既にあれば削除してから作り直す。
 * 集計シートは数式のみで構成され生データを保持しないため、作り直しても安全。
 */
function recreateSheet_(spreadsheet, name, fillFn) {
  var existing = spreadsheet.getSheetByName(name);
  if (existing) spreadsheet.deleteSheet(existing);
  var sheet = spreadsheet.insertSheet(name);
  fillFn(sheet);
}

function respQueryRange_() {
  var lastColLetter = columnToLetter_(COLUMNS.length + 1);
  return "'" + RESPONSES_SHEET_NAME + "'!A1:" + lastColLetter + '5000';
}

function respColRange_(letter) {
  return "'" + RESPONSES_SHEET_NAME + "'!" + letter + '2:' + letter + '5000';
}

function queryFormula_(range, query) {
  return '=QUERY(' + range + ',"' + query.replace(/"/g, '""') + '",1)';
}

function escapeForFormula_(text) {
  return String(text).replace(/"/g, '""');
}

function writeTitledFormula_(sheet, blockIndex, title, formula) {
  var row = 1 + blockIndex * BLOCK_ROW_STEP;
  var titleCell = sheet.getRange(row, 1);
  titleCell.setValue(title);
  titleCell.setFontWeight('bold');
  sheet.getRange(row + 1, 1).setFormula(formula);
}

/**
 * 複数選択設問（「、」区切りで1セルに保存）の選択肢ごとの延べ件数を、
 * SUMPRODUCT(ISNUMBER(SEARCH(...))) によるセル内文字列の部分一致で集計する。
 * 完全一致（値の組み合わせそのもので照合する方式）ではないため、
 * 他の選択肢との組み合わせや選択順序に依存しない安全な集計になる。
 */
function writeMultiTally_(sheet, blockIndex, title, multiRangeA1, categories) {
  var row = 1 + blockIndex * BLOCK_ROW_STEP;
  var titleCell = sheet.getRange(row, 1);
  titleCell.setValue(title);
  titleCell.setFontWeight('bold');

  var headerRow = row + 1;
  sheet.getRange(headerRow, 1).setValue('選択肢');
  sheet.getRange(headerRow, 2).setValue('件数');
  sheet.getRange(headerRow, 1, 1, 2).setFontWeight('bold');

  categories.forEach(function (category, i) {
    var dataRow = headerRow + 1 + i;
    sheet.getRange(dataRow, 1).setValue(category);
    var formula = '=SUMPRODUCT(ISNUMBER(SEARCH("' + escapeForFormula_(category) + '",' + multiRangeA1 + ')))';
    sheet.getRange(dataRow, 2).setFormula(formula);
  });
}

/**
 * 「複数選択設問 × 単一選択設問」のクロス集計グリッド。
 * 行＝rowCategories（複数選択側）、列＝colCategories（単一選択側）。
 * セルはSEARCHによる部分一致 × 単一選択列の完全一致、で延べ件数を数える。
 */
function writeMultiVsSingleGrid_(sheet, blockIndex, title, multiRangeA1, rowCategories, singleRangeA1, colCategories) {
  var row = 1 + blockIndex * BLOCK_ROW_STEP;
  var titleCell = sheet.getRange(row, 1);
  titleCell.setValue(title);
  titleCell.setFontWeight('bold');

  var headerRow = row + 1;
  sheet.getRange(headerRow, 1).setValue('（行＝下記／列＝右記、延べ件数）');
  colCategories.forEach(function (colCategory, c) {
    sheet.getRange(headerRow, 2 + c).setValue(colCategory);
  });
  sheet.getRange(headerRow, 1, 1, colCategories.length + 1).setFontWeight('bold');

  rowCategories.forEach(function (rowCategory, r) {
    var dataRow = headerRow + 1 + r;
    sheet.getRange(dataRow, 1).setValue(rowCategory);
    colCategories.forEach(function (colCategory, c) {
      var formula = '=SUMPRODUCT(ISNUMBER(SEARCH("' + escapeForFormula_(rowCategory) + '",' + multiRangeA1 + '))*(' +
        singleRangeA1 + '="' + escapeForFormula_(colCategory) + '"))';
      sheet.getRange(dataRow, 2 + c).setFormula(formula);
    });
  });
}

/* ══════════════════════════════════════════════════════════════
 * 既知の限界（実装コメント）
 * ══════════════════════════════════════════════════════════════
 * ・本方式が防げるのは「同じブラウザから、消していないlocalStorage/Cookieを使って
 *   意図的に何度も送信する」という最も手軽な繰り返し回答のみ。ブラウザデータの削除・
 *   シークレット/プライベートブラウズ・別ブラウザ・別端末を使われた場合は、
 *   新しいUUIDが発行され、サーバー側は「別人からの新しい回答」として扱う
 *   （respondent_hashが一致しないため区別できない）。
 * ・IPアドレス・User-Agent・ブラウザフィンガープリント等は一切収集していないため、
 *   これらを手がかりにした重複判定は行っていない（匿名性を優先する設計判断）。
 * ・Apps ScriptのWebアプリはHTML Serviceの仕組み上、実際のページ内容は
 *   script.google.com配下のラッパーページから googleusercontent.com のiframeとして
 *   埋め込まれて表示される。ブラウザによっては、このiframe内で設定するCookieが
 *   「サードパーティCookie」として扱われ、ブロックまたは分離される場合がある
 *   （特にSafari/iOSでこの傾向が強い）。そのため本実装ではlocalStorageを主、
 *   Cookieを補助的なフォールバックとして扱っており、Cookie側が機能しない環境でも
 *   localStorageが使えれば重複抑止は成立するようにしている。
 */
