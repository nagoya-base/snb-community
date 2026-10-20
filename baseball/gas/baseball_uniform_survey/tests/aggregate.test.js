'use strict';
// Admin 集計・publication 判定・small-cell / complementary suppression・privacy-safe snapshot（Issue #382）。
// 入力はすべて架空の fixture。実回答・本番 Spreadsheet には接続しない。
const test = require('node:test');
const assert = require('node:assert/strict');
const { schema, core, aggregate, clone, answersFor, rowFor, rowsFrom, classify, validFrom, snapshotOf, entryOf, lcg, NOW } = require('./helpers/fixtures');

const INTERESTED = { club_awareness: 'aware_not_attended', catchball_interest: 'very_interested' };
const ATTENDEE = { club_awareness: 'attended', last_attended: 'within_3m' };
const LAPSED = { club_awareness: 'attended', last_attended: 'over_1y' };
const publication = (id) => core.getPublication(schema, id);

// ── production / test / invalid の分離 ──

test('production 有効回答だけを標準集計し、test・invalid・18歳未満・重複を分ける', () => {
  const ok = answersFor({});
  const rows = [
    rowFor(ok), rowFor(ok), rowFor(ok),
    rowFor(ok, { response_mode: 'test', test_run_id: 'run1' }),
    rowFor(answersFor({ age_confirmed: 'zzz' }), { response_mode: 'test', test_run_id: 'run1' }), // invalid でも test は test
    rowFor(ok, { response_mode: 'staging' }),
    rowFor(ok, { response_mode: '' }),
    rowFor(ok, { completion_status: 'partial' }),
    rowFor(ok, { schema_version: '0' }),
    rowFor(ok, { design_version: '1.0' }),
    rowFor({ age_confirmed: 'no' }),
    rowFor(Object.assign({}, ok, { baseball_experience: 'not_an_option' })),
    rowFor(ok, { respondent_hash: '' }),
    rowFor(ok, { other_texts: '{not json' }),
    rowFor(ok, { respondent_hash: 'dup-hash' }), rowFor(ok, { respondent_hash: 'dup-hash' })
  ];
  const { valid, counts } = classify(rows);
  assert.equal(counts.rows, rows.length);
  assert.equal(counts.production_valid, 4); // 3 + 重複の最初の 1 件
  assert.equal(valid.length, 4);
  assert.equal(counts.test_excluded, 2);
  assert.deepEqual(counts.excluded, {
    unknown_response_mode: 2, incomplete: 1, version_mismatch: 2, malformed: 1,
    ineligible: 1, schema_invalid: 1, missing_hash: 1, duplicate: 1
  });
});

test('test 回答は標準集計・snapshot・件数に影響しない', () => {
  const prod = rowsFrom([{ count: 10 }]);
  const withTest = prod.concat(rowsFrom([{ count: 50, meta: { response_mode: 'test', test_run_id: 'x' } }]));
  const a = snapshotOf(classify(prod).valid);
  const b = snapshotOf(classify(withTest).valid);
  assert.deepEqual(a, b);
  assert.equal(b.production_valid_total, 10);
});

test('自由記述・「その他」本文は valid record の answers から分離され、public 入力には渡らない', () => {
  const rows = rowsFrom([{ count: 1, overrides: { feedback: 'SECRET-FEEDBACK', favorite_uniforms: ['baseball', 'other'] }, otherTexts: { favorite_uniforms: 'SECRET-OTHER' } }]);
  const { valid } = classify(rows);
  assert.equal(valid.length, 1);
  assert.ok(!('feedback' in valid[0].answers));
  assert.equal(valid[0].free_text.feedback, 'SECRET-FEEDBACK');
  assert.equal(valid[0].other_texts.favorite_uniforms, 'SECRET-OTHER');
  const snapshotText = JSON.stringify(snapshotOf(valid));
  assert.ok(!snapshotText.includes('SECRET'));
  // snapshot builder は answers だけを読む：他の field を壊しても結果は変わらない。
  const stripped = valid.map((r) => ({ answers: r.answers }));
  assert.deepEqual(snapshotOf(stripped), snapshotOf(valid));
});

// ── denominator = question_reached ──

test('targetCount は question_reached：その設問に到達した有効回答者数で、production 総数ではない', () => {
  const valid = validFrom([
    { count: 25, overrides: ATTENDEE },
    { count: 15, overrides: INTERESTED }
  ]);
  const list = valid.map((r) => r.answers);
  const tally = (id) => aggregate.tallyQuestion(schema, core.getQuestion(schema, id), list);
  assert.equal(tally('overall_satisfaction').targetCount, 25);
  assert.equal(tally('barriers').targetCount, 15);
  assert.equal(tally('baseball_experience').targetCount, 40);
  // #379 の countQuestionReached と同じ概念（別概念を作らない）。
  core.publicQuestionIds(schema).forEach((id) => {
    assert.equal(tally(id).targetCount, core.countQuestionReached(schema, id, list), id);
    assert.equal(core.denominatorOf(schema, id), 'question_reached');
  });
});

// ── minTotal / minTarget / minCell ──

test('early_factual: minTotal 10 / minTarget 10 / minCell 3（schema の publication が正本）', () => {
  assert.deepEqual(['minTotal', 'minTarget', 'minCell'].map((k) => publication('baseball_experience')[k]), [10, 10, 3]);
  const nine = entryOf(snapshotOf(validFrom([{ count: 9 }])), 'baseball_experience');
  assert.equal(nine.state, 'insufficient');
  assert.equal(nine.targetCount, null);
  assert.deepEqual(nine.cells, []);
  const ten = entryOf(snapshotOf(validFrom([{ count: 10 }])), 'baseball_experience');
  assert.equal(ten.state, 'published');
  assert.equal(ten.targetCount, 10);
});

test('bias_sensitive: minTotal 30 / minTarget 10', () => {
  assert.deepEqual(['minTotal', 'minTarget', 'minCell'].map((k) => publication('catchball_interest')[k]), [30, 10, 3]);
  const q = (specs) => entryOf(snapshotOf(validFrom(specs)), 'catchball_interest');
  assert.equal(q([{ count: 29, overrides: INTERESTED }]).state, 'insufficient'); // total 29 < 30
  assert.equal(q([{ count: 30, overrides: INTERESTED }]).state, 'published');
  assert.equal(q([{ count: 9, overrides: INTERESTED }, { count: 21, overrides: ATTENDEE }]).state, 'insufficient'); // target 9 < 10
  assert.equal(q([{ count: 10, overrides: INTERESTED }, { count: 20, overrides: ATTENDEE }]).state, 'published');
});

test('sensitive branch: minTarget 20 未満は非公開（正常）で、数値を出さない', () => {
  assert.deepEqual(['minTotal', 'minTarget', 'minCell'].map((k) => publication('repeat_intent')[k]), [30, 20, 3]);
  const q = (specs, id = 'repeat_intent') => entryOf(snapshotOf(validFrom(specs)), id);
  const under = q([{ count: 19, overrides: LAPSED }, { count: 11, overrides: INTERESTED }]);
  assert.equal(under.state, 'sensitive_withheld');
  assert.equal(under.targetCount, null);
  assert.deepEqual(under.cells, []);
  assert.equal(q([{ count: 20, overrides: LAPSED }, { count: 10, overrides: INTERESTED }]).state, 'published');
  // 総数が 30 未満でも非公開。
  assert.equal(q([{ count: 25, overrides: LAPSED }]).state, 'sensitive_withheld');
  // 参加経験者評価（scale）も同じ。
  assert.equal(q([{ count: 19, overrides: LAPSED }, { count: 11, overrides: INTERESTED }], 'overall_satisfaction').state, 'sensitive_withheld');
});

test('sensitiveBranch の minTarget は schema が緩んでも 20 を下回らない', () => {
  const loose = clone(schema);
  core.getQuestion(loose, 'repeat_intent').publication.minTarget = 10;
  const t = aggregate.effectiveThresholds(loose, core.getQuestion(loose, 'repeat_intent').publication);
  assert.equal(t.minTarget, aggregate.SENSITIVE_BRANCH_MIN_TARGET);
  assert.equal(aggregate.SENSITIVE_BRANCH_MIN_TARGET, 20);
});

test('private 設問は snapshot に出ない（publication.visibility が公開の唯一の正本）', () => {
  const snapshot = snapshotOf(validFrom([{ count: 40, overrides: ATTENDEE }]));
  const ids = snapshot.questions.map((q) => q.id);
  core.questionIds(schema).filter((id) => !core.isPublic(schema, id)).forEach((id) => assert.ok(!ids.includes(id), id));
  assert.deepEqual(aggregate.validateSnapshot(schema, snapshot), []);
});

// ── 回答件数表示 ──

test('回答件数表示：10件未満は数値なし、10件以上は10件単位に切り下げ（正確な件数を出さない）', () => {
  [0, 1, 9].forEach((n) => assert.deepEqual(aggregate.liveCountDisplay(schema, n), { state: 'collecting', floor: null, label: '回答受付中' }));
  assert.equal(aggregate.liveCountDisplay(schema, 10).floor, 10);
  assert.equal(aggregate.liveCountDisplay(schema, 19).floor, 10);
  assert.equal(aggregate.liveCountDisplay(schema, 37).floor, 30);
  assert.equal(aggregate.liveCountDisplay(schema, 37).label, '30件以上');
  const s = snapshotOf(validFrom([{ count: 37 }]));
  assert.equal(s.production_valid_total, 30);
  assert.ok(!JSON.stringify(s).includes('"37"') && !/\b37\b/.test(JSON.stringify(s.response_status)));
  assert.equal(snapshotOf(validFrom([{ count: 9 }])).production_valid_total, null);
});

// ── small-cell / complementary suppression ──

const defsOf = (n) => Array.from({ length: n }, (_, i) => ({ id: 'c' + i, label: 'C' + i }));
const countsOf = (list) => list.reduce((acc, n, i) => { acc['c' + i] = n; return acc; }, {});
const shown = (res) => res.cells.filter((c) => typeof c.count === 'number' && c.count > 0).map((c) => c.id + '=' + c.count);

test('small-cell suppression：minCell 未満は値を出さない（多選択は補完不要）', () => {
  const res = aggregate.suppressCells(defsOf(3), countsOf([20, 8, 2]), { minCell: 3, partition: false, ordered: false, showZeroCells: false });
  assert.deepEqual(shown(res), ['c0=20', 'c1=8']);
  assert.ok(!/"count":2[,}]/.test(JSON.stringify(res)));
});

test('complementary suppression：単一選択は小セルのほかに最小の公開セルも 1 つ隠し、逆算できないときは公開しない', () => {
  const opts = { minCell: 3, partition: true, ordered: false, showZeroCells: false };
  // 1 セルだけ隠すと total − 他セルで 2 が逆算できるため、最小の公開セル(8)も隠す。
  assert.deepEqual(shown(aggregate.suppressCells(defsOf(3), countsOf([20, 8, 2]), opts)), ['c0=20']);
  // 小セルが 2 つ（合計 4 ≥ minCell）でも、小セルだけを隠すと 2+2 に確定してしまうので、最小の公開セルも隠す。
  assert.deepEqual(shown(aggregate.suppressCells(defsOf(4), countsOf([10, 10, 2, 2]), opts)), ['c0=10']);
  // 公開できるセルが残らない／隠した元値が一意に決まる並びは何も公開しない。
  assert.equal(aggregate.suppressCells(defsOf(4), countsOf([30, 2, 0, 0]), opts).visibleNonzero, 0);
  assert.equal(aggregate.suppressCells(defsOf(3), countsOf([20, 2, 2]), opts).visibleNonzero, 0);
  // 小セルが無ければ何も隠さない。
  assert.deepEqual(shown(aggregate.suppressCells(defsOf(3), countsOf([20, 8, 5]), opts)), ['c0=20', 'c1=8', 'c2=5']);
});

test('ordinal の目盛りは保つ：隠したセルは位置だけ残し count:null（値なし）', () => {
  const opts = { minCell: 3, partition: true, ordered: true, showZeroCells: true };
  const res = aggregate.suppressCells(defsOf(5), countsOf([12, 2, 0, 9, 7]), opts);
  assert.deepEqual(res.cells.map((c) => c.id), ['c0', 'c1', 'c2', 'c3', 'c4']);
  assert.deepEqual(res.cells.map((c) => c.count), [12, null, 0, 9, null]); // 2 と、最小の公開セル(7)を隠す
  res.cells.filter((c) => c.count === null).forEach((c) => assert.equal(c.suppressed, true));
});

test('zero cell policy：showZeroCells は schema に従い、false ならゼロ・隠したセルを区別なく出力から除く', () => {
  const nominal = entryOf(snapshotOf(validFrom([{ count: 40, overrides: { favorite_uniforms: ['baseball'] } }])), 'favorite_uniforms');
  assert.equal(publication('favorite_uniforms').showZeroCells, false);
  assert.deepEqual(nominal.cells.map((c) => c.id), ['baseball']);
  const ordinal = entryOf(snapshotOf(validFrom([{ count: 40, overrides: { baseball_experience: 'team' } }])), 'baseball_experience');
  assert.equal(publication('baseball_experience').showZeroCells, true);
  assert.equal(ordinal.cells.length, 5);
  assert.deepEqual(ordinal.cells.map((c) => c.count), [40, 0, 0, 0, 0]);
});

test('実 snapshot で complementary suppression が効き、隠したセルを targetCount から逆算できない', () => {
  // baseball_experience(ordinal, partition): 20 / 2 / 8 / 0 / 0
  const valid = validFrom([
    { count: 20, overrides: { baseball_experience: 'team' } },
    { count: 2, overrides: { baseball_experience: 'grass_baseball' } },
    { count: 8, overrides: { baseball_experience: 'catchball_only' } }
  ]);
  const q = entryOf(snapshotOf(valid), 'baseball_experience');
  assert.equal(q.state, 'published');
  assert.equal(q.targetCount, 30);
  const byId = Object.fromEntries(q.cells.map((c) => [c.id, c.count]));
  assert.equal(byId.grass_baseball, null);
  assert.equal(byId.catchball_only, null); // 補完秘匿
  assert.equal(byId.team, 20);
  assert.equal(q.hasSuppressedCells, true);
  assert.deepEqual(aggregate.validateSnapshot(schema, snapshotOf(valid)), []);
});

test('snapshot の不変条件（validateSnapshot）が、ランダムな分布 300 通りで成り立つ', () => {
  const rand = lcg(20261019);
  const singles = aggregate.publicEntries(schema).filter((e) => e.kind === 'question' && ['single', 'scale', 'single_dynamic'].includes(e.question.type));
  let checked = 0;
  for (let seed = 0; seed < 300; seed++) {
    const total = 10 + Math.floor(rand() * 60);
    const skew = 1 + Math.floor(rand() * 5);
    const list = [];
    for (let i = 0; i < total; i++) {
      const pick = (options) => options[Math.floor(Math.pow(rand(), skew) * options.length)].id;
      const overrides = {
        baseball_experience: pick(schema.questions.find((q) => q.id === 'baseball_experience').options),
        exercise_frequency: pick(schema.questions.find((q) => q.id === 'exercise_frequency').options),
        club_awareness: rand() < 0.6 ? 'attended' : 'aware_not_attended',
        last_attended: 'within_3m',
        catchball_interest: pick(schema.questions.find((q) => q.id === 'catchball_interest').options)
      };
      const answers = answersFor(overrides);
      if (answers.club_awareness === 'attended') {
        ['overall_satisfaction', 'satisfaction_atmosphere'].forEach((id) => { answers[id] = String(1 + Math.floor(Math.pow(rand(), skew) * 5)); });
        answers.repeat_intent = pick(schema.questions.find((q) => q.id === 'repeat_intent').options);
      }
      list.push({ answers });
    }
    const snapshot = snapshotOf(list);
    assert.deepEqual(aggregate.validateSnapshot(schema, snapshot), [], 'seed ' + seed);
    singles.forEach((entry) => {
      const q = entryOf(snapshot, entry.id);
      if (q.state !== 'published') return;
      checked++;
      q.cells.forEach((c) => { if (typeof c.count === 'number' && c.count > 0) assert.ok(c.count >= aggregate.effectiveThresholds(schema, entry.publication).minCell); });
    });
  }
  assert.ok(checked > 500, 'published な設問を十分に検査した: ' + checked);
});

function* compositions(n, total) {
  if (n === 1) { yield [total]; return; }
  for (let i = 0; i <= total; i++) for (const rest of compositions(n - 1, total - i)) yield [i].concat(rest);
}

test('回帰：minCell=3 で ordinal の小セルが 2・2 のとき、両方を隠しても 2+2 に確定しない', () => {
  const opts = { minCell: 3, partition: true, ordered: true, showZeroCells: true };
  const res = aggregate.suppressCells(defsOf(5), countsOf([20, 10, 2, 2, 0]), opts);
  // 小セル 2 つに加えて最小の公開セル(10)も隠すので、隠した合計 14 は (2,2,10) 以外にも (1,2,11) (1,1,12) などに分かれる。
  assert.deepEqual(res.cells.map((c) => c.count), [20, null, null, null, 0]);
  // 同じ並びを実 schema の ordinal 設問（baseball_experience）で。
  const valid = validFrom([
    { count: 20, overrides: { baseball_experience: 'team' } },
    { count: 2, overrides: { baseball_experience: 'grass_baseball' } },
    { count: 2, overrides: { baseball_experience: 'catchball_only' } },
    { count: 10, overrides: { baseball_experience: 'class_play' } }
  ]);
  const snapshot = snapshotOf(valid);
  const q = entryOf(snapshot, 'baseball_experience');
  assert.equal(q.state, 'published');
  assert.deepEqual(Object.fromEntries(q.cells.map((c) => [c.id, c.count])), { team: 20, grass_baseball: null, catchball_only: null, class_play: null, none: 0 });
  assert.deepEqual(aggregate.validateSnapshot(schema, snapshot), []);
});

// 独立検証：総当たりで、公開出力と整合する元の件数ベクトルをすべて列挙し、小セルの値が一意に決まらないことを確認する。
test('総当たり検証：公開された出力と整合する元の件数が複数あり、どの小セルの値も一意に決まらない', () => {
  let published = 0;
  for (const minCell of [3, 4]) {
    for (const ordered of [true, false]) {
      for (const n of [3, 4, 5]) {
        for (let total = 3; total <= (n === 5 ? 14 : 18); total++) {
          const groups = new Map();
          for (const vector of compositions(n, total)) {
            const res = aggregate.suppressCells(defsOf(n), countsOf(vector), { minCell, partition: true, ordered, showZeroCells: ordered });
            const key = JSON.stringify([res.cells, res.visibleNonzero]);
            if (!groups.has(key)) groups.set(key, { visibleNonzero: res.visibleNonzero, vectors: [] });
            groups.get(key).vectors.push(vector);
          }
          groups.forEach((group) => {
            if (group.visibleNonzero === 0) return; // 何も公開しない出力は逆算の対象外
            published++;
            group.vectors.forEach((vector) => vector.forEach((value, i) => {
              if (value > 0 && value < minCell) {
                const candidates = new Set(group.vectors.map((v) => v[i]));
                assert.ok(candidates.size >= 2, `一意に確定: minCell=${minCell} ordered=${ordered} ${JSON.stringify(vector)}`);
              }
            }));
          });
        }
      }
    }
  }
  assert.ok(published > 1000, '公開される出力を十分に検査した: ' + published);
});

test('総当たり検証（地域）：「その他の地域」でも小ブロックの元値が一意に決まらない', () => {
  const blocks = ['b0', 'b1', 'b2', 'b3', 'b4'].map((id) => ({ id, label: id, prefectureOptionIds: [] }));
  const region = clone(schema);
  region.publicRegionAggregation.blocks = blocks;
  const defs = blocks.map((b) => ({ id: b.id, label: b.label, independent: false }));
  let published = 0;
  for (let total = 3; total <= 16; total++) {
    const groups = new Map();
    for (const vector of compositions(5, total)) {
      const counts = Object.fromEntries(vector.map((v, i) => ['b' + i, v]));
      const res = aggregate.regionCells(region, { defs, counts, targetCount: total }, { sort: 'count_desc' }, { minCell: 3 });
      const key = JSON.stringify(res.cells);
      if (!groups.has(key)) groups.set(key, { cells: res.cells, vectors: [] });
      groups.get(key).vectors.push(vector);
    }
    groups.forEach((group) => {
      if (group.cells.length === 0) return;
      published++;
      group.vectors.forEach((vector) => vector.forEach((value, i) => {
        if (value > 0 && value < 3) assert.ok(new Set(group.vectors.map((v) => v[i])).size >= 2, `一意に確定: ${JSON.stringify(vector)}`);
      }));
    });
  }
  assert.ok(published > 200, String(published));
});

test('地域の回帰：小ブロックが 2・2 でも、その他の地域の合計から 2+2 に確定しない', () => {
  const q = regionOf([prefSpec(PREF.tokyo, 20), prefSpec(PREF.aichi, 10), prefSpec(PREF.osaka, 2), prefSpec(PREF.hokkaido, 2)]);
  assert.equal(q.state, 'published');
  assert.deepEqual(q.cells.map((c) => [c.label, c.count]), [['関東', 20], ['その他の地域', 14]]); // 東海 10 も取り込む
  // 取り込んだ結果、公開できるブロックが残らないなら公開しない（小ブロック 2・2 + 公開ブロック 1 つだけ）。
  const only = regionOf([prefSpec(PREF.osaka, 2), prefSpec(PREF.hokkaido, 2), prefSpec(PREF.tokyo, 20)]);
  assert.equal(only.state, 'suppressed_all');
  assert.equal(only.targetCount, null);
  assert.deepEqual(only.cells, []);
});

test('validateSnapshot は小セルの公開・逆算可能な抑止不足・順序違反を検出する', () => {
  const valid = validFrom([
    { count: 20, overrides: { baseball_experience: 'team' } },
    { count: 10, overrides: { baseball_experience: 'catchball_only' } }
  ]);
  const good = snapshotOf(valid);
  assert.deepEqual(aggregate.validateSnapshot(schema, good), []);
  const mutate = (fn) => { const s = clone(good); fn(entryOf(s, 'baseball_experience')); return aggregate.validateSnapshot(schema, s); };
  assert.ok(mutate((q) => { q.cells[0].count = 2; q.cells[1].count = 28; }).some((p) => /minCell 未満/.test(p)));
  assert.ok(mutate((q) => { q.cells[2].count = null; q.cells[2].suppressed = true; q.cells[0].count = 18; q.cells[0].count = 18; }).length > 0);
  assert.ok(mutate((q) => { q.cells.reverse(); }).some((p) => /schema の順序/.test(p)));
  // 5 セルのうち 1 つだけ値を隠して合計が 1 セルに確定する状態。
  assert.ok(mutate((q) => { q.cells[1].count = null; q.cells[1].suppressed = true; q.cells[0].count = 20; q.cells[2].count = 8; }).some((p) => /逆算/.test(p)));
});

// ── ordinal / nominal の並び ──

test('ordinal は schema の順序、scale は 1..5 のあと尺度外の cannot_rate を末尾に置く', () => {
  const valid = validFrom([
    { count: 12, overrides: Object.assign({}, LAPSED, { overall_satisfaction: '5' }) },
    { count: 10, overrides: Object.assign({}, LAPSED, { overall_satisfaction: '1' }) },
    { count: 8, overrides: Object.assign({}, LAPSED, { overall_satisfaction: 'cannot_rate' }) }
  ]);
  const q = entryOf(snapshotOf(valid), 'overall_satisfaction');
  assert.equal(q.state, 'published');
  assert.deepEqual(q.cells.map((c) => c.id), ['1', '2', '3', '4', '5', 'cannot_rate']);
  assert.equal(q.cells.at(-1).independent, true);
  const ord = entryOf(snapshotOf(valid), 'baseball_experience');
  assert.deepEqual(ord.cells.map((c) => c.id), core.getQuestion(schema, 'baseball_experience').options.map((o) => o.id));
});

test('nominal は count_desc、同数は schema の option 順（tieBreak）', () => {
  assert.equal(publication('favorite_uniforms').sort, 'count_desc');
  assert.equal(publication('favorite_uniforms').tieBreak, 'schema_option_order');
  const valid = validFrom([
    { count: 12, overrides: { favorite_uniforms: ['soccer'] } },
    { count: 12, overrides: { favorite_uniforms: ['baseball'] } },
    { count: 6, overrides: { favorite_uniforms: ['basketball'] } }
  ]);
  const q = entryOf(snapshotOf(valid), 'favorite_uniforms');
  assert.deepEqual(q.cells.map((c) => c.id), ['baseball', 'soccer', 'basketball']);
});

// ── 地域 ──

const PREF = { tokyo: 'pref_13', aichi: 'pref_23', osaka: 'pref_27', hokkaido: 'pref_01' };
const regionOf = (specs) => entryOf(snapshotOf(validFrom(specs)), 'region_blocks');
const prefSpec = (pref, count, extra = {}) => ({ count, overrides: Object.assign({ prefecture: pref }, pref === 'pref_23' ? { aichi_area: 'nagoya' } : {}, pref === 'overseas' ? { residence_country: 'COUNTRY-SECRET' } : {}, extra) });

test('地域は地方ブロックだけを公開し、小さいブロックは「その他の地域」にまとめる', () => {
  const q = regionOf([prefSpec(PREF.tokyo, 12), prefSpec(PREF.aichi, 9), prefSpec(PREF.osaka, 2), prefSpec(PREF.hokkaido, 2), prefSpec('prefer_not_to_say', 1)]);
  assert.equal(q.state, 'published');
  assert.equal(q.targetCount, 25); // 回答しない を除く
  // 小ブロック（関西 2・北海道 2）だけをまとめると合計 4 から 2+2 に確定するため、最小の公開ブロック（東海 9）も取り込む。
  assert.deepEqual(q.cells.map((c) => [c.label, c.count]), [['関東', 12], ['その他の地域', 13]]);
});

test('地域の補完秘匿：まとめた先が 1 ブロックだけ・minCell 未満なら、最小の公開ブロックも取り込む', () => {
  const q = regionOf([prefSpec(PREF.tokyo, 12), prefSpec(PREF.aichi, 9), prefSpec(PREF.osaka, 2)]);
  assert.deepEqual(q.cells.map((c) => [c.label, c.count]), [['関東', 12], ['その他の地域', 11]]);
  assert.deepEqual(aggregate.validateSnapshot(schema, snapshotOf(validFrom([prefSpec(PREF.tokyo, 12), prefSpec(PREF.aichi, 9), prefSpec(PREF.osaka, 2)]))), []);
  // 全ブロックが少数なら公開しない。
  const all = regionOf([prefSpec(PREF.tokyo, 2), prefSpec(PREF.osaka, 2), prefSpec(PREF.hokkaido, 2), prefSpec(PREF.aichi, 2), prefSpec('overseas', 2)]);
  assert.equal(all.state, 'suppressed_all');
  assert.equal(all.targetCount, null);
});

test('詳細都道府県・愛知県内の地域は snapshot のどこにも出ない', () => {
  const valid = validFrom([prefSpec(PREF.aichi, 20), prefSpec(PREF.tokyo, 15), prefSpec('overseas', 5)]);
  const text = JSON.stringify(snapshotOf(valid));
  assert.ok(!/pref_\d\d/.test(text));
  assert.ok(!text.includes('aichi_area') && !text.includes('"prefecture"') && !text.includes('愛知') && !text.includes('名古屋市'));
  assert.ok(!text.includes('nagoya"') && !text.includes('owari') && !text.includes('mikawa'));
  assert.ok(!text.includes('residence_country') && !text.includes('COUNTRY-SECRET'), '海外の国・地域名は public snapshot に出ない');
  const bad = clone(snapshotOf(valid));
  bad.questions[0].cells[0].id = 'pref_23';
  assert.ok(aggregate.validateSnapshot(schema, bad).some((p) => /詳細都道府県/.test(p)));
  const loosened = clone(schema);
  loosened.publicRegionAggregation.privacy.publishPrefectureDetail = true;
  assert.throws(() => aggregate.buildSnapshot(loosened, [], { generatedAt: NOW }), /詳細都道府県/);
});

test('海外の国・地域名は Admin の自由記述一覧では確認でき、public snapshot には出ない', () => {
  const rows = [rowFor(answersFor(Object.assign({ prefecture: 'overseas', residence_country: 'COUNTRY-SECRET' }, INTERESTED)))];
  const items = aggregate.listFreeText(schema, aggregate.classifyRows(schema, rows));
  assert.ok(items.some((i) => i.questionId === 'residence_country' && i.text === 'COUNTRY-SECRET'));
  assert.ok(!JSON.stringify(aggregate.buildSnapshot(schema, aggregate.classifyRows(schema, rows).valid, { generatedAt: NOW })).includes('COUNTRY-SECRET'));
});

// ── public に出さない項目 ──

test('free text・個票・system identifier・private 設問は public snapshot に出ない', () => {
  const rows = [];
  for (let i = 0; i < 40; i++) {
    rows.push(rowFor(answersFor(Object.assign({ feedback: 'UNIQUE-FEEDBACK-' + i, support_message: 'UNIQUE-SUPPORT-' + i, prefecture: PREF.aichi, aichi_area: 'mikawa', favorite_uniforms: ['baseball', 'other'] }, i % 2 ? ATTENDEE : INTERESTED)),
      { source_channel: 'line' }, { favorite_uniforms: 'UNIQUE-OTHER-' + i }));
  }
  const { valid } = classify(rows);
  assert.equal(valid.length, 40);
  const snapshot = snapshotOf(valid);
  const text = JSON.stringify(snapshot);
  ['UNIQUE-', 'feedback', 'support_message', 'source_channel', 'respondent_hash', 'client_elapsed_ms', 'other_texts', 'timestamp', 'line'].forEach((needle) => {
    if (needle === 'line') return; // 'line' は他の語に含まれうるため source_channel の key で検査する
    assert.ok(!text.includes(needle), needle);
  });
  rows.forEach((r) => assert.ok(!text.includes(r.respondent_hash)));
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(text));
  assert.deepEqual(aggregate.validateSnapshot(schema, snapshot), []);
  // 個票を示すキーを混ぜると検出する。
  ['respondent_hash', 'answers', 'free_text', 'source_channel'].forEach((key) => {
    const bad = clone(snapshot);
    bad[key] = 'x';
    assert.ok(aggregate.validateSnapshot(schema, bad).some((p) => p.includes(key)), key);
  });
  const privateId = clone(snapshot);
  privateId.questions[1].cells = [{ id: 'age', label: 'x', count: 5 }];
  assert.ok(aggregate.validateSnapshot(schema, privateId).some((p) => /非公開設問/.test(p)));
});

// ── publicResultsOrder ──

test('publicResultsOrder が snapshot の並びの正本で、public question との不一致は例外になる', () => {
  const snapshot = snapshotOf(validFrom([{ count: 40 }]));
  assert.deepEqual(snapshot.questions.map((q) => q.id), schema.publicResultsOrder);
  assert.deepEqual(aggregate.publicEntries(schema).map((e) => e.id), schema.publicResultsOrder);
  const build = (mutate) => { const s = clone(schema); mutate(s); return () => aggregate.buildSnapshot(s, [], { generatedAt: NOW }); };
  assert.throws(build((s) => { s.publicResultsOrder.pop(); }), /publicResultsOrder にない公開設問/);
  assert.throws(build((s) => { s.publicResultsOrder.push('no_such_question'); }), /存在しない設問/);
  assert.throws(build((s) => { s.publicResultsOrder.push('feedback'); }), /非公開設問/);
  assert.throws(build((s) => { s.publicResultsOrder.push(s.publicResultsOrder[0]); }), /重複/);
  assert.throws(build((s) => { s.publicRegionAggregation.enabled = false; }), /region_blocks/);
  // 並び替えは schema の順に従う（ベタ書きの順序を持たない）。
  const swapped = clone(schema);
  [swapped.publicResultsOrder[1], swapped.publicResultsOrder[2]] = [swapped.publicResultsOrder[2], swapped.publicResultsOrder[1]];
  assert.deepEqual(aggregate.buildSnapshot(swapped, [], { generatedAt: NOW }).questions.map((q) => q.id), swapped.publicResultsOrder);
  const drift = clone(snapshot);
  [drift.questions[1], drift.questions[2]] = [drift.questions[2], drift.questions[1]];
  assert.ok(aggregate.validateSnapshot(schema, drift).some((p) => /publicResultsOrder/.test(p)));
});

test('schema drift：snapshot の survey/schema/design version が schema と違えば検出する', () => {
  const snapshot = snapshotOf(validFrom([{ count: 10 }]));
  ['survey_id', 'survey_version', 'schema_version', 'design_version'].forEach((key) => {
    assert.equal(snapshot[key], schema[key]);
    const bad = clone(snapshot);
    bad[key] = 'other';
    assert.ok(aggregate.validateSnapshot(schema, bad).some((p) => p.includes(key)), key);
  });
});

test('2 層の section：early_factual は現在の回答状況、bias_sensitive はアンケート結果', () => {
  const snapshot = snapshotOf(validFrom([{ count: 10 }]));
  assert.deepEqual(snapshot.sections.map((s) => s.id), ['response_status', 'survey_results']);
  snapshot.questions.forEach((q) => {
    assert.equal(q.section, q.tier === 'early_factual' ? 'response_status' : 'survey_results', q.id);
  });
});

// ── semantic code ──

test('semantic code は回答者単位で 1 回だけ数える（複数 option・primary と secondary の重複を加算しない）', () => {
  const barriers = core.getQuestion(schema, 'barriers');
  const codesOf = (o) => (o.semanticCodes ? [o.semanticCodes.primary].concat(o.semanticCodes.secondary || []) : []);
  // 同じ code を持つ option の組を schema から探す。
  let pair = null;
  barriers.options.forEach((a, i) => barriers.options.forEach((b, j) => {
    if (pair || j <= i) return;
    const shared = codesOf(a).filter((c) => codesOf(b).includes(c));
    if (shared.length) pair = { a: a.id, b: b.id, code: shared[0] };
  }));
  assert.ok(pair, 'barriers に同じ semantic code を持つ option の組がある');
  const valid = validFrom([
    { count: 1, overrides: Object.assign({}, INTERESTED, { barriers: [pair.a, pair.b], main_barrier: pair.a }) },
    { count: 1, overrides: Object.assign({}, INTERESTED, { barriers: [pair.a], main_barrier: pair.a }) }
  ]);
  const source = aggregate.analyzeSemanticCodes(schema, valid).sources.find((s) => s.questionId === 'barriers');
  assert.equal(source.targetCount, 2);
  assert.equal(source.codes[pair.code], 2); // 1 人目は 2 option から該当しても 1 人
  Object.keys(source.codes).forEach((code) => assert.ok(source.codes[code] <= source.targetCount, code));
});

test('primary / secondary の二重定義でも同一回答者は 1 カウント', () => {
  const synthetic = clone(schema);
  const q = core.getQuestion(synthetic, 'barriers');
  q.options[0].semanticCodes = { primary: 'cost', secondary: ['schedule'] };
  q.options[1].semanticCodes = { primary: 'schedule', secondary: ['cost'] };
  const answers = answersFor(Object.assign({}, INTERESTED, { barriers: [q.options[0].id, q.options[1].id], main_barrier: q.options[0].id }));
  const result = aggregate.analyzeSemanticCodes(synthetic, [{ answers }]);
  const source = result.sources.find((s) => s.questionId === 'barriers');
  assert.equal(source.codes.cost, 1);
  assert.equal(source.codes.schedule, 1);
});

test('障壁と安心条件を code ごとに比較できる（reassuranceFor）', () => {
  const cond = core.getQuestion(schema, 'participation_conditions');
  const defaultOption = cond.options.find((o) => !o.other && !o.exclusive); // fixture が既定で選ぶ option
  const withCode = cond.options.find((o) => o.id !== defaultOption.id && (o.reassuranceFor || []).length >= 2);
  const valid = validFrom([
    { count: 1, overrides: Object.assign({}, INTERESTED, { participation_conditions: [withCode.id] }) },
    { count: 1, overrides: INTERESTED }
  ]);
  const { comparison, sources } = aggregate.analyzeSemanticCodes(schema, valid);
  assert.ok(sources.some((s) => s.role === 'barrier') && sources.some((s) => s.role === 'reassurance'));
  withCode.reassuranceFor.forEach((code) => {
    const row = comparison.find((r) => r.code === code);
    assert.ok(row, code);
    assert.equal(row.reassuranceDefined, true);
    const expected = 1 + ((defaultOption.reassuranceFor || []).includes(code) ? 1 : 0);
    assert.equal(row.reassurance.participation_conditions, expected);
  });
});

// ── snapshot の batch 更新 ──

test('snapshot は batch 更新：1 日 1 回、または十分な件数増分。増分は minCell 以上', () => {
  const update = schema.publicationPolicy.snapshotUpdate;
  assert.equal(update.mode, 'batch_only');
  assert.equal(update.perResponseUpdate, false);
  const policy = aggregate.snapshotPolicy(schema);
  assert.equal(policy.perResponseUpdate, false);
  assert.ok(policy.minimumIncrement >= 3);
  assert.equal(policy.countTriggerIncrement, 10);
  const t0 = new Date('2026-11-10T00:00:00Z');
  const prev = { generated_at: t0.toISOString(), production_valid_total: 20 };
  const at = (hours) => new Date(t0.getTime() + hours * 3600 * 1000);
  const decide = (current, hours) => aggregate.decideSnapshotUpdate(schema, prev, current, at(hours));
  assert.equal(aggregate.decideSnapshotUpdate(schema, null, 0, t0).reason, 'initial');
  assert.deepEqual([decide(21, 1).update, decide(21, 1).reason], [false, 'insufficient_increment']); // 1 件では更新しない（差分から復元されうる）
  assert.deepEqual([decide(22, 30).update, decide(22, 30).reason], [false, 'insufficient_increment']); // 日次でも minCell 未満の増分は更新しない
  assert.deepEqual([decide(25, 1).update, decide(25, 1).reason], [false, 'not_due']);
  assert.deepEqual([decide(30, 1).update, decide(30, 1).reason], [true, 'count_increment']);
  assert.deepEqual([decide(23, 24).update, decide(23, 24).reason], [true, 'daily']);
  assert.equal(decide(19, 48).update, false);
});

test('Admin summary は exact な件数と公開条件の達成/未達、抑止後の public preview を持ち、個票・hash・自由記述を含まない', () => {
  const rows = rowsFrom([{ count: 35, overrides: Object.assign({ feedback: 'SUMMARY-SECRET' }, INTERESTED) }, { count: 20, overrides: ATTENDEE }, { count: 3, meta: { response_mode: 'test', test_run_id: 'r' } }]);
  const classification = classify(rows);
  const summary = aggregate.buildAdminSummary(schema, classification, { now: NOW });
  assert.equal(summary.production_valid_total, 55);
  assert.equal(summary.test_excluded, 3);
  const q = Object.fromEntries(summary.questions.map((x) => [x.id, x]));
  assert.equal(q.barriers.targetCount, 35);
  assert.equal(q.barriers.targetMet, true);
  assert.equal(q.repeat_intent.targetCount, 20);
  assert.equal(q.repeat_intent.publicState, 'published');
  assert.deepEqual(summary.publicPreview, snapshotOf(classification.valid));
  const text = JSON.stringify(summary);
  rows.forEach((r) => assert.ok(!text.includes(r.respondent_hash)));
  assert.ok(!text.includes('SUMMARY-SECRET'));
  assert.equal(aggregate.listFreeText(schema, classification).filter((i) => i.text === 'SUMMARY-SECRET').length, 35);
});
