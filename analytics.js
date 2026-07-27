/*
 * SNBコミュニティ共通 GA4 計測ヘルパー。
 * ビルドなしの静的サイトのため、グローバルスクリプトとして同期読み込みする。
 *
 * 送信するのはカテゴリ値のみ。氏名・年代・メールアドレス・Xアカウント・
 * 希望ユニフォーム・自己紹介・備考などの申込内容は一切送信しない。
 * gtag が未定義でも黙って何もしないため、計測がフォーム機能を止めることはない。
 *
 * 成果イベント（GA4管理画面でキーイベント化する対象）は entry_submit のみ。
 * 参加申込フォームの POST が成功した時だけ送信する。
 *
 * entry_complete は実装しない。申込完了ページが存在せず、送信成功と完了表示が
 * 同一の瞬間に起きるため、両方を送ると1件の申込を二重に計上することになる。
 * 架空の完了イベントは作らない。
 */
(function () {
  'use strict';

  var isDebug = /(?:^|[?&])debug_mode=true(?:&|$)/.test(window.location.search);
  /* 成果イベントの二重送信防止用。送信成功1回につき1件だけ記録する。 */
  var submittedTokens = {};

  function isTrackableEnvironment() {
    if (isDebug) return true;
    var protocol = window.location.protocol;
    var hostname = window.location.hostname;
    if (protocol === 'file:') return false;
    if (hostname === 'localhost' || hostname === '127.0.0.1') return false;
    return true;
  }

  function pageContext() {
    var body = document.body;
    var context = {
      site_section: (body && body.getAttribute('data-site-section')) || 'community',
      page_path: window.location.pathname
    };
    var slug = body && body.getAttribute('data-event-slug');
    var title = body && body.getAttribute('data-event-title');
    if (slug) context.event_slug = slug;
    if (title) context.event_title = title;
    return context;
  }

  function track(eventName, params) {
    if (!eventName || !isTrackableEnvironment()) return;

    var payload = pageContext();
    if (params) {
      for (var key in params) {
        if (Object.prototype.hasOwnProperty.call(params, key)) payload[key] = params[key];
      }
    }
    if (isDebug) {
      payload.debug_mode = true;
      console.debug('[SNBAnalytics]', eventName, payload);
    }

    if (typeof window.gtag !== 'function') return;
    try {
      window.gtag('event', eventName, payload);
    } catch (e) {
      /* GA4送信失敗でも申込機能は継続する */
    }
  }

  window.SNBAnalytics = {
    track: track,

    /* フォーム入力開始（1ページにつき1回）。分析用イベント。 */
    trackFormStart: (function () {
      var started = {};
      return function (formName) {
        var name = formName || 'form';
        if (started[name]) return;
        started[name] = true;
        track('form_start', { form_name: name });
      };
    })(),

    /* 入力エラー。分析用イベント。エラー内容そのものは送らない。 */
    trackFormError: function (formName, errorType) {
      track('form_error', {
        form_name: formName || 'form',
        error_type: errorType || 'unknown'
      });
    },

    /* キーイベント。参加申込の POST が成功した時だけ呼ぶこと。
       送信ボタンのクリックやバリデーションエラーでは呼ばない。
       submissionToken は1回の送信操作ごとに一意な値。同じトークンでは二度送信しない。 */
    trackEntrySubmit: function (submissionToken, params) {
      var token = String(submissionToken);
      if (submittedTokens[token]) return;
      submittedTokens[token] = true;
      track('entry_submit', params);
    },

    /* 送信失敗。分析用イベント。 */
    trackSubmitFailed: function (formName, failureType) {
      track('submit_failed', {
        form_name: formName || 'form',
        failure_type: failureType || 'unknown'
      });
    }
  };
})();
