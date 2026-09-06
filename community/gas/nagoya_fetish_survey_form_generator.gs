/**
 * 名古屋のフェチ・衣装交流に関するアンケート｜Googleフォーム自動生成スクリプト
 *
 * 【このスクリプトの目的】
 * 名古屋・愛知県エリアにおける「フェチ・衣装系交流」の需要調査（市場調査）用の
 * Googleフォームと、回答保存用Googleスプレッドシートを1回の実行で自動生成する。
 * イベントの開催告知・参加募集・日程調整を行うものではない（匿名の市場調査）。
 *
 * 【実行方法】
 * 1. script.google.com で新規スタンドアロンのApps Scriptプロジェクトを作成し、
 *    このファイルの内容をそのまま貼り付ける。
 * 2. エディタ上部の関数選択で main を選び、実行（▷）する。
 * 3. 初回実行時はGoogleアカウントの権限承認を求められるので許可する
 *    （必要スコープ：フォームの作成・編集、スプレッドシートの作成・編集）。
 * 4. 実行完了後、Apps Scriptエディタの「実行数」または「ログを表示」から
 *    フォーム編集URL・フォーム回答URL・スプレッドシートURLを確認する。
 *
 * 【二重実行対策】
 * 生成済みのフォームID・スプレッドシートIDはPropertiesServiceに保存する。
 * 既に生成済みの場合、mainを再実行しても新規のフォーム・スプレッドシートは
 * 作成せず、既存のURLをログへ表示するだけにする（大量複製の防止）。
 * 作り直したい場合は、Apps Scriptエディタの「プロジェクトの設定」→
 * 「スクリプト プロパティ」から NAGOYA_FETISH_SURVEY_FORM_ID と
 * NAGOYA_FETISH_SURVEY_SPREADSHEET_ID を削除してから再実行すること
 * （手動で作成済みのフォーム・スプレッドシートをDriveから削除するかどうかは
 * このスクリプトの責務外。誤って残さないよう自分で確認・削除すること）。
 */

/* ══════════════════════════════════════════════════════════════
 * 設定値・選択肢の定義（ここを直接編集すれば、後から設問・選択肢を修正できる）
 * ══════════════════════════════════════════════════════════════ */

var PROP_FORM_ID = 'NAGOYA_FETISH_SURVEY_FORM_ID';
var PROP_SPREADSHEET_ID = 'NAGOYA_FETISH_SURVEY_SPREADSHEET_ID';

var FORM_TITLE = '名古屋のフェチ・衣装交流に関するアンケート';

var FORM_DESCRIPTION = [
  '名古屋エリアでのフェチ・衣装系の交流や撮影について、今後の企画検討の参考にするための匿名アンケートです。',
  '',
  '【重要】',
  'このアンケートはイベントの開催告知・参加募集・参加申込ではありません。',
  '回答いただいても、イベントへの参加予約・参加表明にはなりません。',
  'また、現時点で特定の日程・内容の開催を決定するものでもありません。',
  '',
  '名古屋周辺で、どのようなニーズや参加しにくさがあるのかを把握することを目的としています。',
  '',
  '回答時間：約3〜4分'
].join('\n');

var CONFIRMATION_MESSAGE = [
  'ご回答ありがとうございました。',
  '',
  '本アンケートは市場調査を目的としたものであり、イベントへの参加申込・予約ではありません。',
  'いただいた回答は、今後の企画検討の参考として利用します。'
].join('\n');

/* 回答保存用スプレッドシートの名前・シート名。
   フォームの回答シート名はGoogleフォーム連携時に自動生成される名前
   （通常「フォームの回答 1」等）から、後段の処理でこの名前へ統一する。 */
var SPREADSHEET_NAME = '名古屋のフェチ・衣装交流に関するアンケート（回答保存用）';
var RESPONSE_SHEET_NAME = 'フォームの回答';
var SHEET_RESIDENCE = '集計_居住地';
var SHEET_FREQUENCY = '集計_頻度';
var SHEET_PRICE = '集計_価格';
var SHEET_HEADCOUNT = '集計_人数';
var SHEET_BARRIER = '集計_参加障壁';
var SHEET_WEAR = '集計_服装';
var SHEET_INTENT = '集計_参加意向';

/* 集計シート内で1ブロック（表）ごとに何行分の間隔を空けるか。
   都道府県(48件)のような選択肢数が多い単純集計でも重ならないよう余裕を持たせる。 */
var BLOCK_ROW_STEP = 60;

/* Q1：都道府県（47都道府県＋海外の48択）。並び順は北海道→沖縄→海外の慣例順。 */
var PREFECTURES = [
  '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
  '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
  '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県',
  '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県',
  '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県',
  '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県',
  '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県', '海外'
];

/* Q2：お住まいの地域。Q1で愛知県以外を選んだ人にも表示されるため「愛知県外」を用意する
   （Q1に応じた表示切り替えは行わず全員表示。詳細は末尾コメント「実装上の制約」参照）。 */
var Q2_OPTIONS = [
  '名古屋市', '尾張地域（名古屋市以外）', '知多地域', '西三河地域',
  '東三河地域', '愛知県外', 'わからない・その他'
];

var Q3_OPTIONS = [
  '18〜24歳', '25〜29歳', '30〜39歳', '40〜49歳', '50〜59歳', '60歳以上', '回答しない'
];

/* Q4：好きな服装。「その他」はGoogleフォーム標準の自由記述付き「その他」オプションを使う
   （showOtherOption）ため、この配列には含めない。 */
var Q4_OPTIONS = [
  '野球ユニフォーム', 'サッカーユニフォーム', 'バスケットボールユニフォーム',
  'ラグビー・アメリカンフットボール', '陸上競技ウェア', 'スイムウェア',
  'レスリング・シングレット', '学校制服', 'ジャージ・トレーニングウェア',
  'スーツ', '作業着・職業制服', 'コスプレ衣装'
];

var Q5_OPTIONS = [
  '月2回程度', '月1回程度', '1〜2か月に1回程度', '2〜3か月に1回程度',
  '半年に1回程度', '頻度はあまり関係ない', 'わからない'
];

var Q6_OPTIONS = [
  '2,000円以下', '2,500円程度', '3,000円程度', '3,500円程度',
  '4,000円程度', '5,000円程度', '内容によっては5,000円以上でもよい'
];

var Q7_OPTIONS = [
  '3〜4人', '5〜6人', '7〜8人', '9〜10人', '11人以上', '人数はあまり気にならない'
];

var Q8_OPTIONS = [
  '見たことがあり、実際に参加したことがある',
  '見たことはあるが、申し込んだことはない',
  '申し込もうと思ったが見送ったことがある',
  '告知を見たことがない',
  '覚えていない'
];

/* Q9：申し込まなかった理由。「その他」はshowOtherOptionで扱うため配列には含めない。 */
var Q9_OPTIONS = [
  '日程が合わなかった', '開催時間が合わなかった', '開催場所が遠かった',
  '料金が高いと感じた', '一人参加が不安だった', '知り合いがいなかった',
  '参加者の年齢層が分からなかった', 'どんな人が来るか分からなかった',
  '自分の好きなジャンルと合うか不安だった', '何をするイベントなのか分かりにくかった',
  '写真撮影が不安だった', 'SNS掲載が不安だった', '衣装を用意するのが面倒だった',
  '申し込み方法が面倒だった', '予定を早く決められなかった',
  '直前になると行く気がなくなった', '興味はあるが、実際に参加するほどではなかった',
  '該当しない'
];

/* Q10：申し込みやすくなる情報。「その他」はshowOtherOptionで扱うため配列には含めない。 */
var Q10_OPTIONS = [
  '参加予定人数', '参加者の年代', '初参加者が何人いるか', '一人参加者が何人いるか',
  '当日の流れ', 'どんな衣装の人が参加するか', '写真撮影のルール', 'SNS掲載ルール',
  '会場の写真', '主催者についての情報', '過去開催の様子', '過去参加者の感想',
  'キャンセル規定', '特にない'
];

var Q11_OPTIONS = [
  '日程が合えば申し込む可能性が高い', '内容や参加者を見てから決める',
  '興味はあるが、たぶん申し込まない', '参加しない', 'わからない'
];

var Q12_OPTIONS = [
  'よくある', 'ときどきある', 'あまりない', 'ない', 'わからない'
];

/* Q13：Q12でギャップがあると答えた人向けの理由。「その他」はshowOtherOptionで扱う。 */
var Q13_OPTIONS = [
  'アンケートでは予定を具体的に考えていない', '実際の日程になると都合が合わない',
  '実際にお金を払う段階になると迷う', '知らない人と会うことに不安を感じる',
  '申し込み後に断りづらくなるのが嫌', '当日まで参加する気分が続くか不安',
  '興味を示すことと、実際に参加することは別だと思っている', '該当しない'
];

/* ══════════════════════════════════════════════════════════════
 * メイン処理
 * ══════════════════════════════════════════════════════════════ */

function main() {
  var props = PropertiesService.getScriptProperties();
  var existingFormId = props.getProperty(PROP_FORM_ID);
  var existingSpreadsheetId = props.getProperty(PROP_SPREADSHEET_ID);

  if (existingFormId && existingSpreadsheetId) {
    logExistingResources_(existingFormId, existingSpreadsheetId);
    return;
  }

  var spreadsheet = SpreadsheetApp.create(SPREADSHEET_NAME);
  var form = FormApp.create(FORM_TITLE);

  // フォーム・スプレッドシートの実体を作った直後にIDを保存する。
  // これ以降の処理（設問追加・集計シート作成）で例外が起きても、再実行時に
  // フォーム・スプレッドシート自体が再度大量生成されることは防げる
  // （その場合は下記「二重実行対策」のとおり、スクリプトプロパティを削除してから
  // 手動で状態を確認・再実行すること）。
  props.setProperty(PROP_FORM_ID, form.getId());
  props.setProperty(PROP_SPREADSHEET_ID, spreadsheet.getId());

  configureFormSettings_(form);
  buildQuestions_(form);

  form.setDestination(FormApp.DestinationType.SPREADSHEET, spreadsheet.getId());
  var responseSheet = findAndRenameResponseSheet_(spreadsheet);
  addHelperColumns_(responseSheet);
  removeLeftoverDefaultSheet_(spreadsheet, responseSheet);
  buildAggregationSheets_(spreadsheet);

  logSummary_(form, spreadsheet);
}

/**
 * フォーム全体の設定（匿名性・回答ハードルの低さを優先する設定）。
 */
function configureFormSettings_(form) {
  form.setDescription(FORM_DESCRIPTION);
  form.setConfirmationMessage(CONFIRMATION_MESSAGE);
  form.setCollectEmail(false); // メールアドレス収集OFF
  form.setLimitOneResponsePerUser(false); // 1人1回答制限OFF（ログイン不要と両立させる）
  form.setAllowResponseEdits(false); // 回答編集OFF
  form.setPublishingSummary(false); // 回答概要の公開OFF
  form.setShowLinkToRespondAgain(false);

  // 「Googleログイン必須にしない」設定はGoogle Workspaceドメイン管理下でのみ意味を持つ
  // 項目で、環境によってはFormApp側にAPIが存在しない場合がある。存在すれば呼び出し、
  // 存在しない・使えない場合でもスクリプト全体を止めないようtry/catchで保護する。
  // 実行後は必ずフォームの「設定」→「回答」で「ログインを必須にする」がオフになっているか
  // 目視確認すること（詳細は本ファイル末尾コメントの「実装上の制約」参照）。
  try {
    if (typeof form.setRequireLogin === 'function') {
      form.setRequireLogin(false);
    }
  } catch (requireLoginError) {
    Logger.log('[情報] setRequireLoginの呼び出しをスキップしました: ' + requireLoginError);
  }
}

/**
 * Q1〜Q14の設問をフォームへ追加する。
 */
function buildQuestions_(form) {
  addListQuestion_(form, 'お住まいの都道府県を教えてください', PREFECTURES, true);

  addRadioQuestion_(
    form,
    'お住まいの地域を教えてください',
    Q2_OPTIONS,
    true,
    '愛知県以外にお住まいの方は「愛知県外」を、判断がつかない場合は「わからない・その他」を選択してください。'
  );

  addRadioQuestion_(form, '年代を教えてください', Q3_OPTIONS, true, null);

  addCheckboxQuestion_(
    form,
    '好き・興味のある服装を教えてください（複数回答可）',
    Q4_OPTIONS,
    true,
    null,
    true
  );

  addRadioQuestion_(
    form,
    '名古屋市内で少人数のフェチ・衣装交流や撮影企画がある場合、どの程度の頻度なら参加を検討しやすいですか？',
    Q5_OPTIONS,
    true,
    '「開催してほしい頻度」ではなく、「ご自身が参加を検討しやすい頻度」をお答えください。' +
      '特定の頻度・日程での開催を約束するものではありません。'
  );

  addRadioQuestion_(
    form,
    '1回3時間程度の少人数企画を想定した場合、参加しやすい料金はいくらですか？',
    Q6_OPTIONS,
    true,
    null
  );

  addRadioQuestion_(
    form,
    '1回の参加人数は何人くらいが参加しやすいと思いますか？',
    Q7_OPTIONS,
    true,
    null
  );

  addRadioQuestion_(
    form,
    '名古屋でフェチ・衣装系の交流企画の告知を見たことがありますか？',
    Q8_OPTIONS,
    true,
    null
  );

  addCheckboxQuestion_(
    form,
    '「興味がある」と思った企画でも、実際には申し込まなかった理由があれば教えてください（複数回答可）',
    Q9_OPTIONS,
    false,
    '該当する理由がなければ「該当しない」を選んでください。',
    true
  );

  addCheckboxQuestion_(
    form,
    '参加を決める際、どのような情報が分かれば申し込みやすくなりますか？（複数回答可）',
    Q10_OPTIONS,
    false,
    '特に無ければ「特にない」を選んでください。',
    true
  );

  addSectionHeader_(
    form,
    '以下は実際の募集ではありません',
    '参加意向を把握するための仮定の質問です。'
  );

  addRadioQuestion_(
    form,
    '仮に以下の条件の企画が名古屋市内であった場合、実際に申し込む可能性に最も近いものを教えてください',
    Q11_OPTIONS,
    true,
    [
      '【条件（あくまで仮定です）】',
      '・3時間程度',
      '・5〜6名程度',
      '・参加費3,500円',
      '・一人参加可',
      '・写真やSNS掲載は本人の了承なしでは行わない',
      '',
      'この条件での開催を決定・約束するものではありません。'
    ].join('\n')
  );

  addRadioQuestion_(
    form,
    'アンケートでは「参加したい・興味がある」と回答しても、実際の募集になると申し込まないことはありますか？',
    Q12_OPTIONS,
    true,
    null
  );

  addCheckboxQuestion_(
    form,
    'Q12で「よくある」「ときどきある」と回答した方へ。その理由として近いものを教えてください（複数回答可）',
    Q13_OPTIONS,
    false,
    'Q12で「あまりない」「ない」「わからない」と回答した方は「該当しない」を選んでください。',
    true
  );

  addParagraphQuestion_(
    form,
    'その他、名古屋でのフェチ・衣装系交流についてご意見があれば自由にお書きください',
    false,
    '任意でご記入ください。'
  );
}

/* ── 設問追加ヘルパー ───────────────────────────────────────── */

function addListQuestion_(form, title, choices, required) {
  var item = form.addListItem();
  item.setTitle(title);
  item.setChoiceValues(choices);
  item.setRequired(required);
  return item;
}

function addRadioQuestion_(form, title, choices, required, helpText) {
  var item = form.addMultipleChoiceItem();
  item.setTitle(title);
  item.setChoiceValues(choices);
  item.setRequired(required);
  if (helpText) item.setHelpText(helpText);
  return item;
}

function addCheckboxQuestion_(form, title, choices, required, helpText, allowOther) {
  var item = form.addCheckboxItem();
  item.setTitle(title);
  item.setChoiceValues(choices);
  item.setRequired(required);
  if (helpText) item.setHelpText(helpText);
  if (allowOther) item.showOtherOption(true);
  return item;
}

function addParagraphQuestion_(form, title, required, helpText) {
  var item = form.addParagraphTextItem();
  item.setTitle(title);
  item.setRequired(required);
  if (helpText) item.setHelpText(helpText);
  return item;
}

function addSectionHeader_(form, title, helpText) {
  var item = form.addSectionHeaderItem();
  item.setTitle(title);
  if (helpText) item.setHelpText(helpText);
  return item;
}

/* ══════════════════════════════════════════════════════════════
 * スプレッドシート側の処理（回答シートの特定・リネーム／補助列／集計シート）
 * ══════════════════════════════════════════════════════════════ */

/**
 * form.setDestination() 実行後にGoogleが自動生成する回答シート
 * （通常「フォームの回答 1」等の名前）を探し、RESPONSE_SHEET_NAME にリネームする。
 */
function findAndRenameResponseSheet_(spreadsheet) {
  SpreadsheetApp.flush();
  var sheets = spreadsheet.getSheets();
  var target = null;
  for (var i = 0; i < sheets.length; i++) {
    var name = sheets[i].getName();
    if (name.indexOf('フォームの回答') === 0 || name.indexOf('Form Responses') === 0) {
      target = sheets[i];
      break;
    }
  }
  if (!target) {
    throw new Error(
      'フォーム連携用の回答シートが見つかりませんでした。' +
        'スプレッドシートを開いて手動でシート名を確認してください。'
    );
  }
  if (target.getName() !== RESPONSE_SHEET_NAME) {
    target.setName(RESPONSE_SHEET_NAME);
  }
  return target;
}

/**
 * 回答シートの末尾（P列・Q列）に、集計をしやすくするための補助列を追加する。
 * 生の回答列（A〜O列）はいっさい変更しない。
 *
 * P列「居住地4分類」：名古屋市 / 愛知県（名古屋市以外） / 岐阜県・三重県 / その他地域
 * Q列「愛知県フラグ」：Q1が愛知県ならTRUE（愛知県回答だけの抽出に使う）
 *
 * どちらもARRAYFORMULAによるスピル式1本のみを配置する。
 * B列・C列の入力が増える（＝フォーム回答が追加される）たびに自動的に下へ広がるため、
 * 行を手動でコピーする方式より壊れにくい。
 */
function addHelperColumns_(sheet) {
  sheet.getRange('P1').setValue('居住地4分類');
  sheet.getRange('Q1').setValue('愛知県フラグ');
  sheet.getRange('P1:Q1').setFontWeight('bold');

  sheet.getRange('P2').setFormula(
    '=ARRAYFORMULA(IF(B2:B="","",' +
      'IF(C2:C="名古屋市","名古屋市",' +
      'IF(B2:B="愛知県","愛知県（名古屋市以外）",' +
      'IF((B2:B="岐阜県")+(B2:B="三重県")>0,"岐阜県・三重県","その他地域")))))'
  );
  sheet.getRange('Q2').setFormula('=ARRAYFORMULA(IF(B2:B="","",B2:B="愛知県"))');
}

/**
 * SpreadsheetApp.create() 直後に存在するデフォルトの空シート（「シート1」等）が
 * 回答シートと別に残っている場合、空であることを確認したうえで削除する。
 */
function removeLeftoverDefaultSheet_(spreadsheet, responseSheet) {
  var sheets = spreadsheet.getSheets();
  sheets.forEach(function (sheet) {
    if (sheet.getSheetId() === responseSheet.getSheetId()) return;
    var name = sheet.getName();
    var isDefaultName = (name === 'シート1' || name === 'Sheet1');
    var isEmpty = sheet.getLastRow() === 0 && sheet.getLastColumn() === 0;
    if (isDefaultName && isEmpty) {
      spreadsheet.deleteSheet(sheet);
    }
  });
}

/**
 * クロス集計用のシート群を作成する。
 * 個票（生データ）を複製せず、QUERY関数・SUMPRODUCT+SEARCH関数のみで
 * 回答シートを参照する構成にすることで、行の追加・削除に強い（壊れにくい）集計にする。
 *
 * 列の対応（フォームの回答シート）：
 * A タイムスタンプ / B Q1都道府県 / C Q2地域 / D Q3年代 / E Q4服装(複数) /
 * F Q5頻度 / G Q6価格 / H Q7人数 / I Q8認知 / J Q9理由(複数) / K Q10情報(複数) /
 * L Q11実参加意向 / M Q12ギャップ / N Q13ギャップ理由(複数) / O Q14自由記述 /
 * P 居住地4分類(補助列) / Q 愛知県フラグ(補助列)
 */
function buildAggregationSheets_(spreadsheet) {
  var range = respQueryRange_();

  var residence = spreadsheet.insertSheet(SHEET_RESIDENCE);
  writeTitledFormula_(residence, 0, '都道府県別 回答数（単純集計）',
    queryFormula_(range, "select B, count(A) group by B label count(A) '回答数'"));
  writeTitledFormula_(residence, 1, '地域(Q2)別 回答数（単純集計）',
    queryFormula_(range, "select C, count(A) group by C label count(A) '回答数'"));
  writeTitledFormula_(residence, 2, '居住地4分類別 回答数（単純集計）',
    queryFormula_(range, "select P, count(A) group by P label count(A) '回答数'"));
  writeTitledFormula_(residence, 3, '愛知県内地域(Q2) × 希望頻度(Q5) ※Q1で愛知県を選んだ回答のみ',
    queryFormula_(range, "select C, count(A) where B = '愛知県' group by C pivot F label count(A) '回答数'"));
  writeTitledFormula_(residence, 4, '居住地4分類 × Q11 実参加意向',
    queryFormula_(range, "select P, count(A) group by P pivot L label count(A) '回答数'"));

  var freq = spreadsheet.insertSheet(SHEET_FREQUENCY);
  writeTitledFormula_(freq, 0, '都道府県 × 希望頻度(Q5)',
    queryFormula_(range, "select B, count(A) group by B pivot F label count(A) '回答数'"));
  writeTitledFormula_(freq, 1, '年代(Q3) × 希望頻度(Q5)',
    queryFormula_(range, "select D, count(A) group by D pivot F label count(A) '回答数'"));
  writeTitledFormula_(freq, 2, '居住地4分類 × 希望頻度(Q5)',
    queryFormula_(range, "select P, count(A) group by P pivot F label count(A) '回答数'"));

  var price = spreadsheet.insertSheet(SHEET_PRICE);
  writeTitledFormula_(price, 0, '都道府県 × 価格(Q6)',
    queryFormula_(range, "select B, count(A) group by B pivot G label count(A) '回答数'"));
  writeTitledFormula_(price, 1, '年代(Q3) × 価格(Q6)',
    queryFormula_(range, "select D, count(A) group by D pivot G label count(A) '回答数'"));
  writeTitledFormula_(price, 2, '居住地4分類 × 価格(Q6)',
    queryFormula_(range, "select P, count(A) group by P pivot G label count(A) '回答数'"));

  var headcount = spreadsheet.insertSheet(SHEET_HEADCOUNT);
  writeTitledFormula_(headcount, 0, '都道府県 × 希望人数(Q7)',
    queryFormula_(range, "select B, count(A) group by B pivot H label count(A) '回答数'"));
  writeTitledFormula_(headcount, 1, '居住地4分類 × 希望人数(Q7)',
    queryFormula_(range, "select P, count(A) group by P pivot H label count(A) '回答数'"));

  var barrier = spreadsheet.insertSheet(SHEET_BARRIER);
  writeMultiTally_(barrier, 0, 'Q9 申し込まなかった理由 別集計（複数回答、延べ件数）',
    respColRange_('J'), Q9_OPTIONS);
  writeMultiTally_(barrier, 1, 'Q10 参加しやすくなる情報 別集計（複数回答、延べ件数）',
    respColRange_('K'), Q10_OPTIONS);
  writeTitledFormula_(barrier, 2, 'Q12 単純集計（アンケートと実申込のギャップ）',
    queryFormula_(range, "select M, count(A) group by M label count(A) '回答数'"));
  writeMultiVsSingleGrid_(barrier, 3, 'Q12 × Q13（ギャップの理由） ※列=Q12、行=Q13理由、延べ件数',
    respColRange_('N'), Q13_OPTIONS, respColRange_('M'), Q12_OPTIONS);

  var wear = spreadsheet.insertSheet(SHEET_WEAR);
  writeMultiTally_(wear, 0, 'Q4 好きな服装 別集計（複数回答、延べ件数）',
    respColRange_('E'), Q4_OPTIONS);
  writeMultiVsSingleGrid_(wear, 1, '年代(Q3) × 好きな服装(Q4) ※列=年代、行=服装、延べ件数',
    respColRange_('E'), Q4_OPTIONS, respColRange_('D'), Q3_OPTIONS);
  writeMultiVsSingleGrid_(wear, 2, '好きな服装(Q4) × Q11実参加意向 ※列=Q11、行=服装、延べ件数',
    respColRange_('E'), Q4_OPTIONS, respColRange_('L'), Q11_OPTIONS);

  var intent = spreadsheet.insertSheet(SHEET_INTENT);
  writeTitledFormula_(intent, 0, 'Q8 単純集計（告知の認知・参加経験）',
    queryFormula_(range, "select I, count(A) group by I label count(A) '回答数'"));
  writeTitledFormula_(intent, 1, 'Q11 単純集計（仮定条件での実参加意向）',
    queryFormula_(range, "select L, count(A) group by L label count(A) '回答数'"));
}

/* ── 集計シート用ヘルパー ───────────────────────────────────── */

function respQueryRange_() {
  return "'" + RESPONSE_SHEET_NAME + "'!A1:Q5000";
}

function respColRange_(letter) {
  return "'" + RESPONSE_SHEET_NAME + "'!" + letter + '2:' + letter + '5000';
}

function queryFormula_(range, query) {
  return '=QUERY(' + range + ',"' + query.replace(/"/g, '""') + '",1)';
}

function escapeForFormula_(text) {
  return String(text).replace(/"/g, '""');
}

/**
 * 「タイトル行＋その1行下にQUERY式」という1ブロックをblockIndex番目の位置に書き込む。
 */
function writeTitledFormula_(sheet, blockIndex, title, formula) {
  var row = 1 + blockIndex * BLOCK_ROW_STEP;
  var titleCell = sheet.getRange(row, 1);
  titleCell.setValue(title);
  titleCell.setFontWeight('bold');
  sheet.getRange(row + 1, 1).setFormula(formula);
}

/**
 * 複数選択設問（カンマ区切りで1セルに保存される）の選択肢ごとの延べ件数を
 * SUMPRODUCT(ISNUMBER(SEARCH(...))) で集計する単純集計表を書き込む。
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
 * 「複数選択設問 × 単一選択設問」のクロス集計グリッドを書き込む。
 * 行＝rowCategories（複数選択側の選択肢）、列＝colCategories（単一選択側の選択肢）。
 * 各セルはSUMPRODUCT(ISNUMBER(SEARCH(行の選択肢, 複数選択列)) * (単一選択列 = 列の選択肢)) で
 * 延べ件数を数える。
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
 * ログ出力
 * ══════════════════════════════════════════════════════════════ */

function logSummary_(form, spreadsheet) {
  Logger.log('===== 名古屋フェチ・衣装交流アンケート 生成結果 =====');
  Logger.log('フォーム編集URL: ' + form.getEditUrl());
  Logger.log('フォーム回答URL: ' + form.getPublishedUrl());
  Logger.log('スプレッドシートURL: ' + spreadsheet.getUrl());
}

function logExistingResources_(formId, spreadsheetId) {
  Logger.log('===== 既に生成済みのため、新規作成をスキップしました =====');
  try {
    var form = FormApp.openById(formId);
    Logger.log('フォーム編集URL: ' + form.getEditUrl());
    Logger.log('フォーム回答URL: ' + form.getPublishedUrl());
  } catch (formError) {
    Logger.log('[警告] 保存済みのフォームID(' + formId + ')を開けませんでした: ' + formError);
  }
  try {
    var spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    Logger.log('スプレッドシートURL: ' + spreadsheet.getUrl());
  } catch (spreadsheetError) {
    Logger.log('[警告] 保存済みのスプレッドシートID(' + spreadsheetId + ')を開けませんでした: ' + spreadsheetError);
  }
  Logger.log(
    '作り直したい場合は、スクリプトプロパティ(' + PROP_FORM_ID + ' / ' + PROP_SPREADSHEET_ID +
      ')を削除してから再実行してください。'
  );
}
