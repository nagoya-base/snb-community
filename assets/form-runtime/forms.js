/*
 * form-builder が生成する公開フォームページの共通ランタイム。
 * 各フォームHTMLは <script type="application/json" id="ff-config"> に
 * 設定JSONを埋め込み、このスクリプトを読み込むだけで動作する。
 *
 * 設定JSONの形（概要）は tools/form-builder/templates/schema.js のコメントを参照。
 *
 * テスト／プレビューの2つのモードを区別する。
 * - 本番ページ上での ?test=1 / ?test=closed （既存フォームと同じ思想）
 * - form-builder のプレビュー画面（window.FF_FORCE_PREVIEW_TEST_MODE = true を
 *   forms.js 読み込み前に設定する。クエリの有無に関係なく必ずテスト扱いにする）
 *
 * どちらのモードでも GAS への送信・メール通知・GA4送信は一切発生しない。
 */
(function () {
  'use strict';

  var GA4_MEASUREMENT_ID = 'G-H9BD3KFZCR';

  function qs(name) {
    try { return new URLSearchParams(window.location.search).get(name); } catch (e) { return null; }
  }

  var isPreview = window.FF_FORCE_PREVIEW_TEST_MODE === true;
  var isTestMode = isPreview || qs('test') === '1';
  var isClosedPreview = !isPreview && qs('test') === 'closed';

  function loadGa4() {
    if (isTestMode || isClosedPreview) return;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', GA4_MEASUREMENT_ID);
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA4_MEASUREMENT_ID;
    document.head.appendChild(s);
  }

  function analytics() {
    if (isTestMode) return null;
    return window.SNBAnalytics || null;
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (attrs[k] === undefined || attrs[k] === null || attrs[k] === false) return;
        if (k === 'text') { node.textContent = attrs[k]; return; }
        if (k === 'html') { return; } /* innerHTML経由の生成は禁止。使わない。 */
        if (attrs[k] === true) { node.setAttribute(k, ''); return; }
        node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function text(str) { return document.createTextNode(str == null ? '' : String(str)); }

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    var bytes = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (var i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    var hex = Array.prototype.map.call(bytes, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }

  function readConfig() {
    var node = document.getElementById('ff-config');
    if (!node) throw new Error('ff-config not found');
    return JSON.parse(node.textContent);
  }

  function fieldErrorNode(key) {
    return el('p', { class: 'ff-field-error', id: 'ff-err-' + key, role: 'alert', 'aria-live': 'polite' });
  }

  function showError(key, message) {
    var node = document.getElementById('ff-err-' + key);
    if (!node) return;
    node.textContent = message || '';
    node.classList.toggle('is-visible', !!message);
  }

  function clearAllErrors(root) {
    root.querySelectorAll('.ff-field-error').forEach(function (n) {
      n.textContent = '';
      n.classList.remove('is-visible');
    });
  }

  function badge(required) {
    return required
      ? el('span', { class: 'ff-required-badge', text: '必須' })
      : el('span', { class: 'ff-optional-badge', text: '任意' });
  }

  /* ── 個別フィールド描画 ── */

  function renderTextField(q, isTextarea) {
    var inputId = 'ff-input-' + q.key;
    var input = el(isTextarea ? 'textarea' : 'input', {
      id: inputId,
      name: q.key,
      maxlength: q.maxLength || undefined,
      'aria-describedby': 'ff-err-' + q.key
    });
    if (!isTextarea) input.type = 'text';
    return el('div', { class: 'ff-field', 'data-key': q.key, 'data-type': q.type }, [
      el('label', { class: 'ff-field-label', for: inputId }, [text(q.label), badge(q.required)]),
      q.helpText ? el('p', { class: 'ff-help-text', text: q.helpText }) : null,
      input,
      fieldErrorNode(q.key)
    ]);
  }

  function renderChoiceOptions(q, inputType) {
    var name = q.key;
    var list = el('div', { class: 'ff-choice-list', role: inputType === 'radio' ? 'radiogroup' : undefined });
    (q.options || []).forEach(function (opt, idx) {
      var id = 'ff-opt-' + q.key + '-' + idx;
      var input = el('input', { type: inputType, id: id, name: inputType === 'checkbox' ? name + '[]' : name, value: opt.value });
      list.appendChild(el('label', { class: 'ff-choice', for: id }, [input, text(opt.label)]));
    });
    if (q.otherOption) {
      var otherId = 'ff-opt-' + q.key + '-other';
      var otherInput = el('input', { type: inputType, id: otherId, name: inputType === 'checkbox' ? name + '[]' : name, value: '__other__' });
      list.appendChild(el('label', { class: 'ff-choice', for: otherId }, [otherInput, text('その他')]));
      var otherText = el('input', { type: 'text', id: 'ff-opt-' + q.key + '-other-text', name: q.key + '_other', maxlength: 100, placeholder: '内容を入力', class: 'ff-hidden' });
      list.appendChild(otherText);
      list.addEventListener('change', function () {
        var checked = inputType === 'radio'
          ? list.querySelector('input[name="' + name + '"]:checked')
          : list.querySelector('input#' + otherId);
        var show = inputType === 'radio' ? (checked && checked.value === '__other__') : otherInput.checked;
        otherText.classList.toggle('ff-hidden', !show);
      });
    }
    return list;
  }

  function renderChoiceField(q) {
    var inputType = q.type === 'select' ? null : q.type;
    var body;
    if (q.type === 'select') {
      var select = el('select', { id: 'ff-input-' + q.key, name: q.key });
      select.appendChild(el('option', { value: '', text: '選択してください' }));
      (q.options || []).forEach(function (opt) {
        var o = el('option', { value: opt.value });
        o.textContent = opt.label;
        select.appendChild(o);
      });
      body = select;
    } else {
      body = renderChoiceOptions(q, inputType);
    }
    return el('div', { class: 'ff-field', 'data-key': q.key, 'data-type': q.type }, [
      el('label', { class: 'ff-field-label', text: q.label }, [badge(q.required)]),
      q.helpText ? el('p', { class: 'ff-help-text', text: q.helpText }) : null,
      body,
      fieldErrorNode(q.key)
    ]);
  }

  function renderQuestion(q) {
    if (q.type === 'text') return renderTextField(q, false);
    if (q.type === 'textarea') return renderTextField(q, true);
    return renderChoiceField(q);
  }

  /* ── 個人情報ブロック（氏名・連絡先・同意） ── */

  function renderIdentityBlock(config) {
    var frag = document.createDocumentFragment();

    frag.appendChild(el('div', { class: 'ff-field', 'data-key': 'display_name' }, [
      el('label', { class: 'ff-field-label', for: 'ff-input-display_name' }, [text('お名前／表示名'), badge(true)]),
      el('input', { type: 'text', id: 'ff-input-display_name', name: 'display_name', maxlength: 50, 'aria-describedby': 'ff-err-display_name' }),
      fieldErrorNode('display_name')
    ]));

    frag.appendChild(el('div', { class: 'ff-field', 'data-key': 'contact_email' }, [
      el('label', { class: 'ff-field-label', for: 'ff-input-contact_email' }, [text('メールアドレス'), badge(false)]),
      el('p', { class: 'ff-help-text', text: 'メールアドレスまたはXアカウントのいずれかは必須です。' }),
      el('input', { type: 'email', id: 'ff-input-contact_email', name: 'contact_email', maxlength: 200, 'aria-describedby': 'ff-err-contact_email' }),
      fieldErrorNode('contact_email')
    ]));

    if (config.identity && config.identity.showXAccount !== false) {
      frag.appendChild(el('div', { class: 'ff-field', 'data-key': 'contact_x' }, [
        el('label', { class: 'ff-field-label', for: 'ff-input-contact_x' }, [text('Xアカウント（@なし）'), badge(false)]),
        el('input', { type: 'text', id: 'ff-input-contact_x', name: 'contact_x', maxlength: 200, 'aria-describedby': 'ff-err-contact_x' }),
        fieldErrorNode('contact_x')
      ]));
    }

    if (config.type === 'event_entry' && config.identity && config.identity.consent && config.identity.consent.enabled) {
      var label = config.identity.consent.label || '注意事項に同意します';
      frag.appendChild(el('div', { class: 'ff-field', 'data-key': 'agree_terms' }, [
        el('label', { class: 'ff-choice', for: 'ff-input-agree_terms' }, [
          el('input', { type: 'checkbox', id: 'ff-input-agree_terms', name: 'agree_terms', value: '1', 'aria-describedby': 'ff-err-agree_terms' }),
          text(label)
        ]),
        fieldErrorNode('agree_terms')
      ]));
    }

    return frag;
  }

  /* ── 候補日ブロック ── */

  function isPastDeadline(deadline) {
    if (!deadline) return false;
    if (isClosedPreview) return true;
    var d = new Date(deadline + 'T23:59:59+09:00');
    return Date.now() > d.getTime();
  }

  function renderDateModel(config) {
    var dm = config.dateModel;
    if (!dm || dm.mode === 'none') return null;

    var wrap = el('div', { class: 'ff-field', 'data-key': 'dates' }, [
      el('label', { class: 'ff-field-label', text: '参加可能日' }, [badge(true)])
    ]);

    if (dm.mode === 'multi-select') {
      var list = el('div', { class: 'ff-choice-list' });
      (dm.dates || []).forEach(function (d) {
        var id = 'ff-date-' + d.key;
        list.appendChild(el('label', { class: 'ff-choice', for: id }, [
          el('input', { type: 'checkbox', id: id, name: 'date_' + d.key, value: '1', 'data-date-checkbox': '1' }),
          text(d.label)
        ]));
      });
      if (dm.allowNoneOption) {
        var noneId = 'ff-date-unavailable';
        list.appendChild(el('label', { class: 'ff-choice', for: noneId }, [
          el('input', { type: 'checkbox', id: noneId, name: 'unavailable', value: '1' }),
          text('どの日も難しい')
        ]));
        list.addEventListener('change', function (e) {
          var noneBox = document.getElementById(noneId);
          if (e.target === noneBox && noneBox.checked) {
            list.querySelectorAll('input[data-date-checkbox]').forEach(function (cb) { cb.checked = false; });
          } else if (e.target.hasAttribute('data-date-checkbox') && e.target.checked) {
            noneBox.checked = false;
          }
        });
      }
      wrap.appendChild(list);
    } else if (dm.mode === 'per-date-radio') {
      (dm.dates || []).forEach(function (d) {
        var closed = isPastDeadline(d.deadline);
        var block = el('div', { class: 'ff-date-block', 'data-date-key': d.key });
        block.appendChild(el('div', { class: 'ff-date-block__label', text: d.label }));
        if (closed) {
          block.appendChild(el('p', { class: 'ff-help-text', text: 'この日は受付を終了しました。' }));
        } else {
          var choices = el('div', { class: 'ff-date-block__choices' });
          ['open', 'ng'].forEach(function (val) {
            var id = 'ff-date-' + d.key + '-' + val;
            choices.appendChild(el('label', { class: 'ff-choice', for: id }, [
              el('input', { type: 'radio', id: id, name: 'date_' + d.key, value: val }),
              text(val === 'open' ? '〇 参加できる' : '× 参加できない')
            ]));
          });
          block.appendChild(choices);
        }
        wrap.appendChild(block);
        wrap.appendChild(fieldErrorNode('date_' + d.key));
      });
    }
    return wrap;
  }

  /* ── メタ・イベント情報 ── */

  function renderEventMeta(config) {
    if (config.type !== 'event_entry' || !config.event) return null;
    var ev = config.event;
    var rows = [];
    function row(label, value) {
      if (!value) return;
      rows.push(el('dt', { text: label }));
      rows.push(el('dd', { text: value }));
    }
    row('開催日', ev.eventDate ? ev.eventDate + (ev.startTime ? ' ' + ev.startTime + (ev.endTime ? '〜' + ev.endTime : '') : '') : null);
    row('参加費', ev.fee);
    row('定員', ev.capacity);
    row('会場', ev.venue);
    row('申込締切', ev.deadline);
    if (!rows.length) return null;
    return el('div', { class: 'ff-event-meta' }, [el('dl', {}, rows)]);
  }

  /* ── バリデーション ── */

  function getCheckedValues(root, name) {
    return Array.prototype.slice.call(root.querySelectorAll('input[name="' + name + '[]"]:checked')).map(function (i) { return i.value; });
  }

  function validate(root, config) {
    var errors = {};

    var displayName = root.querySelector('#ff-input-display_name').value.trim();
    if (!displayName) errors.display_name = 'お名前を入力してください。';

    var email = root.querySelector('#ff-input-contact_email').value.trim();
    var xField = root.querySelector('#ff-input-contact_x');
    var xVal = xField ? xField.value.trim() : '';
    if (!email && !xVal) {
      errors.contact_email = 'メールアドレスまたはXアカウントのいずれかを入力してください。';
    }

    if (config.type === 'event_entry' && config.identity && config.identity.consent && config.identity.consent.enabled) {
      var agree = root.querySelector('#ff-input-agree_terms');
      if (agree && !agree.checked) errors.agree_terms = '同意のうえチェックしてください。';
    }

    var dm = config.dateModel;
    if (dm && dm.mode === 'multi-select') {
      var anyChecked = Array.prototype.slice.call(root.querySelectorAll('input[data-date-checkbox]')).some(function (cb) { return cb.checked; });
      var noneChecked = root.querySelector('#ff-date-unavailable');
      if (!anyChecked && !(noneChecked && noneChecked.checked)) errors.dates = '参加可能な日を選択してください。';
    } else if (dm && dm.mode === 'per-date-radio') {
      (dm.dates || []).forEach(function (d) {
        if (isPastDeadline(d.deadline)) return;
        var checked = root.querySelector('input[name="date_' + d.key + '"]:checked');
        if (!checked) errors['date_' + d.key] = '回答を選択してください。';
      });
    }

    (config.questions || []).forEach(function (q) {
      if (!q.required) return;
      if (q.type === 'text' || q.type === 'textarea') {
        var v = root.querySelector('#ff-input-' + q.key);
        if (!v || !v.value.trim()) errors[q.key] = '入力してください。';
      } else if (q.type === 'select') {
        var s = root.querySelector('#ff-input-' + q.key);
        if (!s || !s.value) errors[q.key] = '選択してください。';
      } else if (q.type === 'radio') {
        var r = root.querySelector('input[name="' + q.key + '"]:checked');
        if (!r) errors[q.key] = '選択してください。';
      } else if (q.type === 'checkbox') {
        var vals = getCheckedValues(root, q.key);
        if (!vals.length) errors[q.key] = '1つ以上選択してください。';
      }
    });

    return errors;
  }

  function collectPayload(root, config) {
    var payload = {
      submission_id: uuid(),
      form_type: config.type,
      form_version: config.formVersion || 1,
      display_name: root.querySelector('#ff-input-display_name').value.trim(),
      contact_email: root.querySelector('#ff-input-contact_email').value.trim()
    };
    var xField = root.querySelector('#ff-input-contact_x');
    if (xField) payload.contact_x = xField.value.trim();

    if (config.type === 'event_entry' && config.identity && config.identity.consent && config.identity.consent.enabled) {
      var agree = root.querySelector('#ff-input-agree_terms');
      payload.agree_terms = !!(agree && agree.checked);
    }

    var dm = config.dateModel;
    if (dm && dm.mode === 'multi-select') {
      var dates = {};
      (dm.dates || []).forEach(function (d) {
        var cb = document.getElementById('ff-date-' + d.key);
        dates[d.key] = !!(cb && cb.checked);
      });
      payload.dates = dates;
      var noneBox = document.getElementById('ff-date-unavailable');
      if (noneBox) payload.unavailable = !!noneBox.checked;
    } else if (dm && dm.mode === 'per-date-radio') {
      var perDate = {};
      (dm.dates || []).forEach(function (d) {
        var checked = root.querySelector('input[name="date_' + d.key + '"]:checked');
        perDate[d.key] = checked ? checked.value : null;
      });
      payload.dates = perDate;
    }

    (config.questions || []).forEach(function (q) {
      if (q.type === 'text' || q.type === 'textarea') {
        var v = root.querySelector('#ff-input-' + q.key);
        payload[q.key] = v ? v.value.trim() : '';
      } else if (q.type === 'select') {
        var s = root.querySelector('#ff-input-' + q.key);
        payload[q.key] = s ? s.value : '';
      } else if (q.type === 'radio') {
        var r = root.querySelector('input[name="' + q.key + '"]:checked');
        payload[q.key] = r ? r.value : '';
        if (q.otherOption && r && r.value === '__other__') {
          var ot = root.querySelector('#ff-opt-' + q.key + '-other-text');
          payload[q.key + '_other'] = ot ? ot.value.trim() : '';
        }
      } else if (q.type === 'checkbox') {
        payload[q.key] = getCheckedValues(root, q.key);
        if (q.otherOption && payload[q.key].indexOf('__other__') !== -1) {
          var ot2 = root.querySelector('#ff-opt-' + q.key + '-other-text');
          payload[q.key + '_other'] = ot2 ? ot2.value.trim() : '';
        }
      }
    });

    return payload;
  }

  function buildSummary(root, config, payload) {
    var dl = el('dl', { class: 'ff-summary-list' });
    function add(label, value) {
      dl.appendChild(el('dt', { text: label }));
      dl.appendChild(el('dd', { text: value || '（未入力）' }));
    }
    add('お名前', payload.display_name);
    add('連絡先', [payload.contact_email, payload.contact_x ? '@' + payload.contact_x : ''].filter(Boolean).join(' / '));
    var dm = config.dateModel;
    if (dm && dm.mode === 'multi-select') {
      var selected = (dm.dates || []).filter(function (d) { return payload.dates[d.key]; }).map(function (d) { return d.label; });
      add('参加可能日', payload.unavailable ? 'どの日も難しい' : selected.join('、'));
    } else if (dm && dm.mode === 'per-date-radio') {
      (dm.dates || []).forEach(function (d) {
        var v = payload.dates[d.key];
        add(d.label, v === 'open' ? '〇 参加できる' : v === 'ng' ? '× 参加できない' : null);
      });
    }
    (config.questions || []).forEach(function (q) {
      var v = payload[q.key];
      if (Array.isArray(v)) {
        var labels = v.map(function (val) {
          if (val === '__other__') return payload[q.key + '_other'] || 'その他';
          var opt = (q.options || []).find(function (o) { return o.value === val; });
          return opt ? opt.label : val;
        });
        add(q.label, labels.join('、'));
      } else if (q.type === 'radio' || q.type === 'select') {
        var opt2 = (q.options || []).find(function (o) { return o.value === v; });
        add(q.label, v === '__other__' ? (payload[q.key + '_other'] || 'その他') : (opt2 ? opt2.label : v));
      } else {
        add(q.label, v);
      }
    });
    return dl;
  }

  /* ── 送信 ── */

  function submit(config, payload) {
    return fetch(config.endpoints.submitUrl, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }
    }).then(function (res) { return res.json(); });
  }

  function fireAnalyticsOnSuccess(config, payload) {
    var a = analytics();
    if (!a) return;
    if (config.type === 'event_entry') {
      a.trackGenerateLead(payload.submission_id, {
        lead_type: (config.analytics && config.analytics.leadType) || 'snbc_event_entry',
        form_name: (config.analytics && config.analytics.formName) || config.meta.slug
      });
    } else {
      a.track('survey_submit', {
        form_name: (config.analytics && config.analytics.formName) || config.meta.slug
      });
    }
  }

  /* ── 画面組み立て ── */

  function render() {
    var config = readConfig();
    document.body.setAttribute('data-accent', config.meta.accent || 'community');
    document.body.classList.add('ff-form-page');

    var root = document.getElementById('ff-app');
    if (!root) throw new Error('ff-app root not found');

    loadGa4();

    var container = el('div', { class: 'ff-container' });

    container.appendChild(el('header', { class: 'ff-header' }, [
      el('h1', { text: config.meta.title }),
      config.meta.subtitle ? el('p', { text: config.meta.subtitle }) : null
    ]));

    if (isTestMode) {
      container.appendChild(el('div', { class: 'ff-test-mode-note' }, [
        text('※これはテスト表示です。送信してもデータの保存・通知・アクセス解析への送信は行われません。')
      ]));
    }
    if (isClosedPreview) {
      container.appendChild(el('div', { class: 'ff-test-mode-note' }, [
        text('※これは「受付終了」表示のプレビューです（?test=closed）。')
      ]));
    }

    var evMeta = renderEventMeta(config);
    if (evMeta) container.appendChild(evMeta);

    var form = el('form', { novalidate: true });
    var honey = el('input', { type: 'text', name: 'website', class: 'ff-honey', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true' });
    form.appendChild(honey);

    var card = el('div', { class: 'ff-form-card' });
    card.appendChild(renderIdentityBlock(config));
    var dateBlock = renderDateModel(config);
    if (dateBlock) card.appendChild(dateBlock);
    (config.questions || []).forEach(function (q) { card.appendChild(renderQuestion(q)); });
    form.appendChild(card);

    var errorNotice = el('div', { class: 'ff-notice ff-notice--error ff-hidden', role: 'alert' });
    form.appendChild(errorNotice);

    var submitBtn = el('button', { type: 'submit', class: 'ff-btn ff-btn--primary' }, [text('確認する')]);
    form.appendChild(el('div', { class: 'ff-actions' }, [submitBtn]));

    container.appendChild(form);

    var confirmSection = el('section', { class: 'ff-form-card ff-hidden' }, []);
    container.appendChild(confirmSection);

    var completeSection = el('section', { class: 'ff-notice ff-notice--success ff-hidden' }, []);
    container.appendChild(completeSection);

    container.appendChild(el('footer', { class: 'ff-footer' }, [text('form-builder により生成')]));

    root.appendChild(container);

    if (analytics()) {
      form.addEventListener('input', function once() {
        analytics().trackFormStart((config.analytics && config.analytics.formName) || config.meta.slug);
        form.removeEventListener('input', once);
      }, { once: true });
    }

    var pendingPayload = null;

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      clearAllErrors(form);
      errorNotice.classList.add('ff-hidden');

      if (honey.value) {
        /* ハニーポットが埋まっている＝bot。何もせず完了扱いにする。 */
        showCompletion(true);
        return;
      }

      var errors = validate(form, config);
      var keys = Object.keys(errors);
      if (keys.length) {
        keys.forEach(function (k) { showError(k, errors[k]); });
        errorNotice.textContent = '入力内容をご確認ください。';
        errorNotice.classList.remove('ff-hidden');
        if (analytics()) analytics().trackFormError((config.analytics && config.analytics.formName) || config.meta.slug, 'validation');
        return;
      }

      pendingPayload = collectPayload(form, config);
      confirmSection.textContent = '';
      confirmSection.appendChild(el('h2', { text: '入力内容の確認' }));
      confirmSection.appendChild(buildSummary(form, config, pendingPayload));
      var backBtn = el('button', { type: 'button', class: 'ff-btn' }, [text('戻る')]);
      var sendBtn = el('button', { type: 'button', class: 'ff-btn ff-btn--primary' }, [text('この内容で送信する')]);
      confirmSection.appendChild(el('div', { class: 'ff-actions' }, [backBtn, sendBtn]));

      form.classList.add('ff-hidden');
      confirmSection.classList.remove('ff-hidden');

      backBtn.addEventListener('click', function () {
        confirmSection.classList.add('ff-hidden');
        form.classList.remove('ff-hidden');
      });

      sendBtn.addEventListener('click', function () {
        sendBtn.disabled = true;
        backBtn.disabled = true;

        if (isTestMode) {
          showCompletion(true);
          return;
        }

        submit(config, pendingPayload).then(function (result) {
          if (result && result.ok) {
            if (!result.duplicate) fireAnalyticsOnSuccess(config, pendingPayload);
            showCompletion(false);
          } else {
            throw new Error((result && result.error) || 'submit_failed');
          }
        }).catch(function () {
          if (analytics()) analytics().trackFormError((config.analytics && config.analytics.formName) || config.meta.slug, 'submit');
          confirmSection.appendChild(el('div', { class: 'ff-notice ff-notice--error', role: 'alert' }, [
            text('送信に失敗しました。時間をおいて再度お試しください。')
          ]));
          sendBtn.disabled = false;
          backBtn.disabled = false;
        });
      });
    });

    function showCompletion(isTest) {
      confirmSection.classList.add('ff-hidden');
      form.classList.add('ff-hidden');
      completeSection.textContent = '';
      completeSection.appendChild(el('p', {
        text: isTest ? '（テスト表示）送信が完了した場合の画面です。実際のデータは保存されていません。' : 'ご回答ありがとうございました。送信が完了しました。'
      }));
      completeSection.classList.remove('ff-hidden');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }

  window.FFForm = { render: render };
})();
