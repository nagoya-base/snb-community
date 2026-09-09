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
assert(
  validateAnswers_(baseNoGateAnswers({ engagementPreferences: ['両方'] })) === 'engagement_preferences_invalid_item',
  '「両方」は複数回答設問のため冗長として削除済みで、新規回答では拒否される（PR #299）'
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
assert(sandbox.SUIT_ENGAGEMENT_OPTIONS.length === 4, 'SUIT_ENGAGEMENT_OPTIONS has 4 options (「両方」removed as redundant for a multi-select question, PR #299)');
assert(sandbox.SUIT_ENGAGEMENT_OPTIONS.indexOf('両方') === -1, 'SUIT_ENGAGEMENT_OPTIONS does not offer 両方 (redundant with checking both individual options)');
assert(sandbox.ENGAGEMENT_OPTIONS.length === 5, 'ENGAGEMENT_OPTIONS has 5 options (「両方」removed as redundant for a multi-select question, PR #299)');
assert(sandbox.ENGAGEMENT_OPTIONS.indexOf('両方') === -1, 'ENGAGEMENT_OPTIONS does not offer 両方 (redundant with checking both individual options)');
assert(sandbox.SUIT_TYPES_OPTIONS.length === 8, 'SUIT_TYPES_OPTIONS has 8 options');
assert(sandbox.SUIT_STATES_OPTIONS.length === 6, 'SUIT_STATES_OPTIONS has 6 options');
assert(
  validateAnswers_(baseNoGateAnswers({
    interestCategories: ['スーツ'], suitEngagementPreferences: ['両方'],
    suitTypes: ['ビジネススーツ'], suitStates: ['ジャケットを着たまま'], suitEventInterest: 'いいえ',
    surveyPath: 'suit_only', completionStage: 'suit_interest'
  })) === 'suit_engagement_preferences_invalid_item',
  '「両方」は削除済みで、suitEngagementPreferencesでも新規回答では拒否される（PR #299）'
);
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
// 指定したblockIndexの位置（BLOCK_ROW_STEP間隔）に配置する（rowsは呼び出し側の配列を書き換えて返す）。
function placeQueryPairsBlock(rows, blockIndex, headerLabel, pairs) {
  const step = sandbox.BLOCK_ROW_STEP;
  const titleRow0 = blockIndex * step; // 0始まりindex（1+blockIndex*step の1行目がindex blockIndex*step）
  rows[titleRow0] = 'タイトル行';
  rows[titleRow0 + 1] = [headerLabel, '回答数'];
  pairs.forEach((pair, i) => { rows[titleRow0 + 2 + i] = [pair[0], pair[1]]; });
  return rows;
}

/**
 * 集計_地域シート全体を模した行配列を作る。
 * - allTimePrefecturePairs：ブロック0（都道府県別回答数・Issue #293以前からの全期間集計。
 *   公開結果はここを読まない）。
 * - publicPrefecturePairs：PUBLIC_PREFECTURE_TALLY_BLOCK_INDEX（公開結果用・
 *   completion_stage<>''で絞り込み済みの都道府県別回答数）。
 * - agePairs：PUBLIC_AGE_TALLY_BLOCK_INDEX（公開結果用の年代別回答数）。
 */
function buildRegionSheetRows({ allTimePrefecturePairs, publicPrefecturePairs, agePairs } = {}) {
  let rows = [];
  if (allTimePrefecturePairs) rows = placeQueryPairsBlock(rows, 0, 'prefecture', allTimePrefecturePairs);
  if (publicPrefecturePairs) rows = placeQueryPairsBlock(rows, sandbox.PUBLIC_PREFECTURE_TALLY_BLOCK_INDEX, 'prefecture', publicPrefecturePairs);
  if (agePairs) rows = placeQueryPairsBlock(rows, sandbox.PUBLIC_AGE_TALLY_BLOCK_INDEX, 'age', agePairs);
  for (let i = 0; i < rows.length; i++) if (rows[i] === undefined) rows[i] = [];
  return rows;
}

/**
 * COLUMNSの並びに従った1回答分の行（配列）を、ヘッダ名指定のoverridesから作る
 * （列番号を書き手が意識しなくてよいようにするテスト用ヘルパー）。
 */
function makeColumnsRow(overrides) {
  const row = new Array(sandbox.COLUMNS.length).fill('');
  Object.keys(overrides || {}).forEach((key) => {
    const idx = sandbox.COLUMNS.indexOf(key);
    if (idx === -1) throw new Error('test helper: unknown COLUMNS header "' + key + '"');
    row[idx] = overrides[key];
  });
  return row;
}

/**
 * responsesシートを模した行配列を作る。legacyRows（completion_stageを持たない#292以前の
 * 旧回答。値はそのまま行として使う）とnewRows（completion_stageを明示指定するIssue #293以降の
 * 新回答のoverrides）を混在させる。
 */
function buildResponsesRows(legacyRows, newRowOverridesList) {
  const rows = [new Array(sandbox.COLUMNS.length).fill('header')];
  legacyRows.forEach((overrides) => rows.push(makeColumnsRow(overrides)));
  newRowOverridesList.forEach((overrides) => {
    if (!overrides.completion_stage) throw new Error('test helper: newRow must set completion_stage (defines the new-survey population)');
    rows.push(makeColumnsRow(overrides));
  });
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
  const sheetRows = buildResponsesRows(
    // 旧#292回答：completion_stageを持たない。仮にinterest_categoriesに値が紛れ込んでいても
    // （実運用では起こらないが）新回答の母集団には含めない、という頑健性を確認する。
    [{ interest_categories: 'その他:旧回答に紛れ込んだ値' }],
    [
      { completion_stage: 'no_gate_reached', interest_categories: '野球ユニフォーム、その他:レザー系' },
      { completion_stage: 'no_gate_reached', interest_categories: 'その他:着ぐるみっぽいもの、その他:全身タイツ風' },
      { completion_stage: 'no_gate_reached', interest_categories: 'ヒーロー系' }
    ]
  );
  const count = countOtherFreeTextEntries_(fakeSheetFromRows(sheetRows));
  assert(count === 3, 'countOtherFreeTextEntries_ counts その他: items only within completion_stage<>\'\' rows (延べ件数), got ' + count);
}

/* ── readMultiTallyBlock_ / readQueryPairsBlock_：集計_*シートの固定レイアウトを読み取れる ── */
{
  const tallyRows = buildMultiTallyRows(sandbox.ENGAGEMENT_OPTIONS, { '自分で着たい': 15, '人が着ているのを見たい': 9 });
  const map = readMultiTallyBlock_(fakeSheetFromRows(tallyRows), 0, sandbox.ENGAGEMENT_OPTIONS);
  assert(map['自分で着たい'] === 15 && map['人が着ているのを見たい'] === 9 && map['交流のきっかけとして楽しみたい'] === 0,
    'readMultiTallyBlock_ reads the writeMultiTally_ layout correctly');
}
{
  const regionRows = buildRegionSheetRows({
    allTimePrefecturePairs: [['愛知県', 12], ['東京都', 5]],
    agePairs: [['18〜24歳', 7]]
  });
  const prefMap = readQueryPairsBlock_(fakeSheetFromRows(regionRows), 0, sandbox.PREFECTURES.length + 5);
  assert(prefMap['愛知県'] === 12 && prefMap['東京都'] === 5, 'readQueryPairsBlock_ reads block0 (all-time prefecture QUERY output)');
  const ageMap = readQueryPairsBlock_(fakeSheetFromRows(regionRows), sandbox.PUBLIC_AGE_TALLY_BLOCK_INDEX, sandbox.AGE_OPTIONS.length + 5);
  assert(ageMap['18〜24歳'] === 7, 'readQueryPairsBlock_ reads the age tally block added for Issue #298');
}

/* ══════════════════════════════════════════════════════════════
 * レビュー指摘（PR #299）対応：公開結果の母集団は「responses全行」ではなく
 * completion_stageが空でない行（Issue #293以降の新アンケート回答）に限定すること
 * ══════════════════════════════════════════════════════════════ */

/* ── buildAggregationSheets：公開結果用の年代・都道府県ブロックのQUERYが
   completion_stage<>''で絞り込まれていること（数式文字列を直接検証する）。 ── */
{
  // writeTitledFormula_(s, PUBLIC_AGE_TALLY_BLOCK_INDEX, ...) 呼び出し以降、直近の
  // WINDOW文字だけを見て、そのQUERY文にcompletion_stage<>''条件が含まれるかを確認する
  // （呼び出し全体をパースするのではなく、十分広い窓で文字列検索する簡便な静的チェック）。
  const WINDOW = 500;
  const extractCallWindow = (marker) => {
    const markerIndex = code.indexOf('writeTitledFormula_(s, ' + marker);
    assert(markerIndex !== -1, marker + ' is used in a writeTitledFormula_ call in buildAggregationSheets()');
    return code.slice(markerIndex, markerIndex + WINDOW);
  };

  const ageBlockCall = extractCallWindow('PUBLIC_AGE_TALLY_BLOCK_INDEX');
  assert(/completion_stage\s*\+\s*" <> ''/.test(ageBlockCall),
    'the public age tally block QUERY (集計_地域) filters by completion_stage <> \'\' to exclude legacy #292 responses');

  const prefBlockCall = extractCallWindow('PUBLIC_PREFECTURE_TALLY_BLOCK_INDEX');
  assert(/completion_stage\s*\+\s*" <> ''/.test(prefBlockCall),
    'the public prefecture tally block QUERY (集計_地域) filters by completion_stage <> \'\' to exclude legacy #292 responses');
}

/* ── buildPublicResultsPayload_：旧回答20件＋新回答9件 → public total = 9、グラフ非表示 ── */
{
  const legacyRows = [];
  for (let i = 0; i < 20; i++) legacyRows.push({ prefecture: '愛知県', age: '30〜39歳' });
  const newRows = [];
  for (let i = 0; i < 9; i++) newRows.push({ completion_stage: 'no_gate_reached', prefecture: '東京都', age: '18〜24歳' });
  const responsesSheet = fakeSheetFromRows(buildResponsesRows(legacyRows, newRows));

  const payload = buildPublicResultsPayload_(responsesSheet, { getSheetByName: () => { throw new Error('must not be called when total < 10'); } });
  assert(payload.total === 9, '旧回答20件+新回答9件 のとき total は新回答数の9件のみ（旧回答混入なし）, got ' + payload.total);
  assert(payload.ready === false, '新回答9件 < PUBLIC_MIN_TOTAL_FOR_CHARTS(10) のためready=false（旧回答を含めた29件では判定しない）');
}

/* ── buildPublicResultsPayload_：旧回答20件＋新回答10件 → public total = 10、グラフ表示 ── */
{
  const legacyRows = [];
  for (let i = 0; i < 20; i++) legacyRows.push({ prefecture: '愛知県', age: '30〜39歳' });
  const newRows = [];
  for (let i = 0; i < 10; i++) newRows.push({ completion_stage: 'no_gate_reached', prefecture: '東京都', age: '18〜24歳' });
  const responsesSheet = fakeSheetFromRows(buildResponsesRows(legacyRows, newRows));

  const sheetsByName = {};
  sheetsByName[sandbox.SHEET_CLOTHING] = fakeSheetFromRows(buildMultiTallyRows(sandbox.INTEREST_CATEGORY_OPTIONS, {}));
  sheetsByName[sandbox.SHEET_ENGAGEMENT] = fakeSheetFromRows(buildMultiTallyRows(sandbox.ENGAGEMENT_OPTIONS, {}));
  sheetsByName[sandbox.SHEET_REGION] = fakeSheetFromRows(buildRegionSheetRows({ publicPrefecturePairs: [['東京都', 10]], agePairs: [['18〜24歳', 10]] }));
  const aggregationSpreadsheet = { getSheetByName: (name) => sheetsByName[name] };

  const payload = buildPublicResultsPayload_(responsesSheet, aggregationSpreadsheet);
  assert(payload.total === 10, '旧回答20件+新回答10件 のとき total は新回答数の10件のみ, got ' + payload.total);
  assert(payload.ready === true, '新回答10件 >= PUBLIC_MIN_TOTAL_FOR_CHARTS(10) のためready=true（旧回答を含めた30件が閾値を満たしたからではない）');
}

/* ── buildPublicResultsPayload_：旧回答に都道府県・年代があっても公開の地域/年代には混入しない ── */
{
  const legacyRows = [];
  // 旧回答にも都道府県・年代の値自体は入っている（PR #292時点から存在する列のため）。
  for (let i = 0; i < 20; i++) legacyRows.push({ prefecture: '愛知県', age: '30〜39歳' });
  const newRows = [];
  for (let i = 0; i < 10; i++) newRows.push({ completion_stage: 'no_gate_reached', prefecture: '東京都', age: '18〜24歳' });
  const responsesSheet = fakeSheetFromRows(buildResponsesRows(legacyRows, newRows));

  const sheetsByName = {};
  sheetsByName[sandbox.SHEET_CLOTHING] = fakeSheetFromRows(buildMultiTallyRows(sandbox.INTEREST_CATEGORY_OPTIONS, {}));
  sheetsByName[sandbox.SHEET_ENGAGEMENT] = fakeSheetFromRows(buildMultiTallyRows(sandbox.ENGAGEMENT_OPTIONS, {}));
  // ブロック0（全期間・未フィルタ）には旧回答込みの愛知県30件を置き、公開用ブロックには
  // 新回答だけの東京都10件を置く。payloadがブロック0側の値を拾ってしまえば「混入」を検出できる。
  sheetsByName[sandbox.SHEET_REGION] = fakeSheetFromRows(buildRegionSheetRows({
    allTimePrefecturePairs: [['愛知県', 30]],
    publicPrefecturePairs: [['東京都', 10]],
    agePairs: [['18〜24歳', 10]]
  }));
  const aggregationSpreadsheet = { getSheetByName: (name) => sheetsByName[name] };

  const payload = buildPublicResultsPayload_(responsesSheet, aggregationSpreadsheet);
  assert(!payload.region.find((r) => r.name === '中部'), '公開結果の地域に、旧回答混入込みの全期間ブロック（愛知県30件→中部）の値が出ない');
  assert(payload.region.find((r) => r.name === '関東').count === 10, '公開結果の地域は、completion_stageで絞り込んだ公開専用ブロック（東京都10件→関東）の値のみを使う');
  assert(payload.age.find((a) => a.name === '20代以下').count === 10, '公開結果の年代も新回答（18〜24歳10件→20代以下）のみを反映する');
}

/* ── buildPublicResultsPayload_：新回答8/10が野球ユニフォーム → 80.0% ── */
{
  const legacyRows = [];
  for (let i = 0; i < 20; i++) legacyRows.push({ prefecture: '愛知県', age: '30〜39歳' });
  const newRows = [];
  for (let i = 0; i < 10; i++) newRows.push({ completion_stage: 'no_gate_reached' });
  const responsesSheet = fakeSheetFromRows(buildResponsesRows(legacyRows, newRows));

  const sheetsByName = {};
  // 集計_衣装カテゴリはinterest_categoriesが空欄の旧回答をSEARCH不一致で自然に除外するため、
  // 新回答10件のうち8件が野球ユニフォームだった場合の値をそのまま置ける。
  sheetsByName[sandbox.SHEET_CLOTHING] = fakeSheetFromRows(buildMultiTallyRows(sandbox.INTEREST_CATEGORY_OPTIONS, { '野球ユニフォーム': 8 }));
  sheetsByName[sandbox.SHEET_ENGAGEMENT] = fakeSheetFromRows(buildMultiTallyRows(sandbox.ENGAGEMENT_OPTIONS, {}));
  sheetsByName[sandbox.SHEET_REGION] = fakeSheetFromRows(buildRegionSheetRows({ publicPrefecturePairs: [], agePairs: [] }));
  const aggregationSpreadsheet = { getSheetByName: (name) => sheetsByName[name] };

  const payload = buildPublicResultsPayload_(responsesSheet, aggregationSpreadsheet);
  assert(payload.total === 10, 'total is the new-survey count (10), not 30 (20 legacy + 10 new)');
  const baseball = payload.categories.find((c) => c.name === '野球ユニフォーム');
  assert(!!baseball && baseball.count === 8, '野球ユニフォーム count is 8 (from the new-survey-only aggregation sheet tally)');
  assert(baseball.percent === 80, '野球ユニフォーム percent is 8/10*100 = 80.0%, not 8/30 (mixed with legacy responses), got ' + baseball.percent);
}

/* ── buildPublicResultsPayload_：total>=10のときは各ブロックを組み立てて返し、非公開項目を含まない ── */
{
  const newRows = [];
  for (let i = 0; i < 20; i++) newRows.push({ completion_stage: 'no_gate_reached' });
  // n<5で除外されないことも確認するため、自由記述を5件（延べ件数）用意する。
  for (let i = 0; i < 5; i++) newRows[i].interest_categories = 'その他:テスト' + i;
  const responsesSheet = fakeSheetFromRows(buildResponsesRows([], newRows));
  const totalResponses = 20;

  const categoryTallyRows = buildMultiTallyRows(sandbox.INTEREST_CATEGORY_OPTIONS, { '野球ユニフォーム': 12 });
  const engagementTallyRows = buildMultiTallyRows(sandbox.ENGAGEMENT_OPTIONS, { '自分で着たい': 15 });
  const regionRows = buildRegionSheetRows({ publicPrefecturePairs: [['愛知県', 12], ['東京都', 8]], agePairs: [['18〜24歳', 11]] });

  const sheetsByName = {};
  sheetsByName[sandbox.SHEET_CLOTHING] = fakeSheetFromRows(categoryTallyRows);
  sheetsByName[sandbox.SHEET_ENGAGEMENT] = fakeSheetFromRows(engagementTallyRows);
  sheetsByName[sandbox.SHEET_REGION] = fakeSheetFromRows(regionRows);
  const aggregationSpreadsheet = { getSheetByName: (name) => sheetsByName[name] };

  const payload = buildPublicResultsPayload_(responsesSheet, aggregationSpreadsheet);
  assert(payload.ready === true, 'ready=true when total >= 10');
  assert(payload.total === totalResponses, 'total matches the number of new-survey (completion_stage<>\'\') rows');
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

/* ══════════════════════════════════════════════════════════════
 * レビュー指摘（PR #299 再レビュー）対応：submitSurvey()が`sheet.appendRow()`を使わないこと、
 * 居住地4分類補助列のARRAYFORMULAスピルによる「1001行目ジャンプ」を起こさないこと
 * ══════════════════════════════════════════════════════════════ */

const findNextResponseRow_ = sandbox.findNextResponseRow_;
const appendResponseRow_ = sandbox.appendResponseRow_;

assert(typeof findNextResponseRow_ === 'function', 'findNextResponseRow_ exists');
assert(typeof appendResponseRow_ === 'function', 'appendResponseRow_ exists');
assert(code.indexOf('.appendRow(') === -1,
  'Code.gs does not call appendRow() anywhere (replaced by appendResponseRow_ + setValues, which is immune to the ARRAYFORMULA-spill row-jump bug)');

/**
 * timestamp列（COLUMNSの1列目。回答保存時にのみ値が入り、ARRAYFORMULA等の数式は
 * 一切書き込まれない列）だけを読めるシートのフェイク。getMaxRows()を実データの有無とは
 * 独立に指定できるようにして、「居住地4分類補助列のARRAYFORMULAが物理的な行数を
 * 押し上げている」状況（実データは数行だけなのにgetMaxRows()は1000、等）を再現する。
 */
function makeTimestampColumnSheet(timestampCellsByRow, maxRows) {
  const timestampColumnIndex = sandbox.COLUMNS.indexOf('timestamp') + 1;
  return {
    getMaxRows: () => maxRows,
    getRange: (row, col, numRows, numCols) => {
      if (col !== timestampColumnIndex || numCols !== 1) {
        throw new Error('test mock only supports reading a single timestamp-column range, got col=' + col + ' numCols=' + numCols);
      }
      const values = [];
      for (let r = 0; r < numRows; r++) {
        const cell = timestampCellsByRow[row + r];
        values.push([cell === undefined ? '' : cell]);
      }
      return { getValues: () => values };
    }
  };
}

/* ① 居住地4分類補助列が1000行までARRAYFORMULAでスピルしていても、最初の回答は2行目に保存される */
{
  const sheet = makeTimestampColumnSheet({}, 1000);
  assert(findNextResponseRow_(sheet) === 2,
    '補助列のARRAYFORMULAスピルでgetMaxRows()が1000でも、実データが無ければ最初の保存行は2行目（1001行目ではない）');
}

/* ② 2〜5行目に実際の回答（timestamp）があるとき、次の保存行は6行目 */
{
  const sheet = makeTimestampColumnSheet({
    2: new Date('2026-01-01T00:00:00Z'),
    3: new Date('2026-01-01T00:01:00Z'),
    4: new Date('2026-01-01T00:02:00Z'),
    5: new Date('2026-01-01T00:03:00Z')
  }, 1000);
  assert(findNextResponseRow_(sheet) === 6, '2〜5行目に回答が4件あるとき、次の保存行は6行目');
}

/* ③ 実データは2〜3行目だけでも、補助列のスピルでgetMaxRows()がずっと下（1000）まで伸びていた場合、
   保存位置はそのスピル範囲の末尾側へは飛ばず、実データのすぐ次の行になる */
{
  const sheet = makeTimestampColumnSheet({
    2: new Date('2026-01-01T00:00:00Z'),
    3: new Date('2026-01-01T00:01:00Z')
  }, 1000);
  const nextRow = findNextResponseRow_(sheet);
  assert(nextRow === 4,
    '実データが2〜3行目だけなら、補助列のスピルでgetMaxRows()=1000でも保存位置は4行目のまま（1001行目等へ飛ばない）, got ' + nextRow);
}

/* appendResponseRow_：見つけた行にsetValues()で直接書き込み、appendRow()は一切使わない */
{
  let capturedWrite = null;
  const sheet = {
    getMaxRows: () => 1000,
    getRange: (row, col, numRows, numCols) => {
      if (numCols === 1) {
        // findNextResponseRow_内部からのtimestamp列読み取り呼び出し（実データ無し＝空）。
        const values = [];
        for (let r = 0; r < numRows; r++) values.push(['']);
        return { getValues: () => values };
      }
      // 回答行全体の書き込み呼び出し。
      capturedWrite = { row, col, numRows, numCols };
      return { setValues: (v) => { capturedWrite.values = v; } };
    }
  };

  appendResponseRow_(sheet, 'dummyhash', baseNoGateAnswers());

  assert(!!capturedWrite && capturedWrite.row === 2 && capturedWrite.col === 1 && capturedWrite.numRows === 1,
    'appendResponseRow_ writes the response to row 2 (first response) starting at column 1, via setValues (not appendRow)');
  assert(Array.isArray(capturedWrite.values) && capturedWrite.values[0].length === sandbox.COLUMNS.length,
    'appendResponseRow_ writes a full COLUMNS.length-wide row');
}

if (failures > 0) {
  console.error('\n' + failures + ' failure(s) in test_backend.js');
  process.exitCode = 1;
} else {
  console.log('\ntest_backend.js: all checks passed');
}
