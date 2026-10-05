/*
 * 男性の衣装・ポートレート意識調査：schema駆動の共通エンジン（正本）。
 *
 * このファイルは tools/build-survey.js により SURVEY_SCHEMA（survey.schema.json）と結合され、
 * Frontend / Public GAS / Admin GAS に同一内容で生成される。生成物を直接編集しないこと。
 * 設問・選択肢・分岐・ファネルをここにベタ書きしない（すべてschemaから読む）。
 * ES5記法で書き、ブラウザ・Apps Script V8・Node.jsのいずれでも動く。
 */
var SurveyCore = (function () {
  'use strict';

  var CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
  var cache = { schema: null, index: null };

  function hasOwn(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }
  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function getOptions(schema, question) {
    if (question.options) return question.options;
    if (question.optionSet) return schema.optionSets[question.optionSet] || [];
    return [];
  }

  function buildIndex(schema) {
    if (cache.schema === schema) return cache.index;
    var byId = {};
    var order = [];
    var sectionOf = {};
    var sectionById = {};
    schema.sections.forEach(function (section) {
      sectionById[section.id] = section;
      section.questions.forEach(function (id) { sectionOf[id] = section.id; });
    });
    schema.questions.forEach(function (question) {
      byId[question.id] = question;
      order.push(question.id);
    });
    cache = { schema: schema, index: { byId: byId, order: order, sectionOf: sectionOf, sectionById: sectionById } };
    return cache.index;
  }

  function getQuestion(schema, id) {
    var byId = buildIndex(schema).byId;
    return typeof id === 'string' && hasOwn(byId, id) ? byId[id] : null;
  }

  function charLength(text) { return Array.from(String(text)).length; }
  function normalizeText(text) { return String(text).replace(/\r\n?/g, '\n').trim(); }

  function encodeMulti(values) {
    return values && values.length ? '|' + values.join('|') + '|' : '';
  }
  function decodeMulti(text) {
    if (typeof text !== 'string' || !text) return [];
    return text.split('|').filter(function (part) { return part !== ''; });
  }

  /* 選択済みIDの配列（single/multi。不正な型は空として扱う） */
  function selectedIds(question, value) {
    if (question.type === 'single') return typeof value === 'string' && value ? [value] : [];
    if (question.type === 'multi') {
      return Array.isArray(value) ? value.filter(function (v) { return typeof v === 'string'; }) : [];
    }
    return [];
  }

  function evalCondition(schema, condition, answers) {
    if (!condition) return true;
    var question = getQuestion(schema, condition.question);
    if (!question) return false;
    var selected = selectedIds(question, answers[condition.question]);
    if (condition.includes !== undefined) return selected.indexOf(condition.includes) !== -1;
    if (condition['in']) {
      return selected.some(function (id) { return condition['in'].indexOf(id) !== -1; });
    }
    return false;
  }

  function isSectionVisible(schema, sectionId, answers) {
    var sections = buildIndex(schema).sectionById;
    var section = typeof sectionId === 'string' && hasOwn(sections, sectionId) ? sections[sectionId] : null;
    return !!section && evalCondition(schema, section.showIf, answers);
  }

  /* 親設問が非表示なら子も非表示（再帰）。sectionのshowIfも考慮する。 */
  function isVisible(schema, questionId, answers, depth) {
    var idx = buildIndex(schema);
    var question = idx.byId[questionId];
    if (!question) return false;
    if ((depth || 0) > 10) return false;
    var sectionId = idx.sectionOf[questionId];
    if (sectionId && !isSectionVisible(schema, sectionId, answers)) return false;
    if (!question.showIf) return true;
    if (!isVisible(schema, question.showIf.question, answers, (depth || 0) + 1)) return false;
    return evalCondition(schema, question.showIf, answers);
  }

  function isEmptyValue(question, value) {
    if (value === undefined || value === null) return true;
    if (question.type === 'single' || question.type === 'text') return value === '';
    if (question.type === 'multi') return Array.isArray(value) && value.length === 0;
    if (question.type === 'matrix') return isPlainObject(value) && Object.keys(value).length === 0;
    return false;
  }

  /*
   * 回答の検証（Frontend / Public GAS 共通）。
   * answers: {questionId: single=string | multi=string[] | matrix={rowId: scaleId} | text=string}
   * otherTexts: {questionId: string}（「その他」選択時のみ）
   * 未知のkey・非表示設問の回答・不正な型/選択肢は無視せずエラーにする。
   * 戻り値 clean は正規化（text trim）済みの回答。
   */
  function validateAnswers(schema, answers, otherTexts) {
    var idx = buildIndex(schema);
    var errors = [];
    var clean = { answers: {}, other_texts: {} };
    function fail(field, code) { errors.push({ field: field, code: code }); }

    if (!isPlainObject(answers)) { fail('answers', 'invalid_type'); return { ok: false, errors: errors, clean: clean }; }
    var others = otherTexts === undefined ? {} : otherTexts;
    if (!isPlainObject(others)) { fail('other_texts', 'invalid_type'); return { ok: false, errors: errors, clean: clean }; }

    Object.keys(answers).forEach(function (key) { if (!hasOwn(idx.byId, key)) fail(key, 'unknown_field'); });
    Object.keys(others).forEach(function (key) {
      var q = hasOwn(idx.byId, key) ? idx.byId[key] : null;
      var hasOther = q && getOptions(schema, q).some(function (o) { return o.other; });
      if (!hasOther) fail(key, 'unknown_field');
    });

    idx.order.forEach(function (id) {
      var question = idx.byId[id];
      var value = hasOwn(answers, id) ? answers[id] : undefined;
      var otherValue = hasOwn(others, id) ? others[id] : undefined;
      var visible = isVisible(schema, id, answers);

      if (!visible) {
        if (!isEmptyValue(question, value) || otherValue !== undefined) fail(id, 'hidden_field');
        return;
      }

      var options = getOptions(schema, question);
      var optionIds = options.map(function (o) { return o.id; });
      var selected = [];

      if (question.type === 'single') {
        if (isEmptyValue(question, value)) {
          if (question.required) fail(id, 'required');
        } else if (typeof value !== 'string') {
          fail(id, 'invalid_type');
        } else if (optionIds.indexOf(value) === -1) {
          fail(id, 'invalid_option');
        } else {
          selected = [value];
          clean.answers[id] = value;
        }
      } else if (question.type === 'multi') {
        if (isEmptyValue(question, value)) {
          if (question.required) fail(id, 'required');
        } else if (!Array.isArray(value)) {
          fail(id, 'invalid_type');
        } else {
          var seen = {};
          var bad = null;
          value.forEach(function (item) {
            if (typeof item !== 'string') bad = bad || 'invalid_type';
            else if (optionIds.indexOf(item) === -1) bad = bad || 'invalid_option';
            else if (seen[item]) bad = bad || 'duplicate_option';
            seen[item] = true;
          });
          if (bad) {
            fail(id, bad);
          } else {
            var exclusive = options.filter(function (o) { return o.exclusive && seen[o.id]; });
            if (exclusive.length && value.length > 1) {
              fail(id, 'exclusive_conflict');
            } else {
              selected = value.slice();
              clean.answers[id] = value.slice();
            }
          }
        }
      } else if (question.type === 'matrix') {
        var rowIds = question.rows.map(function (r) { return r.id; });
        var scaleIds = question.scale.map(function (s) { return s.id; });
        if (isEmptyValue(question, value)) {
          if (question.required) fail(id, 'required');
        } else if (!isPlainObject(value)) {
          fail(id, 'invalid_type');
        } else {
          var matrixClean = {};
          var matrixOk = true;
          Object.keys(value).forEach(function (rowKey) {
            if (rowIds.indexOf(rowKey) === -1) { fail(id + '.' + rowKey, 'unknown_field'); matrixOk = false; }
            else if (typeof value[rowKey] !== 'string' || scaleIds.indexOf(value[rowKey]) === -1) {
              fail(id + '.' + rowKey, 'invalid_option'); matrixOk = false;
            } else matrixClean[rowKey] = value[rowKey];
          });
          rowIds.forEach(function (rowId) {
            if (question.required && !hasOwn(value, rowId)) { fail(id + '.' + rowId, 'required'); matrixOk = false; }
          });
          if (matrixOk) clean.answers[id] = matrixClean;
        }
      } else if (question.type === 'text') {
        if (isEmptyValue(question, value)) {
          if (question.required) fail(id, 'required');
        } else if (typeof value !== 'string') {
          fail(id, 'invalid_type');
        } else if (CONTROL_CHARS.test(value)) {
          fail(id, 'invalid_text');
        } else {
          var text = normalizeText(value);
          if (charLength(text) > question.maxLength) fail(id, 'too_long');
          else if (text) clean.answers[id] = text;
          else if (question.required) fail(id, 'required');
        }
      }

      var otherSelected = selected.some(function (sel) {
        return options.some(function (o) { return o.id === sel && o.other; });
      });
      if (otherSelected) {
        if (typeof otherValue !== 'string') {
          fail(id, 'other_text_required');
        } else if (CONTROL_CHARS.test(otherValue)) {
          fail(id, 'invalid_text');
        } else {
          var otherText = normalizeText(otherValue);
          if (!otherText) fail(id, 'other_text_required');
          else if (charLength(otherText) > schema.limits.otherMaxLength) fail(id, 'too_long');
          else clean.other_texts[id] = otherText;
        }
      } else if (otherValue !== undefined) {
        fail(id, 'other_text_unexpected');
      }
    });

    return { ok: errors.length === 0, errors: errors, clean: clean };
  }

  /* ── Spreadsheet列定義（保存形式） ── */

  /* 設問ごとの保存列。matrixは行ごとに1列（<設問ID>__<行ID>）。 */
  function questionColumns(schema) {
    var cols = [];
    schema.questions.forEach(function (q) {
      if (q.type === 'matrix') {
        q.rows.forEach(function (r) { cols.push({ key: q.id + '__' + r.id, questionId: q.id, rowId: r.id, type: 'single' }); });
      } else {
        cols.push({ key: q.id, questionId: q.id, type: q.type });
      }
    });
    return cols;
  }

  /* 保存済みの行オブジェクト（列名→セル文字列）を内部表現（配列・object）へ戻す。 */
  function decodeRecord(schema, row) {
    var record = {};
    schema.questions.forEach(function (q) {
      var cell = function (key) { return row[key] === undefined || row[key] === null ? '' : String(row[key]); };
      if (q.type === 'single') { var s = cell(q.id); if (s) record[q.id] = s; }
      else if (q.type === 'multi') { var m = decodeMulti(cell(q.id)); if (m.length) record[q.id] = m; }
      else if (q.type === 'text') { var t = cell(q.id); if (t) record[q.id] = t; }
      else if (q.type === 'matrix') {
        var obj = {};
        q.rows.forEach(function (r) { var v = cell(q.id + '__' + r.id); if (v) obj[r.id] = v; });
        if (Object.keys(obj).length) record[q.id] = obj;
      }
    });
    return record;
  }

  /* ── 集計・ファネル（schema定義のみを使用） ── */

  /* 軸（{question, row?}）が取りうる値ID。 */
  function axisValues(schema, axis, record) {
    var q = getQuestion(schema, axis.question);
    if (!q) return [];
    var value = record[axis.question];
    if (q.type === 'matrix') {
      return axis.row && isPlainObject(value) && value[axis.row] ? [value[axis.row]] : [];
    }
    return selectedIds(q, value);
  }

  function axisOptions(schema, axis) {
    var q = getQuestion(schema, axis.question);
    if (!q) return [];
    return q.type === 'matrix' ? q.scale : getOptions(schema, q);
  }

  /* 単純集計。count=その選択肢を選んだ回答者数（延べ選択数ではない）、base=当該設問に回答した人数。 */
  function tally(schema, axis, records) {
    var options = axisOptions(schema, axis);
    var counts = {};
    options.forEach(function (o) { counts[o.id] = 0; });
    var base = 0;
    records.forEach(function (record) {
      var values = axisValues(schema, axis, record);
      if (!values.length) return;
      base++;
      values.forEach(function (v) { if (hasOwn(counts, v)) counts[v]++; });
    });
    return { base: base, counts: counts };
  }

  /*
   * クロス集計。cells[行ID][列ID] = 行・列の両方を選んだ回答者数（人数）。
   * 複数選択同士では1人が複数セルに入るため、行・列の合計は回答者数と一致しない。
   * rowBase[行ID] = その行の値を選んだ回答者数（割合の分母）。
   */
  function crosstab(schema, rowAxis, colAxis, records) {
    var rowOptions = axisOptions(schema, rowAxis);
    var colOptions = axisOptions(schema, colAxis);
    var cells = {};
    var rowBase = {};
    rowOptions.forEach(function (r) {
      rowBase[r.id] = 0;
      cells[r.id] = {};
      colOptions.forEach(function (c) { cells[r.id][c.id] = 0; });
    });
    records.forEach(function (record) {
      var rv = axisValues(schema, rowAxis, record);
      var cv = axisValues(schema, colAxis, record);
      rv.forEach(function (r) {
        if (!hasOwn(rowBase, r)) return;
        rowBase[r]++;
        cv.forEach(function (c) { if (hasOwn(cells[r], c)) cells[r][c]++; });
      });
    });
    return { rowBase: rowBase, cells: cells };
  }

  /* ファネル述語。predicate名（schema.funnels）またはインライン定義。 */
  function evalPredicate(schema, predicate, record) {
    var def = typeof predicate === 'string' ? (hasOwn(schema.funnels, predicate) ? schema.funnels[predicate] : null) : predicate;
    if (!def) return false;
    if (def.all) {
      return def.all.every(function (inner) { return evalPredicate(schema, inner, record); });
    }
    var values = axisValues(schema, { question: def.question, row: def.row }, record);
    if (def.nonEmpty) return values.length > 0;
    var list = def.include || def.anyOf || [];
    return values.some(function (v) { return list.indexOf(v) !== -1; });
  }

  /* 累積ファネル：各段階は前段階をすべて満たした回答者のみ数える。先頭は全回答者。 */
  function funnelFlow(schema, flowId, records) {
    var flow = schema.funnelFlows[flowId];
    var stages = [{ id: 'all', label: '回答者', count: records.length }];
    var current = records;
    flow.stages.forEach(function (name) {
      current = current.filter(function (record) { return evalPredicate(schema, name, record); });
      stages.push({ id: name, label: schema.funnels[name].label, count: current.length });
    });
    return stages;
  }

  return {
    getOptions: getOptions,
    getQuestion: getQuestion,
    charLength: charLength,
    normalizeText: normalizeText,
    encodeMulti: encodeMulti,
    decodeMulti: decodeMulti,
    selectedIds: selectedIds,
    isVisible: isVisible,
    isSectionVisible: isSectionVisible,
    validateAnswers: validateAnswers,
    questionColumns: questionColumns,
    decodeRecord: decodeRecord,
    axisValues: axisValues,
    axisOptions: axisOptions,
    tally: tally,
    crosstab: crosstab,
    evalPredicate: evalPredicate,
    funnelFlow: funnelFlow
  };
})();
