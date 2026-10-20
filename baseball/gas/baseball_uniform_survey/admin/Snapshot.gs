/**
 * public snapshot の生成（Admin のみ。公開結果ページは Spreadsheet を直接読まない）。
 *
 * - snapshot は privacy-safe な JSON。生成に使うのは valid record の answers だけで、
 *   自由記述・「その他」本文・respondent_hash は参照しない（このファイルは FreeText.gs を呼ばない）。
 * - 公開は batch のみ。1 回答ごとに更新しない。公開結果ページが読む snapshot は Public GAS が保持し（#425）、
 *   更新判定を通ったときに自動で更新される。ここで生成する JSON は preview（同梱 snapshot.json を手動更新する非常用）で、
 *   Public GAS が保持する snapshot（public_snapshot シート。readonly で読む）との差を getPublicSnapshotStatus_ で確認できる。
 * - 更新してよいか（1日1回 / 十分な件数増分 / 増分は minCell 以上）は SurveyAggregate.decideSnapshotUpdate が判定する。
 */
function sha256Hex_(text) {
  return SnapshotStore.bytesToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8));
}

/** Public GAS が保持している snapshot（検証済みのときだけ ok:true）。読めない・無い場合は {ok:false, problem}。 */
function readPublicSnapshot_() {
  var grid;
  try {
    grid = readPublicSnapshotGrid_();
  } catch (e) {
    return { ok: false, problem: 'unavailable' };
  }
  if (!grid) return { ok: false, problem: 'empty' };
  var stored = SnapshotStore.readGrid(grid, sha256Hex_);
  if (!stored.ok) return stored;
  if (SurveyAggregate.validateSnapshot(SURVEY_SCHEMA, stored.snapshot).length) return { ok: false, problem: 'snapshot_invalid' };
  return stored;
}

/**
 * 更新判定に使う「最後に公開した snapshot」。Public GAS の store があればそれ（正）、無ければ Admin 自身の SNAPSHOT_STATE（手動運用の記録）。
 */
function getSnapshotState_() {
  var published = readPublicSnapshot_();
  if (published.ok) return { generated_at: published.meta.generated_at, production_valid_total: published.meta.exact_total };
  return getManualSnapshotState_();
}

function getManualSnapshotState_() {
  var raw = getProperty_(PROP_SNAPSHOT_STATE);
  if (!raw) return null;
  try {
    var state = JSON.parse(raw);
    return state && typeof state.generated_at === 'string' ? state : null;
  } catch (e) {
    return null;
  }
}

function buildSnapshotResult_(now) {
  var classification = classifyResponses_();
  var total = classification.valid.length;
  var decision = SurveyAggregate.decideSnapshotUpdate(SURVEY_SCHEMA, getSnapshotState_(), total, now);
  var snapshot = SurveyAggregate.buildSnapshot(SURVEY_SCHEMA, classification.valid, { generatedAt: now });
  var problems = SurveyAggregate.validateSnapshot(SURVEY_SCHEMA, snapshot);
  if (problems.length) throw new Error('snapshot_invalid');
  return {
    snapshot: snapshot,
    snapshotJson: JSON.stringify(snapshot, null, 2) + '\n',
    exactTotal: total,
    decision: { update: decision.update, reason: decision.reason, increment: decision.increment }
  };
}

/** 公開した snapshot の生成時刻と件数を記録する（次回の更新判定用）。Spreadsheet には書かない。 */
function recordSnapshotPublished_(generatedAt, exactTotal) {
  if (typeof generatedAt !== 'string' || isNaN(new Date(generatedAt).getTime())) throw new Error('invalid_request');
  if (typeof exactTotal !== 'number' || exactTotal < 0 || exactTotal !== Math.floor(exactTotal)) throw new Error('invalid_request');
  PropertiesService.getScriptProperties().setProperty(
    PROP_SNAPSHOT_STATE,
    JSON.stringify({ generated_at: generatedAt, production_valid_total: exactTotal })
  );
  return { ok: true };
}

/** preview と公開中 snapshot の差（設問ごとの公開状態・公開する回答数）。数値のセルは含めない。 */
function diffSnapshots_(preview, published) {
  var byId = {};
  published.questions.forEach(function (q) { byId[q.id] = q; });
  var changed = [];
  preview.questions.forEach(function (q) {
    var other = byId[q.id];
    var before = other ? other.state : 'absent';
    if (before !== q.state) changed.push({ id: q.id, label: q.label, public_state: before, preview_state: q.state });
  });
  return {
    public_production_valid_total: published.production_valid_total,
    preview_production_valid_total: preview.production_valid_total,
    changed_questions: changed
  };
}

/**
 * Public GAS が保持している snapshot の状態（Admin 表示用。readonly）。
 * generated_at / 公開仕様上の production_valid_total / 最終更新理由 / 次回更新の条件と現在の増分 / 手動 preview との差。
 */
function getPublicSnapshotStatus_(now) {
  var published = readPublicSnapshot_();
  if (!published.ok) return { status: published.problem };
  var classification = classifyResponses_();
  var total = classification.valid.length;
  var previous = { generated_at: published.meta.generated_at, production_valid_total: published.meta.exact_total };
  var decision = SurveyAggregate.decideSnapshotUpdate(SURVEY_SCHEMA, previous, total, now);
  var preview = SurveyAggregate.buildSnapshot(SURVEY_SCHEMA, classification.valid, { generatedAt: now });
  var nextDailyAt = new Date(new Date(published.meta.generated_at).getTime() + decision.policy.intervalMs).toISOString();
  return {
    status: 'ok',
    generated_at: published.meta.generated_at,
    updated_at: published.meta.updated_at,
    production_valid_total: published.snapshot.production_valid_total,
    exact_total_at_generation: published.meta.exact_total,
    last_update_reason: published.meta.reason,
    current_production_valid_total: total,
    increment: decision.increment,
    would_update: decision.update,
    decision_reason: decision.reason,
    conditions: {
      minimum_increment: decision.policy.minimumIncrement,
      count_trigger_increment: decision.policy.countTriggerIncrement,
      next_daily_at: nextDailyAt
    },
    diff: diffSnapshots_(preview, published.snapshot)
  };
}
