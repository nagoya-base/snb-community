'use strict';
// Issue #459：12/26 名古屋ユニ忘年会の特設ページ・応募フォーム・GASバックエンド（承認制／定員7人）の検証。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
let failures = 0;
function assert(cond, msg) { if (!cond) { console.error('FAIL:', msg); failures++; } else { console.log('OK:', msg); } }

const page = read('community/year-end-party-2026/index.html');
const top = read('community/index.html');
const gasSrc = read('community/gas/year_end_party_2026_backend.gs');

// ── 静的内容 ──
const text = new JSDOM(page).window.document.body.textContent;
assert(/2026年12月26日（土）/.test(text) && /17:00 開場／18:00 開始〜21:00 終了/.test(text), '日付・開場17:00／開始18:00／終了21:00が表示される');
assert(/Studio Nagoya Base（SNB）/.test(text) && /3,000円／人/.test(text) && /定員[\s\S]{0,4}7人/.test(text), '会場SNB・参加費3,000円・定員7人が表示される');
assert(/当日、現金またはPayPay/.test(text) && /事前決済はありません/.test(text), '当日現金またはPayPay払い・事前決済なしの表記');
assert(/野球好きもユニフォーム好きも歓迎/.test(text), '「野球好きもユニフォーム好きも歓迎」を明記');
assert(/12\/26（土）名古屋ユニ忘年会⚾/.test(text) && !/🍻/.test(page), '見出しに🍻を使わない');
assert(!/飲食|飲み物|食べ物|持ち寄り|ビール|ソフトドリンク|アルコール|お酒|酒類/.test(page), '公開ページに飲食・持ち寄りの記載がない（運営者の最優先指示）');
assert(!/カード決済|クレジット/.test(page), 'カード決済を要求しない');
assert(/応募を受け付けました。参加確定は主催者からの個別連絡をもってお知らせします/.test(page), '受付完了文言が正本どおり');
assert(!/参加が確定しました|自動承認|自動で参加確定/.test(page), '自動確定を示す文言がない');
assert(/rel="canonical" href="https:\/\/nagoya-base\.github\.io\/snb-community\/community\/year-end-party-2026\/"/.test(page), 'canonicalが特設URL');
assert(/og:title/.test(page) && /og:image/.test(page) && /twitter:card/.test(page), 'OGP/Xカードがある');
assert(!/^---/.test(page), 'front matterが混入していない');
assert(!/paypay\.ne\.jp|PayPay ID|qr/i.test(page.replace(/PayPayでお支払い|現金またはPayPay/g, '')), 'PayPay受取情報・QRを公開リポジトリに含めない');
['年代', 'メールアドレス', 'Xアカウント', '希望する返信方法', '野球ユニフォームの持参', '参加動機'].forEach((k) => assert(page.indexOf(k) !== -1, 'フォーム項目：' + k));
assert(!/運動経験/.test(page), '運動経験を必須項目にしていない');

// ローカル相対リンクの実在確認
const doc = new JSDOM(page).window.document;
const dir = path.join(root, 'community', 'year-end-party-2026');
let broken = [];
doc.querySelectorAll('a[href], link[href], script[src]').forEach((el) => {
  const ref = el.getAttribute('href') || el.getAttribute('src');
  if (!ref || /^(https?:|#|mailto:)/.test(ref)) return;
  const clean = ref.split('#')[0].split('?')[0];
  const target = path.resolve(dir, clean);
  if (!fs.existsSync(target)) broken.push(ref);
});
assert(broken.length === 0, 'リンク切れなし' + (broken.length ? '：' + broken.join(', ') : ''));

// トップ・sitemap・contact
assert(/year-end-party-2026\//.test(top) && /3,000円／人/.test(top) && /vol2_0725_baseball\.html/.test(top), 'community/ に忘年会カードがあり、過去アーカイブも維持');
assert(!/飲食|飲み物|食べ物|持ち寄り|ビール/.test(top.slice(top.indexOf('year-end-party-banner'), top.indexOf('year-end-party-banner') + 1200)), 'トップのカードにも飲食記載なし');
assert(/community\/year-end-party-2026\//.test(read('sitemap.xml')), 'sitemapに特設ページがある');
assert(/year_end_party_2026/.test(read('contact/index.html')), 'contactのevent labelに追加（既存mapは維持）');

// ── ブラウザ挙動（jsdom） ──
function loadPage(endpoint, fetchImpl) {
  const html = page.replace(/<script async src="https:\/\/www\.googletagmanager[^>]*><\/script>/, '').replace(/<script src="\.\.\/\.\.\/analytics\.js"><\/script>/, '');
  const src = endpoint ? html.replace('PLACEHOLDER_REPLACE_WITH_YEAR_END_PARTY_GAS_EXEC_URL', endpoint) : html;
  const dom = new JSDOM(src, { runScripts: 'dangerously', pretendToBeVisual: true, beforeParse(w) { w.fetch = fetchImpl || (() => Promise.reject(new Error('no fetch'))); w.HTMLElement.prototype.scrollIntoView = function () {}; w.HTMLFormElement.prototype.reportValidity = function () { return this.checkValidity(); }; } });
  return dom.window;
}
const tick = () => new Promise((r) => setTimeout(r, 20));
function fill(w) {
  const d = w.document;
  d.getElementById('ye-name').value = 'テスト太郎';
  d.getElementById('ye-age').value = '30代';
  d.getElementById('ye-email').value = 'a@example.com';
  d.querySelector('input[name="preferred_contact"][value="メール"]').checked = true;
  d.querySelector('input[name="has_uniform"][value="持参できる"]').checked = true;
  d.getElementById('ye-message').value = '好きなチームはドラゴンズです';
  d.getElementById('ye-agree').checked = true;
  d.getElementById('ye-email').dispatchEvent(new w.Event('input'));
  d.getElementById('ye-carrier-ack').checked = true;
}

(async () => {
  // GAS未設定：送信不可・準備中表示
  let w = loadPage(null);
  assert(w.document.getElementById('ye-submit').disabled && /準備中/.test(w.document.getElementById('ye-status').textContent), 'GAS未設定の間は送信ボタンが無効で「準備中」表示');

  // 受付中→送信成功→受付完了表示（参加確定とは表示しない）
  const calls = [];
  const okFetch = (url, opt) => { calls.push({ url, opt }); if (!opt) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, status: 'open' }) }); return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) }); };
  w = loadPage('https://script.google.com/macros/s/TEST/exec', okFetch);
  await tick();
  assert(!w.document.getElementById('ye-submit').disabled && /応募受付中/.test(w.document.getElementById('ye-status').textContent), 'status=open で応募可能表示');
  fill(w);
  const form = w.document.getElementById('ye-form');
  form.dispatchEvent(new w.Event('submit', { cancelable: true }));
  form.dispatchEvent(new w.Event('submit', { cancelable: true })); // 二重送信
  await tick();
  const posts = calls.filter((c) => c.opt);
  assert(posts.length === 1, '二重送信しても送信は1回だけ');
  const body = JSON.parse(posts[0].opt.body);
  assert(body.event_id === 'year-end-party-2026' && body.submission_id && body.agree_terms === true, 'event_id・submission_id・同意を送信');
  assert(!w.document.getElementById('ye-success').hidden && /参加確定は主催者からの個別連絡/.test(w.document.getElementById('ye-success').textContent), '送信後は受付完了（参加確定ではない）を表示');

  // 満員
  w = loadPage('https://script.google.com/macros/s/TEST/exec', () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, status: 'full' }) }));
  await tick();
  assert(w.document.getElementById('ye-submit').disabled && /満員/.test(w.document.getElementById('ye-status').textContent), '満員表示で送信不可');

  // 通信エラー→再試行で同一submission_id
  let n = 0; const ids = [];
  w = loadPage('https://script.google.com/macros/s/TEST/exec', (u, o) => {
    if (!o) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, status: 'open' }) });
    ids.push(JSON.parse(o.body).submission_id); n++;
    return n === 1 ? Promise.reject(new Error('net')) : Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
  });
  await tick(); fill(w);
  const f2 = w.document.getElementById('ye-form');
  f2.dispatchEvent(new w.Event('submit', { cancelable: true })); await tick();
  assert(!w.document.getElementById('ye-submit-error').hidden && !w.document.getElementById('ye-submit').disabled, '通信エラー時にエラー表示・再送可能');
  f2.dispatchEvent(new w.Event('submit', { cancelable: true })); await tick();
  assert(ids.length === 2 && ids[0] === ids[1], '再試行でも同一submission_id（サーバー側で二重保存されない）');

  // ── GASバックエンド ──
  function makeGas(configStatus) {
    const sheets = {};
    const mk = (rows) => ({ rows, getLastRow() { return this.rows.length; }, getDataRange() { return { getValues: () => this.rows.map((r) => r.slice()) }; }, getRange(r, c, nr, nc) { const self = this; return { getValues: () => [self.rows[r - 1].slice(c - 1, c - 1 + nc)] }; }, appendRow(a) { this.rows.push(a); } });
    const ctx = {
      SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: (n) => sheets[n] || null }) },
      LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
      ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ s, setMimeType() { return this; }, getContent() { return this.s; } }) }
    };
    vm.createContext(ctx); vm.runInContext(gasSrc, ctx);
    sheets.applications = mk([ctx.COLUMNS.slice()]);
    sheets.config = mk([['entry_status', configStatus || 'open']]);
    const post = (o) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(o) } }).getContent());
    const get = (a) => JSON.parse(ctx.doGet({ parameter: { action: a } }).getContent());
    return { ctx, sheets, post, get };
  }
  const base = (i, extra) => Object.assign({ event_id: 'year-end-party-2026', submission_id: 'sub-0000000' + i, display_name: '太郎' + i, age_group: '30代', contact_email: 'u' + i + '@example.com', contact_x: '', preferred_contact: 'メール', has_uniform: '持参できる', message: 'よろしく', agree_terms: true, website: '' }, extra || {});

  let g = makeGas('open');
  assert(g.post(base(1)).ok === true, 'GAS：正常な応募を保存');
  const col = (name) => g.ctx.COLUMNS.indexOf(name);
  assert(g.sheets.applications.rows[1][col('status')] === '応募受付', 'GAS：保存直後の状態は「応募受付」（自動承認しない）');
  assert(g.post(base(1)).duplicate === true && g.sheets.applications.rows.length === 2, 'GAS：同一submission_idの再送は保存しない');
  assert(g.post(base(2, { contact_email: 'U1@example.com' })).error === 'already_applied', 'GAS：同じメールの重複応募を拒否（大文字小文字無視）');
  assert(g.post(base(3, { website: 'http://spam' })).ok === true && g.sheets.applications.rows.length === 2, 'GAS：honeypot入力は保存しない');
  assert(g.post(base(4, { agree_terms: false })).error === 'agree_required', 'GAS：同意なしは拒否');
  assert(g.post(base(5, { contact_email: '', contact_x: '', })).error === 'contact_required', 'GAS：連絡先なしは拒否');
  assert(g.post(base(6, { preferred_contact: 'XのDM' })).error === 'preferred_contact_mismatch', 'GAS：返信方法と連絡先の矛盾は拒否');
  assert(g.post(base(7, { event_id: 'other' })).error === 'event_mismatch', 'GAS：イベントID不一致は拒否');
  assert(g.post(base(8, { display_name: '=HYPERLINK("x")' })).ok === true && /^'=/.test(g.sheets.applications.rows[2][col('display_name')]), 'GAS：数式インジェクション対策');
  assert(JSON.stringify(g.get('status')) === '{"ok":true,"status":"open"}', 'GAS：公開statusは受付状態のみ（人数・個人情報を返さない）');

  // 定員7人：承認済み7人で満員、応募拒否、8人目の承認拒否
  g = makeGas('open');
  const C = g.ctx.COLUMNS;
  for (let i = 1; i <= 8; i++) g.post(base(i));
  const rows = () => g.ctx.readRows(g.sheets.applications);
  for (let i = 0; i < 7; i++) g.sheets.applications.rows[1 + i][C.indexOf('status')] = '承認済み';
  assert(g.ctx.countApproved(rows()) === 7 && g.ctx.canApprove(rows(), 7) === false, 'GAS：承認済み7人で8人目の承認は不可（定員超過防止）');
  assert(g.ctx.canApprove(rows(), 0) === true, 'GAS：承認済みの本人行は再承認判定で二重計上しない');
  assert(g.get('status').status === 'full', 'GAS：承認7人で公開状態が満員になる');
  assert(g.post(base(9)).error === 'full', 'GAS：満員後の新規応募は拒否');
  g.sheets.applications.rows[1][C.indexOf('status')] = 'キャンセル';
  assert(g.get('status').status === 'open' && g.ctx.canApprove(rows(), 7) === true, 'GAS：キャンセルで枠が戻り、満員が解除される');
  assert(g.post(base(1, { submission_id: 'sub-new00001' })).ok === true, 'GAS：キャンセル済みの連絡先は再応募できる');

  // 受付切替
  assert(makeGas('closed').post(base(1)).error === 'closed', 'GAS：受付終了中は拒否');
  assert(makeGas('cancelled').post(base(1)).error === 'cancelled', 'GAS：開催中止中は拒否');
  assert(makeGas('garbage').get('status').status === 'closed', 'GAS：config不正は安全側のclosed');

  if (failures) { console.error('\ntest_year_end_party.js: ' + failures + ' failure(s)'); process.exit(1); }
  console.log('\ntest_year_end_party.js: all checks passed');
})();
