/*
 * E2E実送信テストモード（Issue #338）。
 * ?test=submit のときだけ有効。
 * - GA4を無効化
 * - Public GASへのPOST payloadへ test_mode:true を付与
 * - 画面上にテストモードであることを明示
 * 通常URL / ?test=1 / ?test=closed には影響しない。
 */
(function () {
  'use strict';
  var params;
  try { params = new URLSearchParams(window.location.search); } catch (e) { return; }
  if (params.get('test') !== 'submit') return;

  // app.js の analytics() が参照するオブジェクトを無効化する。
  window.SNBAnalytics = null;

  var originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = function (input, init) {
      var endpoint = window.COSTUME_PORTRAIT_CONFIG && window.COSTUME_PORTRAIT_CONFIG.endpoint;
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var options = init || {};
      if (endpoint && url === endpoint && String(options.method || 'GET').toUpperCase() === 'POST' && typeof options.body === 'string') {
        try {
          var payload = JSON.parse(options.body);
          payload.test_mode = true;
          options = Object.assign({}, options, { body: JSON.stringify(payload) });
        } catch (ignored) { /* malformed payloadは通常のサーバー検証へ */ }
      }
      return originalFetch.call(window, input, options);
    };
  }

  function showBanner() {
    if (!document.body || document.getElementById('cp-live-test-banner')) return;
    var banner = document.createElement('div');
    banner.id = 'cp-live-test-banner';
    banner.setAttribute('role', 'status');
    banner.textContent = 'TEST MODE：実際にGASへ送信しますが、本番集計・公開結果・通知には入りません。';
    banner.style.cssText = 'position:sticky;top:0;z-index:9999;padding:10px 14px;background:#fff3cd;color:#664d03;border-bottom:1px solid #ffecb5;font-weight:700;text-align:center;';
    document.body.insertBefore(banner, document.body.firstChild);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showBanner);
  else showBanner();
})();
