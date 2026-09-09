'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CODE_PATH = path.join(__dirname, '..', 'Code.gs');
const code = fs.readFileSync(CODE_PATH, 'utf8');

// GAS固有オブジェクトは、このテストで実際に呼ばれる純粋関数（tallySingle_ / tallyMulti_ /
// buildAdminDashboardPayload_ 等、rows配列だけを引数に取るもの）の中では参照されないため、
// 存在だけダミーで用意しておけば十分。
const sandbox = {
  console,
  PropertiesService: {},
  SpreadsheetApp: {},
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

const tallySingle_ = sandbox.tallySingle_;
const tallyMulti_ = sandbox.tallyMulti_;
const crosstabSingleVsSingle_ = sandbox.crosstabSingleVsSingle_;
const crosstabMultiVsSingle_ = sandbox.crosstabMultiVsSingle_;
const buildBasicSection_ = sandbox.buildBasicSection_;
const buildRegionSection_ = sandbox.buildRegionSection_;
const buildAgeSection_ = sandbox.buildAgeSection_;
const buildCostumeSection_ = sandbox.buildCostumeSection_;
const buildSnbcSection_ = sandbox.buildSnbcSection_;
const buildSuitSection_ = sandbox.buildSuitSection_;
const buildDeepDiveSection_ = sandbox.buildDeepDiveSection_;
const buildBranchingSection_ = sandbox.buildBranchingSection_;
const buildHighlightsSection_ = sandbox.buildHighlightsSection_;
const buildAdminDashboardPayload_ = sandbox.buildAdminDashboardPayload_;
const readResponseRows_ = sandbox.readResponseRows_;
const regionBlockForPrefecture_ = sandbox.regionBlockForPrefecture_;

function findByName(items, name) {
  return items.find((item) => item.name === name);
}

/* ══════════════════════════════════════════════════════════════
 * readResponseRows_：列番号ではなくヘッダ名ベースで読み取ること
 * ══════════════════════════════════════════════════════════════ */
{
  // COLUMNSの並びをわざと入れ替えたシート（列がずれても壊れないことを確認する）。
  const shuffledHeader = ['prefecture', 'age', 'timestamp', 'interest_categories'];
  const fakeSheet = {
    getLastRow: () => 3,
    getLastColumn: () => shuffledHeader.length,
    getRange: (row, col, numRows, numCols) => {
      if (row === 1) {
        return { getValues: () => [shuffledHeader.slice(col - 1, col - 1 + (numCols || shuffledHeader.length))] };
      }
      const data = [
        ['愛知県', '18〜24歳', new Date('2026-01-01T00:00:00Z'), '野球ユニフォーム'],
        ['東京都', '30〜39歳', new Date('2026-01-02T00:00:00Z'), 'ヒーロー系']
      ];
      return { getValues: () => data.slice(row - 2, row - 2 + numRows) };
    }
  };
  const rows = readResponseRows_(fakeSheet);
  assert(rows.length === 2, 'readResponseRows_ returns one object per data row, got ' + rows.length);
  assert(rows[0].prefecture === '愛知県' && rows[0].age === '18〜24歳',
    'readResponseRows_ maps values by header name even when column order differs from COLUMNS');
  assert(rows[1].interest_categories === 'ヒーロー系', 'readResponseRows_ correctly maps a later column by header name');
}

/* ══════════════════════════════════════════════════════════════
 * tallySingle_ / tallyMulti_
 * ══════════════════════════════════════════════════════════════ */
{
  const rows = [{ age: '18〜24歳' }, { age: '18〜24歳' }, { age: '' }, { age: 'ワカンダ歳' }, {}];
  const result = tallySingle_(rows, 'age', sandbox.AGE_OPTIONS);
  assert(findByName(result, '18〜24歳').count === 2, 'tallySingle_ counts matching values');
  assert(result.length === sandbox.AGE_OPTIONS.length, 'tallySingle_ includes all defined options even at 0 count');
  assert(findByName(result, '回答しない').count === 0, 'tallySingle_ keeps unused options at 0 (blank/unknown values ignored)');
}
{
  const rows = [
    { interest_categories: '野球ユニフォーム、その他:レザー系' },
    { interest_categories: '野球ユニフォーム、ヒーロー系' },
    { interest_categories: '' },
    { interest_categories: 'その他:別の記述' }
  ];
  const result = tallyMulti_(rows, 'interest_categories', sandbox.INTEREST_CATEGORY_OPTIONS);
  assert(findByName(result, '野球ユニフォーム').count === 2, 'tallyMulti_ counts 延べ件数 across multi-select cells');
  assert(findByName(result, sandbox.OTHER_FREE_TEXT_LABEL || 'その他（自由記述）').count === 2,
    'tallyMulti_ buckets all free-text その他 entries under one label instead of per-content');
}

/* ══════════════════════════════════════════════════════════════
 * crosstabSingleVsSingle_ / crosstabMultiVsSingle_
 * ══════════════════════════════════════════════════════════════ */
{
  const rows = [
    { prefecture: '愛知県', snbc_interest: 'はい' },
    { prefecture: '愛知県', snbc_interest: 'いいえ' },
    { prefecture: '東京都', snbc_interest: 'はい' },
    { prefecture: '大阪府', snbc_interest: '' } // 空欄は集計対象外
  ];
  const crosstab = crosstabSingleVsSingle_(rows, 'prefecture', ['愛知県', '東京都', '大阪府'], 'snbc_interest', sandbox.SNBC_INTEREST_OPTIONS);
  const aichiRowIndex = crosstab.rowLabels.indexOf('愛知県');
  const yesColIndex = crosstab.colLabels.indexOf('はい');
  assert(crosstab.matrix[aichiRowIndex][yesColIndex] === 1, 'crosstabSingleVsSingle_ counts matching row/col pairs');
  const osakaRowIndex = crosstab.rowLabels.indexOf('大阪府');
  assert(crosstab.matrix[osakaRowIndex].every((v) => v === 0), 'crosstabSingleVsSingle_ ignores rows with a blank column value');
}
{
  const rows = [
    { barriers: '日程が合わなかった、料金が高いと感じた', hypothetical_intent: '参加しない' },
    { barriers: '日程が合わなかった', hypothetical_intent: 'わからない' }
  ];
  const crosstab = crosstabMultiVsSingle_(rows, 'barriers', ['日程が合わなかった', '料金が高いと感じた'], 'hypothetical_intent', ['参加しない', 'わからない']);
  const scheduleRow = crosstab.rowLabels.indexOf('日程が合わなかった');
  assert(crosstab.matrix[scheduleRow][0] === 1 && crosstab.matrix[scheduleRow][1] === 1,
    'crosstabMultiVsSingle_ counts each row once per matching multi-select item');
}

/* ══════════════════════════════════════════════════════════════
 * 各セクションのビルダー関数
 * ══════════════════════════════════════════════════════════════ */
function makeRow(overrides) {
  const base = {};
  sandbox.COLUMNS.forEach((c) => { base[c] = ''; });
  return Object.assign(base, overrides);
}

{
  const rows = [
    makeRow({ timestamp: new Date('2026-01-01T10:00:00Z') }),
    makeRow({ timestamp: new Date('2026-01-01T11:00:00Z') }),
    makeRow({ timestamp: new Date('2026-01-02T09:00:00Z') })
  ];
  const basic = buildBasicSection_(rows);
  assert(basic.total === 3, 'buildBasicSection_ total counts all rows');
  assert(basic.dailyCounts.length === 2, 'buildBasicSection_ groups by date, got ' + basic.dailyCounts.length + ' days');
  assert(basic.lastResponseAt === new Date('2026-01-02T09:00:00Z').toISOString(), 'buildBasicSection_ reports the latest timestamp');
}

{
  const rows = [
    makeRow({ prefecture: '愛知県', aichi_area: '名古屋市' }),
    makeRow({ prefecture: '三重県' }),
    makeRow({ prefecture: '大阪府' })
  ];
  const region = buildRegionSection_(rows);
  assert(findByName(region.nationalBlocks, '近畿').count === 2, '近畿 national block sums 三重県+大阪府, confirming 三重県→近畿 mapping in the admin project too');
  assert(findByName(region.aichiArea, '名古屋市').count === 1, 'aichiArea tally reflects rows with a non-blank aichi_area');
}

{
  const rows = [
    makeRow({ age: '18〜24歳' }),
    makeRow({ age: '25〜29歳' }),
    makeRow({ age: '60歳以上' })
  ];
  const age = buildAgeSection_(rows);
  assert(findByName(age.simplified, '20代以下').count === 2, 'age simplified group sums 18〜24歳+25〜29歳');
  assert(findByName(age.simplified, '50代以上').count === 1, 'age simplified group sums 60歳以上 alone');
}

{
  const rows = [
    makeRow({ interest_categories: '野球ユニフォーム、スーツ', engagement_preferences: '自分で着たい' }),
    makeRow({ primary_interest_category: '野球ユニフォーム' })
  ];
  const costume = buildCostumeSection_(rows);
  assert(findByName(costume.interestCategories, '野球ユニフォーム').count === 1, 'costume.interestCategories tallies interest_categories');
  assert(findByName(costume.primaryInterestCategory, '野球ユニフォーム').count === 1, 'costume.primaryInterestCategory tallies primary_interest_category');
  assert(findByName(costume.engagementPreferences, '自分で着たい').count === 1, 'costume.engagementPreferences tallies engagement_preferences');
}

{
  const rows = [
    makeRow({ interest_categories: '野球ユニフォーム', snbc_awareness: '知っている', snbc_interest: 'はい', completion_stage: 'snbc_deep_dive' }),
    makeRow({ interest_categories: '野球ユニフォーム', snbc_awareness: '知らなかった', snbc_interest: 'いいえ', completion_stage: 'snbc_not_interested' }),
    makeRow({ interest_categories: 'ヒーロー系' }) // ゲート非該当
  ];
  const snbc = buildSnbcSection_(rows);
  assert(snbc.uniformGateReachedCount === 2, 'uniformGateReachedCount counts rows whose interest_categories triggers the uniform gate');
  assert(snbc.deepDiveCompletedCount === 1, 'deepDiveCompletedCount counts completion_stage=snbc_deep_dive rows');
  assert(snbc.awarenessToInterestRate === 0.5, 'awarenessToInterestRate = interestYes / uniformGateReached = 1/2');
}

{
  const rows = [makeRow({ suit_event_interest: 'はい' }), makeRow({ suit_event_interest: '' })];
  const suit = buildSuitSection_(rows);
  assert(findByName(suit.eventInterest, 'はい').count === 1, 'suit.eventInterest tallies suit_event_interest, ignoring blanks');
}

{
  const rows = [makeRow({ preferred_price: '2,000円以下' }), makeRow({ barriers: '日程が合わなかった、該当しない' })];
  const deepDive = buildDeepDiveSection_(rows);
  assert(findByName(deepDive.price, '2,000円以下').count === 1, 'deepDive.price tallies preferred_price');
  assert(findByName(deepDive.barriers, '該当しない').count === 1, 'deepDive.barriers tallies barriers (multi-select)');
}

{
  const rows = [makeRow({ survey_path: 'uniform_only' }), makeRow({ completion_stage: 'suit_interest' })];
  const branching = buildBranchingSection_(rows);
  assert(findByName(branching.surveyPath, 'uniform_only').count === 1, 'branching.surveyPath tallies survey_path');
  assert(findByName(branching.completionStage, 'suit_interest').count === 1, 'branching.completionStage tallies completion_stage');
}

/* ══════════════════════════════════════════════════════════════
 * regionBlockForPrefecture_ / buildHighlightsSection_
 * ══════════════════════════════════════════════════════════════ */
assert(regionBlockForPrefecture_('三重県') === '近畿', 'regionBlockForPrefecture_(三重県) === 近畿');
assert(regionBlockForPrefecture_('存在しない県') === null, 'regionBlockForPrefecture_ returns null for an unknown prefecture');

{
  const rows = [
    makeRow({ prefecture: '愛知県', snbc_interest: 'はい', snbc_awareness: '知っている', completion_stage: 'snbc_deep_dive' }),
    makeRow({ prefecture: '三重県', snbc_interest: 'いいえ', snbc_awareness: '知っている' })
  ];
  const region = buildRegionSection_(rows);
  const costume = buildCostumeSection_(rows);
  const deepDive = buildDeepDiveSection_(rows);
  const suit = buildSuitSection_(rows);
  const highlights = buildHighlightsSection_(rows, region, costume, deepDive, suit);
  assert(highlights.snbcFunnel.awarenessAnswered === 2, 'highlights.snbcFunnel.awarenessAnswered counts rows with a valid snbc_awareness');
  assert(highlights.snbcFunnel.interestYes === 1, 'highlights.snbcFunnel.interestYes counts snbc_interest=はい rows');
  const chubuOrKinki = findByName(highlights.regionSnbcInterest.rowLabels.map((n) => ({ name: n })), '近畿');
  assert(!!chubuOrKinki, 'regionSnbcInterest crosstab rows are national region block names (近畿 present)');
}

/* ══════════════════════════════════════════════════════════════
 * buildAdminDashboardPayload_：自由記述はトップに出さず一覧としてのみ含む
 * ══════════════════════════════════════════════════════════════ */
{
  const rows = [
    makeRow({ free_comment: '書いた自由記述その1' }),
    makeRow({ free_comment: '' }),
    makeRow({ free_comment: '書いた自由記述その2' })
  ];
  const payload = buildAdminDashboardPayload_(rows);
  assert(Array.isArray(payload.freeComments) && payload.freeComments.length === 2,
    'buildAdminDashboardPayload_ collects non-blank free_comment values into freeComments');
  assert(payload.highlights && !('freeComments' in payload.highlights),
    'freeComments is not part of the highlights section (not shown large/top in the dashboard)');
  assert(typeof payload.generatedAt === 'string', 'buildAdminDashboardPayload_ includes generatedAt');
}

if (failures > 0) {
  console.error('\n' + failures + ' failure(s) in test_backend.js');
  process.exitCode = 1;
} else {
  console.log('\ntest_backend.js: all checks passed');
}
