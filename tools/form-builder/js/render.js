// config オブジェクトから公開用HTML文字列を生成する。
// 生成物は既存フォーム（community/classroom_20260912.html 等）の規約
// （honeypot／2段階確認／submission_id／text/plain fetch／?test=1 no-op／
//  GA4 generate_lead・survey_submit 使い分け）を踏襲する。
//
// 重要: 生成HTMLは必ず `<!DOCTYPE html>` から始まる。.nojekyll 環境で
// front matter (`---`) が先頭に混入すると画面にそのまま文字表示される
// 事故になるため、assertNoFrontMatter() で毎回検証する。

import { templateMeta } from './schema.js';

const SITE_ORIGIN = 'https://nagoya-base.github.io/snb-community';

export function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// インラインJSへ値を埋め込む際、`</script>` によるタグ早期終了とHTMLコメント
// 開始(`<!--`)を無害化してから JSON.stringify する。
function jsLiteral(value) {
  const json = JSON.stringify(value == null ? null : value);
  return json.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
}

function dateKey(dateStr) {
  return `date_${String(dateStr).replace(/-/g, '')}`;
}

function buildJsonLd(config) {
  if (config.type !== 'event_entry' || !config.eventDate) return '';
  const canonicalUrl = `${SITE_ORIGIN}/${config.directory}/${config.slug}.html`;
  const start = config.startTime ? `${config.eventDate}T${config.startTime}:00+09:00` : `${config.eventDate}T00:00:00+09:00`;
  const end = config.endTime ? `${config.eventDate}T${config.endTime}:00+09:00` : start;
  const ogpUrl = config.ogpImagePath ? `${SITE_ORIGIN}/${config.ogpImagePath.replace(/^\/+/, '')}` : '';
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: config.title,
    description: config.subtitle || config.description || '',
    startDate: start,
    endDate: end,
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: {
      '@type': 'Place',
      name: config.venue || 'Studio Nagoya Base',
      address: {
        '@type': 'PostalAddress',
        addressLocality: '名古屋市中区上前津',
        addressRegion: '愛知県',
        addressCountry: 'JP',
      },
    },
    organizer: {
      '@type': 'Organization',
      name: 'SNBコミュニティ（SNBC）',
      url: `${SITE_ORIGIN}/community/`,
    },
    offers: {
      '@type': 'Offer',
      price: String(config.price || '').replace(/[^0-9]/g, '') || '0',
      priceCurrency: 'JPY',
      availability: 'https://schema.org/InStock',
      url: canonicalUrl,
    },
  };
  if (ogpUrl) ld.image = [ogpUrl];
  // JSON.stringify はユーザー入力中の `</script>` をエスケープしないため、
  // そのまま埋め込むとタグを早期終了させるXSSになる。jsLiteral相当の無害化を必ず通す。
  const safeJson = JSON.stringify(ld, null, 2).replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
  return `  <script type="application/ld+json">\n  ${safeJson.split('\n').join('\n  ')}\n  </script>\n\n`;
}

function buildHead(config, opts) {
  const preview = !!opts.preview;
  const canonicalUrl = `${SITE_ORIGIN}/${config.directory}/${config.slug}.html`;
  const ogpUrl = config.ogpImagePath ? `${SITE_ORIGIN}/${config.ogpImagePath.replace(/^\/+/, '')}` : '';
  const title = escapeHtml(config.title);
  const description = escapeHtml(config.description || config.subtitle || '');

  const testModeScript = preview
    ? `  <!-- form-builder プレビュー: 送信・通知・GA4を発生させないため常にテストモード扱い -->\n` +
      `  <script>\n` +
      `    window.SNB_TEST_MODE = true;\n` +
      `    window.SNB_PREVIEW_CLOSED_MODE = false;\n` +
      `  </script>\n`
    : `  <!-- ?test=1 は保存・通知・GA4を一切行わない画面確認用、?test=closed は受付終了表示の確認用。 -->\n` +
      `  <script>\n` +
      `    window.SNB_TEST_MODE = (function () {\n` +
      `      try { return new URLSearchParams(window.location.search).get('test') === '1'; } catch (e) { return false; }\n` +
      `    })();\n` +
      `    window.SNB_PREVIEW_CLOSED_MODE = (function () {\n` +
      `      try { return new URLSearchParams(window.location.search).get('test') === 'closed'; } catch (e) { return false; }\n` +
      `    })();\n` +
      `  </script>\n`;

  const ga4Script =
    `  <!-- テスト／クローズド確認中はGA4そのものを読み込まない。 -->\n` +
    `  <script>\n` +
    `    if (!window.SNB_TEST_MODE && !window.SNB_PREVIEW_CLOSED_MODE) {\n` +
    `      // GA4本体の読み込みは analytics.js 側の規約に従う（このプロジェクトの既存GA4計測IDを使用）。\n` +
    `    }\n` +
    `  </script>\n`;

  const ogp = ogpUrl
    ? `  <meta property="og:title" content="${title}">\n` +
      `  <meta property="og:description" content="${description}">\n` +
      `  <meta property="og:type" content="website">\n` +
      `  <meta property="og:url" content="${canonicalUrl}">\n` +
      `  <meta property="og:image" content="${ogpUrl}">\n` +
      `  <meta property="og:image:width" content="1200">\n` +
      `  <meta property="og:image:height" content="630">\n` +
      `  <meta name="twitter:card" content="summary_large_image">\n` +
      `  <meta name="twitter:title" content="${title}">\n` +
      `  <meta name="twitter:description" content="${description}">\n` +
      `  <meta name="twitter:image" content="${ogpUrl}">\n`
    : '';

  // プレビュー(srcdoc)はドキュメントのbase URLが親ページのものになるため、
  // ../common.css 等の相対パスが誤って解決されないよう <base> で補正する。
  // 生成される本番HTML（preview:false）には base タグを含めない。
  const baseTag = preview && typeof window !== 'undefined'
    ? `  <base href="${window.location.origin}/${config.directory}/">\n`
    : '';

  return (
    `<!DOCTYPE html>\n` +
    `<html lang="ja">\n` +
    `<head>\n` +
    `  <meta charset="UTF-8">\n` +
    baseTag +
    `  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n` +
    `  <meta name="robots" content="${preview ? 'noindex, nofollow' : 'index, follow'}">\n` +
    `  <title>${title}</title>\n` +
    `  <meta name="description" content="${description}">\n` +
    `  <link rel="canonical" href="${canonicalUrl}">\n\n` +
    buildJsonLd(config) +
    ogp +
    `\n` +
    testModeScript +
    ga4Script +
    `  <link rel="stylesheet" href="../common.css">\n` +
    `  <style>${FORM_STYLE}</style>\n` +
    `</head>\n`
  );
}

const FORM_STYLE = `
    .fb-form-wrap { max-width: 640px; margin: 0 auto; padding: 1.25rem 1rem 4rem; }
    .fb-field { margin-bottom: 1.25rem; }
    .fb-field label.fb-label { display: block; font-weight: 600; margin-bottom: 0.4rem; }
    .fb-field .required { color: #c0392b; font-size: 0.8em; margin-left: 0.4em; }
    .fb-field .optional { color: #888; font-size: 0.8em; margin-left: 0.4em; }
    .fb-field input[type="text"], .fb-field input[type="email"], .fb-field input[type="date"],
    .fb-field textarea, .fb-field select {
      width: 100%; box-sizing: border-box; padding: 0.6rem; font-size: 16px;
      border: 1px solid #ccc; border-radius: 6px;
    }
    .fb-field textarea { min-height: 6rem; }
    .fb-help { font-size: 0.85em; color: #666; margin-top: 0.3rem; }
    .fb-option-row { display: flex; align-items: center; gap: 0.5rem; margin: 0.3rem 0; }
    .fb-error { color: #c0392b; font-size: 0.9em; margin-top: 0.4rem; }
    .fb-error[hidden] { display: none; }
    .fb-honey { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
    .fb-confirm { border: 1px solid #ddd; border-radius: 8px; padding: 1rem; margin: 1.5rem 0; background: #fafafa; }
    .fb-confirm dt { font-weight: 600; margin-top: 0.6rem; }
    .fb-confirm dd { margin: 0.1rem 0 0; }
    .fb-btn { display: inline-block; width: 100%; padding: 0.9rem; font-size: 1.05rem; font-weight: 700;
      border-radius: 8px; border: none; background: #2e7d32; color: #fff; cursor: pointer; }
    .fb-btn[disabled] { opacity: 0.5; cursor: not-allowed; }
    .fb-btn--secondary { background: #555; }
    .fb-complete { text-align: center; padding: 2rem 1rem; }
`;

function fieldLabel(label, required) {
  return `<span class="fb-label">${escapeHtml(label)}${required ? '<span class="required">必須</span>' : '<span class="optional">任意</span>'}</span>`;
}

function buildQuestionField(q, idx) {
  const name = escapeHtml(q.key);
  const help = q.help ? `<p class="fb-help">${escapeHtml(q.help)}</p>` : '';
  let control = '';
  if (q.type === 'text') {
    control = `<input type="text" name="${name}" id="f-${name}">`;
  } else if (q.type === 'textarea') {
    control = `<textarea name="${name}" id="f-${name}"></textarea>`;
  } else if (q.type === 'select') {
    const opts = (q.options || [])
      .map((o) => `<option value="${escapeHtml(o.value || o.label)}">${escapeHtml(o.label)}</option>`)
      .join('\n        ');
    control = `<select name="${name}" id="f-${name}">\n        <option value="">選択してください</option>\n        ${opts}\n      </select>`;
  } else if (q.type === 'radio') {
    control = (q.options || [])
      .map(
        (o, oi) =>
          `<label class="fb-option-row"><input type="radio" name="${name}" value="${escapeHtml(o.value || o.label)}" id="f-${name}-${oi}"> ${escapeHtml(o.label)}</label>`
      )
      .join('\n      ');
  } else if (q.type === 'checkbox') {
    control = (q.options || [])
      .map(
        (o, oi) =>
          `<label class="fb-option-row"><input type="checkbox" name="${name}[]" value="${escapeHtml(o.value || o.label)}" id="f-${name}-${oi}"> ${escapeHtml(o.label)}</label>`
      )
      .join('\n      ');
  }

  return (
    `    <div class="fb-field" data-question-key="${name}">\n` +
    `      <label class="fb-label-wrap" for="f-${name}">${fieldLabel(q.label, q.required)}</label>\n` +
    `      ${control}\n` +
    `      ${help}\n` +
    `      <p class="fb-error" id="err-${name}" hidden></p>\n` +
    `    </div>\n`
  );
}

function buildContactFields(config) {
  const c = config.contact || {};
  let html = '';
  if (c.name) {
    html += buildQuestionField({ key: 'display_name', type: 'text', label: 'お名前・表示名', required: true, help: '' });
  }
  if (c.xAccount) {
    html += buildQuestionField({ key: 'x_account', type: 'text', label: 'Xアカウント（任意）', required: false, help: '@から始まるXのユーザー名、またはプロフィールURL' });
  }
  if (c.email) {
    html += buildQuestionField({ key: 'email', type: 'text', label: 'メールアドレス', required: !!c.emailRequired, help: '確認のご連絡に使用します' });
  }
  return html;
}

function buildDatesSection(config) {
  const meta = templateMeta(config.type);
  if (!meta.hasDates || !config.dates || config.dates.length === 0) return '';

  if (config.type === 'date_survey') {
    const rows = config.dates
      .map((d) => {
        const key = dateKey(d.date);
        const label = escapeHtml(d.label || d.date);
        return (
          `    <div class="fb-field" data-question-key="${key}">\n` +
          `      <label class="fb-label-wrap">${fieldLabel(label, true)}</label>\n` +
          `      <label class="fb-option-row"><input type="radio" name="${key}" value="yes" required> ○ 参加できる</label>\n` +
          `      <label class="fb-option-row"><input type="radio" name="${key}" value="maybe"> △ 未定・調整中</label>\n` +
          `      <label class="fb-option-row"><input type="radio" name="${key}" value="no"> × 参加できない</label>\n` +
          `      <p class="fb-error" id="err-${key}" hidden></p>\n` +
          `    </div>\n`
        );
      })
      .join('');
    return `    <h2>候補日ごとの参加可否</h2>\n${rows}`;
  }

  // cross_survey: 複数選択チェックボックス
  const rows = config.dates
    .map((d) => {
      const key = dateKey(d.date);
      const label = escapeHtml(d.label || d.date);
      return `      <label class="fb-option-row"><input type="checkbox" name="${key}" value="1"> ${label}</label>\n`;
    })
    .join('');
  return (
    `    <div class="fb-field" data-question-key="dates">\n` +
    `      <label class="fb-label-wrap">${fieldLabel('参加可能な候補日（複数選択可）', true)}</label>\n` +
    `${rows}` +
    `      <p class="fb-error" id="err-dates" hidden></p>\n` +
    `    </div>\n`
  );
}

function buildPlansSection(config) {
  const meta = templateMeta(config.type);
  if (!meta.hasPlans || !config.plans || config.plans.length === 0) return '';
  const optionsHtml = (label) =>
    config.plans.map((p) => `<option value="${escapeHtml(p.key || p.label)}">${escapeHtml(p.label)}</option>`).join('\n        ');
  return (
    `    <h2>候補企画</h2>\n` +
    `    <div class="fb-field" data-question-key="first_choice_plan">\n` +
    `      <label class="fb-label-wrap" for="f-first_choice_plan">${fieldLabel('第一希望企画', true)}</label>\n` +
    `      <select name="first_choice_plan" id="f-first_choice_plan">\n        <option value="">選択してください</option>\n        ${optionsHtml()}\n      </select>\n` +
    `      <p class="fb-error" id="err-first_choice_plan" hidden></p>\n` +
    `    </div>\n` +
    `    <div class="fb-field" data-question-key="second_choice_plan">\n` +
    `      <label class="fb-label-wrap" for="f-second_choice_plan">${fieldLabel('第二希望企画', false)}</label>\n` +
    `      <select name="second_choice_plan" id="f-second_choice_plan">\n        <option value="">選択してください</option>\n        ${optionsHtml()}\n      </select>\n` +
    `    </div>\n`
  );
}

function buildEventInfoBlock(config) {
  const meta = templateMeta(config.type);
  if (!meta.hasEventInfo) return '';
  const rows = [
    ['開催日', config.eventDate],
    ['時間', [config.startTime, config.endTime].filter(Boolean).join('〜')],
    ['会場', config.venue],
    ['料金', config.price],
    ['定員', config.capacity],
    ['締切', config.entryDeadline],
  ].filter(([, v]) => v);
  const items = rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('\n        ');
  return `    <dl class="fb-event-info">\n        ${items}\n    </dl>\n`;
}

function buildConsentBlock(config) {
  const meta = templateMeta(config.type);
  if (!meta.hasConsent || !config.consentRequired) return '';
  return (
    `    <div class="fb-field">\n` +
    `      <label class="fb-option-row"><input type="checkbox" id="entry-agree">\n` +
    `        <span>利用規約・参加ルールに同意します<span class="required">必須</span><br>\n` +
    `        <small>「<a href="../legal/community-rules.html" target="_blank" rel="noopener noreferrer">イベント参加の心得</a>」「<a href="../legal/photo-terms.html" target="_blank" rel="noopener noreferrer">撮影写真の利用規約</a>」を確認しました</small></span>\n` +
    `      </label>\n` +
    `      <p class="fb-error" id="err-agree" hidden></p>\n` +
    `    </div>\n`
  );
}

function buildBodyScript(config, opts) {
  const preview = !!opts.preview;
  const meta = templateMeta(config.type);
  const questionKeys = (config.questions || []).map((q) => q.key);
  const dateFieldKeys = meta.hasDates ? (config.dates || []).map((d) => dateKey(d.date)) : [];
  const contact = config.contact || {};
  const requiredContactKeys = [];
  if (contact.name) requiredContactKeys.push('display_name');
  if (contact.email && contact.emailRequired) requiredContactKeys.push('email');

  const requiredQuestionKeys = (config.questions || []).filter((q) => q.required).map((q) => q.key);
  const requiredDateKeysForSurvey = meta.type === 'date_survey' ? dateFieldKeys : [];
  const leadType = config.leadType && config.leadType.trim() ? config.leadType.trim() : config.slug;
  const gasUrl = config.gasExecUrl && config.gasExecUrl.trim() ? config.gasExecUrl.trim() : 'PLACEHOLDER_REPLACE_WITH_GAS_EXEC_URL';

  return `
  <script src="../analytics.js"></script>
  <script>
  (function () {
    var FORM_NAME = ${jsLiteral(config.slug)};
    var GAS_ENDPOINT_URL = ${jsLiteral(gasUrl)};
    var TEMPLATE_TYPE = ${jsLiteral(config.type)};
    var LEAD_TYPE = ${jsLiteral(leadType)};
    var REQUIRED_KEYS = ${jsLiteral([...requiredContactKeys, ...requiredQuestionKeys, ...requiredDateKeysForSurvey])};
    var CROSS_SURVEY_DATE_KEYS = ${jsLiteral(meta.type === 'cross_survey' ? dateFieldKeys : [])};
    var isTestMode = window.SNB_TEST_MODE === true;
    var isPreviewClosedMode = window.SNB_PREVIEW_CLOSED_MODE === true;

    function analytics() {
      if (isTestMode || isPreviewClosedMode) return null;
      return window.SNBAnalytics || null;
    }

    function uuid() {
      if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = (Math.random() * 16) | 0;
        var v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
    }

    var form = document.getElementById('fb-form');
    var confirmBtn = document.getElementById('fb-confirm-btn');
    var submitBtn = document.getElementById('fb-submit-btn');
    var confirmSection = document.getElementById('fb-confirm-section');
    var completeSection = document.getElementById('fb-complete-section');
    var submitError = document.getElementById('fb-submit-error');
    var isConfirming = false;
    var submissionInFlight = false;

    function showError(key, message) {
      var el = document.getElementById('err-' + key);
      if (el) { el.textContent = message; el.hidden = false; }
    }
    function clearErrors() {
      document.querySelectorAll('.fb-error').forEach(function (el) { el.hidden = true; el.textContent = ''; });
    }

    function validate() {
      clearErrors();
      var ok = true;
      REQUIRED_KEYS.forEach(function (key) {
        var els = form.querySelectorAll('[name="' + key + '"]');
        var filled = false;
        els.forEach(function (el) {
          if (el.type === 'radio' || el.type === 'checkbox') { if (el.checked) filled = true; }
          else if (el.value && el.value.trim()) { filled = true; }
        });
        if (!filled) { showError(key, 'この項目を入力してください。'); ok = false; }
      });
      if (TEMPLATE_TYPE === 'cross_survey' && CROSS_SURVEY_DATE_KEYS.length) {
        var anyChecked = CROSS_SURVEY_DATE_KEYS.some(function (key) {
          var el = form.querySelector('[name="' + key + '"]');
          return el && el.checked;
        });
        if (!anyChecked) { showError('dates', '候補日を1件以上選択してください。'); ok = false; }
      }
      var agree = document.getElementById('entry-agree');
      if (agree && !agree.checked) { showError('agree', '同意にチェックしてください。'); ok = false; }
      return ok;
    }

    function buildPayload() {
      var fd = new FormData(form);
      var payload = { submission_id: uuid(), form_name: FORM_NAME, template_type: TEMPLATE_TYPE };
      fd.forEach(function (value, key) {
        if (key === 'website') return;
        if (payload[key] !== undefined) {
          if (!Array.isArray(payload[key])) payload[key] = [payload[key]];
          payload[key].push(value);
        } else {
          payload[key] = value;
        }
      });
      payload.test = isTestMode ? '1' : (isPreviewClosedMode ? 'closed' : '');
      return payload;
    }

    function renderConfirmSummary(payload) {
      var dl = document.getElementById('fb-confirm-summary');
      if (!dl) return;
      dl.innerHTML = '';
      Object.keys(payload).forEach(function (key) {
        if (['submission_id', 'form_name', 'template_type', 'test'].indexOf(key) !== -1) return;
        var value = payload[key];
        if (Array.isArray(value)) value = value.join(', ');
        if (!value) return;
        var dt = document.createElement('dt');
        dt.textContent = key;
        var dd = document.createElement('dd');
        dd.textContent = value;
        dl.appendChild(dt);
        dl.appendChild(dd);
      });
    }

    if (confirmBtn) {
      confirmBtn.addEventListener('click', function () {
        var honey = form.querySelector('input[name="website"]');
        if (honey && honey.value) return;
        if (!validate()) return;
        var payload = buildPayload();
        renderConfirmSummary(payload);
        isConfirming = true;
        if (confirmSection) confirmSection.hidden = false;
        confirmSection && confirmSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    if (form) {
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        if (!isConfirming || submissionInFlight) return;

        var honey = form.querySelector('input[name="website"]');
        if (honey && honey.value) {
          if (completeSection) completeSection.hidden = false;
          return;
        }

        var payload = buildPayload();

        if (isTestMode) {
          if (completeSection) completeSection.hidden = false;
          if (form) form.hidden = true;
          return;
        }

        if (GAS_ENDPOINT_URL.indexOf('PLACEHOLDER_REPLACE_WITH') !== -1) {
          if (analytics()) analytics().trackFormError(FORM_NAME, 'endpoint_not_configured');
          if (submitError) { submitError.textContent = 'GASの送信先が未設定のため、まだ送信できません。運営者にお問い合わせください。'; submitError.hidden = false; }
          return;
        }

        submissionInFlight = true;
        if (submitBtn) submitBtn.disabled = true;

        fetch(GAS_ENDPOINT_URL, {
          method: 'POST',
          body: JSON.stringify(payload),
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        })
          .then(function (response) {
            if (!response.ok) { var e = new Error('http'); e.failureType = 'server'; throw e; }
            return response.json();
          })
          .then(function (result) {
            if (!result || result.ok !== true) {
              var e = new Error((result && result.error) || 'unknown');
              e.failureType = (result && result.error) || 'unknown';
              throw e;
            }
            if (form) form.hidden = true;
            if (confirmSection) confirmSection.hidden = true;
            if (completeSection) completeSection.hidden = false;
            if (analytics() && result.duplicate !== true) {
              if (LEAD_TYPE && TEMPLATE_TYPE === 'event_entry') {
                analytics().trackGenerateLead(payload.submission_id, { lead_type: LEAD_TYPE, form_name: FORM_NAME });
              } else {
                analytics().track('survey_submit', { form_name: FORM_NAME, submission_id: payload.submission_id });
              }
            }
          })
          .catch(function (error) {
            submissionInFlight = false;
            if (submitBtn) submitBtn.disabled = false;
            if (analytics()) analytics().trackFormError(FORM_NAME, (error && error.failureType) || 'network');
            if (submitError) {
              submitError.textContent = '送信に失敗しました。通信環境をご確認のうえ、もう一度お試しください。';
              submitError.hidden = false;
            }
          });
      });
    }

    if (analytics()) analytics().trackFormStart(FORM_NAME);
  })();
  </script>
`;
}

export function renderFormHTML(config, opts) {
  opts = opts || {};
  const meta = templateMeta(config.type);
  const head = buildHead(config, opts);

  const body =
    `<body>\n` +
    `  <main class="fb-form-wrap">\n` +
    `    <h1>${escapeHtml(config.title)}</h1>\n` +
    (config.subtitle ? `    <p>${escapeHtml(config.subtitle)}</p>\n` : '') +
    buildEventInfoBlock(config) +
    `    <form id="fb-form" novalidate>\n` +
    `      <input type="text" name="website" class="fb-honey" tabindex="-1" autocomplete="off">\n` +
    buildContactFields(config) +
    buildDatesSection(config) +
    buildPlansSection(config) +
    (config.questions || []).map(buildQuestionField).join('') +
    buildConsentBlock(config) +
    `      <p class="fb-error" id="fb-submit-error" hidden></p>\n` +
    `      <button type="button" id="fb-confirm-btn" class="fb-btn">確認する</button>\n` +
    `      <section id="fb-confirm-section" class="fb-confirm" hidden>\n` +
    `        <h2>入力内容の確認</h2>\n` +
    `        <dl id="fb-confirm-summary"></dl>\n` +
    `        <button type="submit" id="fb-submit-btn" class="fb-btn">この内容で送信する</button>\n` +
    `      </section>\n` +
    `    </form>\n` +
    `    <section id="fb-complete-section" class="fb-complete" hidden>\n` +
    `      <h2>送信が完了しました</h2>\n` +
    `      <p>ご入力ありがとうございました。</p>\n` +
    `    </section>\n` +
    `  </main>\n` +
    buildBodyScript(config, opts) +
    `</body>\n</html>\n`;

  const html = head + body;
  assertNoFrontMatter(html);
  return html;
}

export function assertNoFrontMatter(html) {
  if (!html.startsWith('<!DOCTYPE html>')) {
    throw new Error('front matter check failed: 生成HTMLの先頭が <!DOCTYPE html> ではありません。.nojekyll環境では --- 混入が致命的事故になるため中断しました。');
  }
  const first200 = html.slice(0, 200);
  if (/^\s*---/.test(first200.replace('<!DOCTYPE html>', ''))) {
    throw new Error('front matter check failed: 先頭付近に --- が含まれています。');
  }
  return true;
}

export function renderConfigJSON(config) {
  return JSON.stringify(config, null, 2) + '\n';
}

export function filePaths(config) {
  return {
    htmlPath: `${config.directory}/${config.slug}.html`,
    configPath: `${config.directory}/formdata/${config.slug}.config.json`,
    canonicalUrl: `${SITE_ORIGIN}/${config.directory}/${config.slug}.html`,
  };
}
