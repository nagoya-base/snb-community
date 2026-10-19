/**
 * public snapshot の生成（Admin のみ。公開結果ページは Spreadsheet を直接読まない）。
 *
 * - snapshot は privacy-safe な JSON。生成に使うのは valid record の answers だけで、
 *   自由記述・「その他」本文・respondent_hash は参照しない（このファイルは FreeText.gs を呼ばない）。
 * - 公開は batch のみ。1 回答ごとに更新しない。生成した JSON をリポジトリの
 *   baseball/baseball-uniform-survey-results/snapshot.json として commit するまで、公開結果は切り替わらない。
 * - 更新してよいか（1日1回 / 十分な件数増分 / 増分は minCell 以上）は SurveyAggregate.decideSnapshotUpdate が判定する。
 */
function getSnapshotState_() {
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
