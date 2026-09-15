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
const regionHighlightForPrefecture_ = sandbox.regionHighlightForPrefecture_;
const isNewSurveyCompletionStage_ = sandbox.isNewSurveyCompletionStage_;
const buildCrosstabSection_ = sandbox.buildCrosstabSection_;

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

/* ── ENGAGEMENT_OPTIONS / SUIT_ENGAGEMENT_OPTIONS：「両方」は複数回答設問のため冗長として
   選択肢から削除されている（公開プロジェクトと同期。レビュー指摘、PR #299）。旧回答に
   この値が残っていても、tallyMulti_は未知の値として静かに無視する
   （過去データは書き換えないため、集計上は反映されない参考値として扱われる）。 ── */
assert(sandbox.ENGAGEMENT_OPTIONS.indexOf('両方') === -1, 'ENGAGEMENT_OPTIONS does not offer 両方, in sync with the public project');
assert(sandbox.ENGAGEMENT_OPTIONS.length === 5, 'ENGAGEMENT_OPTIONS has 5 options, in sync with the public project');
assert(sandbox.SUIT_ENGAGEMENT_OPTIONS.indexOf('両方') === -1, 'SUIT_ENGAGEMENT_OPTIONS does not offer 両方, in sync with the public project');
assert(sandbox.SUIT_ENGAGEMENT_OPTIONS.length === 4, 'SUIT_ENGAGEMENT_OPTIONS has 4 options, in sync with the public project');
{
  // 旧回答に残っている可能性のある「両方」は、書き換えず参考値として保持しつつ、
  // 集計上は未知の値として静かに無視される（新カテゴリのどれにも加算されない）ことを確認する。
  const rows = [
    { engagement_preferences: '両方' },
    { engagement_preferences: '自分で着たい' }
  ];
  const result = tallyMulti_(rows, 'engagement_preferences', sandbox.ENGAGEMENT_OPTIONS);
  assert(findByName(result, '自分で着たい').count === 1, 'a legacy 両方 value does not prevent tallying other rows correctly');
  const total = result.reduce((sum, item) => sum + item.count, 0);
  assert(total === 1, 'a legacy 両方 value (no longer a valid option) is silently excluded from the tally, not miscounted into another bucket');
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
{
  // Issue #317レビュー指摘：1回答者が同じ選択肢に対して1件として数えること（重複カウント防止）を
  // crosstabMultiVsSingle_自体で直接検証する。同一セル内に同じ値が2回入っている（本来想定しない
  // 入力だが、防御的に）ケースでも、1回答者につき1回までしかカウントしないことを確認する。
  const rows = [
    { barriers: '日程が合わなかった、日程が合わなかった', hypothetical_intent: '参加しない' }
  ];
  const crosstab = crosstabMultiVsSingle_(rows, 'barriers', ['日程が合わなかった', '料金が高いと感じた'], 'hypothetical_intent', ['参加しない', 'わからない']);
  const scheduleRow = crosstab.rowLabels.indexOf('日程が合わなかった');
  assert(crosstab.matrix[scheduleRow][0] === 1,
    'crosstabMultiVsSingle_ counts a duplicated value within the same cell only once per respondent, got ' + crosstab.matrix[scheduleRow][0]);
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

/* ══════════════════════════════════════════════════════════════
 * Issue #317: isNewSurveyCompletionStage_ / regionHighlightForPrefecture_ / CROSSTAB_QUESTIONS
 * ══════════════════════════════════════════════════════════════ */
assert(isNewSurveyCompletionStage_('snbc_deep_dive') === true, 'isNewSurveyCompletionStage_ is true for a non-blank completion_stage');
assert(isNewSurveyCompletionStage_('') === false, 'isNewSurveyCompletionStage_ is false for a blank completion_stage (legacy #292 response)');
assert(isNewSurveyCompletionStage_(undefined) === false, 'isNewSurveyCompletionStage_ is false for undefined');

assert(regionHighlightForPrefecture_('東京都') === '東京都', 'regionHighlightForPrefecture_ keeps 東京都 as its own bucket');
assert(regionHighlightForPrefecture_('愛知県') === '愛知県', 'regionHighlightForPrefecture_ keeps 愛知県 as its own bucket');
assert(regionHighlightForPrefecture_('大阪府') === '大阪府', 'regionHighlightForPrefecture_ keeps 大阪府 as its own bucket');
assert(regionHighlightForPrefecture_('福岡県') === 'その他', 'regionHighlightForPrefecture_ buckets other prefectures into その他');
assert(regionHighlightForPrefecture_('海外') === 'その他', 'regionHighlightForPrefecture_ buckets 海外 into その他 too');
assert(sandbox.REGION_HIGHLIGHT_LABELS.join(',') === ['東京都', '愛知県', '大阪府', 'その他'].join(','),
  'REGION_HIGHLIGHT_LABELS is the fixed 4-category axis');

{
  const questions = sandbox.CROSSTAB_QUESTIONS;
  assert(questions.length === 21, 'CROSSTAB_QUESTIONS has exactly 21 target questions, got ' + questions.length);
  const fields = questions.map((q) => q.field);
  assert(new Set(fields).size === fields.length, 'CROSSTAB_QUESTIONS has no duplicate fields');
  assert(fields.indexOf('age') === -1 && fields.indexOf('prefecture') === -1,
    'CROSSTAB_QUESTIONS excludes age/prefecture themselves (they are the crosstab axes)');
  assert(fields.indexOf('free_comment') === -1, 'CROSSTAB_QUESTIONS excludes free_comment (free text is out of scope)');
  assert(fields.indexOf('primary_interest_category') !== -1,
    'CROSSTAB_QUESTIONS includes primary_interest_category (a selectable question in the current survey, per Issue #317 scope)');
  questions.forEach((q) => {
    assert(q.type === 'single' || q.type === 'multi', 'CROSSTAB_QUESTIONS[' + q.field + '].type is single or multi');
    assert(Array.isArray(q.options) && q.options.length > 0, 'CROSSTAB_QUESTIONS[' + q.field + '].options is a non-empty array');
    assert(typeof q.label === 'string' && q.label !== '', 'CROSSTAB_QUESTIONS[' + q.field + '].label is a non-empty string');
  });
}

/* ══════════════════════════════════════════════════════════════
 * Issue #317: buildCrosstabSection_
 * ══════════════════════════════════════════════════════════════ */
{
  // 旧アンケート回答（completion_stageが空）はサンプルサイズにも各クロス表にも含めない。
  const rows = [
    makeRow({ completion_stage: 'snbc_deep_dive', age: '18〜24歳', prefecture: '愛知県', preferred_price: '2,000円以下' }),
    makeRow({ completion_stage: '', age: '30〜39歳', prefecture: '愛知県', preferred_price: '2,000円以下' }) // 旧アンケート回答
  ];
  const crosstab = buildCrosstabSection_(rows);
  assert(crosstab.sampleSize === 1, 'buildCrosstabSection_ excludes legacy (blank completion_stage) rows from sampleSize, got ' + crosstab.sampleSize);
  const priceQ = crosstab.questions.find((q) => q.field === 'preferred_price');
  const total = priceQ.byAge.matrix.reduce((sum, row) => sum + row.reduce((s, v) => s + v, 0), 0);
  assert(total === 1, 'buildCrosstabSection_ crosstabs only count new-survey rows, got total ' + total);
}

{
  // 単一選択 × 年代・地域。三重県は近畿ブロック、大阪府は地域詳細で単独バケット。
  const rows = [
    makeRow({ completion_stage: 'snbc_deep_dive', age: '18〜24歳', prefecture: '三重県', preferred_price: '2,000円以下' }),
    makeRow({ completion_stage: 'snbc_deep_dive', age: '18〜24歳', prefecture: '大阪府', preferred_price: '2,000円以下' }),
    makeRow({ completion_stage: 'snbc_deep_dive', age: '30〜39歳', prefecture: '海外', preferred_price: '2,500円程度' })
  ];
  const crosstab = buildCrosstabSection_(rows);
  const priceQ = crosstab.questions.find((q) => q.field === 'preferred_price');
  assert(priceQ.type === 'single', 'preferred_price crosstab question is type single');

  const ageIdx = priceQ.byAge.rowLabels.indexOf('2,000円以下');
  const ageColIdx = priceQ.byAge.colLabels.indexOf('18〜24歳');
  assert(priceQ.byAge.matrix[ageIdx][ageColIdx] === 2, 'single-select × age crosstab counts match raw data (2,000円以下 × 18〜24歳 = 2)');

  const regionRowIdx = priceQ.byRegionBlock.rowLabels.indexOf('2,000円以下');
  const kinkiColIdx = priceQ.byRegionBlock.colLabels.indexOf('近畿');
  assert(priceQ.byRegionBlock.matrix[regionRowIdx][kinkiColIdx] === 2,
    'single-select × region-block crosstab sums 三重県+大阪府 under 近畿 (region block reuses regionBlockForPrefecture_)');

  const highlightRowIdx = priceQ.byRegionHighlight.rowLabels.indexOf('2,000円以下');
  const osakaColIdx = priceQ.byRegionHighlight.colLabels.indexOf('大阪府');
  const otherColIdx = priceQ.byRegionHighlight.colLabels.indexOf('その他');
  assert(priceQ.byRegionHighlight.matrix[highlightRowIdx][osakaColIdx] === 1,
    'single-select × region-highlight crosstab keeps 大阪府 as its own column');
  assert(priceQ.byRegionHighlight.matrix[highlightRowIdx][otherColIdx] === 1,
    'single-select × region-highlight crosstab buckets 三重県 (not 東京/愛知/大阪) into その他');

  const gaikokuRowIdx = priceQ.byRegionHighlight.rowLabels.indexOf('2,500円程度');
  assert(priceQ.byRegionHighlight.matrix[gaikokuRowIdx][otherColIdx] === 1,
    'single-select × region-highlight crosstab buckets 海外 into その他 too');
}

{
  // 複数選択 × 年代。同じ回答者が同じ選択肢に対して1回しかカウントされないこと（重複カウント防止）。
  // 2人目は同一セル内に同じ選択肢が2回入っている（本来想定しない入力だが、防御的に確認する）ケース。
  const rows = [
    makeRow({ completion_stage: 'snbc_deep_dive', age: '18〜24歳', prefecture: '愛知県', barriers: '日程が合わなかった、料金が高いと感じた' }),
    makeRow({ completion_stage: 'snbc_deep_dive', age: '18〜24歳', prefecture: '愛知県', barriers: '日程が合わなかった、日程が合わなかった' })
  ];
  const crosstab = buildCrosstabSection_(rows);
  const barriersQ = crosstab.questions.find((q) => q.field === 'barriers');
  assert(barriersQ.type === 'multi', 'barriers crosstab question is type multi');
  const rowIdx = barriersQ.byAge.rowLabels.indexOf('日程が合わなかった');
  const colIdx = barriersQ.byAge.colLabels.indexOf('18〜24歳');
  assert(barriersQ.byAge.matrix[rowIdx][colIdx] === 2,
    'multi-select × age crosstab counts one per respondent per option, even with a duplicated value within one cell, got ' + barriersQ.byAge.matrix[rowIdx][colIdx]);
}

{
  // 分岐設問：STEP3に到達していない回答者（barriersが空欄）は母数に含まれない。
  const rows = [
    makeRow({ completion_stage: 'snbc_deep_dive', age: '18〜24歳', prefecture: '愛知県', barriers: '日程が合わなかった' }),
    makeRow({ completion_stage: 'snbc_not_interested', age: '18〜24歳', prefecture: '愛知県', barriers: '' }) // STEP3非到達
  ];
  const crosstab = buildCrosstabSection_(rows);
  const barriersQ = crosstab.questions.find((q) => q.field === 'barriers');
  const total = barriersQ.byAge.matrix.reduce((sum, row) => sum + row.reduce((s, v) => s + v, 0), 0);
  assert(total === 1, 'a branching question excludes rows that never reached it (blank value) from the denominator, got ' + total);
}

{
  // primary_interest_category（第一嗜好）もクロス集計対象（レビュー指摘対応）。任意項目のため
  // 未回答（空欄）行は母数に含まれないことも確認する。
  const rows = [
    makeRow({ completion_stage: 'snbc_deep_dive', age: '18〜24歳', prefecture: '愛知県', primary_interest_category: '野球ユニフォーム' }),
    makeRow({ completion_stage: 'snbc_deep_dive', age: '18〜24歳', prefecture: '愛知県', primary_interest_category: '' }) // 第一嗜好は任意項目、未回答
  ];
  const crosstab = buildCrosstabSection_(rows);
  const primaryQ = crosstab.questions.find((q) => q.field === 'primary_interest_category');
  assert(!!primaryQ, 'buildCrosstabSection_ includes a primary_interest_category question');
  assert(primaryQ.type === 'single', 'primary_interest_category crosstab question is type single');
  const rowIdx = primaryQ.byAge.rowLabels.indexOf('野球ユニフォーム');
  const colIdx = primaryQ.byAge.colLabels.indexOf('18〜24歳');
  assert(primaryQ.byAge.matrix[rowIdx][colIdx] === 1, 'primary_interest_category × age crosstab counts the answered row');
  const total = primaryQ.byAge.matrix.reduce((sum, row) => sum + row.reduce((s, v) => s + v, 0), 0);
  assert(total === 1, 'primary_interest_category crosstab excludes the blank (unanswered) row from the denominator, got ' + total);
}

{
  // 年代の「回答しない」を含むケース。
  const rows = [
    makeRow({ completion_stage: 'snbc_deep_dive', age: '回答しない', prefecture: '愛知県', suit_event_interest: 'はい' })
  ];
  const crosstab = buildCrosstabSection_(rows);
  const suitQ = crosstab.questions.find((q) => q.field === 'suit_event_interest');
  const rowIdx = suitQ.byAge.rowLabels.indexOf('はい');
  const colIdx = suitQ.byAge.colLabels.indexOf('回答しない');
  assert(suitQ.byAge.matrix[rowIdx][colIdx] === 1, 'crosstab correctly counts age=回答しない rows');
}

{
  // 既存の単純集計（新旧混在）には一切影響がないことの回帰確認。
  const rows = [
    makeRow({ completion_stage: 'snbc_deep_dive', preferred_price: '2,000円以下' }),
    makeRow({ completion_stage: '', preferred_price: '2,000円以下' }) // 旧アンケート回答
  ];
  const deepDive = buildDeepDiveSection_(rows);
  assert(findByName(deepDive.price, '2,000円以下').count === 2,
    'buildDeepDiveSection_ (existing simple tally) still includes legacy rows, unaffected by the new crosstab filter');
}

if (failures > 0) {
  console.error('\n' + failures + ' failure(s) in test_backend.js');
  process.exitCode = 1;
} else {
  console.log('\ntest_backend.js: all checks passed');
}
