'use strict';

const fs = require('fs');
const path = require('path');

// Issue #319：受付終了後の /community/ と fetish-survey.html の静的チェック。
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let failures = 0;
function assert(cond, msg) { if (!cond) { console.error('FAIL:', msg); failures++; } else { console.log('OK:', msg); } }

const lp = read('fetish-survey.html');
assert(!/script\.google\.com/.test(lp), 'fetish-survey.html に回答フォーム（GAS）へのリンクが残っていない');
assert(!/アンケートに回答する/.test(lp), 'fetish-survey.html に回答CTAが残っていない');
assert(/<title>【受付終了】/.test(lp), 'title が受付終了表示');
assert(/og:title" content="【受付終了】/.test(lp) && /twitter:title" content="【受付終了】/.test(lp), 'OGP/Xカードのtitleが受付終了表示');
['name="description"', 'property="og:description"', 'name="twitter:description"'].forEach((k) => {
  const m = lp.match(new RegExp(k + ' content="([^"]*)"'));
  assert(m && /受付を終了/.test(m[1]) && !/3〜5分/.test(m[1]), k + ' が受付終了の文言');
});
assert((lp.match(/href="fetish-survey-results\.html"/g) || []).length >= 2, '結果ページへのCTAがhero/bottomにある');

const top = read('index.html');
const survey = top.slice(top.indexOf('<section id="survey"'), top.indexOf('</section>', top.indexOf('<section id="survey"')));
assert(/fetish-survey-results\.html/.test(survey), '#survey から結果ページへ導線がある');
assert(!/実施中/.test(survey) && !/script\.google\.com/.test(survey), '#survey に「実施中」・回答フォーム導線が残っていない');
assert(/id="fetish-survey-total"[^>]*hidden/.test(survey), '総回答数は初期状態で非表示（確定前に未確定値を出さない）');
assert(/status !== 'final'/.test(top), '総回答数の表示は status==="final" のときだけ');

const sitemap = fs.readFileSync(path.join(__dirname, '..', '..', 'sitemap.xml'), 'utf8');
assert(/community\/fetish-survey-results\.html/.test(sitemap), 'sitemap に結果ページがある');

if (failures) { console.error('\ntest_closed_pages.js: ' + failures + ' failure(s)'); process.exit(1); }
console.log('\ntest_closed_pages.js: all checks passed');
