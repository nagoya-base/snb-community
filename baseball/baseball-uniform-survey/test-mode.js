/*
 * 名古屋野球ユニ部アンケート：test mode の判定（Issue #381）。GA4 初期化より前に同期読み込みする。
 *
 * 経路は「URL fragment → sessionStorage → POST body」に限る。query string には置かない。
 *   #test=preview_no_submit            client-only。保存・通信・GA4 なし
 *   #test=closed_view                  client-only。受付終了表示の確認。通信・GA4 なし
 *   #test=submit_excluded&token=...&run=...   serverへtestとして送信（token は server が検証）
 * fragment は読み取り直後に sessionStorage へ移し、URL から取り除く（履歴・共有・GA4 の page_location に残さない）。
 * token / run は sessionStorage にのみ置き、window・DOM・ログへは出さない。公開するのは mode 名だけ。
 */
(function () {
  'use strict';
  var STORAGE_KEY = 'snb_baseball_uniform_survey_test_v1';
  var MODES = ['preview_no_submit', 'closed_view', 'submit_excluded'];
  var RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
  var TOKEN_PATTERN = /^[\x21-\x7E]{1,200}$/;

  function randomRunId() {
    var bytes = new Uint8Array(6);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return 'run_' + Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  /* 検証済みの {mode, token, run} だけを返す。不正なら null（= 通常の production 表示）。 */
  function normalize(raw) {
    if (!raw || MODES.indexOf(raw.mode) === -1) return null;
    if (raw.mode !== 'submit_excluded') return { mode: raw.mode };
    if (typeof raw.token !== 'string' || !TOKEN_PATTERN.test(raw.token)) return null;
    var run = typeof raw.run === 'string' && raw.run ? raw.run : randomRunId();
    if (!RUN_ID_PATTERN.test(run)) return null;
    return { mode: raw.mode, token: raw.token, run: run };
  }

  function readFragment() {
    var hash = window.location.hash || '';
    if (hash.length < 2) return null;
    var params;
    try { params = new URLSearchParams(hash.slice(1)); } catch (e) { return null; }
    if (!params.has('test')) return null;
    return { mode: params.get('test'), token: params.get('token'), run: params.get('run') };
  }

  function load() {
    try {
      var stored = window.sessionStorage.getItem(STORAGE_KEY);
      return stored ? normalize(JSON.parse(stored)) : null;
    } catch (e) { return null; }
  }

  function save(value) {
    try {
      if (value) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      else window.sessionStorage.removeItem(STORAGE_KEY);
    } catch (e) { /* storage が使えない場合は、そのページ内のメモリだけで動作する */ }
  }

  var fragment = readFragment();
  var current = null;
  if (fragment) {
    current = normalize(fragment);
    save(current);
    // fragment（token を含み得る）を即座にURLから除去する。query string は変更しない。
    try { window.history.replaceState(null, '', window.location.pathname + window.location.search); } catch (e) { /* ignore */ }
    if (!current) {
      // 不正な指定は黙って production にはしない：保存済みの test も解除し、そのまま通常表示にする。
      save(null);
    }
  } else {
    current = load();
  }

  var memory = current;
  window.SNB_BASEBALL_SURVEY_TEST_MODE = current ? current.mode : null;
  /* app.js 専用の読み出し口。token はここでのみ取り出し、DOM・ログ・GA4・URL には出さない。 */
  window.SNBBaseballSurveyTestStore = {
    read: function () { return load() || memory; },
    clear: function () { memory = null; save(null); }
  };
})();
