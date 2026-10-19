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

test('2 層構造：現在の回答状況 → アンケート結果。順序は snapshot（= schema の publicResultsOrder）のまま', async () => {
  const snapshot = snapshotOf(rich());
  const env = await openResults(snapshot);
  const layers = Array.from(env.document.querySelectorAll('.bur-layer'));
  assert.deepEqual(layers.map((l) => l.querySelector('h2').textContent), ['現在の回答状況', 'アンケート結果']);
  assert.deepEqual(layers.map((l) => l.getAttribute('data-section')), ['response_status', 'survey_results']);
  const titles = layers.flatMap((l) => Array.from(l.querySelectorAll('h3')).map((h) => h.textContent));
  const expected = ['response_status', 'survey_results'].flatMap((section) => snapshot.questions.filter((q) => q.section === section).map((q) => q.label));
  assert.deepEqual(titles, expected);
  // 設問は publicResultsOrder の順（layer をまたいでも相対順は保つ）。
  const order = snapshot.questions.map((q) => q.label);
  const idx = titles.map((t) => order.indexOf(t));
  const first = idx.slice(0, layers[0].querySelectorAll('h3').length);
  const second = idx.slice(first.length);
  assert.deepEqual(first, first.slice().sort((a, b) => a - b));
  assert.deepEqual(second, second.slice().sort((a, b) => a - b));
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

test('sensitive branch が minTarget 未満でも空白・エラーにせず、説明を出す', async () => {
  const snapshot = snapshotOf(validFrom([{ count: 19, overrides: ATTENDEE }, { count: 15, overrides: INTERESTED }]));
  assert.equal(entryOf(snapshot, 'overall_satisfaction').state, 'sensitive_withheld');
  const env = await openResults(snapshot);
  const card = Array.from(env.document.querySelectorAll('.bur-card')).find((c) => c.querySelector('h3').textContent === core.getQuestion(schema, 'overall_satisfaction').label);
  assert.ok(card);
  assert.equal(card.querySelector('.bur-msg').textContent, 'この項目は、十分な回答数が集まった場合のみ公開します。');
  assert.equal(card.getAttribute('data-state'), 'sensitive_withheld');
  assert.ok(!card.querySelector('.bur-cells'));
  assert.ok(!/error|エラー|読み込めません/.test(card.textContent));
  assert.deepEqual(env.errors, []);
});

test('回答数不足・少数セルのみの項目は安全な説明を出し、数値を出さない', async () => {
  const snapshot = snapshotOf(ten());
  const env = await openResults(snapshot);
  const cards = Array.from(env.document.querySelectorAll('.bur-card'));
  assert.equal(cards.length, snapshot.questions.length);
  const insufficient = cards.filter((c) => c.getAttribute('data-state') === 'insufficient');
  assert.ok(insufficient.length > 10);
  insufficient.forEach((c) => assert.match(c.querySelector('.bur-msg').textContent, /回答数がまだ十分でないため公開していません/));
  const fabricated = clone(snapshot);
  fabricated.questions[0].state = 'something_new';
  const unknown = await openResults(fabricated);
  assert.match(unknown.document.querySelector('.bur-card .bur-msg').textContent, /公開していません/);
  const suppressed = clone(snapshot);
  suppressed.questions[0].state = 'suppressed_all';
  const sup = await openResults(suppressed);
  assert.match(sup.document.querySelector('.bur-card .bur-msg').textContent, /少数の集計群/);
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
  snapshot.questions[1].label = '<img src=x onerror=alert(1)>';
  const env = await openResults(snapshot);
  assert.equal(env.document.querySelectorAll('img').length, 0);
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
