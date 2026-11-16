'use strict';
// Issue #455：野球ユニ部の日付別開催予定（events.js sessions）と /baseball/ の描画を検証する。
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'baseball', 'index.html'), 'utf8');
const eventsJs = fs.readFileSync(path.join(root, 'events.js'), 'utf8');
let failures = 0;
function assert(cond, msg) { if (!cond) { console.error('FAIL:', msg); failures++; } else { console.log('OK:', msg); } }

// today(JST) を固定し、events.js を読み込んだ window を返す。
function load(todayISO, mutate) {
  const dom = new JSDOM(html.replace(/<script src="\.\.\/events\.js"><\/script>/, ''), { runScripts: 'outside-only' });
  const w = dom.window;
  const fixed = new Date(todayISO + 'T03:00:00Z').getTime();
  w.eval('(' + function (f) {
    const R = Date;
    window.Date = class extends R { constructor(...a) { a.length ? super(...a) : super(f); } static now() { return f; } };
  } + ')(' + fixed + ')');
  w.eval(eventsJs);
  if (mutate) mutate(w.SNB_EVENTS[0]);
  w.SNBEventStatus.render('baseball-next-activity');
  return w;
}
const q = (w, f) => w.document.querySelector('[data-event-field="' + f + '"]');
const items = (w, f) => Array.from(q(w, f).querySelectorAll('li')).map((li) => li.textContent);

// 11/16：予定3件はすべて募集中、過去2件は開催済み
let w = load('2026-11-16');
let up = items(w, 'upcoming-list');
assert(up.length === 3 && /11月28日（土） 13:00〜15:00（募集中）/.test(up[0]), '11/28は13:00〜15:00で募集中');
assert(/2026年12月19日（土） 13:00〜15:00（募集中）/.test(up[1]) && /2027年1月9日（土） 13:00〜15:00（募集中）/.test(up[2]), '12/19・2027/1/9は13:00〜15:00で募集中');
let past = items(w, 'past-list');
assert(past.length === 2 && /10月31日（土） 13:00〜15:00（開催済み）/.test(past[0]) && /11月14日（土） 13:00〜15:00（開催済み）/.test(past[1]), '10/31・11/14は開催済み');
const pageText = w.document.body.textContent;
assert(!/実施未確認|募集は未定/.test(pageText), '「実施未確認」「募集は未定」が残っていない');
assert(/集合場所は、参加される方にDMで個別にご案内します。/.test(pageText), '集合場所はDMで個別案内と明示');
assert(!/集合場所[^。]*X(で|に)(お知らせ|公開|告知|掲載)|X(で|に)[^。]*集合場所/.test(pageText), 'Xで集合場所を公開する誤表現がない');
assert(/Xで次回開催を確認する/.test(pageText), '開催日のX告知リンクは残す');
assert(/過去の日程/.test(q(w, 'past-block').textContent) && !q(w, 'past-block').hidden, '見出しは「過去の日程」');
assert(!q(w, 'form-gate').hidden, '募集中の回があるので申込CTAは表示');
assert(!/enquete_202609/.test(w.document.body.innerHTML), '終了済みアンケートへ誘導しない');

// 11/29以降：11/28が過去へ移り、12/19・1/9は募集中のまま申込CTAも表示
w = load('2026-11-29');
up = items(w, 'upcoming-list');
assert(up.length === 2 && up.every((x) => /13:00〜15:00（募集中）/.test(x)) && !q(w, 'upcoming-block').hidden, '11/29以降も12/19・1/9が募集中で表示');
assert(!q(w, 'form-gate').hidden, '11/29以降も申込CTAは表示');
assert(items(w, 'past-list').length === 3, '11/28が過去へ移る');
assert(/11月28日（土） 13:00〜15:00（日程終了）/.test(items(w, 'past-list')[2]) && !/開催済み.*11月28日|11月28日.*開催済み/.test(items(w, 'past-list')[2]), '結果未記録の11/28は「開催済み」と書かない');

// full：予定一覧は表示のまま、CTAだけ止まる
w = load('2026-11-16', (ev) => { ev.status = 'full'; });
assert(items(w, 'upcoming-list').length === 3 && q(w, 'form-gate').hidden, '満席でも予定一覧は残りCTAだけ停止');
assert(items(w, 'upcoming-list').every((t) => !/募集中/.test(t) && /満席/.test(t)), '満席時は回ごとの「募集中」を表示しない');

// 最終回の翌日：予定ブロックもCTAも消える
w = load('2027-01-10');
assert(q(w, 'upcoming-block').hidden && q(w, 'form-gate').hidden && items(w, 'past-list').length === 5, '全日程終了後は予定・CTAが消え、過去5件');

// 不正日付：予定にも過去にも混入しない（今日が取得できない場合も予定に出さない）
w = load('2026-11-16', (ev) => { ev.sessions.push({ date: '2026-13-45x', label: '不正', time: null, status: 'recruiting', result: null }, { label: '日付なし', time: null, status: 'recruiting' }); });
assert(!items(w, 'upcoming-list').concat(items(w, 'past-list')).some((t) => /不正|日付なし/.test(t)), '不正な日付の回は予定にも過去にも出さない');
// 形式は正しいが実在しない日付（2026-13-45 / 2026-02-31 / 平年の2/29）は除外、うるう年の2/29は有効
w = load('2026-11-16', (ev) => { ev.sessions.push({ date: '2026-13-45', label: '月不正', time: null, status: 'recruiting', result: null }, { date: '2026-02-31', label: '日不正', time: null, status: 'recruiting', result: null }, { date: '2027-02-29', label: '平年29日', time: null, status: 'recruiting', result: null }, { date: '2028-02-29', label: 'うるう年29日', time: null, status: 'upcoming', result: null }); });
const all = items(w, 'upcoming-list').concat(items(w, 'past-list')).join('|');
assert(!/月不正|日不正|平年29日/.test(all), '形式は正しいが実在しない日付は予定にも過去にも出さない');
assert(/うるう年29日/.test(all), 'うるう年の2/29は有効な日付として扱う');
// イベント全体をfinishedにした場合は全体状態を優先（未来の回があっても「募集中」を出さない）
w = load('2026-11-16', (ev) => { ev.status = 'finished'; });
assert(q(w, 'upcoming-block').hidden && q(w, 'form-gate').hidden && !/募集中/.test(q(w, 'upcoming-block').textContent), '全体finishedなら予定一覧・CTAを出さない');
const E = w.SNBEventStatus;
assert(E.splitSessions({ sessions: [{ date: '2026-12-19' }] }, null).upcoming.length === 0, '今日の日付が取れない場合は予定を出さない');
assert(E.computeEffectiveStatus({ status: 'recruiting', sessions: [{ date: 'bad', status: 'recruiting' }] }, '2026-11-16') === 'finished', '有効な日付の回が無ければ募集中にしない');

process.exit(failures ? 1 : (console.log('\nすべて成功'), 0));
