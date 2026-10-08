'use strict';
const SV = require('../survey.schema.json').schema_version;
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
const BASIC_IDS = ['age_range', 'residence', 'aichi_area'];
const MAIN_SAMPLE_IDS = ['costume_interest', 'costume_wear', 'costume_photographed', 'costume_shoot', 'portrait_interest', 'portrait_styles', 'photo_usage', 'backdrop'];
const ageCycle = ['age_20_24', 'age_30_34', 'age_40_49', 'age_20_24'];

test('未確定でも30件以上なら途中集計（status:partial）。finalが流用されない', () => {
  const { ctx } = loadPublic();
  seed(ctx, 35);
  const results = plain(ctx.readPublicResults_(OPEN)).results;
  assert.strictEqual(results.status, 'partial');
  assert.strictEqual(results.phase, 'collecting');
  assert.strictEqual(results.total, 35);
});

test('締切前の finalize は拒否される（未確定の数値を最終結果にしない）', () => {
  const { env, ctx } = loadPublic();
  seed(ctx, 5);
  assert.throws(() => ctx.finalizeSurvey_(OPEN), /survey_not_closed/);
  assert.ok(!env.props.has('FINALIZED_AT'));
});

test('確定済みでも29件なら基本属性と件数のみ（最終結果・threshold_reached:false）。主要結果は含まない', () => {
  const { ctx } = loadPublic();
  seed(ctx, 29);
  const result = plain(ctx.finalizeSurvey_(CLOSED));
  assert.strictEqual(result.stats.validRows, 29);
  const r = plain(ctx.readPublicResults_()).results;
  assert.strictEqual(r.status, 'final');
  assert.strictEqual(r.total, 29);
  assert.strictEqual(r.threshold_reached, false);
  assert.deepStrictEqual(r.items.map((i) => i.id), BASIC_IDS);
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

test('allowlist：非公開項目（価格・意向・国名・性的指向・自由記述等）は構造上出力されない', () => {
  const { ctx } = loadPublic();
  seed(ctx, 35, () => ({ sexual_orientation: 'gay', residence: 'pref_23', aichi_area: 'nagoya_city', cheer_message: '応援してます', free_ideas: 'アイデア', free_themes: 'テーマ', portrait_price: '7000_8999' }));
  ctx.finalizeSurvey_(CLOSED);
  const body = plain(ctx.readPublicResults_());
  const text = JSON.stringify(body);
  for (const forbidden of ['portrait_price', 'rental_price', 'intent_3m', 'residence_country', 'sexual_orientation', 'travel_range', 'hesitation',
    'cheer_message', 'free_ideas', 'free_themes', 'respondent_hash', 'timestamp', 'uuid', 'other_texts', '応援してます', 'アイデア', 'gay', '7000_8999',
    'shooter_interest', 'studio_rental', 'equipment', 'age_confirmed', 'notification']) {
    assert.ok(!text.includes(forbidden), forbidden);
  }
  const allowedItems = ['age_range', 'residence', 'aichi_area', 'costume_interest', 'uniform_interest', 'workwear_interest', 'suit_interest', 'school_uniform_interest', 'costume_wear', 'costume_photographed', 'costume_shoot', 'portrait_interest',
    'portrait_styles', 'photo_usage', 'face_exposure', 'shoot_duration', 'weekdays', 'weekday_time_slots', 'holiday_time_slots', 'photo_count', 'retouch', 'backdrop'];
  assert.deepStrictEqual(body.results.items.map((i) => i.id), allowedItems);
  assert.deepStrictEqual(Object.keys(body.results).sort(), ['items', 'min_total', 'schema_version', 'status', 'survey_version', 'threshold_reached', 'total']);
  for (const item of body.results.items) {
    assert.deepStrictEqual(Object.keys(item).sort(), ['base', 'categories', 'id', 'suppressed', 'title', 'type']);
    for (const c of item.categories) assert.deepStrictEqual(Object.keys(c).sort(), ['count', 'id', 'label', 'pct']);
  }
});

test('assertPublicPayload_ は allowlist 外のkey・項目が混入したら公開を止める', () => {
  const { ctx } = loadPublic();
  const good = { status: 'final', schema_version: SV, survey_version: 'x', total: 30, items: [] };
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
  assert.strictEqual(plain(ctx.readPublicResults_(CLOSED)).results.status, 'partial');
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

// ── finalize の締切設定検証（レビュー指摘: 設定不正のまま誤確定させない） ──
const noFinalizeArtifacts = (env) => {
  assert.ok(![...env.props.keys()].some((k) => k.startsWith('FINAL_RESULTS_') || k === 'FINALIZED_AT'), 'snapshot/FINALIZED_AT must not exist');
  const meta = Object.fromEntries(env.spreadsheet.getSheetByName('meta').rows);
  assert.notStrictEqual(meta.finalize_status, 'final');
  assert.ok(!Object.keys(meta).some((k) => k.startsWith('finalize_') || k === 'finalized_at'));
};

test('finalize：SURVEY_CLOSES_AT 未設定では拒否し、何も作成しない', () => {
  const { env, ctx } = loadPublic();
  seed(ctx, 31);
  env.props.delete('SURVEY_CLOSES_AT');
  assert.throws(() => ctx.finalizeSurvey_(CLOSED), /survey_close_not_configured/);
  noFinalizeArtifacts(env);
  assert.deepStrictEqual(plain(ctx.readPublicResults_(CLOSED)), { ok: false, error: 'survey_close_not_configured' });
});

test('finalize：不正文字列・存在しない日付・タイムゾーン無し・空白では拒否し、何も作成しない', () => {
  for (const bad of ['', '   ', 'tomorrow', 'NaN', '0', '2026-11-15', '2026-02-30T00:00:00+09:00', '2026-13-01T00:00:00+09:00', '2026-11-15T23:59:59']) {
    const { env, ctx } = loadPublic();
    seed(ctx, 31);
    env.props.set('SURVEY_CLOSES_AT', bad);
    assert.throws(() => ctx.finalizeSurvey_(CLOSED), /survey_close_not_configured/, JSON.stringify(bad));
    noFinalizeArtifacts(env);
  }
});

test('finalize：締切時刻ちょうどは拒否（受付中）、1ms後は成功', () => {
  const { env, ctx } = loadPublic({ closesAt: '2026-11-30T23:59:59+09:00' });
  seed(ctx, 31);
  const edge = Date.parse('2026-11-30T23:59:59+09:00');
  assert.throws(() => ctx.finalizeSurvey_(new Date(edge - 1)), /survey_not_closed/);
  assert.throws(() => ctx.finalizeSurvey_(new Date(edge)), /survey_not_closed/);
  noFinalizeArtifacts(env);
  const result = plain(ctx.finalizeSurvey_(new Date(edge + 1)));
  assert.strictEqual(result.status, 'final');
  assert.strictEqual(result.stats.validRows, 31);
  assert.strictEqual(result.stats.lateRows, 0, '有効回答が誤ってlate扱いにならない');
  assert.strictEqual(plain(ctx.readPublicResults_()).results.total, 31);
});

test('finalize：設定不正で拒否した後、締切を正しく設定すれば確定できる（誤確定で復旧不能にならない）', () => {
  const { env, ctx } = loadPublic();
  seed(ctx, 31);
  env.props.set('SURVEY_CLOSES_AT', 'garbage');
  assert.throws(() => ctx.finalizeSurvey_(CLOSED), /survey_close_not_configured/);
  env.props.set('SURVEY_CLOSES_AT', '2026-12-31T23:59:59+09:00');
  const result = plain(ctx.finalizeSurvey_(CLOSED));
  assert.strictEqual(result.stats.validRows, 31);
  assert.strictEqual(result.stats.lateRows, 0);
});

// ── 途中集計（Issue #359） ──
const finalMarkers = (env) => [...env.props.keys()].filter((k) => k.startsWith('FINAL_RESULTS_') || k === 'FINALIZED_AT');
const addRow = (env, mutate) => {
  const sheet = env.spreadsheet.getSheetByName('responses');
  const row = sheet.rows[1].slice();
  mutate(row, sheet.rows[0]);
  sheet.rows.push(row);
};

test('途中集計：未確定29件は基本属性と件数のみ、30件ちょうどで主要結果が追加される', () => {
  const { ctx } = loadPublic();
  seed(ctx, 29);
  const body = plain(ctx.readPublicResults_(OPEN));
  assert.strictEqual(body.results.status, 'partial');
  assert.strictEqual(body.results.phase, 'collecting');
  assert.strictEqual(body.results.total, 29);
  assert.strictEqual(body.results.min_total, 30);
  assert.strictEqual(body.results.threshold_reached, false);
  assert.deepStrictEqual(body.results.items.map((i) => i.id), BASIC_IDS);
  seed(ctx, 1);
  const r = plain(ctx.readPublicResults_(OPEN)).results;
  assert.strictEqual(r.status, 'partial');
  assert.strictEqual(r.total, 30);
  assert.strictEqual(r.threshold_reached, true);
  assert.deepStrictEqual(r.items.slice(0, 3).map((i) => i.id), BASIC_IDS);
  assert.ok(r.items.length > BASIC_IDS.length);
});

test('途中集計：回答追加後の再取得で更新され、確定マーカー・スナップショット・metaを作らない', () => {
  const { env, ctx } = loadPublic();
  seed(ctx, 30);
  assert.strictEqual(plain(ctx.readPublicResults_(OPEN)).results.total, 30);
  seed(ctx, 2);
  assert.strictEqual(plain(ctx.readPublicResults_(OPEN)).results.total, 32);
  assert.deepStrictEqual(finalMarkers(env), []);
  const meta = Object.fromEntries(env.spreadsheet.getSheetByName('meta').rows);
  assert.ok(!Object.keys(meta).some((k) => k.startsWith('finalize_') || k === 'finalized_at'));
});

test('途中集計：締切後・未確定は closed_pending で、締切後行・日時不正行・テスト行を除外', () => {
  const { env, ctx } = loadPublic({ closesAt: '2026-11-30T23:59:59+09:00' });
  seed(ctx, 30);
  const tsIdx = () => env.spreadsheet.getSheetByName('responses').rows[0].indexOf('timestamp');
  addRow(env, (row) => { row[tsIdx()] = new Date('2026-12-05T00:00:00+09:00'); });
  addRow(env, (row) => { row[tsIdx()] = 'not a date'; });
  addRow(env, (row, header) => { row[header.indexOf('completion_status')] = 'test'; });
  const r = plain(ctx.readPublicResults_(CLOSED)).results;
  assert.strictEqual(r.status, 'partial');
  assert.strictEqual(r.phase, 'closed_pending');
  assert.strictEqual(r.total, 30);
});

test('途中集計：テスト行・締切後行は30件判定にも入らない', () => {
  const { env, ctx } = loadPublic({ closesAt: '2026-11-30T23:59:59+09:00' });
  seed(ctx, 29);
  for (let i = 0; i < 5; i++) addRow(env, (row, header) => { row[header.indexOf('completion_status')] = 'test'; });
  addRow(env, (row, header) => { row[header.indexOf('timestamp')] = new Date('2026-12-05T00:00:00+09:00'); });
  const r = plain(ctx.readPublicResults_(CLOSED)).results;
  assert.strictEqual(r.total, 29);
  assert.strictEqual(r.threshold_reached, false);
  assert.deepStrictEqual(r.items.map((i) => i.id), BASIC_IDS);
});

test('途中集計：締切設定が未設定・不正ならエラー（誤った集計を公開しない）', () => {
  for (const bad of [undefined, '', 'garbage', '2026-02-30T00:00:00+09:00', '2026-11-15T23:59:59']) {
    const { env, ctx } = loadPublic();
    seed(ctx, 31);
    if (bad === undefined) env.props.delete('SURVEY_CLOSES_AT'); else env.props.set('SURVEY_CLOSES_AT', bad);
    assert.deepStrictEqual(plain(ctx.readPublicResults_(CLOSED)), { ok: false, error: 'survey_close_not_configured' }, String(bad));
    assert.deepStrictEqual(finalMarkers(env), []);
  }
});

test('途中集計：少数カテゴリ秘匿・二次秘匿・allowlistが維持される', () => {
  const { ctx } = loadPublic();
  seed(ctx, 40, (i) => ({
    portrait_interest: i < 2 ? 'not_at_all' : i < 12 ? 'interested' : 'very_interested',
    backdrop: i < 2 ? ['white', 'fantasy'] : ['white'],
    sexual_orientation: 'gay', residence: 'pref_23', aichi_area: 'nagoya_city', cheer_message: '応援してます', portrait_price: '7000_8999'
  }));
  const body = plain(ctx.readPublicResults_(OPEN));
  const text = JSON.stringify(body);
  for (const forbidden of ['portrait_price', 'residence_country', 'sexual_orientation', 'cheer_message', '応援してます', 'respondent_hash', 'timestamp', '7000_8999']) assert.ok(!text.includes(forbidden), forbidden);
  assert.deepStrictEqual(Object.keys(body.results).sort(), ['items', 'min_total', 'phase', 'schema_version', 'status', 'survey_version', 'threshold_reached', 'total']);
  const backdrop = body.results.items.find((i) => i.id === 'backdrop').categories;
  assert.strictEqual(backdrop.find((c) => c.id === 'fantasy').count, null);
  assert.strictEqual(backdrop.find((c) => c.id === 'white').count, 40);
  const interest = body.results.items.find((i) => i.id === 'portrait_interest').categories;
  assert.strictEqual(interest.find((c) => c.id === 'not_at_all').count, null);
  assert.ok(interest.filter((c) => c.count === null).length >= 2, '二次秘匿');
});

test('途中集計→finalize：最終結果へ切り替わり、後続のシート変更で変わらない。途中集計とfinalの集計対象は一致', () => {
  const { env, ctx } = loadPublic();
  seed(ctx, 33);
  const partial = plain(ctx.readPublicResults_(CLOSED)).results;
  ctx.finalizeSurvey_(CLOSED);
  const final = plain(ctx.readPublicResults_(CLOSED)).results;
  assert.strictEqual(final.status, 'final');
  assert.ok(!('phase' in final));
  assert.deepStrictEqual(Object.assign({}, final, { status: 'partial', phase: 'closed_pending' }), partial);
  const snapshot = JSON.stringify(final);
  env.spreadsheet.getSheetByName('responses').rows.splice(1, 20);
  assert.strictEqual(JSON.stringify(plain(ctx.readPublicResults_(CLOSED)).results), snapshot);
  env.failOpen = true;
  assert.strictEqual(JSON.stringify(plain(ctx.readPublicResults_(CLOSED)).results), snapshot);
});

test('確定済み30件ちょうどは主要結果も含む最終結果（threshold_reached:true）', () => {
  const { ctx } = loadPublic();
  seed(ctx, 30);
  ctx.finalizeSurvey_(CLOSED);
  const r = plain(ctx.readPublicResults_(CLOSED)).results;
  assert.strictEqual(r.status, 'final');
  assert.strictEqual(r.threshold_reached, true);
  assert.deepStrictEqual(r.items.slice(0, 3).map((i) => i.id), BASIC_IDS);
  assert.ok(MAIN_SAMPLE_IDS.every((id) => r.items.some((i) => i.id === id)));
});

// ── 基本属性の先行公開（Issue #367） ──
const item = (results, id) => results.items.find((i) => i.id === id);
const visible = (it) => it.categories.filter((c) => c.count !== null);

test('29件でも age / residence / aichi_area が返り、主要結果は返らない', () => {
  const { ctx } = loadPublic();
  seed(ctx, 29, (i) => ({ age_range: ['age_20_24', 'age_30_34', 'age_40_49'][i % 3], residence: i < 20 ? 'pref_23' : 'pref_21', aichi_area: i >= 20 ? undefined : i % 2 ? 'nagoya_city' : 'owari' }));
  const r = plain(ctx.readPublicResults_(OPEN)).results;
  assert.strictEqual(r.total, 29);
  assert.strictEqual(r.threshold_reached, false);
  assert.deepStrictEqual(r.items.map((i) => i.id), BASIC_IDS);
  for (const main of MAIN_SAMPLE_IDS) assert.ok(!r.items.some((i) => i.id === main), main);
  // 年代は粗い区分（18-29 / 30-39 / 40-49 / 50+ / 回答しない）。個別の年代idは出ない
  assert.deepStrictEqual(item(r, 'age_range').categories.map((c) => c.id), ['age_18_29', 'age_30_39', 'age_40_49', 'age_50_plus', 'age_unspecified']);
  assert.ok(!JSON.stringify(r).includes('age_20_24'));
  // 居住地：愛知県20件・岐阜県9件は公開、他は0件 → 非公開
  const res = item(r, 'residence');
  assert.strictEqual(res.categories.find((c) => c.id === 'pref_23').count, 20);
  assert.strictEqual(res.categories.find((c) => c.id === 'pref_21').count, 9);
  assert.strictEqual(res.categories.find((c) => c.id === 'pref_01').count, null);
  // 愛知県内エリア：愛知県の回答者20人だけが母数（愛知県外は分岐対象外）
  const area = item(r, 'aichi_area');
  assert.strictEqual(area.base, 20);
  assert.deepStrictEqual(visible(area).map((c) => c.id).sort(), ['nagoya_city', 'owari']);
});

test('29件・基本属性でも count<3 は非公開、二次秘匿も維持される（minCell=3）', () => {
  const { ctx } = loadPublic();
  // 居住地：愛知18 / 岐阜9 / 三重2 → 三重(2件)は非公開、非ゼロの伏せ値が1つだけなので次に小さい公開値(岐阜)も伏せる
  seed(ctx, 29, (i) => ({ residence: i < 18 ? 'pref_23' : i < 27 ? 'pref_21' : 'pref_24', aichi_area: i >= 18 ? undefined : i % 2 ? 'nagoya_city' : 'owari' }));
  const r = plain(ctx.readPublicResults_(OPEN)).results;
  const res = item(r, 'residence');
  assert.strictEqual(res.categories.find((c) => c.id === 'pref_24').count, null);
  assert.strictEqual(res.categories.find((c) => c.id === 'pref_24').pct, null);
  assert.strictEqual(res.categories.find((c) => c.id === 'pref_21').count, null, '二次秘匿：次に小さい公開値も伏せる');
  assert.strictEqual(res.categories.find((c) => c.id === 'pref_23').count, 18);
  for (const it of r.items) for (const c of it.categories) assert.ok(c.count === null || c.count >= 3, `${it.id}.${c.id}`);
});

test('基本属性：愛知県の回答が3件未満なら aichi_area 全体を非公開（base:null）', () => {
  const { ctx } = loadPublic();
  seed(ctx, 29, (i) => (i < 2 ? { residence: 'pref_23', aichi_area: 'nagoya_city' } : { residence: 'pref_13' }));
  const area = item(plain(ctx.readPublicResults_(OPEN)).results, 'aichi_area');
  assert.strictEqual(area.suppressed, true);
  assert.strictEqual(area.base, null);
  assert.deepStrictEqual(area.categories, []);
});

test('30件未満の公開結果に性的指向・自由記述・価格・参加意向・個票・国名が混入しない', () => {
  const { ctx } = loadPublic();
  seed(ctx, 29, () => ({ sexual_orientation: 'gay', residence: 'overseas', residence_country: '秘匿国名テスト', cheer_message: '応援メッセージ秘', free_ideas: '自由案秘', free_themes: '自由テーマ秘', portrait_price: '7000_8999' }));
  const r = plain(ctx.readPublicResults_(OPEN)).results;
  const text = JSON.stringify(r);
  for (const forbidden of ['sexual_orientation', 'gay', 'residence_country', '秘匿国名テスト', '応援メッセージ秘', '自由案秘', '自由テーマ秘', 'portrait_price', '7000_8999',
    'intent_3m', 'rental_price', 'respondent_hash', 'uuid', 'timestamp', 'other_texts', 'cheer_message', 'free_ideas', 'free_themes']) assert.ok(!text.includes(forbidden), forbidden);
  assert.deepStrictEqual(Object.keys(r).sort(), ['items', 'min_total', 'phase', 'schema_version', 'status', 'survey_version', 'threshold_reached', 'total']);
  for (const it of r.items) {
    assert.deepStrictEqual(Object.keys(it).sort(), ['base', 'categories', 'id', 'suppressed', 'title', 'type']);
    for (const c of it.categories) assert.deepStrictEqual(Object.keys(c).sort(), ['count', 'id', 'label', 'pct']);
  }
});

test('allowlist維持：基本属性の公開は固定3問のみ。schemaに tier:basic で追加しても他の private 設問は公開されない', () => {
  const { ctx } = loadPublic();
  seed(ctx, 29);
  const cfg = ctx.SURVEY_SCHEMA.publicResults;
  for (const q of ['sexual_orientation', 'residence_country', 'portrait_price', 'cheer_message']) {
    cfg.items.unshift({ id: q, question: q, title: q, tier: 'basic' });
  }
  const r = plain(ctx.readPublicResults_(OPEN)).results;
  assert.deepStrictEqual(r.items.map((i) => i.id), BASIC_IDS);
  const forged = { status: 'partial', phase: 'collecting', total: 1, min_total: 30, threshold_reached: false, items: [{ id: 'sexual_orientation', title: 'x', type: 'single', base: 1, suppressed: false, categories: [] }] };
  assert.throws(() => ctx.assertPublicPayload_(forged), /not_allowed/);
});

test('assertPublicPayload_：threshold_reached:false の payload に主要結果が混入したら公開を止める', () => {
  const { ctx } = loadPublic();
  const base = { status: 'partial', phase: 'collecting', schema_version: SV, survey_version: 'x', total: 5, min_total: 30, items: [] };
  const mainItem = { id: 'backdrop', title: 'x', type: 'multi', base: 5, suppressed: false, categories: [] };
  const basicItem = { id: 'residence', title: 'x', type: 'single', base: 5, suppressed: false, categories: [] };
  assert.doesNotThrow(() => ctx.assertPublicPayload_(Object.assign({}, base, { threshold_reached: false, items: [basicItem] })));
  assert.throws(() => ctx.assertPublicPayload_(Object.assign({}, base, { threshold_reached: false, items: [basicItem, mainItem] })), /not_allowed/);
  assert.doesNotThrow(() => ctx.assertPublicPayload_(Object.assign({}, base, { threshold_reached: true, items: [basicItem, mainItem] })));
});

test('30件以上は基本属性＋主要結果。29→30件の境界で threshold_reached が切り替わる', () => {
  const { ctx } = loadPublic();
  seed(ctx, 29);
  assert.strictEqual(plain(ctx.readPublicResults_(OPEN)).results.threshold_reached, false);
  seed(ctx, 1);
  const r = plain(ctx.readPublicResults_(OPEN)).results;
  assert.strictEqual(r.threshold_reached, true);
  assert.strictEqual(r.items.length, ctx.SURVEY_SCHEMA.publicResults.items.length);
  assert.ok(MAIN_SAMPLE_IDS.every((id) => r.items.some((i) => i.id === id)));
});

test('doGet(results)：途中集計をJSONで返し、Spreadsheet読み取り失敗は server_error（30件未満にしない）', () => {
  const { env, ctx } = loadPublic();
  seed(ctx, 30);
  const ok = JSON.parse(ctx.doGet({ parameter: { action: 'results' } }).getContent());
  assert.strictEqual(ok.results.status, 'partial');
  env.failOpen = true;
  assert.deepStrictEqual(JSON.parse(ctx.doGet({ parameter: { action: 'results' } }).getContent()), { ok: false, error: 'server_error' });
});

test('既存public設問を誤って tier:basic にしても、29件では公開されない（コード固定の3問のみ）', () => {
  const { ctx } = loadPublic();
  seed(ctx, 29);
  const cfg = ctx.SURVEY_SCHEMA.publicResults;
  cfg.items.find((i) => i.id === 'costume_interest').tier = 'basic';
  const r = plain(ctx.readPublicResults_(OPEN)).results;
  assert.deepStrictEqual(r.items.map((i) => i.id), BASIC_IDS);
  assert.ok(!JSON.stringify(r).includes('costume_interest'));
  // assertPublicPayload_ も同様に止める
  const forged = { status: 'partial', phase: 'collecting', total: 29, min_total: 30, threshold_reached: false, items: [{ id: 'costume_interest', title: 'x', type: 'multi', base: 5, suppressed: false, categories: [] }] };
  assert.throws(() => ctx.assertPublicPayload_(forged), /not_allowed/);
  // 30件以上なら従来どおり公開される
  seed(ctx, 1);
  assert.ok(plain(ctx.readPublicResults_(OPEN)).results.items.some((i) => i.id === 'costume_interest'));
});
