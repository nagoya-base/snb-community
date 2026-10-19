/*
 * 名古屋野球ユニ部アンケート（design v2.17）：schema駆動の共通エンジン（専用fork）。
 *
 * community/gas/costume_portrait_survey/src/survey-core.js を出発点に独立させたもの。
 * 衣装・ポトレ調査の運用中coreには一切手を入れない（共通化は本surveyが安定してから別Issueで検討する）。
 *
 * 設計方針
 *  - 副作用なし。schema / answers を書き換えず、時刻・乱数・storage・network に触れない。
 *  - Frontend / Public GAS / Admin が同じ関数を同じ意味で使う（#380 / #381 が再利用する前提）。
 *  - 設問・選択肢・分岐・公開設定をここにベタ書きしない（すべて schema を参照する）。
 *  - 不正・未知の条件は fail-safe（false = 表示しない / 到達していない）に倒す。
 *  - 本ファイルは hash 生成・最短回答時間検証・test token 検証・保存処理を持たない（#380 の責務）。
 *    旧surveyの test 状態値や無区切りの hash 連結式、旧validation定数も持ち込まない。
 *
 * ES5記法。ブラウザ・Apps Script V8・Node.js のいずれでも動く。
 * Node.js では module.exports でも公開する（tests用）。
 */
var SurveyCore = (function () {
  'use strict';

  var CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
  var MAX_CONDITION_DEPTH = 32;
  var SINGLE_VALUE_TYPES = { single: true, single_dynamic: true, scale: true };
  var KNOWN_TYPES = { single: true, multiple: true, single_dynamic: true, scale: true, text: true };
  var LEAF_OPERATORS = ['equals', 'notEquals', 'in', 'contains', 'notContains', 'hasAnyExcept'];
  var GROUP_OPERATORS = ['all', 'any'];

  function hasOwn(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }
  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }
  function isNonEmptyString(value) { return typeof value === 'string' && value !== ''; }
  function contains(list, item) { return list.indexOf(item) !== -1; }
  function charLength(text) { return Array.from(String(text)).length; }
  function normalizeText(text) { return String(text).replace(/\r\n?/g, '\n').trim(); }

  /* ── schema 参照 ── */

  function getQuestions(schema) {
    return isPlainObject(schema) && Array.isArray(schema.questions) ? schema.questions : [];
  }

  function getQuestion(schema, id) {
    if (typeof id !== 'string') return null;
    var list = getQuestions(schema);
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) return list[i];
    }
    return null;
  }

  function questionIds(schema) {
    return getQuestions(schema).map(function (q) { return q.id; });
  }

  /* schema に直接書かれた選択肢（single / multiple）。single_dynamic は getDynamicOptions を使う。 */
  function getOptions(schema, question) {
    return question && Array.isArray(question.options) ? question.options : [];
  }

  function isKnownType(type) { return hasOwn(KNOWN_TYPES, type); }

  /* ── 回答値の正規化 ── */

  /*
   * 選択済みIDの配列。single / single_dynamic / scale は 0 or 1 件、multiple は複数。
   * scale は数値でも文字列でも受け取り、schema のscale ID（"1".."5" / notApplicable.id）の文字列に揃える。
   * 型が合わない値は未回答（空）として扱う。
   */
  function selectedIds(question, value) {
    if (!question) return [];
    if (question.type === 'multiple') {
      return Array.isArray(value)
        ? value.filter(function (v) { return typeof v === 'string' && v !== ''; })
        : [];
    }
    if (question.type === 'scale') {
      if (typeof value === 'number' && isFinite(value)) return [String(value)];
      return isNonEmptyString(value) ? [value] : [];
    }
    if (question.type === 'single' || question.type === 'single_dynamic') {
      return isNonEmptyString(value) ? [value] : [];
    }
    return [];
  }

  function isEmptyValue(question, value) {
    if (value === undefined || value === null) return true;
    if (question.type === 'text') return typeof value === 'string' && normalizeText(value) === '';
    if (question.type === 'multiple') return Array.isArray(value) && value.length === 0;
    if (typeof value === 'string') return value === '';
    return false;
  }

  /* ── 可視性の評価コンテキスト ── */

  /*
   * 可視性は「親が非表示なら、その回答値は無かったものとして扱う」規則で決める。
   * 設問Xの値を条件が参照するとき、Xが非表示なら値は未回答として見える。
   * これにより、親条件がfalseになった後にstateへ旧値が残っていても子の表示判定へ漏れない。
   * 循環参照は fail-safe（false）。
   */
  function createContext(schema, answers) {
    var byId = {};
    var order = [];
    getQuestions(schema).forEach(function (q) {
      if (q && typeof q.id === 'string' && !hasOwn(byId, q.id)) {
        byId[q.id] = q;
        order.push(q.id);
      }
    });
    return {
      schema: schema,
      answers: isPlainObject(answers) ? answers : {},
      byId: byId,
      order: order,
      visibleMemo: {},
      visiting: {}
    };
  }

  function questionOf(ctx, id) {
    return typeof id === 'string' && hasOwn(ctx.byId, id) ? ctx.byId[id] : null;
  }

  function visibleIn(ctx, id) {
    var question = questionOf(ctx, id);
    if (!question) return false;
    if (hasOwn(ctx.visibleMemo, id)) return ctx.visibleMemo[id];
    if (ctx.visiting[id]) return false;
    ctx.visiting[id] = true;
    var result = !question.showIf || evalNode(ctx, question.showIf, [], 0);
    delete ctx.visiting[id];
    ctx.visibleMemo[id] = result;
    return result;
  }

  /* 条件から見える回答値。非表示の設問は未回答扱い。 */
  function effectiveSelected(ctx, id) {
    var question = questionOf(ctx, id);
    if (!question || !visibleIn(ctx, id)) return null;
    return selectedIds(question, ctx.answers[id]);
  }

  function leafOperator(node) {
    var found = LEAF_OPERATORS.filter(function (op) { return hasOwn(node, op); });
    return found.length === 1 ? found[0] : null;
  }

  function evalLeaf(ctx, node) {
    var op = leafOperator(node);
    if (!op) return false;
    var question = questionOf(ctx, node.question);
    if (!question || !isKnownType(question.type) || question.type === 'text') return false;
    var selected = effectiveSelected(ctx, node.question);
    if (!selected || selected.length === 0) return false; // 未回答・非表示は全演算子で false
    var operand = node[op];
    var single = hasOwn(SINGLE_VALUE_TYPES, question.type);

    if (op === 'equals' || op === 'notEquals') {
      if (!single || !isNonEmptyString(operand)) return false;
      return op === 'equals' ? selected[0] === operand : selected[0] !== operand;
    }
    if (op === 'in') {
      if (!single || !Array.isArray(operand)) return false;
      return contains(operand, selected[0]);
    }
    if (single) return false; // contains / notContains / hasAnyExcept は multiple 専用
    if (op === 'contains' || op === 'notContains') {
      if (!isNonEmptyString(operand)) return false;
      return op === 'contains' ? contains(selected, operand) : !contains(selected, operand);
    }
    if (!Array.isArray(operand)) return false; // hasAnyExcept
    return selected.some(function (id) { return !contains(operand, id); });
  }

  function evalNode(ctx, node, refTrail, depth) {
    if (depth > MAX_CONDITION_DEPTH || !isPlainObject(node)) return false;

    if (hasOwn(node, 'conditionRef')) {
      if (Object.keys(node).length !== 1) return false;
      var name = node.conditionRef;
      var table = ctx.schema && ctx.schema.conditions;
      if (typeof name !== 'string' || !isPlainObject(table) || !hasOwn(table, name)) return false;
      if (contains(refTrail, name)) return false;
      return evalNode(ctx, table[name], refTrail.concat([name]), depth + 1);
    }

    var groups = GROUP_OPERATORS.filter(function (op) { return hasOwn(node, op); });
    if (groups.length > 0) {
      if (groups.length !== 1 || Object.keys(node).length !== 1) return false;
      var children = node[groups[0]];
      if (!Array.isArray(children) || children.length === 0) return false;
      var results = children.map(function (child) { return evalNode(ctx, child, refTrail, depth + 1); });
      return groups[0] === 'all'
        ? results.every(function (r) { return r === true; })
        : results.some(function (r) { return r === true; });
    }

    return evalLeaf(ctx, node);
  }

  /* ── 公開API: condition / visibility ── */

  /* condition 1件を評価する。条件なし（null / undefined）は true、不正・未知は false。 */
  function evalCondition(schema, condition, answers) {
    if (condition === undefined || condition === null) return true;
    return evalNode(createContext(schema, answers), condition, [], 0);
  }

  /* 名前付き condition（schema.conditions）を評価する。未定義名は false。 */
  function evalNamedCondition(schema, name, answers) {
    return evalCondition(schema, { conditionRef: name }, answers);
  }

  /* 設問が現在表示対象か。親が非表示のときも false。 */
  function isVisible(schema, questionId, answers) {
    return visibleIn(createContext(schema, answers), questionId);
  }

  /* 表示対象の設問ID一覧（schema順）。 */
  function visibleQuestionIds(schema, answers) {
    var ctx = createContext(schema, answers);
    return ctx.order.filter(function (id) { return visibleIn(ctx, id); });
  }

  function visibleQuestions(schema, answers) {
    var ctx = createContext(schema, answers);
    return ctx.order
      .filter(function (id) { return visibleIn(ctx, id); })
      .map(function (id) { return ctx.byId[id]; });
  }

  /* visible な設問のうち required なものだけ。required 判定の対象はここに限る。 */
  function requiredQuestionIds(schema, answers) {
    return visibleQuestions(schema, answers)
      .filter(function (q) { return q.required === true; })
      .map(function (q) { return q.id; });
  }

  /* ── dynamic option ── */

  /*
   * single_dynamic の候補。sourceQuestion（visible）で選択済みの stable option ID だけを、
   * source の option 順で返し、excludeOptionIds を除く。other 自由記述本文は候補にもIDにもしない。
   * sourceが非表示・未回答・不正なら空。
   */
  function dynamicCandidates(ctx, question) {
    if (!question || question.type !== 'single_dynamic') return [];
    var source = questionOf(ctx, question.sourceQuestion);
    if (!source || source.type !== 'multiple') return [];
    var selected = effectiveSelected(ctx, source.id);
    if (!selected || selected.length === 0) return [];
    var excluded = Array.isArray(question.excludeOptionIds) ? question.excludeOptionIds : [];
    var result = [];
    getOptions(ctx.schema, source).forEach(function (option) {
      if (!contains(selected, option.id) || contains(excluded, option.id)) return;
      var candidate = {};
      Object.keys(option).forEach(function (key) {
        if (key !== 'other' && key !== 'exclusive') candidate[key] = option[key];
      });
      candidate.sourceOptionId = option.id;
      if (option.other) candidate.fromOther = true; // 本文ではなく「その他」というIDで候補化する
      result.push(candidate);
    });
    return result;
  }

  function getDynamicOptions(schema, questionId, answers) {
    var ctx = createContext(schema, answers);
    return dynamicCandidates(ctx, questionOf(ctx, questionId));
  }

  /* 表示時に使う選択肢。single_dynamic は候補、それ以外は schema の options。 */
  function getEffectiveOptions(schema, questionId, answers) {
    var ctx = createContext(schema, answers);
    var question = questionOf(ctx, questionId);
    if (!question) return [];
    return question.type === 'single_dynamic' ? dynamicCandidates(ctx, question) : getOptions(schema, question);
  }

  /* autoSelectIfSingle: 候補が1件のとき自動選択すべき option ID。それ以外は null。 */
  function autoSelectValue(schema, questionId, answers) {
    var ctx = createContext(schema, answers);
    var question = questionOf(ctx, questionId);
    if (!question || question.type !== 'single_dynamic' || question.autoSelectIfSingle !== true) return null;
    if (!visibleIn(ctx, questionId)) return null;
    var candidates = dynamicCandidates(ctx, question);
    return candidates.length === 1 ? candidates[0].id : null;
  }

  /* ── multiple / exclusive / other ── */

  /*
   * multiple の選択変更を適用した新しい配列を返す（入力は変更しない）。
   *  - exclusive:true の option を選ぶと、他の選択を解除してそれだけにする。
   *  - 他の option を選ぶと exclusive を解除する。
   * 結果は schema の option 順に整える。
   */
  function applyMultipleSelection(schema, questionId, current, optionId, checked) {
    var question = getQuestion(schema, questionId);
    if (!question || question.type !== 'multiple') return [];
    var options = getOptions(schema, question);
    var option = null;
    options.forEach(function (o) { if (o.id === optionId) option = o; });
    var base = selectedIds(question, current);
    if (!option) return options.map(function (o) { return o.id; }).filter(function (id) { return contains(base, id); });

    var next;
    if (!checked) {
      next = base.filter(function (id) { return id !== optionId; });
    } else if (option.exclusive) {
      next = [optionId];
    } else {
      var exclusiveIds = options.filter(function (o) { return o.exclusive; }).map(function (o) { return o.id; });
      next = base.filter(function (id) { return !contains(exclusiveIds, id); });
      if (!contains(next, optionId)) next.push(optionId);
    }
    return options.map(function (o) { return o.id; }).filter(function (id) { return contains(next, id); });
  }

  /*
   * その他（other:true）option の本文入力が必要か。
   * 返り値: {required, optionIds, maxLength}。本文を持たないdynamic設問・textは常に required:false。
   */
  function otherTextInfo(schema, questionId, value) {
    var question = getQuestion(schema, questionId);
    var info = { required: false, optionIds: [], maxLength: null };
    if (!question || (question.type !== 'single' && question.type !== 'multiple')) return info;
    var otherIds = getOptions(schema, question)
      .filter(function (o) { return o.other === true; })
      .map(function (o) { return o.id; });
    info.optionIds = otherIds;
    if (typeof question.otherMaxLength === 'number') info.maxLength = question.otherMaxLength;
    info.required = selectedIds(question, value).some(function (id) { return contains(otherIds, id); });
    return info;
  }

  /* ── scale / ordinal ── */

  /*
   * scale 定義。points は min..max の昇順（schema定義の順序）、notApplicable は尺度外の独立値。
   * orderedIds は ordinal 順に使うID（notApplicable を含まない）、allIds は入力として有効な全ID。
   */
  function describeScale(question) {
    if (!question || question.type !== 'scale' || !isFinite(question.min) || !isFinite(question.max) || question.min > question.max) {
      return null;
    }
    var anchors = isPlainObject(question.anchors) ? question.anchors : {};
    var points = [];
    for (var n = question.min; n <= question.max; n++) {
      points.push({ id: String(n), value: n, label: hasOwn(anchors, String(n)) ? anchors[String(n)] : String(n) });
    }
    var na = isPlainObject(question.notApplicable) && isNonEmptyString(question.notApplicable.id)
      ? { id: question.notApplicable.id, label: question.notApplicable.label }
      : null;
    var orderedIds = points.map(function (p) { return p.id; });
    return {
      points: points,
      notApplicable: na,
      orderedIds: orderedIds,
      allIds: na ? orderedIds.concat([na.id]) : orderedIds.slice()
    };
  }

  function getScale(schema, questionId) {
    return describeScale(getQuestion(schema, questionId));
  }

  /*
   * 公開結果で順序を壊さないための並び。
   *   orderedIds    : ordinal 軸（scale は min..max、ordinal:true の選択式は option 定義順）
   *   independentIds: 尺度外の独立値（notApplicable）。orderedIds に混ぜない。
   * ordinal でない設問は null（並びは publication.sort に従う）。
   */
  function ordinalOrder(schema, questionId) {
    var question = getQuestion(schema, questionId);
    if (!question) return null;
    if (question.type === 'scale') {
      var scale = describeScale(question);
      return scale ? { orderedIds: scale.orderedIds.slice(), independentIds: scale.notApplicable ? [scale.notApplicable.id] : [] } : null;
    }
    if (isPlainObject(question.publication) && question.publication.ordinal === true) {
      return { orderedIds: getOptions(schema, question).map(function (o) { return o.id; }), independentIds: [] };
    }
    return null;
  }

  /* ── publication ── */

  /*
   * question.publication が公開設定の唯一の正本。別の公開設定一覧は作らない。
   * 返り値は schema の object の浅いコピー（schema を汚さない）。無ければ null。
   */
  function getPublication(schema, questionId) {
    var question = getQuestion(schema, questionId);
    if (!question || !isPlainObject(question.publication)) return null;
    var copy = {};
    Object.keys(question.publication).forEach(function (key) { copy[key] = question.publication[key]; });
    return copy;
  }

  function isPublic(schema, questionId) {
    var publication = getPublication(schema, questionId);
    return !!publication && publication.visibility === 'public';
  }

  /* publication.visibility === 'public' の設問ID（schema順）。 */
  function publicQuestionIds(schema) {
    return questionIds(schema).filter(function (id) { return isPublic(schema, id); });
  }

  /*
   * 分母。schema の denominator: question_reached を正とする。
   * Public payload の targetCount は「その設問に実際に到達した有効回答者数」＝ question_reached であり、別概念ではない。
   * 返り値は schema の値のまま（未指定は null）。
   */
  function denominatorOf(schema, questionId) {
    var publication = getPublication(schema, questionId);
    return publication && isNonEmptyString(publication.denominator) ? publication.denominator : null;
  }

  /*
   * 設問に到達した回答者数（= targetCount）。
   * records: 有効回答の answers の配列。その answers の下で設問が visible のものを数える。
   * 回答の有無ではなく到達（表示対象になったこと）で数える。
   */
  function countQuestionReached(schema, questionId, records) {
    if (!Array.isArray(records)) return 0;
    var count = 0;
    records.forEach(function (answers) { if (isVisible(schema, questionId, answers)) count++; });
    return count;
  }

  /* ── hidden / stale value ── */

  /*
   * 有効回答として扱えない値の検出。
   *   hidden            : 設問が非表示なのに値が残っている
   *   option_unavailable: single_dynamic の値が現在の候補にない（sourceの選択変更で消えた）
   *   other_text_stale  : 「その他」が選ばれていないのに本文が残っている／設問が非表示
   * 返り値: [{questionId, reason, field}]  field は 'answers' | 'other_texts'
   */
  function findStaleValues(schema, answers, otherTexts) {
    var ctx = createContext(schema, answers);
    var others = isPlainObject(otherTexts) ? otherTexts : {};
    var stale = [];
    ctx.order.forEach(function (id) {
      var question = ctx.byId[id];
      var hasAnswer = hasOwn(ctx.answers, id) && !isEmptyValue(question, ctx.answers[id]);
      var hasOther = hasOwn(others, id) && others[id] !== undefined;
      if (!visibleIn(ctx, id)) {
        if (hasAnswer) stale.push({ questionId: id, reason: 'hidden', field: 'answers' });
        if (hasOther) stale.push({ questionId: id, reason: 'hidden', field: 'other_texts' });
        return;
      }
      if (hasAnswer && question.type === 'single_dynamic') {
        var ids = dynamicCandidates(ctx, question).map(function (c) { return c.id; });
        if (!contains(ids, ctx.answers[id])) stale.push({ questionId: id, reason: 'option_unavailable', field: 'answers' });
      }
      if (hasOther && !otherTextInfo(schema, id, ctx.answers[id]).required) {
        stale.push({ questionId: id, reason: 'other_text_stale', field: 'other_texts' });
      }
    });
    return stale;
  }

  /*
   * stale な値を取り除いた answers / other_texts の新しい object を返す（入力は変更しない）。
   * dynamic の旧値が消える場合は、その下流の可視性も変わるため、変化がなくなるまで繰り返す。
   * 未知のkeyも残さない。removed に除去した項目を返す。
   */
  function sanitizeAnswers(schema, answers, otherTexts) {
    var cleanAnswers = {};
    var cleanOthers = {};
    var src = isPlainObject(answers) ? answers : {};
    var srcOthers = isPlainObject(otherTexts) ? otherTexts : {};
    var known = {};
    questionIds(schema).forEach(function (id) { known[id] = true; });
    Object.keys(src).forEach(function (key) { if (hasOwn(known, key)) cleanAnswers[key] = src[key]; });
    Object.keys(srcOthers).forEach(function (key) { if (hasOwn(known, key)) cleanOthers[key] = srcOthers[key]; });

    var removed = [];
    for (var round = 0; round < 64; round++) {
      var stale = findStaleValues(schema, cleanAnswers, cleanOthers);
      if (stale.length === 0) break;
      stale.forEach(function (item) {
        var target = item.field === 'answers' ? cleanAnswers : cleanOthers;
        if (hasOwn(target, item.questionId)) {
          delete target[item.questionId];
          removed.push(item);
        }
      });
    }
    return { answers: cleanAnswers, other_texts: cleanOthers, removed: removed };
  }

  /* ── 回答の検証（Frontend / Public GAS 共通） ── */

  /*
   * answers: {questionId: single/single_dynamic=string | multiple=string[] | scale=整数 or notApplicable.id | text=string}
   * otherTexts: {questionId: string}（「その他」選択時のみ）
   * 未知のkey・非表示設問の回答・不正な型/選択肢は無視せずエラーにする。
   * required は表示対象の設問だけが対象。clean は正規化済み（scale は文字列ID、text は trim）。
   * エラー code: invalid_type / unknown_field / hidden_field / required / invalid_option /
   *              duplicate_option / exclusive_conflict / invalid_text / too_long /
   *              other_text_required / other_text_unexpected / unknown_question_type
   */
  function validateAnswers(schema, answers, otherTexts) {
    var errors = [];
    var clean = { answers: {}, other_texts: {} };
    function fail(field, code) { errors.push({ field: field, code: code }); }

    if (!isPlainObject(answers)) { fail('answers', 'invalid_type'); return { ok: false, errors: errors, clean: clean }; }
    var others = otherTexts === undefined ? {} : otherTexts;
    if (!isPlainObject(others)) { fail('other_texts', 'invalid_type'); return { ok: false, errors: errors, clean: clean }; }

    var ctx = createContext(schema, answers);
    Object.keys(answers).forEach(function (key) { if (!hasOwn(ctx.byId, key)) fail(key, 'unknown_field'); });
    Object.keys(others).forEach(function (key) {
      var q = questionOf(ctx, key);
      var hasOtherOption = q && getOptions(schema, q).some(function (o) { return o.other === true; });
      if (!hasOtherOption) fail(key, 'unknown_field');
    });

    ctx.order.forEach(function (id) {
      var question = ctx.byId[id];
      var value = hasOwn(answers, id) ? answers[id] : undefined;
      var otherValue = hasOwn(others, id) ? others[id] : undefined;

      if (!visibleIn(ctx, id)) {
        if (!isEmptyValue(question, value) || otherValue !== undefined) fail(id, 'hidden_field');
        return;
      }
      if (!isKnownType(question.type)) { fail(id, 'unknown_question_type'); return; }

      var selected = [];
      var empty = isEmptyValue(question, value);

      if (question.type === 'text') {
        if (empty) {
          if (question.required) fail(id, 'required');
        } else if (typeof value !== 'string') {
          fail(id, 'invalid_type');
        } else if (CONTROL_CHARS.test(value)) {
          fail(id, 'invalid_text');
        } else {
          var text = normalizeText(value);
          if (typeof question.maxLength === 'number' && charLength(text) > question.maxLength) fail(id, 'too_long');
          else clean.answers[id] = text;
        }
      } else if (question.type === 'multiple') {
        if (empty) {
          if (question.required) fail(id, 'required');
        } else if (!Array.isArray(value)) {
          fail(id, 'invalid_type');
        } else {
          var options = getOptions(schema, question);
          var seen = {};
          var bad = null;
          value.forEach(function (item) {
            if (typeof item !== 'string') bad = bad || 'invalid_type';
            else if (!options.some(function (o) { return o.id === item; })) bad = bad || 'invalid_option';
            else if (seen[item]) bad = bad || 'duplicate_option';
            seen[item] = true;
          });
          var hasExclusive = options.some(function (o) { return o.exclusive && seen[o.id]; });
          if (bad) fail(id, bad);
          else if (hasExclusive && value.length > 1) fail(id, 'exclusive_conflict');
          else { selected = value.slice(); clean.answers[id] = value.slice(); }
        }
      } else {
        // single / single_dynamic / scale
        var allowed;
        if (question.type === 'single') allowed = getOptions(schema, question).map(function (o) { return o.id; });
        else if (question.type === 'single_dynamic') allowed = dynamicCandidates(ctx, question).map(function (c) { return c.id; });
        else {
          var scale = describeScale(question);
          allowed = scale ? scale.allIds : [];
        }
        if (empty) {
          if (question.required) fail(id, 'required');
        } else if (typeof value !== 'string' && !(question.type === 'scale' && typeof value === 'number')) {
          fail(id, 'invalid_type');
        } else {
          var normalized = selectedIds(question, value)[0];
          if (!contains(allowed, normalized)) fail(id, 'invalid_option');
          else { selected = [normalized]; clean.answers[id] = normalized; }
        }
      }

      var info = otherTextInfo(schema, id, question.type === 'multiple' ? selected : selected[0]);
      if (info.required) {
        if (typeof otherValue !== 'string') {
          fail(id, 'other_text_required');
        } else if (CONTROL_CHARS.test(otherValue)) {
          fail(id, 'invalid_text');
        } else {
          var otherText = normalizeText(otherValue);
          if (!otherText) fail(id, 'other_text_required');
          else if (info.maxLength !== null && charLength(otherText) > info.maxLength) fail(id, 'too_long');
          else clean.other_texts[id] = otherText;
        }
      } else if (otherValue !== undefined) {
        fail(id, 'other_text_unexpected');
      }
    });

    return { ok: errors.length === 0, errors: errors, clean: clean };
  }

  /* ── termination ── */

  /*
   * 設問の termination（例: age_confirmed = no → ineligible）に該当するか。
   * 該当する最初の設問を返す。visible な設問のみ対象。無ければ null。
   */
  function findTermination(schema, answers) {
    var ctx = createContext(schema, answers);
    for (var i = 0; i < ctx.order.length; i++) {
      var q = ctx.byId[ctx.order[i]];
      if (!isPlainObject(q.termination) || !visibleIn(ctx, q.id)) continue;
      if (selectedIds(q, ctx.answers[q.id]).indexOf(q.termination.when) !== -1) {
        return { questionId: q.id, status: q.termination.status };
      }
    }
    return null;
  }

  /* ── test mode（response_mode + test_run_id が正本） ── */

  /*
   * schema.testModes から mode の扱いを引く。未知の mode は null（fail-closed）。
   *   clientOnly     : serverへ送信しない（preview_no_submit / closed_view）。test token は不要。
   *   serverVerified : serverがtest tokenを検証してmodeを確定する（submit_excluded）。
   *   responseMode   : 保存時の response_mode。production = 'production'、submit_excluded = 'test'、client-only = null。
   *   countInValidResponses: 本番の有効回答数へ含めるか。
   * token の検証・保存はここでは行わない（#380）。
   */
  function getTestMode(schema, modeId) {
    var testModes = isPlainObject(schema) ? schema.testModes : null;
    if (!isPlainObject(testModes) || !isPlainObject(testModes.modes) || typeof modeId !== 'string' || !hasOwn(testModes.modes, modeId)) {
      return null;
    }
    var def = testModes.modes[modeId];
    var activation = isPlainObject(testModes.activation) ? testModes.activation : {};
    var clientOnly = Array.isArray(activation.clientOnlyModes) && contains(activation.clientOnlyModes, modeId);
    var serverVerified = Array.isArray(activation.serverVerifiedModes) && contains(activation.serverVerifiedModes, modeId);
    var responseMode = null;
    if (!clientOnly) {
      if (isPlainObject(def.responseMarker) && def.responseMarker.field === 'response_mode') responseMode = def.responseMarker.value;
      else if (def.submitBehavior === 'save' && modeId === 'production') responseMode = 'production';
    }
    return {
      id: modeId,
      clientOnly: clientOnly,
      serverVerified: serverVerified,
      responseMode: typeof responseMode === 'string' ? responseMode : null,
      countInValidResponses: def.countInValidResponses === true
    };
  }

  /* 本番集計へ含めてよい response_mode か。欠損・未知値は含めない（fail-closed）。 */
  function isProductionResponseMode(responseMode) { return responseMode === 'production'; }

  return {
    getQuestions: getQuestions,
    getQuestion: getQuestion,
    questionIds: questionIds,
    getOptions: getOptions,
    charLength: charLength,
    normalizeText: normalizeText,
    selectedIds: selectedIds,
    evalCondition: evalCondition,
    evalNamedCondition: evalNamedCondition,
    isVisible: isVisible,
    visibleQuestionIds: visibleQuestionIds,
    visibleQuestions: visibleQuestions,
    requiredQuestionIds: requiredQuestionIds,
    getDynamicOptions: getDynamicOptions,
    getEffectiveOptions: getEffectiveOptions,
    autoSelectValue: autoSelectValue,
    applyMultipleSelection: applyMultipleSelection,
    otherTextInfo: otherTextInfo,
    getScale: getScale,
    ordinalOrder: ordinalOrder,
    getPublication: getPublication,
    isPublic: isPublic,
    publicQuestionIds: publicQuestionIds,
    denominatorOf: denominatorOf,
    countQuestionReached: countQuestionReached,
    findStaleValues: findStaleValues,
    sanitizeAnswers: sanitizeAnswers,
    validateAnswers: validateAnswers,
    findTermination: findTermination,
    getTestMode: getTestMode,
    isProductionResponseMode: isProductionResponseMode
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SurveyCore;
}
