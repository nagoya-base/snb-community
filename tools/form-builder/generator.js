// SNB Form Builder: config(JSON) から公開用HTMLと設定JSONを生成する。
// 生成HTMLは「共通ランタイム(form-runtime.js) + 埋め込み設定JSON」方式。
// フォームごとの巨大な個別スクリプトを複製しない。
// 生成HTMLの先頭が絶対に `---` 等のfront matterで始まらないこと（.nojekyll環境の必須要件）。

import { FORM_TYPES, canonicalPath, canonicalUrl } from './schema.js';

const GA4_MEASUREMENT_ID = 'G-H9BD3KFZCR';
const GAS_PLACEHOLDER = 'PLACEHOLDER_REPLACE_WITH_GAS_EXEC_URL';

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// JSON文字列を <script type="application/json"> に安全に埋め込む。
// `<` を全てエスケープすることで `</script>` 等によるタグ早期終了を防ぐ。
function embedJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

// admin UIが内部的に使う一時プロパティ(userEditedKey等)を除去し、
// スキーマで定義したフィールドのみを出力する。
function sanitizeDates(dates) {
  return (dates || []).map(function (d) { return { key: d.key, date: d.date, label: d.label || '' }; });
}

function sanitizePlans(plans) {
  return (plans || []).map(function (p) { return { key: p.key, label: p.label }; });
}

function sanitizeQuestions(questions) {
  return (questions || []).map(function (q) {
    return {
      key: q.key,
      type: q.type,
      label: q.label,
      required: !!q.required,
      help: q.help || '',
      options: (q.options || []).map(function (o) { return { value: o.value, label: o.label }; }),
      allowOther: !!q.allowOther
    };
  });
}

export function sanitizeConfig(config) {
  return {
    schemaVersion: config.schemaVersion,
    type: config.type,
    pillar: config.pillar,
    slug: config.slug,
    title: config.title,
    subtitle: config.subtitle,
    meta: { description: config.meta.description, ogpImage: config.meta.ogpImage || '' },
    event: config.event,
    dates: sanitizeDates(config.dates),
    plans: sanitizePlans(config.plans),
    questions: sanitizeQuestions(config.questions),
    consentText: config.consentText || '',
    gas: { execUrl: (config.gas && config.gas.execUrl) || '' }
  };
}

function buildRuntimeConfig(rawConfig) {
  var config = sanitizeConfig(rawConfig);
  var typeInfo = FORM_TYPES[config.type];
  return {
    schemaVersion: config.schemaVersion,
    type: config.type,
    gaEvent: typeInfo.gaEvent,
    pillar: config.pillar,
    slug: config.slug,
    title: config.title,
    subtitle: config.subtitle,
    event: config.event,
    dates: config.dates,
    plans: config.plans,
    questions: config.questions,
    consentText: config.consentText,
    gasExecUrl: config.gas.execUrl || GAS_PLACEHOLDER,
    gasDeployed: !!config.gas.execUrl
  };
}

function buildTitleTag(config) {
  var typeInfo = FORM_TYPES[config.type];
  var suffix = typeInfo.gaEvent === 'generate_lead' ? '参加申込' : 'アンケート';
  return config.title + '｜' + suffix + '｜SNBコミュニティ';
}

function buildJsonLd(config) {
  if (config.type !== 'event_entry' || !config.event || !config.event.date) return '';
  var startIso = config.event.date + (config.event.startTime ? 'T' + config.event.startTime + ':00+09:00' : '');
  var endIso = config.event.endTime ? config.event.date + 'T' + config.event.endTime + ':00+09:00' : undefined;
  var ld = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: config.title,
    description: config.subtitle || config.meta.description,
    startDate: startIso,
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    organizer: {
      '@type': 'Organization',
      name: 'SNBコミュニティ（SNBC）',
      url: 'https://nagoya-base.github.io/snb-community/' + config.pillar + '/'
    }
  };
  if (endIso) ld.endDate = endIso;
  if (config.event.venue) {
    ld.location = { '@type': 'Place', name: config.event.venue };
  }
  return '\n  <script type="application/ld+json">\n' + JSON.stringify(ld, null, 2).replace(/</g, '\\u003c') + '\n  </script>\n';
}

function buildHead(config) {
  var titleTag = escapeHtml(buildTitleTag(config));
  var description = escapeHtml(config.meta.description);
  var url = canonicalUrl(config);
  var ogpImageUrl = config.meta.ogpImage
    ? 'https://nagoya-base.github.io/snb-community/' + config.meta.ogpImage.replace(/^\/+/, '')
    : '';

  var ogpTags = ogpImageUrl
    ? '  <meta property="og:image" content="' + escapeHtml(ogpImageUrl) + '">\n' +
      '  <meta property="og:image:width" content="1200">\n' +
      '  <meta property="og:image:height" content="630">\n' +
      '  <meta name="twitter:image" content="' + escapeHtml(ogpImageUrl) + '">\n'
    : '';

  return [
    '<!DOCTYPE html>',
    '<html lang="ja">',
    '<head>',
    '  <meta charset="UTF-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '  <meta name="robots" content="index, follow">',
    '  <title>' + titleTag + '</title>',
    '  <meta name="description" content="' + description + '">',
    '  <link rel="canonical" href="' + escapeHtml(url) + '">',
    buildJsonLd(config),
    '  <meta property="og:title" content="' + titleTag + '">',
    '  <meta property="og:description" content="' + description + '">',
    '  <meta property="og:type" content="website">',
    '  <meta property="og:url" content="' + escapeHtml(url) + '">',
    ogpTags + '  <meta name="twitter:card" content="summary_large_image">',
    '  <meta name="twitter:title" content="' + titleTag + '">',
    '  <meta name="twitter:description" content="' + description + '">',
    '',
    '  <!-- ?test=1 は保存・通知・GA4を一切行わない画面確認用、?test=closed は受付終了表示の確認用。 -->',
    '  <script>',
    '    window.SNB_TEST_MODE = (function () {',
    "      try { return new URLSearchParams(window.location.search).get('test') === '1'; } catch (e) { return false; }",
    '    })();',
    '    window.SNB_PREVIEW_CLOSED_MODE = (function () {',
    "      try { return new URLSearchParams(window.location.search).get('test') === 'closed'; } catch (e) { return false; }",
    '    })();',
    '  </script>',
    '  <!-- テスト／クローズド確認中はGA4そのものを読み込まない。 -->',
    '  <script>',
    '    if (!window.SNB_TEST_MODE && !window.SNB_PREVIEW_CLOSED_MODE) {',
    '      window.dataLayer = window.dataLayer || [];',
    '      window.gtag = function () { window.dataLayer.push(arguments); };',
    "      window.gtag('js', new Date());",
    "      window.gtag('config', '" + GA4_MEASUREMENT_ID + "');",
    "      var snbGtagScript = document.createElement('script');",
    '      snbGtagScript.async = true;',
    "      snbGtagScript.src = 'https://www.googletagmanager.com/gtag/js?id=" + GA4_MEASUREMENT_ID + "';",
    '      document.head.appendChild(snbGtagScript);',
    '    }',
    '  </script>',
    '  <script src="../analytics.js"></script>',
    '  <link rel="stylesheet" href="../form-runtime.css">',
    '</head>'
  ].filter(Boolean).join('\n');
}

function buildBody(config) {
  var typeInfo = FORM_TYPES[config.type];
  var runtimeConfig = buildRuntimeConfig(config);
  var subtitle = config.subtitle ? '<p class="snb-form-subtitle">' + escapeHtml(config.subtitle) + '</p>' : '';

  return [
    '<body data-site-section="' + escapeHtml(config.pillar) + '" data-page-type="' + escapeHtml(typeInfo.pageType) + '" data-event-slug="' + escapeHtml(config.slug) + '" data-event-title="' + escapeHtml(config.title) + '">',
    '  <main class="snb-form-page">',
    '    <header class="snb-form-header">',
    '      <h1>' + escapeHtml(config.title) + '</h1>',
    '      ' + subtitle,
    '    </header>',
    '    <div id="snb-form-root" data-snb-form-runtime>',
    '      <noscript>このページの表示にはJavaScriptが必要です。ブラウザの設定をご確認ください。</noscript>',
    '    </div>',
    '  </main>',
    '  <script type="application/json" id="snb-form-config">' + embedJson(runtimeConfig) + '</script>',
    '  <script src="../form-runtime.js"></script>',
    '</body>',
    '</html>',
    ''
  ].join('\n');
}

// 生成HTML本体。1行目が必ず <!DOCTYPE html> になる（front matter混入なし）。
export function generateHtml(config) {
  var html = buildHead(config) + '\n' + buildBody(config);
  if (html.trimStart().indexOf('---') === 0) {
    throw new Error('生成HTMLの先頭にfront matterが混入しています（内部エラー）。');
  }
  return html;
}

export function generateConfigJson(config) {
  return JSON.stringify(sanitizeConfig(config), null, 2) + '\n';
}

export function outputPaths(config) {
  var htmlPath = canonicalPath(config);
  var jsonPath = config.pillar + '/form-data/' + config.slug + '.json';
  return { htmlPath: htmlPath, jsonPath: jsonPath };
}
