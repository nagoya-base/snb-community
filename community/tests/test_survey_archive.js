'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// アンケート・調査アーカイブ（community/surveys/）の検証。
// surveys.json（公開用）→ surveys.js が描画するカードを jsdom で確認する。
const DIR = path.join(__dirname, '..', 'surveys');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
const html = read('index.html');
const jsonText = read('surveys.json');
const data = JSON.parse(jsonText);
const script = read('surveys.js');

let failures = 0;
function assert(cond, msg) { if (!cond) { console.error('FAIL:', msg); failures++; } else { console.log('OK:', msg); } }

async function boot() {
  const dom = new JSDOM(html.replace(/<script[\s\S]*?<\/script>/g, ''), { runScripts: 'outside-only', url: 'https://nagoya-base.github.io/snb-community/community/surveys/' });
  const { window } = dom;
  window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(jsonText)) });
  window.eval(script);
  await new Promise((r) => setTimeout(r, 20));
  return window.document;
}

(async () => {
  const doc = await boot();
  const cards = [...doc.querySelectorAll('.timeline__item')];
  const ids = cards.map((c) => c.getAttribute('data-survey-id'));
  const expected = [
    'nagoya_baseball_uniform_club_2026', 'snbc_costume_portrait_2026', 'studio_service_feedback_2026',
    'snbc_fetish_costume_2026', 'ataru_rope_interest_2026', 'snbc_september_project_202609'
  ];
  assert(cards.length === 6, '6件が表示される');
  assert(JSON.stringify(ids) === JSON.stringify(expected), 'セクション順＋sort_date降順で並ぶ: ' + ids.join(','));
  const sections = [...doc.querySelectorAll('.archive-group')].map((g) => g.getAttribute('data-section'));
  assert(JSON.stringify(sections) === JSON.stringify(['current', 'current_or_recent', 'archive']), '3セクションに分かれる');
  const text = doc.getElementById('archive-root').textContent;
  assert(!/null|undefined|NaN/.test(text), '画面に null/undefined/NaN が出ない');
  assert(doc.getElementById('archive-status').hidden, '読み込み表示が消える');

  const card = (id) => doc.querySelector('[data-survey-id="' + id + '"]');
  const ctas = (id) => [...card(id).querySelectorAll('a')].map((a) => a.textContent);
  assert(ctas('snbc_september_project_202609').includes('アンケートを見る') && !ctas('snbc_september_project_202609').includes('結果を見る'), '9月企画: results_url なし→結果CTAなし');
  assert(!ctas('studio_service_feedback_2026').includes('結果を見る'), 'Studio: 結果CTAなし');
  assert(ctas('snbc_fetish_costume_2026').includes('結果を見る'), '衣装嗜好: 結果CTAあり');
  assert(ctas('nagoya_baseball_uniform_club_2026').includes('結果を見る'), '野球ユニ部: 結果CTAあり');
  assert(card('ataru_rope_interest_2026').querySelectorAll('a').length === 0, 'アタル: リンクが一切出ない');
  assert(/関連サイトへのリンクは掲載していません/.test(card('ataru_rope_interest_2026').textContent), 'アタル: リンク非掲載の注記');
  assert(card('ataru_rope_interest_2026').textContent.includes('193件') && card('ataru_rope_interest_2026').textContent.includes('34問'), 'アタル: 回答数・設問数は掲載');
  assert(/〜 2026年10月5日 0:00/.test(card('ataru_rope_interest_2026').textContent), 'アタル: 終了日のみ「〜 日付」表示');
  assert(/〜 2026年9月30日/.test(card('snbc_fetish_costume_2026').textContent) && !/23:59/.test(card('snbc_fetish_costume_2026').textContent), '衣装嗜好: 「〜 2026年9月30日」');
  assert(!/回答数/.test(card('snbc_september_project_202609').textContent), '9月企画: 回答数不明は項目ごと非表示');
  assert(!/設問数/.test(card('studio_service_feedback_2026').textContent), 'Studio: 設問数不明は非表示');
  assert(/回答受付中（件数は非公開）/.test(card('nagoya_baseball_uniform_club_2026').textContent), '野球ユニ部: 少数秘匿は件数を出さない');
  assert(/公開状況確認中/.test(card('studio_service_feedback_2026').textContent) && !/回答受付中/.test(card('studio_service_feedback_2026').textContent), 'status=unknown を回答受付中と断定しない(Studio)');
  assert(!/回答受付中/.test(card('snbc_costume_portrait_2026').textContent), 'status=unknown を回答受付中と断定しない(costume)');
  assert(!ids.includes('nagoya_fetish_survey_internal'), '同一調査の別名は1件のみ');
  assert(/名古屋のフェチ・衣装交流に関するアンケート/.test(card('snbc_fetish_costume_2026').textContent), '衣装嗜好: 別名を補助説明に表示');
  const hrefs = [...doc.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'));
  assert(!hrefs.some((h) => /ataru-nagoya|admin|dashboard|enquete_202609_results|prototype|script\.google\.com/i.test(h)), '禁止リンク（アタル/Admin/運営用/prototype/GAS）なし');

  // 静的チェック
  const all = html + jsonText + script;
  assert(!/ataru-nagoya/.test(all), 'ポータル一式に ataru-nagoya への参照がない');
  assert(!/respondent_hash|submission_id|spreadsheet|SPREADSHEET|Script Propert|SURVEY_CLOSES_AT|script\.google\.com|\/exec|@gmail|operations_dashboard|prototype|canonical_source_path|schema_path/.test(all), '個人情報・秘匿情報・内部パスが含まれない');
  assert(!/classroom_20260912|school_uniform_20260919|baseball\/enquete_202609|enquete_202609_results/.test(all), '除外対象への参照がない');
  assert(data.surveys.every((s) => s.portal.include === true), '公開用JSONは include=true のみ');
  assert(data.surveys.length === 6, '公開用JSONは6件');
  const noteKeys = JSON.stringify(data).match(/"note"/g);
  assert(!noteKeys, '公開用JSONに注記(note)を含めない');
  assert(/<title>[^<]+<\/title>/.test(html) && /rel="canonical"/.test(html) && /og:title/.test(html) && /twitter:card/.test(html) && /name="description"/.test(html), 'SEO: title/description/canonical/OGP/Twitter Card');
  assert((html.match(/<h1[ >]/g) || []).length === 1, 'h1は1つ');

  if (failures) { console.error('\n' + failures + ' 件の失敗'); process.exit(1); }
  console.log('\nすべて成功');
})();
