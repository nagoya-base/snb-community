/*
 * 名古屋野球ユニ部アンケート 回答ページ・結果ページ共通の言語選択（Issue #414）。
 *
 * 選択言語は localStorage の同一キーにだけ保持する。URL（query / hash）・GA4・payload・Spreadsheet には載せない。
 * 初期言語：保存済みの明示選択 → ブラウザ言語 → ja。回答ページと結果ページはこのファイルを共有するので、相互遷移で言語が維持される。
 */
var SurveyLocale = (function () {
  'use strict';

  var KEY = 'snb_baseball_uniform_survey_locale_v1';
  var DEFAULT_LOCALE = 'ja';
  var NAMES = { ja: '日本語', en: 'English', ko: '한국어', 'zh-Hans': '简体中文', 'zh-Hant': '繁體中文' };
  var memoryLocale = null;

  function isSupported(locales, value) { return typeof value === 'string' && locales.indexOf(value) !== -1; }

  /* ブラウザ言語タグ → 対応言語。対応外は null。zh は script / 地域で簡体・繁体を分け、指定のない zh は簡体とする。 */
  function fromTag(tag) {
    var lower = String(tag || '').toLowerCase().replace(/_/g, '-');
    var base = lower.split('-')[0];
    if (base === 'ja') return 'ja';
    if (base === 'en') return 'en';
    if (base === 'ko') return 'ko';
    if (base === 'zh') {
      if (/(^|-)hant(-|$)/.test(lower) || /-(tw|hk|mo)(-|$)/.test(lower)) return 'zh-Hant';
      return 'zh-Hans'; // zh-Hans / zh-CN / zh-SG / zh（地域なし）
    }
    return null;
  }

  function detectBrowser(win, locales) {
    var tags = [];
    try {
      if (win.navigator.languages && win.navigator.languages.length) tags = Array.prototype.slice.call(win.navigator.languages);
      else if (win.navigator.language) tags = [win.navigator.language];
    } catch (e) { tags = []; }
    for (var i = 0; i < tags.length; i++) {
      var found = fromTag(tags[i]);
      if (found && isSupported(locales, found)) return found;
    }
    return DEFAULT_LOCALE;
  }

  function readStored(win, locales) {
    try {
      var stored = win.localStorage.getItem(KEY);
      if (isSupported(locales, stored)) return stored;
    } catch (e) { /* storage が使えない場合はメモリだけ */ }
    return isSupported(locales, memoryLocale) ? memoryLocale : null;
  }

  function store(win, value) {
    memoryLocale = value;
    try { win.localStorage.setItem(KEY, value); } catch (e) { /* ignore */ }
  }

  /* 初期言語：保存済みの選択 → ブラウザ言語 → ja。 */
  function initial(win, locales) { return readStored(win, locales) || detectBrowser(win, locales); }

  return { KEY: KEY, DEFAULT_LOCALE: DEFAULT_LOCALE, NAMES: NAMES, fromTag: fromTag, detectBrowser: detectBrowser, readStored: readStored, store: store, initial: initial };
})();
