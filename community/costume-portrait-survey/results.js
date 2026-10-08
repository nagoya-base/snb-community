/*
 * 公開結果ページ。Public GASの ?action=results だけを表示する（確定済みスナップショット＝最終結果、
 * 未確定＝途中集計）。有効回答30件未満でも、年代・居住地方ブロックの基本情報と有効回答数は表示する
 * （threshold_reached:false）。30件以上（threshold_reached:true）で主要結果が追加される。「30件未満＝全面非公開」とは
 * 決め打ちせず、APIが返した items をそのまま描画する。
 * 通信失敗・不正なレスポンスは読み込みエラーとして扱い、「30件未満」とは表示しない。自由記述・価格・性的指向などは
 * APIがそもそも返さない（allowlist）。回答由来の文字列は textContent のみで描画する。
 * 「アンケートに回答する」CTAは、受付中（phase:collecting）と判明した時だけ表示する。
 */
(function () {
  'use strict';
  var root = document.getElementById('cp-results');
  var config = window.COSTUME_PORTRAIT_CONFIG || {};
  var endpoint = typeof config.endpoint === 'string' ? config.endpoint : '';

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }
  function message(text) {
    while (root.firstChild) root.removeChild(root.firstChild);
    var box = el('div', 'cp-message cp-warn');
    box.appendChild(el('p', '', text));
    root.appendChild(box);
  }

  var NOTICES = {
    final: { label: '最終結果', text: 'アンケートの受付は終了し、結果を確定しました。以下が最終結果です。' },
    collecting: { label: '途中集計', text: '途中集計です。受付中のため、結果は回答の追加により変わります。' },
    closed_pending: { label: '受付終了・最終確定待ち', text: '受付は終了しました。現在は途中集計を表示しています。最終結果は確定後に公開します。' }
  };
  function noticeKey(results) {
    if (results.status === 'final') return 'final';
    if (results.status === 'partial' && (results.phase === 'collecting' || results.phase === 'closed_pending')) return results.phase;
    return null;
  }
  var BASIC_NOTICE = {
    label: '現在の回答傾向（基本情報）',
    text: '年代・居住地域などの基本情報のみ先行公開しています。主要なアンケート結果は有効回答30件以上で公開します。'
  };
  // 愛知県内エリアは公開しない。更新前のPublic GASが返しても描画しない（フロント側の二重防御）。
  var HIDDEN_ITEM_IDS = ['aichi_area'];
  function isBasicOnly(results) { return results.threshold_reached === false; }
  function minTotal(results) { return typeof results.min_total === 'number' ? results.min_total : 30; }
  function showAnswerCta(visible) {
    var cta = document.getElementById('cp-answer-cta');
    if (cta) cta.hidden = !visible;
  }
  function isValidResults(results) {
    if (!results || typeof results !== 'object') return false;
    if (results.status === 'insufficient') return true;
    return noticeKey(results) !== null && typeof results.total === 'number' && Array.isArray(results.items);
  }

  function render(results) {
    while (root.firstChild) root.removeChild(root.firstChild);
    var key = noticeKey(results);
    var notice = NOTICES[key];
    var basicOnly = isBasicOnly(results);
    showAnswerCta(key === 'collecting');
    var head = el('div', 'cp-card');
    if (basicOnly && key === 'collecting') {
      // 受付中・30件未満：基本情報のみ。件数は「XX件 / 30件」で進捗を示す。
      head.appendChild(el('p', 'cp-badge', BASIC_NOTICE.label));
      head.appendChild(el('p', 'cp-lead', BASIC_NOTICE.text));
      head.appendChild(el('h2', '', '現在の有効回答数：' + results.total + '件 / ' + minTotal(results) + '件'));
    } else {
      head.appendChild(el('p', 'cp-badge', notice.label));
      head.appendChild(el('p', 'cp-lead', notice.text));
      head.appendChild(el('h2', '', '有効回答数：' + results.total + '件'));
      if (basicOnly) head.appendChild(el('p', 'cp-lead', '有効回答が' + minTotal(results) + '件に届かなかったため、主要なアンケート結果は公開せず、年代・居住地域などの基本情報のみ表示しています。'));
    }
    head.appendChild(el('p', 'cp-lead', '3件未満のカテゴリは、個人が推測されないよう「非公開」としています。複数選択の設問は、選んだ人の割合のため合計が100%を超えます。'));
    root.appendChild(head);
    results.items.forEach(function (item) {
      if (HIDDEN_ITEM_IDS.indexOf(item.id) !== -1) return;
      var card = el('div', 'cp-card cp-results-item');
      card.appendChild(el('h3', '', item.title));
      if (item.suppressed) {
        card.appendChild(el('p', 'cp-lead', '回答数が少ないため非公開です。'));
        root.appendChild(card);
        return;
      }
      item.categories.forEach(function (c) {
        var row = el('div', 'cp-bar-row');
        row.appendChild(el('span', '', c.label));
        var bar = el('div', 'cp-bar');
        var fill = document.createElement('i');
        fill.style.width = (c.pct === null ? 0 : Math.min(100, c.pct)) + '%';
        bar.appendChild(fill);
        row.appendChild(bar);
        row.appendChild(el('span', 'cp-num', c.pct === null ? '非公開' : c.pct + '%'));
        card.appendChild(row);
      });
      root.appendChild(card);
    });
  }

  if (!endpoint) { message('公開結果は準備中です。'); return; }
  fetch(endpoint + (endpoint.indexOf('?') === -1 ? '?' : '&') + 'action=results', { method: 'GET', cache: 'no-store' })
    .then(function (response) { if (!response.ok) throw new Error('http'); return response.json(); })
    .then(function (body) {
      if (!body || body.ok !== true) throw new Error('bad');
      // 旧GAS（途中集計対応前）の応答。GAS更新までの間だけ、エラーではなく準備中として扱う。
      if (body.status === 'not_finalized' && body.results === undefined) { message('途中集計の公開準備中です。しばらくしてから再度ご確認ください。'); return; }
      var results = body.results;
      if (!isValidResults(results)) throw new Error('bad');
      // 旧GAS（基本属性の先行公開対応前）の応答。GAS更新までの間だけ、従来どおりの案内を表示する。
      if (results.status === 'insufficient') { showAnswerCta(true); message('有効回答が30件以上集まると、途中集計を公開します。'); return; }
      render(results);
    })
    .catch(function () { message('結果を読み込めませんでした。時間をおいて再度お試しください。'); });
})();
