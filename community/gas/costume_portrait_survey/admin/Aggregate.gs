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

/**
 * ===== 需要ファネル（Issue #361。OWNER専用・内部マーケティング分析） =====
 * 既存の設問・stable ID だけを使い、設問・選択肢・schema_version・Spreadsheet列は一切増やさない。
 * 定義は Admin 側のこのブロックに集約（survey.schema.json は変更しない＝Frontend/Public の生成物にも影響しない）。
 * 参照する設問・選択肢が schema に実在することは tests/demand_funnel.test.js が検査する。
 *
 * 集計の約束:
 *  - 母数は有効回答（kind==='valid'）。null / 未回答は「いいえ」にしない（どの述語にも当てはまらないだけ）。
 *  - 分岐設問（Q21〜Q26）は Q20 で撮影に興味ありの人だけが回答対象。対象外はクロスの割合の分母から除き、「対象外」として件数だけ示す。
 *  - 複数選択は同一回答者を同じ選択肢で二重に数えない。
 *  - 「3か月以内」＝ Q27 該当行が「ぜひやりたい」「条件が合えばやりたい」。
 */
var DEMAND_NEAR_TERM_ = ['definitely', 'if_conditions_fit'];
function nearTerm_(row) { return { question: 'intent_3m', row: row, include: DEMAND_NEAR_TERM_ }; }

/** ファネル用の述語（schema.funnels の既存述語と併用。any / not / all を組み合わせられる）。 */
var DEMAND_PREDICATES = {
  near_term_shoot_model: nearTerm_('shoot_model'),
  near_term_rent_studio: nearTerm_('rent_studio'),
  near_term_try_lighting: nearTerm_('try_lighting'),
  near_term_join_shoot_event: nearTerm_('join_shoot_event'),
  near_term_join_small_session: nearTerm_('join_small_session'),
  near_term_meet_people: nearTerm_('meet_people'),
  price_5000_plus: { question: 'portrait_price', include: ['5000_6999', '7000_8999', '9000_11999', '12000_14999', '15000_plus'] },
  rental_4000_plus: { question: 'rental_price', include: ['4000_4999', '5000_5999', '6000_7999', '8000_plus'] },
  shooter_wants: { question: 'shooter_interest', include: ['currently_shooting', 'want_to_try'] },
  equipment_answered: { question: 'equipment_wanted', nonEmpty: true },
  /* ストロボ系 = モノブロック + クリップオン（schema.funnels.strobe_wanted と同じ） */
  strobe_wanted: { question: 'equipment_wanted', anyOf: ['monoblock_strobe', 'clip_on_strobe'] },
  /* 常時光系 = LEDビデオライト（白色） + RGBカラーライト */
  constant_wanted: { question: 'equipment_wanted', anyOf: ['led_video_light', 'rgb_light'] },
  rgb_wanted: { question: 'equipment_wanted', anyOf: ['rgb_light'] },
  led_wanted: { question: 'equipment_wanted', anyOf: ['led_video_light'] },
  lighting_any: { any: ['strobe_wanted', 'constant_wanted'] },
  lighting_both: { all: ['strobe_wanted', 'constant_wanted'] },
  constant_only: { all: ['constant_wanted', { not: 'strobe_wanted' }] },
  strobe_only: { all: ['strobe_wanted', { not: 'constant_wanted' }] },
  lighting_neither: { all: ['equipment_answered', { not: 'strobe_wanted' }, { not: 'constant_wanted' }] }
};

/** 実設問に1対1で対応しない軸（照明種別）。applicable を満たす回答者だけが値を持つ。 */
var DEMAND_VIRTUAL_AXES = {
  lighting_type: {
    label: '照明種別（Q23の再分類）',
    applicable: 'equipment_answered',
    options: [
      { id: 'both', label: 'ストロボ系・常時光系の両方', predicate: 'lighting_both' },
      { id: 'constant_only', label: '常時光系のみ', predicate: 'constant_only' },
      { id: 'strobe_only', label: 'ストロボ系のみ', predicate: 'strobe_only' },
      { id: 'neither', label: 'どちらも選ばず（ソフトボックス等のみ・よく分からない等）', predicate: 'lighting_neither' }
    ]
  }
};

var DEMAND_UNAVAILABLE = [
  { id: 'subject_experience', label: '被写体としての撮影経験', reason: '既存設問に無いため集計しません（機材経験 Q24 は撮影者側の経験で、代替指標にはしません）。' },
  { id: 'self_shoot_video', label: 'セルフ撮影・スマホ撮影・動画／リール／TikTok・照明練習の利用形態', reason: '既存回答からは識別できないため集計しません（Q27「照明機材を使ってみる」「撮影方法を教わる」は意向であり、利用形態ではありません）。' }
];

function cross_(axis, label, extra) {
  var spec = { axis: axis, label: label };
  if (extra) Object.keys(extra).forEach(function (k) { spec[k] = extra[k]; });
  return spec;
}

var DEMAND_FUNNELS = [
  {
    id: 'photographed', label: '① 撮ってもらいたい人',
    baseLabel: '有効回答者',
    stages: [
      { label: 'ポートレート興味あり（Q8 とても／やや興味あり）', predicate: 'portrait_interest' },
      { label: '撮ってもらいたい衣装を選択（Q6-B）', predicate: 'wants_photographed' },
      { label: '3か月以内に撮ってもらいたい（Q27）', predicate: 'near_term_intent' },
      { label: '5,000円以上を許容（Q18）', predicate: 'price_5000_plus' },
      { label: '7,000円以上を許容（Q18）', predicate: 'price_7000_plus' }
    ],
    segments: [{
      id: 'near_term_photographed',
      label: '3か月以内に撮ってもらいたい人（Q27「衣装ポートレートを撮ってもらう」＝ぜひやりたい／条件が合えばやりたい）',
      predicate: 'near_term_intent',
      crosses: [
        cross_('age_range', '年代'), cross_('residence', '居住地域', { sparse: true }), cross_('aichi_area', '愛知県内地域'),
        cross_('costume_photographed', '撮ってもらいたい衣装'), cross_('portrait_styles', '撮ってもらいたい写真'),
        cross_('shoot_duration', '希望撮影時間'), cross_('weekdays', '曜日'),
        cross_('weekday_time_slots', '時間帯（平日）'), cross_('holiday_time_slots', '時間帯（土日祝）'),
        cross_('portrait_price', 'ポートレート価格'), cross_('hesitation', '撮影への不安・ためらい'),
        cross_('face_exposure', '顔の写り方'), cross_('photo_usage', '写真用途')
      ]
    }],
    triples: [{
      id: 'near_term_age_residence_price', label: '3か月以内に撮ってもらいたい人 ｜ 年代 × 居住地域 × ポートレート価格',
      segment: 'near_term_photographed', axes: ['age_range', 'residence', 'portrait_price'],
      axisLabels: ['年代', '居住地域', 'ポートレート価格'], limit: 30
    }]
  },
  {
    id: 'studio', label: '② スタジオを借りたい人',
    baseLabel: '有効回答者',
    stages: [
      { label: '人物撮影に興味あり（Q20 現在撮影／やってみたい／少し興味）', predicate: 'shooter_interest' },
      { label: 'スタジオ利用意向あり（Q21 利用中／借りてみたい／条件が合えば）', predicate: 'studio_wanted' },
      { label: '3か月以内にスタジオを借りたい（Q27）', predicate: 'near_term_rent_studio' },
      { label: '4,000円以上を許容（Q26）', predicate: 'rental_4000_plus' }
    ],
    segments: [
      {
        id: 'studio_wanted', label: 'スタジオ利用意向あり（Q21）', predicate: 'studio_wanted',
        crosses: [
          cross_('age_range', '年代'), cross_('residence', '居住地域', { sparse: true }), cross_('party_size', '利用人数'),
          cross_('rental_price', 'スタジオ価格'), cross_('backdrop', '使いたい背景'), cross_('equipment_wanted', '使いたい機材')
        ]
      },
      {
        id: 'near_term_studio', label: '3か月以内にスタジオを借りたい人（Q27「撮影スタジオを借りる」＝ぜひやりたい／条件が合えばやりたい）',
        predicate: 'near_term_rent_studio',
        crosses: [cross_('rental_price', 'スタジオ価格'), cross_('residence', '居住地域', { sparse: true })]
      }
    ]
  },
  {
    id: 'lighting', label: '③ 照明・機材を使いたい人（ストロボ系 vs 常時光系）',
    baseLabel: '有効回答者',
    stages: [
      { label: '人物撮影に興味あり（Q20）', predicate: 'shooter_interest' },
      { label: '照明（ストロボ系または常時光系）を使ってみたい（Q23）', predicate: 'lighting_any' },
      { label: '3か月以内に照明機材を使ってみたい（Q27）', predicate: 'near_term_try_lighting' }
    ],
    breakdownBase: { label: 'Q23に回答した人（Q20で撮影に興味ありの人）', predicate: 'equipment_answered' },
    breakdown: [
      { label: 'ストロボ系を使いたい（モノブロック／クリップオン）', predicate: 'strobe_wanted' },
      { label: '常時光系を使いたい（LEDビデオライト／RGBカラーライト）', predicate: 'constant_wanted' },
      { label: '両方', predicate: 'lighting_both' },
      { label: '常時光のみ', predicate: 'constant_only' },
      { label: 'ストロボのみ', predicate: 'strobe_only' },
      { label: 'どちらも選ばず', predicate: 'lighting_neither' },
      { label: '（内訳）LEDビデオライト（白色）', predicate: 'led_wanted' },
      { label: '（内訳）RGBカラーライト', predicate: 'rgb_wanted' }
    ],
    segments: ['strobe_wanted', 'constant_wanted', 'rgb_wanted'].map(function (id) {
      var labels = { strobe_wanted: 'ストロボ系を使いたい人', constant_wanted: '常時光系を使いたい人', rgb_wanted: 'RGBカラーライトを使いたい人' };
      return {
        id: id, label: labels[id], predicate: id,
        crosses: [
          cross_('age_range', '年代'), cross_('equipment_experience', '機材経験'), cross_('equipment_support', 'サポート需要'),
          cross_('intent_3m:try_lighting', '3か月以内に照明機材を使ってみたい（Q27）')
        ]
      };
    }).concat([{
      id: 'near_term_lighting', label: '3か月以内に照明機材を使ってみたい人（Q27）', predicate: 'near_term_try_lighting',
      crosses: [cross_('lighting_type', '照明種別')]
    }])
  },
  {
    id: 'shooter', label: '④ 撮りたい人',
    baseLabel: '有効回答者',
    stages: [
      { label: '人物撮影に興味あり（Q20 現在撮影／やってみたい／少し興味）', predicate: 'shooter_interest' },
      { label: '自分で人物を撮りたい（Q20 現在撮影／やってみたい）', predicate: 'shooter_wants' },
      { label: 'スタジオ利用意向あり（Q21）', predicate: 'studio_wanted' },
      { label: '照明を使ってみたい（Q23）', predicate: 'lighting_any' },
      { label: '3か月以内にモデルを撮影したい（Q27）', predicate: 'near_term_shoot_model' }
    ],
    segments: [{
      id: 'shooter_interest', label: '撮影者意向あり（Q20 現在撮影／やってみたい／少し興味）', predicate: 'shooter_interest',
      crosses: [
        cross_('age_range', '年代'), cross_('residence', '居住地域', { sparse: true }), cross_('costume_shoot', '撮りたい衣装'),
        cross_('studio_rental', 'スタジオ利用意向'), cross_('lighting_type', '照明種別'),
        cross_('equipment_experience', '機材経験'), cross_('equipment_support', 'サポート需要')
      ]
    }]
  },
  {
    id: 'event', label: '⑤ イベント／少人数撮影会に参加したい人',
    baseLabel: '有効回答者',
    parallel: [
      { label: '撮影イベントに参加したい（Q27）', predicate: 'near_term_join_shoot_event', row: 'join_shoot_event' },
      { label: '少人数撮影会に参加したい（Q27）', predicate: 'near_term_join_small_session', row: 'join_small_session' },
      { label: '同じ衣装・撮影趣味の人と交流したい（Q27）', predicate: 'near_term_meet_people', row: 'meet_people' }
    ],
    segments: [
      { id: 'event_shoot', label: '撮影イベントに参加したい人', predicate: 'near_term_join_shoot_event' },
      { id: 'event_small_session', label: '少人数撮影会に参加したい人', predicate: 'near_term_join_small_session' },
      { id: 'event_meet_people', label: '同じ衣装・撮影趣味の人と交流したい人', predicate: 'near_term_meet_people' }
    ].map(function (seg) {
      seg.crosses = [
        cross_('age_range', '年代'), cross_('residence', '居住地域', { sparse: true }), cross_('costume_photographed', '撮ってもらいたい衣装'),
        cross_('portrait_price', 'ポートレート価格'), cross_('hesitation', '撮影への不安・ためらい')
      ];
      return seg;
    })
  }
];

function demandUnique_(values) {
  var seen = {};
  return values.filter(function (v) { if (hasOwnProp_(seen, v)) return false; seen[v] = true; return true; });
}
function hasOwnProp_(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }

/** 述語評価。文字列 = DEMAND_PREDICATES → schema.funnels の順に解決。{all,any,not} を再帰し、葉は SurveyCore.evalPredicate。 */
function demandEval_(predicate, record) {
  var def = predicate;
  if (typeof predicate === 'string') {
    def = hasOwnProp_(DEMAND_PREDICATES, predicate) ? DEMAND_PREDICATES[predicate]
      : (hasOwnProp_(SURVEY_SCHEMA.funnels, predicate) ? SURVEY_SCHEMA.funnels[predicate] : null);
    if (!def) throw new Error('unknown_predicate:' + predicate);
  }
  if (def.not !== undefined) return !demandEval_(def.not, record);
  if (def.all) return def.all.every(function (p) { return demandEval_(p, record); });
  if (def.any) return def.any.some(function (p) { return demandEval_(p, record); });
  return SurveyCore.evalPredicate(SURVEY_SCHEMA, def, record);
}

function demandAxis_(key) {
  if (hasOwnProp_(DEMAND_VIRTUAL_AXES, key)) {
    var virtual = DEMAND_VIRTUAL_AXES[key];
    return {
      key: key,
      options: virtual.options.map(function (o) { return { id: o.id, label: o.label }; }),
      values: function (record) {
        if (!demandEval_(virtual.applicable, record)) return [];
        return virtual.options.filter(function (o) { return demandEval_(o.predicate, record); }).map(function (o) { return o.id; });
      }
    };
  }
  var axis = parseAxisKey_(key);
  return {
    key: key,
    options: SurveyCore.axisOptions(SURVEY_SCHEMA, axis),
    values: function (record) { return demandUnique_(SurveyCore.axisValues(SURVEY_SCHEMA, axis, record)); }
  };
}

function ratio_(n, base) { return base ? Math.round(n / base * 1000) / 10 : null; }

function demandStages_(stages, records) {
  var total = records.length;
  var current = records;
  var prev = total;
  var out = [{ label: '有効回答者', count: total, prevPct: null, allPct: total ? 100 : null }];
  stages.forEach(function (stage) {
    current = current.filter(function (record) { return demandEval_(stage.predicate, record); });
    out.push({ label: stage.label, count: current.length, prevPct: ratio_(current.length, prev), allPct: ratio_(current.length, total) });
    prev = current.length;
  });
  return out;
}

function demandCross_(members, spec) {
  var axis = demandAxis_(spec.axis);
  var counts = {};
  axis.options.forEach(function (o) { counts[o.id] = 0; });
  var answered = 0;
  members.forEach(function (record) {
    var values = axis.values(record);
    if (!values.length) return;
    answered++;
    values.forEach(function (v) { if (hasOwnProp_(counts, v)) counts[v]++; });
  });
  return {
    axis: spec.axis, label: spec.label,
    answered: answered, notApplicable: members.length - answered,
    options: axis.options.filter(function (o) { return !(spec.sparse && counts[o.id] === 0); }).map(function (o) {
      return { id: o.id, label: o.label, count: counts[o.id], pct: ratio_(counts[o.id], answered) };
    })
  };
}

function demandTriple_(members, spec) {
  var axes = spec.axes.map(demandAxis_);
  var groups = {};
  members.forEach(function (record) {
    var picked = [];
    for (var i = 0; i < axes.length; i++) {
      var values = axes[i].values(record);
      if (values.length !== 1) return;
      picked.push(values[0]);
    }
    var key = picked.join('\u0001');
    if (!hasOwnProp_(groups, key)) groups[key] = { ids: picked, count: 0 };
    groups[key].count++;
  });
  var rows = Object.keys(groups).map(function (k) { return groups[k]; }).sort(function (a, b) {
    return b.count - a.count || (a.ids.join('|') < b.ids.join('|') ? -1 : 1);
  });
  var optionLabel = function (axis, id) {
    return axis.options.filter(function (o) { return o.id === id; }).map(function (o) { return o.label; })[0] || id;
  };
  var included = rows.reduce(function (sum, r) { return sum + r.count; }, 0);
  return {
    id: spec.id, label: spec.label, axisLabels: spec.axisLabels, included: included, notApplicable: members.length - included,
    rows: rows.slice(0, spec.limit).map(function (r) {
      return { labels: r.ids.map(function (id, i) { return optionLabel(axes[i], id); }), count: r.count, pct: ratio_(r.count, included) };
    })
  };
}

function buildDemandFunnels_(records) {
  var total = records.length;
  var funnels = DEMAND_FUNNELS.map(function (def) {
    var out = { id: def.id, label: def.label, baseLabel: def.baseLabel, base: total };
    if (def.stages) out.stages = demandStages_(def.stages, records);
    if (def.parallel) {
      out.parallel = def.parallel.map(function (item) {
        var positive = records.filter(function (r) { return demandEval_(item.predicate, r); }).length;
        var parts = SurveyCore.getQuestion(SURVEY_SCHEMA, 'intent_3m').scale.filter(function (s) { return DEMAND_NEAR_TERM_.indexOf(s.id) !== -1; }).map(function (s) {
          var count = records.filter(function (r) { return demandEval_({ question: 'intent_3m', row: item.row, include: [s.id] }, r); }).length;
          return { label: s.label, count: count, allPct: ratio_(count, total) };
        });
        return { label: item.label, count: positive, allPct: ratio_(positive, total), parts: parts };
      });
      var anyPositive = records.filter(function (r) {
        return def.parallel.some(function (item) { return demandEval_(item.predicate, r); });
      }).length;
      out.parallelAny = { label: 'いずれかに参加・交流したい（重複なし）', count: anyPositive, allPct: ratio_(anyPositive, total) };
    }
    if (def.breakdown) {
      var baseMembers = records.filter(function (r) { return demandEval_(def.breakdownBase.predicate, r); });
      out.breakdownBase = { label: def.breakdownBase.label, count: baseMembers.length };
      out.breakdown = def.breakdown.map(function (item) {
        var count = baseMembers.filter(function (r) { return demandEval_(item.predicate, r); }).length;
        return { label: item.label, count: count, pct: ratio_(count, baseMembers.length), allPct: ratio_(count, total) };
      });
    }
    var segmentMembers = {};
    out.segments = (def.segments || []).map(function (seg) {
      var members = records.filter(function (r) { return demandEval_(seg.predicate, r); });
      segmentMembers[seg.id] = members;
      return {
        id: seg.id, label: seg.label, count: members.length, allPct: ratio_(members.length, total),
        crosses: (seg.crosses || []).map(function (spec) { return demandCross_(members, spec); })
      };
    });
    if (def.triples) {
      out.triples = def.triples.map(function (spec) {
        return demandTriple_(segmentMembers[spec.segment], spec);
      });
    }
    return out;
  });
  return { base: total, funnels: funnels, unavailable: DEMAND_UNAVAILABLE };
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
    demandFunnels: buildDemandFunnels_(records),
    crosstabPresets: presets,
    axes: listAxes_(),
    freeText: buildFreeText_(valid)
  };
}
