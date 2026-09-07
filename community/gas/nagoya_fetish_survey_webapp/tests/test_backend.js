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

function baseValidAnswers(overrides) {
  return Object.assign({
    prefecture: '東京都',
    aichiArea: '',
    age: '18〜24歳',
    clothingInterests: ['野球ユニフォーム'],
    preferredFrequency: '月2回程度',
    preferredPrice: '2,000円以下',
    preferredGroupSize: '3〜4人',
    preferredFormat: ['わからない'],
    eventAwareness: '見たことがあり、実際に参加したことがある',
    barriers: ['該当しない'],
    helpfulInformation: [],
    preferredAtmosphere: 'わからない',
    hypotheticalIntent: '日程が合えば申し込む可能性が高い',
    surveyToSignupGap: 'ない',
    gapReasons: [],
    freeComment: ''
  }, overrides || {});
}

// ── 正常系 ──
assert(validateAnswers_(baseValidAnswers()) === null, 'valid baseline answers pass');

// ── prefecture / aichiArea ──
assert(validateAnswers_(baseValidAnswers({ prefecture: 'ワカンダ' })) === 'prefecture_invalid', 'invalid prefecture rejected');
assert(sandbox.AICHI_AREA_OPTIONS.indexOf('愛知県外') === -1, 'AICHI_AREA_OPTIONS does not contain 愛知県外');
assert(sandbox.AICHI_AREA_OPTIONS.length === 6, 'AICHI_AREA_OPTIONS has 6 options, got ' + sandbox.AICHI_AREA_OPTIONS.length);
assert(
  validateAnswers_(baseValidAnswers({ prefecture: '愛知県', aichiArea: '' })) === 'aichi_area_required',
  'aichi_area required when prefecture is 愛知県'
);
assert(
  validateAnswers_(baseValidAnswers({ prefecture: '愛知県', aichiArea: '愛知県外' })) === 'aichi_area_required',
  '愛知県外 is no longer a valid aichiArea value even when prefecture is 愛知県 (矛盾回答を防止)'
);
assert(
  validateAnswers_(baseValidAnswers({ prefecture: '愛知県', aichiArea: '名古屋市' })) === null,
  'aichi_area valid when prefecture is 愛知県 and area given'
);
assert(
  validateAnswers_(baseValidAnswers({ aichiArea: '名古屋市' })) === 'aichi_area_must_be_blank',
  'aichi_area must be blank when prefecture is not 愛知県'
);

// ── preferredAtmosphere（必須化） ──
assert(
  validateAnswers_(baseValidAnswers({ preferredAtmosphere: '' })) === 'preferred_atmosphere_invalid',
  'preferredAtmosphere empty string rejected (required)'
);
assert(
  validateAnswers_(baseValidAnswers({ preferredAtmosphere: '事前に雰囲気が明確ならどちらでもよい' })) === null,
  'preferredAtmosphere valid value accepted'
);
assert(sandbox.ATMOSPHERE_OPTIONS.length === 8, 'ATMOSPHERE_OPTIONS has 8 options, got ' + sandbox.ATMOSPHERE_OPTIONS.length);
// 「接触あり(同意前提)」と「接触なしで雰囲気だけ刺激的」が別項目として両立している（軸分離の確認）
assert(
  sandbox.ATMOSPHERE_OPTIONS.some((o) => o.indexOf('同意があれば') !== -1 && o.indexOf('接触') !== -1),
  'ATMOSPHERE_OPTIONS has a contact-with-consent option'
);
assert(
  sandbox.ATMOSPHERE_OPTIONS.some((o) => o.indexOf('接触はなくても') !== -1),
  'ATMOSPHERE_OPTIONS has an atmosphere-only (no contact) option'
);

// ── preferredFormat（必須化・「1対1」表現の排除） ──
assert(
  validateAnswers_(baseValidAnswers({ preferredFormat: [] })) === 'preferred_format_required',
  'preferredFormat empty array rejected (required)'
);
assert(
  validateAnswers_(baseValidAnswers({ preferredFormat: ['少人数の部屋で2人だけ'] })) === null,
  'preferredFormat 少人数の部屋で2人だけ accepted'
);
assert(
  sandbox.FORMAT_OPTIONS.indexOf('個室で1対1') === -1,
  'FORMAT_OPTIONS no longer contains 個室で1対1'
);
assert(
  sandbox.FORMAT_OPTIONS.every((o) => o.indexOf('1対1') === -1),
  'FORMAT_OPTIONS contains no "1対1" wording at all, got: ' + JSON.stringify(sandbox.FORMAT_OPTIONS)
);
assert(
  sandbox.GAP_REASON_OPTIONS.every((o) => o.indexOf('1対1') === -1),
  'GAP_REASON_OPTIONS contains no "1対1" wording either (wording consistency with FORMAT_OPTIONS), got: ' + JSON.stringify(sandbox.GAP_REASON_OPTIONS)
);

// ── barriers（重複統合の確認） ──
assert(
  sandbox.BARRIER_OPTIONS.indexOf('どんな人が来るか分からなかった') === -1,
  'BARRIER_OPTIONS no longer contains the duplicate どんな人が来るか分からなかった'
);
assert(
  sandbox.BARRIER_OPTIONS.indexOf('参加者の雰囲気やタイプが分からなかった') !== -1,
  'BARRIER_OPTIONS keeps 参加者の雰囲気やタイプが分からなかった'
);
assert(sandbox.BARRIER_OPTIONS.length === 23, 'BARRIER_OPTIONS has 23 options (24-1 merged), got ' + sandbox.BARRIER_OPTIONS.length);
assert(validateAnswers_(baseValidAnswers({ barriers: [] })) === 'barriers_required', 'barriers still required');
assert(
  validateAnswers_(baseValidAnswers({ barriers: ['自分の年齢や体型が、その場に合うか不安だった'] })) === null,
  'new barrier item accepted'
);

// ── helpfulInformation（重複統合の確認） ──
assert(
  sandbox.HELPFUL_INFO_OPTIONS.indexOf('初参加者がどの程度いるか') === -1,
  'HELPFUL_INFO_OPTIONS no longer contains the duplicate 初参加者がどの程度いるか'
);
assert(
  sandbox.HELPFUL_INFO_OPTIONS.indexOf('初参加者が何人いるか') !== -1,
  'HELPFUL_INFO_OPTIONS keeps 初参加者が何人いるか'
);
assert(sandbox.HELPFUL_INFO_OPTIONS.length === 21, 'HELPFUL_INFO_OPTIONS has 21 options (22-1 merged), got ' + sandbox.HELPFUL_INFO_OPTIONS.length);

// ── その他（自由記述）の検証 ──
assert(
  validateAnswers_(baseValidAnswers({ barriers: ['その他:'] })) === 'barriers_other_text_invalid',
  'barriers その他 with empty text rejected'
);
assert(
  validateAnswers_(baseValidAnswers({ barriers: ['その他:レザー系'] })) === null,
  'barriers その他 with text accepted'
);
assert(
  validateAnswers_(baseValidAnswers({ barriers: ['そんな理由はない'] })) === 'barriers_invalid_item',
  'barriers unknown item rejected'
);
assert(
  validateAnswers_(baseValidAnswers({ barriers: ['該当しない', '該当しない'] })) === 'barriers_duplicate_item',
  'barriers duplicate item rejected'
);

// ── 既存の必須・任意設定に回帰がないこと ──
assert(validateAnswers_(baseValidAnswers({ clothingInterests: [] })) === 'clothing_interests_required', 'clothingInterests still required');
assert(validateAnswers_(baseValidAnswers({ helpfulInformation: [] })) === null, 'helpfulInformation still optional');
assert(validateAnswers_(baseValidAnswers({ gapReasons: [] })) === null, 'gapReasons still optional');
assert(
  validateAnswers_(baseValidAnswers({ freeComment: 'a'.repeat(301) })) === 'free_comment_too_long',
  'freeComment too long rejected'
);
assert(validateAnswers_(null) === 'payload_invalid', 'null payload rejected');

// ── buildRowValues_（数式インジェクション対策・列数） ──
const row = buildRowValues_('dummyhash', baseValidAnswers({
  prefecture: '愛知県',
  aichiArea: '名古屋市',
  freeComment: '=SUM(A1:A10)'
}));
assert(row.length === sandbox.COLUMNS.length, 'buildRowValues_ returns COLUMNS.length items, got ' + row.length);
assert(row[row.length - 1] === "'=SUM(A1:A10)", 'formula-injection prefix applied to free_comment: ' + row[row.length - 1]);
assert(row[sandbox.COLUMNS.indexOf('preferred_atmosphere')] === 'わからない', 'preferred_atmosphere stored correctly in row');

if (failures > 0) {
  console.error('\n' + failures + ' failure(s) in test_backend.js');
  process.exitCode = 1;
} else {
  console.log('\ntest_backend.js: all checks passed');
}
