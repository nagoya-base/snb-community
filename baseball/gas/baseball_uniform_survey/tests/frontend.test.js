'use strict';
// Frontend（Issue #381）：schema/core 駆動の render・route・進捗・Public GAS 連携・test mode・GA4・a11y。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const D = require('./helpers/dom');
const { loadPublic, NOW } = require('./helpers/gas-env');

const { openPage, settle, statusBody, fieldset, visibleIds, pageTitle, progressText, bodyText, answer, click, start, next, fillPage, walkToReview, schema, SITE } = D;
const plain = (x) => JSON.parse(JSON.stringify(x));
const posts = (env) => env.calls.filter((c) => c.options.method === 'POST');
const bodyOf = (call) => JSON.parse(call.options.body);
const ALLOWED_GA_EVENTS = ['form_start', 'form_error', 'survey_submit'];
const ALLOWED_GA_PARAMS = ['site_brand', 'site_section', 'page_type', 'form_name', 'error_type'];

const ROUTES = {
  attendee: { club_awareness: 'attended', last_attended: 'within_3m' },
  lapsed: { club_awareness: 'attended', last_attended: 'over_1y' },
  low_interest: { club_awareness: 'first_time', catchball_interest: 'low_interest' },
  not_interested: { club_awareness: 'aware_not_attended', catchball_interest: 'not_interested' },
  interested: { club_awareness: 'name_only', catchball_interest: 'very_interested' }
};

async function submitRoute(overrides, openOpts = {}) {
  const env = await openPage(openOpts);
  await walkToReview(env, overrides);
  click(env.document, 'bus-next');
  await settle();
  return env;
}

// ── schema 駆動の render ──

test('設問は schema から描画され、各 question type（single / multiple / single_dynamic / scale / text）が出る', async () => {
  const env = await openPage();
  assert.strictEqual(pageTitle(env.document), '回答の前にご確認ください');
  const seen = new Set();
  const types = new Set();
  await start(env);
  for (let guard = 0; guard < 40 && env.document.getElementById('bus-questions'); guard++) {
    fillPage(env, { club_awareness: 'attended', last_attended: 'over_1y', favorite_uniforms: ['baseball', 'soccer'] });
    visibleIds(env.document).forEach((id) => {
      const q = schema.questions.find((x) => x.id === id);
      seen.add(id);
      types.add(q.type);
      assert.ok(fieldset(env.document, id).querySelector('legend').textContent.includes(q.label), id);
    });
    await next(env);
  }
  ['single', 'multiple', 'single_dynamic', 'scale', 'text'].forEach((t) => assert.ok(types.has(t), t));
  assert.ok(seen.has('top_uniform') && seen.has('overall_satisfaction') && seen.has('feedback'));
  assert.deepStrictEqual(env.errors, []);
});

test('Frontend の JS/HTML に設問ID・option ID・分岐条件をベタ書きしない', () => {
  const dir = path.join(__dirname, '..', '..', '..', 'baseball-uniform-survey');
  const code = ['app.js', 'test-mode.js', 'config.js'].map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n')
    + fs.readFileSync(path.join(dir, '..', 'baseball-uniform-survey.html'), 'utf8');
  const stripped = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const ids = new Set();
  schema.questions.forEach((q) => { ids.add(q.id); (q.options || []).forEach((o) => ids.add(o.id)); });
  const hard = [...ids].filter((id) => id.length >= 7 && !['baseball', 'attended', 'overseas', 'ineligible', 'eligibility', 'website'].includes(id));
  for (const id of hard) assert.ok(!stripped.includes(`'${id}'`) && !stripped.includes(`"${id}"`), `ベタ書き: ${id}`);
  // section 見出しは schema の全 section を網羅している（欠けると画面見出しが空になる）
  const titles = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');
  new Set(schema.questions.map((q) => q.section)).forEach((section) => assert.match(titles, new RegExp(`\\b${section}:\\s*'`), section));
});

test('生成物 survey.generated.js は schema + core と一致し、server 専用 config を含まない', () => {
  const { renderFrontend, FRONTEND_TARGET } = require('../tools/build-public-gas');
  const actual = fs.readFileSync(FRONTEND_TARGET, 'utf8');
  assert.strictEqual(actual, renderFrontend());
  assert.ok(!actual.includes('SURVEY_CONFIG') && !actual.includes('opens_at'));
  assert.match(actual, /DO NOT EDIT/);
});

// ── route / branch / hidden stale ──

test('低関心 route：uniform_social_interest を出し、運営条件は省き、運動・年代・地域・自由記述は残す', async () => {
  for (const name of ['low_interest', 'not_interested']) {
    const env = await submitRoute(ROUTES[name]);
    const body = bodyOf(posts(env)[0]);
    const answers = body.answers;
    assert.ok(answers.uniform_social_interest, name);
    for (const kept of ['exercise_frequency', 'exercise_motivation', 'age', 'prefecture']) assert.ok(answers[kept], `${name}: ${kept}`);
    for (const omitted of ['preferred_program', 'preferred_schedule', 'preferred_size', 'participation_fee_tolerance', 'announcement_channels', 'near_term_participation_intent', 'barriers', 'student_activities', 'adult_sports']) {
      assert.strictEqual(answers[omitted], undefined, `${name}: ${omitted}`);
    }
    assert.ok(answers.exercise_continuation_motivation, '運動している該当者には継続要因も聞く');
    assert.strictEqual(env.document.querySelector('.bus-message') !== null, true);
  }
});

test('低関心 route：肯定メッセージと pure_uniform の案内、feedback / support_message を最後に表示', async () => {
  const env = await openPage();
  await start(env);
  for (let guard = 0; guard < 20; guard++) {
    fillPage(env, ROUTES.low_interest);
    if (visibleIds(env.document).includes('catchball_interest')) {
      const ack = fieldset(env.document, 'catchball_interest').querySelector('.bus-ack');
      assert.strictEqual(ack.hidden, false);
      assert.match(ack.textContent, /参加への関心が薄いという回答も、今後の企画を考えるうえで大切な回答/);
    }
    if (pageTitle(env.document) === 'あなたについて') {
      assert.match(bodyText(env.document), /キャッチボール会についての詳しい運営質問はここで終了です/);
    }
    if (visibleIds(env.document).includes('feedback')) {
      assert.ok(visibleIds(env.document).includes('support_message'));
      break;
    }
    await next(env);
  }
  assert.ok(visibleIds(env.document).includes('support_message'));
});

test('attendee / lapsed route：満足度 scale（notApplicable 含む）と離脱理由・再参加条件が出る', async () => {
  const attendee = await submitRoute(Object.assign({ overall_satisfaction: 'cannot_rate' }, ROUTES.attendee));
  const a = bodyOf(posts(attendee)[0]).answers;
  assert.strictEqual(a.overall_satisfaction, 'cannot_rate');
  assert.ok(a.satisfaction_atmosphere && a.repeat_intent && a.pre_attendance_worries);
  assert.strictEqual(a.attendance_lapse_reasons, undefined);
  assert.strictEqual(a.catchball_interest, undefined);

  const lapsed = await submitRoute(ROUTES.lapsed);
  const l = bodyOf(posts(lapsed)[0]).answers;
  assert.ok(l.attendance_lapse_reasons && l.rejoin_conditions);
  assert.ok(l.preferred_program, '参加経験者も運営設問に進む');
});

test('required / other / exclusive：未入力は進めず、aria-live と focus で通知する', async () => {
  const env = await openPage();
  await start(env);
  click(env.document, 'bus-next'); // age_confirmed 未回答
  await settle();
  const summary = env.document.getElementById('bus-summary');
  assert.strictEqual(summary.hidden, false);
  assert.strictEqual(summary.getAttribute('role'), 'alert');
  const err = env.document.getElementById('bus-err-age_confirmed');
  assert.strictEqual(err.hidden, false);
  assert.strictEqual(err.getAttribute('aria-live'), 'polite');
  assert.strictEqual(env.document.activeElement.closest('fieldset').getAttribute('data-qid'), 'age_confirmed');
  assert.strictEqual(env.document.activeElement.getAttribute('aria-invalid'), 'true');
  assert.strictEqual(pageTitle(env.document), '回答の前に');
  answer(env, 'age_confirmed', 'yes');
  assert.strictEqual(err.hidden, true, '回答するとエラーが消える');
  await next(env);

  // multiple の exclusive と other 本文
  answer(env, 'favorite_uniforms', ['baseball', 'other']);
  const box = fieldset(env.document, 'favorite_uniforms').querySelector('.bus-other');
  assert.strictEqual(box.hidden, false);
  assert.strictEqual(fieldset(env.document, 'top_uniform').querySelectorAll('input').length, 2, 'other もID「other」の候補になる');
  await next(env);
  assert.strictEqual(pageTitle(env.document), 'ユニフォームについて', 'other 本文が空なので進めない');
  assert.match(env.document.getElementById('bus-err-favorite_uniforms').textContent, /「その他」の内容/);
  answer(env, 'favorite_uniforms', ['none']);
  const checked = Array.from(fieldset(env.document, 'favorite_uniforms').querySelectorAll('input:checked')).map((i) => i.value);
  assert.deepStrictEqual(checked, ['none'], 'exclusive は他の選択を解除する');
  assert.strictEqual(visibleIds(env.document).includes('top_uniform'), false, 'none だけなら top_uniform は hidden');
});

test('hidden になった設問は DOM から消え（tab 順に残らない）、値は payload に残らない', async () => {
  const env = await openPage();
  await walkToReview(env, ROUTES.attendee);
  // 直前に回答した attendee 設問があるが、club_awareness を変更して branch を切り替える
  click(env.document, 'bus-back-btn');
  await settle();
  const pagesBack = [];
  for (let i = 0; i < 20 && pageTitle(env.document) !== '名古屋野球ユニ部について'; i++) { click(env.document, 'bus-back-btn'); await settle(); pagesBack.push(pageTitle(env.document)); }
  assert.strictEqual(pageTitle(env.document), '名古屋野球ユニ部について');
  answer(env, 'club_awareness', 'first_time');
  assert.strictEqual(visibleIds(env.document).includes('attendance_count'), false);
  await walkToReview(env, Object.assign({}, ROUTES.low_interest, { club_awareness: 'first_time' }));
  // 既に club ページ上なので、次へ進めて review まで
  for (let i = 0; i < 20 && env.document.getElementById('bus-questions'); i++) { fillPage(env, ROUTES.low_interest); await next(env); }
  click(env.document, 'bus-next');
  await settle();
  const body = bodyOf(posts(env)[0]);
  ['attendance_count', 'last_attended', 'overall_satisfaction', 'repeat_intent', 'pre_attendance_worries'].forEach((id) => assert.strictEqual(body.answers[id], undefined, id));
  const stale = env.window.SurveyCore.findStaleValues(schema, body.answers, body.other_texts);
  assert.deepStrictEqual(plain(stale), []);
});

test('海外選択時だけ residence_country（1行入力）が出て、必須。国内へ変更すると値が破棄され payload に残らない', async () => {
  const env = await openPage();
  await walkToReview(env, { club_awareness: 'first_time', catchball_interest: 'low_interest' });
  // review まで進んだ後、profile ページへ戻って prefecture を切り替える
  for (let i = 0; i < 20 && !visibleIds(env.document).includes('prefecture'); i++) { click(env.document, 'bus-back-btn'); await settle(); }
  assert.strictEqual(visibleIds(env.document).includes('residence_country'), false);
  answer(env, 'prefecture', 'overseas');
  const fs_ = fieldset(env.document, 'residence_country');
  assert.ok(fs_, '海外選択で表示');
  const input = Array.from(fs_.children).find((c) => c.tagName === 'INPUT');
  assert.strictEqual(input.type, 'text', '1行入力');
  assert.strictEqual(input.maxLength, 60);
  assert.strictEqual(fs_.querySelector('textarea'), null);
  await next(env);
  assert.strictEqual(visibleIds(env.document).includes('residence_country'), true, '未入力では次へ進めない');
  assert.strictEqual(env.document.getElementById('bus-err-residence_country').hidden, false);
  answer(env, 'residence_country', 'ひみつの国');
  answer(env, 'prefecture', 'pref_13');
  assert.strictEqual(visibleIds(env.document).includes('residence_country'), false, '国内へ変更で非表示');
  answer(env, 'prefecture', 'overseas');
  assert.strictEqual(Array.from(fieldset(env.document, 'residence_country').children).find((c) => c.tagName === 'INPUT').value, '', '再表示時に旧値は残らない');
  answer(env, 'prefecture', 'pref_13');
  for (let i = 0; i < 20 && env.document.getElementById('bus-questions'); i++) { fillPage(env, ROUTES.low_interest); await next(env); }
  click(env.document, 'bus-next');
  await settle();
  const body = bodyOf(posts(env)[0]);
  assert.strictEqual(body.answers.residence_country, undefined);
  assert.ok(!JSON.stringify(body).includes('ひみつの国'));
});

test('海外 route の payload（residence_country あり）は Public GAS の server validation を通る', async () => {
  const env = await submitRoute(Object.assign({}, ROUTES.low_interest, { prefecture: 'overseas', residence_country: 'カナダ' }));
  const body = bodyOf(posts(env)[0]);
  assert.strictEqual(body.answers.residence_country, 'カナダ');
  body.elapsed_ms = 90000;
  const { env: gas, ctx } = loadPublic();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.processSubmission_(JSON.stringify(body), NOW))), { ok: true, status: 'accepted' });
});

test('single_dynamic：source の選択変更で旧値が消え、1件なら自動選択される', async () => {
  const env = await openPage();
  await start(env);
  answer(env, 'age_confirmed', 'yes');
  await next(env);
  answer(env, 'favorite_uniforms', ['baseball']);
  assert.strictEqual(fieldset(env.document, 'top_uniform').querySelector('input:checked').value, 'baseball', 'autoSelectIfSingle');
  answer(env, 'favorite_uniforms', ['soccer']);
  assert.strictEqual(fieldset(env.document, 'top_uniform').querySelector('input:checked').value, 'soccer');
  answer(env, 'favorite_uniforms', ['soccer', 'rugby']);
  assert.strictEqual(fieldset(env.document, 'top_uniform').querySelectorAll('input').length, 2);
  assert.strictEqual(fieldset(env.document, 'top_uniform').querySelector('input:checked').value, 'soccer', '候補に残る旧値は維持');
  answer(env, 'top_uniform', 'rugby');
  answer(env, 'favorite_uniforms', ['soccer']);
  assert.strictEqual(fieldset(env.document, 'top_uniform').querySelector('input:checked').value, 'soccer', 'rugby が候補から外れたので旧値は除去され自動選択');
  answer(env, 'favorite_uniforms', ['soccer', 'rugby']);
  answer(env, 'top_uniform', 'rugby');
  answer(env, 'favorite_uniforms', ['none']);
  assert.strictEqual(visibleIds(env.document).includes('top_uniform'), false, 'source が none だけなら hidden');
});

// ── 18歳未満 ──

test('age_confirmed=no は回答を破棄して終了し、server へ何も送らない', async () => {
  const env = await openPage();
  await start(env);
  answer(env, 'age_confirmed', 'no');
  await next(env);
  assert.strictEqual(pageTitle(env.document), 'このアンケートは18歳以上の方が対象です');
  assert.match(bodyText(env.document), /回答内容は保存されていません/);
  assert.strictEqual(posts(env).length, 0);
  assert.strictEqual(env.events().some((e) => e.name === 'survey_submit'), false);
});

// ── 進捗 ──

test('進捗は visible route を分母にし、単調で、GA4 に送らない。所要時間は5〜12分で統一', async () => {
  for (const route of [ROUTES.low_interest, ROUTES.attendee]) {
    const env = await openPage();
    assert.match(bodyText(env.document), /5〜12分程度/);
    await start(env);
    const percents = [];
    const minutes = [];
    for (let guard = 0; guard < 40 && env.document.getElementById('bus-questions'); guard++) {
      fillPage(env, route);
      const text = progressText(env.document);
      if (/あなたに必要な質問だけを表示します/.test(text)) {
        // ルート確定前は割合・残り時間を出さない（過小表示を避ける）
        assert.match(text, /^現在 \d+ セクション目　あなたに必要な質問だけを表示します$/);
        assert.strictEqual(env.document.querySelector('[role="progressbar"]').hasAttribute('aria-valuenow'), false);
        await next(env);
        continue;
      }
      assert.match(text, /^現在 \d+\/\d+ セクション　全体の約\d+%　(残り約\d+分|まもなく完了)$/);
      percents.push(Number(/約(\d+)%/.exec(text)[1]));
      const m = /残り約(\d+)分/.exec(text);
      minutes.push(m ? Number(m[1]) : 0);
      await next(env);
    }
    for (let i = 1; i < percents.length; i++) assert.ok(percents[i] >= percents[i - 1], `percent ${percents.join(',')}`);
    for (let i = 1; i < minutes.length; i++) assert.ok(minutes[i] <= minutes[i - 1], `minutes ${minutes.join(',')}`);
    assert.ok(percents.length >= 3, 'ルート確定後の進捗が表示される');
    assert.ok(minutes[0] <= 12, '最長でも12分以内の表示');
    const sections = /現在 (\d+)\/(\d+)/.exec(progressText(env.document));
    assert.strictEqual(sections[1], sections[2], '最後は N/N');
  }
  // 低関心 route の分母は最長 route より小さい
  const low = await openPage();
  await start(low);
  for (let i = 0; i < 4 && !/\/\d+ セクション/.test(progressText(low.document)); i++) { fillPage(low, ROUTES.low_interest); await next(low); }
  fillPage(low, ROUTES.low_interest);
  const total = Number(/\/(\d+) セクション/.exec(progressText(low.document))[1]);
  const full = await openPage();
  await walkToReview(full, ROUTES.attendee);
  const fullTotal = Number(/\/(\d+) セクション/.exec(progressText(full.document))[1]);
  assert.ok(total <= fullTotal);
});

test('milestone：ユニフォーム設問終了後と運営条件の前に schema の文言を表示する', async () => {
  const env = await openPage();
  await start(env);
  let sawUniform = false;
  let sawOperations = false;
  for (let guard = 0; guard < 40 && env.document.getElementById('bus-questions'); guard++) {
    const text = bodyText(env.document);
    if (text.includes(schema.sectionUx.milestones[0].message)) sawUniform = true;
    if (text.includes(schema.sectionUx.milestones[1].message)) sawOperations = true;
    fillPage(env, ROUTES.interested);
    await next(env);
  }
  assert.ok(sawUniform, 'ここまでがユニフォームについての質問です');
  assert.ok(sawOperations, 'ここからは、実際に参加を検討している方向けの質問です');
  // 低関心 route では運営向けの milestone を出さない
  const low = await openPage();
  await start(low);
  let operations = false;
  for (let guard = 0; guard < 40 && low.document.getElementById('bus-questions'); guard++) {
    if (bodyText(low.document).includes(schema.sectionUx.milestones[1].message)) operations = true;
    fillPage(low, ROUTES.low_interest);
    await next(low);
  }
  assert.strictEqual(operations, false);
});

test('用語統一：団体は名古屋野球ユニ部、運動イベントはキャッチボール会。旧称を使わない', async () => {
  const env = await openPage();
  const html = fs.readFileSync(path.join(D.REPO, D.PAGE), 'utf8') + fs.readFileSync(path.join(D.REPO, 'baseball/baseball-uniform-survey/app.js'), 'utf8');
  assert.match(bodyText(env.document), /名古屋野球ユニ部/);
  assert.match(bodyText(env.document), /キャッチボール会/);
  assert.ok(!/野球ユニ部(?!ア)/.test(html.replace(/名古屋野球ユニ部/g, '')) , '「名古屋」を欠いた団体名がない');
  assert.ok(!/キャッチボール(?!会)/.test(html), 'キャッチボール会以外の呼称がない');
  assert.ok(!/ユニ交流|ユニフォーム会/.test(html));
});

// ── Public GAS 連携 ──

test('status API：open / not_open / closed / not_configured / schema 不一致 / 取得失敗', async () => {
  const cases = [
    ['open', '回答の前にご確認ください'],
    ['not_open', 'アンケートはまだ始まっていません'],
    ['closed', 'アンケートの受付は終了しました'],
    ['not_configured', '現在準備中です']
  ];
  for (const [status, title] of cases) {
    const env = await openPage({ fetch: () => statusBody(status) });
    assert.strictEqual(pageTitle(env.document), title, status);
    assert.strictEqual(env.calls.length, 1);
    assert.match(env.calls[0].url, /\?action=status$/);
    assert.strictEqual(env.document.getElementById('bus-next') !== null, status === 'open');
  }
  const mismatch = await openPage({ fetch: () => statusBody('open', { schema_version: '0' }) });
  assert.strictEqual(pageTitle(mismatch.document), 'ページが古くなっています');
  // status に到達できなくても入力画面は出る（最終判断は送信時に server が行う）
  const failed = await openPage({ fetch: () => new Error('offline') });
  assert.strictEqual(pageTitle(failed.document), '回答の前にご確認ください');
  // endpoint 未設定は通信せず準備中
  const none = await openPage({ endpoint: '' });
  assert.strictEqual(pageTitle(none.document), '現在準備中です');
  assert.strictEqual(none.calls.length, 0);
});

test('production submit：POST 仕様どおり（text/plain・必須key・sanitize済み）、成功後だけ完了画面と survey_submit', async () => {
  const env = await submitRoute(Object.assign({ feedback: '=自由記述' }, ROUTES.attendee));
  assert.strictEqual(posts(env).length, 1);
  const call = posts(env)[0];
  assert.strictEqual(call.url, D.ENDPOINT);
  assert.strictEqual(call.options.headers['Content-Type'], 'text/plain;charset=utf-8');
  const body = bodyOf(call);
  assert.deepStrictEqual(plain(Object.keys(body)).sort(), ['answers', 'elapsed_ms', 'other_texts', 'schema_version', 'uuid']);
  assert.strictEqual(body.schema_version, schema.schema_version);
  assert.match(body.uuid, /^[0-9a-f-]{36}$/i);
  assert.strictEqual(typeof body.elapsed_ms, 'number');
  assert.strictEqual(body.answers.feedback, '=自由記述', 'Formula対策はserver側。Frontendは入力をそのまま送る');
  assert.strictEqual(pageTitle(env.document), 'ご回答ありがとうございました');
  const events = env.events().map((e) => e.name);
  assert.deepStrictEqual(plain(events.filter((n) => n === 'survey_submit')), ['survey_submit']);
});

test('Frontend が作る payload は Public GAS（#380）の server validation を全 route で通る', async () => {
  for (const [name, route] of Object.entries(ROUTES)) {
    const env = await submitRoute(route);
    const body = bodyOf(posts(env)[0]);
    body.elapsed_ms = 90000; // 自動テストの経過時間は短いため、最短回答時間の検査だけ差し替える
    const { env: gas, ctx } = loadPublic();
    const result = JSON.parse(JSON.stringify(ctx.processSubmission_(JSON.stringify(body), NOW)));
    assert.deepStrictEqual(result, { ok: true, status: 'accepted' }, name);
    assert.strictEqual(gas.spreadsheet.getSheetByName('responses').rows.length, 2, name);
  }
});

test('source_channel：allowlist の query だけを送り、それ以外は送らない', async () => {
  const ok = await submitRoute(ROUTES.attendee, { search: '?src=line' });
  assert.strictEqual(bodyOf(posts(ok)[0]).source_channel, 'line');
  const bad = await submitRoute(ROUTES.attendee, { search: '?src=campaign-taro' });
  assert.strictEqual(bodyOf(posts(bad)[0]).source_channel, undefined);
  const none = await submitRoute(ROUTES.attendee);
  assert.strictEqual(bodyOf(posts(none)[0]).source_channel, undefined);
});

test('二重クリック/多重送信を UI で抑止する（送信中は disabled / aria-busy）', async () => {
  let resolvePost;
  const env = await openPage({ fetch: (url, options) => (options.method === 'POST' ? new Promise((r) => { resolvePost = r; }) : statusBody('open')) });
  await walkToReview(env, ROUTES.attendee);
  const button = env.document.getElementById('bus-next');
  button.click(); button.click(); button.click();
  await settle();
  assert.strictEqual(posts(env).length, 1);
  assert.strictEqual(button.disabled, true);
  assert.strictEqual(button.getAttribute('aria-busy'), 'true');
  assert.match(button.textContent, /送信中/);
  resolvePost({ ok: true, status: 'accepted' });
  await settle();
  assert.strictEqual(pageTitle(env.document), 'ご回答ありがとうございました');
  assert.strictEqual(posts(env).length, 1);
});

const FAILURES = {
  'duplicate_submission': [{ ok: false, error: 'duplicate_submission' }, 'ご回答はすでに受付済みです'.replace('ご回答は', '回答は')],
  'schema_mismatch': [{ ok: false, error: 'schema_mismatch' }, 'ページが古くなっています'],
  'survey_closed': [{ ok: false, error: 'survey_closed' }, 'アンケートの受付は終了しました'],
  'survey_not_open': [{ ok: false, error: 'survey_not_open' }, 'アンケートはまだ始まっていません'],
  'survey_not_configured': [{ ok: false, error: 'survey_not_configured' }, '現在準備中です']
};
for (const [code, [response, title]] of Object.entries(FAILURES)) {
  test(`submit 応答 ${code}：回答者向け文言に変換し、技術語を出さず、成功扱い(survey_submit)にしない`, async () => {
    const env = await submitRoute(ROUTES.attendee, { fetch: (url, options) => (options.method === 'POST' ? response : statusBody('open')) });
    assert.strictEqual(pageTitle(env.document), title);
    assert.ok(!/duplicate_submission|schema_mismatch|survey_closed|survey_not|server_error|invalid_request/.test(bodyText(env.document)));
    const names = env.events().map((e) => e.name);
    assert.strictEqual(names.includes('survey_submit'), code === 'duplicate_submission' ? false : false);
    if (code !== 'duplicate_submission') assert.ok(names.includes('form_error'));
    env.events().filter((e) => e.name === 'form_error').forEach((e) => assert.ok(/^[a-z_]+$/.test(e.params.error_type)));
  });
}

test('submit 応答 invalid_request：該当設問のページへ戻りエラー表示。envelope 系は汎用文言', async () => {
  const env = await submitRoute(ROUTES.attendee, {
    fetch: (url, options) => (options.method === 'POST' ? { ok: false, error: 'invalid_request', fields: [{ field: 'age', code: 'invalid_option' }] } : statusBody('open'))
  });
  assert.strictEqual(pageTitle(env.document), 'あなたについて');
  assert.strictEqual(env.document.getElementById('bus-err-age').hidden, false);
  const fast = await submitRoute(ROUTES.attendee, {
    fetch: (url, options) => (options.method === 'POST' ? { ok: false, error: 'invalid_request', fields: [{ field: 'elapsed_ms', code: 'too_fast' }] } : statusBody('open'))
  });
  assert.match(bodyText(fast.document), /回答が早すぎる/);
  assert.ok(!/elapsed_ms|too_fast/.test(bodyText(fast.document)));
  assert.strictEqual(fast.document.getElementById('bus-next').disabled, false, '再送できる');
});

test('通信失敗・server_error は入力を保持して再送できる', async () => {
  for (const response of [new Error('offline'), { ok: false, error: 'server_error' }]) {
    const env = await submitRoute(ROUTES.attendee, { fetch: (url, options) => (options.method === 'POST' ? response : statusBody('open')) });
    assert.strictEqual(env.document.getElementById('bus-next').disabled, false);
    assert.match(env.document.getElementById('bus-summary').textContent, /送信に失敗しました/);
    assert.strictEqual(env.document.getElementById('bus-summary').hidden, false);
    assert.ok(env.events().every((e) => e.name !== 'survey_submit'));
  }
});

// ── test mode ──

test('結果ページ連携（#382）：本番の完了画面だけが、存在する公開結果ページへリンクする（test mode では出さない）', async () => {
  const REPO = path.join(__dirname, '..', '..', '..', '..');
  const prod = await submitRoute(ROUTES.attendee);
  const link = prod.document.querySelector('#bus-app a[href="baseball-uniform-survey-results.html"]');
  assert.ok(link, '公開結果へのリンク');
  assert.strictEqual(link.textContent, '公開結果のページへ');
  assert.ok(fs.existsSync(path.join(REPO, 'baseball', link.getAttribute('href'))), 'リンク先のページが存在する');
  const preview = await openPage({ hash: '#test=preview_no_submit' });
  await walkToReview(preview, ROUTES.low_interest);
  click(preview.document, 'bus-next');
  await settle();
  assert.strictEqual(preview.document.querySelector('#bus-app a[href*="results"]'), null);
});

test('preview_no_submit：入力→確認→完了まで確認でき、通信・GA4 を一切行わない', async () => {
  const env = await openPage({ hash: '#test=preview_no_submit' });
  assert.match(env.document.getElementById('bus-test-banner').textContent, /プレビュー/);
  await walkToReview(env, ROUTES.low_interest);
  click(env.document, 'bus-next');
  await settle();
  assert.match(pageTitle(env.document), /プレビュー完了/);
  assert.match(bodyText(env.document), /サーバーへは何も送っていません/);
  assert.strictEqual(env.calls.length, 0);
  assert.strictEqual(env.window.dataLayer, undefined);
  assert.strictEqual(env.window.gtag, undefined);
});

test('closed_view：受付終了表示だけを確認でき、通信・GA4 を行わない', async () => {
  const env = await openPage({ hash: '#test=closed_view' });
  assert.strictEqual(pageTitle(env.document), 'アンケートの受付は終了しました');
  assert.match(env.document.getElementById('bus-test-banner').textContent, /終了後表示/);
  assert.strictEqual(env.document.getElementById('bus-next'), null);
  assert.strictEqual(env.calls.length, 0);
  assert.strictEqual(env.window.dataLayer, undefined);
});

const SECRET = 'SECRET-test-token-0123456789abcdef';
test('submit_excluded：fragment の token を sessionStorage 経由で POST body にだけ載せ、test 完了を production と見分けられる', async () => {
  const env = await openPage({ hash: `#test=submit_excluded&token=${SECRET}&run=run_2026_a`, fetch: (url, options) => (options.method === 'POST' ? { ok: true, status: 'accepted_test', test: true } : statusBody('open')) });
  // fragment は即座に URL から除去され、query string にも出ない
  assert.strictEqual(env.window.location.hash, '');
  assert.ok(!env.window.location.href.includes(SECRET));
  assert.ok(!env.window.location.search.includes('token'));
  assert.ok(env.window.sessionStorage.getItem('snb_baseball_uniform_survey_test_v1').includes(SECRET));
  await walkToReview(env, ROUTES.interested);
  click(env.document, 'bus-next');
  await settle();
  const call = posts(env)[0];
  const body = bodyOf(call);
  assert.strictEqual(body.test_token, SECRET);
  assert.strictEqual(body.test_run_id, 'run_2026_a');
  assert.strictEqual(body.response_mode, undefined, 'client 申告の response_mode は送らない');
  // token が URL（GET/POST とも）・DOM・GA4 のどこにも出ない
  env.calls.forEach((c) => assert.ok(!c.url.includes(SECRET) && !c.url.includes('token')));
  assert.ok(!env.document.documentElement.outerHTML.includes(SECRET));
  assert.ok(!JSON.stringify(env.window.dataLayer || []).includes(SECRET));
  assert.strictEqual(env.window.dataLayer, undefined, 'test mode は GA4 を初期化しない');
  assert.match(pageTitle(env.document), /テスト送信を受け付けました（集計対象外）/);
  assert.notStrictEqual(pageTitle(env.document), 'ご回答ありがとうございました');
  assert.match(env.document.getElementById('bus-test-banner').textContent, /TEST MODE/);
  assert.ok(env.document.querySelector('.bus-test-chip'));
  // test 送信は status を取らない（受付期間に依存しない）
  assert.strictEqual(env.calls.filter((c) => c.options.method !== 'POST').length, 0);
});

test('submit_excluded：endpoint が読み込み後に設定されても（Local Override）送信でき、「準備中」で止まらない', async () => {
  const env = await openPage({ endpoint: '', hash: `#test=submit_excluded&token=${SECRET}&run=run_override`, fetch: () => ({ ok: true, status: 'accepted_test', test: true }) });
  assert.strictEqual(env.calls.length, 0, 'test mode は起動時に通信しない');
  env.window.BASEBALL_UNIFORM_SURVEY_CONFIG.endpoint = D.ENDPOINT;
  await walkToReview(env, ROUTES.interested);
  click(env.document, 'bus-next');
  await settle();
  assert.strictEqual(posts(env).length, 1);
  assert.strictEqual(posts(env)[0].url, D.ENDPOINT);
  assert.match(pageTitle(env.document), /テスト送信を受け付けました（集計対象外）/);
});

test('submit_excluded：endpoint が未設定のままなら通信せず準備中の案内で止まる', async () => {
  const env = await openPage({ endpoint: '', hash: `#test=submit_excluded&token=${SECRET}&run=run_none` });
  await walkToReview(env, ROUTES.interested);
  click(env.document, 'bus-next');
  await settle();
  assert.strictEqual(env.calls.length, 0);
});

test('submit_excluded：リロードしても sessionStorage から継続し、「テストを終了」で解除できる', async () => {
  const stored = JSON.stringify({ mode: 'submit_excluded', token: SECRET, run: 'run_x' });
  const env = await openPage({ storage: { snb_baseball_uniform_survey_test_v1: stored } });
  assert.match(env.document.getElementById('bus-test-banner').textContent, /テスト送信/);
  assert.ok(!env.document.documentElement.outerHTML.includes(SECRET));
  env.document.querySelector('.bus-test-exit').click();
  assert.strictEqual(env.window.sessionStorage.getItem('snb_baseball_uniform_survey_test_v1'), null);
});

test('submit_excluded：test_run_id が無ければ生成する', async () => {
  const gen = await openPage({ hash: `#test=submit_excluded&token=${SECRET}` });
  assert.match(JSON.parse(gen.window.sessionStorage.getItem('snb_baseball_uniform_survey_test_v1')).run, /^run_[0-9a-f]{12}$/);
  assert.strictEqual(gen.window.SNB_BASEBALL_SURVEY_TEST_MODE, 'submit_excluded');
});

test('test 指定の検証失敗は fail closed：GA4なし・status GETなし・POSTなしで設定エラーだけを表示する', async () => {
  const cases = [
    ['#test=submit_excluded', {}],
    ['#test=unknown', {}],
    ['#test=submit_excluded&token=x&run=bad run', {}],
    ['#test=submit_excluded&token=&run=r1', {}],
    ['#token=abc&run=r1', {}],
    ['', { search: '?test=submit_excluded&token=abc' }],
    ['', { search: '?test=preview_no_submit' }],
    ['', { storage: { snb_baseball_uniform_survey_test_v1: '{broken' } }],
    ['', { storage: { snb_baseball_uniform_survey_test_v1: JSON.stringify({ mode: 'submit_excluded' }) } }]
  ];
  for (const [hash, extra] of cases) {
    const env = await openPage(Object.assign({ hash }, extra));
    const label = hash + JSON.stringify(extra);
    assert.strictEqual(env.window.SNB_BASEBALL_SURVEY_TEST_MODE, 'invalid_test_config', label);
    assert.strictEqual(pageTitle(env.document), 'テスト用URLの設定が正しくありません', label);
    assert.match(env.document.getElementById('bus-test-banner').textContent, /設定エラー/, label);
    assert.strictEqual(env.calls.length, 0, `${label}: status GET も POST も行わない`);
    assert.strictEqual(env.window.dataLayer, undefined, `${label}: GA4 を初期化しない`);
    assert.strictEqual(env.window.gtag, undefined, label);
    assert.strictEqual(env.document.getElementById('bus-next'), null, `${label}: 回答を始められない`);
    assert.strictEqual(env.document.querySelectorAll('fieldset').length, 0, label);
    assert.ok(!env.window.location.hash && !env.document.documentElement.outerHTML.includes('token=abc'), label);
  }
});

test('fail closed はリロードしても production に戻らず、「テストを終了」で解除できる', async () => {
  const first = await openPage({ hash: '#test=submit_excluded&token=x&run=bad run' });
  const stored = first.window.sessionStorage.getItem('snb_baseball_uniform_survey_test_v1');
  assert.ok(stored);
  // fragment は URL から除去済み。同じタブをリロード（storage は保持）しても設定エラーのまま
  const reloaded = await openPage({ storage: { snb_baseball_uniform_survey_test_v1: stored } });
  assert.strictEqual(pageTitle(reloaded.document), 'テスト用URLの設定が正しくありません');
  assert.strictEqual(reloaded.calls.length, 0);
  assert.strictEqual(reloaded.window.dataLayer, undefined);
  reloaded.document.querySelector('.bus-test-exit').click();
  assert.strictEqual(reloaded.window.sessionStorage.getItem('snb_baseball_uniform_survey_test_v1'), null);
  // 解除後は通常の production として起動する
  const normal = await openPage();
  assert.strictEqual(normal.window.SNB_BASEBALL_SURVEY_TEST_MODE, null);
  assert.strictEqual(pageTitle(normal.document), '回答の前にご確認ください');
  assert.ok(normal.window.dataLayer);
});

test('production 起動の条件：test 指定が一切ないときだけ（?src= など無関係な query は production）', async () => {
  const env = await openPage({ search: '?src=line' });
  assert.strictEqual(env.window.SNB_BASEBALL_SURVEY_TEST_MODE, null);
  assert.ok(env.window.dataLayer);
  assert.strictEqual(env.calls.length, 1);
  const frag = await openPage({ hash: '#section-1' });
  assert.strictEqual(frag.window.SNB_BASEBALL_SURVEY_TEST_MODE, null);
});

test('submit_excluded：テストの重複は新しい test_run_id を案内し、token 不正は技術語なしで案内', async () => {
  const dup = await submitRoute(ROUTES.attendee, { hash: `#test=submit_excluded&token=${SECRET}&run=r1`, fetch: (url, options) => (options.method === 'POST' ? { ok: false, error: 'duplicate_submission' } : statusBody('open')) });
  assert.match(pageTitle(dup.document), /このテスト実行では送信済み/);
  const bad = await submitRoute(ROUTES.attendee, { hash: `#test=submit_excluded&token=${SECRET}&run=r1`, fetch: (url, options) => (options.method === 'POST' ? { ok: false, error: 'invalid_request', fields: [{ field: 'test_token', code: 'invalid_token' }] } : statusBody('open')) });
  assert.match(bodyText(bad.document), /テスト用の設定が正しくありません/);
  assert.ok(!bodyText(bad.document).includes('invalid_token'));
  assert.ok(!bodyText(bad.document).includes(SECRET));
});

// ── GA4 ──

test('production の GA4：許可イベントのみ。section_view・設問/section/route ID・進捗・回答値・UUID を送らない', async () => {
  const env = await submitRoute(Object.assign({ feedback: '自由記述の本文' }, ROUTES.lapsed));
  const events = env.events();
  assert.ok(events.length > 0);
  events.forEach((e) => {
    assert.ok(ALLOWED_GA_EVENTS.includes(e.name), e.name);
    Object.keys(e.params).forEach((k) => assert.ok(ALLOWED_GA_PARAMS.includes(k), `${e.name}.${k}`));
  });
  assert.deepStrictEqual(plain(events.map((e) => e.name).filter((n) => n !== 'form_error')), ['form_start', 'survey_submit']);
  const dump = JSON.stringify(env.window.dataLayer);
  const body = bodyOf(posts(env)[0]);
  assert.ok(!dump.includes(body.uuid) && !dump.includes('自由記述の本文'));
  for (const q of schema.questions) assert.ok(!dump.includes(q.id) || ALLOWED_GA_PARAMS.includes(q.id) || q.id.length < 4, q.id);
  assert.ok(!/section_view|progress|route|percent/.test(dump));
  assert.strictEqual(env.document.querySelectorAll('[data-section-view], [data-cta-name], [data-outbound-channel], [data-question], [data-section], [data-route]').length, 0, 'survey 固有値を data-* に埋めて自動計測させない');
});

test('form_error は error type のみ（設問IDや内容を含めない）', async () => {
  const env = await openPage();
  await start(env);
  click(env.document, 'bus-next');
  await settle();
  const errs = env.events().filter((e) => e.name === 'form_error');
  assert.strictEqual(errs.length, 1);
  assert.deepStrictEqual(plain(errs[0].params), { site_brand: 'snbc', site_section: 'baseball', page_type: 'survey', form_name: 'baseball_uniform_survey', error_type: 'validation' });
});

// ── analytics.js の page-level opt-out と既存ページの回帰 ──

async function analyticsDom(bodyAttrs, html = '') {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body ${bodyAttrs}>${html}</body></html>`, {
    url: SITE + 'x.html', runScripts: 'outside-only', pretendToBeVisual: true,
    beforeParse(window) {
      window.dataLayer = [];
      window.gtag = function () { window.dataLayer.push(arguments); };
      window.IntersectionObserver = function (cb) {
        this.observe = (target) => cb([{ isIntersecting: true, target }]);
        this.unobserve = () => {};
      };
    }
  });
  dom.window.eval(fs.readFileSync(path.join(D.REPO, 'analytics.js'), 'utf8'));
  await settle();
  return dom.window;
}
const sectionEvents = (w) => Array.from(w.dataLayer).map((a) => Array.from(a)).filter((a) => a[0] === 'event' && a[1] === 'section_view');

test('analytics.js：opt-out なしのページは従来どおり section_view を送る（回帰）', async () => {
  const w = await analyticsDom('data-page-type="top"', '<section data-section-view="hero"></section><section data-section-view="faq"></section>');
  assert.deepStrictEqual(plain(sectionEvents(w).map((e) => e[2].section_id)), ['hero', 'faq']);
  w.SNBAnalytics.trackSectionView('manual');
  assert.strictEqual(sectionEvents(w).length, 3);
  w.SNBAnalytics.trackSectionView('manual'); // 同一 section は1回
  assert.strictEqual(sectionEvents(w).length, 3);
});

test('analytics.js：data-disable-section-view="true" のページは自動・手動とも section_view を送らず、他イベントは維持', async () => {
  const w = await analyticsDom('data-disable-section-view="true"', '<section data-section-view="hero"></section><a data-cta-name="x" href="#">x</a>');
  w.SNBAnalytics.trackSectionView('manual');
  w.SNBAnalytics.track('section_view', { section_id: 'direct' });
  assert.strictEqual(sectionEvents(w).length, 0);
  w.document.querySelector('a').click();
  w.SNBAnalytics.trackFormStart('f');
  const names = Array.from(w.dataLayer).map((a) => Array.from(a)).filter((a) => a[0] === 'event').map((a) => a[1]);
  assert.deepStrictEqual(plain(names), ['cta_click', 'form_start']);
  // "true" 以外は opt-out にならない
  const other = await analyticsDom('data-disable-section-view="false"', '<section data-section-view="hero"></section>');
  assert.strictEqual(sectionEvents(other).length, 1);
});

test('opt-out を付けたページは survey だけ。他の既存ページの section 計測は変更していない', () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (['node_modules', '.git'].includes(e.name)) return [];
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : (p.endsWith('.html') ? [p] : []);
  });
  const withOptOut = walk(D.REPO).filter((f) => /data-disable-section-view/.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(D.REPO, f));
  assert.deepStrictEqual(withOptOut, ['baseball/baseball-uniform-survey.html']);
  const withSections = walk(D.REPO).filter((f) => /data-section-view=/.test(fs.readFileSync(f, 'utf8')));
  assert.ok(withSections.length > 0, '既存ページの data-section-view が残っている');
  assert.ok(!fs.readFileSync(path.join(D.REPO, D.PAGE), 'utf8').includes('data-section-view='));
});

// ── accessibility / responsive ──

test('a11y：全 input にラベルが関連付き、hidden 設問は DOM に無く、required 表示は visible のみ', async () => {
  const env = await openPage();
  await start(env);
  for (let guard = 0; guard < 40 && env.document.getElementById('bus-questions'); guard++) {
    fillPage(env, ROUTES.low_interest);
    const doc = env.document;
    Array.from(doc.querySelectorAll('input, textarea')).forEach((input) => {
      const labelled = input.closest('label') || (input.id && doc.querySelector(`label[for="${input.id}"]`)) || input.getAttribute('aria-label');
      assert.ok(labelled, `ラベルなし: ${input.id}`);
    });
    Array.from(doc.querySelectorAll('fieldset[data-qid]')).forEach((f) => {
      assert.ok(f.querySelector('legend'), f.getAttribute('data-qid'));
      assert.strictEqual(f.hidden, false);
      assert.ok(f.querySelector('.bus-req, .bus-optional'));
    });
    Array.from(doc.querySelectorAll('.bus-other[hidden] input')).forEach((i) => assert.strictEqual(i.disabled, true, 'hidden な入力欄は無効（tab 順に入らない）'));
    assert.ok(!visibleIds(doc).includes('preferred_program'), '低関心 route の hidden 設問は DOM にない');
    assert.strictEqual(doc.getElementById('bus-progress').getAttribute('role'), 'group');
    assert.ok(doc.querySelector('[role="progressbar"]').hasAttribute('aria-valuetext'), '進捗は視覚以外でも判別できる');
    assert.strictEqual(doc.activeElement && doc.activeElement.id, 'bus-page-title', '遷移後は見出しへフォーカス');
    await next(env);
  }
});

test('responsive：390px / 1440px で横スクロールしない構造（CSS / viewport の静的検査）', () => {
  const css = fs.readFileSync(path.join(D.REPO, 'baseball/baseball-uniform-survey/styles.css'), 'utf8');
  const html = fs.readFileSync(path.join(D.REPO, D.PAGE), 'utf8');
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1.0">/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
  assert.match(css, /\.bus-wrap\s*\{[^}]*max-width:\s*680px/);
  assert.match(css, /fieldset\.bus-q\s*\{[^}]*min-width:\s*0/);
  assert.match(css, /\.bus-scale\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(150px,\s*1fr\)\)/);
  assert.match(css, /font-size:\s*16px/, 'iOS のズーム回避');
  // 固定幅(px)の width / min-width は 390px 未満の画面に収まる値だけ
  const widths = [...css.matchAll(/(?:^|[;{\s])(?:min-)?width:\s*(\d+)px/g)].map((m) => Number(m[1]));
  widths.forEach((w) => assert.ok(w <= 360, `width ${w}px`));
  // 390px 幅に収まる：padding 16px×2 + scale の最小列 150px×2 + gap 8px ≤ 390
  assert.ok(16 * 2 + 150 * 2 + 8 <= 390);
  assert.match(css, /@media \(min-width: 720px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /\.bus-btn\[disabled\][^}]*background-image/, 'disabled は色だけでなく模様でも判別できる');
});

test('回答者向け説明：目的・18歳以上・5〜12分・非公開範囲・アクセス解析・匿名性・参加申込ではない。保持期限は補わない', async () => {
  const env = await openPage();
  const text = bodyText(env.document);
  for (const phrase of ['今後の運営・企画', '18歳以上', '5〜12分', '個別の回答は公開しません', '自由記述', '詳細な居住地域は公開しません', '回答内容・どの質問にどう答えたか', '修正・削除することは原則できません', '参加申込ではありません']) {
    assert.ok(text.includes(phrase), phrase);
  }
  assert.ok(!/保管期間|保持期限|削除します|日後|か月|ヶ月/.test(text), '未確定の retention を補わない');
  assert.match(fs.readFileSync(path.join(D.REPO, D.PAGE), 'utf8'), /<meta name="robots" content="noindex">/);
});

test('Pages 公開前提：Frontend に実回答・salt・token・Spreadsheet ID を置かない', () => {
  const dir = path.join(D.REPO, 'baseball/baseball-uniform-survey');
  for (const file of fs.readdirSync(dir)) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    assert.ok(!/(?:salt|secret|token)\s*["']?\s*[:=]\s*["'][A-Za-z0-9+/_-]{16,}/i.test(text), file);
    assert.ok(!/spreadsheets\/d\/|AKfycb/.test(text), file);
  }
});
