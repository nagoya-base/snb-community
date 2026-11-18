'use strict';
// Issue #459：12/26 名古屋ユニ忘年会の特設ページ・メール応募フォーム（FormSubmit・主催者の手動承認／手動定員管理）の検証。
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
let failures = 0;
function assert(cond, msg) { if (!cond) { console.error('FAIL:', msg); failures++; } else { console.log('OK:', msg); } }

const page = read('community/year-end-party-2026/index.html');
const top = read('community/index.html');

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

// 方針訂正：GAS・スプレッドシート等の管理基盤は作らない
assert(!fs.existsSync(path.join(root, 'community', 'gas', 'year_end_party_2026_backend.gs')), 'GASバックエンドが存在しない');
assert(!/script\.google\.com|PropertiesService|spreadsheet/i.test(page), 'ページがGAS・スプレッドシートを参照しない');
const contactEndpoint = read('contact/index.html').match(/FORM_ENDPOINT = '([^']+)'/)[1];
const pageEndpoint = page.match(/FORM_ENDPOINT = '([^']+)'/)[1];
assert(contactEndpoint === pageEndpoint && /^https:\/\/formsubmit\.co\/ajax\//.test(pageEndpoint), '既存contactフォームと同じFormSubmit送信先を再利用（新しい宛先を作らない）');
assert(/name="イベント名" value="12\/26（土）名古屋ユニ忘年会"/.test(page) && /name="開催日時" value="2026年12月26日（土）17:00開場／18:00開始〜21:00終了"/.test(page) && /name="イベントID" value="year-end-party-2026"/.test(page), 'イベント名・日時・IDが固定のhiddenで送信される（手入力不要）');
assert(/name="_honey"/.test(page) && /name="_captcha" value="false"/.test(page) && /name="_template" value="table"/.test(page), 'FormSubmit設定（honeypot・template）が既存と同じ');
assert(/ENTRY_STATUS = 'open'/.test(page) && /主催者が手動で更新/.test(text), '受付状況は主催者の手動切替であることを明示');
const visible = page.replace(/<script[\s\S]*?<\/script>/g, '');
assert(!/リアルタイム|自動で(?:人数|受付)/.test(visible.replace(/リアルタイムの自動集計ではありません/, '')), '自動人数管理を実装済みと誤認させない');

// ── ブラウザ挙動（jsdom） ──
function loadPage(status, fetchImpl) {
  let html = page.replace(/<script async src="https:\/\/www\.googletagmanager[^>]*><\/script>/, '').replace(/<script src="\.\.\/\.\.\/analytics\.js"><\/script>/, '');
  if (status) html = html.replace("var ENTRY_STATUS = 'open';", "var ENTRY_STATUS = '" + status + "';");
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, beforeParse(w) { w.fetch = fetchImpl || (() => Promise.reject(new Error('no fetch'))); w.HTMLElement.prototype.scrollIntoView = function () {}; w.HTMLFormElement.prototype.reportValidity = function () { return this.checkValidity(); }; } });
  return dom.window;
}
const tick = () => new Promise((r) => setTimeout(r, 20));
function fill(w, over) {
  const d = w.document;
  d.getElementById('ye-name').value = 'テスト太郎';
  d.getElementById('ye-age').value = '30代';
  d.getElementById('ye-email').value = 'a@example.com';
  d.querySelector('input[name="希望する返信方法"][value="メール"]').checked = true;
  d.querySelector('input[name="野球ユニフォームの持参"][value="持参できる"]').checked = true;
  d.getElementById('ye-message').value = '好きなチームはドラゴンズです';
  d.getElementById('ye-agree').checked = true;
  d.getElementById('ye-email').dispatchEvent(new w.Event('input'));
  d.getElementById('ye-carrier-ack').checked = true;
  if (over) over(d);
}
const submit = (w) => w.document.getElementById('ye-form').dispatchEvent(new w.Event('submit', { cancelable: true }));

(async () => {
  // 受付中→送信成功→受付完了表示（参加確定とは表示しない）／二重送信は1回だけ
  const calls = [];
  let w = loadPage(null, (url, opt) => { calls.push({ url, opt }); return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: 'true' }) }); });
  assert(!w.document.getElementById('ye-submit').disabled && /募集中/.test(w.document.getElementById('ye-status').textContent), 'ENTRY_STATUS=open で応募可能表示');
  fill(w);
  submit(w); submit(w);
  await tick();
  assert(calls.length === 1 && calls[0].url === pageEndpoint, '二重送信しても送信は1回だけ（FormSubmit宛て）');
  const fd = calls[0].opt.body;
  assert(fd.get('イベント名') === '12/26（土）名古屋ユニ忘年会' && fd.get('開催日時').indexOf('17:00開場') !== -1 && fd.get('イベントID') === 'year-end-party-2026', '送信内容にイベント名・日時・IDが含まれる');
  assert(fd.get('お名前') === 'テスト太郎' && fd.get('年代') === '30代' && fd.get('メールアドレス') === 'a@example.com' && fd.get('希望する返信方法') === 'メール' && fd.get('野球ユニフォームの持参') === '持参できる' && fd.get('同意事項') === '同意する', '入力項目が日本語ラベルでメールに載る');
  assert(!w.document.getElementById('ye-success').hidden && /参加確定は主催者からの個別連絡/.test(w.document.getElementById('ye-success').textContent), '送信後は受付完了（参加確定ではない）を表示');
  submit(w); await tick();
  assert(calls.length === 1, '成功後の再送信は行われない');

  // バリデーション：連絡先なし／返信方法と連絡先の矛盾は送信されない
  let c2 = 0;
  w = loadPage(null, () => { c2++; return Promise.resolve({ ok: true, json: () => Promise.resolve({}) }); });
  fill(w, (d) => { d.getElementById('ye-email').value = ''; });
  submit(w); await tick();
  assert(c2 === 0, '連絡先（メール/X）が無ければ送信されない');
  fill(w, (d) => { d.getElementById('ye-email').value = ''; d.getElementById('ye-x').value = '@abc'; });
  w.document.getElementById('ye-x').dispatchEvent(new w.Event('input'));
  submit(w); await tick();
  assert(c2 === 0, '返信方法がメールなのにメール未入力なら送信されない');

  // 満員／受付終了／開催中止／不正値：フォーム送信不可
  [['full', /満員/], ['closed', /受付は終了/], ['cancelled', /開催中止/], ['bogus', /受付は終了/]].forEach(([st, re]) => {
    let n = 0;
    const ww = loadPage(st, () => { n++; return Promise.resolve({ ok: true, json: () => Promise.resolve({}) }); });
    fill(ww); submit(ww);
    assert(ww.document.getElementById('ye-submit').disabled && re.test(ww.document.getElementById('ye-status').textContent), st + '：フォーム無効・状態表示');
  });

  // 通信エラー：エラー表示、再送可能
  let n = 0;
  w = loadPage(null, () => { n++; return n === 1 ? Promise.reject(new Error('net')) : Promise.resolve({ ok: true, json: () => Promise.resolve({}) }); });
  fill(w); submit(w); await tick();
  assert(!w.document.getElementById('ye-submit-error').hidden && !w.document.getElementById('ye-submit').disabled && w.document.getElementById('ye-form').hidden === false, '通信エラー時はエラー表示・フォームは残り再送可能');
  submit(w); await tick();
  assert(n === 2 && !w.document.getElementById('ye-success').hidden, '再試行で送信できる');

  // サーバーエラー（!ok）
  w = loadPage(null, () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }));
  fill(w); submit(w); await tick();
  assert(!w.document.getElementById('ye-submit-error').hidden && w.document.getElementById('ye-success').hidden, 'HTTPエラー時は成功表示にしない');

  if (failures) { console.error('\ntest_year_end_party.js: ' + failures + ' failure(s)'); process.exit(1); }
  console.log('\ntest_year_end_party.js: all checks passed');
})();
