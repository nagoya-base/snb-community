/*
 * 公開結果ページ。Public GASの ?action=results（締切後にfinalizeで確定した匿名スナップショット）だけを表示する。
 * 有効回答30件未満・未確定の間は件数も含め何も表示しない。自由記述・価格・地域・性的指向などは
 * APIがそもそも返さない（allowlist）。回答由来の文字列は textContent のみで描画する。
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

  function render(results) {
    while (root.firstChild) root.removeChild(root.firstChild);
    var head = el('div', 'cp-card');
    head.appendChild(el('h2', '', '有効回答数：' + results.total + '件'));
    head.appendChild(el('p', 'cp-lead', '3件未満のカテゴリは、個人が推測されないよう「非公開」としています。複数選択の設問は、選んだ人の割合のため合計が100%を超えます。'));
    root.appendChild(head);
    results.items.forEach(function (item) {
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
      if (body.status === 'not_finalized') { message('結果は、アンケートの受付終了後に確定してから公開します。'); return; }
      var results = body.results;
      if (!results || results.status === 'insufficient') { message('回答数が十分に集まるまで、結果は公開しません。'); return; }
      render(results);
    })
    .catch(function () { message('結果を読み込めませんでした。時間をおいて再度お試しください。'); });
})();
