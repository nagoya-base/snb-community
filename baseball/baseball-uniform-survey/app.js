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
 */
(function () {
  'use strict';

  var schema = SURVEY_SCHEMA;
  var core = SurveyCore;
  var FORM_NAME = 'baseball_uniform_survey';
  var UUID_KEY = 'snb_baseball_uniform_survey_uuid_v1';
  var RESULTS_URL = null; // 公開結果ページは #382。作成されるまでリンクを出さない。

  /* 見積もり表示用の定数（回答時間の目安。schema の estimatedMinutes と整合させる）。 */
  var SECONDS_PER_QUESTION = 15;
  var MAX_PERCENT_BEFORE_SUBMIT = 99;

  /* 画面上の見出し（UI 文言。設問・option・分岐は含まない）。schema の section ID と 1:1 で、欠けるとテストが失敗する。 */
  var SECTION_TITLES = {
    eligibility: '回答の前に',
    uniform: 'ユニフォームについて',
    club: '名古屋野球ユニ部について',
    nonattendee: 'キャッチボール会への関心',
    club_interest: 'ユニフォーム交流への関心',
    attendee: '参加された方へ',
    operations: 'キャッチボール会の運営について',
    activity_history: 'これまでのスポーツ活動',
    adult_activity: '運動について',
    profile: 'あなたについて',
    closing: '最後に'
  };

  var ERROR_MESSAGES = {
    required: 'この質問は回答が必要です。',
    other_text_required: '「その他」の内容を入力してください。',
    too_long: '文字数が上限を超えています。',
    invalid_text: '使用できない文字が含まれています。',
    exclusive_conflict: '一緒に選べない選択肢が選ばれています。',
    other_text_unexpected: '選択内容を確認してください。',
    invalid_option: '選択内容を確認してください。',
    invalid_type: '選択内容を確認してください。',
    duplicate_option: '選択内容を確認してください。',
    hidden_field: '選択内容を確認してください。',
    unknown_field: '選択内容を確認してください。'
  };

  var config = window.BASEBALL_UNIFORM_SURVEY_CONFIG || {};
  var endpoint = typeof config.endpoint === 'string' ? config.endpoint : '';
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
    banner: []
  };
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
  function titleOf(sectionId) { return SECTION_TITLES[sectionId] || ''; }

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
    legend.appendChild(el('span', 'bus-qtext', q.label));
    // required 表示は visible な設問にだけ描画する（hidden 設問は DOM に存在しない）。
    legend.appendChild(el('span', q.required ? 'bus-req' : 'bus-optional', q.required ? '必須' : '任意'));
    fieldset.appendChild(legend);
    if (q.helpText) fieldset.appendChild(el('p', 'bus-help', q.helpText));
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
      var label = el('label', '', '「その他」の内容');
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
      var ack = el('p', 'bus-ack', ackDef.message);
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
      list.appendChild(el('p', 'bus-help', '選択できる項目がありません。前の質問をご確認ください。'));
    }
    options.forEach(function (option) {
      var current = state.answers[q.id];
      var checked = type === 'radio' ? current === option.id : Array.isArray(current) && current.indexOf(option.id) !== -1;
      list.appendChild(optionRow(q, option, type, name, checked, function (input) {
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
      list.appendChild(optionRow(q, { id: point.id, label: point.value + '　' + point.label }, 'radio', name, state.answers[q.id] === point.id, function (input) {
        setAnswer(q, input.value);
        changed(q);
      }));
    });
    fieldset.appendChild(list);
    if (scale.notApplicable) {
      var na = el('div', 'bus-scale-na');
      na.appendChild(optionRow(q, scale.notApplicable, 'radio', name, state.answers[q.id] === scale.notApplicable.id, function (input) {
        setAnswer(q, input.value);
        changed(q);
      }));
      fieldset.appendChild(na);
    }
  }

  function renderText(q, fieldset, changed) {
    var inputId = uid('t');
    var textarea = document.createElement('textarea');
    textarea.id = inputId;
    textarea.className = 'bus-textarea';
    textarea.rows = 5;
    textarea.setAttribute('aria-label', q.label);
    if (typeof q.maxLength === 'number') textarea.maxLength = q.maxLength;
    textarea.value = state.answers[q.id] || '';
    var counter = el('p', 'bus-count');
    function updateCount() {
      counter.textContent = typeof q.maxLength === 'number' ? textarea.value.length + ' / ' + q.maxLength + '文字' : '';
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
    else fieldset.appendChild(el('p', 'bus-help', 'この質問は表示できません。'));
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
    box.setAttribute('aria-label', '回答の進み具合');
    var text = el('p', 'bus-progress-text');
    text.id = 'bus-progress-text';
    var bar = el('div', 'bus-bar');
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    bar.setAttribute('aria-label', '全体の進み具合');
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
      document.getElementById('bus-progress-text').textContent = '現在 ' + info.sectionIndex + ' セクション目　あなたに必要な質問だけを表示します';
      bar.removeAttribute('aria-valuenow');
      bar.setAttribute('aria-valuetext', '回答に応じて質問が決まります');
      bar.firstChild.style.width = '0%';
      return;
    }
    var parts = ['現在 ' + info.sectionIndex + '/' + info.sectionTotal + ' セクション', '全体の約' + info.percent + '%'];
    parts.push(info.minutes === 0 ? 'まもなく完了' : '残り約' + info.minutes + '分');
    document.getElementById('bus-progress-text').textContent = parts.join('　');
    bar.setAttribute('aria-valuenow', String(info.percent));
    bar.setAttribute('aria-valuetext', '全体の約' + info.percent + '%');
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
          messages.push(m.message);
        }
      }
    });
    state.banner.forEach(function (text) { if (messages.indexOf(text) === -1) messages.push(text); });
    var route = schema.routeUx && schema.routeUx.pure_uniform_short_route;
    if (route && route.messageBeforeProfile && sectionId === 'profile' && core.evalCondition(schema, route.trigger, state.answers)) {
      messages.push(route.messageBeforeProfile);
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
      if (target) out.push(m.message);
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
    var fieldset = document.querySelector('fieldset[data-qid="' + qid + '"]');
    if (!fieldset) return;
    var slot = fieldset.querySelector('.bus-err');
    if (slot) { slot.hidden = true; slot.textContent = ''; }
    fieldset.classList.remove('bus-has-error');
    Array.prototype.forEach.call(fieldset.querySelectorAll('input, textarea'), function (i) { i.removeAttribute('aria-invalid'); });
    var summary = document.getElementById('bus-summary');
    if (summary && !document.querySelector('.bus-has-error')) { summary.hidden = true; clear(summary); }
  }

  function messageFor(code) { return ERROR_MESSAGES[code] || '入力内容を確認してください。'; }

  /* errors: {questionId: code}。要約（role=alert）と個別エラー（aria-live）を出し、最初の誤りへフォーカスする。 */
  function showErrors(errors) {
    var ids = Object.keys(errors);
    var summary = document.getElementById('bus-summary');
    if (summary) {
      clear(summary);
      summary.hidden = ids.length === 0;
      if (ids.length) {
        summary.appendChild(el('p', 'bus-summary-title', '入力内容を確認してください（' + ids.length + '件）'));
        var list = el('ul');
        ids.forEach(function (id) {
          var q = core.getQuestion(schema, id);
          var item = el('li');
          var link = el('a', '', (q ? q.label : '') + '：' + messageFor(errors[id]));
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
    if (ids.length) focusQuestion(ids[0]);
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
  var TEST_LABELS = {
    invalid_test_config: 'TEST MODE（設定エラー）：テスト用URLの設定が正しくありません。回答・送信・計測は行いません。',
    preview_no_submit: 'TEST MODE（プレビュー）：送信しても回答は保存されず、通信もしません。',
    closed_view: 'TEST MODE（終了後表示の確認）：受付終了の表示だけを確認できます。',
    submit_excluded: 'TEST MODE（テスト送信）：サーバーへ送信しますが、本番の集計・公開結果・通知には入りません。'
  };
  function testBanner() {
    var banner = el('div', 'bus-test-banner');
    banner.id = 'bus-test-banner';
    banner.setAttribute('role', 'status');
    banner.appendChild(el('span', '', TEST_LABELS[testMode]));
    var exit = el('button', 'bus-test-exit', 'テストを終了');
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
    var h = document.getElementById('bus-page-title');
    if (h) h.focus();
    scrollTop();
  }

  function navBar(onBack, nextLabel, onNext, backLabel) {
    var nav = el('div', 'bus-nav');
    var inner = el('div', 'bus-nav-inner');
    if (onBack) {
      var back = el('button', 'bus-btn bus-secondary', backLabel || '戻る');
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
    shell();
    var card = el('section', 'bus-card');
    card.setAttribute('aria-labelledby', 'bus-page-title');
    card.appendChild(heading('回答の前にご確認ください'));
    card.appendChild(el('p', 'bus-lead', '名古屋野球ユニ部の今後の運営・企画をよりよくするための匿名アンケートです。'));
    card.appendChild(noteList([
      '対象は18歳以上の方です。',
      '所要時間は' + schema.respondentNotice.estimatedMinutes.min + '〜' + schema.respondentNotice.estimatedMinutes.max + '分程度です。興味のある内容や回答ルートによって質問数が変わります。',
      '個別の回答は公開しません。公開ページには集計結果だけを載せます。自由記述と、詳細な居住地域は公開しません。',
      'アクセス解析（GA4）には、回答内容・どの質問にどう答えたか・自由記述を送りません。',
      '個別の回答は、運営責任者1名のみが集計・運営改善の目的で確認する場合があります。',
      '匿名性を優先するため、送信後に特定の回答を本人確認して修正・削除することは原則できません。',
      '最後にまとめて送信する方式です。途中で離れた場合、回答内容はサーバーへ保存されません。',
      'このアンケートへの回答は、キャッチボール会への参加申込ではありません。',
      'SNS・Web等で回答を募っているため、結果は一般の人口全体を代表するものではありません。'
    ]));
    card.appendChild(el('p', 'bus-help', '参加についてのご相談は、問い合わせフォームからお願いします。'));
    app.appendChild(card);
    app.appendChild(navBar(null, '回答をはじめる', function () {
      state.startedAt = Date.now();
      trackStart();
      var first = visibleSections()[0];
      go(first);
    }));
    focusHeading();
  }

  function renderSection(sectionId) {
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
    app.appendChild(navBar(function () { go(pages[Math.max(0, index - 1)]); }, '次へ', function () { next(sectionId); }));
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
        if (scale.notApplicable && scale.notApplicable.id === id) return scale.notApplicable.label;
        var hit = scale.points.filter(function (p) { return p.id === id; })[0];
        return hit ? hit.value + '　' + hit.label : id;
      }
      var opt = options.filter(function (o) { return o.id === id; })[0];
      var text = opt ? opt.label : id;
      if (opt && (opt.other || opt.fromOther) && state.otherTexts[q.id] && q.type !== 'single_dynamic') text += '（' + state.otherTexts[q.id] + '）';
      return text;
    };
    return core.selectedIds(q, value).map(labelOf).join('、');
  }

  function renderReview() {
    shell();
    app.appendChild(progressNode());
    app.appendChild(summaryNode());
    var card = el('section', 'bus-card');
    card.setAttribute('aria-labelledby', 'bus-page-title');
    card.appendChild(heading('回答内容の確認'));
    card.appendChild(el('p', 'bus-lead', '内容をご確認のうえ、送信してください。送信後は、特定の回答を本人確認して修正・削除することは原則できません。'));
    var all = validateAll();
    visibleSections().forEach(function (sectionId) {
      var block = el('section', 'bus-review-block');
      var head = el('h3', '', titleOf(sectionId));
      var edit = el('button', 'bus-link-btn', '修正する');
      edit.type = 'button';
      edit.setAttribute('aria-label', titleOf(sectionId) + 'を修正する');
      edit.addEventListener('click', function () { go(sectionId); });
      head.appendChild(edit);
      block.appendChild(head);
      var dl = el('dl');
      sectionQuestions(sectionId).forEach(function (q) {
        dl.appendChild(el('dt', '', q.label));
        var text = isEmptyAnswer(state.answers[q.id]) ? '（未回答）' : answerText(q);
        dl.appendChild(el('dd', 'bus-answer', text));
      });
      block.appendChild(dl);
      card.appendChild(block);
    });
    app.appendChild(card);
    var pages = pageList();
    app.appendChild(navBar(function () { go(pages[pages.length - 2]); }, 'この内容で送信する', function () { submit(); }));
    updateProgress();
    focusHeading();
    return all;
  }

  function setSubmitting(value) {
    state.submitting = value;
    var next = document.getElementById('bus-next');
    var back = document.getElementById('bus-back-btn');
    if (next) {
      next.disabled = value;
      next.textContent = value ? '送信中…' : 'この内容で送信する';
      next.setAttribute('aria-busy', value ? 'true' : 'false');
    }
    if (back) back.disabled = value;
  }

  function submitError(message) {
    var summary = document.getElementById('bus-summary');
    if (!summary) return;
    clear(summary);
    summary.hidden = false;
    summary.appendChild(el('p', 'bus-summary-title', message));
    try { summary.scrollIntoView({ block: 'center' }); } catch (e) { /* ignore */ }
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
      else submitError('入力内容を確認してください。');
      return;
    }
    if (core.findTermination(schema, state.answers)) { showIneligible(); return; }

    if (testMode === 'preview_no_submit') { showCompletion('preview'); return; }
    if (testMode === 'closed_view') { showClosed(); return; }
    if (!endpoint) { submitError('現在このアンケートは準備中のため、送信できません。'); return; }
    if (testMode === 'submit_excluded' && !(testStore.read() && testStore.read().token)) {
      submitError('テストの設定を確認できません。テスト用のURLから開き直してください。');
      return;
    }

    var payload = buildPayload();
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
        submitError('送信に失敗しました。通信環境をご確認のうえ、もう一度お試しください。入力内容は保持されています。');
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
      submitError('送信に失敗しました。時間をおいてもう一度お試しください。入力内容は保持されています。');
    }
  }

  var ENVELOPE_MESSAGES = {
    'elapsed_ms:too_fast': '回答が早すぎるため送信できませんでした。内容をご確認のうえ、少し時間をおいてもう一度お試しください。',
    'uuid:invalid_uuid': 'ブラウザ情報を確認できませんでした。ページを再読み込みしてもう一度お試しください。',
    'test_token:invalid_token': 'テスト用の設定が正しくありません。管理者から共有されたテスト用URLで開き直してください。',
    'test_run_id:invalid_test_run_id': 'テスト実行IDの形式が正しくありません。テスト用URLを確認してください。'
  };
  var GENERIC_INVALID = '入力内容に不備があるため送信できませんでした。内容をご確認ください。';

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

  /* ── 完了・状態表示 ── */
  function showMessage(kind, title, lines, options) {
    shell();
    var box = el('section', 'bus-message ' + (kind === 'ok' ? 'bus-ok' : 'bus-warn'));
    box.setAttribute('role', 'status');
    box.setAttribute('aria-labelledby', 'bus-page-title');
    if (options && options.test) box.appendChild(el('p', 'bus-test-chip', 'TEST'));
    box.appendChild(heading(title));
    lines.forEach(function (line) { box.appendChild(el('p', '', line)); });
    if (options && options.link) {
      var p = el('p');
      var a = el('a', 'bus-link', options.link.text);
      a.href = options.link.href;
      p.appendChild(a);
      box.appendChild(p);
    }
    app.appendChild(box);
    var back = el('p');
    var link = el('a', 'bus-link', '名古屋野球ユニ部のページへ戻る');
    link.href = './';
    back.appendChild(link);
    app.appendChild(back);
    focusHeading();
  }

  function showCompletion(kind) {
    state.finished = true;
    state.shown.percent = 100;
    var results = RESULTS_URL ? { link: { text: '公開結果のページへ', href: RESULTS_URL } } : {};
    if (kind === 'preview') {
      showMessage('ok', 'プレビュー完了（回答は送信・保存されていません）', ['これは送信完了画面の確認用です。サーバーへは何も送っていません。'], { test: true });
    } else if (kind === 'test') {
      showMessage('ok', 'テスト送信を受け付けました（集計対象外）', ['これはテスト送信です。本番の回答件数・公開結果・通知には含まれません。'], { test: true });
    } else if (kind === 'test_duplicate') {
      showMessage('warn', 'このテスト実行では送信済みです', ['同じテスト実行IDでは、本番と同じ重複抑止が働きます。もう一度試す場合は、新しいテスト実行IDでテスト用URLを開き直してください。'], { test: true });
    } else if (kind === 'duplicate') {
      showMessage('ok', '回答はすでに受付済みです', ['このブラウザからのご回答は受け付けています。ご協力ありがとうございました。'], results);
    } else {
      showMessage('ok', 'ご回答ありがとうございました',
        ['回答を受け付けました。ご協力ありがとうございました。公開ページには、個別の回答ではなく集計結果だけを掲載します。'], results);
    }
  }
  function showClosed() {
    state.finished = true;
    showMessage('warn', 'アンケートの受付は終了しました', ['たくさんのご協力をありがとうございました。'], null);
  }
  function showNotOpen() {
    showMessage('warn', 'アンケートはまだ始まっていません', ['受付開始まで、もうしばらくお待ちください。']);
  }
  function showPreparing() {
    showMessage('warn', '現在準備中です', ['このアンケートはまだ公開前です。公開までしばらくお待ちください。']);
  }
  function showUpdateNeeded() {
    showMessage('warn', 'ページが古くなっています', ['アンケートの内容が更新されました。ページを再読み込みしてから、もう一度回答してください。']);
  }
  function showIneligible() {
    // 18歳未満相当：回答内容はここで破棄する。server へは何も送らない。
    state.answers = {};
    state.otherTexts = {};
    state.finished = true;
    showMessage('warn', 'このアンケートは18歳以上の方が対象です', ['ご関心をお寄せいただきありがとうございます。回答内容は保存されていません。']);
  }

  /* ── status API ── */
  function fetchStatus() {
    var url = endpoint + (endpoint.indexOf('?') === -1 ? '?' : '&') + 'action=status';
    return fetch(url, { method: 'GET', cache: 'no-store' }).then(function (response) {
      if (!response.ok) throw new Error('http');
      return response.json();
    });
  }

  /* test 指定を検出したのに検証できない：GA4なし・status GETなし・POSTなしで案内だけを表示する（fail closed）。 */
  function showInvalidTestConfig() {
    state.finished = true;
    showMessage('warn', 'テスト用URLの設定が正しくありません',
      ['テスト用のURLを確認してください。管理者から共有されたURLを、そのままの形で開き直してください。', 'このページでは回答・送信・アクセス解析を行いません。通常の回答は、テスト指定のないURLから開いてください。'], { test: true });
  }

  function start() {
    if (testMode === INVALID_TEST) { showInvalidTestConfig(); return; }
    if (testMode === 'closed_view') { showClosed(); return; }
    if (testMode === 'preview_no_submit' || testMode === 'submit_excluded') { renderIntro(); return; }
    if (!endpoint) { showPreparing(); return; }
    shell();
    app.appendChild(el('p', 'bus-lead', '受付状況を確認しています…'));
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

  start();
})();
