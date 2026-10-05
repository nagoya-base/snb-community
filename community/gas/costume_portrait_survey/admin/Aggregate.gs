/**
 * 管理者向け集計。設問・選択肢・ファネル・クロス集計プリセットはすべて SURVEY_SCHEMA から読む。
 *
 * 集計の意味（重要）:
 *  - count は「延べ選択数」ではなく「その選択肢を選んだ回答者数」。base は当該設問に回答した人数。
 *  - 複数選択×複数選択のクロス集計は、行・列の両方を選んだ回答者数。1人が複数セルに入るため、
 *    行・列の合計は回答者数と一致しない。割合の分母は行の値を選んだ回答者数（rowBase）。
 *  - 有効回答 = timestampが読めて、締切（SURVEY_CLOSES_AT設定時）以前の回答。
 */
function axisKey_(axis) { return axis.row ? axis.question + ':' + axis.row : axis.question; }

function parseAxisKey_(key) {
  var parts = String(key).split(':');
  var q = SurveyCore.getQuestion(SURVEY_SCHEMA, parts[0]);
  if (!q) throw new Error('unknown_axis');
  if (q.type === 'text') throw new Error('unknown_axis');
  if (q.type === 'matrix') {
    if (!parts[1] || !q.rows.some(function (r) { return r.id === parts[1]; })) throw new Error('unknown_axis');
    return { question: parts[0], row: parts[1] };
  }
  if (parts.length !== 1) throw new Error('unknown_axis');
  return { question: parts[0] };
}

function axisLabel_(axis) {
  var q = SurveyCore.getQuestion(SURVEY_SCHEMA, axis.question);
  if (q.type !== 'matrix') return q.no + ' ' + q.label;
  var row = q.rows.filter(function (r) { return r.id === axis.row; })[0];
  return q.no + ' ' + row.label;
}

function listAxes_() {
  var axes = [];
  SURVEY_SCHEMA.questions.forEach(function (q) {
    if (q.type === 'text') return;
    if (q.type === 'matrix') q.rows.forEach(function (r) { axes.push({ question: q.id, row: r.id }); });
    else axes.push({ question: q.id });
  });
  return axes.map(function (axis) { return { key: axisKey_(axis), label: axisLabel_(axis) }; });
}

function tallyToView_(axis, records) {
  var result = SurveyCore.tally(SURVEY_SCHEMA, axis, records);
  return {
    base: result.base,
    options: SurveyCore.axisOptions(SURVEY_SCHEMA, axis).map(function (o) {
      var count = result.counts[o.id] || 0;
      return { id: o.id, label: o.label, count: count, pct: result.base ? Math.round(count / result.base * 1000) / 10 : 0 };
    })
  };
}

function buildCrosstab_(rowKey, colKey, records) {
  var rowAxis = parseAxisKey_(rowKey);
  var colAxis = parseAxisKey_(colKey);
  var result = SurveyCore.crosstab(SURVEY_SCHEMA, rowAxis, colAxis, records);
  var rowOptions = SurveyCore.axisOptions(SURVEY_SCHEMA, rowAxis);
  var colOptions = SurveyCore.axisOptions(SURVEY_SCHEMA, colAxis);
  return {
    rowKey: rowKey, colKey: colKey,
    rowLabel: axisLabel_(rowAxis), colLabel: axisLabel_(colAxis),
    note: '数値は回答者数。複数選択同士では1人が複数のセルに入るため、合計は回答者数と一致しません。割合の分母は行の値を選んだ回答者数です。',
    cols: colOptions.map(function (c) { return { id: c.id, label: c.label }; }),
    rows: rowOptions.map(function (r) {
      return {
        id: r.id, label: r.label, base: result.rowBase[r.id],
        cells: colOptions.map(function (c) { return result.cells[r.id][c.id]; })
      };
    })
  };
}

function formatJst_(time) {
  return Utilities.formatDate(new Date(time), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
}

function buildFreeText_(rows) {
  var sorted = rows.slice().sort(function (a, b) { return (b.time || 0) - (a.time || 0); });
  function stamp(row) { return row.time === null ? '' : formatJst_(row.time); }
  var others = [];
  SURVEY_SCHEMA.questions.forEach(function (q) {
    var items = [];
    sorted.forEach(function (row) {
      var text = row.otherTexts[q.id];
      if (typeof text === 'string' && text) items.push({ at: stamp(row), text: unsanitizeCell_(text) });
    });
    if (items.length) others.push({ id: q.id, label: q.no + ' ' + q.label, items: items });
  });
  function textList(id) {
    var q = SurveyCore.getQuestion(SURVEY_SCHEMA, id);
    var items = [];
    sorted.forEach(function (row) {
      if (typeof row.record[id] === 'string' && row.record[id]) items.push({ at: stamp(row), text: row.record[id] });
    });
    return { id: id, label: q.no + ' ' + q.label, items: items };
  }
  return { others: others, texts: textColumns_().map(textList) };
}

function buildDashboard_(rows, meta) {
  var valid = rows.filter(function (r) { return r.kind === 'valid'; });
  var records = valid.map(function (r) { return r.record; });
  var byDay = {};
  valid.forEach(function (r) {
    var day = Utilities.formatDate(new Date(r.time), 'Asia/Tokyo', 'yyyy-MM-dd');
    byDay[day] = (byDay[day] || 0) + 1;
  });
  var sections = SURVEY_SCHEMA.sections.map(function (section) {
    return {
      id: section.id, title: section.title,
      questions: section.questions.filter(function (id) {
        return SurveyCore.getQuestion(SURVEY_SCHEMA, id).type !== 'text';
      }).map(function (id) {
        var q = SurveyCore.getQuestion(SURVEY_SCHEMA, id);
        if (q.type === 'matrix') {
          return {
            id: q.id, no: q.no, label: q.label, type: q.type,
            matrix: q.rows.map(function (r) { return { id: r.id, label: r.label, view: tallyToView_({ question: q.id, row: r.id }, records) }; })
          };
        }
        return { id: q.id, no: q.no, label: q.label, type: q.type, view: tallyToView_({ question: q.id }, records) };
      })
    };
  });
  var presets = SURVEY_SCHEMA.crosstabs.map(function (c) {
    var result = buildCrosstab_(axisKey_(c.row), axisKey_(c.col), records);
    result.id = c.id;
    result.label = c.label;
    return result;
  });
  return {
    schemaVersion: SURVEY_SCHEMA.schema_version,
    summary: {
      totalRows: rows.length,
      validRows: valid.length,
      lateRows: rows.filter(function (r) { return r.kind === 'late'; }).length,
      unparseableRows: rows.filter(function (r) { return r.kind === 'unparseable'; }).length,
      duplicateRejects: Number(meta.duplicate_rejects) || 0,
      finalize: {
        status: meta.finalize_status === 'final' ? 'final' : 'not_finalized',
        finalizedAt: meta.finalized_at || '',
        publicTotal: meta.finalize_publicTotal === undefined ? null : Number(meta.finalize_publicTotal)
      }
    },
    byDay: Object.keys(byDay).sort().map(function (d) { return { date: d, count: byDay[d] }; }),
    sections: sections,
    funnels: Object.keys(SURVEY_SCHEMA.funnelFlows).map(function (id) {
      return { id: id, label: SURVEY_SCHEMA.funnelFlows[id].label, stages: SurveyCore.funnelFlow(SURVEY_SCHEMA, id, records) };
    }),
    crosstabPresets: presets,
    axes: listAxes_(),
    freeText: buildFreeText_(valid)
  };
}
