/**
 * 名古屋のフェチ・衣装交流に関するアンケート｜管理者・開発者向け分析ダッシュボード（Issue #298）
 *
 * 【このプロジェクトの位置づけ】
 * `community/gas/nagoya_fetish_survey_webapp/`（公開アンケート＋公開結果ページ）とは
 * 別のGoogle Apps Scriptプロジェクトとして運用する。同じ回答スプレッドシートを
 * `SPREADSHEET_ID`スクリプトプロパティ経由で読み取るだけで、responsesシートへの書き込みは
 * 一切行わない（読み取り専用）。
 *
 * 【なぜ公開プロジェクトに同居させないのか】
 * 同一Apps ScriptプロジェクトのWebアプリは、公開デプロイ・限定公開デプロイのどちらからでも
 * 同じdoGet(e)/関数を実行できてしまう。そのため「URLパラメータ（`?view=admin`等）や
 * 秘密トークンで管理画面への到達を制限する」という設計は、実装ミス・将来の変更・
 * デプロイ設定の見落とし1つで公開経路から管理画面に到達しうる、という構造的リスクを残す。
 * このリスクを構造的に排除するため、管理画面は独立したApps Scriptプロジェクトとし、
 * Web Appのアクセス権を「自分のみ」に設定する（デプロイ手順はREADME.md参照）。
 * 公開プロジェクト側（`nagoya_fetish_survey_webapp/Code.gs`）にはAdmin.html・
 * getAdminResults()・view=admin・秘密トークン認証等を一切実装しない。
 *
 * 【読み取り専用であることの保証】
 * このファイルにはresponsesシートへの書き込み（appendRow・setValue・setValues・clear等）を
 * 一切実装しない。集計はすべてgetDataRange().getValues()で読み込んだ値をJavaScript側で
 * 加工するだけで、スプレッドシートへの書き戻しは行わない。回答の削除・編集機能もない。
 *
 * 【設問・選択肢の正本について】
 * 下記の定数群（COLUMNS・各種OPTIONS）は、公開プロジェクトの`Code.gs`にある同名の定数の
 * コピーである。Apps Scriptはプロジェクトをまたいだモジュール共有ができないため、
 * この重複は構造上の制約であり1箇所に統合できない。公開プロジェクト側で設問・選択肢を
 * 追加・変更・削除した場合は、このファイルの対応する定数も必ず同時に更新すること
 * （`tests/`のテストではこの一致までは検証できないため、レビュー時に目視で確認する）。
 *
 * 【デプロイ手順】README.md参照。
 */

/* ══════════════════════════════════════════════════════════════
 * 設定値
 * ══════════════════════════════════════════════════════════════ */

var DASHBOARD_TITLE = '名古屋のフェチ・衣装交流に関するアンケート｜管理ダッシュボード（読み取り専用）';

var PROP_SPREADSHEET_ID = 'SPREADSHEET_ID';
var RESPONSES_SHEET_NAME = 'responses';

/* 公開プロジェクトのCode.gs（COLUMNS配列）と必ず一致させること（上記コメント参照）。 */
var COLUMNS = [
  'timestamp', 'respondent_hash', 'prefecture', 'aichi_area', 'age',
  'clothing_interests',
  'preferred_frequency', 'preferred_price', 'preferred_group_size', 'preferred_format',
  'event_awareness', 'barriers', 'helpful_information', 'preferred_atmosphere',
  'hypothetical_intent', 'survey_to_signup_gap', 'gap_reasons', 'free_comment',
  'interest_categories', 'primary_interest_category', 'engagement_preferences',
  'snbc_awareness', 'snbc_interest', 'snbc_interest_uncertain_reasons',
  'suit_engagement_preferences', 'suit_types', 'suit_states', 'suit_event_interest',
  'survey_path', 'completion_stage'
];

var OTHER_PREFIX = 'その他:';
var MULTI_VALUE_SEPARATOR = '、';
var OTHER_FREE_TEXT_LABEL = 'その他（自由記述）';

/* ── 選択肢の定義（公開プロジェクトのCode.gsと同一内容。上記コメント参照） ── */

var PREFECTURES = [
  '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
  '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
  '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県',
  '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県',
  '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県',
  '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県',
  '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県', '海外'
];

var AICHI_AREA_OPTIONS = [
  '名古屋市', '尾張地域（名古屋市以外）', '知多地域', '西三河地域',
  '東三河地域', 'わからない・その他'
];

var AGE_OPTIONS = [
  '18〜24歳', '25〜29歳', '30〜39歳', '40〜49歳', '50〜59歳', '60歳以上', '回答しない'
];

/* 旧12択。参考値の集計にのみ使う（Issue #293以降の新規回答には保存されない）。 */
var CLOTHING_OPTIONS = [
  '野球ユニフォーム', 'サッカーユニフォーム', 'バスケットボールユニフォーム',
  'ラグビー・アメリカンフットボール', '陸上競技ウェア', 'スイムウェア',
  'レスリング・シングレット', '学校制服', 'ジャージ・トレーニングウェア',
  'スーツ', '作業着・職業制服', 'コスプレ衣装'
];

var INTEREST_SPORTS_OPTIONS = [
  '野球ユニフォーム', 'サッカーユニフォーム', 'バスケットボールユニフォーム',
  'ラグビー・アメリカンフットボール', '陸上競技ウェア', '競パン',
  '水泳・競泳ウェア（競パン以外）', 'レスリング・シングレット',
  'ジャージ・トレーニングウェア', '体操服'
];

var INTEREST_UNIFORM_JOB_OPTIONS = ['学校制服', 'スーツ', '作業着', '職業制服'];

var INTEREST_COSPLAY_OPTIONS = [
  '全身タイツ', 'ヒーロー系', '悪役・ヴィラン系', '特撮系', 'コスプレ衣装',
  'アニメ・ゲームキャラクター', 'ケモノ・着ぐるみ・獣人系', 'マスク・覆面系'
];

var INTEREST_CATEGORY_OPTIONS = INTEREST_SPORTS_OPTIONS
  .concat(INTEREST_UNIFORM_JOB_OPTIONS)
  .concat(INTEREST_COSPLAY_OPTIONS);

var UNIFORM_GATE_CATEGORIES = INTEREST_SPORTS_OPTIONS.concat(['学校制服', '作業着', '職業制服']);
var SUIT_GATE_CATEGORY = 'スーツ';

/* 「両方」は複数回答設問のため冗長として選択肢から削除している（公開プロジェクトと同期。
   レビュー指摘、PR #299）。旧回答にこの値が残っていても、tallyMulti_は未知の値として
   静かに無視する（過去データを書き換えないため、集計上は反映されない参考値になる）。 */
var ENGAGEMENT_OPTIONS = [
  '自分で着たい', '人が着ているのを見たい',
  '撮る側として関わりたい', '撮られる側として関わりたい', '交流のきっかけとして楽しみたい'
];

var SNBC_AWARENESS_OPTIONS = ['知っている', '名前だけ見たことがある', '知らなかった'];
var SNBC_INTEREST_OPTIONS = ['はい', 'いいえ', 'どちらともいえない'];
var SNBC_UNCERTAIN_REASON_OPTIONS = [
  'どんな企画かまだよく分からない', '参加者の雰囲気が分からない', '名古屋まで遠い',
  '料金や内容が分からない', '自分向けか分からない'
];

/* ENGAGEMENT_OPTIONSと同様、「両方」を削除している（公開プロジェクトと同期。PR #299）。 */
var SUIT_ENGAGEMENT_OPTIONS = [
  '自分で着たい', '人が着ているのを見たい',
  '撮る側として関わりたい', '撮られる側として関わりたい'
];
var SUIT_TYPES_OPTIONS = [
  'ビジネススーツ', 'リクルート・就活系', 'タイト・細身', 'ダブル・セットアップ',
  '礼服・フォーマル', 'ホスト・ナイト系', '教師・営業など職業のスーツ', 'ワイシャツ・ネクタイ'
];
var SUIT_STATES_OPTIONS = [
  'ジャケットを着たまま', 'ワイシャツ・ネクタイ', 'ベスト / スラックス / 革靴・ベルト',
  '着崩し', '脱ぐ過程', '着たままの空気'
];
var SUIT_EVENT_INTEREST_OPTIONS = ['はい', 'いいえ', 'どちらともいえない'];

var FREQUENCY_OPTIONS = [
  '月2回程度', '月1回程度', '1〜2か月に1回程度', '2〜3か月に1回程度',
  '半年に1回程度', '頻度はあまり関係ない', 'わからない'
];
var PRICE_OPTIONS = [
  '2,000円以下', '2,500円程度', '3,000円程度', '3,500円程度',
  '4,000円程度', '5,000円程度', '内容によっては5,000円以上でもよい'
];
var GROUP_SIZE_OPTIONS = ['3〜4人', '5〜6人', '7〜8人', '9〜10人', '11人以上', '人数はあまり気にならない'];
var FORMAT_OPTIONS = [
  '少人数の部屋で2人だけ', '3〜4人程度のごく少人数', '5〜6人程度の少人数',
  '7〜10人程度', '10人以上の交流会',
  'まず2人だけや少人数で知り合ってから、大人数にも参加したい',
  '知り合いと一緒なら大人数でも参加しやすい',
  '人数より、参加者の雰囲気や内容の方が重要', 'わからない'
];
var EVENT_AWARENESS_OPTIONS = [
  '見たことがあり、実際に参加したことがある', '見たことはあるが、申し込んだことはない',
  '申し込もうと思ったが見送ったことがある', '告知を見たことがない', '覚えていない'
];
var BARRIER_OPTIONS = [
  '日程が合わなかった', '開催時間が合わなかった', '開催場所が遠かった',
  '料金が高いと感じた', '一人参加が不安だった', '知り合いがいなかった',
  '自分の年齢や体型が、その場に合うか不安だった',
  '参加者の雰囲気やタイプが分からなかった', '参加者の年齢層が分からなかった',
  '常連同士ですでに仲良さそうに見えた', '自分の好きなジャンルと合うか不安だった',
  '内容が健全・真面目すぎて、参加するほどの魅力を感じなかった',
  '逆に、性的な雰囲気や接触に発展しそうで不安だった',
  '何をするイベントなのか分かりにくかった', '写真撮影が不安だった', 'SNS掲載が不安だった',
  '衣装を用意するのが面倒だった', '申し込み方法が面倒だった', '予定を早く決められなかった',
  '直前になると行く気がなくなった', '嫌なことを断ったときに気まずくなりそうだった',
  '興味はあるが、実際に参加するほどではなかった', '該当しない'
];
var HELPFUL_INFO_OPTIONS = [
  '参加予定人数', '参加者の年代', '一人参加者が何人いるか', '初参加者が何人いるか',
  '常連と初参加者の割合', '参加者の雰囲気や年代の目安', '当日の流れ',
  'その回が交流中心か撮影中心か', 'どんな衣装の人が参加するか', '写真撮影のルール',
  'SNS掲載ルール', '身体的接触の有無についてのルール', '嫌なことを断っても問題ないというルール',
  '会場の写真', '更衣・撮影スペースの使い方', '主催者についての情報', '過去開催の様子',
  '過去参加者の感想', 'キャンセル規定', '初参加者が孤立しない進行方法', '特にない'
];
var ATMOSPHERE_OPTIONS = [
  '会話や衣装を楽しむことが中心', 'フェチについて気軽に話せるが、身体的な接触はない',
  '撮影やポーズなど、少し踏み込んだ表現も楽しめる（接触は求めない）',
  '身体的な接触はなくても、雰囲気が少し刺激的な方が参加したくなる',
  'お互いの同意があれば、多少の身体的な接触を伴う交流もあってよい',
  '性的な雰囲気を感じる企画には参加しにくい', '事前に雰囲気が明確ならどちらでもよい', 'わからない'
];
var HYPOTHETICAL_INTENT_OPTIONS = [
  '日程が合えば申し込む可能性が高い', '内容や参加者を見てから決める',
  '興味はあるが、たぶん申し込まない', '参加しない', 'わからない'
];
var GAP_OPTIONS = ['よくある', 'ときどきある', 'あまりない', 'ない', 'わからない'];
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
  '大人数より2人だけや少人数の方が自分には合っていると思った', '該当しない'
];

var SURVEY_PATH_OPTIONS = ['none', 'uniform_only', 'suit_only', 'uniform_and_suit'];
var COMPLETION_STAGE_OPTIONS = [
  'no_gate_reached', 'snbc_not_interested', 'snbc_uncertain', 'snbc_deep_dive', 'suit_interest'
];

/* 都道府県 → 全国7地域ブロック（＋海外）。公開プロジェクトのREGION_BLOCKSと同一内容。
   三重県は近畿ブロックに分類する。 */
var REGION_BLOCKS = [
  { name: '北海道', prefectures: ['北海道'] },
  { name: '東北', prefectures: ['青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県'] },
  { name: '関東', prefectures: ['茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県'] },
  { name: '中部', prefectures: ['新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県'] },
  { name: '近畿', prefectures: ['三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県'] },
  { name: '中国・四国', prefectures: ['鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県', '香川県', '愛媛県', '高知県'] },
  { name: '九州・沖縄', prefectures: ['福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県'] },
  { name: '海外', prefectures: ['海外'] }
];

var AGE_SIMPLE_GROUPS = [
  { name: '20代以下', ages: ['18〜24歳', '25〜29歳'] },
  { name: '30代', ages: ['30〜39歳'] },
  { name: '40代', ages: ['40〜49歳'] },
  { name: '50代以上', ages: ['50〜59歳', '60歳以上'] },
  { name: '回答しない', ages: ['回答しない'] }
];

/* 地域クロス集計の都道府県詳細（Issue #317）。47都道府県フルではなく、東京・愛知・大阪の
   3都府県のみを個別軸にし、それ以外（海外含む）は「その他」にまとめる。 */
var REGION_HIGHLIGHT_PREFECTURES = ['東京都', '愛知県', '大阪府'];
var REGION_HIGHLIGHT_OTHER_LABEL = 'その他';
var REGION_HIGHLIGHT_LABELS = REGION_HIGHLIGHT_PREFECTURES.concat([REGION_HIGHLIGHT_OTHER_LABEL]);

/**
 * 公開プロジェクト（`nagoya_fetish_survey_webapp/Code.gs`）の同名関数のコピー（Issue #317）。
 * Apps Scriptはプロジェクトをまたいだモジュール共有ができないため、他の定数群と同様コピーで
 * 対応する。公開プロジェクト側でこの判定ロジックを変更した場合は、このコピーも同時に更新すること。
 *
 * completion_stageが空でないかどうかで「Issue #293以降の新アンケート回答」か「#292以前の
 * 旧回答」かを判定する。新規回答はvalidateAnswers_内のcomputeExpectedCompletionStage_で
 * 必ず非空の値を算出・保存するため、この列を世代判定キーとして使える。
 */
function isNewSurveyCompletionStage_(value) {
  return typeof value === 'string' && value !== '';
}

/**
 * 選択式設問 × 年代・地域のクロス集計対象一覧（Issue #317）。
 * 対象は「preferred_frequency〜gap_reasons」（旧アンケートから継続、単一/複数選択11問）＋
 * 「interest_categories〜suit_event_interest」（Issue #293以降の新設問のうちprimary_interest_category
 * を除く単一/複数選択9問。第一嗜好は補助指標であり、回答者を1ジャンルに固定する軸としては
 * 扱わないため対象外）で計20問。age・prefecture自体（クロス集計の軸として使う側）と
 * 自由記述（free_comment）は対象外。
 *
 * Dashboard側はこの配列をループしてアコーディオン＋クロス表を動的生成するため、設問を
 * 追加・削除・変更する場合はこの配列だけを編集すればよい（HTML・render呼び出しの個別追加は不要）。
 */
var CROSSTAB_QUESTIONS = [
  { field: 'preferred_frequency', label: '参加しやすい頻度', type: 'single', options: FREQUENCY_OPTIONS },
  { field: 'preferred_price', label: '参加しやすい料金', type: 'single', options: PRICE_OPTIONS },
  { field: 'preferred_group_size', label: '参加しやすい人数', type: 'single', options: GROUP_SIZE_OPTIONS },
  { field: 'preferred_format', label: '参加形式', type: 'multi', options: FORMAT_OPTIONS },
  { field: 'event_awareness', label: 'イベント告知の認知', type: 'single', options: EVENT_AWARENESS_OPTIONS },
  { field: 'barriers', label: '参加障壁', type: 'multi', options: BARRIER_OPTIONS },
  { field: 'helpful_information', label: 'あると助かる情報', type: 'multi', options: HELPFUL_INFO_OPTIONS },
  { field: 'preferred_atmosphere', label: '場の温度感', type: 'single', options: ATMOSPHERE_OPTIONS },
  { field: 'hypothetical_intent', label: '仮定企画への参加意向', type: 'single', options: HYPOTHETICAL_INTENT_OPTIONS },
  { field: 'survey_to_signup_gap', label: 'アンケート〜申込ギャップ', type: 'single', options: GAP_OPTIONS },
  { field: 'gap_reasons', label: 'ギャップの理由', type: 'multi', options: GAP_REASON_OPTIONS },
  { field: 'interest_categories', label: '興味のある衣装・服装・キャラクター表現', type: 'multi', options: INTEREST_CATEGORY_OPTIONS },
  { field: 'engagement_preferences', label: '関わり方', type: 'multi', options: ENGAGEMENT_OPTIONS },
  { field: 'snbc_awareness', label: 'SNBC認知', type: 'single', options: SNBC_AWARENESS_OPTIONS },
  { field: 'snbc_interest', label: 'SNBC興味', type: 'single', options: SNBC_INTEREST_OPTIONS },
  { field: 'snbc_interest_uncertain_reasons', label: '興味がどちらともいえない理由', type: 'multi', options: SNBC_UNCERTAIN_REASON_OPTIONS },
  { field: 'suit_engagement_preferences', label: 'スーツ関わり方', type: 'multi', options: SUIT_ENGAGEMENT_OPTIONS },
  { field: 'suit_types', label: 'スーツタイプ', type: 'multi', options: SUIT_TYPES_OPTIONS },
  { field: 'suit_states', label: 'スーツの状態', type: 'multi', options: SUIT_STATES_OPTIONS },
  { field: 'suit_event_interest', label: 'スーツ企画への興味', type: 'single', options: SUIT_EVENT_INTEREST_OPTIONS }
];

/* ══════════════════════════════════════════════════════════════
 * Webアプリのエントリーポイント
 * ══════════════════════════════════════════════════════════════ */

/**
 * このプロジェクトのWeb AppはURLパラメータによる分岐を持たない（単一のダッシュボード画面のみ）。
 * アクセス制限はURL・トークンではなく、デプロイ時の「アクセスできるユーザー：自分のみ」設定で行う
 * （README.md参照）。
 */
function doGet() {
  var template = HtmlService.createTemplateFromFile('Dashboard');
  return template.evaluate()
    .setTitle(DASHBOARD_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/* ══════════════════════════════════════════════════════════════
 * クライアントから呼び出すAPI（読み取り専用）
 * ══════════════════════════════════════════════════════════════ */

/**
 * Dashboard読み込み時に呼び出す唯一のAPI。responsesシートを読み取り、
 * JavaScript側で集計してJSONを返すだけで、スプレッドシートへの書き込みは一切行わない。
 */
function getAdminDashboardData() {
  var sheet = getResponsesSheet_();
  var rows = readResponseRows_(sheet);
  return buildAdminDashboardPayload_(rows);
}

function getResponsesSheet_() {
  var spreadsheetId = PropertiesService.getScriptProperties().getProperty(PROP_SPREADSHEET_ID);
  if (!spreadsheetId) {
    throw new Error('スクリプトプロパティSPREADSHEET_IDが未設定です。README.mdのデプロイ手順を確認してください。');
  }
  var ss = SpreadsheetApp.openById(spreadsheetId);
  var sheet = ss.getSheetByName(RESPONSES_SHEET_NAME);
  if (!sheet) {
    throw new Error('responsesシートが見つかりません。公開プロジェクト側でinitializeAll()を実行済みか確認してください。');
  }
  return sheet;
}

/**
 * responsesシートを読み取り、ヘッダ名をキーとするオブジェクトの配列に変換する
 * （列番号を固定せず、実際のヘッダー行から解決する）。読み取りのみで書き込みは行わない。
 */
function readResponseRows_(sheet) {
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  if (lastRow < 2 || lastColumn < 1) return [];

  var header = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  var data = sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();

  return data.map(function (rowValues) {
    var row = {};
    header.forEach(function (headerName, i) {
      if (headerName) row[headerName] = rowValues[i];
    });
    return row;
  });
}

/* ══════════════════════════════════════════════════════════════
 * 集計ロジック（純粋関数。GAS APIに依存せず、rows（オブジェクト配列）だけを見る）
 * ══════════════════════════════════════════════════════════════ */

function buildAdminDashboardPayload_(rows) {
  var basic = buildBasicSection_(rows);
  var region = buildRegionSection_(rows);
  var age = buildAgeSection_(rows);
  var costume = buildCostumeSection_(rows);
  var snbc = buildSnbcSection_(rows);
  var suit = buildSuitSection_(rows);
  var deepDive = buildDeepDiveSection_(rows);
  var branching = buildBranchingSection_(rows);

  return {
    generatedAt: new Date().toISOString(),
    basic: basic,
    region: region,
    age: age,
    costume: costume,
    snbc: snbc,
    suit: suit,
    deepDive: deepDive,
    branching: branching,
    highlights: buildHighlightsSection_(rows, region, costume, deepDive, suit),
    crosstab: buildCrosstabSection_(rows),
    // 自由記述はダッシュボード下部の折りたたみ表示専用（トップの主要可視化には出さない）。
    freeComments: rows
      .map(function (r) { return r.free_comment; })
      .filter(function (text) { return typeof text === 'string' && text !== ''; })
  };
}

function formatDate_(date) {
  var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

function splitMultiValue_(value) {
  return typeof value === 'string' && value !== '' ? value.split(MULTI_VALUE_SEPARATOR) : [];
}

function hasUniformGate_(interestCategories) {
  return interestCategories.some(function (c) { return UNIFORM_GATE_CATEGORIES.indexOf(c) !== -1; });
}

function hasSuitGate_(interestCategories) {
  return interestCategories.indexOf(SUIT_GATE_CATEGORY) !== -1;
}

/**
 * 単一選択設問の単純集計。optionsに定義された選択肢はすべて0件から始め、
 * 空欄・未知の値は無視する（分岐設問で「非該当につき空欄」の行を誤って集計しないため）。
 * 件数の多い順に並べ替えて返す。
 */
function tallySingle_(rows, field, options) {
  var counts = {};
  options.forEach(function (option) { counts[option] = 0; });
  rows.forEach(function (row) {
    var value = row[field];
    if (Object.prototype.hasOwnProperty.call(counts, value)) counts[value]++;
  });
  return options
    .map(function (option) { return { name: option, count: counts[option] }; })
    .sort(function (a, b) { return b.count - a.count; });
}

/**
 * 複数選択設問（「、」区切り）の延べ件数集計。OTHER_PREFIXで始まる自由記述項目は
 * 内容ごとに数えず「その他（自由記述）」として1つにまとめる（内容自体は下部の自由記述一覧を参照）。
 */
function tallyMulti_(rows, field, options) {
  var counts = {};
  options.forEach(function (option) { counts[option] = 0; });
  var otherCount = 0;
  rows.forEach(function (row) {
    splitMultiValue_(row[field]).forEach(function (item) {
      if (Object.prototype.hasOwnProperty.call(counts, item)) {
        counts[item]++;
      } else if (item.indexOf(OTHER_PREFIX) === 0) {
        otherCount++;
      }
    });
  });
  var result = options.map(function (option) { return { name: option, count: counts[option] }; });
  result.push({ name: OTHER_FREE_TEXT_LABEL, count: otherCount });
  return result.sort(function (a, b) { return b.count - a.count; });
}

/**
 * 単一選択 × 単一選択のクロス集計グリッド。
 */
function crosstabSingleVsSingle_(rows, rowField, rowOptions, colField, colOptions) {
  var matrix = rowOptions.map(function () { return colOptions.map(function () { return 0; }); });
  rows.forEach(function (row) {
    var ri = rowOptions.indexOf(row[rowField]);
    var ci = colOptions.indexOf(row[colField]);
    if (ri !== -1 && ci !== -1) matrix[ri][ci]++;
  });
  return { rowLabels: rowOptions, colLabels: colOptions, matrix: matrix };
}

/**
 * 複数選択 × 単一選択のクロス集計グリッド（行＝複数選択側の延べ件数）。
 */
function crosstabMultiVsSingle_(rows, multiField, multiOptions, singleField, singleOptions) {
  var matrix = multiOptions.map(function () { return singleOptions.map(function () { return 0; }); });
  rows.forEach(function (row) {
    var ci = singleOptions.indexOf(row[singleField]);
    if (ci === -1) return;
    splitMultiValue_(row[multiField]).forEach(function (item) {
      var ri = multiOptions.indexOf(item);
      if (ri !== -1) matrix[ri][ci]++;
    });
  });
  return { rowLabels: multiOptions, colLabels: singleOptions, matrix: matrix };
}

function regionBlockForPrefecture_(prefecture) {
  for (var i = 0; i < REGION_BLOCKS.length; i++) {
    if (REGION_BLOCKS[i].prefectures.indexOf(prefecture) !== -1) return REGION_BLOCKS[i].name;
  }
  return null;
}

/**
 * 地域クロス集計の都道府県詳細用バケット関数（Issue #317）。東京都・愛知県・大阪府はそのまま
 * 都府県名を返し、それ以外の全都道府県（海外を含む）は「その他」にまとめる。
 */
function regionHighlightForPrefecture_(prefecture) {
  return REGION_HIGHLIGHT_PREFECTURES.indexOf(prefecture) !== -1 ? prefecture : REGION_HIGHLIGHT_OTHER_LABEL;
}

/* ── 基本 ── */
function buildBasicSection_(rows) {
  var dailyMap = {};
  var lastTimestamp = null;

  rows.forEach(function (row) {
    var raw = row.timestamp;
    var date = raw instanceof Date ? raw : new Date(raw);
    if (isNaN(date.getTime())) return;
    var dayKey = formatDate_(date);
    dailyMap[dayKey] = (dailyMap[dayKey] || 0) + 1;
    if (!lastTimestamp || date > lastTimestamp) lastTimestamp = date;
  });

  var dailyCounts = Object.keys(dailyMap).sort().map(function (day) {
    return { date: day, count: dailyMap[day] };
  });

  return {
    total: rows.length,
    dailyCounts: dailyCounts,
    lastResponseAt: lastTimestamp ? lastTimestamp.toISOString() : null
  };
}

/* ── 地域 ── */
function buildRegionSection_(rows) {
  var prefectureTally = tallySingle_(rows, 'prefecture', PREFECTURES);
  var prefectureCountMap = {};
  prefectureTally.forEach(function (item) { prefectureCountMap[item.name] = item.count; });

  var nationalBlocks = REGION_BLOCKS.map(function (block) {
    var count = block.prefectures.reduce(function (sum, pref) { return sum + (prefectureCountMap[pref] || 0); }, 0);
    return { name: block.name, count: count };
  }).sort(function (a, b) { return b.count - a.count; });

  return {
    prefecture: prefectureTally,
    aichiArea: tallySingle_(rows, 'aichi_area', AICHI_AREA_OPTIONS),
    nationalBlocks: nationalBlocks
  };
}

/* ── 年代 ── */
function buildAgeSection_(rows) {
  var original = tallySingle_(rows, 'age', AGE_OPTIONS);
  var countMap = {};
  original.forEach(function (item) { countMap[item.name] = item.count; });

  var simplified = AGE_SIMPLE_GROUPS.map(function (group) {
    var count = group.ages.reduce(function (sum, age) { return sum + (countMap[age] || 0); }, 0);
    return { name: group.name, count: count };
  }).sort(function (a, b) { return b.count - a.count; });

  return { original: original, simplified: simplified };
}

/* ── 衣装 ── */
function buildCostumeSection_(rows) {
  return {
    interestCategories: tallyMulti_(rows, 'interest_categories', INTEREST_CATEGORY_OPTIONS),
    primaryInterestCategory: tallySingle_(rows, 'primary_interest_category', INTEREST_CATEGORY_OPTIONS),
    engagementPreferences: tallyMulti_(rows, 'engagement_preferences', ENGAGEMENT_OPTIONS)
  };
}

/* ── SNBC ── */
function buildSnbcSection_(rows) {
  var uniformGateReachedCount = rows.filter(function (row) {
    return hasUniformGate_(splitMultiValue_(row.interest_categories));
  }).length;
  var deepDiveCompletedCount = rows.filter(function (row) { return row.completion_stage === 'snbc_deep_dive'; }).length;
  var interestYesCount = rows.filter(function (row) { return row.snbc_interest === 'はい'; }).length;

  return {
    awareness: tallySingle_(rows, 'snbc_awareness', SNBC_AWARENESS_OPTIONS),
    interest: tallySingle_(rows, 'snbc_interest', SNBC_INTEREST_OPTIONS),
    interestUncertainReasons: tallyMulti_(rows, 'snbc_interest_uncertain_reasons', SNBC_UNCERTAIN_REASON_OPTIONS),
    uniformGateReachedCount: uniformGateReachedCount,
    deepDiveCompletedCount: deepDiveCompletedCount,
    // 認知→興味あり率：ユニフォーム系ゲート到達者のうちsnbc_interest=はいの割合。
    awarenessToInterestRate: uniformGateReachedCount > 0 ? interestYesCount / uniformGateReachedCount : null
  };
}

/* ── スーツ ── */
function buildSuitSection_(rows) {
  return {
    engagementPreferences: tallyMulti_(rows, 'suit_engagement_preferences', SUIT_ENGAGEMENT_OPTIONS),
    types: tallyMulti_(rows, 'suit_types', SUIT_TYPES_OPTIONS),
    states: tallyMulti_(rows, 'suit_states', SUIT_STATES_OPTIONS),
    eventInterest: tallySingle_(rows, 'suit_event_interest', SUIT_EVENT_INTEREST_OPTIONS)
  };
}

/* ── 深掘り ── */
function buildDeepDiveSection_(rows) {
  return {
    frequency: tallySingle_(rows, 'preferred_frequency', FREQUENCY_OPTIONS),
    price: tallySingle_(rows, 'preferred_price', PRICE_OPTIONS),
    groupSize: tallySingle_(rows, 'preferred_group_size', GROUP_SIZE_OPTIONS),
    format: tallyMulti_(rows, 'preferred_format', FORMAT_OPTIONS),
    eventAwareness: tallySingle_(rows, 'event_awareness', EVENT_AWARENESS_OPTIONS),
    barriers: tallyMulti_(rows, 'barriers', BARRIER_OPTIONS),
    helpfulInformation: tallyMulti_(rows, 'helpful_information', HELPFUL_INFO_OPTIONS),
    atmosphere: tallySingle_(rows, 'preferred_atmosphere', ATMOSPHERE_OPTIONS),
    hypotheticalIntent: tallySingle_(rows, 'hypothetical_intent', HYPOTHETICAL_INTENT_OPTIONS),
    gap: tallySingle_(rows, 'survey_to_signup_gap', GAP_OPTIONS),
    gapReasons: tallyMulti_(rows, 'gap_reasons', GAP_REASON_OPTIONS)
  };
}

/* ── 分岐 ── */
function buildBranchingSection_(rows) {
  return {
    surveyPath: tallySingle_(rows, 'survey_path', SURVEY_PATH_OPTIONS),
    completionStage: tallySingle_(rows, 'completion_stage', COMPLETION_STAGE_OPTIONS)
  };
}

/**
 * 上部の主要可視化10項目。既に計算済みの各セクションを再利用し、responsesの再走査が
 * 必要なクロス集計（SNBCファネル・地域×SNBC興味）だけをここで追加計算する。
 */
function buildHighlightsSection_(rows, region, costume, deepDive, suit) {
  var rowsWithRegionBlock = rows.map(function (row) {
    var copy = {};
    Object.keys(row).forEach(function (key) { copy[key] = row[key]; });
    copy.__region_block__ = regionBlockForPrefecture_(row.prefecture);
    return copy;
  });
  var regionBlockNames = REGION_BLOCKS.map(function (b) { return b.name; });

  return {
    snbcFunnel: {
      awarenessAnswered: rows.filter(function (r) { return SNBC_AWARENESS_OPTIONS.indexOf(r.snbc_awareness) !== -1; }).length,
      interestYes: rows.filter(function (r) { return r.snbc_interest === 'はい'; }).length,
      deepDiveCompleted: rows.filter(function (r) { return r.completion_stage === 'snbc_deep_dive'; }).length
    },
    regionSnbcInterest: crosstabSingleVsSingle_(rowsWithRegionBlock, '__region_block__', regionBlockNames, 'snbc_interest', SNBC_INTEREST_OPTIONS),
    interestCategoriesRanking: costume.interestCategories,
    engagementPreferences: costume.engagementPreferences,
    preferredPrice: deepDive.price,
    preferredGroupSize: deepDive.groupSize,
    barriers: deepDive.barriers,
    preferredAtmosphere: deepDive.atmosphere,
    surveyToSignupGap: deepDive.gap,
    suitEventInterest: suit.eventInterest
  };
}

/**
 * 選択式設問 × 年代・地域のクロス集計セクション（Issue #317）。CROSSTAB_QUESTIONSをループし、
 * 設問ごとに「年代」「地域7ブロック」「地域詳細（東京・愛知・大阪）」の3クロス表を計算する。
 *
 * 旧アンケート回答（completion_stageが空の行）は、isNewSurveyCompletionStage_で除外してから
 * crosstabSingleVsSingle_ / crosstabMultiVsSingle_に渡す。そのため、このセクションの合計件数は
 * 同じ設問の単純集計（buildDeepDiveSection_・buildCostumeSection_等、新旧アンケート混在）より
 * 少なくなる。意図した挙動（README参照）。既存の単純集計側の集計対象行は一切変更しない。
 *
 * 構成比の分母は「行＝選択肢の合計」（その選択肢を選んだ人のうち何%がその年代/地域か）。
 * 分母を年代・地域側にする選択率（例：30代のうち何%がこの選択肢を選んだか）は対象外
 * （必要であれば別Issueで扱う）。
 */
function buildCrosstabSection_(rows) {
  var newSurveyRows = rows.filter(function (row) { return isNewSurveyCompletionStage_(row.completion_stage); });

  // buildHighlightsSection_のrowsWithRegionBlockと同じコピー処理に相乗りし、__region_block__に
  // 加えて__region_highlight__も同じループ内で付与する（行走査を増やさない）。
  var rowsWithRegionFields = newSurveyRows.map(function (row) {
    var copy = {};
    Object.keys(row).forEach(function (key) { copy[key] = row[key]; });
    copy.__region_block__ = regionBlockForPrefecture_(row.prefecture);
    copy.__region_highlight__ = regionHighlightForPrefecture_(row.prefecture);
    return copy;
  });

  var regionBlockNames = REGION_BLOCKS.map(function (b) { return b.name; });

  var questions = CROSSTAB_QUESTIONS.map(function (q) {
    var crosstabFn = q.type === 'multi' ? crosstabMultiVsSingle_ : crosstabSingleVsSingle_;
    return {
      field: q.field,
      label: q.label,
      type: q.type,
      byAge: crosstabFn(rowsWithRegionFields, q.field, q.options, 'age', AGE_OPTIONS),
      byRegionBlock: crosstabFn(rowsWithRegionFields, q.field, q.options, '__region_block__', regionBlockNames),
      byRegionHighlight: crosstabFn(rowsWithRegionFields, q.field, q.options, '__region_highlight__', REGION_HIGHLIGHT_LABELS)
    };
  });

  return { sampleSize: newSurveyRows.length, questions: questions };
}
