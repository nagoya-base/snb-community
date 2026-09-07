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

if (failures > 0) {
  console.error('\n' + failures + ' failure(s) in test_backend.js');
  process.exitCode = 1;
} else {
  console.log('\ntest_backend.js: all checks passed');
}
