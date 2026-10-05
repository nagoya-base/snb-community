/*
 * 管理ダッシュボード（GitHub Pages）。Googleログイン（Google Identity Services）で得た ID token を
 * Admin GAS（doPost）へ送り、サーバーが検証・ロール判定した結果だけを描画する。
 *
 *  - ID token は変数（メモリ）にだけ保持する。localStorage / sessionStorage / Cookie / URL / console へは出さない。
 *  - email / role をクライアントから送らない。表示するロールはサーバーのレスポンスの値。
 *  - 描画は textContent / createTextNode のみ（自由記述をHTMLとして解釈しない）。
 *  - サーバーが返さなかった区分（VIEWER の自由記述・ファネル等）のタブはDOMごと作らない。
 */
(function () {
  'use strict';
  var config = window.COSTUME_PORTRAIT_ADMIN_CONFIG || {};
  var endpoint = typeof config.endpoint === 'string' ? config.endpoint.trim() : '';
  var clientId = typeof config.googleClientId === 'string' ? config.googleClientId.trim() : '';
  var idToken = null; // メモリのみ。ログアウト・認証失敗で破棄する。
  var gisReady = false;
  var data = null;

  var loginView = document.getElementById('login-view');
  var dashboardView = document.getElementById('dashboard-view');
  var loginMessage = document.getElementById('login-message');
  var statusEl = document.getElementById('status');
  var tabsEl = document.getElementById('tabs');
  var panelsEl = document.getElementById('panels');

  var MESSAGES = {
    login: 'Googleアカウントでログインしてください。',
    unconfigured: '管理ダッシュボードは未設定です（接続先とGoogleクライアントIDが設定されていません）。',
    forbidden: 'このアカウントには管理画面の利用権限がありません。',
    expired: 'ログインの有効期限が切れたか、認証に失敗しました。もう一度ログインしてください。',
    failed: '読み込みに失敗しました。時間をおいてもう一度お試しください。',
    gisFailed: 'Googleログインを読み込めませんでした。ページを再読み込みしてください。'
  };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function pct(n, base) { return base ? (Math.round(n / base * 1000) / 10) + '%' : '-'; }

  // ---------- 通信 ----------
  /** text/plain のPOST（CORSプリフライトなし）。失敗は Error(コード) で reject。token は本文にのみ載せる。 */
  function callApi(payload) {
    var body = { idToken: idToken };
    Object.keys(payload).forEach(function (key) { body[key] = payload[key]; });
    return fetch(endpoint, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer'
    }).then(function (response) {
      return response.json();
    }).then(function (result) {
      if (!result || result.ok !== true) throw new Error(result && typeof result.error === 'string' ? result.error : 'server_error');
      return result;
    }, function () { throw new Error('network'); });
  }

  // ---------- 画面切替 ----------
  function showLogin(message) {
    idToken = null;
    data = null;
    clear(tabsEl);
    clear(panelsEl);
    document.getElementById('role').textContent = '';
    statusEl.textContent = '';
    dashboardView.hidden = true;
    loginView.hidden = false;
    loginMessage.textContent = message || MESSAGES.login;
  }

  function logout() {
    showLogin(MESSAGES.login);
    try {
      if (gisReady) window.google.accounts.id.disableAutoSelect();
    } catch (ignored) { /* ログアウト自体はクライアント側の破棄で完了している */ }
  }

  function failureMessage(code) {
    return code === 'forbidden' ? MESSAGES.forbidden : (code === 'unauthenticated' ? MESSAGES.expired : MESSAGES.failed);
  }

  // ---------- 描画（ダッシュボード） ----------
  function barRow(label, count, base) {
    var row = el('div', 'bar-row');
    row.appendChild(el('span', '', label));
    var bar = el('div', 'bar');
    var fill = document.createElement('i');
    fill.style.width = (base ? Math.min(100, count / base * 100) : 0) + '%';
    bar.appendChild(fill);
    row.appendChild(bar);
    row.appendChild(el('span', 'num', count + '人 (' + pct(count, base) + ')'));
    return row;
  }

  function questionCard(q, hideZero) {
    var card = el('div', 'card');
    card.appendChild(el('h3', '', q.no + ' ' + q.label));
    if (q.matrix) {
      q.matrix.forEach(function (row) {
        card.appendChild(el('p', 'note', row.label + '（回答 ' + row.view.base + '人）'));
        row.view.options.forEach(function (o) { card.appendChild(barRow(o.label, o.count, row.view.base)); });
      });
      return card;
    }
    card.appendChild(el('p', 'note', '回答者数 ' + q.view.base + '人（各選択肢は「選んだ回答者数」。複数選択は合計が100%を超えます）'));
    q.view.options.forEach(function (o) {
      if (hideZero && o.count === 0) return;
      card.appendChild(barRow(o.label, o.count, q.view.base));
    });
    return card;
  }

  function renderOverview(root) {
    var s = data.summary;
    var kpis = el('div', 'kpis');
    [['総回答数', s.totalRows], ['有効回答数', s.validRows], ['締切後の回答', s.lateRows], ['日時不明', s.unparseableRows],
     ['重複拒否件数', s.duplicateRejects]].forEach(function (pair) {
      if (pair[1] === undefined) return;
      var kpi = el('div', 'kpi');
      kpi.appendChild(el('b', '', pair[1]));
      kpi.appendChild(el('span', '', pair[0]));
      kpis.appendChild(kpi);
    });
    root.appendChild(kpis);

    if (s.finalize) {
      var fin = el('div', 'card');
      fin.appendChild(el('h2', '', '結果確定（finalize）'));
      fin.appendChild(el('p', '', s.finalize.status === 'final'
        ? '確定済み：' + s.finalize.finalizedAt + '（公開結果の基礎回答数 ' + s.finalize.publicTotal + '）'
        : '未確定。締切後に Public GAS で finalizeSurvey を実行してください。'));
      root.appendChild(fin);
    }

    var days = el('div', 'card');
    days.appendChild(el('h2', '', '回答日別（有効回答）'));
    var max = data.byDay.reduce(function (m, d) { return Math.max(m, d.count); }, 0);
    data.byDay.forEach(function (d) { days.appendChild(barRow(d.date, d.count, max)); });
    if (!data.byDay.length) days.appendChild(el('p', 'note', 'まだ回答がありません。'));
    root.appendChild(days);

    ['age_range', 'residence'].forEach(function (id) {
      data.sections.forEach(function (section) {
        section.questions.forEach(function (q) {
          if (q.id !== id) return;
          root.appendChild(questionCard(q, id === 'residence'));
        });
      });
    });
  }

  function renderSimple(root) {
    data.sections.forEach(function (section) {
      root.appendChild(el('h2', '', section.title));
      section.questions.forEach(function (q) { root.appendChild(questionCard(q, false)); });
    });
  }

  function renderFunnel(root) {
    data.funnels.forEach(function (flow) {
      var card = el('div', 'card');
      card.appendChild(el('h2', '', flow.label));
      var top = flow.stages[0].count;
      flow.stages.forEach(function (stage, i) {
        var row = el('div', 'funnel-stage');
        row.appendChild(el('span', '', (i ? '↓ ' : '') + stage.label));
        var bar = el('div', 'bar');
        var fill = document.createElement('i');
        fill.style.width = (top ? stage.count / top * 100 : 0) + '%';
        bar.appendChild(fill);
        row.appendChild(bar);
        row.appendChild(el('span', 'num', stage.count + '人 (' + pct(stage.count, top) + ')'));
        card.appendChild(row);
      });
      card.appendChild(el('p', 'note', '各段階は前の段階をすべて満たした回答者のみを数えます（累積）。条件は survey.schema.json の funnels で定義。'));
      root.appendChild(card);
    });
  }

  function crosstabTable(result) {
    var wrap = el('div', 'table-wrap');
    var table = document.createElement('table');
    var head = document.createElement('tr');
    head.appendChild(el('th', '', result.rowLabel + ' ＼ ' + result.colLabel));
    head.appendChild(el('th', '', '行の回答者数'));
    result.cols.forEach(function (c) { head.appendChild(el('th', '', c.label)); });
    table.appendChild(head);
    result.rows.forEach(function (row) {
      var tr = document.createElement('tr');
      tr.appendChild(el('td', '', row.label));
      tr.appendChild(el('td', '', row.base));
      row.cells.forEach(function (n) {
        tr.appendChild(el('td', '', n + (row.base ? ' (' + pct(n, row.base) + ')' : '')));
      });
      table.appendChild(tr);
    });
    wrap.appendChild(table);
    return wrap;
  }

  function customCrossCard() {
    var custom = el('div', 'card');
    custom.appendChild(el('h2', '', '任意のクロス集計'));
    var controls = el('div', 'controls');
    var rowSel = document.createElement('select');
    var colSel = document.createElement('select');
    rowSel.setAttribute('aria-label', '行の設問');
    colSel.setAttribute('aria-label', '列の設問');
    data.axes.forEach(function (axis) {
      [rowSel, colSel].forEach(function (sel) {
        var opt = document.createElement('option');
        opt.value = axis.key;
        opt.textContent = axis.label;
        sel.appendChild(opt);
      });
    });
    var button = el('button', '', '集計する');
    button.type = 'button';
    var out = el('div');
    controls.appendChild(rowSel);
    controls.appendChild(el('span', '', '×'));
    controls.appendChild(colSel);
    controls.appendChild(button);
    custom.appendChild(controls);
    custom.appendChild(out);
    button.addEventListener('click', function () {
      clear(out);
      out.appendChild(el('p', 'note', '集計中…'));
      callApi({ action: 'crosstab', rowKey: rowSel.value, colKey: colSel.value }).then(function (result) {
        clear(out);
        out.appendChild(crosstabTable(result.data));
        out.appendChild(el('p', 'note', result.data.note));
      }, function (error) {
        if (error.message === 'unauthenticated') { showLogin(MESSAGES.expired); return; }
        clear(out);
        out.appendChild(el('p', 'warn', '集計に失敗しました。'));
      });
    });
    return custom;
  }

  function renderCross(root) {
    if (data.axes) root.appendChild(customCrossCard());
    data.crosstabPresets.forEach(function (preset) {
      var card = el('div', 'card');
      card.appendChild(el('h3', '', preset.label));
      card.appendChild(crosstabTable(preset));
      card.appendChild(el('p', 'note', preset.note));
      root.appendChild(card);
    });
  }

  function freeCard(title, items) {
    var card = el('div', 'card');
    card.appendChild(el('h3', '', title + '（' + items.length + '件）'));
    items.forEach(function (item) {
      var div = el('div', 'free-item');
      div.appendChild(el('small', '', item.at));
      div.appendChild(document.createTextNode(item.text));
      card.appendChild(div);
    });
    if (!items.length) card.appendChild(el('p', 'note', 'なし'));
    return card;
  }

  function renderFree(root) {
    data.freeText.texts.forEach(function (t) { root.appendChild(freeCard(t.label, t.items)); });
    root.appendChild(el('h2', '', '「その他」自由記述'));
    data.freeText.others.forEach(function (o) { root.appendChild(freeCard(o.label, o.items)); });
    if (!data.freeText.others.length) root.appendChild(el('p', 'note', '「その他」の記述はまだありません。'));
  }

  /* requires: サーバーがそのキーを返した場合のみタブを作る（返却されなかった区分は隠すのではなく存在させない）。 */
  var TABS = [
    { key: 'overview', label: '概要', render: renderOverview },
    { key: 'simple', label: '単純集計', render: renderSimple },
    { key: 'funnel', label: 'ファネル', render: renderFunnel, requires: 'funnels' },
    { key: 'cross', label: 'クロス集計', render: renderCross },
    { key: 'free', label: '自由記述', render: renderFree, requires: 'freeText' }
  ];

  function showTab(name) {
    Array.prototype.forEach.call(panelsEl.children, function (panel) { panel.hidden = panel.id !== 'tab-' + name; });
    Array.prototype.forEach.call(tabsEl.children, function (b) {
      b.setAttribute('aria-selected', b.getAttribute('data-tab') === name ? 'true' : 'false');
    });
  }

  function renderDashboard(role) {
    clear(tabsEl);
    clear(panelsEl);
    document.getElementById('role').textContent = '管理者権限: ' + (role === 'owner' ? 'OWNER' : 'VIEWER');
    TABS.forEach(function (tab) {
      if (tab.requires && !data[tab.requires]) return;
      var button = el('button', '', tab.label);
      button.type = 'button';
      button.setAttribute('role', 'tab');
      button.setAttribute('data-tab', tab.key);
      button.addEventListener('click', function () { showTab(tab.key); });
      tabsEl.appendChild(button);
      var panel = el('section', 'panel');
      panel.id = 'tab-' + tab.key;
      tab.render(panel);
      panelsEl.appendChild(panel);
    });
    showTab('overview');
    statusEl.textContent = '';
  }

  function loadDashboard() {
    loginView.hidden = true;
    dashboardView.hidden = false;
    clear(tabsEl);
    clear(panelsEl);
    statusEl.textContent = '読み込み中…';
    callApi({ action: 'dashboard' }).then(function (result) {
      data = result.data;
      renderDashboard(result.role);
    }, function (error) {
      showLogin(failureMessage(error.message));
    });
  }

  // ---------- Googleログイン（Google Identity Services） ----------
  function onCredential(response) {
    var credential = response && typeof response.credential === 'string' ? response.credential : '';
    response = null;
    if (!credential) { loginMessage.textContent = MESSAGES.expired; return; }
    idToken = credential;
    loadDashboard();
  }

  function initGoogleLogin() {
    try {
      window.google.accounts.id.initialize({ client_id: clientId, callback: onCredential, auto_select: false });
      window.google.accounts.id.renderButton(document.getElementById('gis-button'),
        { type: 'standard', theme: 'outline', size: 'large', text: 'signin_with', locale: 'ja' });
      gisReady = true;
    } catch (ignored) { loginMessage.textContent = MESSAGES.gisFailed; }
  }

  function loadGis() {
    if (window.google && window.google.accounts && window.google.accounts.id) { initGoogleLogin(); return; }
    var script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = initGoogleLogin;
    script.onerror = function () { loginMessage.textContent = MESSAGES.gisFailed; };
    document.head.appendChild(script);
  }

  document.getElementById('logout').addEventListener('click', logout);
  if (!endpoint || !clientId) {
    showLogin(MESSAGES.unconfigured);
  } else {
    showLogin(MESSAGES.login);
    loadGis();
  }
})();
