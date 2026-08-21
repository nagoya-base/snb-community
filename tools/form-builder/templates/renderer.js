/*
 * 設定JSON(config) から、公開用フォームHTML文字列を生成する。
 * この関数の出力が「生成HTML」そのもの（プレビュー・PR作成のどちらも
 * この関数を経由するため、両者に差分が出ない）。
 *
 * forcePreview=true のときは、URLクエリに関係なく必ずテストモードで
 * 動作するスクリプトを埋め込む（form-builder の <iframe> プレビュー専用）。
 * forcePreview=false（実際にコミットする版）は、既存フォームと同じ
 * ?test=1 / ?test=closed によるクエリ判定にする。
 */
(function (global) {
  'use strict';

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeForInlineJson(json) {
    /* </script> でスクリプトタグが閉じてしまう事故を防ぐ。 */
    return json.replace(/<\/(script)/gi, '<\\/$1');
  }

  function buildJsonLd(config) {
    if (config.type !== 'event_entry' || !config.event || !config.event.eventDate) return null;
    var ev = config.event;
    var startIso = ev.eventDate + (ev.startTime ? 'T' + ev.startTime + ':00+09:00' : '');
    var ld = {
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: config.meta.title,
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      eventStatus: 'https://schema.org/EventScheduled',
      startDate: startIso
    };
    if (ev.venue) {
      ld.location = { '@type': 'Place', name: ev.venue };
    }
    if (ev.fee) {
      ld.offers = { '@type': 'Offer', priceCurrency: 'JPY', availability: 'https://schema.org/InStock', url: config.meta.canonicalUrl };
    }
    return ld;
  }

  function render(config, options) {
    options = options || {};
    var forcePreview = !!options.forcePreview;
    var title = escapeHtml(config.meta.title || '（無題フォーム）');
    var description = escapeHtml(config.meta.subtitle || '');
    var canonical = escapeHtml(config.meta.canonicalUrl || '');
    var ogImage = escapeHtml(config.meta.ogImage || '');
    var robots = config.meta.noindex ? 'noindex, nofollow' : 'index, follow';

    var configJson = escapeForInlineJson(JSON.stringify(config));
    var jsonLd = buildJsonLd(config);

    var headParts = [];
    headParts.push('<meta charset="UTF-8">');
    headParts.push('<meta name="viewport" content="width=device-width, initial-scale=1.0">');
    headParts.push('<meta name="robots" content="' + robots + '">');
    headParts.push('<title>' + title + '｜SNBコミュニティ</title>');
    if (description) headParts.push('<meta name="description" content="' + description + '">');
    if (canonical) headParts.push('<link rel="canonical" href="' + canonical + '">');
    if (jsonLd) {
      headParts.push('<script type="application/ld+json">' + escapeForInlineJson(JSON.stringify(jsonLd)) + '</script>');
    }
    headParts.push('<meta property="og:title" content="' + title + '">');
    if (description) headParts.push('<meta property="og:description" content="' + description + '">');
    headParts.push('<meta property="og:type" content="website">');
    if (canonical) headParts.push('<meta property="og:url" content="' + canonical + '">');
    if (ogImage) {
      headParts.push('<meta property="og:image" content="' + ogImage + '">');
      headParts.push('<meta property="og:image:width" content="1200">');
      headParts.push('<meta property="og:image:height" content="630">');
    }
    headParts.push('<meta name="twitter:card" content="summary_large_image">');
    headParts.push('<meta name="twitter:title" content="' + title + '">');
    if (description) headParts.push('<meta name="twitter:description" content="' + description + '">');
    if (ogImage) headParts.push('<meta name="twitter:image" content="' + ogImage + '">');

    /*
     * assetBase: 生成物を実際に置く {pageDir}/{fileName} からはリポジトリ
     * ルートまで1階層（"../"）。form-builder のプレビュー用iframe(srcdoc)は
     * ベースURLが tools/form-builder/ のままなので2階層（"../../"）必要。
     */
    var assetBase = forcePreview ? '../../' : '../';
    headParts.push('<link rel="stylesheet" href="' + assetBase + 'assets/form-runtime/forms.css">');
    headParts.push('<script src="' + assetBase + 'analytics.js"></script>');
    if (forcePreview) {
      headParts.push('<script>window.FF_FORCE_PREVIEW_TEST_MODE = true;</script>');
    }

    var bodyParts = [];
    bodyParts.push('<div id="ff-app"></div>');
    bodyParts.push('<script type="application/json" id="ff-config">' + configJson + '</script>');
    bodyParts.push('<script src="' + assetBase + 'assets/form-runtime/forms.js"></script>');

    var html = '<!DOCTYPE html>\n' +
      '<html lang="ja">\n' +
      '<head>\n' + headParts.map(function (p) { return '  ' + p; }).join('\n') + '\n</head>\n' +
      '<body>\n' + bodyParts.map(function (p) { return '  ' + p; }).join('\n') + '\n</body>\n' +
      '</html>\n';

    return html;
  }

  global.FFRenderer = { render: render, escapeHtml: escapeHtml };
})(window);
