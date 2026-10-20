/*
 * 名古屋野球ユニ部アンケート 公開結果ページ（Issue #382 / 5言語対応 #414）。
 *
 * Spreadsheet には接続しない。読むのは privacy-safe snapshot だけ（Issue #425）：
 *  1. Public GAS の読み取り専用 endpoint（GET ?action=results）が返す snapshot（validateSnapshot 通過済み・batch 更新）
 *  2. 取得失敗・不正な応答のときは、同梱の snapshot.json（障害時 fallback）
 * 回答内容・locale は一切送らない（query は action=results のみ）。回答の送信ごとに更新されることはない。
 * DOM へは textContent だけで書く（innerHTML は使わない）。
 *
 * 多言語化（Issue #414）: ja / en / ko / zh-Hans / zh-Hant。
 *  - 表示文言だけを切り替える。件数・割合・state・targetCount・suppression など snapshot の値と公開判定は言語で変わらない。
 *  - 固定 UI・設問ラベル・選択肢ラベルは results-i18n.generated.js（回答ページと同じ i18n/*.json から生成）を
 *    question.id / option.id（cell.id）で引く。日本語は snapshot の label（schema 由来）を使い、翻訳が欠けた場合も日本語へ fallback する。
 *  - 選択言語の保存・初期言語の決定は回答ページと共有（locale.js）。URL・GA4 には載せない。
 *  - ヒーロー画像（source srcset / img src / alt）も言語に合わせて切り替え、画像が読めなければ ja へ fallback する。og:image / twitter:image は固定。
 */
var SurveyResultsView = (function () {
  'use strict';

  var SNAPSHOT_URL = 'baseball-uniform-survey-results/snapshot.json';
  var DYNAMIC_TIMEOUT_MS = 10000;
  /* privacy-safe snapshot に現れてはならないキー。dynamic な応答にあれば fail-closed で捨て、bundled snapshot へ fallback する。 */
  var PRIVATE_KEYS = ['respondent_hash', 'uuid', 'timestamp', 'source_channel', 'client_elapsed_ms', 'other_texts', 'free_text',
    'test_run_id', 'notification_status', 'response_mode', 'completion_status', 'answers', 'rows', 'records'];

  /* 言語別ヒーロー画像（images/baseball/catchball/）。ja が既定で、他言語の画像が読めなければ ja へ fallback する。
   * og:image / twitter:image は survey-ogp.jpg 固定（canonical な静的 meta）で、ここでは触らない。 */
  var HERO_BASE = '../images/baseball/catchball/';
  var HERO_JA = { webp: HERO_BASE + 'survey-hero.webp', img: HERO_BASE + 'survey-ogp.jpg' };
  var HERO_IMAGES = {
    ja: HERO_JA,
    en: { webp: HERO_BASE + 'survey-hero-en.webp', img: HERO_BASE + 'survey-hero-en.webp' },
    ko: { webp: HERO_BASE + 'survey-hero-ko.webp', img: HERO_BASE + 'survey-hero-ko.webp' },
    'zh-Hans': { webp: HERO_BASE + 'survey-hero-zh-hans.webp', img: HERO_BASE + 'survey-hero-zh-hans.webp' },
    'zh-Hant': { webp: HERO_BASE + 'survey-hero-zh-hant.webp', img: HERO_BASE + 'survey-hero-zh-hant.webp' }
  };
  var brokenHero = {}; // 読み込みに失敗した言語（以後は ja を使う。broken image を出さない）

  var I18N = (typeof SURVEY_RESULTS_I18N !== 'undefined' && SURVEY_RESULTS_I18N) || { default: 'ja', locales: ['ja'], dynamicSources: {}, dicts: { ja: { ui: {}, questions: {} } } };
  var DEFAULT_LOCALE = I18N.default || 'ja';
  var locale = DEFAULT_LOCALE;

  function isSupported(value) { return typeof value === 'string' && I18N.locales.indexOf(value) !== -1; }
  function dictOf(code) { return I18N.dicts[code] || null; }
  function fillParams(text, params) {
    return String(text).replace(/\{([A-Za-z0-9_]+)\}/g, function (match, name) {
      return params && params[name] !== undefined && params[name] !== null ? String(params[name]) : match;
    });
  }
  function uiValue(code, key) {
    var dict = dictOf(code);
    var value = dict && dict.ui && dict.ui[key];
    return typeof value === 'string' && value !== '' ? value : null;
  }
  /* UI 文言：選択言語 → ja → key 名（辞書の欠落は CI が検出する。実行時は画面を壊さないためだけの安全策）。 */
  function t(key, params) {
    var value = uiValue(locale, key);
    if (value === null) value = uiValue(DEFAULT_LOCALE, key);
    return fillParams(value === null ? key : value, params);
  }
  function hasUi(key) { return uiValue(locale, key) !== null || uiValue(DEFAULT_LOCALE, key) !== null; }

  /* 設問由来の文言：日本語は snapshot の label（schema 由来）。他言語は question.id / option.id（cell.id）で引き、無ければ snapshot（ja）。 */
  function qEntry(questionId) {
    var dict = locale !== DEFAULT_LOCALE && dictOf(locale);
    return dict && dict.questions && dict.questions[questionId] || null;
  }
  function questionLabel(question) {
    if (question.type === 'region') return hasUi('results.region.label') && locale !== DEFAULT_LOCALE ? t('results.region.label') : question.label;
    var entry = qEntry(question.id);
    return entry && entry.label || question.label;
  }
  function cellLabel(question, cell) {
    if (locale === DEFAULT_LOCALE) return cell.label;
    if (question.type === 'region') {
      var regionKey = 'results.region.' + cell.id;
      return uiValue(locale, regionKey) !== null ? t(regionKey) : cell.label;
    }
    // single_dynamic の候補は source 設問の option ID なので、source 設問の翻訳を使う。
    var sources = I18N.dynamicSources || {};
    var entry = qEntry(Object.prototype.hasOwnProperty.call(sources, question.id) ? sources[question.id] : question.id);
    if (!entry) return cell.label;
    var own = Object.prototype.hasOwnProperty;
    if (entry.options && own.call(entry.options, cell.id) && entry.options[cell.id]) return entry.options[cell.id];
    if (entry.anchors && own.call(entry.anchors, cell.id) && entry.anchors[cell.id]) return entry.anchors[cell.id];
    if (cell.independent && entry.notApplicable) return entry.notApplicable;
    return cell.label;
  }
  function sectionLabel(section) {
    var key = 'results.section.' + section.id;
    return uiValue(locale, key) !== null ? t(key) : section.label;
  }

  function el(doc, tag, text, cls) {
    var node = doc.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = String(text);
    if (cls) node.className = cls;
    return node;
  }

  function percent(count, total) {
    if (typeof count !== 'number' || typeof total !== 'number' || total <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((count / total) * 100)));
  }

  /* 設問ごとの対象者数も、回答件数と同じく 10 人単位に切り下げて表示する（割合は snapshot の正確な targetCount から計算する）。 */
  function roundedBase(targetCount) {
    return Math.floor(targetCount / 10) * 10;
  }

  function renderCells(doc, question) {
    var list = el(doc, 'ul', null, 'bur-cells');
    question.cells.forEach(function (cell) {
      var item = el(doc, 'li');
      var head = el(doc, 'div', null, 'bur-cell-head');
      head.appendChild(el(doc, 'span', cellLabel(question, cell)));
      if (typeof cell.count === 'number') {
        var pct = percent(cell.count, question.targetCount);
        head.appendChild(el(doc, 'span', t('results.cell.count', { count: cell.count, percent: pct }), 'bur-cell-count'));
        item.appendChild(head);
        var bar = el(doc, 'div', null, 'bur-bar');
        var fill = doc.createElement('i');
        fill.style.width = pct + '%';
        bar.appendChild(fill);
        item.appendChild(bar);
      } else {
        // ordinal の目盛りは保つが、値は出さない。
        item.className = 'bur-cell-hidden';
        head.appendChild(el(doc, 'span', t('results.cell.hidden'), 'bur-cell-count'));
        item.appendChild(head);
      }
      list.appendChild(item);
    });
    return list;
  }

  /* 段階公開：snapshot 上で published の設問だけをカードにする。未公開（insufficient / sensitive_withheld / suppressed_all・未知の state）は存在自体を見せない。 */
  function isPublished(question) {
    return !!question && question.state === 'published' && Array.isArray(question.cells) && typeof question.targetCount === 'number';
  }

  function renderQuestion(doc, question) {
    var card = el(doc, 'article', null, 'bur-card');
    card.setAttribute('data-state', 'published');
    card.appendChild(el(doc, 'h3', questionLabel(question)));
    card.appendChild(el(doc, 'p', t('results.base', { count: roundedBase(question.targetCount) }), 'bur-base'));
    card.appendChild(renderCells(doc, question));
    if (question.hasSuppressedCells) {
      card.appendChild(el(doc, 'p', t('results.hiddenNote'), 'bur-hidden-note'));
    }
    return card;
  }

  /* snapshot を root へ描画する。2 層：現在の回答状況 / アンケート結果。順序は snapshot.questions（= schema の publicResultsOrder）のまま。
   * 公開設問が 1 件もないセクションは見出しごと出さない。ただし「現在の回答状況」は回答数表示（既存の公開ルール）を持つため、その表示がある間は残す。 */
  function render(root, snapshot) {
    var doc = root.ownerDocument;
    root.textContent = '';
    if (!snapshot || !Array.isArray(snapshot.questions) || !Array.isArray(snapshot.sections)) {
      root.appendChild(el(doc, 'p', t('results.error'), 'bur-lead bur-error'));
      return;
    }
    snapshot.sections.forEach(function (section) {
      var published = snapshot.questions.filter(function (question) { return question.section === section.id && isPublished(question); });
      var hasStatus = section.id === 'response_status' && !!snapshot.response_status;
      if (!published.length && !hasStatus) return;
      var layer = el(doc, 'section', null, 'bur-layer');
      layer.setAttribute('data-section', section.id);
      layer.appendChild(el(doc, 'h2', sectionLabel(section)));
      if (hasStatus) {
        var status = snapshot.response_status;
        var text = status.state === 'counting' && typeof snapshot.production_valid_total === 'number'
          ? t('results.status.counting', { count: snapshot.production_valid_total })
          : t('results.status.collecting');
        layer.appendChild(el(doc, 'p', text, 'bur-status'));
      }
      published.forEach(function (question) { layer.appendChild(renderQuestion(doc, question)); });
      root.appendChild(layer);
    });
  }

  /* ── 言語選択（回答ページと同じ localStorage キー。URL・GA4 には載せない） ── */
  var current = null; // {root, snapshot|null}。言語切替で再取得せず、読み込み済みの snapshot を描き直す。
  var langSelect = null;
  var langLabel = null;

  function buildLangSelector(doc) {
    var host = doc.getElementById('bur-lang');
    if (!host || host.firstChild) return;
    langLabel = el(doc, 'label', null, 'bur-lang-label');
    langLabel.setAttribute('for', 'bur-lang-select');
    langSelect = doc.createElement('select');
    langSelect.id = 'bur-lang-select';
    langSelect.className = 'bur-lang-select';
    I18N.locales.forEach(function (code) {
      var option = doc.createElement('option');
      option.value = code;
      option.setAttribute('lang', code);
      option.textContent = SurveyLocale.NAMES[code] || code;
      langSelect.appendChild(option);
    });
    langSelect.addEventListener('change', function () { setLocale(langSelect.value); });
    host.appendChild(langLabel);
    host.appendChild(langSelect);
  }

  function heroFor(code) {
    return !brokenHero[code] && Object.prototype.hasOwnProperty.call(HERO_IMAGES, code) ? HERO_IMAGES[code] : HERO_JA;
  }
  function applyHero(doc) {
    var img = doc.querySelector('.bur-hero img');
    if (!img) return;
    var source = doc.querySelector('.bur-hero source');
    var hero = heroFor(locale);
    if (source) source.setAttribute('srcset', hero.webp);
    img.setAttribute('src', hero.img);
    if (!img.getAttribute('data-hero-fallback')) {
      img.setAttribute('data-hero-fallback', '1');
      img.addEventListener('error', function () {
        if (locale === DEFAULT_LOCALE || brokenHero[locale]) return;
        brokenHero[locale] = true;
        applyHero(doc);
      });
    }
  }

  /* <html lang>・title・description・静的 HTML の文言（data-i18n / data-i18n-alt）・言語選択を現在の言語へ合わせる。canonical・OGP は言語で変えない。 */
  function applyDocumentLocale(doc) {
    doc.documentElement.setAttribute('lang', locale);
    doc.title = t('results.page.title');
    var meta = doc.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute('content', t('results.page.metaDescription'));
    Array.prototype.forEach.call(doc.querySelectorAll('[data-i18n]'), function (node) {
      node.textContent = t(node.getAttribute('data-i18n'));
    });
    Array.prototype.forEach.call(doc.querySelectorAll('[data-i18n-alt]'), function (node) {
      node.setAttribute('alt', t(node.getAttribute('data-i18n-alt')));
    });
    applyHero(doc);
    if (langLabel) langLabel.textContent = t('lang.label');
    if (langSelect) langSelect.value = locale;
  }

  function setLocale(next) {
    if (!isSupported(next) || next === locale) { if (langSelect) langSelect.value = locale; return; }
    locale = next;
    SurveyLocale.store(window, next);
    if (current) {
      applyDocumentLocale(current.root.ownerDocument);
      render(current.root, current.snapshot);
    }
    if (langSelect) langSelect.focus(); // 切替操作を続けられるよう、フォーカスは言語選択に残す
  }

  function show(root, snapshot) {
    current = { root: root, snapshot: snapshot };
    render(root, snapshot);
  }

  function hasPrivateKey(value) {
    if (Array.isArray(value)) return value.some(hasPrivateKey);
    if (value && typeof value === 'object') {
      return Object.keys(value).some(function (key) { return PRIVATE_KEYS.indexOf(key) !== -1 || hasPrivateKey(value[key]); });
    }
    return false;
  }

  /* dynamic snapshot の最低限の形（描画できる形か）。内容の privacy 検証は Public GAS の validateSnapshot が行う。 */
  function isUsableSnapshot(snapshot) {
    return !!snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) &&
      typeof snapshot.survey_id === 'string' && typeof snapshot.snapshot_version !== 'undefined' &&
      Array.isArray(snapshot.questions) && Array.isArray(snapshot.sections) && !hasPrivateKey(snapshot);
  }

  /* Public GAS の endpoint（回答ページと同じ設定）。未設定なら dynamic は使わない。 */
  function dynamicUrl(win) {
    var config = win.BASEBALL_UNIFORM_SURVEY_CONFIG;
    var endpoint = config && typeof config.endpoint === 'string' ? config.endpoint : '';
    if (!endpoint) return '';
    return endpoint + (endpoint.indexOf('?') === -1 ? '?' : '&') + 'action=results';
  }

  function fetchDynamic(win) {
    var url = dynamicUrl(win);
    if (!url) return Promise.reject(new Error('dynamic_not_configured'));
    var request = win.fetch(url, { method: 'GET', cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) throw new Error('dynamic_unavailable');
        return response.json();
      })
      .then(function (body) {
        if (!body || body.ok !== true || !isUsableSnapshot(body.snapshot)) throw new Error('dynamic_invalid');
        return body.snapshot;
      });
    var timer;
    var timeout = new Promise(function (resolve, reject) {
      timer = win.setTimeout(function () { reject(new Error('dynamic_timeout')); }, DYNAMIC_TIMEOUT_MS);
    });
    return Promise.race([request, timeout]).then(
      function (snapshot) { win.clearTimeout(timer); return snapshot; },
      function (error) { win.clearTimeout(timer); throw error; }
    );
  }

  function fetchBundled(win) {
    return win.fetch(SNAPSHOT_URL).then(function (response) {
      if (!response.ok) throw new Error('snapshot_unavailable');
      return response.json();
    });
  }

  function load(win) {
    var doc = win.document;
    var root = doc.getElementById('bur-app');
    if (!root) return Promise.resolve();
    locale = SurveyLocale.initial(win, I18N.locales);
    buildLangSelector(doc);
    applyDocumentLocale(doc);
    return fetchDynamic(win)
      .catch(function () { return fetchBundled(win); })
      .then(function (snapshot) { show(root, snapshot); })
      .catch(function () { show(root, null); });
  }

  if (typeof window !== 'undefined' && typeof document !== 'undefined' && typeof window.fetch === 'function' && !window.SNB_BASEBALL_RESULTS_NO_AUTOLOAD) {
    load(window);
  }

  return { render: render, load: load, SNAPSHOT_URL: SNAPSHOT_URL, isUsableSnapshot: isUsableSnapshot };
})();
