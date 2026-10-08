'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const SCHEMA = require('../survey.schema.json');
const { openPage, settle, next } = require('./helpers/dom');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const SITE = 'https://nagoya-base.github.io/snb-community/';
const IMG_DIR = 'images/community/costume-portrait-survey/';
const HERO = IMG_DIR + 'hero-main.webp';
const OGP = IMG_DIR + 'meta-ogp-main.jpg';
const PAGES = {
  survey: 'community/costume-portrait-survey.html',
  results: 'community/costume-portrait-survey-results.html'
};
const doc = (page) => new JSDOM(fs.readFileSync(path.join(REPO, page), 'utf8')).window.document;
const meta = (d, sel) => { const m = d.querySelector(sel); return m ? m.getAttribute('content') : null; };
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

function dimensions(file) {
  const b = fs.readFileSync(path.join(REPO, file));
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const fmt = b.toString('ascii', 12, 16);
    if (fmt === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (fmt === 'VP8L') { const v = b.readUInt32LE(21); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }; }
    if (fmt === 'VP8X') return { w: b.readUIntLE(24, 3) + 1, h: b.readUIntLE(27, 3) + 1 };
  }
  let i = 2; // JPEG
  while (i < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + b.readUInt16BE(i + 2);
  }
  throw new Error('unknown image: ' + file);
}

for (const [name, page] of Object.entries(PAGES)) {
  test(`${name}: heroはHTMLに1つだけ固定され、共通の構造（back → hero(img/h1/sub) ）を持つ`, () => {
    const d = doc(page);
    assert.strictEqual(d.querySelectorAll('.cp-hero').length, 1);
    const wrap = d.querySelector('.cp-wrap');
    const kids = Array.from(wrap.children);
    assert.strictEqual(kids[0].className, 'cp-back');
    assert.strictEqual(kids[1].className, 'cp-hero');
    assert.deepStrictEqual(Array.from(kids[1].children).map((e) => e.tagName + '.' + e.className),
      ['IMG.cp-hero-img', 'H1.', 'P.cp-sub']);
    assert.strictEqual(d.querySelectorAll('h1').length, 1);
  });

  test(`${name}: hero画像の参照先・実寸一致のwidth/height・altがある`, () => {
    const img = doc(page).querySelector('.cp-hero-img');
    assert.strictEqual(img.getAttribute('src'), '../' + HERO);
    assert.ok(fs.existsSync(path.join(REPO, HERO)));
    const { w, h } = dimensions(HERO);
    assert.strictEqual(img.getAttribute('width'), String(w));
    assert.strictEqual(img.getAttribute('height'), String(h));
    assert.ok((img.getAttribute('alt') || '').length > 10);
  });

  test(`${name}: OGP / twitter card（画像・寸法・alt）`, () => {
    const d = doc(page);
    const url = SITE + OGP;
    assert.ok(fs.existsSync(path.join(REPO, OGP)));
    const { w, h } = dimensions(OGP);
    assert.deepStrictEqual([w, h], [1200, 630]);
    assert.strictEqual(meta(d, 'meta[property="og:type"]'), 'website');
    assert.strictEqual(meta(d, 'meta[property="og:image"]'), url);
    assert.strictEqual(meta(d, 'meta[property="og:image:width"]'), '1200');
    assert.strictEqual(meta(d, 'meta[property="og:image:height"]'), '630');
    assert.ok(meta(d, 'meta[property="og:image:alt"]'));
    assert.strictEqual(meta(d, 'meta[name="twitter:card"]'), 'summary_large_image');
    assert.strictEqual(meta(d, 'meta[name="twitter:image"]'), url);
    assert.ok(meta(d, 'meta[name="twitter:image:alt"]'));
    assert.strictEqual(meta(d, 'meta[property="og:url"]'), SITE + page);
    assert.strictEqual(meta(d, 'meta[property="og:title"]'), d.title);
    assert.strictEqual(meta(d, 'meta[property="og:description"]'), meta(d, 'meta[name="description"]'));
  });

  test(`${name}: 公開済みのため noindex を含まない`, () => {
    assert.strictEqual(doc(page).querySelector('meta[name="robots"]'), null);
  });
}

test('hero: 見出し・サブタイトルは schema と一致（results はサブタイトル末尾に「｜公開結果」）', () => {
  const s = doc(PAGES.survey), r = doc(PAGES.results);
  assert.strictEqual(s.querySelector('.cp-hero h1').textContent, SCHEMA.title);
  assert.strictEqual(r.querySelector('.cp-hero h1').textContent, SCHEMA.title);
  assert.strictEqual(s.querySelector('.cp-sub').textContent, SCHEMA.subtitle);
  assert.strictEqual(r.querySelector('.cp-sub').textContent, SCHEMA.subtitle + '｜公開結果');
});

test('title / description', () => {
  const s = doc(PAGES.survey), r = doc(PAGES.results);
  assert.strictEqual(s.title, 'ユニ・スーツ・衣装で、撮ってもらいたい？撮りたい？｜男性の衣装・ポートレート意識調査｜SNBコミュニティ');
  assert.strictEqual(r.title, '男性の衣装・ポートレート意識調査｜公開結果｜SNBコミュニティ');
  const d = meta(s, 'meta[name="description"]');
  for (const w of ['スポーツユニフォーム', '学生服・学校制服', 'スーツ', '18歳以上']) assert.ok(d.includes(w), w);
});

test('app.js は hero を動的生成しない（shell は動的領域の初期化のみ）', () => {
  const js = read('community/costume-portrait-survey/app.js');
  assert.ok(!/cp-hero/.test(js));
  assert.ok(!/hero-main/.test(js));
  assert.ok(!/createElement\('h1'\)|el\('h1'/.test(js));
  assert.match(js, /function shell\(\) \{\s*clear\(app\);\s*\}/);
});

test('CSS: hero画像は比率を崩さない（aspect-ratio / object-fit で切り抜かない）', () => {
  const css = read('community/costume-portrait-survey/style.css');
  const rule = css.match(/\.cp-hero-img\s*\{([^}]*)\}/)[1];
  assert.match(rule, /width:\s*100%/);
  assert.match(rule, /height:\s*auto/);
  assert.ok(!/aspect-ratio|object-fit/.test(rule));
});

test('画面切替・送信完了・受付終了でも hero は1つのまま同一ノードが残る', async () => {
  const { document } = await openPage();
  const hero = document.querySelector('.cp-hero');
  assert.strictEqual(document.querySelectorAll('.cp-hero').length, 1);
  document.getElementById('cp-age').click();
  next(document);
  await settle();
  assert.strictEqual(document.querySelectorAll('.cp-hero').length, 1);
  assert.strictEqual(document.querySelector('.cp-hero'), hero);
  assert.ok(hero.isConnected);
  assert.strictEqual(document.getElementById('cp-app').querySelectorAll('h1, .cp-hero-img').length, 0);

  for (const search of ['?test=closed', '?test=1']) {
    const { document: d } = await openPage({ search });
    assert.strictEqual(d.querySelectorAll('.cp-hero').length, 1, search);
    assert.strictEqual(d.querySelectorAll('.cp-hero-img').length, 1, search);
  }
  const closed = await openPage({ fetch: () => ({ ok: true, status: 'closed', answered: false, schema_version: SCHEMA.schema_version }) });
  assert.strictEqual(closed.document.querySelectorAll('.cp-hero').length, 1);
  assert.ok(closed.document.getElementById('cp-app').textContent.includes('アンケートの受付は終了しました'));
});

test('sitemap.xml に survey / results の2URLが登録されている', () => {
  const sitemap = read('sitemap.xml');
  for (const page of Object.values(PAGES)) {
    assert.ok(sitemap.includes(`<loc>${SITE}${page}</loc>`), `${page} が sitemap.xml にある`);
  }
});

// ── #347: /portrait/ 導線統合 ──
const PORTRAIT = 'portrait/index.html';

for (const [name, page] of Object.entries(PAGES)) {
  test(`${name}: .cp-back は /portrait/ を指し、文言が統一されている`, () => {
    const a = doc(page).querySelector('.cp-back');
    assert.strictEqual(a.getAttribute('href'), '../portrait/');
    assert.strictEqual(a.textContent.trim(), '← ポートレート撮影ページに戻る');
  });
}

test('portrait: 調査・読みもの section が #flow の後・#faq の前にあり、アンケートCTAを持つ', () => {
  const d = doc(PORTRAIT);
  const ids = Array.from(d.querySelectorAll('section[id]')).map((e) => e.id);
  const r = ids.indexOf('research');
  assert.ok(r > ids.indexOf('flow') && r < ids.indexOf('faq'));
  const sec = d.getElementById('research');
  assert.strictEqual(sec.querySelector('h2').textContent.trim(), '調査・読みもの');
  assert.ok(sec.querySelector('.research-grid > .research-card'));
  const cta = sec.querySelector('.research-card__cta');
  assert.strictEqual(cta.getAttribute('href'), '../community/costume-portrait-survey.html');
  assert.strictEqual(cta.textContent.trim(), 'アンケートに回答する');
  assert.strictEqual(cta.getAttribute('data-cta-name'), 'survey');
  assert.strictEqual(cta.getAttribute('data-cta-location'), 'research');
});

test('portrait: #research が全 scroll-margin-top 指定に含まれ、既存の主要CTAが残っている', () => {
  const html = read(PORTRAIT);
  const blocks = html.match(/#top, [^{]*\.gallery-category \{ scroll-margin-top/g);
  assert.strictEqual(blocks.length, 3);
  blocks.forEach((b) => assert.ok(b.includes('#research')));
  const d = doc(PORTRAIT);
  assert.ok(d.querySelector('#contact'));
  assert.ok(d.querySelector('#plans'));
  assert.ok(d.querySelector('a[href="#contact"][data-cta-name="consult"]'));
});
