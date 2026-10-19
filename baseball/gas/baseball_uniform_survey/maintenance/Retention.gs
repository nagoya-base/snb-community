/**
 * retention policy（Issue #383）。設定の正本は retention.config.json（SurveyGenerated.gs の RETENTION_CONFIG）。
 * このリポジトリは具体的な保持期限を決めない。Owner（nagoya-base）が opens_at / closes_at 確定時に設定する。
 * 未設定・placeholder・不備は fail closed（launch 不可 / cleanup 不可）。
 * 親 #377 の Owner checkbox は運用で更新する（この処理は GitHub Issue を変更しない）。
 */
function closesAtMs_() {
  return SurveyMaintenance.parseJstDateTime(SURVEY_RECEPTION && SURVEY_RECEPTION.closes_at);
}

function retentionPolicy_(now) {
  return SurveyMaintenance.evaluateRetentionPolicy(RETENTION_CONFIG, SURVEY_SCHEMA, closesAtMs_(), now);
}

function getRetentionStatus_() {
  var policy = retentionPolicy_(currentTime_());
  return {
    owner: policy.owner,
    status: policy.status,
    confirmed: policy.confirmed,
    problems: policy.problems,
    policy_version: policy.policy_version,
    deadline: policy.deadline,
    deadline_reached: policy.deadline_reached,
    keep_final_snapshot: policy.keep_final_snapshot,
    schema_retention_status: policy.schema_retention_status,
    launch_ready: policy.launch_ready,
    inventory: SurveyMaintenance.STORAGE_INVENTORY.map(function (s) {
      return { id: s.id, label: s.label, kind: s.kind, mode: s.mode, automation: s.automation };
    })
  };
}
