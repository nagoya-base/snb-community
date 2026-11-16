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

// 11/16：予定3件（11/28募集中・12/19・1/9は募集未定）、過去2件は実施未確認
let w = load('2026-11-16');
let up = items(w, 'upcoming-list');
assert(up.length === 3 && /11月28日.*13:00〜15:00（募集中）/.test(up[0]), '11/28は時間付きで募集中のまま');
assert(/12月19日（土） 13:00開始（開催予定・募集は未定）/.test(up[1]) && /2027年1月9日（土） 13:00開始（開催予定・募集は未定）/.test(up[2]) && !/15:00/.test(up[1] + up[2]), '12/19・2027/1/9は13:00開始（終了時刻を推定せず）で募集中と書かない');
let past = items(w, 'past-list');
assert(past.length === 2 && past.every((t) => /実施未確認/.test(t) && !/開催済み/.test(t)), '実施未確認の回を「開催済み」と書かない');
assert(/過去の日程/.test(q(w, 'past-block').textContent) && !q(w, 'past-block').hidden, '見出しは「過去の日程」');
assert(!q(w, 'form-gate').hidden, '募集中の回があるので申込CTAは表示');
assert(!/enquete_202609/.test(w.document.body.innerHTML), '終了済みアンケートへ誘導しない');

// 11/29：募集中の回が無い → 予定一覧は残り、申込CTAだけ消える
w = load('2026-11-29');
assert(items(w, 'upcoming-list').length === 2 && !q(w, 'upcoming-block').hidden, '予定一覧は募集中の回が無くても表示');
assert(q(w, 'form-gate').hidden, '募集中の回が無ければ申込CTAは非表示');
assert(items(w, 'past-list').length === 3, '11/28が過去へ移る');

// full：予定一覧は表示のまま、CTAだけ止まる
w = load('2026-11-16', (ev) => { ev.status = 'full'; });
assert(items(w, 'upcoming-list').length === 3 && q(w, 'form-gate').hidden, '満席でも予定一覧は残りCTAだけ停止');

// 最終回の翌日：予定ブロックもCTAも消える
w = load('2027-01-10');
assert(q(w, 'upcoming-block').hidden && q(w, 'form-gate').hidden && items(w, 'past-list').length === 5, '全日程終了後は予定・CTAが消え、過去5件');

// 不正日付：予定にも過去にも混入しない（今日が取得できない場合も予定に出さない）
w = load('2026-11-16', (ev) => { ev.sessions.push({ date: '2026-13-45x', label: '不正', time: null, status: 'recruiting', result: null }, { label: '日付なし', time: null, status: 'recruiting' }); });
assert(!items(w, 'upcoming-list').concat(items(w, 'past-list')).some((t) => /不正|日付なし/.test(t)), '不正な日付の回は予定にも過去にも出さない');
const E = w.SNBEventStatus;
assert(E.splitSessions({ sessions: [{ date: '2026-12-19' }] }, null).upcoming.length === 0, '今日の日付が取れない場合は予定を出さない');
assert(E.computeEffectiveStatus({ status: 'recruiting', sessions: [{ date: 'bad', status: 'recruiting' }] }, '2026-11-16') === 'finished', '有効な日付の回が無ければ募集中にしない');

process.exit(failures ? 1 : (console.log('\nすべて成功'), 0));
