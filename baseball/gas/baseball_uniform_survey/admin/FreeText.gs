/**
 * 自由記述・「その他」本文の閲覧（Admin のみ・read-only）。
 * public snapshot の生成処理（Snapshot.gs / SurveyAggregate.buildSnapshot）とは完全に分離している。
 * 個票の識別子（respondent_hash・timestamp）は返さない。
 */
function listFreeText_() {
  return SurveyAggregate.listFreeText(SURVEY_SCHEMA, classifyResponses_());
}

/**
 * 指定した設問の「その他」自由記述の本文だけ（質問カード展開時の lazy-load 用）。
 * 通常の getAdminSummary には本文を含めない。未知の questionId は invalid_request。
 */
function listOtherTexts_(questionId) {
  var result = SurveyAggregate.listOtherTexts(SURVEY_SCHEMA, classifyResponses_(), questionId);
  if (!result) throw new Error('invalid_request');
  return result;
}
