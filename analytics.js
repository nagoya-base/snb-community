/*
 * SNBコミュニティ共通 GA4 計測ヘルパー。
 * ビルドなしの静的サイトのため、グローバルスクリプトとして同期読み込みする。
 *
 * 送信するのはカテゴリ値のみ。氏名・年代・メールアドレス・Xアカウント・
 * 希望ユニフォーム・自己紹介・備考などの申込内容は一切送信しない。
 * gtag が未定義でも黙って何もしないため、計測がフォーム機能を止めることはない。
 *
 * 成果イベント（GA4管理画面でキーイベント化する対象）は generate_lead のみ。
 * 参加申込フォームの POST が成功した時だけ送信する。survey_submit（アンケート）は
 * 参加確定を意味しないため成果イベントではない。
 *
 * entry_complete は実装しない。申込完了ページが存在せず、送信成功と完了表示が
 * 同一の瞬間に起きるため、両方を送ると1件の申込を二重に計上することになる。
 * 架空の完了イベントは作らない。
 *
 * data-cta-name / data-outbound-channel / data-section-view / data-faq-id を
 * 持つ要素は、ページ側で個別にスクリプトを書かなくても自動的に計測される
 * （DOMContentLoaded後にイベント委譲・IntersectionObserverを一括設定する）。
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
      site_brand: 'snbc',
      site_section: (body && body.getAttribute('data-site-section')) || 'community',
      page_type: (body && body.getAttribute('data-page-type')) || 'top'
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

  var sectionViewFired = {};

  var SNBAnalytics = {
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

    /* 入力エラー・送信失敗（バリデーション/通信/サーバー）。分析用イベント。 */
    trackFormError: function (formName, errorType) {
      track('form_error', {
        form_name: formName || 'form',
        error_type: errorType || 'unknown'
      });
    },

    /* 主成果。参加申込の POST が成功した時だけ呼ぶこと。
       送信ボタンのクリックやバリデーションエラーでは呼ばない。
       submissionToken は1回の送信操作ごとに一意な値。同じトークンでは二度送信しない。 */
    trackGenerateLead: function (submissionToken, params) {
      var token = String(submissionToken);
      if (submittedTokens[token]) return;
      submittedTokens[token] = true;
      track('generate_lead', params);
    },

    /* CTAクリック。cta_name/cta_locationは呼び出し側で指定する。 */
    trackCtaClick: function (ctaName, ctaLocation, extra) {
      var payload = { cta_name: ctaName || '', cta_location: ctaLocation || '' };
      if (extra) {
        for (var key in extra) {
          if (Object.prototype.hasOwnProperty.call(extra, key)) payload[key] = extra[key];
        }
      }
      track('cta_click', payload);
    },

    /* 外部導線クリック（メール／X）。 */
    trackOutboundClick: function (channel, ctaLocation) {
      track('outbound_contact_click', { channel: channel || '', cta_location: ctaLocation || '' });
    },

    /* FAQ開閉（開いた時のみ）。 */
    trackFaqOpen: function (faqId) {
      track('faq_open', { faq_id: faqId || '' });
    },

    /* セクション到達（同一セクションにつき1回）。 */
    trackSectionView: function (sectionId) {
      if (!sectionId || sectionViewFired[sectionId]) return;
      sectionViewFired[sectionId] = true;
      track('section_view', { section_id: sectionId });
    }
  };

  window.SNBAnalytics = SNBAnalytics;

  /* ── data-* 属性による自動計測（ページ側の個別スクリプト不要） ── */
  function initAutoTracking() {
    document.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('[data-cta-name], [data-outbound-channel]') : null;
      if (!el) return;
      var ctaLocation = el.getAttribute('data-cta-location') || '';

      if (el.hasAttribute('data-outbound-channel')) {
        SNBAnalytics.trackOutboundClick(el.getAttribute('data-outbound-channel'), ctaLocation);
        return;
      }

      var extra = { link_destination: el.tagName === 'A' ? (el.getAttribute('href') || '') : '' };
      var planName = el.getAttribute('data-plan-name');
      if (planName) extra.plan_name = planName;
      var eventSlug = el.getAttribute('data-event-slug');
      if (eventSlug) extra.event_slug = eventSlug;
      SNBAnalytics.trackCtaClick(el.getAttribute('data-cta-name'), ctaLocation, extra);
    });

    document.querySelectorAll('[data-faq-id]').forEach(function (details) {
      details.addEventListener('toggle', function () {
        if (details.open) SNBAnalytics.trackFaqOpen(details.getAttribute('data-faq-id'));
      });
    });

    if ('IntersectionObserver' in window) {
      var sectionObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          SNBAnalytics.trackSectionView(entry.target.getAttribute('data-section-view'));
          sectionObserver.unobserve(entry.target);
        });
      }, { threshold: 0 });
      document.querySelectorAll('[data-section-view]').forEach(function (el) {
        sectionObserver.observe(el);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAutoTracking);
  } else {
    initAutoTracking();
  }
})();
