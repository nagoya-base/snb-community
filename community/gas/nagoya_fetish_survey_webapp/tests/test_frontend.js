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
const body = indexHtml
  .replace(/<\?!= include\('Styles'\); \?>/, '')
  .replace(/<\?!= include\('Script'\); \?>/, scriptHtml)
  .replace(/<base target="_top">/, '');

const dom = new JSDOM(body, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/exec' });
const { window } = dom;
const doc = window.document;

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

function fireDomContentLoaded() {
  window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true, cancelable: true }));
}
fireDomContentLoaded();

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failures++;
  } else {
    console.log('OK:', msg);
  }
}

function selectFirstRadio(key) {
  const card = doc.querySelector('.q-card[data-key="' + key + '"]');
  const radios = card.querySelectorAll('input[type=radio]:not([id$="-other"])');
  radios[0].checked = true;
  radios[0].dispatchEvent(new window.Event('change', { bubbles: true }));
}
function checkFirstCheckbox(key) {
  const card = doc.querySelector('.q-card[data-key="' + key + '"]');
  const boxes = card.querySelectorAll('input[type=checkbox]:not([id$="-other"])');
  boxes[0].checked = true;
  boxes[0].dispatchEvent(new window.Event('change', { bubbles: true }));
}
function fillAllRequiredFields() {
  doc.querySelector('#field-prefecture').value = '愛知県';
  doc.querySelector('#field-prefecture').dispatchEvent(new window.Event('change', { bubbles: true }));
  checkFirstCheckbox('clothingInterests');
  selectFirstRadio('aichiArea');
  selectFirstRadio('age');
  selectFirstRadio('preferredFrequency');
  selectFirstRadio('preferredPrice');
  selectFirstRadio('preferredGroupSize');
  checkFirstCheckbox('preferredFormat');
  selectFirstRadio('eventAwareness');
  checkFirstCheckbox('barriers');
  selectFirstRadio('preferredAtmosphere');
  selectFirstRadio('hypotheticalIntent');
  selectFirstRadio('surveyToSignupGap');
}

// ── 初期化・checkSubmissionStatus ──
assert(lastCall && lastCall.name === 'checkSubmissionStatus', 'checkSubmissionStatus called on init');
const uuid = lastCall.args[0];
assert(typeof uuid === 'string' && /^[0-9a-f-]{36}$/i.test(uuid), 'uuid looks like a valid UUID: ' + uuid);
assert(window.localStorage.getItem('survey_browser_uuid') === uuid, 'localStorage has same uuid');
assert(doc.cookie.indexOf('survey_browser_uuid=') !== -1, 'cookie set');

lastCall.handlers.success({ answered: false });
assert(doc.getElementById('survey-form').hidden === false, 'survey-form visible after answered:false');

// ── 設問カード数（QUESTIONS定義どおり16件） ──
assert(doc.querySelectorAll('.q-card').length === 16, 'question card count is 16');

// ── 愛知県分岐：aichiAreaの選択肢に「愛知県外」が無いこと ──
const prefectureSelect = doc.querySelector('#field-prefecture');
const aichiCard = doc.querySelector('.q-card[data-key="aichiArea"]');
prefectureSelect.value = '愛知県';
prefectureSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
assert(aichiCard.hidden === false, 'aichiArea visible after selecting 愛知県');
const aichiLabels = Array.from(aichiCard.querySelectorAll('.q-option span')).map((s) => s.textContent);
assert(aichiLabels.indexOf('愛知県外') === -1, 'aichiArea options do not include 愛知県外');
assert(aichiLabels.length === 6, 'aichiArea has 6 options, got ' + aichiLabels.length);

prefectureSelect.value = '東京都';
prefectureSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
assert(aichiCard.hidden === true, 'aichiArea hidden again after switching away from 愛知県');

// ── Q12→Q13分岐 ──
const gapReasonsCard = doc.querySelector('.q-card[data-key="gapReasons"]');
assert(gapReasonsCard.hidden === true, 'gapReasons hidden initially');
const gapCard = doc.querySelector('.q-card[data-key="surveyToSignupGap"]');
const yokuaruRadio = Array.from(gapCard.querySelectorAll('input[type=radio]')).find((r) => r.value === 'よくある');
yokuaruRadio.checked = true;
yokuaruRadio.dispatchEvent(new window.Event('change', { bubbles: true }));
assert(gapReasonsCard.hidden === false, 'gapReasons visible after selecting よくある');

// ── preferredFormatに「1対1」の文言が無いこと ──
const formatCard = doc.querySelector('.q-card[data-key="preferredFormat"]');
const formatLabels = Array.from(formatCard.querySelectorAll('.q-option span')).map((s) => s.textContent);
assert(formatLabels.every((l) => l.indexOf('1対1') === -1), 'preferredFormat options contain no "1対1" wording, got: ' + JSON.stringify(formatLabels));
assert(formatLabels.indexOf('少人数の部屋で2人だけ') !== -1, 'preferredFormat has 少人数の部屋で2人だけ');

// ── preferredFormat / preferredAtmosphere が必須バッジ付きで、未入力だと送信ブロックされること ──
const atmosphereCard = doc.querySelector('.q-card[data-key="preferredAtmosphere"]');
assert(formatCard.querySelector('.q-required') !== null, 'preferredFormat shows required badge');
assert(atmosphereCard.querySelector('.q-required') !== null, 'preferredAtmosphere shows required badge');

const form = doc.getElementById('survey-form');

// 「その他」チェック時にテキスト欄が有効化されること
const clothingCard = doc.querySelector('.q-card[data-key="clothingInterests"]');
const clothingOtherCheckbox = clothingCard.querySelector('input[id$="-other"]');
const clothingOtherText = clothingCard.querySelector('.q-other-text');
assert(clothingOtherText.disabled === true, 'other text initially disabled');
clothingOtherCheckbox.checked = true;
clothingOtherCheckbox.dispatchEvent(new window.Event('change', { bubbles: true }));
assert(clothingOtherText.disabled === false, 'other text enabled after checking other');
clothingOtherCheckbox.checked = false;
clothingOtherCheckbox.dispatchEvent(new window.Event('change', { bubbles: true }));

// 何も埋めずに送信 -> ブロックされる
lastCall = null;
form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
assert(lastCall === null, 'submitSurvey NOT called when required fields are empty');
assert(doc.querySelectorAll('.q-card--invalid').length > 0, 'invalid cards are marked');
assert(formatCard.classList.contains('q-card--invalid'), 'preferredFormat marked invalid when empty (required now)');
assert(atmosphereCard.classList.contains('q-card--invalid'), 'preferredAtmosphere marked invalid when empty (required now)');

// すべて埋めて送信 -> submitSurveyが呼ばれる
fillAllRequiredFields();
form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
assert(lastCall && lastCall.name === 'submitSurvey', 'submitSurvey called once all required fields are filled');

if (lastCall && lastCall.name === 'submitSurvey') {
  const payload = lastCall.args[1];
  console.log('payload:', JSON.stringify(payload, null, 2));
  assert(payload.prefecture === '愛知県', 'payload.prefecture correct');
  assert(payload.aichiArea !== '' && payload.aichiArea !== '愛知県外', 'payload.aichiArea is set and never 愛知県外');
  assert(Array.isArray(payload.preferredFormat) && payload.preferredFormat.length > 0, 'payload.preferredFormat non-empty (required)');
  assert(typeof payload.preferredAtmosphere === 'string' && payload.preferredAtmosphere !== '', 'payload.preferredAtmosphere non-empty (required)');
  assert(Array.isArray(payload.barriers) && payload.barriers.length === 1, 'payload.barriers has 1 item');

  const btn = doc.getElementById('submit-button');
  assert(btn.disabled === true, 'submit button disabled while sending');
  assert(btn.textContent === '送信中…', 'submit button shows sending state');

  lastCall.handlers.success({ status: 'SUCCESS' });
  assert(doc.getElementById('submitted').hidden === false, 'submitted panel shown after SUCCESS');
}

if (failures > 0) {
  console.error('\n' + failures + ' failure(s) in test_frontend.js');
  process.exitCode = 1;
} else {
  console.log('\ntest_frontend.js: all checks passed');
}
