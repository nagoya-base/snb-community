'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CODE_PATH = path.join(__dirname, '..', 'Code.gs');
const code = fs.readFileSync(CODE_PATH, 'utf8');

// GAS固有オブジェクトは、このテストで実際に呼ばれる関数（validateAnswers_ / buildRowValues_ /
// validateMultiSelect_）の中では参照されないため、存在だけダミーで用意しておけば十分。
const sandbox = {
  console,
  PropertiesService: {},
  SpreadsheetApp: {},
  LockService: {},
  Utilities: {
    computeDigest: () => [],
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' },
    getUuid: () => 'x'
  },
  HtmlService: {},
  Logger: { log: () => {} }
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failures++;
  } else {
    console.log('OK:', msg);
  }
}

const validateAnswers_ = sandbox.validateAnswers_;
const buildRowValues_ = sandbox.buildRowValues_;

/**
 * completion_stage='no_gate_reached'（STEP1A止まり）の最小構成の回答。
 * hasUniformGate_/hasSuitGate_双方に非該当な interestCategories を選んでいる前提。
 */
function baseNoGateAnswers(overrides) {
  return Object.assign({
    prefecture: '東京都',
    aichiArea: '',
    age: '18〜24歳',
    interestCategories: ['ヒーロー系'],
    primaryInterestCategory: '',
    engagementPreferences: ['人が着ているのを見たい'],
    snbcAwareness: '',
    snbcInterest: '',
    snbcInterestUncertainReasons: [],
    suitEngagementPreferences: [],
    suitTypes: [],
    suitStates: [],
    suitEventInterest: '',
    preferredFrequency: '',
    preferredPrice: '',
    preferredGroupSize: '',
    preferredFormat: [],
    eventAwareness: '',
    barriers: [],
    helpfulInformation: [],
    preferredAtmosphere: '',
    hypotheticalIntent: '',
    surveyToSignupGap: '',
    gapReasons: [],
    freeComment: '',
    surveyPath: 'none',
    completionStage: 'no_gate_reached'
  }, overrides || {});
}

function deepDiveFields(overrides) {
  return Object.assign({
    preferredFrequency: '月2回程度',
    preferredPrice: '2,000円以下',
    preferredGroupSize: '3〜4人',
    preferredFormat: ['わからない'],
    eventAwareness: '覚えていない',
    barriers: ['該当しない'],
    helpfulInformation: [],
    preferredAtmosphere: 'わからない',
    hypotheticalIntent: 'わからない',
    surveyToSignupGap: 'ない',
    gapReasons: [],
    freeComment: ''
  }, overrides || {});
}

/* ── 正常系：no_gate_reached ── */
assert(validateAnswers_(baseNoGateAnswers()) === null, 'valid no_gate_reached baseline passes');

/* ── prefecture / aichiArea（回帰確認） ── */
assert(validateAnswers_(baseNoGateAnswers({ prefecture: 'ワカンダ' })) === 'prefecture_invalid', 'invalid prefecture rejected');
assert(sandbox.AICHI_AREA_OPTIONS.indexOf('愛知県外') === -1, 'AICHI_AREA_OPTIONS does not contain 愛知県外');
assert(
  validateAnswers_(baseNoGateAnswers({ prefecture: '愛知県', aichiArea: '' })) === 'aichi_area_required',
  'aichi_area required when prefecture is 愛知県'
);
assert(
  validateAnswers_(baseNoGateAnswers({ aichiArea: '名古屋市' })) === 'aichi_area_must_be_blank',
  'aichi_area must be blank when prefecture is not 愛知県'
);

/* ── interest_categories（Q4相当・分析の主） ── */
assert(sandbox.INTEREST_CATEGORY_OPTIONS.length === 22, 'INTEREST_CATEGORY_OPTIONS has 22 options, got ' + sandbox.INTEREST_CATEGORY_OPTIONS.length);
assert(validateAnswers_(baseNoGateAnswers({ interestCategories: [] })) === 'interest_categories_required', 'interestCategories required');
assert(
  sandbox.INTEREST_SPORTS_OPTIONS.indexOf('競パン') !== -1 && sandbox.INTEREST_SPORTS_OPTIONS.indexOf('水泳・競泳ウェア（競パン以外）') !== -1,
  '競パン and 水泳・競泳ウェア（競パン以外） are independent items'
);
assert(
  sandbox.INTEREST_SPORTS_OPTIONS.indexOf('体操服') !== -1 && sandbox.INTEREST_UNIFORM_JOB_OPTIONS.indexOf('学校制服') !== -1,
  '体操服 and 学校制服 are independent items (different groups)'
);
assert(sandbox.INTEREST_UNIFORM_JOB_OPTIONS.indexOf('ケモナー') === -1, 'no group uses the word ケモナー');
assert(sandbox.INTEREST_COSPLAY_OPTIONS.indexOf('ケモノ・着ぐるみ・獣人系') !== -1, 'ケモノ・着ぐるみ・獣人系 is used instead');
assert(sandbox.INTEREST_COSPLAY_OPTIONS.indexOf('全身タイツ') !== -1, '全身タイツ is its own item, not folded into コスプレ衣装');

/* ── primary_interest_category（Q5相当・補助指標、任意） ── */
assert(validateAnswers_(baseNoGateAnswers({ primaryInterestCategory: '' })) === null, 'primaryInterestCategory optional (blank ok)');
assert(
  validateAnswers_(baseNoGateAnswers({ interestCategories: ['ヒーロー系'], primaryInterestCategory: '悪役・ヴィラン系' })) ===
    'primary_interest_category_not_in_interest_categories',
  'primaryInterestCategory must be one of interestCategories'
);
assert(
  validateAnswers_(baseNoGateAnswers({ interestCategories: ['ヒーロー系'], primaryInterestCategory: 'ヒーロー系' })) === null,
  'primaryInterestCategory within interestCategories accepted'
);

/* ── engagement_preferences（Q6相当・必須） ── */
assert(validateAnswers_(baseNoGateAnswers({ engagementPreferences: [] })) === 'engagement_preferences_required', 'engagementPreferences required');
assert(
  validateAnswers_(baseNoGateAnswers({ engagementPreferences: ['撮られる側として関わりたい'] })) === null,
  'engagementPreferences accepts 撮られる側として関わりたい (見る/撮るを区別できる)'
);

/* ── ヒーロー／悪役／特撮／ケモノ系だけでも正常回答として保存できる ── */
['ヒーロー系', '悪役・ヴィラン系', '特撮系', 'ケモノ・着ぐるみ・獣人系'].forEach((category) => {
  assert(
    validateAnswers_(baseNoGateAnswers({ interestCategories: [category] })) === null,
    category + ' alone is a valid no_gate_reached response'
  );
});

/* ── 全身タイツだけの回答者にSNBC深掘りが出ない（ユニフォーム系ゲート非該当） ── */
assert(sandbox.hasUniformGate_(['全身タイツ']) === false, '全身タイツ alone does not trigger hasUniformGate_');
assert(sandbox.hasUniformGate_(['スーツ']) === false, 'スーツ alone does not trigger hasUniformGate_ (separate gate)');
assert(sandbox.hasSuitGate_(['スーツ']) === true, 'スーツ triggers hasSuitGate_');
assert(
  validateAnswers_(baseNoGateAnswers({ interestCategories: ['全身タイツ'], snbcAwareness: '知っている' })) === 'snbc_awareness_must_be_blank',
  'snbcAwareness must stay blank when uniform gate not reached'
);

/* ── ユニフォーム系選択者だけSNBC認知設問が表示される（サーバー側は必須化で担保） ── */
sandbox.UNIFORM_GATE_CATEGORIES.forEach((category) => {
  assert(sandbox.hasUniformGate_([category]) === true, category + ' triggers hasUniformGate_');
});
assert(
  validateAnswers_(baseNoGateAnswers({ interestCategories: ['野球ユニフォーム'] })) === 'snbc_awareness_invalid',
  'snbcAwareness required once uniform gate is reached'
);

/* ── SNBC興味=いいえでSTEP3(深掘り)が要求されない／=はいで要求される ── */
assert(
  validateAnswers_(baseNoGateAnswers({
    interestCategories: ['野球ユニフォーム'], snbcAwareness: '知っている', snbcInterest: 'いいえ',
    surveyPath: 'uniform_only', completionStage: 'snbc_not_interested'
  })) === null,
  'snbc_interest=いいえ: deep-dive fields not required, stage=snbc_not_interested accepted'
);
assert(
  validateAnswers_(baseNoGateAnswers({
    interestCategories: ['野球ユニフォーム'], snbcAwareness: '知っている', snbcInterest: 'はい',
    surveyPath: 'uniform_only', completionStage: 'snbc_deep_dive'
  })) === 'preferred_frequency_invalid',
  'snbc_interest=はい requires deep-dive fields (STEP3 shown)'
);
assert(
  validateAnswers_(baseNoGateAnswers(Object.assign({
    interestCategories: ['野球ユニフォーム'], snbcAwareness: '知っている', snbcInterest: 'はい',
    surveyPath: 'uniform_only', completionStage: 'snbc_deep_dive'
  }, deepDiveFields()))) === null,
  'snbc_interest=はい + full deep-dive fields accepted'
);
assert(
  validateAnswers_(baseNoGateAnswers({
    interestCategories: ['野球ユニフォーム'], snbcAwareness: '知っている', snbcInterest: 'どちらともいえない',
    snbcInterestUncertainReasons: ['名古屋まで遠い'],
    surveyPath: 'uniform_only', completionStage: 'snbc_uncertain'
  })) === null,
  'snbc_interest=どちらともいえない with optional uncertain reason accepted'
);
assert(
  validateAnswers_(baseNoGateAnswers({
    interestCategories: ['野球ユニフォーム'], snbcAwareness: '知っている', snbcInterest: 'いいえ',
    snbcInterestUncertainReasons: ['名古屋まで遠い'],
    surveyPath: 'uniform_only', completionStage: 'snbc_not_interested'
  })) === 'snbc_interest_uncertain_reasons_must_be_blank',
  'uncertain reasons rejected when snbc_interest is not どちらともいえない'
);

/* ── Q4でスーツのみならSTEP2を飛ばしてSTEP2Bへ進む ── */
assert(
  validateAnswers_(baseNoGateAnswers({
    interestCategories: ['スーツ'],
    suitEngagementPreferences: ['自分で着たい'], suitTypes: ['ビジネススーツ'], suitStates: ['ジャケットを着たまま'], suitEventInterest: 'いいえ',
    surveyPath: 'suit_only', completionStage: 'suit_interest'
  })) === null,
  'suit-only respondent skips STEP2, completes STEP2B, no deep-dive required'
);
assert(
  validateAnswers_(baseNoGateAnswers({
    interestCategories: ['スーツ'], snbcAwareness: '知っている',
    surveyPath: 'suit_only', completionStage: 'suit_interest'
  })) === 'snbc_awareness_must_be_blank',
  'suit-only respondent must not have snbcAwareness populated (STEP2 skipped)'
);

/* ── Q4でユニフォーム系+スーツならSTEP2→(STEP3)→STEP2Bの順で、completion_stageは最終地点(suit_interest) ── */
assert(
  validateAnswers_(baseNoGateAnswers(Object.assign({
    interestCategories: ['野球ユニフォーム', 'スーツ'], snbcAwareness: '知っている', snbcInterest: 'いいえ',
    suitEngagementPreferences: ['自分で着たい'], suitTypes: ['ビジネススーツ'], suitStates: ['ジャケットを着たまま'], suitEventInterest: 'いいえ',
    surveyPath: 'uniform_and_suit', completionStage: 'suit_interest'
  }))) === null,
  'combined uniform+suit respondent: completion_stage is the final step (suit_interest), even though snbc_interest=いいえ'
);
assert(
  validateAnswers_(baseNoGateAnswers({
    interestCategories: ['野球ユニフォーム', 'スーツ'], snbcAwareness: '知っている', snbcInterest: 'いいえ',
    suitEngagementPreferences: ['自分で着たい'], suitTypes: ['ビジネススーツ'], suitStates: ['ジャケットを着たまま'], suitEventInterest: 'いいえ',
    surveyPath: 'uniform_only', completionStage: 'suit_interest'
  })) === 'survey_path_mismatch',
  'survey_path must reflect both gates when both are selected'
);

/* ── スーツ選択者にS1〜S4が表示される（サーバー側は必須化で担保） ── */
assert(sandbox.SUIT_ENGAGEMENT_OPTIONS.length === 5, 'SUIT_ENGAGEMENT_OPTIONS has 5 options');
assert(sandbox.SUIT_TYPES_OPTIONS.length === 8, 'SUIT_TYPES_OPTIONS has 8 options');
assert(sandbox.SUIT_STATES_OPTIONS.length === 6, 'SUIT_STATES_OPTIONS has 6 options');
assert(
  validateAnswers_(baseNoGateAnswers({ interestCategories: ['スーツ'] })) === 'suit_engagement_preferences_required',
  'suitEngagementPreferences required once suit gate is reached'
);

/* ── suit経由でsuit_event_interest=はいのときも#292深掘り一式を再利用できる ── */
assert(
  validateAnswers_(baseNoGateAnswers(Object.assign({
    interestCategories: ['スーツ'],
    suitEngagementPreferences: ['自分で着たい'], suitTypes: ['ビジネススーツ'], suitStates: ['ジャケットを着たまま'], suitEventInterest: 'はい',
    surveyPath: 'suit_only', completionStage: 'suit_interest'
  }, deepDiveFields()))) === null,
  'suit_event_interest=はい also triggers (and accepts) the shared #292 deep-dive field set'
);

/* ── completion_stageと回答内容の不整合をサーバー側で拒否する ── */
assert(
  validateAnswers_(baseNoGateAnswers({ interestCategories: ['ヒーロー系'], completionStage: 'snbc_deep_dive' })) === 'completion_stage_mismatch',
  'completion_stage mismatching actual answers is rejected'
);
assert(
  validateAnswers_(baseNoGateAnswers({ interestCategories: ['ヒーロー系'], surveyPath: 'uniform_only' })) === 'survey_path_mismatch',
  'survey_path mismatching actual answers is rejected'
);

/* ── その他（自由記述）の検証（既存パターンの回帰確認） ── */
assert(
  validateAnswers_(baseNoGateAnswers({ interestCategories: ['その他:'] })) === 'interest_categories_other_text_invalid',
  'interestCategories その他 with empty text rejected'
);
assert(
  validateAnswers_(baseNoGateAnswers({ interestCategories: ['その他:レザー系'] })) === null,
  'interestCategories その他 with text accepted'
);
assert(
  validateAnswers_(baseNoGateAnswers({ interestCategories: ['そんなジャンルはない'] })) === 'interest_categories_invalid_item',
  'interestCategories unknown item rejected'
);

/* ── clothing_interests（旧12択）は既存データを変更しない・新規回答では使わない ── */
assert(sandbox.CLOTHING_OPTIONS.length === 12, 'legacy CLOTHING_OPTIONS still has 12 options (unchanged)');
assert(sandbox.COLUMNS.indexOf('clothing_interests') !== -1, 'COLUMNS still keeps the legacy clothing_interests column');
assert(sandbox.COLUMNS.indexOf('interest_categories') > sandbox.COLUMNS.indexOf('clothing_interests'), 'interest_categories appended after clothing_interests (append-only)');
// 遡及マッピング関数が存在しないこと（旧→新の機械的な対応付けをしない、という設計の裏付け）。
assert(typeof sandbox.mapClothingInterestsToCategories_ === 'undefined', 'no retroactive mapping function from clothing_interests to interest_categories exists');

/* ── freeComment（既存の長さ制限の回帰確認、deep dive時のみ許可） ── */
assert(
  validateAnswers_(baseNoGateAnswers(Object.assign({
    interestCategories: ['野球ユニフォーム'], snbcAwareness: '知っている', snbcInterest: 'はい',
    surveyPath: 'uniform_only', completionStage: 'snbc_deep_dive'
  }, deepDiveFields({ freeComment: 'a'.repeat(301) })))) === 'free_comment_too_long',
  'freeComment too long rejected even within deep dive'
);
assert(
  validateAnswers_(baseNoGateAnswers({ interestCategories: ['ヒーロー系'], freeComment: '何か書いた' })) === 'free_comment_must_be_blank',
  'freeComment must stay blank when deep dive not triggered'
);

assert(validateAnswers_(null) === 'payload_invalid', 'null payload rejected');

/* ── buildRowValues_（列数・新規回答でclothing_interestsが空になること） ── */
const deepDiveAnswers = baseNoGateAnswers(Object.assign({
  prefecture: '愛知県', aichiArea: '名古屋市',
  interestCategories: ['野球ユニフォーム'], snbcAwareness: '知っている', snbcInterest: 'はい',
  surveyPath: 'uniform_only', completionStage: 'snbc_deep_dive'
}, deepDiveFields({ freeComment: '=SUM(A1:A10)' })));
const row = buildRowValues_('dummyhash', deepDiveAnswers);
assert(row.length === sandbox.COLUMNS.length, 'buildRowValues_ returns COLUMNS.length items, got ' + row.length);
assert(row[sandbox.COLUMNS.indexOf('clothing_interests')] === '', 'new responses write empty string to legacy clothing_interests column');
assert(row[sandbox.COLUMNS.indexOf('interest_categories')] === '野球ユニフォーム', 'interest_categories column holds the new category value');
assert(row[sandbox.COLUMNS.indexOf('completion_stage')] === 'snbc_deep_dive', 'completion_stage column stores the completion stage');
assert(row[sandbox.COLUMNS.indexOf('free_comment')] === "'=SUM(A1:A10)", 'formula-injection prefix still applied to free_comment');

/* ══════════════════════════════════════════════════════════════
 * Issue #298：公開結果（getPublicResults / view=results）関連
 * ══════════════════════════════════════════════════════════════ */

const REGION_BLOCKS = sandbox.REGION_BLOCKS;
const AGE_SIMPLE_GROUPS = sandbox.AGE_SIMPLE_GROUPS;
const PUBLIC_INTEREST_GROUPS = sandbox.PUBLIC_INTEREST_GROUPS;
const buildPublicSimpleBreakdown_ = sandbox.buildPublicSimpleBreakdown_;
const buildPublicCategoryBreakdown_ = sandbox.buildPublicCategoryBreakdown_;
const buildPublicRegionBreakdown_ = sandbox.buildPublicRegionBreakdown_;
const buildPublicAgeBreakdown_ = sandbox.buildPublicAgeBreakdown_;
const buildPublicResultsPayload_ = sandbox.buildPublicResultsPayload_;
const countOtherFreeTextEntries_ = sandbox.countOtherFreeTextEntries_;
const readMultiTallyBlock_ = sandbox.readMultiTallyBlock_;
const readQueryPairsBlock_ = sandbox.readQueryPairsBlock_;

/**
 * 1始まり(row, col)でセルにアクセスするgetRange().getValues()を模した、Code.gsが読む
 * シートのフェイク。rows0はrow1（0始まり配列のindex 0）に対応する2次元配列。
 */
function fakeSheetFromRows(rows0) {
  return {
    getLastRow: function () { return rows0.length; },
    getRange: function (row, col, numRows, numCols) {
      numRows = numRows || 1;
      numCols = numCols || 1;
      const values = [];
      for (let r = 0; r < numRows; r++) {
        const srcRow = rows0[row - 1 + r] || [];
        const rowValues = [];
        for (let c = 0; c < numCols; c++) {
          const cell = srcRow[col - 1 + c];
          rowValues.push(cell === undefined ? '' : cell);
        }
        values.push(rowValues);
      }
      return { getValues: function () { return values; } };
    }
  };
}

// writeMultiTally_()と同じレイアウト（タイトル行→ヘッダ行→categories.length行のデータ）を作る。
function buildMultiTallyRows(categories, countsMap) {
  const rows = ['タイトル行', ['選択肢', '件数']];
  categories.forEach((category) => rows.push([category, countsMap[category] || 0]));
  return rows;
}

// writeTitledFormula_()のQUERY(...)出力（タイトル行→QUERYヘッダ行→[ラベル,件数]…）を、
// 指定したblockIndexの位置（BLOCK_ROW_STEP間隔）に配置したシート全体の行配列を作る。
function buildRegionSheetRows(prefecturePairs, agePairs) {
  const rows = [];
  const step = sandbox.BLOCK_ROW_STEP;
  const placeBlock = (blockIndex, pairs) => {
    const titleRow0 = blockIndex * step; // 0始まりindex（1+blockIndex*step の1行目がindex blockIndex*step）
    rows[titleRow0] = 'タイトル行';
    rows[titleRow0 + 1] = ['prefecture', '回答数'];
    pairs.forEach((pair, i) => { rows[titleRow0 + 2 + i] = [pair[0], pair[1]]; });
  };
  placeBlock(0, prefecturePairs);
  placeBlock(sandbox.PUBLIC_AGE_TALLY_BLOCK_INDEX, agePairs);
  for (let i = 0; i < rows.length; i++) if (rows[i] === undefined) rows[i] = [];
  return rows;
}

/* ── view分岐：管理用ルートが公開プロジェクトに存在しないこと ── */
assert(typeof sandbox.doGet === 'function', 'doGet exists');
assert(typeof sandbox.getPublicResults === 'function', 'getPublicResults exists (public API for ?view=results)');
assert(typeof sandbox.getAdminResults === 'undefined', 'no admin API exists in the public project');
assert(typeof sandbox.ADMIN_SECRET === 'undefined' && typeof sandbox.ADMIN_TOKEN === 'undefined', 'no secret-token based admin auth exists in the public project');

/* ── 全国7地域ブロック：47都道府県＋海外を過不足なく1ブロックずつに割り当てる ── */
{
  const allAssigned = REGION_BLOCKS.reduce((acc, block) => acc.concat(block.prefectures), []);
  const expected = sandbox.PREFECTURES.slice().sort();
  assert(JSON.stringify(allAssigned.slice().sort()) === JSON.stringify(expected),
    'REGION_BLOCKS covers exactly all PREFECTURES entries with no gap/duplicate');
  assert(REGION_BLOCKS.length === 8, 'REGION_BLOCKS has 7 domestic blocks + 海外 = 8, got ' + REGION_BLOCKS.length);
}
assert(
  REGION_BLOCKS.find((b) => b.name === '近畿').prefectures.indexOf('三重県') !== -1,
  '三重県 is classified into 近畿 (not 中部)'
);
assert(
  REGION_BLOCKS.find((b) => b.name === '中部').prefectures.indexOf('三重県') === -1,
  '三重県 is NOT classified into 中部'
);

/* ── 年代簡略化5区分：AGE_OPTIONSを過不足なく1区分ずつに割り当てる ── */
{
  const allAssigned = AGE_SIMPLE_GROUPS.reduce((acc, g) => acc.concat(g.ages), []);
  const expected = sandbox.AGE_OPTIONS.slice().sort();
  assert(JSON.stringify(allAssigned.slice().sort()) === JSON.stringify(expected),
    'AGE_SIMPLE_GROUPS covers exactly all AGE_OPTIONS entries with no gap/duplicate');
}

/* ── 公開カテゴリ11区分：6独立カテゴリ＋5まとめカテゴリで22択を過不足なく網羅する ── */
{
  const standalone = ['野球ユニフォーム', 'サッカーユニフォーム', 'ラグビー・アメリカンフットボール', '陸上競技ウェア', '競パン', 'レスリング・シングレット'];
  standalone.forEach((name) => {
    const group = PUBLIC_INTEREST_GROUPS.find((g) => g.name === name);
    assert(group && group.categories.length === 1 && group.categories[0] === name, name + ' is displayed standalone');
  });
  const grouped = PUBLIC_INTEREST_GROUPS.filter((g) => g.name !== 'その他')
    .reduce((acc, g) => acc.concat(g.categories), []);
  const expected = sandbox.INTEREST_CATEGORY_OPTIONS.slice().sort();
  assert(JSON.stringify(grouped.slice().sort()) === JSON.stringify(expected),
    'PUBLIC_INTEREST_GROUPS (excluding その他) covers exactly all 22 INTEREST_CATEGORY_OPTIONS');
  assert(PUBLIC_INTEREST_GROUPS.length === 11, 'PUBLIC_INTEREST_GROUPS has 11 public categories, got ' + PUBLIC_INTEREST_GROUPS.length);
  assert(PUBLIC_INTEREST_GROUPS.find((g) => g.name === 'その他').categories.length === 0,
    'その他 bucket has no fixed categories (counted separately via free text)');
}

/* ── buildPublicSimpleBreakdown_：n<5除外・降順ソート・小数点1桁の割合 ── */
{
  const result = buildPublicSimpleBreakdown_([
    { name: 'A', count: 10 }, { name: 'B', count: 4 }, { name: 'C', count: 20 }
  ], 40);
  assert(result.length === 2, 'items with count < 5 are excluded, got length ' + result.length);
  assert(result[0].name === 'C' && result[1].name === 'A', 'items are sorted by count desc');
  assert(result[0].percent === 50 && result[1].percent === 25, 'percent is count/total*100 rounded to 1 decimal');
}
assert(buildPublicSimpleBreakdown_([{ name: 'A', count: 0 }], 40).length === 0, 'zero-count items are excluded (below n<5 threshold)');

/* ── buildPublicCategoryBreakdown_：まとめカテゴリの合算とその他自由記述の合算 ── */
{
  const tally = {};
  sandbox.INTEREST_CATEGORY_OPTIONS.forEach((c) => { tally[c] = 0; });
  tally['野球ユニフォーム'] = 12;
  tally['バスケットボールユニフォーム'] = 3;
  tally['ジャージ・トレーニングウェア'] = 4;
  tally['学校制服'] = 6;
  tally['スーツ'] = 7;
  tally['ヒーロー系'] = 5;
  const result = buildPublicCategoryBreakdown_(tally, 8, 100);
  const byName = {};
  result.forEach((item) => { byName[item.name] = item; });
  assert(byName['野球ユニフォーム'].count === 12, '野球ユニフォーム is shown standalone with its own count');
  assert(byName['その他スポーツ・ユニフォーム'].count === 7, 'その他スポーツ・ユニフォーム sums バスケ(3)+ジャージ(4)=7');
  assert(byName['制服・職業服'].count === 6, '制服・職業服 sums 学校制服(6)');
  assert(byName['スーツ'].count === 7, 'スーツ is its own bucket, separate from 制服・職業服');
  assert(byName['コスプレ・キャラクター'].count === 5, 'コスプレ・キャラクター sums ヒーロー系(5)');
  assert(byName['その他'].count === 8, 'その他 uses the free-text count passed in, not a category tally');
  assert(!byName['レスリング・シングレット'], '0-count standalone category is excluded (below n<5 threshold)');
}

/* ── buildPublicRegionBreakdown_：都道府県別回答数→全国7ブロックへの変換、三重県→近畿 ── */
{
  const counts = { '愛知県': 20, '東京都': 8, '三重県': 6, '大阪府': 3, '北海道': 0 };
  const result = buildPublicRegionBreakdown_(counts, 40);
  const byName = {};
  result.forEach((item) => { byName[item.name] = item; });
  assert(byName['中部'].count === 20, '中部 includes 愛知県(20)');
  assert(byName['関東'].count === 8, '関東 includes 東京都(8)');
  assert(byName['近畿'].count === 9, '近畿 includes 三重県(6)+大阪府(3)=9, confirming 三重県→近畿 mapping');
  assert(!byName['中国・四国'], '中国・四国 has no data here and is excluded (count 0 < 5)');
  assert(!byName['北海道'], '北海道 with count 0 is excluded (below n<5 threshold)');
}

/* ── buildPublicAgeBreakdown_：年代→簡略年代への変換 ── */
{
  const counts = { '18〜24歳': 6, '25〜29歳': 5, '30〜39歳': 9, '50〜59歳': 3, '60歳以上': 4 };
  const result = buildPublicAgeBreakdown_(counts, 40);
  const byName = {};
  result.forEach((item) => { byName[item.name] = item; });
  assert(byName['20代以下'].count === 11, '20代以下 sums 18〜24歳(6)+25〜29歳(5)=11');
  assert(byName['30代'].count === 9, '30代 sums 30〜39歳(9)');
  assert(byName['50代以上'].count === 7, '50代以上 sums 50〜59歳(3)+60歳以上(4)=7 (each alone would be <5)');
}

/* ── countOtherFreeTextEntries_：ヘッダ名ベース（列番号固定禁止）でその他自由記述を数える ── */
{
  const rows = [];
  rows[0] = new Array(sandbox.COLUMNS.length).fill('');
  const idx = sandbox.COLUMNS.indexOf('interest_categories');
  const r1 = new Array(sandbox.COLUMNS.length).fill('');
  r1[idx] = '野球ユニフォーム、その他:レザー系';
  const r2 = new Array(sandbox.COLUMNS.length).fill('');
  r2[idx] = 'その他:着ぐるみっぽいもの、その他:全身タイツ風';
  const r3 = new Array(sandbox.COLUMNS.length).fill('');
  r3[idx] = 'ヒーロー系';
  const sheetRows = [new Array(sandbox.COLUMNS.length).fill('header'), r1, r2, r3];
  const count = countOtherFreeTextEntries_(fakeSheetFromRows(sheetRows));
  assert(count === 3, 'countOtherFreeTextEntries_ counts every その他: item across rows (延べ件数), got ' + count);
}

/* ── readMultiTallyBlock_ / readQueryPairsBlock_：集計_*シートの固定レイアウトを読み取れる ── */
{
  const tallyRows = buildMultiTallyRows(sandbox.ENGAGEMENT_OPTIONS, { '自分で着たい': 15, '両方': 9 });
  const map = readMultiTallyBlock_(fakeSheetFromRows(tallyRows), 0, sandbox.ENGAGEMENT_OPTIONS);
  assert(map['自分で着たい'] === 15 && map['両方'] === 9 && map['交流のきっかけとして楽しみたい'] === 0,
    'readMultiTallyBlock_ reads the writeMultiTally_ layout correctly');
}
{
  const regionRows = buildRegionSheetRows([['愛知県', 12], ['東京都', 5]], [['18〜24歳', 7]]);
  const prefMap = readQueryPairsBlock_(fakeSheetFromRows(regionRows), 0, sandbox.PREFECTURES.length + 5);
  assert(prefMap['愛知県'] === 12 && prefMap['東京都'] === 5, 'readQueryPairsBlock_ reads block0 (prefecture QUERY output)');
  const ageMap = readQueryPairsBlock_(fakeSheetFromRows(regionRows), sandbox.PUBLIC_AGE_TALLY_BLOCK_INDEX, sandbox.AGE_OPTIONS.length + 5);
  assert(ageMap['18〜24歳'] === 7, 'readQueryPairsBlock_ reads the age tally block added for Issue #298');
}

/* ── buildPublicResultsPayload_：total<10で全グラフ非表示、非公開項目が含まれないこと ── */
{
  const responsesSheet = fakeSheetFromRows(new Array(9).fill([])); // ヘッダ行含め9行＝回答8件 < 10
  const payload = buildPublicResultsPayload_(responsesSheet, { getSheetByName: () => { throw new Error('must not be called when total < 10'); } });
  assert(payload.ready === false, 'ready=false when total < PUBLIC_MIN_TOTAL_FOR_CHARTS(10)');
  assert(payload.total === 8, 'total is still reported even when charts are hidden, got ' + payload.total);
  assert(payload.categories === undefined && payload.region === undefined && payload.age === undefined && payload.engagement === undefined,
    'no breakdown fields are present when charts are hidden');
}

/* ── buildPublicResultsPayload_：total>=10のときは各ブロックを組み立てて返し、非公開項目を含まない ── */
{
  const totalResponses = 20;
  const responsesRows = [new Array(sandbox.COLUMNS.length).fill('')];
  for (let i = 0; i < totalResponses; i++) responsesRows.push(new Array(sandbox.COLUMNS.length).fill(''));
  const interestIdx = sandbox.COLUMNS.indexOf('interest_categories');
  // n<5で除外されないことも確認するため、自由記述を5件（延べ件数）用意する。
  for (let i = 1; i <= 5; i++) responsesRows[i][interestIdx] = 'その他:テスト' + i;
  const responsesSheet = fakeSheetFromRows(responsesRows);

  const categoryTallyRows = buildMultiTallyRows(sandbox.INTEREST_CATEGORY_OPTIONS, { '野球ユニフォーム': 12 });
  const engagementTallyRows = buildMultiTallyRows(sandbox.ENGAGEMENT_OPTIONS, { '自分で着たい': 15 });
  const regionRows = buildRegionSheetRows([['愛知県', 12], ['東京都', 8]], [['18〜24歳', 11]]);

  const sheetsByName = {};
  sheetsByName[sandbox.SHEET_CLOTHING] = fakeSheetFromRows(categoryTallyRows);
  sheetsByName[sandbox.SHEET_ENGAGEMENT] = fakeSheetFromRows(engagementTallyRows);
  sheetsByName[sandbox.SHEET_REGION] = fakeSheetFromRows(regionRows);
  const aggregationSpreadsheet = { getSheetByName: (name) => sheetsByName[name] };

  const payload = buildPublicResultsPayload_(responsesSheet, aggregationSpreadsheet);
  assert(payload.ready === true, 'ready=true when total >= 10');
  assert(payload.total === totalResponses, 'total matches responses row count - 1(header)');
  assert(payload.categories.find((c) => c.name === '野球ユニフォーム').count === 12, 'categories block reflects aggregation sheet tally');
  assert(payload.categories.find((c) => c.name === 'その他').count === 5, 'categories block counts free-text entries from responses');
  assert(payload.engagement.find((e) => e.name === '自分で着たい').count === 15, 'engagement block reflects aggregation sheet tally');
  assert(payload.region.find((r) => r.name === '中部').count === 12, 'region block reflects prefecture tally mapped to national blocks');
  assert(payload.age.find((a) => a.name === '20代以下').count === 11, 'age block reflects age tally mapped to simplified groups');

  const json = JSON.stringify(payload);
  assert(json.indexOf('respondent_hash') === -1, 'payload does not leak the respondent_hash field name');
  assert(json.indexOf('uuid') === -1 && json.indexOf('UUID') === -1, 'payload does not leak UUID-related data');
  assert(json.indexOf('free_comment') === -1, 'payload does not leak free_comment content');
  assert(json.indexOf('テスト') === -1, 'payload does not leak the raw free-text content itself (count only)');
}

if (failures > 0) {
  console.error('\n' + failures + ' failure(s) in test_backend.js');
  process.exitCode = 1;
} else {
  console.log('\ntest_backend.js: all checks passed');
}
