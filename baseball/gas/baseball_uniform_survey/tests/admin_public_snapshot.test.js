'use strict';
// Admin の snapshot タブ（Issue #425）：Public GAS が保持する snapshot の状態を readonly で表示する。実Googleへは接続しない。
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createAdminEnv } = require('./helpers/admin-env');
const { schema, aggregate, rowsFrom, validFrom, NOW } = require('./helpers/fixtures');
const SnapshotStore = require('../src/snapshot-store.js');

const plain = (x) => JSON.parse(JSON.stringify(x));
const sha = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const ATTENDEE = { club_awareness: 'attended', last_attended: 'within_3m' };
const INTERESTED = { club_awareness: 'aware_not_attended', catchball_interest: 'very_interested' };
const DAY = 24 * 3600 * 1000;

const specs = (attendees, interested) => [{ count: attendees, overrides: Object.assign({}, ATTENDEE, { overall_satisfaction: '5' }) }, { count: interested, overrides: INTERESTED }];

/** Public GAS が保存する public_snapshot シートの全値（公開済みと仮定する件数 count 件ぶんの snapshot）。 */
function publicGrid(count, generatedAt, reason = 'daily') {
  const valid = validFrom(specs(count > 20 ? count - 20 : count, count > 20 ? 20 : 0));
  const snapshot = aggregate.buildSnapshot(schema, valid, { generatedAt });
  const json = JSON.stringify(snapshot);
  const planned = SnapshotStore.plan(json, sha(json), {
    generatedAt: snapshot.generated_at, exactTotal: valid.length, publicTotal: snapshot.production_valid_total, reason,
    updatedAt: generatedAt.toISOString(), surveyVersion: schema.survey_version, schemaVersion: schema.schema_version, designVersion: schema.design_version
  }, null);
  const grid = planned.chunkCells.map((c, i) => [i === 0 ? planned.metaCell : '', planned.slot === 0 ? c : '', planned.slot === 1 ? c : '']);
  return { grid, snapshot, valid };
}

test('getPublicSnapshotStatus：generated_at / 公開上の total / 更新理由 / 次回更新の条件 / 現在の増分 / preview との差を返す', () => {
  const published = publicGrid(30, NOW);
  const env = createAdminEnv(rowsFrom(specs(45, 20)), { publicSnapshotGrid: published.grid });
  const status = plain(env.ctx.getPublicSnapshotStatus_(new Date(NOW.getTime() + 2 * 3600 * 1000)));
  assert.equal(status.status, 'ok');
  assert.equal(status.generated_at, NOW.toISOString());
  assert.equal(status.production_valid_total, published.snapshot.production_valid_total);
  assert.equal(status.last_update_reason, 'daily');
  assert.equal(status.current_production_valid_total, 65);
  assert.equal(status.increment, 65 - 30);
  const policy = aggregate.snapshotPolicy(schema);
  assert.equal(status.conditions.minimum_increment, policy.minimumIncrement);
  assert.equal(status.conditions.count_trigger_increment, policy.countTriggerIncrement);
  assert.equal(status.conditions.next_daily_at, new Date(NOW.getTime() + DAY).toISOString());
  assert.equal(status.would_update, true);
  assert.equal(status.decision_reason, 'count_increment');
  assert.equal(status.diff.public_production_valid_total, published.snapshot.production_valid_total);
  assert.ok(status.diff.changed_questions.every((q) => q.public_state !== q.preview_state));
  // 回答値・hash・自由記述は返さない。
  assert.ok(!/respondent_hash|free_text|other_texts/.test(JSON.stringify(status)));
});

test('公開済み snapshot と同じ内容なら差は無く、増分が足りなければ更新しない', () => {
  const published = publicGrid(65, NOW);
  const env = createAdminEnv(rowsFrom(specs(45, 20)), { publicSnapshotGrid: published.grid });
  const status = plain(env.ctx.getPublicSnapshotStatus_(new Date(NOW.getTime() + 3600 * 1000)));
  assert.equal(status.would_update, false);
  assert.equal(status.decision_reason, 'insufficient_increment');
  assert.deepEqual(status.diff.changed_questions, []);
});

test('store が無い・壊れている場合は status だけ返し、手動の SNAPSHOT_STATE に fallback する', () => {
  const env = createAdminEnv(rowsFrom(specs(45, 20)));
  assert.deepEqual(plain(env.ctx.getPublicSnapshotStatus_(NOW)), { status: 'empty' });
  env.props.set('SNAPSHOT_STATE', JSON.stringify({ generated_at: NOW.toISOString(), production_valid_total: 10 }));
  assert.deepEqual(plain(env.ctx.getSnapshotState_()), { generated_at: NOW.toISOString(), production_valid_total: 10 });

  const published = publicGrid(30, NOW);
  published.grid[0][1] = published.grid[0][1].replace('"questions"', '"respondent_hash":"x","questions"');
  const broken = createAdminEnv(rowsFrom(specs(45, 20)), { publicSnapshotGrid: published.grid });
  assert.ok(['length_mismatch', 'digest_mismatch'].includes(plain(broken.ctx.getPublicSnapshotStatus_(NOW)).status));
});

test('更新判定の基準は Public GAS の store を優先する。Admin は read-only のまま（書き込み API を呼ばない）', () => {
  const published = publicGrid(30, NOW);
  const env = createAdminEnv(rowsFrom(specs(45, 20)), { publicSnapshotGrid: published.grid });
  env.props.set('SNAPSHOT_STATE', JSON.stringify({ generated_at: '2020-01-01T00:00:00.000Z', production_valid_total: 1 }));
  assert.deepEqual(plain(env.ctx.getSnapshotState_()), { generated_at: NOW.toISOString(), production_valid_total: 30 });
  env.ctx.getPublicSnapshotStatus();
  env.ctx.getAdminSummary();
  assert.deepEqual(env.writes, []);
  assert.ok(env.calls.every((c) => !/update|append|clear|batchUpdate/i.test(c)));
});
