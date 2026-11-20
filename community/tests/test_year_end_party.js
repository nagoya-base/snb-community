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

// ── 静的内容（広告向けの簡潔なLP） ──
const text = new JSDOM(page.replace(/<script[\s\S]*?<\/script>/g, '')).window.document.body.textContent;
assert(/2026年12月26日（土）/.test(text) && /17:00 開場／18:00〜21:00/.test(text), '日付・開場17:00／開催18:00〜21:00が表示される');
assert(/Studio Nagoya Base（SNB）/.test(text) && /<dt>会費<\/dt><dd>4,000円／人<br>飲み物・軽食をご用意しています。<\/dd>/.test(page) && /<dt>定員<\/dt><dd>7人<\/dd>/.test(page), '会場SNB・「会費 4,000円／人」・「飲み物・軽食をご用意しています。」・「定員7人」を概要に表示');
// Issue #463：会費は「4,000円／人」。税込・固定・当日現金/PayPay・事前決済なし等の注記は付けない
const specs = page.slice(page.indexOf('class="ye-specs"'), page.indexOf('</dl>', page.indexOf('class="ye-specs"')));
const cardTxt = top.slice(top.indexOf('year-end-party-banner'), top.indexOf('year-end-party-banner') + 1500);
const metas = (page.match(/<meta[^>]*(?:description|og:title|twitter:title)[^>]*>/g) || []).join('');
assert(!/税込|固定|当日|PayPay|現金|事前決済|値上げ/.test(specs + cardTxt.replace(/<a[^>]*>[^<]*<\/a>/g, '') + metas), '概要・トップのカード・OGP/メタ説明の料金に注記（税込・固定・当日・PayPay・事前決済・値上げ）を付けない');
assert(/会費4,000円／人・定員7人/.test(cardTxt), 'トップのカードは「会費4,000円／人・定員7人」');
assert(!/3,000円/.test(page + top.slice(top.indexOf('year-end-party-banner'), top.indexOf('year-end-party-banner') + 1500)) && /会費4,000円／人/.test(metas) && !/"price": "3000"/.test(page) && /"price": "4000"/.test(page), '旧会費3,000円が残らず、メタ/OGP/Xカード/構造化データも4,000円で整合');
assert(/<dt>定員<\/dt><dd>7人<\/dd>/.test(page), '定員表記は「7人」のみ');
assert(!/主催者(を)?含/.test(page) && !/主催者(を)?含/.test(top.slice(top.indexOf('year-end-party-banner'), top.indexOf('year-end-party-banner') + 1500)), '公開ページ・OGP・フォーム・トップのカードに「主催者含む」の注記を出さない');
assert(/18歳以上/.test(text) && /ユニフォームを着用/.test(text), '参加条件（18歳以上・ユニフォーム着用）を簡潔に表示');
assert(/community-rules\.html#cancellation/.test(page) && /キャンセルは.*SNB規約に従います/.test(text), 'キャンセルはSNB規約に従う（参加条件の1か所のみ）');
assert(!/人数が変わっても|人数が減っても|値上げ|固定/.test(text + (page.match(/(?:alt|placeholder|content)="[^"]*"/g) || []).join('') + top.slice(top.indexOf('year-end-party-banner'), top.indexOf('year-end-party-banner') + 1500).replace(/<[^>]+>/g, '')), '「参加費は人数が変わっても3,000円のまま」等の固定・値上げ説明を特設ページ・フォーム・トップのカードに出さない');
assert((text.match(/4,000円/g) || []).length === 1 && !/3,000円/.test(text), '料金表示は「会費 4,000円／人」の1回のみ（旧3,000円なし）');
assert((text.match(/飲み物・軽食をご用意しています。/g) || []).length === 1, '「飲み物・軽食をご用意しています。」を本文に1回だけ表示（Issue #463）');
assert(/id="ye-age18"[^>]*required/.test(page), '18歳以上の確認が必須');
assert(/今年の締めくくりに、野球ユニで集まろう。好きなユニフォームで、気軽に楽しむ忘年会。/.test(text) && /野球好きもユニフォーム好きも歓迎/.test(text), '短い誘い文と「野球好きもユニフォーム好きも歓迎」');
assert(/12\/26（土）名古屋ユニ忘年会⚾/.test(page) && !/🍻/.test(page), '見出しに🍻を使わない');
assert(!/お酒付き|アルコール|酒類|飲み放題|飲食サービス|料理付き|食べ放題|ビール|ソフトドリンク|持ち寄り|ドリンク代/.test(page), '飲食営業を連想させる強い訴求（お酒付き・アルコール・酒類・飲み放題・飲食サービス・料理付き等）を追加しない（Issue #463）');
assert(!/カード決済|クレジット/.test(page), 'カード決済を要求しない');
assert(/お申し込み後、参加のご案内を個別にお送りします。/.test(text) && (text.match(/参加のご案内を個別にお送りします/g) || []).length === 1, 'CTA付近に「お申し込み後、参加のご案内を個別にお送りします」を一度だけ明記');
assert(/お申し込みを受け付けました。/.test(page) && /まだ参加確定ではありません/.test(page), '送信完了は「受け付けました」で、参加確定ではないと示す');
assert(!/参加が確定しました|自動承認|自動で参加確定/.test(page), '自動確定を示す文言がない');
// 対外コピーに強い表現・実装都合・内部運用を出さない
const publicText = text + (page.match(/(?:alt|placeholder|content)="[^"]*"/g) || []).join('');
assert(!/審査|選考|選別|承認|参加可否|判断/.test(publicText), '「審査・選考・選別・承認・参加可否の判断」など選別を連想させる表現を対外コピーに使わない');
assert(!/手動で更新|リアルタイム|自動集計|主催者が管理|合計で/.test(publicText), '実装都合・内部の定員管理の説明をLPに載せない');
assert(!/<details|ye-faq|id="flow"|id="faq"|id="notes"|id="about"/.test(page), '長いFAQ・当日の流れ・注意事項・イベント紹介セクションを置かない');
assert(text.length < 2600, 'LP本文が簡潔（' + text.length + '字）');
assert((text.match(/定員/g) || []).length <= 1 && (text.match(/4,000円/g) || []).length <= 3, '定員・参加費の同じ注意を何度も繰り返さない');
assert(/rel="canonical" href="https:\/\/nagoya-base\.github\.io\/snb-community\/community\/year-end-party-2026\/"/.test(page), 'canonicalが特設URL');
assert(/og:title/.test(page) && /og:image/.test(page) && /twitter:card/.test(page), 'OGP/Xカードがある');
assert(!/^---/.test(page), 'front matterが混入していない');
assert(!/paypay\.ne\.jp|PayPay ID|qr/i.test(page.replace(/PayPayでお支払い|現金またはPayPay/g, '')), 'PayPay受取情報・QRを公開リポジトリに含めない');
['年代', 'メールアドレス', 'Xアカウント', '希望する返信方法', 'ユニフォームの持参'].forEach((k) => assert(page.indexOf(k) !== -1, 'フォーム項目：' + k));
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
const card = top.slice(top.indexOf('year-end-party-banner'), top.indexOf('year-end-party-banner') + 1500);
assert(/year-end-party-2026\//.test(top) && /4,000円／人/.test(card) && /vol2_0725_baseball\.html/.test(top), 'community/ に忘年会カードがあり、過去アーカイブも維持');
assert((card.replace(/<[^>]+>/g, '').match(/飲み物・軽食をご用意しています。/g) || []).length === 1 && !/お酒付き|アルコール|酒類|飲み放題|飲食サービス|料理付き|ビール|持ち寄り/.test(card) && !/承認|審査|選考/.test(card), 'トップのカードに「飲み物・軽食をご用意しています。」を1回掲載し、強い飲食訴求・選別を連想させる表現なし');
assert(/@baseballuni2022/.test(card), 'トップのカードにもDM窓口を表示');
assert(/community\/year-end-party-2026\//.test(read('sitemap.xml')), 'sitemapに特設ページがある');
assert(/year_end_party_2026/.test(read('contact/index.html')), 'contactのevent labelに追加（既存mapは維持）');
assert(!/community-rules/.test(read('community/index.html').slice(0, 0)) && fs.readFileSync(path.join(root, 'legal', 'community-rules.html'), 'utf8').indexOf('キャンセルによる参加費の再計算') !== -1, '一般規約ファイルは変更しない（再計算の条文が残っている）');

// ── 画像（Hero=WebP / OGP=JPEG、正本は images/community/year-end-party-2026/） ──
const imgDir = path.join(root, 'images', 'community', 'year-end-party-2026');
const heroBuf = fs.readFileSync(path.join(imgDir, 'hero.webp'));
const ogpBuf = fs.readFileSync(path.join(imgDir, 'ogp.jpg'));
assert(heroBuf.slice(0, 4).toString() === 'RIFF' && heroBuf.slice(8, 12).toString() === 'WEBP', 'hero.webp は実ファイルとしてWebP');
assert(ogpBuf[0] === 0xff && ogpBuf[1] === 0xd8, 'ogp.jpg は実ファイルとしてJPEG');
function jpegSize(b) { let i = 2; while (i < b.length) { if (b[i] !== 0xff) { i++; continue; } const m = b[i + 1]; if (m >= 0xc0 && m <= 0xc3) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)]; i += 2 + b.readUInt16BE(i + 2); } }
assert(JSON.stringify(jpegSize(ogpBuf)) === '[1200,630]', 'ogp.jpg は1200x630');
assert(heroBuf.toString('latin1', 12, 16) === 'VP8 ' || heroBuf.toString('latin1', 12, 16) === 'VP8X' || heroBuf.toString('latin1', 12, 16) === 'VP8L', 'hero.webp のフォーマットが有効');
assert(!fs.existsSync(path.join(root, 'images', 'community', 'nagoya-uniform-yearend-2026-hero.jpg')) && !fs.existsSync(path.join(root, 'images', 'community', 'nagoya-uniform-yearend-2026-ogp.jpg')), '旧パスの重複画像を残さない');
const OGP_URL = 'https://nagoya-base.github.io/snb-community/images/community/year-end-party-2026/ogp.jpg';
assert(page.includes('property="og:image" content="' + OGP_URL + '"') && page.includes('name="twitter:image" content="' + OGP_URL + '"'), 'og:image / twitter:image がogp.jpgの公開絶対URL');
assert(/og:image:width" content="1200"/.test(page) && /og:image:height" content="630"/.test(page) && /og:image:alt/.test(page), 'og:image のwidth/height/altがある');
assert(/<img src="\.\.\/\.\.\/images\/community\/year-end-party-2026\/hero\.webp"[^>]*width="1600" height="900"[^>]*fetchpriority="high"/.test(page), 'Heroはhero.webp・寸法指定・高優先度');
assert(/class="ye-h1"/.test(page) && /\.ye-h1[^}]*clip/.test(read('community/year-end-party-2026/style.css')), '画像内の文字と重複するh1は視覚的に隠す（構造は維持）');
assert(!/object-fit:\s*cover/.test(read('community/year-end-party-2026/style.css')), 'Heroにobject-fit: coverを使わない（スマホで顔・文字が切れない）');
assert(/images\/community\/year-end-party-2026\/hero\.webp/.test(top) && /loading="lazy"/.test(top.slice(top.indexOf('year-end-party-banner'), top.indexOf('year-end-party-banner') + 900)), 'トップのカードは同じ正本を遅延読込で参照');
assert(!/飲食|飲み物|食べ物|持ち寄り|ビール|ソフトドリンク/.test(page.match(/<img[^>]*alt="[^"]*"/g).join('')), '画像altに飲食を書かない');

// 方針訂正：GAS・スプレッドシート等の管理基盤は作らない
assert(!fs.existsSync(path.join(root, 'community', 'gas', 'year_end_party_2026_backend.gs')), 'GASバックエンドが存在しない');
assert(!/script\.google\.com|PropertiesService|spreadsheet/i.test(page), 'ページがGAS・スプレッドシートを参照しない');
const contactEndpoint = read('contact/index.html').match(/FORM_ENDPOINT = '([^']+)'/)[1];
const pageEndpoint = page.match(/FORM_ENDPOINT = '([^']+)'/)[1];
assert(contactEndpoint === pageEndpoint && /^https:\/\/formsubmit\.co\/ajax\//.test(pageEndpoint), '既存contactフォームと同じFormSubmit送信先を再利用（新しい宛先を作らない）');
assert(/name="イベント名" value="12\/26（土）名古屋ユニ忘年会"/.test(page) && /name="開催日時" value="2026年12月26日（土）17:00開場／18:00開始〜21:00終了"/.test(page) && /name="イベントID" value="year-end-party-2026"/.test(page), 'イベント名・日時・IDが固定のhiddenで送信される（手入力不要）');
assert(/name="_honey"/.test(page) && /name="_captcha" value="false"/.test(page) && /name="_template" value="table"/.test(page), 'FormSubmit設定（honeypot・template）が既存と同じ');
assert(/var ENTRY_STATUS = 'full';/.test(page), '受付状況はENTRY_STATUSで手動切替（現在はfull＝キャンセル待ち受付中／Issue #461）');

// ── ブラウザ挙動（jsdom） ──
function loadPage(status, fetchImpl) {
  let html = page.replace(/<script async src="https:\/\/www\.googletagmanager[^>]*><\/script>/, '').replace(/<script src="\.\.\/\.\.\/analytics\.js"><\/script>/, '');
  /* status: 省略(null)=open（従来の通常受付の挙動検証）／'prod'=公開中の実コードのまま／それ以外=指定値に差し替え */
  const st = status === null || status === undefined ? 'open' : status;
  if (st !== 'prod') html = html.replace(/var ENTRY_STATUS = '[^']*';/, "var ENTRY_STATUS = '" + st + "';");
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
  d.getElementById('ye-age18').checked = true;
  d.getElementById('ye-email').dispatchEvent(new w.Event('input'));
  d.getElementById('ye-carrier-ack').checked = true;
  if (over) over(d);
}
const submit = (w) => w.document.getElementById('ye-form').dispatchEvent(new w.Event('submit', { cancelable: true }));

(async () => {
  // 受付中→送信成功→受付完了表示（参加確定とは表示しない）／二重送信は1回だけ
  const calls = [];
  let w = loadPage(null, (url, opt) => { calls.push({ url, opt }); return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: 'true' }) }); });
  assert(!w.document.getElementById('ye-submit').disabled && /受付中/.test(w.document.getElementById('ye-status').textContent), 'ENTRY_STATUS=open で申し込み可能表示');
  fill(w);
  submit(w); submit(w);
  await tick();
  assert(calls.length === 1 && calls[0].url === pageEndpoint, '二重送信しても送信は1回だけ（FormSubmit宛て）');
  const fd = calls[0].opt.body;
  assert(fd.get('イベント名') === '12/26（土）名古屋ユニ忘年会' && fd.get('開催日時').indexOf('17:00開場') !== -1 && fd.get('イベントID') === 'year-end-party-2026', '送信内容にイベント名・日時・IDが含まれる');
  assert(fd.get('お名前') === 'テスト太郎' && fd.get('年代') === '30代' && fd.get('メールアドレス') === 'a@example.com' && fd.get('希望する返信方法') === 'メール' && fd.get('野球ユニフォームの持参') === '持参できる' && fd.get('同意事項') === '同意する', '入力項目が日本語ラベルでメールに載る');
  assert(!w.document.getElementById('ye-success').hidden && /参加のご案内は、主催者から個別にお送りします/.test(w.document.getElementById('ye-success').textContent), '送信後は受付完了（個別にご案内・参加確定ではない）を表示');
  submit(w); await tick();
  assert(calls.length === 1, '成功後の再送信は行われない');

  // 申し込み窓口は2つ：フォーム／XのDM（受付状態に連動）
  {
    const d = new JSDOM(page).window.document;
    const f = d.getElementById('ye-cta-form'); const x = d.getElementById('ye-cta-dm');
    assert(f && x && /フォームで申し込む/.test(f.textContent) && /XのDMで申し込む/.test(x.textContent) && /@baseballuni2022/.test(x.textContent) && f.parentNode === x.parentNode, '「フォームで申し込む」「XのDMで申し込む（@baseballuni2022）」が並列のCTAとして並ぶ');
    assert(f.getAttribute('href') === '#apply-form' && d.getElementById('apply-form'), 'フォームCTAはフォーム見出しへ誘導');
    assert(x.getAttribute('href') === 'https://x.com/baseballuni2022' && x.getAttribute('target') === '_blank' && /noopener/.test(x.getAttribute('rel')), 'DM CTAはXプロフィール（https://x.com/baseballuni2022）を新規タブで開く');
    assert(!/intent\/|messages\/compose/.test(page), 'DMのディープリンクは使わない（プロフィールへ確実に遷移）');
    const guide = d.getElementById('ye-dm-guide').textContent;
    assert(/DMを送信すると申し込み完了/.test(guide), 'DMを送信して初めて申し込み完了（リンクを押しただけでは完了しない）');
    ['お名前', '年代', 'ユニフォームの有無', 'ひとこと'].forEach((k) => assert(guide.indexOf(k) !== -1, 'DM案内に必要項目：' + k));
    assert(!/フォーム.{0,6}(入力|再入力)/.test(guide), 'DM申し込みにフォーム入力を強制しない');
    assert(guide.length < 160, 'DM案内は短い（' + guide.length + '字）');
  }
  for (const [st, statusRe, ctaOpen, formLabel, dmLabel] of [['open', /^受付中$/, true, /フォームで申し込む/, /XのDMで申し込む/], ['full', /^キャンセル待ち受付中（フォーム・DM共通）$/, true, /フォームでキャンセル待ち/, /XのDMでキャンセル待ち/], ['closed', /受付は終了.*フォーム・DM共通/, false, null, null], ['cancelled', /開催中止/, false, null, null], ['bogus', /受付は終了/, false, null, null]]) {
    const ww = loadPage(st);
    const d = ww.document;
    const dm = d.getElementById('ye-cta-dm'); const fm = d.getElementById('ye-cta-form');
    assert(statusRe.test(d.getElementById('ye-status').textContent.trim()), st + '：受付状況の表示（フォーム・DM共通の1か所）');
    if (ctaOpen) assert(dm.getAttribute('href') === 'https://x.com/baseballuni2022' && fm.getAttribute('href') === '#apply-form' && formLabel.test(fm.textContent) && dmLabel.test(dm.textContent) && !d.getElementById('ye-dm-guide').hidden, st + '：フォームとDMの導線が有効で文言が一致');
    else assert(!dm.hasAttribute('href') && !fm.hasAttribute('href') && dm.getAttribute('aria-disabled') === 'true' && fm.getAttribute('aria-disabled') === 'true' && d.getElementById('ye-dm-guide').hidden, st + '：フォームとDMの導線がともに無効（矛盾なし）');
  }

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

  // 公開中の実コード（Issue #461：受付中→キャンセル待ち受付中）
  {
    const prodCalls = [];
    const wp = loadPage('prod', (u, o) => { prodCalls.push(o); return Promise.resolve({ ok: true, json: () => Promise.resolve({}) }); });
    const dp = wp.document;
    const st = dp.getElementById('ye-status').textContent;
    assert(/キャンセル待ち受付中/.test(st) && !/受付中$/.test(st.replace('キャンセル待ち受付中', '')) && !/^受付中/.test(st) && st.length < 40, '公開状態：「キャンセル待ち受付中」と簡潔に表示（単独の「受付中」ではない）');
    assert(!/定員に達しました/.test(dp.body.textContent), '公開状態：長い定員説明を出さない');
    assert(/フォームでキャンセル待ち/.test(dp.getElementById('ye-cta-form').textContent) && /XのDMでキャンセル待ち/.test(dp.getElementById('ye-cta-dm').textContent) && dp.getElementById('ye-cta-dm').getAttribute('href') === 'https://x.com/baseballuni2022' && dp.getElementById('ye-cta-form').getAttribute('href') === '#apply-form', '公開状態：フォーム・X DM（@baseballuni2022）ともキャンセル待ちのCTAで有効');
    assert(!dp.getElementById('ye-submit').disabled && /キャンセル待ちで申し込む/.test(dp.getElementById('ye-submit').textContent), '公開状態：フォームは閉鎖されず送信可能');
    fill(wp); submit(wp); await tick();
    assert(prodCalls.length === 1 && prodCalls[0].body.get('応募区分') === 'キャンセル待ち', '公開状態：送信すると応募区分が「キャンセル待ち」になる');
    assert(dp.getElementById('ye-status').getAttribute('data-state') === 'full' && /data-state="full"/.test(page), '公開状態：data-state=full');
    const tcard = top.slice(top.indexOf('year-end-party-banner'), top.indexOf('year-end-party-banner') + 1500).replace(/<[^>]+>/g, '');
    assert(/キャンセル待ち受付中/.test(tcard) && !/(^|[^待ち])受付中/.test(tcard.replace(/キャンセル待ち受付中/g, '')) && /@baseballuni2022/.test(tcard), 'community/ のカードもキャンセル待ち受付中で整合（「受付中」単独表記なし）');
    assert(!/(^|[^ち])受付中/.test(text.replace(/キャンセル待ち受付中/g, '')), '特設ページ本文に単独の「受付中」がない');
  }

  // 定員到達（full）：キャンセル待ちとして受け付ける。受付終了／開催中止／不正値は送信不可
  {
    let fc = [];
    const wf = loadPage('full', (u, o) => { fc.push(o); return Promise.resolve({ ok: true, json: () => Promise.resolve({}) }); });
    assert(!wf.document.getElementById('ye-submit').disabled && /キャンセル待ち/.test(wf.document.getElementById('ye-status').textContent) && /キャンセル待ちで申し込む/.test(wf.document.getElementById('ye-submit').textContent), 'full：キャンセル待ちとして応募可能な表示');
    fill(wf); submit(wf); await tick();
    assert(fc.length === 1 && fc[0].body.get('応募区分') === 'キャンセル待ち', 'full：応募区分「キャンセル待ち」がメールに載る');
  }
  assert(calls[0].opt.body.get('応募区分') === '通常応募' && calls[0].opt.body.get('18歳以上の確認') === '18歳以上です', 'open：応募区分は通常応募・18歳以上の確認も送信');
  [['closed', /受付は終了/], ['cancelled', /開催中止/], ['bogus', /受付は終了/]].forEach(([st, re]) => {
    let n = 0;
    const ww = loadPage(st, () => { n++; return Promise.resolve({ ok: true, json: () => Promise.resolve({}) }); });
    fill(ww); submit(ww);
    assert(ww.document.getElementById('ye-submit').disabled && re.test(ww.document.getElementById('ye-status').textContent) && n === 0, st + '：フォーム無効・状態表示・送信されない');
  });

  // 18歳以上の確認が無ければ送信されない
  {
    let n18 = 0;
    const w18 = loadPage(null, () => { n18++; return Promise.resolve({ ok: true, json: () => Promise.resolve({}) }); });
    fill(w18, (d) => { d.getElementById('ye-age18').checked = false; });
    submit(w18); await tick();
    assert(n18 === 0, '18歳以上の確認が無ければ送信されない');
  }

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
