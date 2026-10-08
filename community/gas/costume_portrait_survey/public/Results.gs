/**
 * 公開結果の組み立て（allowlist方式）。
 *
 * 「内部データから危険項目を削る」denylistではなく、schema.publicResults.items に列挙され、かつ
 * 設問が visibility:"public" の項目だけを一から組み立てる。UUID・hash・timestamp・個票・自由記述・
 * 価格受容・実利用意向・性的指向・residence_country は、構造上この関数の出力に含まれ得ない。
 * 居住地（residence）・愛知県内エリア（aichi_area）は設問が private のため、BASIC_PUBLIC_QUESTIONS に
 * コードで固定した設問IDで、かつ schema の tier:"basic" 項目に限り公開する（denylistへは変更しない）。
 *
 *  - 公開は2層。基本属性（schema の tier:"basic"。年代・居住地・愛知県内エリア）は有効回答数に関わらず
 *    公開し、本集計（tier:"main"）は有効回答数 >= minTotal(30) になってから追加する（threshold_reached）。
 *    30件未満でも総回答数は公開してよいが、本集計は構造上 items に入らない。
 *  - カテゴリ別countが minCell(3) 未満の値は公開しない（0も含む）。単一選択で1カテゴリだけ
 *    伏せた場合は、合計からの逆算を防ぐため次に小さい公開値も伏せる（二次秘匿）。
 *  - 年代は粗い区分（schema.publicResults.ageGroups）へ再集約する。
 */
var PUBLIC_PAYLOAD_KEYS = ['status', 'schema_version', 'survey_version', 'phase', 'total', 'min_total', 'threshold_reached', 'items'];
var PUBLIC_ITEM_KEYS = ['id', 'title', 'type', 'base', 'suppressed', 'categories'];
var PUBLIC_CATEGORY_KEYS = ['id', 'label', 'count', 'pct'];

// 設問が private でも、基本属性として公開してよい設問ID（コード側の固定allowlist。schemaだけでは広げられない）。
var BASIC_PUBLIC_QUESTIONS = ['age_range', 'residence', 'aichi_area'];

/** 公開してよい項目か。設問が public、または tier:"basic" かつ BASIC_PUBLIC_QUESTIONS に固定された設問。 */
function isPublicItemAllowed_(item, question) {
  if (!item || !question) return false;
  if (question.visibility === 'public') return true;
  return item.tier === 'basic' && BASIC_PUBLIC_QUESTIONS.indexOf(question.id) !== -1;
}

function publicItemConfig_(itemId) {
  var items = SURVEY_SCHEMA.publicResults.items;
  for (var i = 0; i < items.length; i++) if (items[i].id === itemId) return items[i];
  return null;
}

function buildPublicCategories_(item, question, tallyResult) {
  var categories;
  if (item.groupBy === 'ageGroups') {
    categories = SURVEY_SCHEMA.publicResults.ageGroups.map(function (group) {
      var count = 0;
      group.members.forEach(function (id) { count += tallyResult.counts[id] || 0; });
      return { id: group.id, label: group.label, count: count };
    });
  } else {
    categories = SurveyCore.getOptions(SURVEY_SCHEMA, question).map(function (option) {
      return { id: option.id, label: option.label, count: tallyResult.counts[option.id] || 0 };
    });
  }
  return categories;
}

function applySuppression_(categories, base, isSingle) {
  var minCell = SURVEY_SCHEMA.publicResults.minCell;
  categories.forEach(function (c) { c.suppressed = c.count < minCell; });
  if (isSingle) {
    var hidden = categories.filter(function (c) { return c.suppressed && c.count > 0; });
    var visible = categories.filter(function (c) { return !c.suppressed; });
    // 非ゼロの伏せ値が1つだけなら、合計−他の公開値で逆算できるため次に小さい公開値も伏せる。
    if (hidden.length === 1 && visible.length) {
      visible.sort(function (a, b) { return a.count - b.count; });
      visible[0].suppressed = true;
    }
  }
  return categories.map(function (c) {
    return {
      id: c.id,
      label: c.label,
      count: c.suppressed ? null : c.count,
      pct: c.suppressed || !base ? null : Math.round(c.count / base * 1000) / 10
    };
  });
}

/** @param {Array<Object>} records 有効回答の内部表現（SurveyCore.decodeRecord の結果） */
/** @param {string=} status 集計の種別。確定は 'final'（既定）、途中集計は 'partial'。30件未満は基本属性のみ（threshold_reached:false）。 */
function buildPublicPayload_(records, status) {
  var cfg = SURVEY_SCHEMA.publicResults;
  var thresholdReached = records.length >= cfg.minTotal;
  var items = [];
  cfg.items.forEach(function (item) {
    var question = SurveyCore.getQuestion(SURVEY_SCHEMA, item.question);
    if (!isPublicItemAllowed_(item, question)) return;
    if (!thresholdReached && item.tier !== 'basic') return;
    var tallyResult = SurveyCore.tally(SURVEY_SCHEMA, { question: item.question }, records);
    if (tallyResult.base < cfg.minCell) {
      items.push({ id: item.id, title: item.title, type: question.type, base: null, suppressed: true, categories: [] });
      return;
    }
    var categories = buildPublicCategories_(item, question, tallyResult);
    items.push({
      id: item.id,
      title: item.title,
      type: question.type,
      base: tallyResult.base,
      suppressed: false,
      categories: applySuppression_(categories, tallyResult.base, question.type === 'single')
    });
  });
  return {
    status: status || 'final',
    schema_version: SURVEY_SCHEMA.schema_version,
    survey_version: SURVEY_SCHEMA.survey_version,
    total: records.length,
    min_total: cfg.minTotal,
    threshold_reached: thresholdReached,
    items: items
  };
}

function assertKeys_(obj, allowed, where) {
  Object.keys(obj).forEach(function (key) {
    if (allowed.indexOf(key) === -1) throw new Error('public_payload_not_allowed:' + where + '.' + key);
  });
}

/** 公開前の最終検査（防御の二重化）。allowlist外のkey・項目が1つでもあれば公開しない。 */
function assertPublicPayload_(payload) {
  assertKeys_(payload, PUBLIC_PAYLOAD_KEYS.concat(['status']), 'payload');
  (payload.items || []).forEach(function (item) {
    assertKeys_(item, PUBLIC_ITEM_KEYS, 'item');
    var config = publicItemConfig_(item.id);
    var question = config && SurveyCore.getQuestion(SURVEY_SCHEMA, config.question);
    if (!isPublicItemAllowed_(config, question)) throw new Error('public_payload_not_allowed:item.' + item.id);
    // 30件未満（threshold_reached:false）では基本属性以外の項目を絶対に公開しない。
    if (payload.threshold_reached === false && config.tier !== 'basic') throw new Error('public_payload_not_allowed:item.' + item.id);
    item.categories.forEach(function (category) { assertKeys_(category, PUBLIC_CATEGORY_KEYS, 'category'); });
  });
  return payload;
}
