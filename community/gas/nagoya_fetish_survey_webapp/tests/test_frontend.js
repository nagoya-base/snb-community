'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const INDEX_PATH = path.join(__dirname, '..', 'Index.html');
const SCRIPT_PATH = path.join(__dirname, '..', 'Script.html');

const indexHtml = fs.readFileSync(INDEX_PATH, 'utf8');
const scriptHtml = fs.readFileSync(SCRIPT_PATH, 'utf8');

// Index.html内のApps Scriptテンプレートスクリプトレット（<?!= include(...); ?>）を、
// 実ファイルの中身で置き換えた簡易HTMLを組み立てる。
const bodyTemplate = indexHtml
  .replace(/<\?!= include\('Styles'\); \?>/, '')
  .replace(/<\?!= include\('Script'\); \?>/, scriptHtml)
  .replace(/<base target="_top">/, '');

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failures++;
  } else {
    console.log('OK:', msg);
  }
}

/**
 * 毎回まっさらなDOM・localStorage・Cookie状態でフォームを起動する
 * （分岐シナリオごとに独立した状態で検証するため）。
 */
function boot() {
  const dom = new JSDOM(bodyTemplate, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/exec' });
  const { window } = dom;
  window.addEventListener('error', (e) => {
    console.error('WINDOW ERROR:', (e.error && e.error.stack) || e.message);
    failures++;
  });

  let lastCall = null;
  window.google = { script: { run: makeRunner() } };
  function makeRunner() {
    const handlers = {};
    const runner = {
      withSuccessHandler(fn) { handlers.success = fn; return runner; },
      withFailureHandler(fn) { handlers.failure = fn; return runner; }
    };
    ['checkSubmissionStatus', 'submitSurvey'].forEach((name) => {
      runner[name] = (...args) => { lastCall = { name, args, handlers }; };
    });
    return runner;
  }

  window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true, cancelable: true }));
  const doc = window.document;

  return {
    window,
    doc,
    getLastCall: () => lastCall,
    resetLastCall: () => { lastCall = null; },
    showForm: () => { lastCall.handlers.success({ answered: false }); }
  };
}

function selectValue(doc, window, key, value) {
  const el = doc.querySelector('#field-' + key);
  el.value = value;
  el.dispatchEvent(new window.Event('change', { bubbles: true }));
}

function check(doc, window, key, value) {
  const card = doc.querySelector('.q-card[data-key="' + key + '"]');
  const input = Array.from(card.querySelectorAll('input')).find((i) => i.value === value);
  if (!input) throw new Error('no input found for ' + key + '=' + value);
  input.checked = true;
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
}

function isHidden(doc, key) {
  return doc.querySelector('.q-card[data-key="' + key + '"]').hidden;
}

function deepDiveAnswerCommon(doc, window) {
  check(doc, window, 'preferredFrequency', '月2回程度');
  check(doc, window, 'preferredPrice', '2,000円以下');
  check(doc, window, 'preferredGroupSize', '3〜4人');
  check(doc, window, 'preferredFormat', 'わからない');
  check(doc, window, 'eventAwareness', '覚えていない');
  check(doc, window, 'barriers', '該当しない');
  check(doc, window, 'preferredAtmosphere', 'わからない');
  check(doc, window, 'hypotheticalIntent', 'わからない');
  check(doc, window, 'surveyToSignupGap', 'ない');
}

/* ══════════════════════════════════════════════════════════════
 * 初期化・UUID・checkSubmissionStatus（既存の回帰確認）
 * ══════════════════════════════════════════════════════════════ */
{
  const { window, doc, getLastCall, showForm } = boot();
  const lastCall = getLastCall();
  assert(lastCall && lastCall.name === 'checkSubmissionStatus', 'checkSubmissionStatus called on init');
  const uuid = lastCall.args[0];
  assert(typeof uuid === 'string' && /^[0-9a-f-]{36}$/i.test(uuid), 'uuid looks like a valid UUID: ' + uuid);
  assert(window.localStorage.getItem('survey_browser_uuid') === uuid, 'localStorage has same uuid');
  assert(doc.cookie.indexOf('survey_browser_uuid=') !== -1, 'cookie set');

  showForm();
  assert(doc.getElementById('survey-form').hidden === false, 'survey-form visible after answered:false');

  // 設問カード数：STEP1(3) + STEP1A(3) + STEP2(3) + STEP3(12) + STEP2B(4) = 25件。
  assert(doc.querySelectorAll('.q-card').length === 25, 'question card count is 25, got ' + doc.querySelectorAll('.q-card').length);

  // 愛知県分岐（既存の回帰確認）
  const aichiCard = doc.querySelector('.q-card[data-key="aichiArea"]');
  selectValue(doc, window, 'prefecture', '愛知県');
  assert(aichiCard.hidden === false, 'aichiArea visible after selecting 愛知県');
  const aichiLabels = Array.from(aichiCard.querySelectorAll('.q-option span')).map((s) => s.textContent);
  assert(aichiLabels.indexOf('愛知県外') === -1, 'aichiArea options do not include 愛知県外');
  assert(aichiLabels.length === 6, 'aichiArea has 6 options, got ' + aichiLabels.length);
  selectValue(doc, window, 'prefecture', '東京都');
  assert(aichiCard.hidden === true, 'aichiArea hidden again after switching away from 愛知県');
}

/* ══════════════════════════════════════════════════════════════
 * Q4（interestCategories）：複数回答・グループ表示・その他
 * ══════════════════════════════════════════════════════════════ */
{
  const { window, doc, showForm } = boot();
  showForm();

  const interestCard = doc.querySelector('.q-card[data-key="interestCategories"]');
  const groupLabels = Array.from(interestCard.querySelectorAll('.q-option-group-label')).map((p) => p.textContent);
  assert(
    groupLabels.join(',') === 'スポーツ・ユニフォーム系,制服・職業服系,コスプレ・キャラクター系',
    'interestCategories renders 3 visually separated groups, got: ' + JSON.stringify(groupLabels)
  );

  check(doc, window, 'interestCategories', '野球ユニフォーム');
  check(doc, window, 'interestCategories', 'サッカーユニフォーム');
  const interestValues = Array.from(interestCard.querySelectorAll('input[type=checkbox]:checked')).map((i) => i.value);
  assert(interestValues.length === 2, 'interestCategories allows multiple selections, got ' + interestValues.length);

  const otherCheckbox = interestCard.querySelector('input[id$="-other"]');
  const otherText = interestCard.querySelector('.q-other-text');
  assert(otherText.disabled === true, 'other text initially disabled');
  otherCheckbox.checked = true;
  otherCheckbox.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert(otherText.disabled === false, 'other text enabled after checking interestCategories その他');
  otherCheckbox.checked = false;
  otherCheckbox.dispatchEvent(new window.Event('change', { bubbles: true }));
}

/* ══════════════════════════════════════════════════════════════
 * Q5（primaryInterestCategory）：Q4選択項目だけが候補になる動的選択肢
 * ══════════════════════════════════════════════════════════════ */
{
  const { window, doc, showForm } = boot();
  showForm();

  const primaryCard = doc.querySelector('.q-card[data-key="primaryInterestCategory"]');
  assert(primaryCard.hidden === true, 'primaryInterestCategory hidden before any interestCategories selection');

  check(doc, window, 'interestCategories', '野球ユニフォーム');
  assert(primaryCard.hidden === false, 'primaryInterestCategory visible once at least one interestCategories item is selected');
  let candidates = Array.from(primaryCard.querySelectorAll('.q-option span')).map((s) => s.textContent);
  assert(candidates.length === 1 && candidates[0] === '野球ユニフォーム', 'primaryInterestCategory candidates match Q4 selection: ' + JSON.stringify(candidates));

  check(doc, window, 'interestCategories', 'スーツ');
  candidates = Array.from(primaryCard.querySelectorAll('.q-option span')).map((s) => s.textContent);
  assert(
    candidates.length === 2 && candidates.indexOf('野球ユニフォーム') !== -1 && candidates.indexOf('スーツ') !== -1,
    'primaryInterestCategory candidates grow with Q4 selection: ' + JSON.stringify(candidates)
  );

  // 選んだ候補を選択したまま、Q4からその項目を外すと選択が解除されること。
  check(doc, window, 'primaryInterestCategory', 'スーツ');
  const interestCard = doc.querySelector('.q-card[data-key="interestCategories"]');
  const suitCheckbox = Array.from(interestCard.querySelectorAll('input[type=checkbox]')).find((i) => i.value === 'スーツ');
  suitCheckbox.checked = false; // Q4の「スーツ」を明示的にチェックオフする
  suitCheckbox.dispatchEvent(new window.Event('change', { bubbles: true }));
  candidates = Array.from(primaryCard.querySelectorAll('.q-option span')).map((s) => s.textContent);
  assert(candidates.indexOf('スーツ') === -1, 'primaryInterestCategory candidate removed once deselected in Q4');
}

/* ══════════════════════════════════════════════════════════════
 * Q5：Q4で「その他」の自由記述しか選んでいない場合、候補がゼロになるので
 * primaryInterestCategory自体を表示しない（候補ゼロの空カードを見せない）
 * ══════════════════════════════════════════════════════════════ */
{
  const { window, doc, showForm } = boot();
  showForm();

  const interestCard = doc.querySelector('.q-card[data-key="interestCategories"]');
  const primaryCard = doc.querySelector('.q-card[data-key="primaryInterestCategory"]');
  const otherCheckbox = interestCard.querySelector('input[id$="-other"]');
  otherCheckbox.checked = true;
  otherCheckbox.dispatchEvent(new window.Event('change', { bubbles: true }));

  assert(
    primaryCard.hidden === true,
    'primaryInterestCategory stays hidden when interestCategories only contains a free-text その他 entry'
  );
}

/* ══════════════════════════════════════════════════════════════
 * ユニフォーム系ゲート：STEP2/STEP3の表示制御
 * ══════════════════════════════════════════════════════════════ */
{
  const { window, doc, showForm } = boot();
  showForm();

  function sectionNoteHiddenFor(key) {
    return doc.querySelector('.notice-box[data-section-note-for="' + key + '"]').hidden;
  }

  // 全身タイツだけ：ユニフォーム系ゲート非該当 → SNBC設問が出ない
  check(doc, window, 'interestCategories', '全身タイツ');
  assert(isHidden(doc, 'snbcAwareness'), '全身タイツ alone does not reveal snbcAwareness');
  assert(isHidden(doc, 'snbcInterest'), '全身タイツ alone does not reveal snbcInterest');

  // 野球ユニフォームを追加：ユニフォーム系ゲート該当 → SNBC設問が出る
  check(doc, window, 'interestCategories', '野球ユニフォーム');
  assert(!isHidden(doc, 'snbcAwareness'), 'uniform gate category reveals snbcAwareness');
  assert(!isHidden(doc, 'snbcInterest'), 'uniform gate category reveals snbcInterest');
  assert(isHidden(doc, 'preferredFrequency'), 'STEP3 (deep dive) stays hidden before snbcInterest=はい');
  assert(
    sectionNoteHiddenFor('preferredFrequency') === true,
    'STEP3 sectionNote ("ここからは、SNBCのユニフォーム企画...") stays hidden together with the (still hidden) STEP3 cards'
  );

  // SNBC興味=いいえ：STEP3は表示されない
  check(doc, window, 'snbcInterest', 'いいえ');
  assert(isHidden(doc, 'preferredFrequency'), 'STEP3 stays hidden when snbcInterest=いいえ');

  // SNBC興味=はい：STEP3が表示される
  check(doc, window, 'snbcInterest', 'はい');
  assert(!isHidden(doc, 'preferredFrequency'), 'STEP3 shown when snbcInterest=はい');
  assert(!isHidden(doc, 'freeComment'), 'STEP3 free comment field shown when snbcInterest=はい');
  assert(
    sectionNoteHiddenFor('preferredFrequency') === false,
    'STEP3 sectionNote becomes visible together with the STEP3 cards once snbcInterest=はい'
  );

  // どちらともいえない：任意の理由設問が表示される
  check(doc, window, 'snbcInterest', 'どちらともいえない');
  assert(!isHidden(doc, 'snbcInterestUncertainReasons'), 'uncertain-reason question shown when snbcInterest=どちらともいえない');
  assert(isHidden(doc, 'preferredFrequency'), 'STEP3 hidden again when snbcInterest=どちらともいえない');
}

/* ══════════════════════════════════════════════════════════════
 * スーツゲート：Q4でスーツのみならSTEP2を飛ばしてSTEP2Bへ
 * ══════════════════════════════════════════════════════════════ */
{
  const { window, doc, showForm } = boot();
  showForm();

  check(doc, window, 'interestCategories', 'スーツ');
  assert(isHidden(doc, 'snbcAwareness'), 'suit-only selection does not reveal STEP2 (snbcAwareness)');
  assert(!isHidden(doc, 'suitEngagementPreferences'), 'suit-only selection reveals STEP2B (S1)');
  assert(!isHidden(doc, 'suitTypes'), 'STEP2B S2 shown for suit selectors');
  assert(!isHidden(doc, 'suitStates'), 'STEP2B S3 shown for suit selectors');
  assert(!isHidden(doc, 'suitEventInterest'), 'STEP2B S4 shown for suit selectors');
  assert(
    doc.querySelector('.notice-box[data-section-note-for="suitEngagementPreferences"]').hidden === false,
    'STEP2B sectionNote ("ここからは、スーツについて伺います。") shown together with S1'
  );

  // suit_event_interest=はいの場合、#292深掘り一式が再利用されるが、DOM上はS1〜S4の
  // 「後ろ」（STEP2Bの後）に現れる必要がある（ユニフォーム系ゲートを経由していないため）。
  check(doc, window, 'suitEngagementPreferences', '自分で着たい');
  check(doc, window, 'suitTypes', 'ビジネススーツ');
  check(doc, window, 'suitStates', 'ジャケットを着たまま');
  check(doc, window, 'suitEventInterest', 'はい');
  assert(!isHidden(doc, 'preferredFrequency'), 'suit_event_interest=はい reveals the shared deep-dive fields');
  const cardsAfterSuitYes = Array.from(doc.querySelectorAll('.q-card'));
  const idxSuitEventInterest = cardsAfterSuitYes.findIndex((c) => c.dataset.key === 'suitEventInterest');
  const idxPreferredFrequencySuitOnly = cardsAfterSuitYes.findIndex((c) => c.dataset.key === 'preferredFrequency');
  assert(
    idxPreferredFrequencySuitOnly > idxSuitEventInterest,
    'suit-only path: deep-dive block is repositioned AFTER STEP2B (suitEventInterest) in the DOM, not before it, got indices: ' +
      JSON.stringify({ suitEventInterest: idxSuitEventInterest, preferredFrequency: idxPreferredFrequencySuitOnly })
  );
}

/* ══════════════════════════════════════════════════════════════
 * ユニフォーム系+スーツ：STEP2→(STEP3)→STEP2Bの順（DOM順で確認）
 * ══════════════════════════════════════════════════════════════ */
{
  const { window, doc, showForm } = boot();
  showForm();

  check(doc, window, 'interestCategories', '野球ユニフォーム');
  check(doc, window, 'interestCategories', 'スーツ');
  assert(!isHidden(doc, 'snbcAwareness'), 'combined selection reveals STEP2');
  assert(!isHidden(doc, 'suitEngagementPreferences'), 'combined selection also reveals STEP2B');

  const cards = Array.from(doc.querySelectorAll('.q-card'));
  const order = ['snbcAwareness', 'snbcInterest', 'preferredFrequency', 'suitEngagementPreferences', 'suitEventInterest']
    .map((key) => cards.findIndex((c) => c.dataset.key === key));
  const sorted = order.slice().sort((a, b) => a - b);
  assert(JSON.stringify(order) === JSON.stringify(sorted), 'DOM order is STEP2 -> STEP3 -> STEP2B, got indices: ' + JSON.stringify(order));
}

/* ══════════════════════════════════════════════════════════════
 * 送信：分岐ごとにペイロードのsurveyPath/completionStageが正しいこと
 * ══════════════════════════════════════════════════════════════ */
function fillCommonRequired(doc, window) {
  selectValue(doc, window, 'prefecture', '東京都');
  check(doc, window, 'age', '18〜24歳');
}

// no_gate_reached
{
  const { window, doc, showForm, resetLastCall, getLastCall } = boot();
  showForm();
  fillCommonRequired(doc, window);
  check(doc, window, 'interestCategories', 'ヒーロー系');
  check(doc, window, 'engagementPreferences', '人が着ているのを見たい');

  resetLastCall();
  doc.getElementById('survey-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  const lastCall = getLastCall();
  assert(lastCall && lastCall.name === 'submitSurvey', 'no_gate_reached: submitSurvey called');
  if (lastCall) {
    const payload = lastCall.args[1];
    assert(payload.surveyPath === 'none', 'no_gate_reached payload.surveyPath === none, got ' + payload.surveyPath);
    assert(payload.completionStage === 'no_gate_reached', 'payload.completionStage === no_gate_reached, got ' + payload.completionStage);
  }
}

// suit_only
{
  const { window, doc, showForm, resetLastCall, getLastCall } = boot();
  showForm();
  fillCommonRequired(doc, window);
  check(doc, window, 'interestCategories', 'スーツ');
  check(doc, window, 'engagementPreferences', '自分で着たい');
  check(doc, window, 'suitEngagementPreferences', '自分で着たい');
  check(doc, window, 'suitTypes', 'ビジネススーツ');
  check(doc, window, 'suitStates', 'ジャケットを着たまま');
  check(doc, window, 'suitEventInterest', 'いいえ');

  resetLastCall();
  doc.getElementById('survey-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  const lastCall = getLastCall();
  assert(lastCall && lastCall.name === 'submitSurvey', 'suit_only: submitSurvey called');
  if (lastCall) {
    const payload = lastCall.args[1];
    assert(payload.surveyPath === 'suit_only', 'suit_only payload.surveyPath, got ' + payload.surveyPath);
    assert(payload.completionStage === 'suit_interest', 'suit_only payload.completionStage, got ' + payload.completionStage);
  }
}

// uniform_only, snbc_deep_dive
{
  const { window, doc, showForm, resetLastCall, getLastCall } = boot();
  showForm();
  fillCommonRequired(doc, window);
  check(doc, window, 'interestCategories', '野球ユニフォーム');
  check(doc, window, 'engagementPreferences', '自分で着たい');
  check(doc, window, 'snbcAwareness', '知っている');
  check(doc, window, 'snbcInterest', 'はい');
  deepDiveAnswerCommon(doc, window);

  resetLastCall();
  doc.getElementById('survey-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  const lastCall = getLastCall();
  assert(lastCall && lastCall.name === 'submitSurvey', 'uniform deep-dive: submitSurvey called, invalid cards: ' +
    Array.from(doc.querySelectorAll('.q-card--invalid')).map((c) => c.dataset.key).join(','));
  if (lastCall) {
    const payload = lastCall.args[1];
    assert(payload.surveyPath === 'uniform_only', 'uniform deep-dive payload.surveyPath, got ' + payload.surveyPath);
    assert(payload.completionStage === 'snbc_deep_dive', 'uniform deep-dive payload.completionStage, got ' + payload.completionStage);
    assert(payload.preferredFrequency === '月2回程度', 'deep-dive field preferredFrequency captured');

    const submitButton = doc.getElementById('submit-button');
    assert(submitButton.disabled === true, 'submit button disabled while sending');
    lastCall.handlers.success({ status: 'SUCCESS' });
    assert(doc.getElementById('submitted').hidden === false, 'submitted panel shown after SUCCESS');
  }
}

// 未入力のまま送信 -> ブロックされる（回帰確認）
{
  const { window, doc, showForm, resetLastCall, getLastCall } = boot();
  showForm();
  resetLastCall();
  doc.getElementById('survey-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  assert(getLastCall() === null, 'submitSurvey NOT called when required fields are empty');
  assert(doc.querySelectorAll('.q-card--invalid').length > 0, 'invalid cards are marked');
}

if (failures > 0) {
  console.error('\n' + failures + ' failure(s) in test_frontend.js');
  process.exitCode = 1;
} else {
  console.log('\ntest_frontend.js: all checks passed');
}
