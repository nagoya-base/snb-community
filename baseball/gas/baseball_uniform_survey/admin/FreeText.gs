/**
 * 自由記述・「その他」本文の閲覧（Admin のみ・read-only）。
 * public snapshot の生成処理（Snapshot.gs / SurveyAggregate.buildSnapshot）とは完全に分離している。
 * 個票の識別子（respondent_hash・timestamp）は返さない。
 */
function listFreeText_() {
  return SurveyAggregate.listFreeText(SURVEY_SCHEMA, classifyResponses_());
}
