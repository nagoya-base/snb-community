/*
 * 名古屋野球ユニ部アンケート：test mode の判定（Issue #381）。GA4 初期化より前に同期読み込みする。
 *
 * 経路は「URL fragment → sessionStorage → POST body」に限る。query string には置かない。
 *   #test=preview_no_submit            client-only。保存・通信・GA4 なし
 *   #test=closed_view                  client-only。受付終了表示の確認。通信・GA4 なし
 *   #test=submit_excluded&token=...&run=...   serverへtestとして送信（token は server が検証）
 * fragment は読み取り直後に sessionStorage へ移し、URL から取り除く（履歴・共有・GA4 の page_location に残さない）。
 *
 * fail closed：test 指定（fragment の test= / 保存済みの test 状態 / query string の test=）を検出したのに検証できない場合は
 * production へ戻さず mode='invalid_test_config' とする。app.js は GA4 なし・status GET なし・POST なしで
 * 「テスト用URLの設定が正しくありません」だけを表示する（URL の誤記で本番回答として起動・送信される事故を防ぐ）。
 * invalid も sessionStorage に残し、リロードしても production に戻らない（「テストを終了」で解除）。
 * token / run は sessionStorage にのみ置き、window・DOM・ログへは出さない。公開するのは mode 名だけ。
 */
(function () {
  'use strict';
  var STORAGE_KEY = 'snb_baseball_uniform_survey_test_v1';
  var MODES = ['preview_no_submit', 'closed_view', 'submit_excluded'];
  var INVALID = { mode: 'invalid_test_config' };
  var RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
  var TOKEN_PATTERN = /^[\x21-\x7E]{1,200}$/;

  function randomRunId() {
    var bytes = new Uint8Array(6);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return 'run_' + Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  /* 検証済みの {mode, token, run} を返す。検証できない test 指定は INVALID（production にはしない）。 */
  function normalize(raw) {
    var value = validate(raw);
    return value || INVALID;
  }

  function validate(raw) {
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
    if (!params.has('test') && !params.has('token') && !params.has('run')) return null; // token/run だけでも test 指定の誤記として扱う
    return { mode: params.get('test'), token: params.get('token'), run: params.get('run') };
  }

  function load() {
    var stored;
    try { stored = window.sessionStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
    if (stored === null || stored === undefined) return null;
    try {
      var parsed = JSON.parse(stored);
      if (parsed && parsed.mode === INVALID.mode) return INVALID;
      return normalize(parsed);
    } catch (e) { return INVALID; }
  }

  function queryHasTest() {
    try { return new URLSearchParams(window.location.search).has('test'); } catch (e) { return false; }
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
    current = normalize(fragment); // 検証できなければ INVALID。保存して、リロードでも production に戻さない
    save(current);
    // fragment（token を含み得る）を即座にURLから除去する。query string は変更しない。
    try { window.history.replaceState(null, '', window.location.pathname + window.location.search); } catch (e) { /* ignore */ }
  } else {
    current = load();
    // query string の test= は無効な経路。無視して production にせず fail closed にする（token は query に置かない）。
    if (!current && queryHasTest()) current = INVALID;
  }

  var memory = current;
  window.SNB_BASEBALL_SURVEY_TEST_MODE = current ? current.mode : null;
  /* app.js 専用の読み出し口。token はここでのみ取り出し、DOM・ログ・GA4・URL には出さない。 */
  window.SNBBaseballSurveyTestStore = {
    read: function () { return load() || memory; },
    clear: function () { memory = null; save(null); }
  };
})();
