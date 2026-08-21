// 設定JSON -> 公開用HTML文字列。プレビューと最終生成物の両方がこの関数を通るため、
// 「プレビューで見たものがそのまま生成される」ことが保証される。
import { escapeHtml, escapeAttr, dateToKey } from './util.js';

const GA_MEASUREMENT_ID = 'G-H9BD3KFZCR';
const SITE_ORIGIN = 'https://nagoya-base.github.io/snb-community';
const DEFAULT_OG_IMAGE = 'images/common/top/meta-ogp-main.jpg';

const SECTION_LABEL = { community: 'SNBコミュニティ', baseball: '名古屋野球ユニ部' };
const SECTION_BRAND_SUFFIX = { community: 'SNBコミュニティ', baseball: '名古屋野球ユニ部' };

function canonicalUrl(config) {
  return `${SITE_ORIGIN}/${config.section}/${config.slug}.html`;
}

function ogImageUrl(config) {
  const path = (config.ogImagePath || DEFAULT_OG_IMAGE).replace(/^\/+/, '');
  return `${SITE_ORIGIN}/${path}`;
}

function renderHead(config, opts = {}) {
  const title = `${escapeHtml(config.title)}｜${SECTION_BRAND_SUFFIX[config.section]}`;
  const desc = escapeHtml(config.description);
  const url = canonicalUrl(config);
  const img = ogImageUrl(config);
  const robots = 'noindex, nofollow'; // 内部運用フォームは検索に出さない（既存の baseball/community アンケートと同方針）

  let jsonLd = '';
  if (config.type === 'event_entry' && config.event?.eventDate) {
    const ev = config.event;
    const start = ev.startTime ? `${ev.eventDate}T${ev.startTime}:00+09:00` : `${ev.eventDate}T00:00:00+09:00`;
    const end = ev.endTime ? `${ev.eventDate}T${ev.endTime}:00+09:00` : undefined;
    const ld = {
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: config.title,
      startDate: start,
      ...(end ? { endDate: end } : {}),
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      eventStatus: 'https://schema.org/EventScheduled',
      location: {
        '@type': 'Place',
        name: ev.venue || SECTION_LABEL[config.section]
      },
      organizer: {
        '@type': 'Organization',
        name: SECTION_BRAND_SUFFIX[config.section],
        url: `${SITE_ORIGIN}/${config.section}/`
      },
      ...(ev.fee ? { offers: { '@type': 'Offer', price: String(ev.fee).replace(/[^0-9.]/g, '') || '0', priceCurrency: 'JPY', url } } : {})
    };
    jsonLd = `  <script type="application/ld+json">${JSON.stringify(ld)}</script>\n`;
  }

  // プレビュー(srcdoc)はform-builder自身の設置場所を基準に相対パスが解決されてしまうため、
  // 実際の公開先ディレクトリをbaseに指定して ../common.css ../analytics.js を正しく解決させる。
  const baseTag = opts.preview ? `  <base href="${SITE_ORIGIN}/${config.section}/">\n` : '';

  return `<!DOCTYPE html>
<html lang="ja">
<head>
${baseTag}  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="${robots}">
  <title>${title}</title>
  <meta name="description" content="${desc}">
  <link rel="canonical" href="${url}">

  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${desc}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${img}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${desc}">
  <meta name="twitter:image" content="${img}">
${jsonLd}
  <!-- ?test=1 は保存・通知・GA4を一切行わない画面確認用、?test=closed は受付終了表示の確認用。 -->
${opts.preview ? `  <script>
    /* form-builder管理画面のプレビュー用に固定。実際のURLクエリには依存しない（GA4を確実に発火させないため）。 */
    window.SNB_TEST_MODE = ${opts.previewClosed ? 'false' : 'true'};
    window.SNB_PREVIEW_CLOSED_MODE = ${opts.previewClosed ? 'true' : 'false'};
  </script>` : `  <script>
    window.SNB_TEST_MODE = (function () {
      try { return new URLSearchParams(window.location.search).get('test') === '1'; } catch (e) { return false; }
    })();
    window.SNB_PREVIEW_CLOSED_MODE = (function () {
      try { return new URLSearchParams(window.location.search).get('test') === 'closed'; } catch (e) { return false; }
    })();
  </script>`}
  <!-- テスト／クローズド確認中はGA4そのものを読み込まない。 -->
  <script>
    if (!window.SNB_TEST_MODE && !window.SNB_PREVIEW_CLOSED_MODE) {
      window.dataLayer = window.dataLayer || [];
      window.gtag = function () { window.dataLayer.push(arguments); };
      window.gtag('js', new Date());
      window.gtag('config', '${GA_MEASUREMENT_ID}');
      var snbGtagScript = document.createElement('script');
      snbGtagScript.async = true;
      snbGtagScript.src = 'https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}';
      document.head.appendChild(snbGtagScript);
    }
  </script>
  <script src="../analytics.js"></script>

  <link rel="stylesheet" href="../common.css">
  <style>
${FORM_STYLE}
  </style>
</head>`;
}

function renderNav(config) {
  const pillars = [
    { key: 'baseball', href: '../baseball/', label: '⚾ 野球ユニ部' },
    { key: 'community', href: '../community/', label: '🤝 SNBコミュニティ' },
    { key: 'portrait', href: '../portrait/', label: '📷 ポートレート' }
  ];
  const links = pillars.map((p) => {
    const current = p.key === config.section ? ' aria-current="page"' : '';
    return `    <a href="${p.href}" class="site-nav__pillar site-nav__pillar--${p.key}"${current}>${p.label}</a>`;
  }).join('\n');
  return `<nav class="site-nav">
  <a href="../" class="site-nav__brand">SNB Community</a>
  <div class="site-nav__right">
${links}
  </div>
</nav>`;
}

function renderHero(config) {
  const specs = [];
  if (config.type === 'event_entry') {
    const ev = config.event || {};
    if (ev.eventDate) specs.push(`🗓️ ${escapeHtml(ev.eventDate)}`);
    if (ev.startTime) specs.push(`⏱️ ${escapeHtml(ev.startTime)}${ev.endTime ? `〜${escapeHtml(ev.endTime)}` : ''}`);
    if (ev.fee) specs.push(`💰 ${escapeHtml(ev.fee)}`);
    if (ev.capacity) specs.push(`👥 定員${escapeHtml(String(ev.capacity))}名`);
  } else {
    specs.push('⏱️ 約1〜2分で回答できます');
  }
  const specHtml = specs.map((s) => `<span class="hero-spec">${s}</span>`).join('\n        ');
  return `  <section class="hero" id="top" aria-labelledby="page-title">
    <div class="container">
      <p class="hero-tag">${SECTION_LABEL[config.section]}</p>
      <h1 id="page-title">${escapeHtml(config.title)}</h1>
      ${config.subtitle ? `<p class="hero-lead">${escapeHtml(config.subtitle)}</p>` : ''}
      <div class="hero-specs">
        ${specHtml}
      </div>
      <a href="#survey" class="btn btn-primary" data-cta-name="form_start_cta" data-cta-location="hero">回答する</a>
      <a href="./" class="btn btn-outline" data-cta-name="section_top" data-cta-location="hero">${SECTION_LABEL[config.section]}トップに戻る</a>
    </div>
  </section>`;
}

function renderDatesBlock(config) {
  if (config.type !== 'date_survey' && config.type !== 'cross_tab_survey') return '';
  const dates = (config.dates || []);
  const hosted = dates.filter((d) => d.hosted !== false);
  const nonHosted = dates.filter((d) => d.hosted === false);

  const hostedInputs = hosted.map((d) => {
    const key = d.key || dateToKey(d.date);
    return `        <label class="choice">
          <input type="checkbox" name="date" value="${escapeAttr(d.label)}" data-sheet-key="${escapeAttr(key)}">
          <span class="choice__body">${escapeHtml(d.label)}</span>
        </label>`;
  }).join('\n');

  // 開催しない日は非表示のまま常にfalseを送信する（列構造を将来変更しても既存シートと揃えやすくするため）。
  const nonHostedInputs = nonHosted.map((d) => {
    const key = d.key || dateToKey(d.date);
    return `        <input type="checkbox" name="date" value="${escapeAttr(d.label)}" data-sheet-key="${escapeAttr(key)}" hidden aria-hidden="true" tabindex="-1">`;
  }).join('\n');

  return `  <section class="q-block" id="q-dates">
    <p class="q-kicker">候補日</p>
    <h3 class="q-title">参加できる日を選んでください <span class="required">必須</span></h3>
    <fieldset>
      <legend class="sr-only">候補日</legend>
      <div class="choice-grid" id="date-grid">
${hostedInputs}
${nonHostedInputs}
      </div>
    </fieldset>
    <p class="q-error" id="error-dates" role="alert" aria-live="polite"></p>
  </section>`;
}

function renderChoiceInputs(q) {
  const type = q.type === 'checkbox' ? 'checkbox' : 'radio';
  const opts = (q.options || []).map((o) => `        <label class="choice">
          <input type="${type}" name="${escapeAttr(q.key)}" value="${escapeAttr(o.value ?? o.label)}">
          <span class="choice__body">${escapeHtml(o.label)}</span>
        </label>`).join('\n');
  const other = q.allowOther ? `        <label class="choice">
          <input type="${type}" name="${escapeAttr(q.key)}" value="その他">
          <span class="choice__body">その他</span>
        </label>` : '';
  const otherField = q.allowOther ? `
    <div id="${escapeAttr(q.key)}-other-field" class="sub-field" hidden>
      <label class="field-label" for="${escapeAttr(q.key)}-other">その他の内容</label>
      <input type="text" id="${escapeAttr(q.key)}-other" class="text-input" maxlength="120">
    </div>` : '';
  return { optionsHtml: [opts, other].filter(Boolean).join('\n'), otherField };
}

function renderQuestion(q, index) {
  const reqBadge = q.required ? '<span class="required">必須</span>' : '<span class="optional">任意</span>';
  const help = q.help ? `<p class="q-lead">${escapeHtml(q.help)}</p>` : '';
  const errorP = `<p class="q-error" id="error-${escapeAttr(q.key)}" role="alert" aria-live="polite"></p>`;

  let body = '';
  if (q.type === 'text') {
    body = `    <label class="field-label" for="${escapeAttr(q.key)}">${escapeHtml(q.label)}</label>
    <input type="text" id="${escapeAttr(q.key)}" name="${escapeAttr(q.key)}" class="text-input"${q.maxLength ? ` maxlength="${Number(q.maxLength)}"` : ''}>`;
  } else if (q.type === 'textarea') {
    body = `    <label class="field-label" for="${escapeAttr(q.key)}">${escapeHtml(q.label)}</label>
    <textarea id="${escapeAttr(q.key)}" name="${escapeAttr(q.key)}" class="text-input"${q.maxLength ? ` maxlength="${Number(q.maxLength)}"` : ''}></textarea>`;
  } else if (q.type === 'select') {
    const opts = (q.options || []).map((o) => `      <option value="${escapeAttr(o.value ?? o.label)}">${escapeHtml(o.label)}</option>`).join('\n');
    body = `    <label class="field-label" for="${escapeAttr(q.key)}">${escapeHtml(q.label)}</label>
    <select id="${escapeAttr(q.key)}" name="${escapeAttr(q.key)}" class="text-input">
      <option value="">選択してください</option>
${opts}
    </select>`;
  } else {
    // radio / checkbox
    const { optionsHtml, otherField } = renderChoiceInputs(q);
    body = `    <fieldset>
      <legend class="sr-only">${escapeHtml(q.label)}</legend>
      <div class="choice-grid">
${optionsHtml}
      </div>
    </fieldset>${otherField}`;
  }

  return `  <section class="q-block" id="q-${escapeAttr(q.key)}">
    <p class="q-kicker">Q${index + 1}</p>
    <h3 class="q-title">${escapeHtml(q.label)} ${reqBadge}</h3>
    ${help}
${body}
    ${errorP}
  </section>`;
}

function renderContactBlock(config) {
  if (config.contact?.email === false && config.contact?.x === false) return '';
  const emailField = config.contact?.email !== false ? `      <div>
        <label class="field-label" for="contact_email">メールアドレス <span class="optional">任意</span></label>
        <input type="email" id="contact_email" name="contact_email" class="text-input" autocomplete="email">
      </div>` : '';
  const xField = config.contact?.x !== false ? `      <div>
        <label class="field-label" for="contact_x">Xアカウント（@なし） <span class="optional">任意</span></label>
        <input type="text" id="contact_x" name="contact_x" class="text-input" autocomplete="off">
      </div>` : '';
  return `  <section class="q-block" id="q-contact">
    <p class="q-kicker">連絡先</p>
    <h3 class="q-title">連絡先（任意）</h3>
    <p class="q-lead">個人を特定できる情報はGA4へ送信しません。連絡が必要な場合のみご記入ください。</p>
    <div class="contact-grid">
${emailField}
${xField}
    </div>
  </section>`;
}

function renderConsentBlock(config) {
  if (config.type !== 'event_entry' || !config.consent?.enabled) return '';
  return `  <section class="q-block" id="q-consent">
    <label class="choice" style="display:flex;align-items:flex-start;gap:.6rem;">
      <input type="checkbox" id="agree_terms" name="agree_terms" required>
      <span class="choice__body" style="min-height:auto;">${escapeHtml(config.consent.label || '注意事項に同意します')} <span class="required">必須</span></span>
    </label>
    <p class="q-error" id="error-agree_terms" role="alert" aria-live="polite"></p>
  </section>`;
}

function buildFormJs(config) {
  const gasUrl = config.gas?.execUrl || '';
  const formName = config.analytics?.formName || `${config.slug}_form`;
  const leadEvent = config.analytics?.leadEvent === 'generate_lead' ? 'generate_lead' : 'survey_submit';
  const isDateType = config.type === 'date_survey' || config.type === 'cross_tab_survey';
  const dates = config.dates || [];
  const questions = config.questions || [];
  const hasConsent = config.type === 'event_entry' && config.consent?.enabled;
  const entryStatus = config.type === 'event_entry' ? (config.event?.entryStatus || 'open') : 'open';

  // buildPayload: 質問キー・候補日キー・連絡先・submission_idをまとめてJSONオブジェクトを作る。
  const questionKeys = questions.map((q) => q.key);
  const dateKeys = dates.map((d) => d.key || dateToKey(d.date));

  return `(function () {
  'use strict';

  var GAS_ENDPOINT_URL = ${JSON.stringify(gasUrl)};
  var FORM_NAME = ${JSON.stringify(formName)};
  var LEAD_EVENT = ${JSON.stringify(leadEvent)};
  var QUESTION_KEYS = ${JSON.stringify(questionKeys)};
  var CHOICE_QUESTIONS = ${JSON.stringify(questions.filter((q) => q.type === 'radio' || q.type === 'checkbox').map((q) => ({ key: q.key, type: q.type, required: !!q.required, allowOther: !!q.allowOther })))};
  var REQUIRED_TEXT_KEYS = ${JSON.stringify(questions.filter((q) => (q.type === 'text' || q.type === 'select' || q.type === 'textarea') && q.required).map((q) => q.key))};
  var DATE_KEYS = ${JSON.stringify(dateKeys)};
  var HAS_CONSENT = ${JSON.stringify(hasConsent)};
  var ENTRY_STATUS = ${JSON.stringify(entryStatus)};

  var isTestMode = window.SNB_TEST_MODE === true;
  var isPreviewClosedMode = window.SNB_PREVIEW_CLOSED_MODE === true;
  var submissionInFlight = false;
  var submissionId = null;
  var formStarted = false;

  function analytics() {
    if (isTestMode || isPreviewClosedMode) return null;
    return window.SNBAnalytics || null;
  }

  function getSubmissionId() {
    if (!submissionId) {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        submissionId = window.crypto.randomUUID();
      } else {
        submissionId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + '-' + Math.random().toString(36).slice(2);
      }
    }
    return submissionId;
  }

  var form = document.getElementById('survey-form');
  if (!form) return;

  var testBanner = document.getElementById('test-banner');
  if (isTestMode && testBanner) testBanner.hidden = false;

  var gasMissingNotice = document.getElementById('gas-missing-notice');
  if (!GAS_ENDPOINT_URL && gasMissingNotice) gasMissingNotice.hidden = false;

  var effectiveStatus = isTestMode ? 'open' : (isPreviewClosedMode ? 'closed' : ENTRY_STATUS);
  var closedBanner = document.getElementById('closed-banner');
  var submitButtonEl = document.getElementById('submit-button');
  if (effectiveStatus === 'closed') {
    if (closedBanner) closedBanner.hidden = false;
    if (submitButtonEl) { submitButtonEl.disabled = true; submitButtonEl.textContent = '受付終了しました'; }
  }

  form.addEventListener('input', function () {
    if (formStarted) return;
    formStarted = true;
    if (analytics()) analytics().trackFormStart(FORM_NAME);
  }, { once: false });

  function setError(key, message) {
    var el = document.getElementById('error-' + key);
    if (el) el.textContent = message || '';
  }

  function clearErrors() {
    document.querySelectorAll('.q-error').forEach(function (el) { el.textContent = ''; });
  }

  function validate() {
    clearErrors();
    var ok = true;

    ${isDateType ? `var checkedDates = form.querySelectorAll('input[name="date"]:checked');
    if (checkedDates.length === 0) { setError('dates', '少なくとも1つ選んでください。'); ok = false; }` : ''}

    QUESTION_KEYS.forEach(function (key) {
      // テキスト系必須項目
      if (REQUIRED_TEXT_KEYS.indexOf(key) !== -1) {
        var el = document.getElementById(key);
        if (el && !el.value.trim()) { setError(key, '入力してください。'); ok = false; }
      }
    });

    CHOICE_QUESTIONS.forEach(function (q) {
      if (!q.required) return;
      var checked = form.querySelectorAll('input[name="' + q.key + '"]:checked');
      if (checked.length === 0) { setError(q.key, '選択してください。'); ok = false; }
    });

    CHOICE_QUESTIONS.forEach(function (q) {
      if (!q.allowOther) return;
      var checkedOther = form.querySelector('input[name="' + q.key + '"][value="その他"]:checked');
      var otherInput = document.getElementById(q.key + '-other');
      if (checkedOther && otherInput && !otherInput.value.trim()) {
        setError(q.key, 'その他の内容を入力してください。'); ok = false;
      }
    });

    ${hasConsent ? `var agree = document.getElementById('agree_terms');
    if (agree && !agree.checked) { setError('agree_terms', '同意が必要です。'); ok = false; }` : ''}

    return ok;
  }

  function collectOtherFields() {
    var payload = {};
    CHOICE_QUESTIONS.forEach(function (q) {
      if (!q.allowOther) return;
      var checkedOther = form.querySelector('input[name="' + q.key + '"][value="その他"]:checked');
      var otherInput = document.getElementById(q.key + '-other');
      payload[q.key + '_other'] = checkedOther && otherInput ? otherInput.value.trim() : '';
    });
    return payload;
  }

  function buildPayload() {
    var payload = { submission_id: getSubmissionId() };

    ${isDateType ? `DATE_KEYS.forEach(function (key) {
      var input = form.querySelector('input[name="date"][data-sheet-key="' + key + '"]');
      payload[key] = !!(input && input.checked);
    });` : ''}

    QUESTION_KEYS.forEach(function (key) {
      var isChoice = CHOICE_QUESTIONS.some(function (q) { return q.key === key; });
      if (isChoice) {
        var checked = Array.prototype.slice.call(form.querySelectorAll('input[name="' + key + '"]:checked'));
        payload[key] = checked.map(function (el) { return el.value; }).join('、');
      } else {
        var el = document.getElementById(key);
        payload[key] = el ? el.value.trim() : '';
      }
    });

    var otherFields = collectOtherFields();
    for (var k in otherFields) { if (Object.prototype.hasOwnProperty.call(otherFields, k)) payload[k] = otherFields[k]; }

    var emailEl = document.getElementById('contact_email');
    var xEl = document.getElementById('contact_x');
    if (emailEl) payload.contact_email = emailEl.value.trim();
    if (xEl) payload.contact_x = xEl.value.trim();

    ${hasConsent ? `var agreeEl = document.getElementById('agree_terms');
    payload.agree_terms = !!(agreeEl && agreeEl.checked);` : ''}

    return payload;
  }

  function setSubmitting(submitting) {
    var btn = document.getElementById('submit-button');
    if (!btn) return;
    btn.disabled = submitting;
    btn.textContent = submitting ? '送信中…' : '送信する';
  }

  function showCompletion() {
    var card = document.getElementById('survey-card');
    var done = document.getElementById('done-screen');
    if (card) card.hidden = true;
    if (done) done.hidden = false;
    if (done) done.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (submissionInFlight) return;
    if (effectiveStatus === 'closed') return;

    // ハニーポット: 人間には見えない項目。埋まっていたら黙って成功扱いにする。
    var honey = form.querySelector('input[name="website"]');
    if (honey && honey.value) {
      showCompletion();
      return;
    }

    if (!validate()) {
      if (analytics()) analytics().trackFormError(FORM_NAME, 'validation');
      var firstError = form.querySelector('.q-error:not(:empty)');
      if (firstError) firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    var payload = buildPayload();

    if (isTestMode || isPreviewClosedMode) {
      showCompletion();
      return;
    }

    if (!GAS_ENDPOINT_URL) {
      setError('${questionKeys[0] || 'dates'}', 'GAS Web AppのURLが未設定のため送信できません（管理者へご連絡ください）。');
      return;
    }

    submissionInFlight = true;
    setSubmitting(true);

    fetch(GAS_ENDPOINT_URL, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }
    }).then(function (response) {
      if (!response.ok) throw new Error('http_' + response.status);
      return response.json();
    }).then(function (result) {
      if (!result || result.ok !== true) throw new Error(result && result.error ? result.error : 'unknown');
      showCompletion();
      if (result.duplicate !== true) {
        var a = analytics();
        if (a) {
          if (LEAD_EVENT === 'generate_lead') {
            a.trackGenerateLead(payload.submission_id, { lead_type: 'snbc_event_entry', form_name: FORM_NAME });
          } else {
            a.track('survey_submit', { form_name: FORM_NAME });
          }
        }
      }
    }).catch(function () {
      submissionInFlight = false;
      setSubmitting(false);
      if (analytics()) analytics().trackFormError(FORM_NAME, 'submit_failed');
      var el = document.getElementById('submit-error');
      if (el) { el.hidden = false; el.textContent = '送信に失敗しました。時間をおいて再度お試しください。'; el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    });
  });
})();`;
}

const FORM_STYLE = `    .btn { display: inline-block; padding: .95rem 2rem; border-radius: 999px; font-size: .95rem; font-weight: 800; letter-spacing: .05em; text-decoration: none; border: 2px solid transparent; transition: all .18s; margin: .25rem; cursor: pointer; }
    .btn-primary { background: var(--accent); color: #fff; }
    .btn-primary:hover { background: var(--accent-lt); transform: translateY(-2px); }
    .btn-primary:disabled { opacity: .6; cursor: wait; transform: none; }
    .btn-outline { background: var(--bg-card); border-color: var(--accent); color: var(--accent); }
    .hero-specs { display: flex; flex-wrap: wrap; justify-content: center; gap: .5rem .6rem; margin-bottom: 1rem; }
    .hero-spec { background: var(--bg-card); border: 1px solid var(--border); border-radius: 999px; padding: .35rem 1rem; font-size: .82rem; font-weight: 700; color: var(--text); }
    .survey-shell { max-width: var(--max-w); margin: -1.5rem auto 0; padding: 0 1.5rem 4rem; position: relative; }
    .test-banner { margin-bottom: 1.25rem; padding: .9rem 1rem; border-radius: 12px; font-size: .84rem; font-weight: 800; border: 1px solid #dfbc48; background: #fff4ca; color: #664c00; }
    .gas-missing-notice { margin-bottom: 1.25rem; padding: .9rem 1rem; border-radius: 12px; font-size: .84rem; font-weight: 800; border: 1px solid #e0a0a0; background: #fdecec; color: #8a2020; }
    .survey-card { overflow: hidden; border: 1px solid var(--border); border-radius: 20px; background: var(--bg-card); box-shadow: 0 14px 36px rgba(28,26,23,.08); }
    .q-block { padding: 1.75rem clamp(1.1rem,4vw,2.2rem); border-bottom: 1px solid var(--border); }
    .q-block:last-of-type { border-bottom: none; }
    .q-kicker { margin: 0 0 .4rem; color: var(--accent); font-size: .72rem; font-weight: 800; letter-spacing: .1em; }
    .q-title { margin: 0 0 .5rem; font-size: 1.12rem; font-weight: 800; color: var(--text); line-height: 1.5; }
    .q-lead { margin: 0 0 1rem; color: var(--text-muted); font-size: .84rem; }
    .required, .optional { display: inline-flex; align-items: center; margin-left: .4rem; border-radius: 999px; padding: .12rem .5rem; font-size: .62rem; font-weight: 800; letter-spacing: .05em; vertical-align: middle; }
    .required { background: #fdecec; color: #b3392f; }
    .optional { background: var(--bg-tint); color: var(--text-muted); }
    fieldset { border: 0; margin: 0; padding: 0; min-width: 0; }
    legend { padding: 0; }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; }
    .field-label { display: block; margin-bottom: .4rem; font-size: .84rem; font-weight: 800; color: var(--text); }
    .text-input, textarea.text-input { width: 100%; padding: .75rem .9rem; border: 1px solid var(--border); border-radius: 10px; background: var(--bg-card); color: var(--text); font-size: .92rem; font-family: inherit; }
    textarea.text-input { min-height: 90px; resize: vertical; }
    .contact-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    .choice-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: .65rem; }
    .choice { position: relative; display: block; cursor: pointer; }
    .choice input { position: absolute; opacity: 0; pointer-events: none; }
    .choice__body { height: 100%; display: flex; align-items: center; min-height: 58px; padding: .85rem 1rem; border: 1px solid var(--border); border-radius: 12px; background: var(--bg-card); font-size: .88rem; font-weight: 700; color: var(--text); transition: border-color .15s, background .15s, transform .15s; }
    .choice:hover .choice__body { border-color: var(--accent-lt); transform: translateY(-2px); }
    .choice:has(input:checked) .choice__body { border: 2px solid var(--accent); background: var(--bg-tint); color: var(--accent-lt); }
    .sub-field { margin-top: .9rem; }
    .q-error { min-height: 1.4em; margin: .9rem 0 0; color: #ae2020; font-size: .82rem; font-weight: 800; }
    .form-honey { position: absolute; left: -9999px; width: 1px; height: 1px; opacity: 0; }
    .survey-actions { display: flex; align-items: center; gap: .7rem; padding: 1.3rem clamp(1.1rem,4vw,2.2rem); }
    .survey-actions .btn-primary { flex: 1; text-align: center; }
    #submit-error { margin: 0 clamp(1.1rem,4vw,2.2rem) 1rem; padding: .75rem .9rem; border-radius: 9px; background: #fff1ef; color: #8a2020; font-size: .84rem; font-weight: 700; }
    .done { padding: clamp(2rem,7vw,3.5rem) clamp(1.5rem,5vw,2.4rem); text-align: center; }
    .done__mark { display: grid; place-items: center; width: 60px; height: 60px; margin: 0 auto 1.1rem; border-radius: 50%; background: var(--bg-tint); color: var(--accent-lt); font-size: 1.7rem; font-weight: 900; }
    .done h2 { margin: 0; font-size: clamp(1.4rem,4vw,1.8rem); color: var(--text); }
    .done p { max-width: 460px; margin: .7rem auto 0; color: var(--text-muted); font-size: .88rem; }
    button, input, textarea, select { font: inherit; }
    button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible { outline: 3px solid #1c72c5; outline-offset: 2px; }
    [hidden] { display: none !important; }
    @media (max-width: 640px) {
      .survey-shell { margin-top: -1rem; padding: 0 1rem 3rem; }
      .contact-grid { grid-template-columns: 1fr; }
      .choice-grid { grid-template-columns: 1fr; }
      .survey-actions { flex-direction: column-reverse; align-items: stretch; }
    }`;

export function renderFormHtml(config, opts = {}) {
  const head = renderHead(config, opts);
  const nav = renderNav(config);
  const hero = renderHero(config);
  const datesBlock = renderDatesBlock(config);
  const questionBlocks = (config.questions || []).map((q, i) => renderQuestion(q, i)).join('\n');
  const contactBlock = renderContactBlock(config);
  const consentBlock = renderConsentBlock(config);
  const js = buildFormJs(config);

  return `${head}
<body data-site-section="${config.section}" data-page-type="${config.type === 'event_entry' ? 'event_entry' : 'survey'}" data-event-slug="${escapeAttr(config.slug)}" data-event-title="${escapeAttr(config.title)}">

${nav}

<main>
${hero}

  <div class="survey-shell">
    <p class="test-banner" id="test-banner" hidden>テストモード（?test=1）で表示しています。この画面での送信はGAS保存・通知・GA4計測を一切行いません。</p>
    <p class="test-banner" id="closed-banner" hidden>現在、受付を終了しています。</p>
    <p class="gas-missing-notice" id="gas-missing-notice" hidden>GAS Web AppのURLが未設定です。実際の送信はできません（管理画面でURLを設定し、再生成してください）。</p>

    <div class="survey-card" id="survey-card">
      <form id="survey-form" novalidate>
        <input type="text" name="website" class="form-honey" tabindex="-1" autocomplete="off" aria-hidden="true">

${datesBlock}
${questionBlocks}
${contactBlock}
${consentBlock}

        <p id="submit-error" hidden role="alert" aria-live="polite"></p>
        <div class="survey-actions">
          <button type="submit" id="submit-button" class="btn btn-primary">送信する</button>
        </div>
      </form>
    </div>

    <div class="done" id="done-screen" hidden>
      <div class="done__mark">✓</div>
      <h2>ご回答ありがとうございました</h2>
      <p>内容を受け付けました。</p>
    </div>
  </div>
</main>

<script>
${js}
</script>
</body>
</html>
`;
}

export function renderConfigJson(config) {
  return `${JSON.stringify(config, null, 2)}\n`;
}
