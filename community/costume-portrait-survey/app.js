/*
 * 男性の衣装・ポートレート意識調査 Frontend（Issue #334）。
 * 設問・選択肢・分岐・検証は survey.generated.js（SURVEY_SCHEMA / SurveyCore。survey.schema.json から生成）
 * を使い、ここには設問をベタ書きしない。通信は既存 enquete_202609.html と同じ
 * fetch POST + Content-Type: text/plain（Public GAS）。受付の最終判断はGAS側が行う。
 *
 * ?test=1      保存・通信・GA4を一切行わない画面確認用
 * ?test=closed 受付終了表示の確認用
 */
(function () {
  'use strict';

  var schema = SURVEY_SCHEMA;
  var core = SurveyCore;
  var FORM_NAME = 'costume_portrait_survey';
  var UUID_KEY = 'snb_costume_portrait_survey_uuid_v1';
  var RESULTS_URL = 'costume-portrait-survey-results.html';

  var params = new URLSearchParams(window.location.search);
  var isTestMode = params.get('test') === '1';
  var previewClosed = params.get('test') === 'closed';
  var config = window.COSTUME_PORTRAIT_CONFIG || {};
  var endpoint = typeof config.endpoint === 'string' ? config.endpoint : '';

  var app = document.getElementById('cp-app');
  var state = {
    answers: {},
    otherTexts: {},
    ageConfirmed: false,
    page: 'intro',
    startedAt: Date.now(),
    submitting: false,
    finished: false
  };
  var uuid = null;
  var memoryUuid = null;

  /* ── GA4（既存 analytics.js のイベントのみ。回答内容・UUID・自由記述は送らない） ── */
  function analytics() { return isTestMode || previewClosed ? null : window.SNBAnalytics || null; }
  function trackError(type) { if (analytics()) analytics().trackFormError(FORM_NAME, type); }

  /* ── browser UUID ── */
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

  /* ── ページ構成：intro → 表示対象セクション → review ── */
  function pageList() {
    var pages = ['intro'];
    schema.sections.forEach(function (section) {
      if (core.isSectionVisible(schema, section.id, state.answers)) pages.push(section.id);
    });
    pages.push('review');
    return pages;
  }
  function sectionById(id) {
    for (var i = 0; i < schema.sections.length; i++) if (schema.sections[i].id === id) return schema.sections[i];
    return null;
  }

  /* 非表示になった設問の回答は state から取り除く（送信payloadに残さない） */
  function purgeHidden() {
    schema.questions.forEach(function (q) {
      if (!core.isVisible(schema, q.id, state.answers)) {
        delete state.answers[q.id];
        delete state.otherTexts[q.id];
      }
    });
  }

  function isEmpty(q, v) {
    if (v === undefined || v === null || v === '') return true;
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === 'object') return Object.keys(v).length === 0;
    return false;
  }
  function setAnswer(q, v) {
    if (isEmpty(q, v)) delete state.answers[q.id];
    else state.answers[q.id] = v;
  }

  /* ── 設問描画 ── */
  function optionInput(q, option, type, name) {
    var label = el('label', 'cp-opt');
    var input = document.createElement('input');
    input.type = type;
    input.name = name;
    input.value = option.id;
    var value = state.answers[q.id];
    input.checked = type === 'radio' ? value === option.id : Array.isArray(value) && value.indexOf(option.id) !== -1;
    label.appendChild(input);
    label.appendChild(el('span', '', option.label));
    return label;
  }

  function renderChoice(q, fieldset) {
    var type = q.type === 'single' ? 'radio' : 'checkbox';
    var options = core.getOptions(schema, q);
    var priority = [];
    var rest = options;
    if (q.priorityFrom) {
      var source = core.getQuestion(schema, q.priorityFrom);
      var chosen = core.selectedIds(source, state.answers[q.priorityFrom]);
      var inPriority = options.filter(function (o) { return chosen.indexOf(o.id) !== -1; });
      if (inPriority.length) {
        priority = inPriority;
        rest = options.filter(function (o) { return inPriority.indexOf(o) === -1; });
      }
    }
    var list = el('div', 'cp-options');
    (priority.length ? priority : options).forEach(function (o) { list.appendChild(optionInput(q, o, type, 'q_' + q.id)); });
    if (priority.length) {
      fieldset.appendChild(el('p', 'cp-priority-label', '先ほど「興味がある」と答えた候補を上に表示しています'));
      fieldset.appendChild(list);
      if (rest.length) {
        var more = el('details', 'cp-more');
        more.appendChild(el('summary', '', 'ほかの候補も選ぶ'));
        var moreList = el('div', 'cp-options');
        rest.forEach(function (o) { moreList.appendChild(optionInput(q, o, type, 'q_' + q.id)); });
        more.appendChild(moreList);
        var restIds = rest.map(function (o) { return o.id; });
        var current = core.selectedIds(q, state.answers[q.id]);
        if (current.some(function (id) { return restIds.indexOf(id) !== -1; })) more.open = true;
        fieldset.appendChild(more);
      }
    } else {
      fieldset.appendChild(list);
    }
    if (options.some(function (o) { return o.other; })) {
      var other = el('div', 'cp-other');
      other.setAttribute('data-other-for', q.id);
      var label = el('label', '', 'その他の内容（必須）');
      var input = document.createElement('input');
      input.type = 'text';
      input.className = 'cp-text';
      input.setAttribute('data-other-input', q.id);
      input.autocomplete = 'off';
      input.value = state.otherTexts[q.id] || '';
      label.appendChild(input);
      other.appendChild(label);
      other.hidden = core.selectedIds(q, state.answers[q.id]).indexOf('other') === -1;
      fieldset.appendChild(other);
    }
  }

  function renderMatrix(q, fieldset) {
    var wrap = el('div', 'cp-matrix');
    var value = state.answers[q.id] || {};
    q.rows.forEach(function (row) {
      var box = el('div', 'cp-matrix-row');
      box.appendChild(el('p', '', row.label));
      var scale = el('div', 'cp-scale');
      q.scale.forEach(function (s) {
        var label = el('label', 'cp-opt');
        var input = document.createElement('input');
        input.type = 'radio';
        input.name = 'q_' + q.id + '__' + row.id;
        input.value = s.id;
        input.setAttribute('data-matrix-row', row.id);
        input.checked = value[row.id] === s.id;
        label.appendChild(input);
        label.appendChild(el('span', '', s.label));
        scale.appendChild(label);
      });
      box.appendChild(scale);
      wrap.appendChild(box);
    });
    fieldset.appendChild(wrap);
  }

  function renderText(q, fieldset) {
    var area = document.createElement(q.multiline === false ? 'input' : 'textarea');
    if (q.multiline === false) area.type = 'text';
    area.autocomplete = 'off';
    area.className = q.multiline === false ? 'cp-text' : 'cp-textarea';
    area.name = 'q_' + q.id;
    area.value = state.answers[q.id] || '';
    area.setAttribute('data-text-input', q.id);
    fieldset.appendChild(area);
    var counter = el('div', 'cp-count', core.charLength(area.value) + ' / ' + q.maxLength);
    counter.setAttribute('data-count-for', q.id);
    fieldset.appendChild(counter);
  }

  function renderQuestion(q) {
    var fieldset = el('fieldset', 'cp-q');
    fieldset.setAttribute('data-qid', q.id);
    var legend = el('legend');
    legend.appendChild(el('span', 'cp-qno', q.no));
    legend.appendChild(document.createTextNode(q.label));
    legend.appendChild(el('span', q.required ? 'cp-req' : 'cp-opt-tag', q.required ? '必須' : '任意'));
    fieldset.appendChild(legend);
    if (q.help) fieldset.appendChild(el('p', 'cp-help', q.help));
    if (q.type === 'matrix') renderMatrix(q, fieldset);
    else if (q.type === 'text') renderText(q, fieldset);
    else renderChoice(q, fieldset);
    var err = el('p', 'cp-err');
    err.setAttribute('role', 'alert');
    err.hidden = true;
    fieldset.appendChild(err);
    fieldset.hidden = !core.isVisible(schema, q.id, state.answers);
    return fieldset;
  }

  /* ── 入力 → state ── */
  function onFormEvent(event) {
    var target = event.target;
    if (!target || state.finished) return;
    if (target.id === 'cp-age') {
      state.ageConfirmed = target.checked;
      startedTracking();
      return;
    }
    var fieldset = target.closest ? target.closest('fieldset[data-qid]') : null;
    if (!fieldset) return;
    startedTracking();
    var q = core.getQuestion(schema, fieldset.getAttribute('data-qid'));
    if (target.hasAttribute('data-other-input')) {
      state.otherTexts[q.id] = target.value;
      return;
    }
    if (target.hasAttribute('data-text-input')) {
      setAnswer(q, target.value);
      var counter = fieldset.querySelector('[data-count-for]');
      if (counter) counter.textContent = core.charLength(target.value) + ' / ' + q.maxLength;
      return;
    }
    if (q.type === 'single') {
      setAnswer(q, target.value);
    } else if (q.type === 'multi') {
      var ids = Array.prototype.map.call(fieldset.querySelectorAll('input[type="checkbox"]:checked'), function (i) { return i.value; });
      // 排他的な選択肢（「特にない」等）は他と同時に選べない。
      var options = core.getOptions(schema, q);
      var changed = options.filter(function (o) { return o.id === target.value; })[0];
      if (target.checked && changed && changed.exclusive) {
        ids = [changed.id];
      } else if (target.checked) {
        var exclusiveIds = options.filter(function (o) { return o.exclusive; }).map(function (o) { return o.id; });
        ids = ids.filter(function (id) { return exclusiveIds.indexOf(id) === -1; });
      }
      Array.prototype.forEach.call(fieldset.querySelectorAll('input[type="checkbox"]'), function (i) { i.checked = ids.indexOf(i.value) !== -1; });
      // 並び順はschema順に揃える
      setAnswer(q, options.map(function (o) { return o.id; }).filter(function (id) { return ids.indexOf(id) !== -1; }));
    } else if (q.type === 'matrix') {
      var matrix = state.answers[q.id] || {};
      matrix[target.getAttribute('data-matrix-row')] = target.value;
      state.answers[q.id] = matrix;
    }
    afterAnswerChange();
  }

  /* 回答変更後：分岐の表示/非表示、「その他」入力欄、進捗を更新 */
  function afterAnswerChange() {
    purgeHidden();
    var form = document.getElementById('cp-form');
    if (!form) return;
    Array.prototype.forEach.call(form.querySelectorAll('fieldset[data-qid]'), function (fs) {
      var q = core.getQuestion(schema, fs.getAttribute('data-qid'));
      var visible = core.isVisible(schema, q.id, state.answers);
      if (!visible && !fs.hidden) {
        Array.prototype.forEach.call(fs.querySelectorAll('input'), function (i) { if (i.type === 'checkbox' || i.type === 'radio') i.checked = false; else i.value = ''; });
        Array.prototype.forEach.call(fs.querySelectorAll('textarea'), function (t) { t.value = ''; });
      }
      fs.hidden = !visible;
      var other = fs.querySelector('[data-other-for]');
      if (other) {
        var show = visible && core.selectedIds(q, state.answers[q.id]).indexOf('other') !== -1;
        other.hidden = !show;
        if (!show) { delete state.otherTexts[q.id]; var inp = other.querySelector('input'); if (inp) inp.value = ''; }
      }
    });
    updateProgress();
  }

  var tracked = false;
  function startedTracking() {
    if (tracked) return;
    tracked = true;
    if (analytics()) analytics().trackFormStart(FORM_NAME);
  }

  /* ── 検証・エラー表示 ── */
  var MESSAGES = {
    required: '選択または入力してください',
    other_text_required: '「その他」の内容を入力してください',
    too_long: '文字数が上限を超えています',
    exclusive_conflict: 'この選択肢は他の選択肢と同時に選べません',
    invalid_text: '使用できない文字が含まれています'
  };
  function messageFor(code) { return MESSAGES[code] || '入力内容を確認してください'; }

  function validateAll() { return core.validateAnswers(schema, state.answers, state.otherTexts); }

  function errorsForQuestions(result, qids) {
    var map = {};
    result.errors.forEach(function (e) {
      var qid = String(e.field).split('.')[0];
      if (qids.indexOf(qid) !== -1 && !map[qid]) map[qid] = e.code;
    });
    return map;
  }

  function showErrors(map) {
    var first = null;
    Array.prototype.forEach.call(document.querySelectorAll('fieldset[data-qid]'), function (fs) {
      var qid = fs.getAttribute('data-qid');
      var err = fs.querySelector('.cp-err');
      if (!err) return;
      if (map[qid]) {
        err.textContent = messageFor(map[qid]);
        err.hidden = false;
        fs.classList.add('cp-has-error');
        if (!first) first = fs;
      } else {
        err.hidden = true;
        fs.classList.remove('cp-has-error');
      }
    });
    if (first) focusElement(first);
  }

  function focusElement(node) {
    var focusable = node.querySelector('input:not([type="hidden"]), textarea');
    try { node.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* ignore */ }
    if (focusable) { try { focusable.focus({ preventScroll: true }); } catch (e) { focusable.focus(); } }
  }

  function validatePage(pageId) {
    if (pageId === 'intro') {
      var ageErr = document.getElementById('cp-age-error');
      if (!state.ageConfirmed) {
        ageErr.hidden = false;
        focusElement(document.getElementById('cp-age-box'));
        trackError('validation');
        return false;
      }
      ageErr.hidden = true;
      return true;
    }
    var section = sectionById(pageId);
    if (!section) return true;
    var map = errorsForQuestions(validateAll(), section.questions);
    showErrors(map);
    if (Object.keys(map).length) { trackError('validation'); return false; }
    return true;
  }

  /* ── 画面 ── */
  function updateProgress() {
    var pages = pageList();
    var index = Math.max(0, pages.indexOf(state.page));
    var text = document.getElementById('cp-progress-text');
    var bar = document.getElementById('cp-progress-fill');
    if (!text || !bar) return;
    var current = index + 1;
    text.textContent = '';
    text.appendChild(el('span', '', (state.page === 'intro' ? 'はじめに' : state.page === 'review' ? '送信前の確認' : sectionById(state.page).title)));
    text.appendChild(el('span', '', current + ' / ' + pages.length));
    bar.style.width = Math.round(current / pages.length * 100) + '%';
    var progress = document.getElementById('cp-progress');
    progress.setAttribute('aria-valuenow', String(current));
    progress.setAttribute('aria-valuemax', String(pages.length));
  }

  function shell() {
    clear(app);
    var hero = el('header', 'cp-hero');
    var heroImg = el('img', 'cp-hero-img');
    heroImg.src = '../images/community/costume-portrait-survey/hero-main.webp';
    heroImg.alt = '男性向けポトレ意識調査。ユニフォーム×スーツ×男性ポートレート。野球ユニフォーム姿とスーツ姿の男性と「あなたが撮られたい一着を教えてください 匿名アンケート」の文字';
    heroImg.width = 1200; heroImg.height = 600;
    heroImg.setAttribute('fetchpriority', 'high');
    hero.appendChild(heroImg);
    hero.appendChild(el('h1', '', schema.title));
    hero.appendChild(el('p', 'cp-sub', schema.subtitle));
    app.appendChild(hero);
  }

  function renderFlow() {
    shell();
    var progress = el('div', 'cp-progress');
    progress.id = 'cp-progress';
    progress.setAttribute('role', 'progressbar');
    progress.setAttribute('aria-valuemin', '1');
    progress.setAttribute('aria-label', '回答の進捗');
    var text = el('div', 'cp-progress-text');
    text.id = 'cp-progress-text';
    var bar = el('div', 'cp-progress-bar');
    var fill = document.createElement('i');
    fill.id = 'cp-progress-fill';
    bar.appendChild(fill);
    progress.appendChild(text);
    progress.appendChild(bar);
    app.appendChild(progress);

    var form = el('form');
    form.id = 'cp-form';
    form.setAttribute('novalidate', 'novalidate');
    form.addEventListener('change', onFormEvent);
    form.addEventListener('input', onFormEvent);
    form.addEventListener('submit', function (e) { e.preventDefault(); onNext(); });
    var body = el('div');
    body.id = 'cp-page';
    form.appendChild(body);
    app.appendChild(form);

    var nav = el('div', 'cp-nav');
    var inner = el('div', 'cp-nav-inner');
    var back = el('button', 'cp-btn cp-secondary', '戻る');
    back.type = 'button';
    back.id = 'cp-back';
    back.addEventListener('click', onBack);
    var next = el('button', 'cp-btn', '次へ');
    next.type = 'button';
    next.id = 'cp-next';
    next.addEventListener('click', onNext);
    inner.appendChild(back);
    inner.appendChild(next);
    nav.appendChild(inner);
    app.appendChild(nav);
    renderPage();
  }

  function renderPage() {
    var body = document.getElementById('cp-page');
    clear(body);
    var back = document.getElementById('cp-back');
    var next = document.getElementById('cp-next');
    back.hidden = state.page === 'intro';
    next.textContent = state.page === 'review' ? 'この内容で送信する' : '次へ';
    next.disabled = state.submitting;
    if (state.page === 'intro') renderIntro(body);
    else if (state.page === 'review') renderReview(body);
    else renderSection(body, sectionById(state.page));
    updateProgress();
    if (analytics() && sectionById(state.page)) analytics().trackSectionView(FORM_NAME + '_' + state.page);
    try { window.scrollTo(0, 0); } catch (e) { /* jsdom */ }
  }

  function renderIntro(body) {
    var card = el('div', 'cp-card');
    card.appendChild(el('p', '', 'ユニフォーム、スーツ、ラバー、下着など、みんな実際どんな衣装に興味がある？ 着たい？ 撮られたい？ 撮りたい？'));
    card.appendChild(el('p', 'cp-lead', '男性の衣装とポートレート撮影についての匿名アンケートです。集計結果の一部は公開し、みんなの傾向を一緒に見られる形にします。今後の撮影企画やスタジオ環境づくりの参考にもします。'));
    card.appendChild(el('p', 'cp-lead', '回答時間の目安：' + schema.estimatedMinutes + '（回答内容により設問数が変わります）。氏名・メールアドレスは聞きません。性的指向は任意です。'));
    body.appendChild(card);

    var box = el('div', 'cp-card');
    box.id = 'cp-age-box';
    var label = el('label', 'cp-opt');
    var input = document.createElement('input');
    input.type = 'checkbox';
    input.id = 'cp-age';
    input.name = 'age_confirmed';
    input.checked = state.ageConfirmed;
    label.appendChild(input);
    label.appendChild(el('span', '', '18歳以上です'));
    box.appendChild(label);
    var err = el('p', 'cp-err', '18歳以上の方のみ回答できます。チェックしてください。');
    err.id = 'cp-age-error';
    err.setAttribute('role', 'alert');
    err.hidden = true;
    box.appendChild(err);
    body.appendChild(box);

    // honeypot：人間には見えない欄（botが入力するとサーバー側で拒否される）
    var hp = el('div', 'cp-hp');
    hp.setAttribute('aria-hidden', 'true');
    var hpInput = document.createElement('input');
    hpInput.type = 'text';
    hpInput.name = 'website';
    hpInput.id = 'cp-website';
    hpInput.tabIndex = -1;
    hpInput.autocomplete = 'off';
    hp.appendChild(hpInput);
    body.appendChild(hp);
  }

  function renderSection(body, section) {
    var card = el('div', 'cp-card');
    card.appendChild(el('h2', '', section.title));
    if (section.description) card.appendChild(el('p', 'cp-lead', section.description));
    section.questions.forEach(function (id) { card.appendChild(renderQuestion(core.getQuestion(schema, id))); });
    body.appendChild(card);
  }

  function renderReview(body) {
    var card = el('div', 'cp-card');
    card.appendChild(el('h2', '', '送信前の確認'));
    card.appendChild(el('p', '', 'ここまでのご回答を送信します。送信後の修正はできません。'));
    card.appendChild(el('p', 'cp-lead', '個々の回答や自由記述は公開しません。公開するのは、十分な回答数が集まった後の匿名の集計結果の一部だけです。'));
    var err = el('p', 'cp-err');
    err.id = 'cp-submit-error';
    err.setAttribute('role', 'alert');
    err.hidden = true;
    card.appendChild(err);
    body.appendChild(card);
  }

  /* ── ナビゲーション ── */
  function go(pageId) {
    state.page = pageId;
    renderPage();
  }
  function onBack() {
    if (state.submitting) return;
    var pages = pageList();
    var i = pages.indexOf(state.page);
    if (i > 0) go(pages[i - 1]);
  }
  function onNext() {
    if (state.submitting || state.finished) return;
    if (state.page === 'review') { submit(); return; }
    if (!validatePage(state.page)) return;
    var pages = pageList();
    go(pages[pages.indexOf(state.page) + 1]);
  }

  /* ── 送信 ── */
  function buildPayload() {
    var hp = document.getElementById('cp-website');
    return {
      schema_version: schema.schema_version,
      uuid: getUuid(),
      age_confirmed: true,
      answers: state.answers,
      other_texts: state.otherTexts,
      website: hp ? hp.value : '',
      elapsed_ms: Math.max(0, Date.now() - state.startedAt)
    };
  }

  function submitError(message) {
    var err = document.getElementById('cp-submit-error');
    if (!err) return;
    err.textContent = message;
    err.hidden = false;
  }
  function setSubmitting(value) {
    state.submitting = value;
    var next = document.getElementById('cp-next');
    var back = document.getElementById('cp-back');
    if (next) { next.disabled = value; next.textContent = value ? '送信中…' : 'この内容で送信する'; next.setAttribute('aria-busy', value ? 'true' : 'false'); }
    if (back) back.disabled = value;
  }

  function submit() {
    var result = validateAll();
    if (!state.ageConfirmed) { go('intro'); validatePage('intro'); return; }
    if (!result.ok) {
      var firstPage = null;
      var firstMap = null;
      pageList().forEach(function (pageId) {
        if (firstPage || pageId === 'intro' || pageId === 'review') return;
        var map = errorsForQuestions(result, sectionById(pageId).questions);
        if (Object.keys(map).length) { firstPage = pageId; firstMap = map; }
      });
      trackError('validation');
      if (firstPage) { go(firstPage); showErrors(firstMap); }
      else submitError('入力内容を確認してください。');
      return;
    }
    if (isTestMode) { showCompletion(false); return; }
    if (!endpoint) { submitError('現在このアンケートは準備中です。'); return; }

    var payload = buildPayload();
    setSubmitting(true);
    var errorType = 'network';
    fetch(endpoint, { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'text/plain;charset=utf-8' } })
      .then(function (response) {
        if (!response.ok) { errorType = 'server'; throw new Error('http'); }
        return response.json();
      })
      .then(function (body) {
        if (body && body.ok === true) {
          state.finished = true;
          showCompletion(false);
          if (analytics()) analytics().track('survey_submit', { form_name: FORM_NAME });
          return;
        }
        var code = (body && body.error) || 'unknown';
        if (code === 'duplicate_submission') {
          // 保存済みで応答だけ失われた再送もここに来る。失敗ではなく「受付済み」として扱う。
          state.finished = true;
          showCompletion(true);
        } else if (code === 'survey_closed') {
          trackError('survey_closed');
          resolveClosedAfterSubmit();
        } else if (code === 'schema_mismatch') {
          trackError('schema_mismatch');
          setSubmitting(false);
          showUpdateNeeded();
        } else if (code === 'invalid_request') {
          trackError('invalid_request');
          setSubmitting(false);
          handleInvalidRequest(body);
        } else {
          trackError('server');
          setSubmitting(false);
          submitError('送信に失敗しました。時間をおいてもう一度お試しください。');
        }
      })
      .catch(function () {
        trackError(errorType);
        setSubmitting(false);
        submitError('送信に失敗しました。通信環境をご確認のうえ、もう一度お試しください。入力内容は保持されています。');
      });
  }

  function handleInvalidRequest(body) {
    var fields = body && Array.isArray(body.fields) ? body.fields : [];
    var targetPage = null;
    var map = {};
    fields.forEach(function (f) {
      var qid = String(f.field).split('.')[0];
      if (f.field === 'age_confirmed') { targetPage = targetPage || 'intro'; return; }
      schema.sections.forEach(function (section) {
        if (section.questions.indexOf(qid) !== -1) {
          targetPage = targetPage || section.id;
          if (!map[qid]) map[qid] = f.code;
        }
      });
    });
    if (targetPage && targetPage !== 'review') {
      if (targetPage === 'intro') {
        state.ageConfirmed = false;
        go('intro');
        validatePage('intro');
      } else {
        go(targetPage);
        showErrors(map);
      }
    } else {
      submitError('入力内容に不備があるため送信できませんでした。内容をご確認ください。');
    }
  }

  function resolveClosedAfterSubmit() {
    // 締切直前に送信→応答喪失→再送、のケース：実際に受付済みかstatusで確認する。
    fetchStatus().then(function (status) {
      state.finished = true;
      if (status && status.answered) showCompletion(true, true);
      else showClosed(false);
    }).catch(function () { state.finished = true; showClosed(false); });
  }

  /* ── 完了・状態表示 ── */
  function showMessage(kind, title, lines, extraLink) {
    shell();
    var box = el('div', 'cp-message ' + (kind === 'ok' ? 'cp-ok' : 'cp-warn'));
    box.setAttribute('role', 'status');
    box.appendChild(el('h2', '', title));
    lines.forEach(function (line) { box.appendChild(el('p', '', line)); });
    if (extraLink) {
      var p = el('p');
      var a = el('a', 'cp-link', extraLink.text);
      a.href = extraLink.href;
      p.appendChild(a);
      box.appendChild(p);
    }
    app.appendChild(box);
    var back = el('p');
    var link = el('a', 'cp-link', 'コミュニティトップへ戻る');
    link.href = './';
    back.appendChild(link);
    app.appendChild(back);
    try { window.scrollTo(0, 0); } catch (e) { /* jsdom */ }
  }

  function showCompletion(alreadyReceived, closed) {
    if (alreadyReceived) {
      showMessage('ok', '回答はすでに受付済みです',
        ['このブラウザからのご回答は受け付けています。ご協力ありがとうございました。'].concat(closed ? ['アンケートの受付は終了しました。'] : []),
        { text: '公開結果のページへ', href: RESULTS_URL });
    } else {
      showMessage('ok', 'ご回答ありがとうございました',
        ['回答を受け付けました。集計結果の一部は、回答数が十分に集まった後に公開します。'],
        { text: '公開結果のページへ', href: RESULTS_URL });
    }
  }
  function showClosed() {
    showMessage('warn', 'アンケートの受付は終了しました',
      ['たくさんのご回答ありがとうございました。結果は集計後に公開します。'],
      { text: '公開結果のページへ', href: RESULTS_URL });
  }
  function showUpdateNeeded() {
    showMessage('warn', 'ページが古くなっています',
      ['アンケートの内容が更新されました。ページを再読み込みしてから、もう一度回答してください。']);
  }
  function showPreparing() {
    showMessage('warn', '現在準備中です', ['このアンケートはまだ公開前です。公開までしばらくお待ちください。']);
  }

  /* ── status API ── */
  function fetchStatus() {
    var url = endpoint + (endpoint.indexOf('?') === -1 ? '?' : '&') + 'action=status&uuid=' + encodeURIComponent(getUuid());
    return fetch(url, { method: 'GET', cache: 'no-store' }).then(function (response) {
      if (!response.ok) throw new Error('http');
      return response.json();
    });
  }

  function start() {
    if (previewClosed) { showClosed(); return; }
    if (isTestMode) { renderFlow(); return; }
    if (!endpoint) { showPreparing(); return; }
    shell();
    app.appendChild(el('p', 'cp-lead', '受付状況を確認しています…'));
    fetchStatus().then(function (status) {
      if (!status || status.ok !== true) throw new Error('status');
      if (String(status.schema_version) !== String(schema.schema_version)) { showUpdateNeeded(); return; }
      if (status.answered) { state.finished = true; showCompletion(true, status.status === 'closed'); return; }
      if (status.status === 'closed') { state.finished = true; showClosed(); return; }
      renderFlow();
    }).catch(function () {
      // statusに到達できなくてもフォームは表示する（最終判断は送信時にGASが行う）。
      renderFlow();
    });
  }

  start();
})();
