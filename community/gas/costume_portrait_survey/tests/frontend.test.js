'use strict';
const SCHEMA = require('../survey.schema.json');
const SV = SCHEMA.schema_version;
const test = require('node:test');
const assert = require('node:assert');
const { openPage, settle, q, pageTitle, progressText, choose, setText, next, back, advanceToReview, visibleFieldsets } = require('./helpers/dom');

const SECTION_ORDER = ['興味のある衣装', '着てみたい衣装', '撮られてみたい衣装', '撮ってみたい衣装', '撮られることについて', '写真の利用目的', '背景・世界観',
  '撮影時間・曜日・時間帯', '写真枚数・仕上げ', '撮られることへの不安・ためらい', 'ポートレート撮影サービスの価格', '人物を撮影することについて',
  'スタジオ利用・撮影機材', '今後3か月の意向', '基本情報', '自由回答・応援メッセージ'];

const postCalls = (calls) => calls.filter((c) => c.options.method === 'POST');
const text = (document) => document.getElementById('cp-app').textContent;

test('初回表示：status APIを呼び、冒頭に「18歳以上です」の必須チェックと回答時間の目安を表示する', async () => {
  const { document, calls } = await openPage();
  assert.strictEqual(calls.length, 1);
  assert.match(calls[0].url, /\?action=status&uuid=[0-9a-f-]{36}$/);
  assert.strictEqual(calls[0].options.method, 'GET');
  // hero（h1・サブタイトル）はHTML固定。#cp-app（動的領域）の外にあり、schema と一致する
  assert.strictEqual(document.querySelector('.cp-hero h1').textContent, SCHEMA.title);
  assert.strictEqual(document.querySelector('.cp-hero .cp-sub').textContent, SCHEMA.subtitle);
  assert.ok(text(document).includes('約8〜10分'));
  assert.ok(text(document).includes('18歳以上です'));
  assert.ok(text(document).includes('18歳以上'));
  // 基本情報（年齢・地域）から始まらない
  assert.ok(!document.querySelector('fieldset[data-qid="age_range"]'));
  assert.ok(!document.querySelector('fieldset[data-qid="residence"]'));
});

test('18歳以上チェックが未チェックなら先へ進めない（エラー表示）', async () => {
  const { document } = await openPage();
  next(document);
  assert.strictEqual(document.getElementById('cp-age-error').hidden, false);
  assert.ok(document.getElementById('cp-age'));
  assert.strictEqual(document.querySelector('fieldset[data-qid="costume_interest"]'), null);
  document.getElementById('cp-age').click();
  next(document);
  assert.strictEqual(pageTitle(document), '興味のある衣装');
  assert.ok(q(document, 'costume_interest'));
});

test('設問順：衣装設問から始まり、基本情報は後半、自由回答が最後（Issueの表示順）', async () => {
  const { document } = await openPage();
  const titles = await advanceToReview(document);
  // 撮影者向けセクションは、既定の回答（現在撮影している）で表示される
  assert.deepStrictEqual(titles, SECTION_ORDER);
  assert.strictEqual(document.querySelector('#cp-page h2').textContent, '送信前の確認');
});

test('進捗表示：現在ページ/全ページ数が出て、撮影者向けセクションが非表示なら全体数が減る', async () => {
  const { document } = await openPage();
  document.getElementById('cp-age').click();
  next(document);
  assert.match(progressText(document), /興味のある衣装.*2 \/ 17/); // 撮影者向けセクションは未回答の間は数えない
  assert.strictEqual(document.getElementById('cp-progress').getAttribute('role'), 'progressbar');
  const titles = [];
  while (pageTitle(document) !== '人物を撮影することについて') { require('./helpers/dom').fillVisible(document); next(document); titles.push(1); }
  choose(document, 'shooter_interest', 'want_to_try');
  assert.match(progressText(document), / \/ 18$/);
  choose(document, 'shooter_interest', 'not_interested');
  assert.match(progressText(document), / \/ 17$/);
});

test('必須項目が未入力なら進めず、エラー位置（その設問）に表示される', async () => {
  const { document, events } = await openPage();
  document.getElementById('cp-age').click();
  next(document);
  next(document);
  assert.strictEqual(pageTitle(document), '興味のある衣装');
  const err = q(document, 'costume_interest').querySelector('.cp-err');
  assert.strictEqual(err.hidden, false);
  assert.ok(err.textContent.length > 0);
  assert.ok(q(document, 'costume_interest').classList.contains('cp-has-error'));
  assert.ok(events().some((e) => e.name === 'form_error' && e.params.error_type === 'validation'));
  choose(document, 'costume_interest', 'rubber');
  next(document);
  assert.strictEqual(pageTitle(document), '着てみたい衣装');
});

test('「その他」：選択時のみ自由記述欄が出て必須、未選択なら出ない・不要', async () => {
  const { document, window } = await openPage();
  document.getElementById('cp-age').click();
  next(document);
  const other = () => q(document, 'costume_interest').querySelector('[data-other-for]');
  assert.strictEqual(other().hidden, true);
  choose(document, 'costume_interest', 'other');
  assert.strictEqual(other().hidden, false);
  next(document);
  assert.strictEqual(pageTitle(document), '興味のある衣装', '自由記述が空なら進めない');
  assert.ok(q(document, 'costume_interest').querySelector('.cp-err').textContent.includes('その他'));
  setText(window, other().querySelector('input'), 'ミリタリー');
  next(document);
  assert.strictEqual(pageTitle(document), '着てみたい衣装');
  // 戻ると入力が保持されている
  back(document);
  assert.strictEqual(other().querySelector('input').value, 'ミリタリー');
  // 「その他」を外すと入力欄は消え、値もクリアされる
  choose(document, 'costume_interest', 'other');
  assert.strictEqual(other().hidden, true);
  assert.strictEqual(other().querySelector('input').value, '');
  choose(document, 'costume_interest', 'rubber');
  next(document);
  assert.strictEqual(pageTitle(document), '着てみたい衣装');
});

test('ユニフォーム/作業服の詳細は、該当を選択した時だけ表示され、必須になる', async () => {
  const { document } = await openPage();
  document.getElementById('cp-age').click();
  next(document);
  assert.strictEqual(q(document, 'uniform_interest').hidden, true);
  assert.strictEqual(q(document, 'workwear_interest').hidden, true);
  choose(document, 'costume_interest', 'uniform');
  assert.strictEqual(q(document, 'uniform_interest').hidden, false);
  assert.strictEqual(q(document, 'workwear_interest').hidden, true);
  next(document);
  assert.strictEqual(pageTitle(document), '興味のある衣装', '詳細が未選択なら進めない');
  assert.strictEqual(q(document, 'uniform_interest').querySelector('.cp-err').hidden, false);
  choose(document, 'uniform_interest', 'uniform_baseball');
  choose(document, 'costume_interest', 'workwear');
  assert.strictEqual(q(document, 'workwear_interest').hidden, false);
  choose(document, 'workwear_interest', 'workwear_fire');
  // 親を外すと詳細は消え、回答も破棄される
  choose(document, 'costume_interest', 'uniform');
  assert.strictEqual(q(document, 'uniform_interest').hidden, true);
  assert.ok(!Array.from(q(document, 'uniform_interest').querySelectorAll('input')).some((i) => i.checked));
  next(document);
  assert.strictEqual(pageTitle(document), '着てみたい衣装');
});

test('Q5の選択がQ6-Aで優先表示され、Q5で未選択の衣装も「ほかの候補」から選べる', async () => {
  const { document } = await openPage();
  document.getElementById('cp-age').click();
  next(document);
  choose(document, 'costume_interest', 'zentai');
  choose(document, 'costume_interest', 'rubber');
  next(document);
  const wear = q(document, 'costume_wear');
  const primary = Array.from(wear.querySelectorAll(':scope > .cp-options input')).map((i) => i.value);
  assert.deepStrictEqual(primary, ['rubber', 'zentai']);
  const more = wear.querySelector('details.cp-more');
  assert.ok(more);
  const rest = Array.from(more.querySelectorAll('input')).map((i) => i.value);
  assert.ok(rest.includes('uniform') && rest.includes('nude') && rest.includes('other'));
  assert.ok(!rest.includes('zentai'));
  // Q5で選んでいない「ユニフォーム」も選べ、詳細が出る
  choose(document, 'costume_wear', 'uniform');
  assert.strictEqual(q(document, 'uniform_wear').hidden, false);
  next(document);
  assert.strictEqual(pageTitle(document), '着てみたい衣装', '詳細未選択');
  choose(document, 'uniform_wear', 'uniform_rugby');
  next(document);
  assert.strictEqual(pageTitle(document), '撮られてみたい衣装');
  back(document);
  // 戻ると、詳細内の選択済みが開いた状態で保持される
  assert.strictEqual(q(document, 'costume_wear').querySelector('details.cp-more').open, true);
  assert.strictEqual(q(document, 'costume_wear').querySelector('input[value="uniform"]').checked, true);
});

test('Q21〜Q26 の撮影者向けセクションは対象回答者のみ（撮影される側だけ/興味なしは非表示）', async () => {
  for (const [value, expectStudio] of [['currently_shooting', true], ['want_to_try', true], ['slightly_interested', true], ['subject_only', false], ['not_interested', false]]) {
    const { document } = await openPage();
    const titles = await advanceToReview(document, (title, doc) => { if (title === '人物を撮影することについて') choose(doc, 'shooter_interest', value); });
    assert.strictEqual(titles.includes('スタジオ利用・撮影機材'), expectStudio, value);
  }
});

test('戻る操作で入力済み内容（単一・複数・matrix・自由記述）が保持される', async () => {
  const { document, window } = await openPage();
  await advanceToReview(document, (title, doc) => {
    if (title === '背景・世界観') choose(doc, 'backdrop', 'black'); // 既定で先頭(white)が選択済み
    if (title === '自由回答・応援メッセージ') setText(window, q(doc, 'cheer_message').querySelector('textarea'), 'いつも応援しています');
  });
  back(document);
  assert.strictEqual(pageTitle(document), '自由回答・応援メッセージ');
  assert.strictEqual(q(document, 'cheer_message').querySelector('textarea').value, 'いつも応援しています');
  back(document); back(document);
  assert.strictEqual(pageTitle(document), '今後3か月の意向');
  assert.ok(Array.from(q(document, 'intent_3m').querySelectorAll('input')).filter((i) => i.checked).length === 8);
  while (pageTitle(document) !== '背景・世界観') back(document);
  assert.deepStrictEqual(Array.from(q(document, 'backdrop').querySelectorAll('input')).filter((i) => i.checked).map((i) => i.value), ['white', 'black']);
  while (document.getElementById('cp-back').hidden === false) back(document);
  assert.strictEqual(document.getElementById('cp-age').checked, true);
});

test('排他的な選択肢（「特にない」）は他の選択肢と同時に選べない', async () => {
  const { document } = await openPage();
  await advanceToReview(document, (title, doc) => {
    if (title === '撮られることへの不安・ためらい') {
      choose(doc, 'hesitation', 'price_concern');
      choose(doc, 'hesitation', 'none');
      const checked = Array.from(q(doc, 'hesitation').querySelectorAll('input')).filter((i) => i.checked).map((i) => i.value);
      assert.deepStrictEqual(checked, ['none']);
      choose(doc, 'hesitation', 'price_concern');
      const after = Array.from(q(doc, 'hesitation').querySelectorAll('input')).filter((i) => i.checked).map((i) => i.value);
      assert.deepStrictEqual(after, ['price_concern']);
    }
  });
});

test('Q30は1000字まで（超過はエラー）', async () => {
  const { document, window } = await openPage();
  await advanceToReview(document, (title, doc) => {
    if (title === '自由回答・応援メッセージ') {
      const area = q(doc, 'cheer_message').querySelector('textarea');
      setText(window, area, 'あ'.repeat(1001));
      assert.ok(q(doc, 'cheer_message').querySelector('.cp-count').textContent.startsWith('1001 / 1000'));
    }
  }).then(() => assert.fail('should not pass'), (e) => assert.match(e.message, /did not reach review/));
  assert.strictEqual(pageTitle(document), '自由回答・応援メッセージ');
  assert.strictEqual(q(document, 'cheer_message').querySelector('.cp-err').hidden, false);
});

// ── 送信 ──
async function reviewPage(opts) {
  const page = await openPage(opts);
  await advanceToReview(page.document, opts && opts.customize);
  return page;
}

test('送信：fetch POST + text/plain、payloadはstable IDとage_confirmed=true、hidden回答は含まない', async () => {
  const { document, calls, window } = await reviewPage({
    customize: (title, doc) => {
      // 既定で uniform + 詳細(野球)が選択済み → 「その他」を追加し、uniform を外すと詳細回答も破棄される。
      if (title === '興味のある衣装') { choose(doc, 'costume_interest', 'other'); setText(window_(doc), q(doc, 'costume_interest').querySelector('[data-other-input]'), 'ミリタリー'); choose(doc, 'costume_interest', 'uniform'); }
    }
  });
  function window_(doc) { return doc.defaultView; }
  next(document);
  await settle();
  const posts = postCalls(calls);
  assert.strictEqual(posts.length, 1);
  assert.strictEqual(posts[0].url, 'https://script.google.com/macros/s/TEST/exec');
  assert.strictEqual(posts[0].options.headers['Content-Type'], 'text/plain;charset=utf-8');
  const payload = JSON.parse(posts[0].options.body);
  assert.strictEqual(payload.age_confirmed, true);
  assert.strictEqual(payload.schema_version, SV);
  assert.match(payload.uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.strictEqual(payload.website, '');
  assert.strictEqual(typeof payload.elapsed_ms, 'number');
  assert.deepStrictEqual(payload.other_texts, { costume_interest: 'ミリタリー' });
  assert.deepStrictEqual(payload.answers.costume_interest, ['other']);
  assert.ok(!('uniform_interest' in payload.answers), '親を外した詳細回答は送らない');
  assert.strictEqual(payload.answers.portrait_interest, 'very_interested');
  assert.strictEqual(typeof payload.answers.intent_3m, 'object');
  assert.ok(!JSON.stringify(payload).includes('とても興味がある'), '表示labelは送らない');
  assert.ok(text(document).includes('ご回答ありがとうございました'));
  // 同一ブラウザのUUIDは保持され、statusと同じ値
  assert.ok(calls[0].url.endsWith(payload.uuid));
});

test('二重クリック防止：送信中はボタンが無効になり、POSTは1回だけ', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { document, calls } = await reviewPage({
    fetch: (url, options) => (options.method === 'POST' ? gate.then(() => ({ ok: true, status: 'accepted' })) : { ok: true, status: 'open', answered: false, schema_version: SV })
  });
  const button = document.getElementById('cp-next');
  button.click();
  button.click();
  next(document);
  await settle();
  assert.strictEqual(postCalls(calls).length, 1);
  assert.strictEqual(button.disabled, true);
  assert.strictEqual(button.textContent, '送信中…');
  assert.strictEqual(document.getElementById('cp-back').disabled, true);
  release();
  await settle();
  assert.ok(text(document).includes('ご回答ありがとうございました'));
  assert.strictEqual(postCalls(calls).length, 1);
});

test('duplicate_submission は失敗ではなく「回答はすでに受付済みです」と表示する', async () => {
  const { document } = await reviewPage({ fetch: (url, o) => (o.method === 'POST' ? { ok: false, error: 'duplicate_submission' } : { ok: true, status: 'open', answered: false, schema_version: SV }) });
  next(document);
  await settle();
  assert.ok(text(document).includes('回答はすでに受付済みです'));
  assert.ok(!text(document).includes('失敗'));
});

test('保存後に応答だけ失われた場合：通信エラー→入力保持→再送でduplicate→「受付済み」', async () => {
  let attempt = 0;
  const { document, calls, events } = await reviewPage({
    fetch: (url, o) => {
      if (o.method !== 'POST') return { ok: true, status: 'open', answered: false, schema_version: SV };
      attempt++;
      return attempt === 1 ? new Error('network down') : { ok: false, error: 'duplicate_submission' };
    }
  });
  const button = document.getElementById('cp-next');
  button.click();
  await settle();
  assert.strictEqual(button.disabled, false, '通信エラー後は再送できる');
  const err = document.getElementById('cp-submit-error');
  assert.strictEqual(err.hidden, false);
  assert.ok(err.textContent.includes('送信に失敗'));
  assert.ok(err.textContent.includes('保持'));
  assert.ok(events().some((e) => e.name === 'form_error' && e.params.error_type === 'network'));
  button.click();
  await settle();
  assert.strictEqual(postCalls(calls).length, 2);
  const bodies = postCalls(calls).map((c) => JSON.parse(c.options.body));
  assert.strictEqual(bodies[0].uuid, bodies[1].uuid, '再送は同じUUID');
  assert.ok(text(document).includes('回答はすでに受付済みです'));
});

test('HTTPエラー・server_error は再送可能なエラー表示', async () => {
  const { document } = await reviewPage({ fetch: (url, o) => (o.method === 'POST' ? { ok: false, error: 'server_error' } : { ok: true, status: 'open', answered: false, schema_version: SV }) });
  next(document);
  await settle();
  assert.strictEqual(document.getElementById('cp-submit-error').hidden, false);
  assert.strictEqual(document.getElementById('cp-next').disabled, false);
});

test('schema_mismatch：再読み込みを促す表示（保存されない）', async () => {
  const { document, events } = await reviewPage({ fetch: (url, o) => (o.method === 'POST' ? { ok: false, error: 'schema_mismatch' } : { ok: true, status: 'open', answered: false, schema_version: SV }) });
  next(document);
  await settle();
  assert.ok(text(document).includes('ページが古くなっています'));
  assert.ok(events().some((e) => e.params && e.params.error_type === 'schema_mismatch'));
});

test('survey_closed（送信時）：未回答なら受付終了、回答済みなら「受付済み」', async () => {
  let answered = false;
  const fetchImpl = (url, o) => (o.method === 'POST' ? { ok: false, error: 'survey_closed' } : { ok: true, status: 'closed', answered, schema_version: SV });
  const a = await reviewPage({ fetch: (url, o) => (o.method === 'POST' ? { ok: false, error: 'survey_closed' } : { ok: true, status: 'open', answered: false, schema_version: SV }) });
  next(a.document);
  await settle();
  assert.ok(text(a.document).includes('アンケートの受付は終了しました'));
  // 締切直前に保存済みで応答が失われた再送
  let phase = 'open';
  const b = await reviewPage({ fetch: (url, o) => (o.method === 'POST' ? { ok: false, error: 'survey_closed' } : { ok: true, status: phase, answered: phase === 'closed', schema_version: SV }) });
  phase = 'closed';
  next(b.document);
  await settle();
  assert.ok(text(b.document).includes('回答はすでに受付済みです'));
  assert.ok(fetchImpl && answered === false);
});

test('invalid_request（サーバー検証で不備）：該当セクションへ戻りエラー表示、年齢未確認ならintroへ', async () => {
  const { document } = await reviewPage({ fetch: (url, o) => (o.method === 'POST' ? { ok: false, error: 'invalid_request', fields: [{ field: 'backdrop', code: 'required' }] } : { ok: true, status: 'open', answered: false, schema_version: SV }) });
  next(document);
  await settle();
  assert.strictEqual(pageTitle(document), '背景・世界観');
  assert.strictEqual(q(document, 'backdrop').querySelector('.cp-err').hidden, false);
  const age = await reviewPage({ fetch: (url, o) => (o.method === 'POST' ? { ok: false, error: 'invalid_request', fields: [{ field: 'age_confirmed', code: 'required' }] } : { ok: true, status: 'open', answered: false, schema_version: SV }) });
  next(age.document);
  await settle();
  assert.strictEqual(age.document.getElementById('cp-age-error').hidden, false);
});

test('invalid_request（設問以外のfield）：専用文言を出し、内部codeは画面に出さない', async () => {
  const GENERIC = '入力内容に不備があるため送信できませんでした。内容をご確認ください。';
  const cases = [
    [[{ field: 'elapsed_ms', code: 'too_fast' }], '回答が早すぎるため送信できませんでした。内容をご確認のうえ、少し時間をおいてもう一度お試しください。'],
    [[{ field: 'test_mode', code: 'disabled' }], 'テスト送信は現在無効です。管理者がLIVE_TEST_ENABLEDを有効にしてください。'],
    [[{ field: 'uuid', code: 'invalid_uuid' }], 'ブラウザ情報を確認できませんでした。ページを再読み込みしてもう一度お試しください。'],
    [[{ field: 'website', code: 'honeypot' }], GENERIC],
    [[{ field: 'mystery_field', code: 'weird_code' }], GENERIC],
    [[{ field: 'elapsed_ms', code: 'invalid_type' }], GENERIC]
  ];
  for (const [fields, expected] of cases) {
    const { document } = await reviewPage({ fetch: (url, o) => (o.method === 'POST' ? { ok: false, error: 'invalid_request', fields } : { ok: true, status: 'open', answered: false, schema_version: SV }) });
    next(document);
    await settle();
    const err = document.getElementById('cp-submit-error');
    assert.strictEqual(pageTitle(document), '送信前の確認', JSON.stringify(fields));
    assert.strictEqual(err.hidden, false);
    assert.strictEqual(err.textContent, expected, JSON.stringify(fields));
    for (const f of fields) {
      if (expected === GENERIC) { assert.ok(!err.textContent.includes(f.code), '内部codeを露出しない'); assert.ok(!err.textContent.includes(f.field)); }
    }
    assert.strictEqual(document.getElementById('cp-next').disabled, false, '再送可能');
  }
});

// ── 受付状態（status API） ──
test('status=closed：入力画面を出さず受付終了（締切はFrontendでハードコードしない）', async () => {
  const { document, calls } = await openPage({ fetch: () => ({ ok: true, status: 'closed', answered: false, schema_version: SV }) });
  assert.ok(text(document).includes('アンケートの受付は終了しました'));
  assert.strictEqual(document.getElementById('cp-form'), null);
  assert.strictEqual(postCalls(calls).length, 0);
  const html = require('fs').readFileSync(require('path').join(require('./helpers/dom').REPO, 'community/costume-portrait-survey/app.js'), 'utf8');
  assert.ok(!/\bcloses\b|deadline|締切日|2026-1[0-2]/i.test(html.replace(/受付終了|締切直前|締切/g, '')));
});

test('status=answered：入力画面を出さず「回答はすでに受付済みです」', async () => {
  const { document } = await openPage({ fetch: () => ({ ok: true, status: 'open', answered: true, schema_version: SV }) });
  assert.ok(text(document).includes('回答はすでに受付済みです'));
  assert.strictEqual(document.getElementById('cp-form'), null);
});

test('status の schema_version が異なる場合は再読み込みを促す', async () => {
  const { document } = await openPage({ fetch: () => ({ ok: true, status: 'open', answered: false, schema_version: '999' }) });
  assert.ok(text(document).includes('ページが古くなっています'));
});

test('statusに到達できなくてもフォームは表示される（最終判断は送信時にGAS）', async () => {
  const { document } = await openPage({ fetch: () => new Error('offline') });
  assert.ok(document.getElementById('cp-age'));
});

test('endpoint未設定の間は「準備中」を表示し、通信しない', async () => {
  const { document, calls } = await openPage({ endpoint: '' });
  assert.ok(text(document).includes('現在準備中です'));
  assert.strictEqual(calls.length, 0);
});

test('?test=1 は保存・通信・GA4を行わず完了画面まで確認できる／?test=closed は受付終了表示', async () => {
  const t = await openPage({ search: '?test=1' });
  assert.strictEqual(t.calls.length, 0);
  await advanceToReview(t.document);
  next(t.document);
  await settle();
  assert.ok(text(t.document).includes('ご回答ありがとうございました'));
  assert.strictEqual(t.calls.length, 0);
  assert.deepStrictEqual(t.events(), []);
  const c = await openPage({ search: '?test=closed' });
  assert.ok(text(c.document).includes('アンケートの受付は終了しました'));
  assert.strictEqual(c.calls.length, 0);
});

// ── GA4 ──
test('GA4：既存イベントのみ。UUID・回答内容・自由記述・性的指向を送らず、generate_leadを使わない', async () => {
  const { document, window, calls, events } = await openPage();
  await advanceToReview(document, (title, doc) => {
    if (title === '基本情報') choose(doc, 'sexual_orientation', 'gay');
    if (title === '自由回答・応援メッセージ') setText(window, q(doc, 'cheer_message').querySelector('textarea'), 'ひみつのメッセージ');
  });
  next(document);
  await settle();
  const uuid = JSON.parse(postCalls(calls)[0].options.body).uuid;
  const all = events();
  const names = new Set(all.map((e) => e.name));
  for (const name of names) assert.ok(['form_start', 'section_view', 'form_error', 'survey_submit'].includes(name), name);
  assert.ok(names.has('form_start') && names.has('section_view') && names.has('survey_submit'));
  assert.ok(!names.has('generate_lead'));
  const serialized = JSON.stringify(all);
  for (const secret of [uuid, 'ひみつのメッセージ', 'gay', 'bisexual', 'pref_', 'age_range', 'age_20', '7000', 'other_texts']) assert.ok(!serialized.includes(secret), secret);
  assert.ok(all.filter((e) => e.name === 'section_view').every((e) => /^costume_portrait_survey_/.test(e.params.section_id)));
  assert.strictEqual(all.filter((e) => e.name === 'survey_submit').length, 1);
});

test('GA4：重複回答（受付済み）では survey_submit を送らない', async () => {
  const { document, events } = await reviewPage({ fetch: (url, o) => (o.method === 'POST' ? { ok: false, error: 'duplicate_submission' } : { ok: true, status: 'open', answered: false, schema_version: SV }) });
  next(document);
  await settle();
  assert.ok(!events().some((e) => e.name === 'survey_submit'));
});

test('スマホ向け：viewport・ナビ固定・タップ領域（min-height）・入力16px', async () => {
  const fs = require('fs');
  const { REPO } = require('./helpers/dom');
  const css = fs.readFileSync(require('path').join(REPO, 'community/costume-portrait-survey/style.css'), 'utf8');
  const html = fs.readFileSync(require('path').join(REPO, 'community/costume-portrait-survey.html'), 'utf8');
  assert.ok(html.includes('width=device-width, initial-scale=1.0'));
  assert.match(css, /\.cp-opt\s*\{[^}]*min-height:\s*48px/);
  assert.match(css, /\.cp-btn\s*\{[^}]*min-height:\s*48px/);
  assert.match(css, /font-size:\s*16px/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.ok(visibleFieldsets);
});

test('回答ページのヒーロー直下に「現在の結果を見る」リンクがあり、結果ページへ遷移する（Issue #367）', async () => {
  const { document } = await openPage();
  const link = document.querySelector('a[href="./costume-portrait-survey-results.html"]');
  assert.ok(link);
  assert.strictEqual(link.textContent, '現在の結果を見る');
  // ヒーロー直下・アンケート本体（#cp-app）の前にある
  const hero = document.querySelector('.cp-hero');
  const app = document.getElementById('cp-app');
  assert.ok(hero.compareDocumentPosition(link) & 4, 'heroより後ろ');
  assert.ok(link.compareDocumentPosition(app) & 4, '#cp-appより前');
  assert.ok(!app.contains(link));
});

test('受付終了表示でも「現在の結果を見る」リンクは残る', async () => {
  const { document } = await openPage({ search: '?test=closed' });
  assert.ok(document.querySelector('a[href="./costume-portrait-survey-results.html"]'));
});
