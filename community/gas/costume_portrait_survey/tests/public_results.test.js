'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadPublic, validPayload, plain } = require('./helpers/gas-env');

const OPEN = new Date('2026-11-01T12:00:00+09:00');
const CLOSED = new Date('2027-01-15T00:00:00+09:00');

/** n件の回答を保存する。variant(i) が設問IDごとの上書きを返す。 */
function seed(ctx, n, variant = () => ({})) {
  for (let i = 0; i < n; i++) {
    const r = plain(ctx.processSubmission_(JSON.stringify(validPayload(ctx, variant(i))), OPEN));
    assert.strictEqual(r.ok, true, JSON.stringify(r));
  }
}
const ageCycle = ['age_20_24', 'age_30_34', 'age_40_49', 'age_20_24'];

test('finalize前は公開結果を返さない（未確定）', () => {
  const { ctx } = loadPublic();
  seed(ctx, 35);
  assert.deepStrictEqual(plain(ctx.readPublicResults_()), { ok: true, status: 'not_finalized' });
});

test('締切前の finalize は拒否される（未確定の数値を最終結果にしない）', () => {
  const { env, ctx } = loadPublic();
  seed(ctx, 5);
  assert.throws(() => ctx.finalizeSurvey_(OPEN), /survey_not_closed/);
  assert.ok(!env.props.has('FINALIZED_AT'));
});

test('有効回答30件未満は、件数も含め一切公開しない', () => {
  const { env, ctx } = loadPublic();
  seed(ctx, 29);
  const result = plain(ctx.finalizeSurvey_(CLOSED));
  assert.strictEqual(result.stats.validRows, 29);
  const body = plain(ctx.readPublicResults_());
  assert.deepStrictEqual(body, { ok: true, results: { status: 'insufficient', schema_version: '1', min_total: 30 } });
  assert.ok(!JSON.stringify(body).includes('29'));
  assert.ok(env);
});

test('30件以上で公開：count<3のカテゴリは抑止、年代は粗い区分、単一選択は二次秘匿', () => {
  const { ctx } = loadPublic();
  seed(ctx, 40, (i) => ({
    age_range: i === 0 ? 'age_60_plus' : i === 1 ? 'age_18_19' : ageCycle[i % 4],
    portrait_interest: i < 2 ? 'not_at_all' : i < 12 ? 'interested' : 'very_interested',
    backdrop: i < 2 ? ['white', 'fantasy'] : ['white']
  }));
  ctx.finalizeSurvey_(CLOSED);
  const results = plain(ctx.readPublicResults_()).results;
  assert.strictEqual(results.status, 'final');
  assert.strictEqual(results.total, 40);
  const item = (id) => results.items.find((i) => i.id === id);
  // 年代は粗い区分（個別の年代idは出ない）
  const ageIds = item('age_range').categories.map((c) => c.id);
  assert.deepStrictEqual(ageIds, ['age_18_29', 'age_30_39', 'age_40_49', 'age_50_plus', 'age_unspecified']);
  assert.ok(!JSON.stringify(results).includes('age_18_19'));
  // 50歳以上は1件だけ → 抑止
  const fifty = item('age_range').categories.find((c) => c.id === 'age_50_plus');
  assert.strictEqual(fifty.count, null);
  assert.strictEqual(fifty.pct, null);
  // 単一選択で非ゼロ1カテゴリのみ抑止 → 逆算を防ぐため次に小さい公開値も伏せる
  const visibleAge = item('age_range').categories.filter((c) => c.count !== null);
  assert.ok(visibleAge.length < 4, '二次秘匿で追加のセルが伏せられる');
  // 複数選択：fantasy は2件 → 抑止、white は公開
  const backdrop = item('backdrop').categories;
  assert.strictEqual(backdrop.find((c) => c.id === 'fantasy').count, null);
  assert.strictEqual(backdrop.find((c) => c.id === 'white').count, 40);
  // count>=3 の値はすべて公開、<3 の値は null
  for (const it of results.items) for (const c of it.categories) assert.ok(c.count === null || c.count >= 3, `${it.id}.${c.id}`);
  // 0件も公開しない
  assert.strictEqual(backdrop.find((c) => c.id === 'black').count, null);
});

test('allowlist：非公開項目（価格・意向・地域・性的指向・自由記述等）は構造上出力されない', () => {
  const { ctx } = loadPublic();
  seed(ctx, 35, () => ({ sexual_orientation: 'gay', residence: 'pref_23', cheer_message: '応援してます', free_ideas: 'アイデア', free_themes: 'テーマ', portrait_price: '7000_8999' }));
  ctx.finalizeSurvey_(CLOSED);
  const body = plain(ctx.readPublicResults_());
  const text = JSON.stringify(body);
  for (const forbidden of ['portrait_price', 'rental_price', 'intent_3m', 'residence', 'sexual_orientation', 'travel_range', 'hesitation',
    'cheer_message', 'free_ideas', 'free_themes', 'respondent_hash', 'timestamp', 'uuid', 'other_texts', '応援してます', 'アイデア', 'pref_23', 'gay', '7000_8999',
    'shooter_interest', 'studio_rental', 'equipment', 'age_confirmed', 'notification']) {
    assert.ok(!text.includes(forbidden), forbidden);
  }
  const allowedItems = ['age_range', 'costume_interest', 'uniform_interest', 'workwear_interest', 'costume_wear', 'costume_photographed', 'costume_shoot', 'portrait_interest',
    'portrait_styles', 'photo_usage', 'face_exposure', 'shoot_duration', 'weekdays', 'time_slots', 'photo_count', 'retouch', 'backdrop'];
  assert.deepStrictEqual(body.results.items.map((i) => i.id), allowedItems);
  assert.deepStrictEqual(Object.keys(body.results).sort(), ['items', 'schema_version', 'status', 'survey_version', 'total']);
  for (const item of body.results.items) {
    assert.deepStrictEqual(Object.keys(item).sort(), ['base', 'categories', 'id', 'suppressed', 'title', 'type']);
    for (const c of item.categories) assert.deepStrictEqual(Object.keys(c).sort(), ['count', 'id', 'label', 'pct']);
  }
});

test('assertPublicPayload_ は allowlist 外のkey・項目が混入したら公開を止める', () => {
  const { ctx } = loadPublic();
  const good = { status: 'final', schema_version: '1', survey_version: 'x', total: 30, items: [] };
  assert.doesNotThrow(() => ctx.assertPublicPayload_(JSON.parse(JSON.stringify(good))));
  assert.throws(() => ctx.assertPublicPayload_(Object.assign({}, good, { respondent_hash: 'x' })), /not_allowed/);
  assert.throws(() => ctx.assertPublicPayload_(Object.assign({}, good, { items: [{ id: 'portrait_price', title: 'x', type: 'single', base: 1, suppressed: false, categories: [] }] })), /not_allowed/);
  assert.throws(() => ctx.assertPublicPayload_(Object.assign({}, good, { items: [{ id: 'backdrop', title: 'x', type: 'multi', base: 1, suppressed: false, categories: [{ id: 'a', label: 'b', count: 1, pct: 1, raw: 'leak' }] }] })), /not_allowed/);
  assert.throws(() => ctx.assertPublicPayload_(Object.assign({}, good, { items: [{ id: 'backdrop', title: 'x', type: 'multi', base: 1, suppressed: false, categories: [], free_text: ['a'] }] })), /not_allowed/);
  // 設問が private に変更されたら、allowlistに残っていても公開しない
  ctx.SURVEY_SCHEMA.questions.find((q) => q.id === 'backdrop').visibility = 'private';
  assert.throws(() => ctx.assertPublicPayload_({ status: 'final', items: [{ id: 'backdrop', title: 'x', type: 'multi', base: 1, suppressed: false, categories: [] }] }), /not_allowed/);
});

test('finalize：件数内訳・finalizedAt・status・publicTotal、締切後の行は公開数に含めない', () => {
  const { env, ctx } = loadPublic({ closesAt: '2026-11-30T23:59:59+09:00' });
  seed(ctx, 31);
  // 締切後に保存された行（設定ミス等を想定）と、日時が読めない行を直接追加
  const sheet = env.spreadsheet.getSheetByName('responses');
  const header = sheet.rows[0];
  const lateRow = sheet.rows[1].slice(); lateRow[0] = new Date('2026-12-05T00:00:00+09:00');
  const brokenRow = sheet.rows[1].slice(); brokenRow[0] = 'not a date';
  sheet.rows.push(lateRow, brokenRow, new Array(header.length).fill(''));
  const result = plain(ctx.finalizeSurvey_(CLOSED));
  assert.strictEqual(result.status, 'final');
  assert.strictEqual(result.already, false);
  assert.deepStrictEqual(result.stats, { responseRows: 33, validRows: 31, lateRows: 1, unparseableRows: 1, publicTotal: 31 });
  assert.ok(result.finalizedAt);
  assert.strictEqual(plain(ctx.readPublicResults_()).results.total, 31);
  const meta = Object.fromEntries(env.spreadsheet.getSheetByName('meta').rows);
  assert.strictEqual(meta.finalize_status, 'final');
  assert.strictEqual(meta.finalize_validRows, 31);
  assert.strictEqual(meta.finalize_lateRows, 1);
  assert.strictEqual(meta.finalize_unparseableRows, 1);
  assert.strictEqual(meta.finalized_at, result.finalizedAt);
  const logs = env.logs.join('\n');
  assert.ok(logs.includes('"event":"finalize"'));
});

test('finalize後の公開値は Spreadsheet の後続変更で変わらない／二重finalizeも安全', () => {
  const { env, ctx } = loadPublic();
  seed(ctx, 32);
  const first = plain(ctx.finalizeSurvey_(CLOSED));
  const snapshot = JSON.stringify(plain(ctx.readPublicResults_()));
  // 後からSpreadsheetを書き換える・行を削除する
  const sheet = env.spreadsheet.getSheetByName('responses');
  sheet.rows.splice(1, 20);
  sheet.rows[1][sheet.rows[0].indexOf('portrait_interest')] = 'not_at_all';
  assert.strictEqual(JSON.stringify(plain(ctx.readPublicResults_())), snapshot);
  // 二重finalize：何も書き換えず、確定済みの統計を返す
  const second = plain(ctx.finalizeSurvey_(new Date('2027-01-01T00:00:00+09:00')));
  assert.strictEqual(second.already, true);
  assert.strictEqual(second.finalizedAt, first.finalizedAt);
  assert.deepStrictEqual(second.stats, first.stats);
  assert.strictEqual(JSON.stringify(plain(ctx.readPublicResults_())), snapshot);
  // 公開結果の読み出しはSpreadsheetを開かない
  env.failOpen = true;
  assert.strictEqual(JSON.stringify(plain(ctx.readPublicResults_())), snapshot);
});

test('finalize が途中で失敗したら確定マーカー/スナップショットを残さない', () => {
  const { env, ctx } = loadPublic();
  seed(ctx, 31);
  const realSet = env.sandbox.PropertiesService.getScriptProperties().setProperty;
  let calls = 0;
  const props = env.sandbox.PropertiesService.getScriptProperties();
  props.setProperty = (k, v) => { if (k.startsWith('FINAL_RESULTS_0') && ++calls === 1) throw new Error('quota'); realSet(k, v); };
  assert.throws(() => ctx.finalizeSurvey_(CLOSED), /quota/);
  props.setProperty = realSet;
  assert.ok(![...env.props.keys()].some((k) => k.startsWith('FINAL_RESULTS_') || k === 'FINALIZED_AT'));
  assert.deepStrictEqual(plain(ctx.readPublicResults_()), { ok: true, status: 'not_finalized' });
  // 再実行で確定できる
  assert.strictEqual(plain(ctx.finalizeSurvey_(CLOSED)).status, 'final');
});

test('スナップショットは複数チャンクに分割して保存され、読み戻しが一致する', () => {
  const { env, ctx } = loadPublic();
  seed(ctx, 31);
  ctx.finalizeSurvey_(CLOSED);
  const chunkKeys = [...env.props.keys()].filter((k) => /^FINAL_RESULTS_\d{3}$/.test(k));
  assert.ok(chunkKeys.length >= 2, 'ScriptPropertiesの9KB制限に対応して分割');
  for (const k of chunkKeys) assert.ok(Buffer.byteLength(env.props.get(k)) <= 8000);
  env.props.delete(chunkKeys[0]);
  assert.throws(() => ctx.readPublicResults_(), /snapshot_chunk_missing/);
});

test('ログに公開結果・回答内容を出さない', () => {
  const { env, ctx } = loadPublic();
  seed(ctx, 31, () => ({ cheer_message: '内緒のひとこと' }));
  ctx.finalizeSurvey_(CLOSED);
  assert.ok(!env.logs.join('\n').includes('内緒のひとこと'));
});
