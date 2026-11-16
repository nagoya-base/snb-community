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
      id: "baseball-next-activity",
      title: "キャッチボール会",
      date: null,
      /* 複数日開催のため単一date運用（自動finished判定）は使わず、sessions（日付別）で管理する。
         開催日（date）を過ぎた回は自動で「過去の日程」へ移り、全回が過ぎるとfinishedになる。
         session.status: "recruiting"=募集中 / "upcoming"=開催予定（募集・詳細は未確定）。
           申込CTAは、予定が残っていて募集中の回が1つ以上あるときだけ有効になる。
         session.time: 表示用の文字列。null は「時間未定」。
         session.result: "held"=開催済み / "cancelled"=中止 / null=実施未確認（「開催済み」とは書かない）。
         dateが不正な回は予定にも過去にも出さない。Issue #247・#349・#455 */
      sessions: [
        { date: "2026-10-31", label: "2026年10月31日（土）", time: "13:00〜15:00", status: "recruiting", result: null },
        { date: "2026-11-14", label: "2026年11月14日（土）", time: "13:00〜15:00", status: "recruiting", result: null },
        { date: "2026-11-28", label: "2026年11月28日（土）", time: "13:00〜15:00", status: "recruiting", result: null },
        { date: "2026-12-19", label: "2026年12月19日（土）", time: "13:00〜15:00", status: "upcoming", result: null },
        { date: "2027-01-09", label: "2027年1月9日（土）", time: "13:00〜15:00", status: "upcoming", result: null }
      ],
      dateLabel: null,
      timeLabel: null,
      venue: "名古屋市内（公園・グラウンド）",
      fee: "基本無料",
      capacity: null,
      minimum: null,
      condition: "グローブ必須・ユニフォーム推奨",
      status: "recruiting",
      url: "contact/?category=baseball"
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
      formMessage: "参加についてのご相談は問い合わせフォームからご連絡ください。"
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
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    // 形式だけでなく、年月日として実在すること（うるう年を含む）を検証する。
    var y = +value.slice(0, 4), m = +value.slice(5, 7), d = +value.slice(8, 10);
    var dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }

  // 開催日を過ぎたら自動でfinishedへ切り替える（明示的なpaused/finishedは上書きしない）。
  // closedは「新規受付は終了だが開催はする」状態のため、開催日を過ぎたらfinished（終了済み）へ
  // 移行させる。日付が無い/不正な場合はclosedのまま据え置く（申込不可のため誤認のリスクはない）。
  // 判定に失敗した場合は「申込可能」と誤認させない安全側（finishedまたはclosed）に倒す。
  // sessions（日付別）を持つイベントを、予定・過去に分ける。日付が不正な回はどちらにも入れない。
  // todayISOが取れない場合も、予定を「募集中」と誤認させないよう両方空にする。
  function splitSessions(ev, todayISO) {
    var upcoming = [], past = [];
    var list = ev.sessions || [];
    if (!todayISO) return { upcoming: upcoming, past: past };
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (!s || !isValidISODate(s.date)) continue;
      if (todayISO > s.date) past.push(s);
      else upcoming.push(s);
    }
    return { upcoming: upcoming, past: past };
  }

  function computeEffectiveStatus(ev, todayISO) {
    if (ev.sessions && ev.sessions.length && ev.status !== "paused" && ev.status !== "finished") {
      var up = splitSessions(ev, todayISO).upcoming;
      if (up.length === 0) return "finished";
      // full/closedはイベント全体の明示的な上書き。それ以外は日付別の募集状態から導く。
      if (ev.status === "full" || ev.status === "closed") return ev.status;
      for (var k = 0; k < up.length; k++) {
        if (up[k].status === "recruiting") return "recruiting";
      }
      return "upcoming";
    }
    if (ev.status === "paused" || ev.status === "finished") {
      return ev.status;
    }

    if (ev.status === "closed") {
      if (isValidISODate(ev.date) && todayISO && todayISO > ev.date) {
        return "finished";
      }
      return "closed";
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

    return ev.status || "upcoming";
  }

  function findEvent(eventId) {
    for (var i = 0; i < window.SNB_EVENTS.length; i++) {
      if (window.SNB_EVENTS[i].id === eventId) return window.SNB_EVENTS[i];
    }
    return null;
  }

  var FIELD_MAP = {
    title: "title",
    date: "dateLabel",
    time: "timeLabel",
    venue: "venue",
    fee: "fee",
    "fee-amount": "fee",
    minimum: "minimum",
    "minimum-amount": "minimum",
    condition: "condition",
    capacity: "capacity",
    "capacity-amount": "capacity"
  };

  // upcoming/recruiting/full/closed/finished/paused の状態文言テンプレート。
  // 日付経過等で自動finishedになった場合も、この関数側で「募集中」等の誤認を防ぐ。
  function buildInlineLabel(ev, status) {
    switch (status) {
      case "upcoming":
        return "開催予定：" + ev.title;
      case "recruiting":
        return "次回開催：" + ev.title + "・募集中";
      case "full":
        return "次回開催：" + ev.title + "・満席";
      case "closed":
        return ev.title + "・受付終了";
      case "finished":
        return ev.title + "は終了しました";
      case "paused":
        return "次回開催は準備中です";
      default:
        return ev.title;
    }
  }

  // baseball-next-activity のような、固定本文をevents.js側の状態に連動させたい箇所向け。
  function buildScheduleNote(ev, status) {
    if (status === "recruiting") {
      var lines = ["次回の活動を募集中です。"];
      var ups = splitSessions(ev, getTodayJST()).upcoming, next = null;
      for (var n = 0; n < ups.length && !next; n++) if (ups[n].status === "recruiting") next = ups[n];
      var when = next ? [next.label, next.time || "時間未定"].join(" ") : [ev.dateLabel, ev.timeLabel].filter(Boolean).join(" ");
      if (when) lines.push("直近の開催：" + when);
      if (ev.venue) lines.push(ev.venue);
      lines.push("参加を検討している方は、事前に<a href=\"../contact/?category=baseball\">問い合わせフォーム</a>でご連絡ください。");
      return lines.join("<br>");
    }
    if (status === "upcoming") {
      return "次回の活動を準備中です。<br>詳細が決まり次第、Xでお知らせします。";
    }
    if (status === "full") {
      return "次回の活動は定員に達しました。<br>参加についてのご相談は<a href=\"../contact/?category=baseball\">問い合わせフォーム</a>からご連絡ください。";
    }
    if (status === "closed") {
      return "受付を終了しました。<br>次回情報はXで案内します。";
    }
    if (status === "finished") {
      return "前回の活動は終了しました。<br>次回情報はXで案内します。";
    }
    // paused
    return "現在、屋外活動を休止しています。<br>次回開催はXでお知らせします。";
  }

  function fillField(el, field, ev) {
    var key = FIELD_MAP[field];
    if (!key) return;
    var value = ev[key];
    if (value === null || value === undefined) return;
    if (field === "minimum") {
      el.textContent = "最少催行" + value + "名";
    } else if (field === "capacity") {
      el.textContent = "定員" + value + "名";
    } else if (field === "minimum-amount" || field === "capacity-amount") {
      el.textContent = value + "名";
    } else if (field === "fee-amount") {
      el.textContent = String(value).replace(/^[¥￥]/, "").replace(/[（(].*$/, "");
    } else {
      el.textContent = value;
    }
  }

  // 日付別リストを描画する。DOM生成はtextContentのみ（データ由来の文字列をHTMLとして解釈しない）。
  function renderSessionList(el, sessions, isPast, eventStatus) {
    while (el.firstChild) el.removeChild(el.firstChild);
    for (var i = 0; i < sessions.length; i++) {
      var s = sessions[i];
      var li = document.createElement("li");
      var text = s.label + " " + (s.time || "時間未定");
      if (isPast) {
        text += "（" + (s.result === "held" ? "開催済み" : s.result === "cancelled" ? "中止" : "実施未確認") + "）";
      } else {
        // full/closedなどイベント全体の上書き中は、回ごとの「募集中」を表示しない。
        if (eventStatus === "full") text += "（満席）";
        else if (eventStatus === "closed") text += "（受付終了）";
        else if (eventStatus === "paused") text += "（開催予定）";
        else text += s.status === "recruiting" ? "（募集中）" : "（開催予定・募集は未定）";
      }
      li.textContent = text;
      el.appendChild(li);
    }
  }

  // eventIdに対応するDOM要素（[data-event-id][data-event-field]）をまとめて更新する。
  function render(eventId) {
    var ev = findEvent(eventId);
    if (!ev) return;

    var status = computeEffectiveStatus(ev, getTodayJST());
    var meta = STATUS_META[status] || STATUS_META.finished;

    var split = splitSessions(ev, getTodayJST());
    var nodes = document.querySelectorAll('[data-event-id="' + eventId + '"]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var field = el.getAttribute("data-event-field");

      if (field === "badge") {
        el.textContent = meta.label;
        el.className = el.className.replace(/\bstatus-badge--\S+/g, "").trim();
        el.classList.add("status-badge--" + meta.modifier);
      } else if (field === "status-class") {
        el.className = el.className.replace(/\bstatus-badge--\S+/g, "").trim();
        el.classList.add("status-badge--" + meta.modifier);
      } else if (field === "badge-label") {
        el.textContent = meta.label;
      } else if (field === "badge-inline") {
        el.textContent = buildInlineLabel(ev, status);
      } else if (field === "heading") {
        el.textContent = (status === "finished" || status === "closed") ? "開催情報" : "次回開催";
      } else if (field === "schedule-note") {
        el.innerHTML = buildScheduleNote(ev, status);
      } else if (field === "form-gate") {
        // recruiting以外は申込フォーム本体（入力・送信ボタン含む）を非表示にし、送信できなくする。
        el.hidden = !meta.ctaEnabled;
      } else if (field === "form-fallback") {
        el.hidden = meta.ctaEnabled;
      } else if (field === "form-fallback-heading") {
        el.textContent = meta.formHeading || "";
      } else if (field === "form-fallback-text") {
        el.textContent = meta.formMessage || "";
      } else if (field === "upcoming-list") {
        renderSessionList(el, status === "finished" ? [] : split.upcoming, false, status);
      } else if (field === "past-list") {
        renderSessionList(el, split.past, true);
      } else if (field === "upcoming-block") {
        // イベント全体を明示的にfinishedにした場合は全体状態を優先し、予定一覧は出さない。
        el.hidden = split.upcoming.length === 0 || status === "finished";
      } else if (field === "past-block") {
        el.hidden = split.past.length === 0;
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
    splitSessions: splitSessions,
    getTodayJST: getTodayJST,
    findEvent: findEvent,
    render: render
  };
})();
