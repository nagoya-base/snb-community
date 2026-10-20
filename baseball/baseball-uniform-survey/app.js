/*
 * 名古屋野球ユニ部アンケート Frontend（Issue #381）。
 *
 * 設問・選択肢・分岐・required・検証は survey.generated.js（SURVEY_SCHEMA / SurveyCore。
 * survey.schema.json と src/survey-core.js から生成）が正本で、ここには設問をベタ書きしない。
 * client validation は UX 用。最終権威は Public GAS（#380）の server validation と受付期間判定。
 *
 *  - hidden になった値は SurveyCore.sanitizeAnswers で除去してから送る（sanitize は Frontend だけ。server は拒否する）
 *  - production: GET ?action=status → 受付状態 → 回答 → POST（text/plain）
 *  - test mode（test-mode.js が fragment → sessionStorage で確定。GA4 初期化より前）:
 *      preview_no_submit / closed_view は client-only（通信・GA4 なし）
 *      submit_excluded のみ server へ送信し、token は sessionStorage から POST body にだけ載せる
 *  - GA4 は analytics.js の form_start / form_error（error type のみ）/ survey_submit だけ。
 *    section_view・設問ID・section・route・進捗・回答値・自由記述・UUID・test token/run は送らない。
 *
 * 多言語化（Issue #398）: ja / en / ko / zh-Hans / zh-Hant。
 *  - 表示文言だけを切り替える。answers / other_texts / payload は stable ID のまま（言語で変わらない）。
 *  - 日本語は schema が正本、他言語は i18n.generated.js（i18n/*.json から生成）を question.id / option.id で引く。
 *    翻訳keyが欠けても 選択言語 → ja（schema）の順で表示し、画面を壊さない（欠落は CI の辞書テストが失敗させる）。
 *  - 選択言語は localStorage にだけ保持する。URL・GA4・payload・Spreadsheet には載せない。
 *  - 自由記述の本文は翻訳しない（入力された原文のまま）。
 */
(function () {
  'use strict';

  var schema = SURVEY_SCHEMA;
  var core = SurveyCore;
  var FORM_NAME = 'baseball_uniform_survey';
  var UUID_KEY = 'snb_baseball_uniform_survey_uuid_v1';
  var RESULTS_URL = 'baseball-uniform-survey-results.html'; // 公開結果ページ（#382）。ページが存在することは tests/results_page.test.js が検証する。

  /* 見積もり表示用の定数（回答時間の目安。schema の estimatedMinutes と整合させる）。 */
  var SECONDS_PER_QUESTION = 15;
  var MAX_PERCENT_BEFORE_SUBMIT = 99;

  /* ── 表示言語（i18n）。辞書は i18n.generated.js（SURVEY_I18N）。保存値・schema は言語で変わらない。 ── */
  var I18N = window.SURVEY_I18N || { default: 'ja', locales: ['ja'], dicts: { ja: { ui: {}, sections: {} } } };
  var DEFAULT_LOCALE = I18N.default || 'ja';
  var LOCALE_KEY = 'snb_baseball_uniform_survey_locale_v1';
  var LOCALE_NAMES = { ja: '日本語', en: 'English', ko: '한국어', 'zh-Hans': '简体中文', 'zh-Hant': '繁體中文' };
  var locale = DEFAULT_LOCALE;
  var memoryLocale = null;

  function isSupported(value) { return typeof value === 'string' && I18N.locales.indexOf(value) !== -1; }

  /* ブラウザ言語タグ → 対応言語。対応外は null。zh は script / 地域で簡体・繁体を分け、指定のない zh は簡体とする。 */
  function localeFromTag(tag) {
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
  function detectBrowserLocale() {
    var tags = [];
    try {
      if (window.navigator.languages && window.navigator.languages.length) tags = Array.prototype.slice.call(window.navigator.languages);
      else if (window.navigator.language) tags = [window.navigator.language];
    } catch (e) { tags = []; }
    for (var i = 0; i < tags.length; i++) {
      var found = localeFromTag(tags[i]);
      if (found && isSupported(found)) return found;
    }
    return DEFAULT_LOCALE;
  }
  function readStoredLocale() {
    try {
      var stored = window.localStorage.getItem(LOCALE_KEY);
      if (isSupported(stored)) return stored;
    } catch (e) { /* storage が使えない場合はメモリだけ */ }
    return isSupported(memoryLocale) ? memoryLocale : null;
  }
  function storeLocale(value) {
    memoryLocale = value;
    try { window.localStorage.setItem(LOCALE_KEY, value); } catch (e) { /* ignore */ }
  }
  /* 初期言語：保存済みの選択 → ブラウザ言語 → ja。 */
  locale = readStoredLocale() || detectBrowserLocale();

  function dictOf(code) { return I18N.dicts[code] || null; }
  function fillParams(text, params) {
    return String(text).replace(/\{([A-Za-z0-9_]+)\}/g, function (match, name) {
      return params && params[name] !== undefined && params[name] !== null ? String(params[name]) : match;
    });
  }
  function hasUi(key) { var ja = dictOf(DEFAULT_LOCALE); return !!(ja && ja.ui && typeof ja.ui[key] === 'string'); }
  /* UI 文言：選択言語 → ja → key 名（辞書の欠落は CI が検出する。実行時は画面を壊さないためだけの安全策）。 */
  function t(key, params) {
    var current = dictOf(locale);
    var value = current && current.ui && current.ui[key];
    if (typeof value !== 'string' || value === '') {
      var base = dictOf(DEFAULT_LOCALE);
      value = base && base.ui && base.ui[key];
    }
    if (typeof value !== 'string' || value === '') value = key;
    return fillParams(value, params);
  }
  /* 設問由来の文言：日本語は schema が正本。他言語は question.id / option.id で引き、無ければ schema（ja）。 */
  function qEntry(questionId) {
    var current = dictOf(locale);
    return locale !== DEFAULT_LOCALE && current && current.questions && current.questions[questionId] || null;
  }
  function qLabel(q) { var e = qEntry(q.id); return e && e.label || q.label; }
  function qHelp(q) { var e = qEntry(q.id); return e && e.helpText || q.helpText; }
  function optionLabel(q, option) {
    // single_dynamic の候補は source 設問の option ID なので、source 設問の翻訳を使う。
    var owner = q.type === 'single_dynamic' ? q.sourceQuestion : q.id;
    var e = qEntry(owner);
    var id = option.sourceOptionId || option.id;
    return e && e.options && e.options[id] || option.label;
  }
  function anchorLabel(q, point) { var e = qEntry(q.id); return e && e.anchors && e.anchors[String(point.value)] || point.label; }
  function notApplicableLabel(q, na) { var e = qEntry(q.id); return e && e.notApplicable || na.label; }
  function schemaText(path, fallback) {
    var current = dictOf(locale);
    var node = locale !== DEFAULT_LOCALE && current && current.schemaText;
    for (var i = 0; node && i < path.length; i++) node = node[path[i]];
    return typeof node === 'string' && node ? node : fallback;
  }
  function milestoneText(m) { return schemaText(['milestones', (m.afterQuestion ? 'after:' + m.afterQuestion : 'before:' + m.beforeQuestion)], m.message); }

  var ERROR_CODES = ['required', 'other_text_required', 'too_long', 'invalid_text', 'exclusive_conflict', 'other_text_unexpected',
    'invalid_option', 'invalid_type', 'duplicate_option', 'hidden_field', 'unknown_field'];

  var config = window.BASEBALL_UNIFORM_SURVEY_CONFIG || {};
  // endpoint は読み込み時に固定せず、使う時点で config から読む（Local Override 等で後から設定されても送信・status で使える）。
  function getEndpoint() {
    var current = (window.BASEBALL_UNIFORM_SURVEY_CONFIG || config || {}).endpoint;
    return typeof current === 'string' ? current : '';
  }
  var testMode = window.SNB_BASEBALL_SURVEY_TEST_MODE || null; // null | preview_no_submit | closed_view | submit_excluded
  var testStore = window.SNBBaseballSurveyTestStore || { read: function () { return null; }, clear: function () {} };
  var CHANNELS = schema.persistenceSchema.sourceChannel.allowlist;

  var app = document.getElementById('bus-app');
  var state = {
    answers: {},
    otherTexts: {},
    page: 'intro',
    startedAt: null,
    submitting: false,
    finished: false,
    shown: { percent: 0, minutes: null },
    banner: [],          // milestone オブジェクト（言語切替で再解決するため、文字列ではなく参照を持つ）
    shownErrors: {},     // 画面に出している検証エラー {questionId: code}（言語切替後に同じ内容を再表示する）
    submitMsgKey: null,  // 画面に出している送信エラー文言の key
    relang: false        // 言語切替による再描画中（フォーカス・スクロールを動かさない）
  };
  var view = null; // 再描画用: null（フォーム画面）| {message: spec} | {loading: true}
  var uuid = null;
  var memoryUuid = null;

  /* ── GA4（analytics.js の許可イベントだけ。test mode では常に null） ── */
  function analytics() { return testMode ? null : window.SNBAnalytics || null; }
  function trackStart() { if (analytics()) analytics().trackFormStart(FORM_NAME); }
  function trackError(type) { if (analytics()) analytics().trackFormError(FORM_NAME, type); }
  function trackSubmit() { if (analytics()) analytics().track('survey_submit', { form_name: FORM_NAME }); }

  /* ── browser UUID（保存しないserver側でhash化。ブラウザには localStorage、使えなければメモリのみ） ── */
  function randomUuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    var bytes = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (var i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    var hex = Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
  }
  function getUuid() {
    if (uuid) return uuid;
    try {
      var stored = window.localStorage.getItem(UUID_KEY);
      if (stored && /^[0-9a-f-]{36}$/i.test(stored)) { uuid = stored; return uuid; }
      uuid = randomUuid();
      window.localStorage.setItem(UUID_KEY, uuid);
    } catch (e) {
      memoryUuid = memoryUuid || randomUuid();
      uuid = memoryUuid;
    }
    return uuid;
  }

  /* ── DOM helpers（回答由来の文字列は textContent のみで描画） ── */
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function scrollTop() { try { window.scrollTo(0, 0); } catch (e) { /* ignore */ } }

  /* ── route / section ── */
  function sectionIds() {
    var ids = [];
    schema.questions.forEach(function (q) { if (ids.indexOf(q.section) === -1) ids.push(q.section); });
    return ids;
  }
  function sectionQuestions(sectionId) {
    return schema.questions.filter(function (q) {
      return q.section === sectionId && core.isVisible(schema, q.id, state.answers);
    });
  }
  /* 回答者のルートで表示対象の section（visible な設問を1つ以上持つもの）。 */
  function visibleSections() {
    return sectionIds().filter(function (id) { return sectionQuestions(id).length > 0; });
  }
  function pageList() { return ['intro'].concat(visibleSections(), ['review']); }
  function titleOf(sectionId) {
    var current = dictOf(locale);
    var base = dictOf(DEFAULT_LOCALE);
    return current && current.sections && current.sections[sectionId] || base && base.sections && base.sections[sectionId] || '';
  }

  /* ── 回答の更新（hidden / stale は直ちに除去し、送信payloadに残さない） ── */
  function isEmptyAnswer(value) {
    return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
  }
  function setAnswer(q, value) {
    if (isEmptyAnswer(value)) delete state.answers[q.id]; else state.answers[q.id] = value;
    sanitizeState();
    applyAutoSelect();
  }
  function sanitizeState() {
    var result = core.sanitizeAnswers(schema, state.answers, state.otherTexts);
    state.answers = result.answers;
    state.otherTexts = result.other_texts;
  }
  /* autoSelectIfSingle：候補が1つだけなら自動選択（変化がなくなるまで）。 */
  function applyAutoSelect() {
    for (var round = 0; round < 8; round++) {
      var changed = false;
      schema.questions.forEach(function (q) {
        if (q.type !== 'single_dynamic') return;
        var auto = core.autoSelectValue(schema, q.id, state.answers);
        if (auto !== null && state.answers[q.id] !== auto) { state.answers[q.id] = auto; changed = true; }
      });
      if (!changed) return;
      sanitizeState();
    }
  }

  /* ── 設問描画 ── */
  var idCounter = 0;
  function uid(prefix) { idCounter += 1; return 'bus-' + prefix + '-' + idCounter; }

  function optionRow(q, option, type, name, checked, onChange) {
    var label = el('label', 'bus-opt');
    var input = document.createElement('input');
    input.type = type;
    input.name = name;
    input.value = option.id;
    input.id = uid('o');
    input.checked = checked;
    input.addEventListener('change', function () { onChange(input); });
    label.appendChild(input);
    label.appendChild(el('span', '', option.label));
    return label;
  }

  function fieldsetFor(q) {
    var fieldset = el('fieldset', 'bus-q');
    fieldset.setAttribute('data-qid', q.id);
    var legend = el('legend');
    legend.appendChild(el('span', 'bus-qtext', qLabel(q)));
    // required 表示は visible な設問にだけ描画する（hidden 設問は DOM に存在しない）。
    legend.appendChild(el('span', q.required ? 'bus-req' : 'bus-optional', q.required ? t('common.required') : t('common.optional')));
    fieldset.appendChild(legend);
    if (q.helpText) fieldset.appendChild(el('p', 'bus-help', qHelp(q)));
    return fieldset;
  }

  function errorSlot(fieldset, q) {
    var slot = el('p', 'bus-err');
    slot.id = 'bus-err-' + q.id;
    slot.setAttribute('aria-live', 'polite');
    slot.hidden = true;
    fieldset.appendChild(slot);
    fieldset.setAttribute('aria-describedby', slot.id);
    return slot;
  }

  /* 「その他」本文・低関心メッセージなど、選択に連動して出し入れする領域を更新する。 */
  function refreshExtras(fieldset, q) {
    var info = core.otherTextInfo(schema, q.id, state.answers[q.id]);
    var box = fieldset.querySelector('.bus-other');
    if (box) {
      box.hidden = !info.required;
      var input = box.querySelector('input');
      input.disabled = !info.required;
      if (!info.required) { input.value = ''; }
    }
    var ack = fieldset.querySelector('.bus-ack');
    if (ack) ack.hidden = !lowInterestAckVisible(q);
  }

  function lowInterestAckVisible(q) {
    var ackDef = schema.sectionUx && schema.sectionUx.lowInterestAcknowledgement;
    if (!ackDef || !ackDef.trigger || ackDef.trigger.question !== q.id) return false;
    return core.evalCondition(schema, ackDef.trigger, state.answers);
  }

  function addExtras(fieldset, q) {
    var info = core.otherTextInfo(schema, q.id, state.answers[q.id]);
    if (info.optionIds.length) {
      var box = el('div', 'bus-other');
      var inputId = uid('other');
      var label = el('label', '', t('common.otherText'));
      label.setAttribute('for', inputId);
      var input = document.createElement('input');
      input.type = 'text';
      input.id = inputId;
      input.className = 'bus-text';
      if (info.maxLength !== null) input.maxLength = info.maxLength;
      input.autocomplete = 'off';
      input.value = state.otherTexts[q.id] || '';
      input.addEventListener('input', function () { state.otherTexts[q.id] = input.value; });
      box.appendChild(label);
      box.appendChild(input);
      fieldset.appendChild(box);
    }
    var ackDef = schema.sectionUx && schema.sectionUx.lowInterestAcknowledgement;
    if (ackDef && ackDef.trigger && ackDef.trigger.question === q.id) {
      var ack = el('p', 'bus-ack', schemaText(['lowInterestAcknowledgement'], ackDef.message));
      ack.setAttribute('role', 'status');
      fieldset.appendChild(ack);
    }
    refreshExtras(fieldset, q);
    // 非表示→表示になった「その他」の入力欄は値を持たない。表示中は保持した本文を入れる。
    var other = fieldset.querySelector('.bus-other input');
    if (other && !other.disabled) other.value = state.otherTexts[q.id] || '';
  }

  function renderChoice(q, fieldset, changed) {
    var type = q.type === 'multiple' ? 'checkbox' : 'radio';
    var options = core.getEffectiveOptions(schema, q.id, state.answers);
    var list = el('div', 'bus-options');
    var name = uid('q');
    if (q.type === 'single_dynamic' && options.length === 0) {
      list.appendChild(el('p', 'bus-help', t('common.noOptions')));
    }
    options.forEach(function (option) {
      var current = state.answers[q.id];
      var checked = type === 'radio' ? current === option.id : Array.isArray(current) && current.indexOf(option.id) !== -1;
      list.appendChild(optionRow(q, { id: option.id, label: optionLabel(q, option) }, type, name, checked, function (input) {
        if (type === 'radio') setAnswer(q, input.value);
        else {
          var next = core.applyMultipleSelection(schema, q.id, state.answers[q.id], option.id, input.checked);
          setAnswer(q, next);
          // exclusive の排他をUIへ反映
          Array.prototype.forEach.call(list.querySelectorAll('input'), function (box) { box.checked = next.indexOf(box.value) !== -1; });
        }
        changed(q);
      }));
    });
    fieldset.appendChild(list);
  }

  function renderScale(q, fieldset, changed) {
    var scale = core.getScale(schema, q.id);
    var name = uid('q');
    var list = el('div', 'bus-scale');
    scale.points.forEach(function (point) {
      list.appendChild(optionRow(q, { id: point.id, label: t('common.scalePoint', { value: point.value, label: anchorLabel(q, point) }) }, 'radio', name, state.answers[q.id] === point.id, function (input) {
        setAnswer(q, input.value);
        changed(q);
      }));
    });
    fieldset.appendChild(list);
    if (scale.notApplicable) {
      var na = el('div', 'bus-scale-na');
      na.appendChild(optionRow(q, { id: scale.notApplicable.id, label: notApplicableLabel(q, scale.notApplicable) }, 'radio', name, state.answers[q.id] === scale.notApplicable.id, function (input) {
        setAnswer(q, input.value);
        changed(q);
      }));
      fieldset.appendChild(na);
    }
  }

  function renderText(q, fieldset, changed) {
    var inputId = uid('t');
    var singleLine = q.inputStyle === 'single_line';
    var textarea = document.createElement(singleLine ? 'input' : 'textarea');
    if (singleLine) {
      textarea.type = 'text';
      textarea.autocomplete = 'off';
    } else {
      textarea.rows = 5;
    }
    textarea.id = inputId;
    textarea.className = singleLine ? 'bus-text' : 'bus-textarea';
    textarea.setAttribute('aria-label', qLabel(q));
    if (typeof q.maxLength === 'number') textarea.maxLength = q.maxLength;
    textarea.value = state.answers[q.id] || '';
    var counter = el('p', 'bus-count');
    function updateCount() {
      counter.textContent = typeof q.maxLength === 'number' ? t('common.charCount', { count: textarea.value.length, max: q.maxLength }) : '';
    }
    textarea.addEventListener('input', function () {
      setAnswer(q, textarea.value);
      updateCount();
      changed(q);
    });
    updateCount();
    fieldset.appendChild(textarea);
    fieldset.appendChild(counter);
  }

  /* 表示内容が変わったか判定する署名（選択肢の構成と single_dynamic の選択値）。署名が同じ設問は再構築しない。 */
  function signature(q) {
    if (q.type === 'text' || q.type === 'scale') return q.type;
    var ids = core.getEffectiveOptions(schema, q.id, state.answers).map(function (o) { return o.id; }).join(',');
    return ids + (q.type === 'single_dynamic' ? '|' + (state.answers[q.id] || '') : '');
  }

  function renderQuestion(q, changed) {
    var fieldset = fieldsetFor(q);
    if (q.type === 'single' || q.type === 'multiple' || q.type === 'single_dynamic') renderChoice(q, fieldset, changed);
    else if (q.type === 'scale') renderScale(q, fieldset, changed);
    else if (q.type === 'text') renderText(q, fieldset, changed);
    else fieldset.appendChild(el('p', 'bus-help', t('common.unsupported')));
    addExtras(fieldset, q);
    errorSlot(fieldset, q);
    fieldset.bus_sig = signature(q);
    return fieldset;
  }

  /* 回答が変わったとき、変更した設問以外を再構築して表示/非表示・候補を同期する。 */
  function syncSection(container, sectionId, changedQid) {
    var wanted = sectionQuestions(sectionId);
    var existing = {};
    Array.prototype.forEach.call(container.children, function (node) {
      var id = node.getAttribute('data-qid');
      if (id) existing[id] = node;
    });
    Object.keys(existing).forEach(function (id) {
      if (!wanted.some(function (q) { return q.id === id; })) container.removeChild(existing[id]);
    });
    var previous = null;
    wanted.forEach(function (q) {
      var node = existing[q.id];
      if (!node || (q.id !== changedQid && node.bus_sig !== signature(q))) {
        var fresh = renderQuestion(q, onChanged);
        if (node && node.parentNode === container) container.replaceChild(fresh, node);
        else container.insertBefore(fresh, previous ? previous.nextSibling : container.firstChild);
        node = fresh;
      } else {
        if (q.id === changedQid) node.bus_sig = signature(q);
        refreshExtras(node, q);
        var expected = previous ? previous.nextSibling : container.firstChild;
        if (node !== expected) container.insertBefore(node, expected);
      }
      previous = node;
    });
    updateProgress();
    updateMessageBlocks(sectionId);
  }

  function onChanged(q) {
    var container = document.getElementById('bus-questions');
    if (!container) return;
    clearError(q.id);
    syncSection(container, state.page, q.id);
  }

  /*
   * 回答者のルートが確定したか。確定前は visible route がまだ短い（後続設問の表示条件が未回答のため）ので、
   * 割合・残り時間を出すと過小表示になる。確定するまでは現在の section 番号だけを示す。
   * 確定条件は schema の名前付き condition（attendee / nonattendee_interested）と routeUx の短縮 route trigger。
   */
  function routeDetermined() {
    var route = schema.routeUx && schema.routeUx.pure_uniform_short_route;
    return core.evalNamedCondition(schema, 'attendee', state.answers) ||
      core.evalNamedCondition(schema, 'nonattendee_interested', state.answers) ||
      !!(route && core.evalCondition(schema, route.trigger, state.answers));
  }

  /* ── 進捗（回答者の visible route に対する割合。表示は単調：後退させない） ── */
  function progressInfo(page) {
    var visible = core.visibleQuestionIds(schema, state.answers);
    var total = visible.length;
    var done = 0;
    var sections = visibleSections();
    var index = sections.indexOf(page);
    if (page === 'review') {
      done = total;
    } else if (index !== -1) {
      sections.slice(0, index).forEach(function (id) { done += sectionQuestions(id).length; });
    }
    if (!(page === 'review' || routeDetermined())) {
      return { determined: false, sectionIndex: index === -1 ? sections.length : index + 1, sectionTotal: sections.length, percent: state.shown.percent, minutes: state.shown.minutes };
    }
    var percent = total ? Math.round((done / total) * 100) : 0;
    percent = Math.min(percent, MAX_PERCENT_BEFORE_SUBMIT);
    if (percent < state.shown.percent) percent = state.shown.percent;
    state.shown.percent = percent;
    var remaining = Math.max(0, total - done);
    var minutes = remaining === 0 ? 0 : Math.max(1, Math.ceil((remaining * SECONDS_PER_QUESTION) / 60));
    if (state.shown.minutes !== null && minutes > state.shown.minutes) minutes = state.shown.minutes;
    state.shown.minutes = minutes;
    return {
      determined: page === 'review' || routeDetermined(),
      sectionIndex: index === -1 ? sections.length : index + 1,
      sectionTotal: sections.length,
      percent: percent,
      minutes: minutes
    };
  }

  function progressNode() {
    var box = el('div', 'bus-progress');
    box.id = 'bus-progress';
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', t('progress.groupAria'));
    var text = el('p', 'bus-progress-text');
    text.id = 'bus-progress-text';
    var bar = el('div', 'bus-bar');
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    bar.setAttribute('aria-label', t('progress.barAria'));
    bar.appendChild(el('i'));
    box.appendChild(text);
    box.appendChild(bar);
    return box;
  }

  function updateProgress() {
    var box = document.getElementById('bus-progress');
    if (!box) return;
    var info = progressInfo(state.page);
    var bar = box.querySelector('[role="progressbar"]');
    if (!info.determined) {
      // ルート確定前：割合・残り時間は出さない（過小表示になるため）。aria-valuenow を持たない indeterminate 表示。
      document.getElementById('bus-progress-text').textContent = t('progress.undetermined', { index: info.sectionIndex });
      bar.removeAttribute('aria-valuenow');
      bar.setAttribute('aria-valuetext', t('progress.undeterminedValueText'));
      bar.firstChild.style.width = '0%';
      return;
    }
    var parts = [t('progress.section', { index: info.sectionIndex, total: info.sectionTotal }), t('progress.percent', { percent: info.percent })];
    parts.push(info.minutes === 0 ? t('progress.almostDone') : t('progress.minutes', { minutes: info.minutes }));
    document.getElementById('bus-progress-text').textContent = parts.join('　');
    bar.setAttribute('aria-valuenow', String(info.percent));
    bar.setAttribute('aria-valuetext', t('progress.percent', { percent: info.percent }));
    bar.firstChild.style.width = info.percent + '%';
  }

  /* ── milestone / route メッセージ（schema の sectionUx / routeUx から） ── */
  function pageMessages(sectionId) {
    var messages = [];
    var ux = schema.sectionUx || {};
    (ux.milestones || []).forEach(function (m) {
      if (m.beforeQuestion) {
        var qs = sectionQuestions(sectionId).map(function (q) { return q.id; });
        if (qs.indexOf(m.beforeQuestion) !== -1 && (!m.conditionRef || core.evalNamedCondition(schema, m.conditionRef, state.answers))) {
          messages.push(milestoneText(m));
        }
      }
    });
    state.banner.forEach(function (m) { var text = milestoneText(m); if (messages.indexOf(text) === -1) messages.push(text); });
    var route = schema.routeUx && schema.routeUx.pure_uniform_short_route;
    if (route && route.messageBeforeProfile && sectionId === 'profile' && core.evalCondition(schema, route.trigger, state.answers)) {
      messages.push(schemaText(['routes', 'pure_uniform_short_route', 'messageBeforeProfile'], route.messageBeforeProfile));
    }
    return messages;
  }

  /* 「afterQuestion」型の milestone：その設問を含む section を終えて次へ進むときに、次のページ冒頭へ出す。 */
  function milestonesAfter(sectionId) {
    var out = [];
    var ux = schema.sectionUx || {};
    var ids = sectionQuestions(sectionId).map(function (q) { return q.id; });
    (ux.milestones || []).forEach(function (m) {
      if (!m.afterQuestion) return;
      var target = ids.indexOf(m.afterQuestion) !== -1 ? m.afterQuestion
        : (m.fallbackAfterQuestion && !core.isVisible(schema, m.afterQuestion, state.answers) && ids.indexOf(m.fallbackAfterQuestion) !== -1 ? m.fallbackAfterQuestion : null);
      if (target) out.push(m); // 表示時に現在の言語で解決する
    });
    return out;
  }

  function messageBlock(messages) {
    var wrap = el('div', 'bus-messages');
    wrap.id = 'bus-messages';
    messages.forEach(function (text) {
      var p = el('p', 'bus-milestone', text);
      p.setAttribute('role', 'note');
      wrap.appendChild(p);
    });
    return wrap;
  }
  function updateMessageBlocks(sectionId) {
    var wrap = document.getElementById('bus-messages');
    if (!wrap || sectionId === 'intro' || sectionId === 'review') return;
    var next = messageBlock(pageMessages(sectionId));
    wrap.parentNode.replaceChild(next, wrap);
  }

  /* ── エラー表示 ── */
  function clearError(qid) {
    delete state.shownErrors[qid];
    var fieldset = document.querySelector('fieldset[data-qid="' + qid + '"]');
    if (!fieldset) return;
    var slot = fieldset.querySelector('.bus-err');
    if (slot) { slot.hidden = true; slot.textContent = ''; }
    fieldset.classList.remove('bus-has-error');
    Array.prototype.forEach.call(fieldset.querySelectorAll('input, textarea'), function (i) { i.removeAttribute('aria-invalid'); });
    var summary = document.getElementById('bus-summary');
    if (summary && !document.querySelector('.bus-has-error')) { summary.hidden = true; clear(summary); }
  }

  function messageFor(code) { return ERROR_CODES.indexOf(code) !== -1 && hasUi('error.' + code) ? t('error.' + code) : t('error.generic'); }

  /* errors: {questionId: code}。要約（role=alert）と個別エラー（aria-live）を出し、最初の誤りへフォーカスする。 */
  function showErrors(errors, options) {
    var ids = Object.keys(errors);
    state.shownErrors = {};
    ids.forEach(function (id) { state.shownErrors[id] = errors[id]; });
    var summary = document.getElementById('bus-summary');
    if (summary) {
      clear(summary);
      summary.hidden = ids.length === 0;
      if (ids.length) {
        summary.appendChild(el('p', 'bus-summary-title', t('error.summaryTitle', { count: ids.length })));
        var list = el('ul');
        ids.forEach(function (id) {
          var q = core.getQuestion(schema, id);
          var item = el('li');
          var link = el('a', '', t('error.summaryItem', { label: q ? qLabel(q) : '', message: messageFor(errors[id]) }));
          link.href = '#bus-err-' + id;
          link.addEventListener('click', function (event) { event.preventDefault(); focusQuestion(id); });
          item.appendChild(link);
          list.appendChild(item);
        });
        summary.appendChild(list);
      }
    }
    ids.forEach(function (id) {
      var fieldset = document.querySelector('fieldset[data-qid="' + id + '"]');
      if (!fieldset) return;
      var slot = fieldset.querySelector('.bus-err');
      slot.textContent = messageFor(errors[id]);
      slot.hidden = false;
      fieldset.classList.add('bus-has-error');
      Array.prototype.forEach.call(fieldset.querySelectorAll('input:not([disabled]), textarea'), function (i) { i.setAttribute('aria-invalid', 'true'); });
    });
    if (ids.length && !(options && options.noFocus)) focusQuestion(ids[0]);
  }

  function focusQuestion(id) {
    var fieldset = document.querySelector('fieldset[data-qid="' + id + '"]');
    if (!fieldset) return;
    var target = fieldset.querySelector('input:not([disabled]), textarea');
    if (target) {
      target.focus();
      try { target.scrollIntoView({ block: 'center' }); } catch (e) { /* ignore */ }
    }
  }

  /* ── 検証（UX用。最終権威は server） ── */
  function validateAll() {
    sanitizeState();
    applyAutoSelect();
    var result = core.validateAnswers(schema, state.answers, state.otherTexts);
    var map = {};
    result.errors.forEach(function (error) { if (!map[error.field]) map[error.field] = error.code; });
    return { ok: result.ok, errors: map, clean: result.clean };
  }
  function errorsForSection(sectionId, all) {
    var map = {};
    schema.questions.forEach(function (q) {
      if (q.section === sectionId && all.errors[q.id]) map[q.id] = all.errors[q.id];
    });
    return map;
  }

  /* ── ページ描画 ── */
  function shell() {
    clear(app);
    if (testMode) app.appendChild(testBanner());
  }

  var INVALID_TEST = 'invalid_test_config';
  function testBanner() {
    var banner = el('div', 'bus-test-banner');
    banner.id = 'bus-test-banner';
    banner.setAttribute('role', 'status');
    banner.appendChild(el('span', '', t('test.banner.' + testMode)));
    var exit = el('button', 'bus-test-exit', t('test.exit'));
    exit.type = 'button';
    exit.addEventListener('click', function () {
      testStore.clear();
      // query の test= も外して開き直す（残すと誤記のまま再び fail closed になる）。
      var search = '';
      try {
        var keep = new URLSearchParams(window.location.search);
        keep.delete('test');
        search = keep.toString() ? '?' + keep.toString() : '';
      } catch (e) { search = ''; }
      window.location.href = window.location.pathname + search;
    });
    banner.appendChild(exit);
    return banner;
  }

  function heading(text) {
    var h2 = el('h2', 'bus-page-title', text);
    h2.id = 'bus-page-title';
    h2.tabIndex = -1;
    return h2;
  }

  function focusHeading() {
    if (state.relang) return; // 言語切替による再描画では、フォーカスとスクロール位置を動かさない
    var h = document.getElementById('bus-page-title');
    if (h) h.focus();
    scrollTop();
  }

  function navBar(onBack, nextLabel, onNext, backLabel) {
    var nav = el('div', 'bus-nav');
    var inner = el('div', 'bus-nav-inner');
    if (onBack) {
      var back = el('button', 'bus-btn bus-secondary', backLabel || t('common.back'));
      back.type = 'button';
      back.id = 'bus-back-btn';
      back.addEventListener('click', onBack);
      inner.appendChild(back);
    }
    var next = el('button', 'bus-btn', nextLabel);
    next.type = 'button';
    next.id = 'bus-next';
    next.addEventListener('click', onNext);
    inner.appendChild(next);
    nav.appendChild(inner);
    return nav;
  }

  function summaryNode() {
    var summary = el('div', 'bus-summary');
    summary.id = 'bus-summary';
    summary.setAttribute('role', 'alert');
    summary.hidden = true;
    return summary;
  }

  function go(page, banner) {
    state.page = page;
    state.banner = banner || [];
    state.shownErrors = {};
    state.submitMsgKey = null;
    render();
  }

  function render() {
    if (state.page === 'intro') renderIntro();
    else if (state.page === 'review') renderReview();
    else renderSection(state.page);
  }

  function noteList(items) {
    var list = el('ul', 'bus-notes');
    items.forEach(function (text) { list.appendChild(el('li', '', text)); });
    return list;
  }

  function renderIntro() {
    view = null;
    shell();
    var card = el('section', 'bus-card');
    card.setAttribute('aria-labelledby', 'bus-page-title');
    card.appendChild(heading(t('intro.title')));
    card.appendChild(el('p', 'bus-lead', t('intro.lead')));
    card.appendChild(noteList([
      t('intro.note.eligibility'),
      t('intro.note.time', { min: schema.respondentNotice.estimatedMinutes.min, max: schema.respondentNotice.estimatedMinutes.max }),
      t('intro.note.publication'),
      t('intro.note.admin'),
      t('intro.note.anonymity'),
      t('intro.note.retention'),
      t('intro.note.partial'),
      t('intro.note.notEntry'),
      t('intro.note.representativeness')
    ]));
    card.appendChild(el('p', 'bus-help', t('intro.contact')));
    app.appendChild(card);
    app.appendChild(navBar(null, t('common.start'), function () {
      state.startedAt = Date.now();
      trackStart();
      var first = visibleSections()[0];
      go(first);
    }));
    focusHeading();
  }

  function renderSection(sectionId) {
    view = null;
    shell();
    app.appendChild(progressNode());
    app.appendChild(summaryNode());
    var card = el('section', 'bus-card');
    card.setAttribute('aria-labelledby', 'bus-page-title');
    card.appendChild(heading(titleOf(sectionId)));
    card.appendChild(messageBlock(pageMessages(sectionId)));
    var container = el('div', 'bus-questions');
    container.id = 'bus-questions';
    card.appendChild(container);
    app.appendChild(card);
    applyAutoSelect();
    syncSection(container, sectionId, null);
    var pages = pageList();
    var index = pages.indexOf(sectionId);
    app.appendChild(navBar(function () { go(pages[Math.max(0, index - 1)]); }, t('common.next'), function () { next(sectionId); }));
    restoreMessages();
    focusHeading();
  }

  function next(sectionId) {
    var all = validateAll();
    var errors = errorsForSection(sectionId, all);
    if (Object.keys(errors).length) {
      trackError('validation');
      showErrors(errors);
      return;
    }
    // 18歳未満（termination）：本文は一切保存・送信せず、ここで終了する。
    var termination = core.findTermination(schema, state.answers);
    if (termination) { showIneligible(); return; }
    var pages = pageList();
    go(pages[pages.indexOf(sectionId) + 1], milestonesAfter(sectionId));
  }

  /* ── 確認ページ ── */
  function answerText(q) {
    var value = state.answers[q.id];
    if (q.type === 'text') return value;
    var options = q.type === 'scale' ? [] : core.getEffectiveOptions(schema, q.id, state.answers);
    var labelOf = function (id) {
      if (q.type === 'scale') {
        var scale = core.getScale(schema, q.id);
        if (scale.notApplicable && scale.notApplicable.id === id) return notApplicableLabel(q, scale.notApplicable);
        var hit = scale.points.filter(function (p) { return p.id === id; })[0];
        return hit ? t('common.scalePoint', { value: hit.value, label: anchorLabel(q, hit) }) : id;
      }
      var opt = options.filter(function (o) { return o.id === id; })[0];
      var text = opt ? optionLabel(q, opt) : id;
      // 「その他」の自由記述は翻訳せず、入力された原文のまま表示する。
      if (opt && (opt.other || opt.fromOther) && state.otherTexts[q.id] && q.type !== 'single_dynamic') text = t('common.withOther', { label: text, text: state.otherTexts[q.id] });
      return text;
    };
    return core.selectedIds(q, value).map(labelOf).join(t('common.listSeparator'));
  }

  function renderReview() {
    view = null;
    shell();
    app.appendChild(progressNode());
    app.appendChild(summaryNode());
    var card = el('section', 'bus-card');
    card.setAttribute('aria-labelledby', 'bus-page-title');
    card.appendChild(heading(t('review.title')));
    card.appendChild(el('p', 'bus-lead', t('review.lead')));
    var all = validateAll();
    visibleSections().forEach(function (sectionId) {
      var block = el('section', 'bus-review-block');
      var head = el('h3', '', titleOf(sectionId));
      var edit = el('button', 'bus-link-btn', t('common.edit'));
      edit.type = 'button';
      edit.setAttribute('aria-label', t('common.editAria', { section: titleOf(sectionId) }));
      edit.addEventListener('click', function () { go(sectionId); });
      head.appendChild(edit);
      block.appendChild(head);
      var dl = el('dl');
      sectionQuestions(sectionId).forEach(function (q) {
        dl.appendChild(el('dt', '', qLabel(q)));
        var text = isEmptyAnswer(state.answers[q.id]) ? t('common.unanswered') : answerText(q);
        dl.appendChild(el('dd', 'bus-answer', text));
      });
      block.appendChild(dl);
      card.appendChild(block);
    });
    app.appendChild(card);
    var pages = pageList();
    app.appendChild(navBar(function () { go(pages[pages.length - 2]); }, t('common.submit'), function () { submit(); }));
    updateProgress();
    restoreMessages();
    focusHeading();
    return all;
  }

  function setSubmitting(value) {
    state.submitting = value;
    var next = document.getElementById('bus-next');
    var back = document.getElementById('bus-back-btn');
    if (next) {
      next.disabled = value;
      next.textContent = value ? t('common.submitting') : t('common.submit');
      next.setAttribute('aria-busy', value ? 'true' : 'false');
    }
    if (back) back.disabled = value;
  }

  /* 送信エラー：文言は key で保持し、言語切替後も選択言語で再表示する。 */
  function submitError(key, options) {
    state.submitMsgKey = key;
    var summary = document.getElementById('bus-summary');
    if (!summary) return;
    clear(summary);
    summary.hidden = false;
    summary.appendChild(el('p', 'bus-summary-title', t(key)));
    if (!(options && options.noScroll)) { try { summary.scrollIntoView({ block: 'center' }); } catch (e) { /* ignore */ } }
  }

  /* 言語切替で再描画したあと、表示中だった検証エラー・送信エラー・送信中の状態を選択言語で戻す。 */
  function restoreMessages() {
    if (Object.keys(state.shownErrors).length) showErrors(state.shownErrors, { noFocus: true });
    else if (state.submitMsgKey) submitError(state.submitMsgKey, { noScroll: true });
    if (state.submitting) setSubmitting(true);
  }

  /* ── payload / 送信 ── */
  function channelFromUrl() {
    try {
      var value = new URLSearchParams(window.location.search).get('src');
      return value && CHANNELS.indexOf(value) !== -1 ? value : null;
    } catch (e) { return null; }
  }

  function buildPayload() {
    // 送信前に Frontend だけが sanitize する。server は受信payloadをそのまま検証する。
    var sanitized = core.sanitizeAnswers(schema, state.answers, state.otherTexts);
    var payload = {
      schema_version: schema.schema_version,
      uuid: getUuid(),
      answers: sanitized.answers,
      other_texts: sanitized.other_texts,
      elapsed_ms: Math.max(0, Date.now() - (state.startedAt || Date.now()))
    };
    var channel = channelFromUrl();
    if (channel) payload.source_channel = channel;
    if (testMode === 'submit_excluded') {
      var test = testStore.read();
      if (test && test.token) {
        payload.test_token = test.token;
        payload.test_run_id = test.run;
      }
    }
    return payload;
  }

  function submit() {
    if (state.submitting || state.finished) return;
    var all = validateAll();
    if (!all.ok) {
      var firstPage = null;
      var firstMap = null;
      visibleSections().forEach(function (sectionId) {
        if (firstPage) return;
        var map = errorsForSection(sectionId, all);
        if (Object.keys(map).length) { firstPage = sectionId; firstMap = map; }
      });
      trackError('validation');
      if (firstPage) { go(firstPage); showErrors(firstMap); }
      else submitError('submit.invalid');
      return;
    }
    if (core.findTermination(schema, state.answers)) { showIneligible(); return; }

    if (testMode === 'preview_no_submit') { showCompletion('preview'); return; }
    if (testMode === 'closed_view') { showClosed(); return; }
    var endpoint = getEndpoint();
    if (!endpoint) { submitError('submit.preparing'); return; }
    if (testMode === 'submit_excluded' && !(testStore.read() && testStore.read().token)) {
      submitError('submit.testConfigMissing');
      return;
    }

    var payload = buildPayload();
    state.submitMsgKey = null;
    setSubmitting(true);
    var errorType = 'network';
    fetch(endpoint, { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'text/plain;charset=utf-8' } })
      .then(function (response) {
        if (!response.ok) { errorType = 'server'; throw new Error('http'); }
        return response.json();
      })
      .then(function (body) { handleResponse(body || {}); })
      .catch(function () {
        trackError(errorType);
        setSubmitting(false);
        submitError('submit.networkFailed');
      });
  }

  function handleResponse(body) {
    if (body.ok === true) {
      if (body.status === 'ineligible') { showIneligible(); return; }
      state.finished = true;
      if (body.status === 'accepted_test') { showCompletion('test'); return; }
      showCompletion('production');
      trackSubmit(); // server 保存成功後だけ（test mode では analytics() が null）
      return;
    }
    var code = body.error || 'unknown';
    setSubmitting(false);
    if (code === 'duplicate_submission') {
      state.finished = true;
      showCompletion(testMode === 'submit_excluded' ? 'test_duplicate' : 'duplicate');
    } else if (code === 'survey_closed') {
      trackError('survey_closed'); state.finished = true; showClosed();
    } else if (code === 'survey_not_open') {
      trackError('survey_not_open'); state.finished = true; showNotOpen();
    } else if (code === 'survey_not_configured') {
      trackError('survey_not_configured'); state.finished = true; showPreparing();
    } else if (code === 'schema_mismatch') {
      trackError('schema_mismatch'); state.finished = true; showUpdateNeeded();
    } else if (code === 'invalid_request') {
      trackError('invalid_request'); handleInvalidRequest(body);
    } else {
      trackError('server');
      submitError('submit.serverFailed');
    }
  }

  var ENVELOPE_MESSAGES = {
    'elapsed_ms:too_fast': 'submit.tooFast',
    'uuid:invalid_uuid': 'submit.invalidUuid',
    'test_token:invalid_token': 'submit.invalidToken',
    'test_run_id:invalid_test_run_id': 'submit.invalidRunId'
  };
  var GENERIC_INVALID = 'submit.genericInvalid';

  function handleInvalidRequest(body) {
    var fields = Array.isArray(body.fields) ? body.fields : [];
    var firstPage = null;
    var map = {};
    fields.forEach(function (f) {
      var qid = String(f.field);
      var q = core.getQuestion(schema, qid);
      if (!q) return;
      if (core.isVisible(schema, qid, state.answers)) {
        if (!firstPage) firstPage = q.section;
        if (q.section === firstPage && !map[qid]) map[qid] = f.code;
      }
    });
    if (firstPage) { go(firstPage); showErrors(map); return; }
    var message = GENERIC_INVALID;
    for (var i = 0; i < fields.length; i++) {
      var key = String(fields[i].field) + ':' + String(fields[i].code);
      if (Object.prototype.hasOwnProperty.call(ENVELOPE_MESSAGES, key)) { message = ENVELOPE_MESSAGES[key]; break; }
    }
    submitError(message);
  }

  /* ── 完了・状態表示 ──
   * 画面は spec（文言の key）で保持し、言語切替のたびに選択言語で描き直す。 */
  function showMessage(spec) {
    view = { message: spec };
    shell();
    var box = el('section', 'bus-message ' + (spec.kind === 'ok' ? 'bus-ok' : 'bus-warn'));
    box.setAttribute('role', 'status');
    box.setAttribute('aria-labelledby', 'bus-page-title');
    if (spec.test) box.appendChild(el('p', 'bus-test-chip', t('test.chip')));
    box.appendChild(heading(t(spec.title)));
    spec.lines.forEach(function (key) { box.appendChild(el('p', '', t(key))); });
    if (spec.results) {
      var p = el('p');
      var a = el('a', 'bus-link', t('common.resultsLink'));
      a.href = RESULTS_URL;
      p.appendChild(a);
      box.appendChild(p);
    }
    app.appendChild(box);
    var back = el('p');
    var link = el('a', 'bus-link', t('common.backToClub'));
    link.href = './';
    back.appendChild(link);
    app.appendChild(back);
    focusHeading();
  }

  function showCompletion(kind) {
    state.finished = true;
    state.shown.percent = 100;
    var results = !!RESULTS_URL;
    if (kind === 'preview') {
      showMessage({ kind: 'ok', title: 'test.preview.title', lines: ['test.preview.line'], test: true });
    } else if (kind === 'test') {
      showMessage({ kind: 'ok', title: 'test.submitted.title', lines: ['test.submitted.line'], test: true });
    } else if (kind === 'test_duplicate') {
      showMessage({ kind: 'warn', title: 'test.duplicate.title', lines: ['test.duplicate.line'], test: true });
    } else if (kind === 'duplicate') {
      showMessage({ kind: 'ok', title: 'done.duplicate.title', lines: ['done.duplicate.line'], results: results });
    } else {
      showMessage({ kind: 'ok', title: 'done.thanks.title', lines: ['done.thanks.line'], results: results });
    }
  }
  function showClosed() {
    state.finished = true;
    showMessage({ kind: 'warn', title: 'done.closed.title', lines: ['done.closed.line'] });
  }
  function showNotOpen() {
    showMessage({ kind: 'warn', title: 'done.notOpen.title', lines: ['done.notOpen.line'] });
  }
  function showPreparing() {
    showMessage({ kind: 'warn', title: 'done.preparing.title', lines: ['done.preparing.line'] });
  }
  function showUpdateNeeded() {
    showMessage({ kind: 'warn', title: 'done.updateNeeded.title', lines: ['done.updateNeeded.line'] });
  }
  function showIneligible() {
    // 18歳未満相当：回答内容はここで破棄する。server へは何も送らない。
    state.answers = {};
    state.otherTexts = {};
    state.finished = true;
    showMessage({ kind: 'warn', title: 'done.ineligible.title', lines: ['done.ineligible.line'] });
  }

  /* ── status API ── */
  function fetchStatus() {
    var endpoint = getEndpoint();
    var url = endpoint + (endpoint.indexOf('?') === -1 ? '?' : '&') + 'action=status';
    return fetch(url, { method: 'GET', cache: 'no-store' }).then(function (response) {
      if (!response.ok) throw new Error('http');
      return response.json();
    });
  }

  /* test 指定を検出したのに検証できない：GA4なし・status GETなし・POSTなしで案内だけを表示する（fail closed）。 */
  function showInvalidTestConfig() {
    state.finished = true;
    showMessage({ kind: 'warn', title: 'test.invalid.title', lines: ['test.invalid.line1', 'test.invalid.line2'], test: true });
  }

  function renderLoading() {
    view = { loading: true };
    shell();
    app.appendChild(el('p', 'bus-lead', t('common.checkingStatus')));
  }

  function start() {
    if (testMode === INVALID_TEST) { showInvalidTestConfig(); return; }
    if (testMode === 'closed_view') { showClosed(); return; }
    if (testMode === 'preview_no_submit' || testMode === 'submit_excluded') { renderIntro(); return; }
    if (!getEndpoint()) { showPreparing(); return; }
    renderLoading();
    fetchStatus().then(function (status) {
      if (!status || status.ok !== true) throw new Error('status');
      if (String(status.schema_version) !== String(schema.schema_version)) { showUpdateNeeded(); return; }
      if (status.status === 'closed') { showClosed(); return; }
      if (status.status === 'not_open') { showNotOpen(); return; }
      if (status.status === 'not_configured') { showPreparing(); return; }
      renderIntro();
    }).catch(function () {
      // status に到達できなくてもフォームは表示する（最終判断は送信時に GAS が行う）。
      renderIntro();
    });
  }

  /* ── 言語選択（回答中いつでも切り替えられる。回答値・page・route は state に残り、表示だけを描き直す） ── */
  var langSelect = null;
  var langLabel = null;

  function buildLangSelector() {
    var host = document.getElementById('bus-lang');
    if (!host) return;
    clear(host);
    langLabel = el('label', 'bus-lang-label');
    langLabel.setAttribute('for', 'bus-lang-select');
    langSelect = document.createElement('select');
    langSelect.id = 'bus-lang-select';
    langSelect.className = 'bus-lang-select';
    I18N.locales.forEach(function (code) {
      var option = document.createElement('option');
      option.value = code;
      option.setAttribute('lang', code);
      option.textContent = LOCALE_NAMES[code] || code;
      langSelect.appendChild(option);
    });
    langSelect.addEventListener('change', function () { setLocale(langSelect.value); });
    host.appendChild(langLabel);
    host.appendChild(langSelect);
  }

  /* <html lang>・title・description・静的 HTML の文言（data-i18n）・言語選択を現在の言語へ合わせる。 */
  function applyDocumentLocale() {
    document.documentElement.setAttribute('lang', locale);
    document.title = t('page.title');
    var meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute('content', t('page.metaDescription'));
    Array.prototype.forEach.call(document.querySelectorAll('[data-i18n]'), function (node) {
      node.textContent = t(node.getAttribute('data-i18n'));
    });
    if (langLabel) langLabel.textContent = t('lang.label');
    if (langSelect) langSelect.value = locale;
  }

  function rerender() {
    var offset = 0;
    try { offset = window.pageYOffset || 0; } catch (e) { offset = 0; }
    state.relang = true;
    try {
      if (view && view.message) showMessage(view.message);
      else if (view && view.loading) renderLoading();
      else render();
    } finally {
      state.relang = false;
    }
    try { window.scrollTo(0, offset); } catch (e) { /* ignore */ }
    if (langSelect) langSelect.focus(); // 切替操作を続けられるよう、フォーカスは言語選択に残す
  }

  /* 選択言語を保持して描き直す。GA4・URL・payload には何も載せない。 */
  function setLocale(next) {
    if (!isSupported(next) || next === locale) { if (langSelect) langSelect.value = locale; return; }
    locale = next;
    storeLocale(next);
    applyDocumentLocale();
    rerender();
  }

  buildLangSelector();
  applyDocumentLocale();
  start();
})();
