/*
 * 開催情報の一元管理データ + 募集状態レンダラー。
 * 対象は現在有効な開催のみ（終了済みアーカイブは対象外。永久にfinished固定のため
 * 共有データに入れても更新頻度がなく、誤編集のリスクだけが増える）。
 * ビルドなしの静的サイトのため、グローバルスクリプトとして<head>で同期読み込みする。
 */
(function () {
  "use strict";

  window.SNB_EVENTS = [
    {
      id: "community-vol2-0725",
      title: "Vol.2 野球ユニ会",
      date: "2026-07-25",
      dateLabel: "2026年7月25日（土）",
      timeLabel: "14:00〜17:00",
      venue: "上前津｜Studio Nagoya Base",
      fee: "¥4,000（現金・PayPay）",
      capacity: 4,
      remaining: null,
      minimum: 2,
      condition: "お気に入りの野球ユニフォーム",
      status: "recruiting",
      url: "community/vol2_0725_baseball.html"
    },
    {
      id: "baseball-next-activity",
      title: "次回の活動",
      date: null,
      dateLabel: null,
      timeLabel: null,
      venue: "名古屋市内（公園・グラウンド）",
      fee: "基本無料",
      capacity: null,
      remaining: null,
      minimum: null,
      condition: "グローブ必須・ユニフォーム推奨",
      status: "paused",
      url: "baseball/#schedule"
    }
  ];

  // ctaEnabled:false は「申込フォーム・送信ボタンを止めて、代替の案内文に切り替える」ことを意味する。
  // キャンセル待ちなど存在しない機能へのリンクは出さない。
  var STATUS_META = {
    upcoming: {
      label: "開催予定・募集開始前", modifier: "upcoming", ctaEnabled: false,
      formHeading: "まもなく募集を開始します",
      formMessage: "募集開始までお待ちください。開始はXでお知らせします。"
    },
    recruiting: {
      label: "募集中", modifier: "recruiting", ctaEnabled: true,
      formHeading: null,
      formMessage: null
    },
    full: {
      label: "満席", modifier: "full", ctaEnabled: false,
      formHeading: "満席になりました",
      formMessage: "参加についてのご相談はXのDMからご連絡ください。"
    },
    closed: {
      label: "受付終了", modifier: "closed", ctaEnabled: false,
      formHeading: "受付を終了しました",
      formMessage: "次回開催についてはXをご確認ください。"
    },
    finished: {
      label: "開催終了", modifier: "finished", ctaEnabled: false,
      formHeading: "このイベントは終了しました",
      formMessage: "次回開催についてはXをご確認ください。"
    },
    paused: {
      label: "活動休止中", modifier: "paused", ctaEnabled: false,
      formHeading: "現在、募集を休止しています",
      formMessage: "次回開催はXでお知らせします。"
    }
  };

  function getTodayJST() {
    try {
      return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
    } catch (e) {
      return null;
    }
  }

  function isValidISODate(value) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  }

  // 開催日を過ぎたら自動でfinishedへ切り替える（明示的なpaused/closed/finishedは上書きしない）。
  // 判定に失敗した場合は「申込可能」と誤認させない安全側（finished）に倒す。
  function computeEffectiveStatus(ev, todayISO) {
    if (ev.status === "paused" || ev.status === "closed" || ev.status === "finished") {
      return ev.status;
    }

    if (!ev.date) {
      return ev.status || "upcoming";
    }

    if (!isValidISODate(ev.date) || !todayISO) {
      return "finished";
    }

    if (todayISO > ev.date) {
      return "finished";
    }

    if (ev.status === "recruiting" || ev.status === "full" || ev.status === "upcoming") {
      return ev.status;
    }

    if (typeof ev.remaining === "number") {
      return ev.remaining <= 0 ? "full" : "recruiting";
    }

    return "upcoming";
  }

  function findEvent(eventId) {
    for (var i = 0; i < window.SNB_EVENTS.length; i++) {
      if (window.SNB_EVENTS[i].id === eventId) return window.SNB_EVENTS[i];
    }
    return null;
  }

  var FIELD_MAP = {
    date: "dateLabel",
    time: "timeLabel",
    venue: "venue",
    fee: "fee",
    minimum: "minimum",
    condition: "condition",
    capacity: "capacity"
  };

  function fillField(el, field, ev) {
    var key = FIELD_MAP[field];
    if (!key) return;
    var value = ev[key];
    if (value === null || value === undefined) return;
    if (field === "minimum") {
      el.textContent = "最少催行" + value + "名";
    } else if (field === "capacity") {
      el.textContent = "定員" + value + "名";
    } else {
      el.textContent = value;
    }
  }

  // eventIdに対応するDOM要素（[data-event-id][data-event-field]）をまとめて更新する。
  function render(eventId) {
    var ev = findEvent(eventId);
    if (!ev) return;

    var status = computeEffectiveStatus(ev, getTodayJST());
    var meta = STATUS_META[status] || STATUS_META.finished;

    var nodes = document.querySelectorAll('[data-event-id="' + eventId + '"]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var field = el.getAttribute("data-event-field");

      if (field === "badge") {
        el.textContent = meta.label;
        el.className = el.className.replace(/\bstatus-badge--\S+/g, "").trim();
        el.classList.add("status-badge--" + meta.modifier);
      } else if (field === "badge-inline") {
        var dateBit = ev.dateLabel ? ev.dateLabel.replace(/^\d{4}年/, "") : "";
        el.textContent = "次回開催：" + (dateBit ? dateBit + " " : "") + ev.title + "・" + meta.label;
      } else if (field === "form-gate") {
        // recruiting以外は申込フォーム本体（入力・送信ボタン含む）を非表示にし、送信できなくする。
        el.hidden = !meta.ctaEnabled;
      } else if (field === "form-fallback") {
        el.hidden = meta.ctaEnabled;
      } else if (field === "form-fallback-heading") {
        el.textContent = meta.formHeading || "";
      } else if (field === "form-fallback-text") {
        el.textContent = meta.formMessage || "";
      } else if (field === "dot") {
        el.classList.toggle("active", status === "recruiting" || status === "upcoming");
      } else {
        fillField(el, field, ev);
      }
    }
  }

  window.SNBEventStatus = {
    STATUS_META: STATUS_META,
    computeEffectiveStatus: computeEffectiveStatus,
    getTodayJST: getTodayJST,
    findEvent: findEvent,
    render: render
  };
})();
