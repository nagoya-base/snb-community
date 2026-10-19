/*
 * 名古屋野球ユニ部アンケート 公開結果ページ（Issue #382）。
 *
 * Spreadsheet・Public GAS には接続しない。読むのは privacy-safe snapshot（snapshot.json）だけで、
 * snapshot は Admin が batch で生成して commit したもの。回答の送信ごとに更新されることはない。
 * 設問・option の文言は snapshot に含まれる（schema 由来）ので、ここにはベタ書きしない。
 * DOM へは textContent だけで書く（innerHTML は使わない）。
 */
var SurveyResultsView = (function () {
  'use strict';

  var SNAPSHOT_URL = 'baseball-uniform-survey-results/snapshot.json';

  /* 項目が非公開のときの説明（state は snapshot の publish state）。未知の state も安全側（非公開）に倒す。 */
  var MESSAGES = {
    insufficient: 'この項目は、回答数がまだ十分でないため公開していません。',
    sensitive_withheld: 'この項目は、十分な回答数が集まった場合のみ公開します。',
    suppressed_all: 'この項目は、回答が少数の集計群に分かれているため、個人が推測されないよう非表示にしています。'
  };
  var FALLBACK_MESSAGE = MESSAGES.insufficient;

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
      head.appendChild(el(doc, 'span', cell.label));
      if (typeof cell.count === 'number') {
        head.appendChild(el(doc, 'span', cell.count + '人（' + percent(cell.count, question.targetCount) + '%）', 'bur-cell-count'));
        item.appendChild(head);
        var bar = el(doc, 'div', null, 'bur-bar');
        var fill = doc.createElement('i');
        fill.style.width = percent(cell.count, question.targetCount) + '%';
        bar.appendChild(fill);
        item.appendChild(bar);
      } else {
        // ordinal の目盛りは保つが、値は出さない。
        item.className = 'bur-cell-hidden';
        head.appendChild(el(doc, 'span', '非公開（少数）', 'bur-cell-count'));
        item.appendChild(head);
      }
      list.appendChild(item);
    });
    return list;
  }

  function renderQuestion(doc, question) {
    var card = el(doc, 'article', null, 'bur-card');
    card.setAttribute('data-state', String(question.state));
    card.appendChild(el(doc, 'h3', question.label));
    if (question.state === 'published' && Array.isArray(question.cells) && typeof question.targetCount === 'number') {
      card.appendChild(el(doc, 'p', 'この設問の対象の回答者：' + roundedBase(question.targetCount) + '人以上（割合はこの対象者に対するものです）', 'bur-base'));
      card.appendChild(renderCells(doc, question));
      if (question.hasSuppressedCells) {
        card.appendChild(el(doc, 'p', '回答の少ない一部の集計群は、個人が推測されないよう非表示にしています。', 'bur-hidden-note'));
      }
    } else {
      var message = Object.prototype.hasOwnProperty.call(MESSAGES, question.state) ? MESSAGES[question.state] : FALLBACK_MESSAGE;
      card.appendChild(el(doc, 'p', message, 'bur-msg'));
    }
    return card;
  }

  /* snapshot を root へ描画する。2 層：現在の回答状況 / アンケート結果。順序は snapshot.questions（= schema の publicResultsOrder）のまま。 */
  function render(root, snapshot) {
    var doc = root.ownerDocument;
    root.textContent = '';
    if (!snapshot || !Array.isArray(snapshot.questions) || !Array.isArray(snapshot.sections)) {
      root.appendChild(el(doc, 'p', '結果を読み込めませんでした。時間をおいて、もう一度開いてください。', 'bur-lead bur-error'));
      return;
    }
    snapshot.sections.forEach(function (section) {
      var layer = el(doc, 'section', null, 'bur-layer');
      layer.setAttribute('data-section', section.id);
      layer.appendChild(el(doc, 'h2', section.label));
      if (section.id === 'response_status' && snapshot.response_status) {
        var status = snapshot.response_status;
        var text = status.state === 'counting' && typeof snapshot.production_valid_total === 'number'
          ? '回答数：' + snapshot.production_valid_total + '件以上'
          : '回答受付中';
        layer.appendChild(el(doc, 'p', text, 'bur-status'));
      }
      snapshot.questions.forEach(function (question) {
        if (question.section === section.id) layer.appendChild(renderQuestion(doc, question));
      });
      root.appendChild(layer);
    });
    if (snapshot.representativeness_notice) {
      root.appendChild(el(doc, 'p', snapshot.representativeness_notice, 'bur-lead'));
    }
  }

  function load(win) {
    var doc = win.document;
    var root = doc.getElementById('bur-app');
    if (!root) return Promise.resolve();
    return win.fetch(SNAPSHOT_URL)
      .then(function (response) {
        if (!response.ok) throw new Error('snapshot_unavailable');
        return response.json();
      })
      .then(function (snapshot) { render(root, snapshot); })
      .catch(function () { render(root, null); });
  }

  if (typeof window !== 'undefined' && typeof document !== 'undefined' && typeof window.fetch === 'function' && !window.SNB_BASEBALL_RESULTS_NO_AUTOLOAD) {
    load(window);
  }

  return { render: render, load: load, SNAPSHOT_URL: SNAPSHOT_URL, MESSAGES: MESSAGES };
})();
