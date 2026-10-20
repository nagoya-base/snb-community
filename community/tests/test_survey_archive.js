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
  const hrefsAll = () => [...doc.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'));
  const cards = [...doc.querySelectorAll('.timeline__item')];
  const ids = cards.map((c) => c.getAttribute('data-survey-id'));
  const expected = [
    'nagoya_baseball_uniform_club_2026', 'snbc_costume_portrait_2026', 'studio_service_feedback_2026',
    'snbc_fetish_costume_2026', 'ataru_rope_interest_2026'
  ];
  assert(cards.length === 5, '5件が表示される');
  assert(JSON.stringify(ids) === JSON.stringify(expected), 'セクション順＋sort_date降順で並ぶ: ' + ids.join(','));
  const sections = [...doc.querySelectorAll('.archive-group')].map((g) => g.getAttribute('data-section'));
  assert(JSON.stringify(sections) === JSON.stringify(['current', 'current_or_recent', 'archive']), '3セクションに分かれる');
  const text = doc.getElementById('archive-root').textContent;
  assert(!/null|undefined|NaN/.test(text), '画面に null/undefined/NaN が出ない');
  assert(doc.getElementById('archive-status').hidden, '読み込み表示が消える');

  const card = (id) => doc.querySelector('[data-survey-id="' + id + '"]');
  const ctas = (id) => [...card(id).querySelectorAll('a')].map((a) => a.textContent);
  assert(!card('snbc_september_project_202609'), '9月企画: DOMに存在しない');
  assert(!doc.body.textContent.includes('9月企画アンケート') && !/enquete_202609/.test(doc.body.innerHTML), '9月企画: タイトル・リンクが一切表示されない');
  assert(!ctas('studio_service_feedback_2026').includes('結果を見る'), 'Studio: 結果CTAなし');
  assert(ctas('snbc_fetish_costume_2026').includes('結果を見る'), '衣装嗜好: 結果CTAあり');
  assert(ctas('nagoya_baseball_uniform_club_2026').includes('結果を見る'), '野球ユニ部: 結果CTAあり');
  const ATARU_RESULTS = 'https://nagoya-base.github.io/ataru-nagoya/survey-results.html';
  const ataruLinks = [...card('ataru_rope_interest_2026').querySelectorAll('a')];
  assert(ataruLinks.length === 1 && ataruLinks[0].textContent === '結果を見る', 'アタル: 結果を見る CTA が1つだけ');
  assert(ataruLinks[0].getAttribute('href') === ATARU_RESULTS, 'アタル: 結果CTAのhrefが最終結果ページ');
  assert(ataruLinks[0].target === '_blank' && ataruLinks[0].rel === 'noopener noreferrer', 'アタル: 外部リンク属性');
  assert(ataruLinks[0].getAttribute('data-cta-name') === 'survey_archive_results' && ataruLinks[0].getAttribute('data-cta-location') === 'survey_archive_card' && ataruLinks[0].getAttribute('data-event-slug') === 'ataru_rope_interest_2026', 'アタル: Analytics属性が既存結果CTAと同じ');
  assert(!ctas('ataru_rope_interest_2026').includes('アンケートを見る'), 'アタル: アンケートを見るCTAなし');
  assert(!/関連サイトへのリンクは掲載していません/.test(card('ataru_rope_interest_2026').textContent), 'アタル: 旧注記が残らない');
  assert(/公開中（最終）/.test(card('ataru_rope_interest_2026').textContent), 'アタル: 最終結果の表示');
  const ataruData = data.surveys.find((s) => s.id === 'ataru_rope_interest_2026');
  assert(ataruData.public_results.available === true && ataruData.public_results.final === true && ataruData.public_url === null && ataruData.results_url === ATARU_RESULTS, 'アタル: JSON状態（available/final=true, public_url=null, results_url）');
  assert(hrefsAll().filter((h) => /ataru-nagoya/.test(h)).join() === ATARU_RESULTS, 'ataru-nagoya へのリンクは結果ページ1件のみ（トップ・回答フォーム等なし）');
  assert(data.surveys.filter((s) => s.link_policy === 'results_only').map((s) => s.id).join() === 'ataru_rope_interest_2026', 'results_only はアタルのカードのみ');
  assert(card('snbc_fetish_costume_2026').querySelectorAll('a').length === 1 && card('nagoya_baseball_uniform_club_2026').querySelectorAll('a').length === 2 && card('studio_service_feedback_2026').querySelectorAll('a').length === 1, 'CTA数: 過去調査は結果のみ(1)、実施中は結果+アンケート(2)、Studioはアンケートのみ(1)');
  assert(card('ataru_rope_interest_2026').textContent.includes('193件') && card('ataru_rope_interest_2026').textContent.includes('34問'), 'アタル: 回答数・設問数は掲載');
  assert(/2026年10月4日まで/.test(card('ataru_rope_interest_2026').textContent) && !/10月5日/.test(card('ataru_rope_interest_2026').textContent), 'アタル: 「2026年10月4日まで」と表示（正本のendは10/5 0:00のまま）');
  assert(/〜 2026年9月30日/.test(card('snbc_fetish_costume_2026').textContent) && !/23:59/.test(card('snbc_fetish_costume_2026').textContent), '衣装嗜好: 「〜 2026年9月30日」');
  assert(!/2026年10月(8|20)日|2026年10月1日/.test(doc.getElementById('archive-root').textContent), 'sort_date由来の日付を表示しない');
  assert(!/設問数/.test(card('nagoya_baseball_uniform_club_2026').textContent), '野球ユニ部: 設問数の不一致があるため設問数を省く');
  assert(/設問数Q1〜Q30（条件分岐あり）/.test(card('snbc_costume_portrait_2026').textContent) && !/30問/.test(card('snbc_costume_portrait_2026').textContent), 'ポートレート意識調査: 「Q1〜Q30（条件分岐あり）」表記');
  assert(JSON.parse(jsonText).surveys.find((s) => s.id === 'ataru_rope_interest_2026').survey_period.end === '2026-10-05T00:00:00+09:00', '正本の締切値(end)は変更していない');
  assert(!/設問数/.test(card('studio_service_feedback_2026').textContent), 'Studio: 設問数不明は非表示');
  assert(/回答受付中（件数は非公開）/.test(card('nagoya_baseball_uniform_club_2026').textContent), '野球ユニ部: 少数秘匿は件数を出さない');
  assert(/公開状況確認中/.test(card('studio_service_feedback_2026').textContent) && !/回答受付中/.test(card('studio_service_feedback_2026').textContent), 'status=unknown を回答受付中と断定しない(Studio)');
  assert(card('snbc_costume_portrait_2026').closest('[data-section]').getAttribute('data-section') === 'current' && /回答受付中/.test(card('snbc_costume_portrait_2026').textContent), 'ポートレート意識調査: 10/31まで受付中のため現在実施中');

  // Issue #407: 期限表示
  const periodOf = (id) => (card(id).querySelector('.timeline__date') || {}).textContent;
  assert(periodOf('nagoya_baseball_uniform_club_2026') === '2026年11月30日まで', '野球ユニ部: 「2026年11月30日まで」');
  assert(periodOf('snbc_costume_portrait_2026') === '2026年10月31日まで', 'ポートレート意識調査: 「2026年10月31日まで」');
  assert(periodOf('studio_service_feedback_2026') === '期限なし', 'Studio: 「期限なし」');
  assert(data.surveys.find((s) => s.id === 'studio_service_feedback_2026').survey_period.end === null, 'Studio: 募集期限は設定しない(end=null)');
  assert(data.surveys.find((s) => s.id === 'nagoya_baseball_uniform_club_2026').survey_period.end.startsWith('2026-11-30') && data.surveys.find((s) => s.id === 'snbc_costume_portrait_2026').survey_period.end.startsWith('2026-10-31'), '正本のend: 11/30・10/31');

  // Issue #407: CTA（過去調査は回答フォームCTAなし／配色は種別で固定）
  data.surveys.filter((s) => s.status === 'closed').forEach((s) => {
    assert(!ctas(s.id).includes('アンケートを見る'), '過去調査にアンケートを見るなし: ' + s.id);
  });
  assert(ctas('snbc_fetish_costume_2026').join() === '結果を見る', '衣装・ユニフォーム嗜好: 結果を見るのみ');
  assert(ctas('ataru_rope_interest_2026').join() === '結果を見る', '緊縛・ロープ: 結果を見るのみ');
  const allCtas = [...doc.querySelectorAll('.survey-cta__btn')];
  assert(allCtas.length === 7, 'CTAは計7件（結果4＋アンケート3）');
  allCtas.forEach((a) => {
    const id = a.getAttribute('data-event-slug');
    if (a.textContent === '結果を見る') assert(a.classList.contains('survey-cta__btn--results') && !a.classList.contains('survey-cta__btn--open'), '結果を見るは赤塗りクラス: ' + id);
    else assert(a.textContent === 'アンケートを見る' && a.classList.contains('survey-cta__btn--open') && !a.classList.contains('survey-cta__btn--results'), 'アンケートを見るは白抜きクラス: ' + id);
  });
  const both = ['nagoya_baseball_uniform_club_2026', 'snbc_costume_portrait_2026'];
  both.forEach((id) => assert(ctas(id).join() === '結果を見る,アンケートを見る', '両方あるカードは結果→アンケートの順: ' + id));
  const css = read('style.css');
  const rule = (sel) => (css.match(new RegExp(sel.replace(/[.]/g, '\\.') + '\\s*\\{([^}]*)\\}')) || [])[1] || '';
  assert(/background:\s*var\(--accent\)/.test(rule('.survey-cta__btn--results')) && /color:\s*#fff/.test(rule('.survey-cta__btn--results')), 'CSS: 結果=赤背景・白文字');
  assert(/background:\s*#fff/.test(rule('.survey-cta__btn--open')) && /color:\s*var\(--accent\)/.test(rule('.survey-cta__btn--open')), 'CSS: アンケート=白背景・赤文字');
  assert(/\.survey-cta__btn\s*\{\s*border:\s*1px solid var\(--accent\)/.test(css), 'CSS: 両CTAとも赤枠');
  assert(!/--primary|--secondary/.test(css + script), 'primary/secondary 依存が残っていない');

  // Issue #407: OGP・ヒーローをCommunityトップと揃える
  const topHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const meta = (h, attr, key) => (h.match(new RegExp('<meta ' + attr + '="' + key + '" content="([^"]*)"')) || [])[1];
  ['og:image', 'og:image:width', 'og:image:height'].forEach((k) => assert(meta(html, 'property', k) === meta(topHtml, 'property', k), 'OGP一致: ' + k));
  assert(meta(html, 'name', 'twitter:image') === meta(topHtml, 'name', 'twitter:image') && meta(html, 'name', 'twitter:card') === meta(topHtml, 'name', 'twitter:card'), 'Twitter Card画像・種別がCommunityトップと同じ');
  assert(meta(html, 'property', 'og:image') === 'https://nagoya-base.github.io/snb-community/images/community/top/meta-ogp-main.jpg', 'OGP画像はmeta-ogp-main.jpg');
  const heroImg = doc.querySelector('.hero-image img');
  const heroSrc = doc.querySelector('.hero-image source');
  assert(heroImg && heroImg.getAttribute('src') === '../../images/community/top/meta-ogp-main.jpg' && heroSrc && heroSrc.getAttribute('srcset') === '../../images/community/top/hero-photo-main.webp' && heroSrc.getAttribute('type') === 'image/webp', 'ヒーロー: webp+jpgをCommunityトップと同じ画像で表示（相対パス ../../）');
  assert(heroImg.getAttribute('width') === '1731' && heroImg.getAttribute('height') === '909', 'ヒーロー: 画像サイズ属性がCommunityトップと同じ');
  ['community/top/hero-photo-main.webp', 'community/top/meta-ogp-main.jpg'].forEach((f) => assert(fs.existsSync(path.join(__dirname, '..', '..', 'images', f)), '画像ファイルが存在: ' + f));
  assert(doc.querySelector('.archive-hero h1').textContent === 'アンケート・調査アーカイブ', 'ポータル固有のH1は維持');
  assert(!ids.includes('nagoya_fetish_survey_internal'), '同一調査の別名は1件のみ');
  assert(/名古屋のフェチ・衣装交流に関するアンケート/.test(card('snbc_fetish_costume_2026').textContent), '衣装嗜好: 別名を補助説明に表示');
  const hrefs = [...doc.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'));
  assert(!hrefs.some((h) => /ataru-nagoya\/(?!survey-results\.html$)|admin|dashboard|enquete_202609_results|prototype|script\.google\.com/i.test(h)), '禁止リンク（結果ページ以外のアタル/Admin/運営用/prototype/GAS）なし');

  // 静的チェック
  const all = html + jsonText + script;
  assert((all.match(/ataru-nagoya/g) || []).length === 1 && jsonText.includes(ATARU_RESULTS), 'ポータル一式の ataru-nagoya 参照は結果ページURL1件のみ');
  assert(!/ataru-nagoya\/(?!survey-results\.html)/.test(all) && !/ataru-nagoya\/?["']/.test(all), 'Ataruトップ・回答フォームの参照がない');
  assert(!/respondent_hash|submission_id|spreadsheet|SPREADSHEET|Script Propert|SURVEY_CLOSES_AT|script\.google\.com|\/exec|@gmail|operations_dashboard|prototype|canonical_source_path|schema_path/.test(all), '個人情報・秘匿情報・内部パスが含まれない');
  assert(!/classroom_20260912|school_uniform_20260919|baseball\/enquete_202609|enquete_202609/.test(all), '除外対象への参照がない');
  assert(data.surveys.every((s) => s.portal.include === true), '公開用JSONは include=true のみ');
  assert(data.surveys.length === 5, '公開用JSONは5件');
  const noteKeys = JSON.stringify(data).match(/"note"/g);
  assert(!noteKeys, '公開用JSONに注記(note)を含めない');
  assert(/<title>[^<]+<\/title>/.test(html) && /rel="canonical"/.test(html) && /og:title/.test(html) && /twitter:card/.test(html) && /name="description"/.test(html), 'SEO: title/description/canonical/OGP/Twitter Card');
  assert((html.match(/<h1[ >]/g) || []).length === 1, 'h1は1つ');

  if (failures) { console.error('\n' + failures + ' 件の失敗'); process.exit(1); }
  console.log('\nすべて成功');
})();
