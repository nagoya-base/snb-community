/*
 * アンケート・調査アーカイブ：surveys.json（ポータル専用の公開用データ）を読み、カードを描画する。
 * - 値が null の項目は「0」や推定値を出さず、項目ごと省く。
 * - status=unknown を「回答受付中」と断定しない。
 * - link_policy=none の調査には CTA を出さない（URL 自体もデータに含めない）。
 * - status=closed の調査には「アンケートを見る」を出さない（結果ページがあれば「結果を見る」のみ）。
 * - CTAの見た目は種別で固定：結果を見る=赤塗り(--results)／アンケートを見る=白抜き(--open)。
 * - link_policy=results_only の調査は、公開済みの結果ページ（results_url）への CTA だけを出す。
 *   public_url は参照せず、「アンケートを見る」は出さない（明示的な例外。community/surveys/README.md 参照）。
 * - 描画は textContent / createElement のみ（データ由来の文字列を HTML として解釈しない）。
 */
(function () {
  'use strict';

  var SITE_ORIGIN = 'https://nagoya-base.github.io/snb-community/';
  var ROOT_PREFIX = '../../'; // community/surveys/ からサイトルートへ

  var SECTIONS = [
    { key: 'current', title: '現在実施中', desc: '回答を受け付けている調査です。' },
    { key: 'current_or_recent', title: '最近の調査・準備中', desc: '受付状況をこのページでは確定できていない調査を含みます。' },
    { key: 'archive', title: '過去の調査', desc: '受付を終了した調査の記録です。' }
  ];

  var STATUS_LABEL = {
    collecting: '回答受付中',
    closed: '受付終了',
    prelaunch: '公開準備中',
    unknown: '公開状況確認中'
  };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function parseDate(value) {
    if (typeof value !== 'string') return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}))?/.exec(value);
    if (!m) return null;
    return { y: +m[1], mo: +m[2], d: +m[3], h: m[4] == null ? null : +m[4], mi: m[5] == null ? null : +m[5], s: m[6] == null ? null : +m[6] };
  }

  function formatDate(value) {
    var p = parseDate(value);
    if (!p) return null;
    var text = p.y + '年' + p.mo + '月' + p.d + '日';
    // 日付のみ、または 23:59:59（その日いっぱい）は日付だけ表示。それ以外は時刻も表示する。
    if (p.h != null && !(p.h === 23 && p.mi === 59)) {
      text += ' ' + p.h + ':' + (p.mi < 10 ? '0' : '') + p.mi;
    }
    return text;
  }

  function periodText(survey) {
    if (survey.survey_period_label) return survey.survey_period_label; // 表示専用ラベル（正本の値は変えない）
    var period = survey.survey_period;
    if (!period) return null;
    var start = formatDate(period.start);
    var end = formatDate(period.end);
    if (start && end) return start + ' 〜 ' + end;
    if (end) return '〜 ' + end;
    if (start) return start + ' 〜';
    return null; // 不明は表示しない
  }

  function responseText(rc) {
    if (!rc) return null;
    if (typeof rc.value === 'number') return rc.value + '件';
    if (rc.state === 'withheld') return '回答受付中（件数は非公開）';
    return null; // 不明は「0」にせず省く
  }

  function resolveUrl(url) {
    if (typeof url !== 'string' || url.indexOf('https://') !== 0) return null;
    if (url.indexOf(SITE_ORIGIN) === 0) return ROOT_PREFIX + url.slice(SITE_ORIGIN.length);
    return url;
  }

  function isExternal(url) {
    return url.indexOf('https://') === 0;
  }

  function addFact(list, label, value) {
    if (value == null || value === '') return;
    list.appendChild(el('dt', null, label));
    list.appendChild(el('dd', null, value));
  }

  function buildCta(parent, survey) {
    if (survey.link_policy === 'none') {
      parent.appendChild(el('p', 'survey-card__note', '関連サイトへのリンクは掲載していません。'));
      return;
    }
    var wrap = el('div', 'survey-cta');
    var resultsUrl = survey.public_results && survey.public_results.available ? resolveUrl(survey.results_url) : null;
    var openUrl = survey.link_policy === 'results_only' || survey.status === 'closed' ? null : resolveUrl(survey.public_url);

    function link(url, label, ctaName, kind) {
      var a = el('a', 'survey-cta__btn survey-cta__btn--' + kind, label);
      a.href = url;
      if (isExternal(url)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
      a.setAttribute('data-cta-name', ctaName);
      a.setAttribute('data-cta-location', 'survey_archive_card');
      a.setAttribute('data-event-slug', survey.id);
      wrap.appendChild(a);
    }

    if (resultsUrl) link(resultsUrl, '結果を見る', 'survey_archive_results', 'results');
    if (openUrl) link(openUrl, 'アンケートを見る', 'survey_archive_open', 'open');
    if (!wrap.children.length) return;
    if (resultsUrl && survey.public_results.final === false) {
      parent.appendChild(el('p', 'survey-card__note', '結果ページは途中経過です（最終結果ではありません）。'));
    }
    parent.appendChild(wrap);
  }

  function buildCard(survey) {
    var item = el('li', 'timeline__item');
    item.setAttribute('data-survey-id', survey.id);
    item.setAttribute('data-status', survey.status);

    // sort_date は並び替え専用。画面には確定している実施期間だけを出す（不明なら省略）。
    var period = periodText(survey);
    if (period) item.appendChild(el('span', 'timeline__date', period));

    var card = el('article', 'survey-card');
    var head = el('div', 'survey-card__head');
    head.appendChild(el('span', 'survey-badge survey-badge--' + survey.status, STATUS_LABEL[survey.status] || STATUS_LABEL.unknown));
    if (survey.brand) head.appendChild(el('span', 'survey-card__brand', survey.brand));
    card.appendChild(head);

    card.appendChild(el('h3', 'survey-card__title', survey.title));
    if (survey.summary) card.appendChild(el('p', 'survey-card__summary', survey.summary));
    if (survey.also_known_as) {
      card.appendChild(el('p', 'survey-card__alias', '※「' + survey.also_known_as + '」と同一の調査です。'));
    }

    if (survey.theme && survey.theme.length) {
      var themes = el('ul', 'survey-themes');
      survey.theme.forEach(function (t) { themes.appendChild(el('li', null, t)); });
      card.appendChild(themes);
    }

    var facts = el('dl', 'survey-facts');
    addFact(facts, '対象', survey.target);
    addFact(facts, '回答数', responseText(survey.response_count));
    addFact(facts, '設問数', survey.question_count_label || (typeof survey.question_count === 'number' ? survey.question_count + '問' : null));
    addFact(facts, '所要時間', survey.estimated_minutes);
    var resultsState = null; // 公開結果なし／未確認は断定せず項目を省く
    if (survey.public_results) {
      if (survey.public_results.available) resultsState = survey.public_results.final === true ? '公開中（最終）' : '公開中（途中経過）';
    }
    addFact(facts, '結果', resultsState);
    if (facts.children.length) card.appendChild(facts);

    buildCta(card, survey);
    item.appendChild(card);
    return item;
  }

  function render(data, root) {
    var surveys = (data && data.surveys || []).filter(function (s) { return s.portal && s.portal.include === true; });
    SECTIONS.forEach(function (section) {
      var rows = surveys
        .filter(function (s) { return s.portal.section === section.key; })
        .sort(function (a, b) { return a.portal.sort_date < b.portal.sort_date ? 1 : a.portal.sort_date > b.portal.sort_date ? -1 : 0; });
      if (!rows.length) return;
      var group = el('section', 'archive-group');
      group.setAttribute('data-section', section.key);
      group.appendChild(el('h2', 'archive-group__title', section.title));
      group.appendChild(el('p', 'archive-group__desc', section.desc));
      var list = el('ol', 'timeline');
      rows.forEach(function (s) { list.appendChild(buildCard(s)); });
      group.appendChild(list);
      root.appendChild(group);
    });
  }

  function run() {
    var root = document.getElementById('archive-root');
    var status = document.getElementById('archive-status');
    if (!root) return;
    fetch('surveys.json', { cache: 'no-cache' })
      .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
      .then(function (data) {
        render(data, root);
        if (status) status.hidden = true;
      })
      .catch(function () {
        if (status) status.textContent = '一覧を読み込めませんでした。時間をおいて再読み込みしてください。';
      });
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { render: render };
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
    else run();
  }
})();
