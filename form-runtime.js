/*
 * SNBコミュニティ共通 フォームランタイム。
 * tools/form-builder/ で生成された公開ページ（community/*.html, baseball/*.html）から
 * `../form-runtime.js` として読み込まれ、埋め込み設定JSON(#snb-form-config)を元に
 * フォーム項目の描画・入力検証・確認画面・GAS送信・GA4計測を行う。
 *
 * DOM構築はすべて createElement / textContent で行い、innerHTML へ利用者入力を
 * 一切流し込まない（XSS対策）。
 *
 * ?test=1 … 保存・通知・GA4を一切行わない画面確認用（送信ボタンを押しても実送信しない）。
 * ?test=closed … 受付終了表示の確認用。こちらも実送信・GA4は行わない。
 * この2つのモードでは <head> 側の別スクリプトが既にGA4(gtag)自体を読み込んでいないため、
 * ここでは「GASへfetchしない」ことだけを担保すればよい。
 */
(function () {
  'use strict';

  var GAS_PLACEHOLDER = 'PLACEHOLDER_REPLACE_WITH_GAS_EXEC_URL';
  var WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];

  // dateStr("YYYY-MM-DD")をUTC真夜中として解釈し、UTCアクセサで読み戻す。
  // ローカルタイムゾーン変換を挟まないため、実行環境によらず同じ日付・曜日になる。
  function weekdayLabel(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr + 'T00:00:00Z');
    if (isNaN(d.getTime())) return '';
    return WEEKDAY_JA[d.getUTCDay()];
  }

  function formatDateLabel(dateStr) {
    var d = new Date(dateStr + 'T00:00:00Z');
    if (isNaN(d.getTime())) return dateStr;
    return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + '（' + weekdayLabel(dateStr) + '）';
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (attrs[k] == null || attrs[k] === false) return;
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k in node && k !== 'for') node[k] = attrs[k];
        else node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function analytics() {
    return window.SNBAnalytics || null;
  }

  var configEl = document.getElementById('snb-form-config');
  var root = document.getElementById('snb-form-root');
  if (!configEl || !root) return;

  var config;
  try {
    config = JSON.parse(configEl.textContent);
  } catch (e) {
    root.textContent = 'フォーム設定の読み込みに失敗しました。';
    return;
  }

  var isTestMode = !!window.SNB_TEST_MODE;
  var isClosedPreview = !!window.SNB_PREVIEW_CLOSED_MODE;
  var isPreviewLike = isTestMode || isClosedPreview;

  function questionOptions(q) {
    if (q.type === 'date_single' || q.type === 'date_multi') {
      return (config.dates || []).map(function (d) {
        return { value: d.key, label: (d.label ? d.label + ' ' : '') + formatDateLabel(d.date) };
      });
    }
    if (q.type === 'plan_single') {
      return (config.plans || []).map(function (p) { return { value: p.key, label: p.label }; });
    }
    return (q.options || []).filter(function (o) { return o && o.value; });
  }

  function requiredBadge(required) {
    return el('span', { class: required ? 'req-badge req-badge--required' : 'req-badge req-badge--optional', text: required ? '必須' : '任意' });
  }

  var state = { answers: {}, otherText: {}, phase: 'fields' };

  var formStarted = false;
  function markStarted() {
    if (formStarted) return;
    formStarted = true;
    if (analytics()) analytics().trackFormStart(config.slug || 'form');
  }

  function buildFieldControl(q) {
    var options = questionOptions(q);
    var hasOther = !!q.allowOther;
    var wrap = el('div', { class: 'snb-field' });

    if (q.type === 'text') {
      var input = el('input', { type: 'text', maxLength: 200, id: 'q-' + q.key });
      input.addEventListener('input', function () { state.answers[q.key] = input.value; markStarted(); });
      wrap.appendChild(input);
    } else if (q.type === 'textarea') {
      var ta = el('textarea', { maxLength: 1000, id: 'q-' + q.key, rows: 4 });
      ta.addEventListener('input', function () { state.answers[q.key] = ta.value; markStarted(); });
      wrap.appendChild(ta);
    } else if (q.type === 'select') {
      var sel = el('select', { id: 'q-' + q.key });
      sel.appendChild(el('option', { value: '', text: '選択してください' }));
      options.forEach(function (o) { sel.appendChild(el('option', { value: o.value, text: o.label })); });
      sel.addEventListener('change', function () { state.answers[q.key] = sel.value; markStarted(); });
      wrap.appendChild(sel);
    } else if (q.type === 'radio' || q.type === 'date_single' || q.type === 'plan_single') {
      var grid = el('div', { class: 'snb-choice-grid' });
      var allOptions = hasOther ? options.concat([{ value: '__other__', label: 'その他' }]) : options;
      allOptions.forEach(function (o) {
        var name = 'q-' + q.key;
        var radio = el('input', { type: 'radio', name: name, value: o.value });
        radio.addEventListener('change', function () {
          state.answers[q.key] = o.value;
          toggleOther(q, o.value === '__other__');
          markStarted();
        });
        grid.appendChild(el('label', { class: 'snb-choice' }, [radio, el('span', { text: o.label })]));
      });
      wrap.appendChild(grid);
    } else if (q.type === 'checkbox' || q.type === 'date_multi') {
      var cgrid = el('div', { class: 'snb-choice-grid' });
      state.answers[q.key] = state.answers[q.key] || [];
      var allOpts = hasOther ? options.concat([{ value: '__other__', label: 'その他' }]) : options;
      allOpts.forEach(function (o) {
        var name = 'q-' + q.key;
        var cb = el('input', { type: 'checkbox', name: name, value: o.value });
        cb.addEventListener('change', function () {
          var list = state.answers[q.key] || [];
          if (cb.checked) list.push(o.value); else list = list.filter(function (v) { return v !== o.value; });
          state.answers[q.key] = list;
          if (o.value === '__other__') toggleOther(q, cb.checked);
          markStarted();
        });
        cgrid.appendChild(el('label', { class: 'snb-choice snb-choice--chip' }, [cb, el('span', { text: o.label })]));
      });
      wrap.appendChild(cgrid);
    }

    if (hasOther) {
      var otherWrap = el('div', { class: 'snb-conditional', id: 'other-wrap-' + q.key, hidden: true });
      var otherInput = el('input', { type: 'text', maxLength: 200, placeholder: '具体的に教えてください' });
      otherInput.addEventListener('input', function () { state.otherText[q.key] = otherInput.value; });
      otherWrap.appendChild(el('label', {}, ['その他の内容 ', requiredBadge(true)]));
      otherWrap.appendChild(otherInput);
      wrap.appendChild(otherWrap);
    }

    return wrap;
  }

  function toggleOther(q, show) {
    var w = document.getElementById('other-wrap-' + q.key);
    if (w) w.hidden = !show;
  }

  function allQuestions() {
    return config.questions || [];
  }

  var errorBox = el('p', { class: 'snb-form-error', role: 'alert' });

  function renderFields() {
    var container = el('div', { class: 'snb-form-fields' });
    var form = el('form', { novalidate: true, id: 'snb-generated-form' });

    var honey = el('input', { type: 'text', name: 'website', class: 'snb-honey', tabIndex: -1, autocomplete: 'off' });
    form.appendChild(honey);

    if (isTestMode) {
      form.appendChild(el('p', { class: 'snb-mode-banner', text: 'テストモード：このページからの送信は保存・通知・GA4のいずれも行われません。' }));
    } else if (isClosedPreview) {
      form.appendChild(el('p', { class: 'snb-mode-banner', text: 'プレビュー（受付終了表示確認用）：このページからの送信は行われません。' }));
    }

    allQuestions().forEach(function (q) {
      var fieldset = el('fieldset', { class: 'snb-fieldset' });
      var legend = el('legend', {}, [q.label, ' ', requiredBadge(!!q.required)]);
      fieldset.appendChild(legend);
      if (q.help) fieldset.appendChild(el('p', { class: 'snb-help', text: q.help }));
      fieldset.appendChild(buildFieldControl(q));
      form.appendChild(fieldset);
    });

    if (config.consentText) {
      var consentLabel = el('label', { class: 'snb-consent' });
      var consentInput = el('input', { type: 'checkbox', id: 'snb-consent' });
      consentInput.addEventListener('change', function () { state.answers.__consent__ = consentInput.checked; });
      consentLabel.appendChild(consentInput);
      consentLabel.appendChild(el('span', {}, [config.consentText + ' ', requiredBadge(true)]));
      form.appendChild(consentLabel);
    }

    form.appendChild(errorBox);

    var reviewBtn = el('button', { type: 'submit', class: 'snb-btn snb-btn--primary', text: '確認画面へ進む' });
    form.appendChild(reviewBtn);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (honey.value) { renderDone(true); return; }
      var errs = validate();
      if (errs.length) {
        errorBox.textContent = errs[0];
        if (analytics()) analytics().trackFormError(config.slug || 'form', 'validation');
        return;
      }
      errorBox.textContent = '';
      state.phase = 'confirm';
      render();
    });

    container.appendChild(form);
    return container;
  }

  function validate() {
    var errs = [];
    allQuestions().forEach(function (q) {
      if (!q.required) return;
      var v = state.answers[q.key];
      if (q.type === 'checkbox' || q.type === 'date_multi') {
        if (!v || v.length === 0) errs.push(q.label + 'を選択してください。');
      } else {
        if (!v || !String(v).trim()) errs.push(q.label + 'を入力してください。');
      }
      if (q.allowOther) {
        var selectedOther = q.type === 'checkbox' || q.type === 'date_multi'
          ? (v || []).indexOf('__other__') !== -1
          : v === '__other__';
        if (selectedOther && (!state.otherText[q.key] || !state.otherText[q.key].trim())) {
          errs.push(q.label + 'の「その他」の内容を入力してください。');
        }
      }
    });
    if (config.consentText && !state.answers.__consent__) errs.push('同意事項にチェックしてください。');
    return errs;
  }

  function displayValue(q) {
    var v = state.answers[q.key];
    var opts = questionOptions(q);
    function labelFor(val) {
      if (val === '__other__') return 'その他（' + (state.otherText[q.key] || '') + '）';
      var found = opts.filter(function (o) { return o.value === val; })[0];
      return found ? found.label : val;
    }
    if (Array.isArray(v)) return v.length ? v.map(labelFor).join('、') : '（未選択）';
    if (v == null || v === '') return '（未入力）';
    if (q.type === 'radio' || q.type === 'select' || q.type === 'date_single' || q.type === 'plan_single') return labelFor(v);
    return v;
  }

  function renderConfirm() {
    var container = el('div', { class: 'snb-form-confirm' });
    var dl = el('dl', { class: 'snb-summary' });
    allQuestions().forEach(function (q) {
      dl.appendChild(el('dt', { text: q.label }));
      dl.appendChild(el('dd', { text: displayValue(q) }));
    });
    container.appendChild(dl);

    var submitErr = el('p', { class: 'snb-form-error', role: 'alert' });
    container.appendChild(submitErr);

    var editBtn = el('button', { type: 'button', class: 'snb-btn snb-btn--secondary', text: '内容を修正する' });
    editBtn.addEventListener('click', function () { state.phase = 'fields'; render(); });

    var submitBtn = el('button', { type: 'button', class: 'snb-btn snb-btn--primary', text: '送信する' });
    submitBtn.addEventListener('click', function () { doSubmit(submitBtn, submitErr); });

    container.appendChild(editBtn);
    container.appendChild(submitBtn);
    return container;
  }

  var submissionInFlight = false;

  function buildPayload() {
    var payload = {
      submission_id: state.__submissionId || (state.__submissionId = uuid()),
      form_slug: config.slug,
      form_type: config.type
    };
    allQuestions().forEach(function (q) {
      var v = state.answers[q.key];
      if (q.allowOther) {
        var isOther = Array.isArray(v) ? v.indexOf('__other__') !== -1 : v === '__other__';
        if (isOther) payload[q.key + '_other'] = state.otherText[q.key] || '';
      }
      payload[q.key] = v == null ? '' : v;
    });
    return payload;
  }

  function doSubmit(btn, errBox) {
    if (submissionInFlight) return;
    var payload = buildPayload();

    if (isPreviewLike) {
      renderDone(false);
      return;
    }

    if (!config.gasDeployed || config.gasExecUrl === GAS_PLACEHOLDER) {
      errBox.textContent = '現在、この申込フォームは準備中のため送信できません。しばらくしてから再度お試しください。';
      if (analytics()) analytics().trackFormError(config.slug || 'form', 'endpoint_not_configured');
      return;
    }

    submissionInFlight = true;
    btn.disabled = true;
    btn.textContent = '送信中…';

    fetch(config.gasExecUrl, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }
    })
      .then(function (response) {
        if (!response.ok) throw new Error('server');
        return response.json();
      })
      .then(function (result) {
        if (!result || result.ok !== true) throw new Error((result && result.error) || 'unknown');
        renderDone(false);
        if (analytics() && result.duplicate !== true) {
          analytics().trackGenerateLead(payload.submission_id, {
            lead_type: config.gaEvent === 'generate_lead' ? 'snbc_event_entry' : undefined,
            event_slug: config.slug,
            form_name: config.slug
          });
          if (config.gaEvent !== 'generate_lead') {
            analytics().track('survey_submit', { form_name: config.slug, event_slug: config.slug });
          }
        }
      })
      .catch(function () {
        submissionInFlight = false;
        btn.disabled = false;
        btn.textContent = '送信する';
        errBox.textContent = '送信に失敗しました。通信環境をご確認のうえ、もう一度お試しください。';
        if (analytics()) analytics().trackFormError(config.slug || 'form', 'network');
      });
  }

  function renderDone(honeypotTriggered) {
    state.phase = 'done';
    render();
    if (honeypotTriggered) return;
  }

  function renderDoneView() {
    var container = el('div', { class: 'snb-form-done' });
    if (isTestMode) {
      container.appendChild(el('p', { class: 'snb-mode-banner', text: 'テストモード：実際には送信されていません。' }));
    }
    container.appendChild(el('p', { class: 'snb-form-done__message', text: '送信しました。ありがとうございました。' }));
    return container;
  }

  function render() {
    root.textContent = '';
    if (state.phase === 'fields') root.appendChild(renderFields());
    else if (state.phase === 'confirm') root.appendChild(renderConfirm());
    else root.appendChild(renderDoneView());
  }

  render();
})();
