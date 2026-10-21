/*
 * 名古屋野球ユニ部アンケート Admin 専用：需要ファネル分析と重要クロス集計（Issue #440）。
 *
 * 設計方針
 *  - ファネルの population / stages / pass / denominator は schema.analysisFunnels を唯一の正本とし、ここへ条件を再定義しない。
 *  - クロス集計の組は schema.adminAnalysis.crossTabs（row / column の設問ID）から読む。集計コードに組を直書きしない。
 *  - 設問の到達（分岐）は core.isVisible で判定する（countQuestionReached と同じ概念）。未到達の回答は分母へ入れない。
 *  - 副作用なし・read-only。Admin 専用で exact を返す（Public の公開閾値・small-cell suppression は適用しない）。
 *  - 返すのは件数・割合・schema 由来の表示ラベルだけ（設問ID・option ID・分析定義IDなどの stable ID は返さない）。respondent_hash / timestamp / test_run_id / source_channel / 行番号 / 自由記述本文は返さない。
 *  - Public GAS / Frontend / maintenance の bundle には含めない（Admin の SurveyGenerated.gs のみ）。
 *
 * ES5記法。Node.js では module.exports でも公開する（tests用）。
 */
var SurveyAnalysis = (function (core, aggregate) {
  'use strict';

  function hasOwn(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }
  function isPlainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function contains(list, item) { return list.indexOf(item) !== -1; }
  function rate(count, base) { return base > 0 ? count / base : null; }

  /* 選択済み option ID（定義済み option のみ）。未回答は空配列。 */
  function pickedIds(question, answers, defIds) {
    return core.selectedIds(question, answers[question.id]).filter(function (id) { return hasOwn(defIds, id); });
  }

  function idSet(defs) {
    var set = {};
    defs.forEach(function (d) { set[d.id] = true; });
    return set;
  }

  function labelsOf(defs, ids) {
    return defs.filter(function (d) { return contains(ids, d.id); }).map(function (d) { return d.label; });
  }

  /* ── 需要ファネル ── */

  /*
   * population を解釈する。
   *  - オブジェクト {設問ID: [optionID,...]}：すべての設問が表示対象で、選択が列挙 option に含まれる回答者。
   *  - 文字列（例 operations_questions_reached）：第1段階の設問に到達した回答者（schema の段階定義から導く）。
   */
  function populationOf(schema, funnel, answersList) {
    var pop = funnel.population;
    var stages = Array.isArray(funnel.stages) ? funnel.stages : [];
    if (isPlainObject(pop)) {
      var keys = Object.keys(pop);
      var members = answersList.filter(function (answers) {
        return keys.every(function (id) {
          var q = core.getQuestion(schema, id);
          if (!q || !core.isVisible(schema, id, answers)) return false;
          return core.selectedIds(q, answers[id]).some(function (v) { return contains(pop[id], v); });
        });
      });
      var definition = keys.map(function (id) {
        var q = core.getQuestion(schema, id);
        return { label: q ? q.label : '', optionLabels: q ? labelsOf(aggregate.cellDefinitions(schema, q), pop[id]) : [] };
      });
      return { members: members, basis: 'answer_in', definition: definition };
    }
    var first = stages.length ? stages[0].question : null;
    var reached = first ? answersList.filter(function (answers) { return core.isVisible(schema, first, answers); }) : [];
    return { members: reached, basis: 'first_stage_reached', definition: first && core.getQuestion(schema, first) ? [{ label: core.getQuestion(schema, first).label, optionLabels: [] }] : [] };
  }

  /* denominator 名の解釈：stage_reached / question_reached / *_population。未知は stage_reached に倒す。 */
  function denominatorMode(name) {
    if (name === 'question_reached') return 'question_reached';
    if (typeof name === 'string' && /_population$/.test(name)) return 'population';
    return 'stage_reached';
  }

  /*
   * 段階の到達者：population のうち、その設問が表示対象で、かつ前の段階の pass を満たした人。
   * pass を持たない段階（role のみ）は内訳段階で、到達者をそのまま次へ引き継ぐ。
   */
  function buildFunnel(schema, id, funnel, answersList, adminAnalysis) {
    var population = populationOf(schema, funnel, answersList);
    var denominator = typeof funnel.denominator === 'string' ? funnel.denominator : 'stage_reached';
    var mode = denominatorMode(denominator);
    var popN = population.members.length;
    var carried = population.members;
    var carriedN = popN;
    var stages = [];
    (Array.isArray(funnel.stages) ? funnel.stages : []).forEach(function (stage) {
      var q = core.getQuestion(schema, stage.question);
      if (!q) return;
      var defs = aggregate.cellDefinitions(schema, q);
      var defIds = idSet(defs);
      var reached = carried.filter(function (answers) { return core.isVisible(schema, q.id, answers); });
      var n = reached.length;
      var base;
      if (mode === 'population') base = popN;
      else if (mode === 'question_reached') base = population.members.filter(function (answers) { return core.isVisible(schema, q.id, answers); }).length;
      else base = n;

      var counts = {};
      defs.forEach(function (d) { counts[d.id] = 0; });
      var answered = 0;
      reached.forEach(function (answers) {
        var ids = pickedIds(q, answers, defIds);
        if (ids.length) answered++;
        ids.forEach(function (v) { counts[v]++; });
      });

      var out = {
        label: q.label,
        type: q.type,
        roleLabel: typeof stage.role === 'string' && adminAnalysis.roleLabels && hasOwn(adminAnalysis.roleLabels, stage.role) ? adminAnalysis.roleLabels[stage.role] : null,
        n: n,
        answeredCount: answered,
        previousN: carriedN,
        rateFromPrevious: rate(n, carriedN),
        denominatorN: base,
        rateOfDenominator: rate(n, base),
        options: defs.map(function (d) { return { label: d.label, count: counts[d.id], rate: rate(counts[d.id], base) }; }),
        pass: null,
        groups: []
      };

      /* experienced / no_experience のような「option ID の配列」を持つ属性は、その group に該当する人数を数える（段階の到達者が分母）。 */
      Object.keys(stage).forEach(function (key) {
        if (key === 'question' || key === 'role' || key === 'pass' || !Array.isArray(stage[key])) return;
        var count = reached.filter(function (answers) {
          return pickedIds(q, answers, defIds).some(function (v) { return contains(stage[key], v); });
        }).length;
        out.groups.push({ optionLabels: labelsOf(defs, stage[key]), count: count, rate: rate(count, n) });
      });

      var next = reached;
      if (Array.isArray(stage.pass)) {
        next = reached.filter(function (answers) {
          return pickedIds(q, answers, defIds).some(function (v) { return contains(stage.pass, v); });
        });
        out.pass = { optionLabels: labelsOf(defs, stage.pass), count: next.length, rate: rate(next.length, n) };
      }
      stages.push(out);
      carried = next;
      carriedN = next.length;
    });

    return {
      label: adminAnalysis.funnelLabels && hasOwn(adminAnalysis.funnelLabels, id) ? adminAnalysis.funnelLabels[id] : id,
      denominator: denominator,
      denominatorLabel: adminAnalysis.denominatorLabels && hasOwn(adminAnalysis.denominatorLabels, denominator) ? adminAnalysis.denominatorLabels[denominator] : null,
      population: { n: popN, basis: population.basis, definition: population.definition },
      stages: stages,
      derivedMetrics: Array.isArray(funnel.derivedMetrics) ? funnel.derivedMetrics.slice() : [],
      note: typeof funnel.note === 'string' ? funnel.note : null
    };
  }

  /* 通常の入れ子ファネルではない定義（method だけを持つもの）は「比較」ブロックとして別に返す。 */
  function buildFunnels(schema, answersList) {
    var defs = isPlainObject(schema.analysisFunnels) ? schema.analysisFunnels : {};
    var adminAnalysis = isPlainObject(schema.adminAnalysis) ? schema.adminAnalysis : {};
    var funnels = [];
    var comparisons = [];
    Object.keys(defs).forEach(function (id) {
      var funnel = defs[id];
      if (!isPlainObject(funnel)) return;
      if (Array.isArray(funnel.stages)) funnels.push(buildFunnel(schema, id, funnel, answersList, adminAnalysis));
      else if (typeof funnel.method === 'string') comparisons.push({ method: funnel.method });
    });
    return { funnels: funnels, comparisons: comparisons };
  }

  /* ── クロス集計 ── */

  /*
   * 並び順：publication.ordinal === true は schema 順。名義尺度（publication.sort / adminTallySort が count_desc）は件数降順（同数は schema 順）。
   * Admin「集計結果」カードと同じ規則（adminTally）。
   */
  function isCountDesc(question) {
    var pub = isPlainObject(question.publication) ? question.publication : {};
    if (pub.ordinal === true) return false;
    return pub.sort === 'count_desc' || question.adminTallySort === 'count_desc';
  }

  function orderedIndexes(defs, counts, countDesc) {
    var idx = defs.map(function (d, i) { return i; });
    if (countDesc) {
      idx.sort(function (a, b) {
        var diff = counts[defs[b].id] - counts[defs[a].id];
        return diff !== 0 ? diff : a - b;
      });
    }
    return idx;
  }

  /*
   * 行 × 列。母集団は「行・列の両設問に到達し、両方に回答した」有効回答だけ（分岐未到達・未回答は入れない）。
   * 割合は行カテゴリの到達者数（その行を選んだ人）が分母。multiple 軸は 1 人が複数セルに入る。
   */
  function buildCrossTab(schema, def, answersList) {
    var rowQ = core.getQuestion(schema, def.row);
    var colQ = core.getQuestion(schema, def.column);
    if (!rowQ || !colQ) return null;
    var rowDefs = aggregate.cellDefinitions(schema, rowQ);
    var colDefs = aggregate.cellDefinitions(schema, colQ);
    var rowIds = idSet(rowDefs);
    var colIds = idSet(colDefs);
    var rowN = {};
    var colN = {};
    var cell = {};
    rowDefs.forEach(function (r) { rowN[r.id] = 0; cell[r.id] = {}; colDefs.forEach(function (c) { cell[r.id][c.id] = 0; }); });
    colDefs.forEach(function (c) { colN[c.id] = 0; });

    var reachedBoth = 0;
    var population = 0;
    answersList.forEach(function (answers) {
      if (!core.isVisible(schema, rowQ.id, answers) || !core.isVisible(schema, colQ.id, answers)) return;
      reachedBoth++;
      var rs = pickedIds(rowQ, answers, rowIds);
      var cs = pickedIds(colQ, answers, colIds);
      if (!rs.length || !cs.length) return;
      population++;
      rs.forEach(function (r) { rowN[r]++; cs.forEach(function (c) { cell[r][c]++; }); });
      cs.forEach(function (c) { colN[c]++; });
    });

    var colOrder = orderedIndexes(colDefs, colN, isCountDesc(colQ));
    var rowOrder = orderedIndexes(rowDefs, rowN, isCountDesc(rowQ));
    return {
      label: def.label,
      purpose: typeof def.purpose === 'string' ? def.purpose : null,
      rowAxis: { label: rowQ.label, multiple: rowQ.type === 'multiple' },
      columnAxis: { label: colQ.label, multiple: colQ.type === 'multiple' },
      /* 両設問に到達した人 / そのうち両方に回答した人（= 母集団） */
      reachedCount: reachedBoth,
      population: population,
      unansweredCount: reachedBoth - population,
      /* 母集団全体の列分布（行で絞らない参考値。分母は母集団） */
      overall: colOrder.map(function (i) { var c = colDefs[i]; return { label: c.label, count: colN[c.id], rate: rate(colN[c.id], population) }; }),
      rowCategories: rowOrder.map(function (i) {
        var r = rowDefs[i];
        return {
          label: r.label,
          n: rowN[r.id],
          cells: colOrder.map(function (j) { var c = colDefs[j]; return { label: c.label, count: cell[r.id][c.id], rate: rate(cell[r.id][c.id], rowN[r.id]) }; })
        };
      })
    };
  }

  function buildCrossTabs(schema, answersList) {
    var adminAnalysis = isPlainObject(schema.adminAnalysis) ? schema.adminAnalysis : {};
    var list = Array.isArray(adminAnalysis.crossTabs) ? adminAnalysis.crossTabs : [];
    var out = [];
    list.forEach(function (def) {
      if (!isPlainObject(def)) return;
      var tab = buildCrossTab(schema, def, answersList);
      if (tab) out.push(tab);
    });
    return out;
  }

  /* Admin 専用の分析結果（getAdminAnalysis）。classification は SurveyAggregate.classifyRows の結果（production の有効回答のみ）。 */
  function buildAdminAnalysis(schema, classification) {
    var answersList = classification.valid.map(function (record) { return record.answers; });
    var funnelResult = buildFunnels(schema, answersList);
    return {
      survey_id: schema.survey_id,
      production_valid_total: answersList.length,
      funnels: funnelResult.funnels,
      comparisons: funnelResult.comparisons,
      crossTabs: buildCrossTabs(schema, answersList)
    };
  }

  return {
    buildAdminAnalysis: buildAdminAnalysis,
    buildFunnels: buildFunnels,
    buildCrossTabs: buildCrossTabs,
    buildCrossTab: buildCrossTab,
    denominatorMode: denominatorMode
  };
})(typeof SurveyCore !== 'undefined' ? SurveyCore : require('./survey-core.js'), typeof SurveyAggregate !== 'undefined' ? SurveyAggregate : require('./survey-aggregate.js'));

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SurveyAnalysis;
}
