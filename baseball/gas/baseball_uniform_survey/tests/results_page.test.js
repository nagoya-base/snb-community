'use strict';
// 公開結果ページ（Issue #382）：snapshot だけを読む静的ページ。jsdom で描画を検証する。実Googleへは接続しない。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { schema, core, aggregate, clone, validFrom, snapshotOf, entryOf } = require('./helpers/fixtures');
const { renderInitial, SNAPSHOT_PATH } = require('../tools/build-initial-snapshot');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const SITE = 'https://nagoya-base.github.io/snb-community/';
const PAGE = 'baseball/baseball-uniform-survey-results.html';
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
const resultsJs = read('baseball/baseball-uniform-survey-results/results.js');
const INTERESTED = { club_awareness: 'aware_not_attended', catchball_interest: 'very_interested' };
const ATTENDEE = { club_awareness: 'attended', last_attended: 'within_3m' };

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** snapshot を fetch の応答として結果ページを開く。fetch した URL を calls に残す。 */
async function openResults(snapshot, fetchImpl) {
  const calls = [];
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => errors.push(e));
  const dom = new JSDOM(read(PAGE).replace(/<script src="[^"]*results\.js"><\/script>/, ''), {
    url: SITE + PAGE,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole
  });
  const { window } = dom;
  window.fetch = (url) => {
    calls.push(String(url));
    if (fetchImpl) return fetchImpl(url);
    return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(JSON.stringify(snapshot))) });
  };
  window.eval(resultsJs);
  for (let i = 0; i < 6; i++) await tick();
  return { window, document: window.document, calls, errors, text: () => window.document.getElementById('bur-app').textContent };
}

const ten = () => validFrom([{ count: 10 }]);
const rich = () => validFrom([
  { count: 25, overrides: Object.assign({}, ATTENDEE, { overall_satisfaction: '5' }) },
  { count: 20, overrides: Object.assign({}, INTERESTED, { favorite_uniforms: ['baseball'] }) }
]);

test('結果ページは snapshot.json だけを読み、Spreadsheet・Public GAS・個別 API に接続しない', async () => {
  const env = await openResults(snapshotOf(rich()));
  assert.deepEqual(env.calls, ['baseball-uniform-survey-results/snapshot.json']);
  assert.deepEqual(env.errors, []);
  const html = read(PAGE);
  assert.ok(!/script\.google\.com|googleusercontent|docs\.google\.com|config\.js|survey\.generated\.js|app\.js/.test(html + resultsJs));
  assert.ok(!/POST|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|document\.cookie|innerHTML|insertAdjacentHTML|eval\(/.test(resultsJs.replace(/\/\*[\s\S]*?\*\//g, '')), 'DOM は textContent だけで書く');
});

test('ページは「任意回答で代表性なし」「小さい集計群は非表示」「自由記述・詳細地域は非公開」を明記する', () => {
  const html = read(PAGE);
  const text = new JSDOM(html).window.document.body.textContent;
  assert.match(text, /SNS・Web等で募った任意回答/);
  assert.match(text, /一般人口全体を代表する統計ではありません/);
  assert.match(text, /小さな集計群は[^。]*非表示/);
  assert.match(text, /自由記述・詳細な居住地域[^。]*公開しません/);
  assert.match(html, /<meta name="robots" content="noindex">/);
});

test('2 層構造：現在の回答状況 → アンケート結果。公開設問だけを snapshot（= schema の publicResultsOrder）の順で出す', async () => {
  const snapshot = snapshotOf(rich());
  const env = await openResults(snapshot);
  const layers = Array.from(env.document.querySelectorAll('.bur-layer'));
  assert.deepEqual(layers.map((l) => l.querySelector('h2').textContent), ['現在の回答状況', 'アンケート結果']);
  assert.deepEqual(layers.map((l) => l.getAttribute('data-section')), ['response_status', 'survey_results']);
  const titles = layers.flatMap((l) => Array.from(l.querySelectorAll('h3')).map((h) => h.textContent));
  const expected = ['response_status', 'survey_results'].flatMap((section) => snapshot.questions.filter((q) => q.section === section && q.state === 'published').map((q) => q.label));
  assert.ok(expected.length > 0);
  assert.deepEqual(titles, expected);
  const order = snapshot.questions.map((q) => q.label);
  layers.forEach((l) => {
    const idx = Array.from(l.querySelectorAll('h3')).map((h) => order.indexOf(h.textContent));
    assert.deepEqual(idx, idx.slice().sort((a, b) => a - b));
  });
});

test('回答件数：10件未満は「回答受付中」で数値なし、10件以上は10件単位の切り下げ表示', async () => {
  const few = await openResults(snapshotOf(validFrom([{ count: 7 }])));
  assert.equal(few.document.querySelector('.bur-status').textContent, '回答受付中');
  assert.ok(!/\b7\b/.test(few.document.querySelector('.bur-status').textContent));
  const many = await openResults(snapshotOf(validFrom([{ count: 37 }])));
  assert.equal(many.document.querySelector('.bur-status').textContent, '回答数：30件以上');
  // 設問ごとの対象者数の表示も 10 人単位に切り下げる（正確な総数を見出しや対象者数に出さない）。
  const bases = Array.from(many.document.querySelectorAll('.bur-base')).map((n) => n.textContent);
  assert.ok(bases.length > 0);
  bases.forEach((t) => { assert.match(t, /30人以上/); assert.ok(!t.includes('37')); });
});

test('未公開設問（insufficient / sensitive_withheld / suppressed_all / 未知 state）のカードは存在自体を出さない', async () => {
  const snapshot = snapshotOf(validFrom([{ count: 19, overrides: ATTENDEE }, { count: 15, overrides: INTERESTED }]));
  assert.equal(entryOf(snapshot, 'overall_satisfaction').state, 'sensitive_withheld');
  const env = await openResults(snapshot);
  const titles = Array.from(env.document.querySelectorAll('.bur-card h3')).map((h) => h.textContent);
  assert.ok(!titles.includes(core.getQuestion(schema, 'overall_satisfaction').label));
  assert.equal(env.document.querySelectorAll('.bur-card').length, snapshot.questions.filter((q) => q.state === 'published').length);
  env.document.querySelectorAll('.bur-card').forEach((c) => assert.equal(c.getAttribute('data-state'), 'published'));
  assert.equal(env.document.querySelectorAll('.bur-msg').length, 0);
  assert.ok(!/公開していません|十分な回答数が集まった場合のみ|少数の集計群に分かれている/.test(env.text()));
  assert.deepEqual(env.errors, []);
  const mutated = clone(snapshot);
  ['suppressed_all', 'something_new', 'insufficient'].forEach((state, i) => { mutated.questions[i].state = state; });
  const env2 = await openResults(mutated);
  const titles2 = Array.from(env2.document.querySelectorAll('.bur-card h3')).map((h) => h.textContent);
  [0, 1, 2].forEach((i) => assert.ok(!titles2.includes(mutated.questions[i].label)));
});

test('回答数が閾値未満の初期状態：設問カードは 0 件。公開設問のないセクションは見出しごと出さず、例外は response_status（回答受付中 / 回答数表示）だけ', async () => {
  const snapshot = snapshotOf(validFrom([{ count: 7 }]));
  assert.ok(snapshot.questions.every((q) => q.state !== 'published'));
  const env = await openResults(snapshot);
  assert.equal(env.document.querySelectorAll('.bur-card').length, 0);
  assert.deepEqual(Array.from(env.document.querySelectorAll('.bur-layer > h2')).map((h) => h.textContent), ['現在の回答状況']);
  assert.equal(env.document.querySelector('.bur-status').textContent, '回答受付中');
  assert.ok(!env.text().includes('アンケート結果'));
  assert.deepEqual(env.errors, []);
  // 公開済みの設問が増えたセクションから順次現れる。
  const grown = await openResults(snapshotOf(rich()));
  assert.ok(grown.document.querySelectorAll('.bur-card').length > 0);
  assert.ok(grown.document.querySelector('[data-section="survey_results"]'));
});

test('公開項目は件数と割合を表示し、隠したセルは「非公開（少数）」として位置だけ残す', async () => {
  const valid = validFrom([
    { count: 20, overrides: { baseball_experience: 'team' } },
    { count: 2, overrides: { baseball_experience: 'grass_baseball' } },
    { count: 8, overrides: { baseball_experience: 'catchball_only' } }
  ]);
  const env = await openResults(snapshotOf(valid));
  const card = Array.from(env.document.querySelectorAll('.bur-card')).find((c) => c.querySelector('h3').textContent === core.getQuestion(schema, 'baseball_experience').label);
  const items = Array.from(card.querySelectorAll('.bur-cells > li'));
  assert.equal(items.length, 5);
  assert.match(items[0].textContent, /20人（67%）/);
  assert.match(items[1].textContent, /非公開（少数）/);
  assert.ok(items[1].classList.contains('bur-cell-hidden'));
  assert.ok(!/\b2人/.test(items[1].textContent));
  assert.match(card.textContent, /個人が推測されないよう非表示/);
  assert.equal(items[0].querySelector('.bur-bar i').style.width, '67%');
  assert.match(card.querySelector('.bur-base').textContent, /30人以上/);
});

test('snapshot が取得できない・壊れているときは、空白にせず案内を出す', async () => {
  const failing = await openResults(null, () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }));
  assert.match(failing.text(), /結果を読み込めませんでした/);
  const rejected = await openResults(null, () => Promise.reject(new Error('network')));
  assert.match(rejected.text(), /結果を読み込めませんでした/);
  const broken = await openResults({ nothing: true });
  assert.match(broken.text(), /結果を読み込めませんでした/);
});

test('文言は textContent で描画する（snapshot 内の HTML は解釈しない）', async () => {
  const snapshot = clone(snapshotOf(rich()));
  const published = snapshot.questions.find((q) => q.state === 'published');
  published.label = '<img src=x onerror=alert(1)>';
  const env = await openResults(snapshot);
  assert.equal(env.document.querySelectorAll('#bur-app img').length, 0);
  assert.ok(env.text().includes('<img src=x onerror=alert(1)>'));
});

test('リポジトリに置いた snapshot.json は schema と整合し、privacy-safe で、回答 0 件の初期状態', () => {
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
  assert.deepEqual(aggregate.validateSnapshot(schema, snapshot), []);
  assert.deepEqual(snapshot.questions.map((q) => q.id), schema.publicResultsOrder);
  // 初期 snapshot は公開すべき実データを持たない（生成器の出力と構造が一致する）。
  const generated = JSON.parse(renderInitial(new Date(snapshot.generated_at)));
  assert.deepEqual(snapshot, generated);
  const text = fs.readFileSync(SNAPSHOT_PATH, 'utf8');
  assert.ok(!/respondent_hash|pref_\d\d|feedback|support_message|other_texts/.test(text));
});

test('Frontend の RESULTS_URL は存在する結果ページを指し、本番の完了画面にだけリンクを出す', () => {
  const app = read('baseball/baseball-uniform-survey/app.js');
  const match = /var RESULTS_URL = '([^']+)'/.exec(app);
  assert.ok(match, 'RESULTS_URL が設定されている');
  assert.equal(path.posix.join('baseball', match[1]), PAGE);
  assert.ok(fs.existsSync(path.join(REPO, PAGE)));
  assert.ok(fs.existsSync(path.join(REPO, 'baseball/baseball-uniform-survey-results/snapshot.json')));
  assert.match(read(PAGE), /baseball-uniform-survey-results\/results\.js/);
});

test('結果ページ資産に実回答・Spreadsheet export・secret を置かない', () => {
  const dir = path.join(REPO, 'baseball', 'baseball-uniform-survey-results');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['results.css', 'results.js', 'snapshot.json']);
  const all = fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n') + read(PAGE);
  assert.ok(!/RESPONDENT_SALT|TEST_TOKEN|NOTIFICATION_EMAIL|SPREADSHEET_ID|RESPONSES_SPREADSHEET_ID|@[a-z0-9-]+\.(com|jp)/i.test(all));
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(all));
});

test('結果ページ：「アンケートに回答する」主CTA、アンケート本体と同一のヒーロー、OGP / Twitter Card', () => {
  const doc = new JSDOM(read(PAGE)).window.document;
  const cta = doc.querySelector('a.bur-answer-cta');
  assert.ok(cta);
  assert.equal(cta.textContent, 'アンケートに回答する');
  assert.equal(cta.getAttribute('href'), 'baseball-uniform-survey.html');
  assert.ok(fs.existsSync(path.join(REPO, 'baseball', cta.getAttribute('href'))));
  const survey = new JSDOM(read('baseball/baseball-uniform-survey.html')).window.document;
  assert.equal(doc.querySelector('.bur-hero source').getAttribute('srcset'), '../images/baseball/catchball/survey-hero.webp');
  assert.equal(doc.querySelector('.bur-hero source').getAttribute('type'), 'image/webp');
  const img = doc.querySelector('.bur-hero img');
  assert.equal(img.getAttribute('src'), '../images/baseball/catchball/survey-ogp.jpg');
  assert.equal(img.getAttribute('src'), survey.querySelector('.bus-hero img').getAttribute('src'));
  assert.equal(img.getAttribute('alt'), survey.querySelector('.bus-hero img').getAttribute('alt'));
  assert.equal(img.getAttribute('width'), '1200');
  assert.equal(img.getAttribute('height'), '630');
  ['images/baseball/catchball/survey-hero.webp', 'images/baseball/catchball/survey-ogp.jpg'].forEach((f) => assert.ok(fs.existsSync(path.join(REPO, f)), f));
  assert.equal(doc.querySelector('h1').textContent, '名古屋野球ユニ部アンケート 結果');
  const IMG = SITE + 'images/baseball/catchball/survey-ogp.jpg';
  const meta = (attr, key) => { const n = doc.querySelector(`meta[${attr}="${key}"]`); return n && n.getAttribute('content'); };
  assert.equal(meta('property', 'og:type'), 'website');
  assert.equal(meta('property', 'og:title'), '名古屋野球ユニ部アンケート 結果｜SNBC');
  assert.equal(meta('property', 'og:description'), '名古屋野球ユニ部アンケートの現在の回答状況と集計結果。回答数が十分に集まった項目から順に公開します。');
  assert.equal(meta('property', 'og:url'), SITE + PAGE);
  assert.equal(meta('property', 'og:image'), IMG);
  assert.equal(meta('property', 'og:image:width'), '1200');
  assert.equal(meta('property', 'og:image:height'), '630');
  assert.equal(meta('property', 'og:image:alt'), img.getAttribute('alt'));
  assert.equal(meta('name', 'twitter:card'), 'summary_large_image');
  assert.equal(meta('name', 'twitter:image'), IMG);
});

test('アンケート回答ページ：「結果を見る」セカンダリーCTAが結果ページへ遷移でき、モバイル幅で横にはみ出さない', () => {
  const doc = new JSDOM(read('baseball/baseball-uniform-survey.html')).window.document;
  const cta = doc.querySelector('a.bus-results-cta');
  assert.ok(cta);
  assert.equal(cta.textContent, '結果を見る');
  assert.equal(cta.getAttribute('href'), 'baseball-uniform-survey-results.html');
  assert.ok(fs.existsSync(path.join(REPO, 'baseball', cta.getAttribute('href'))));
  // 主ボタン（.bus-btn）ではなくアウトラインのセカンダリー。
  assert.ok(!cta.classList.contains('bus-btn'));
  const surveyCss = read('baseball/baseball-uniform-survey/styles.css');
  assert.match(surveyCss, /\.bus-results-cta\s*\{[^}]*max-width:\s*100%[^}]*background:\s*#fff/);
  const resultsCss = read('baseball/baseball-uniform-survey-results/results.css');
  assert.match(resultsCss, /\.bur-answer-cta\s*\{[^}]*max-width:\s*100%[^}]*background:\s*var\(--bur-accent\)/);
  assert.match(resultsCss, /\.bur-hero-image img\s*\{[^}]*width:\s*100%;\s*height:\s*auto/);
});
