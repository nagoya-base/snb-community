#!/usr/bin/env node
'use strict';

// survey.schema.json（design v2.18）の参照整合 validator。
// Issue #378。schema は読み取り専用の正本で、このツールは何も生成・書き換えしない。
// CLI: node tools/validate-schema.js [schema.json]  / library: validateSchema(schema)

const fs = require('fs');
const path = require('path');

const DEFAULT_SCHEMA_PATH = path.join(__dirname, '..', 'survey.schema.json');

const OPTION_TYPES = new Set(['single', 'multiple', 'single_dynamic', 'scale']);
const SINGLE_VALUE_TYPES = new Set(['single', 'single_dynamic', 'scale']);
const VALUE_OPS = ['equals', 'notEquals', 'in', 'contains', 'notContains', 'hasAnyExcept'];
const GROUP_OPS = ['all', 'any'];
const SINGLE_OPS = new Set(['equals', 'notEquals', 'in']);
const MULTI_OPS = new Set(['contains', 'notContains', 'hasAnyExcept']);

// publicResultsOrder に現れる、question ではない派生ブロックの ID。
const VIRTUAL_PUBLIC_IDS = new Set(['region_blocks']);

const MIN_CELL = 3;
const MIN_TARGET_BRANCH = 10;
const MIN_TARGET_SENSITIVE_BRANCH = 20;

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function sameSet(a, b) {
  return a.length === b.length && a.every((x) => b.includes(x));
}

function validateSchema(schema) {
  const errors = [];
  const err = (code, message) => errors.push({ code, message });

  if (!isObject(schema) || !Array.isArray(schema.questions)) {
    err('schema_shape', 'schema.questions が配列ではありません');
    return errors;
  }

  const questions = schema.questions;
  const byId = new Map();
  const indexOf = new Map();
  questions.forEach((q, i) => {
    if (!isObject(q) || typeof q.id !== 'string' || !q.id) {
      err('question_id_missing', `questions[${i}] に id がありません`);
      return;
    }
    if (byId.has(q.id)) err('question_id_duplicate', `question ID が重複しています: ${q.id}`);
    byId.set(q.id, q);
    indexOf.set(q.id, i);
  });

  const barrierCodes = isObject(schema.barrierCodes) ? schema.barrierCodes : {};
  const conditions = isObject(schema.conditions) ? schema.conditions : {};

  // ---- option ID ----
  for (const q of questions) {
    if (!q || !q.id) continue;
    if (OPTION_TYPES.has(q.type) && q.type !== 'single_dynamic' && q.type !== 'scale') {
      if (!Array.isArray(q.options) || q.options.length === 0) {
        err('options_missing', `${q.id}: options がありません`);
      }
    }
    if (q.type === 'single_dynamic' && q.options !== undefined) {
      err('dynamic_has_static_options', `${q.id}: single_dynamic は静的 options を持てません`);
    }
    if (Array.isArray(q.options)) {
      const seen = new Set();
      for (const o of q.options) {
        if (!isObject(o) || typeof o.id !== 'string' || !o.id) {
          err('option_id_missing', `${q.id}: id のない option があります`);
          continue;
        }
        if (seen.has(o.id)) err('option_id_duplicate', `${q.id}: option ID が重複しています: ${o.id}`);
        seen.add(o.id);
        if (o.exclusive && q.type !== 'multiple') {
          err('exclusive_on_non_multiple', `${q.id}.${o.id}: exclusive は multiple 設問のみ`);
        }
        if (o.other && !(Number.isInteger(q.otherMaxLength) && q.otherMaxLength > 0)) {
          err('other_max_length_missing', `${q.id}.${o.id}: other option に otherMaxLength がありません`);
        }
      }
    }
  }

  // 参照先設問の「固定 option ID 集合」。dynamic は sourceQuestion 由来で導出する。
  function staticOptionIds(q, trail = []) {
    if (!q) return null;
    if (q.type === 'scale') {
      const ids = [];
      for (let n = q.min; n <= q.max; n += 1) ids.push(String(n));
      if (q.notApplicable && q.notApplicable.id) ids.push(q.notApplicable.id);
      return ids;
    }
    if (q.type === 'single_dynamic') {
      const src = byId.get(q.sourceQuestion);
      if (!src || trail.includes(q.id)) return null;
      const base = staticOptionIds(src, [...trail, q.id]);
      if (!base) return null;
      const excluded = new Set(Array.isArray(q.excludeOptionIds) ? q.excludeOptionIds : []);
      return base.filter((id) => !excluded.has(id));
    }
    if (Array.isArray(q.options)) return q.options.map((o) => o.id);
    return null; // text 等: 値検査の対象外
  }

  // ---- sourceQuestion（dynamic） ----
  for (const q of questions) {
    if (!q || q.type !== 'single_dynamic') continue;
    const src = byId.get(q.sourceQuestion);
    if (!src) {
      err('source_question_missing', `${q.id}: sourceQuestion が存在しません: ${q.sourceQuestion}`);
      continue;
    }
    if (src.type !== 'multiple') {
      err('source_question_type', `${q.id}: sourceQuestion ${src.id} は multiple である必要があります`);
    }
    if (indexOf.get(src.id) >= indexOf.get(q.id)) {
      err('source_question_order', `${q.id}: sourceQuestion ${src.id} は後ろに定義されています`);
    }
    const srcIds = new Set((src.options || []).map((o) => o.id));
    for (const ex of q.excludeOptionIds || []) {
      if (!srcIds.has(ex)) {
        err('exclude_option_missing', `${q.id}: excludeOptionIds が sourceQuestion に存在しません: ${ex}`);
      }
    }
  }

  // ---- showIf / conditions 走査 ----
  function checkLeaf(where, node) {
    const ops = VALUE_OPS.filter((op) => op in node);
    if (ops.length !== 1) {
      err('condition_operator', `${where}: 演算子はちょうど 1 つ必要です (${ops.join(',') || 'none'})`);
      return;
    }
    const op = ops[0];
    const target = byId.get(node.question);
    if (!target) {
      err('showif_question_missing', `${where}: 参照先 question が存在しません: ${node.question}`);
      return;
    }
    const operand = node[op];
    const values = Array.isArray(operand) ? operand : [operand];
    if ((op === 'in' || op === 'hasAnyExcept') && !Array.isArray(operand)) {
      err('condition_operand', `${where}: ${op} の値は配列である必要があります`);
    }
    if (op !== 'in' && op !== 'hasAnyExcept' && Array.isArray(operand)) {
      err('condition_operand', `${where}: ${op} の値は単一値である必要があります`);
    }
    if (SINGLE_OPS.has(op) && !SINGLE_VALUE_TYPES.has(target.type)) {
      err('condition_type', `${where}: ${op} は単一選択設問向けですが ${target.id} は ${target.type} です`);
    }
    if (MULTI_OPS.has(op) && target.type !== 'multiple') {
      err('condition_type', `${where}: ${op} は multiple 設問向けですが ${target.id} は ${target.type} です`);
    }
    const ids = staticOptionIds(target);
    if (ids) {
      for (const v of values) {
        if (!ids.includes(v)) {
          err('showif_option_missing', `${where}: ${target.id} に option が存在しません: ${v}`);
        }
      }
    }
  }

  function checkCondition(where, node, refTrail = []) {
    if (!isObject(node)) {
      err('condition_shape', `${where}: 条件がオブジェクトではありません`);
      return;
    }
    if ('conditionRef' in node) {
      const name = node.conditionRef;
      if (!(name in conditions)) {
        err('condition_ref_missing', `${where}: conditionRef が存在しません: ${name}`);
      } else if (refTrail.includes(name)) {
        err('condition_ref_cycle', `${where}: conditionRef が循環しています: ${[...refTrail, name].join(' -> ')}`);
      }
      return;
    }
    const group = GROUP_OPS.filter((op) => op in node);
    if (group.length > 0) {
      if (group.length !== 1) {
        err('condition_operator', `${where}: all / any は同時に指定できません`);
        return;
      }
      const children = node[group[0]];
      if (!Array.isArray(children) || children.length === 0) {
        err('condition_shape', `${where}: ${group[0]} は空でない配列が必要です`);
        return;
      }
      children.forEach((c, i) => checkCondition(`${where}.${group[0]}[${i}]`, c, refTrail));
      return;
    }
    checkLeaf(where, node);
  }

  // conditionRef の循環検出用に、conditions 内の参照を展開して確認する。
  function refsIn(node, acc = []) {
    if (!isObject(node)) return acc;
    if (typeof node.conditionRef === 'string') acc.push(node.conditionRef);
    for (const op of GROUP_OPS) if (Array.isArray(node[op])) node[op].forEach((c) => refsIn(c, acc));
    return acc;
  }
  for (const name of Object.keys(conditions)) {
    const stack = [name];
    const seen = new Set();
    while (stack.length) {
      const cur = stack.pop();
      for (const next of refsIn(conditions[cur])) {
        if (next === name) err('condition_ref_cycle', `conditions.${name}: conditionRef が循環しています`);
        if (conditions[next] && !seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    checkCondition(`conditions.${name}`, conditions[name]);
  }

  for (const q of questions) {
    if (!q || !q.id || q.showIf === undefined) continue;
    checkCondition(`${q.id}.showIf`, q.showIf);
  }

  // ---- section ----
  for (const q of questions) {
    if (!q || !q.id) continue;
    if (typeof q.section !== 'string' || !q.section) {
      err(q.required ? 'required_section_missing' : 'section_missing', `${q.id}: section がありません`);
    }
  }

  // ---- semanticCodes / reassuranceFor ----
  for (const q of questions) {
    if (!q || !Array.isArray(q.options)) continue;
    for (const o of q.options) {
      const where = `${q.id}.${o.id}`;
      if (o.semanticCodes !== undefined) {
        const sc = o.semanticCodes;
        if (!isObject(sc) || typeof sc.primary !== 'string' || !Array.isArray(sc.secondary)) {
          err('semantic_codes_shape', `${where}: semanticCodes は { primary: string, secondary: string[] } が必要です`);
        } else {
          if (!(sc.primary in barrierCodes)) {
            err('semantic_code_undefined', `${where}: semanticCodes.primary が barrierCodes に未定義: ${sc.primary}`);
          }
          for (const c of sc.secondary) {
            if (!(c in barrierCodes)) {
              err('semantic_code_undefined', `${where}: semanticCodes.secondary が barrierCodes に未定義: ${c}`);
            }
            if (c === sc.primary) err('semantic_code_overlap', `${where}: primary と secondary が重複: ${c}`);
          }
          if (new Set(sc.secondary).size !== sc.secondary.length) {
            err('semantic_code_overlap', `${where}: secondary に重複があります`);
          }
        }
      }
      if (o.reassuranceFor !== undefined) {
        if (!Array.isArray(o.reassuranceFor) || o.reassuranceFor.length === 0) {
          err('reassurance_shape', `${where}: reassuranceFor は空でない配列が必要です`);
        } else {
          for (const c of o.reassuranceFor) {
            if (!(c in barrierCodes)) {
              err('reassurance_code_undefined', `${where}: reassuranceFor が barrierCodes に未定義: ${c}`);
            }
          }
        }
      }
    }
  }

  // ---- publication ----
  const publicIds = [];
  for (const q of questions) {
    if (!q || !q.id) continue;
    const pub = q.publication;
    if (!isObject(pub)) {
      err('publication_missing', `${q.id}: publication object がありません`);
      continue;
    }
    if (pub.visibility === 'private') continue;
    if (pub.visibility !== 'public') {
      err('publication_visibility', `${q.id}: publication.visibility が不正です: ${pub.visibility}`);
      continue;
    }
    publicIds.push(q.id);
    const isBranch = q.showIf !== undefined;

    if (pub.ordinal === true && 'sort' in pub) {
      err('ordinal_with_sort', `${q.id}: ordinal:true と sort は同時指定できません`);
    }
    if (pub.ordinal === false && !pub.sort) {
      err('nominal_without_sort', `${q.id}: ordinal:false には sort が必要です`);
    }
    if (typeof pub.ordinal !== 'boolean') {
      err('ordinal_missing', `${q.id}: publication.ordinal が boolean ではありません`);
    }
    if (pub.ordinal === true && pub.showZeroCells !== true) {
      err('ordinal_zero_cells', `${q.id}: ordinal 設問は 0 件 option も表示します (showZeroCells:true)`);
    }
    if (!(typeof pub.minCell === 'number' && pub.minCell >= MIN_CELL)) {
      err('min_cell', `${q.id}: public 設問の minCell は ${MIN_CELL} 以上が必要です (${pub.minCell})`);
    }
    if (isBranch) {
      if (!(typeof pub.minTarget === 'number' && pub.minTarget >= MIN_TARGET_BRANCH)) {
        err('min_target', `${q.id}: branch public 設問の minTarget は ${MIN_TARGET_BRANCH} 以上が必要です (${pub.minTarget})`);
      }
    }
    if (pub.sensitiveBranch === true) {
      if (!(typeof pub.minTarget === 'number' && pub.minTarget >= MIN_TARGET_SENSITIVE_BRANCH)) {
        err('min_target_sensitive', `${q.id}: sensitive branch の minTarget は ${MIN_TARGET_SENSITIVE_BRANCH} 以上が必要です (${pub.minTarget})`);
      }
      if (!isBranch) err('sensitive_without_branch', `${q.id}: sensitiveBranch:true だが showIf がありません`);
    }
    if (!(typeof pub.minTotal === 'number' && pub.minTotal >= 10)) {
      err('min_total', `${q.id}: minTotal は 10 以上が必要です (${pub.minTotal})`);
    }
    if (pub.tier === 'bias_sensitive' && !(pub.minTotal >= 30)) {
      err('min_total', `${q.id}: bias_sensitive の minTotal は 30 以上が必要です (${pub.minTotal})`);
    }
    if (!['early_factual', 'bias_sensitive'].includes(pub.tier)) {
      err('publication_tier', `${q.id}: publication.tier が不正です: ${pub.tier}`);
    }
    if (pub.denominator !== 'question_reached') {
      err('publication_denominator', `${q.id}: denominator は question_reached が必要です (${pub.denominator})`);
    }
  }

  // ---- publicResultsOrder ----
  const order = schema.publicResultsOrder;
  if (!Array.isArray(order)) {
    err('public_order_missing', 'publicResultsOrder が配列ではありません');
  } else {
    const seen = new Set();
    for (const id of order) {
      if (seen.has(id)) err('public_order_duplicate', `publicResultsOrder に重複: ${id}`);
      seen.add(id);
      if (VIRTUAL_PUBLIC_IDS.has(id)) {
        if (!(isObject(schema.publicRegionAggregation) && schema.publicRegionAggregation.enabled)) {
          err('public_order_virtual', `publicResultsOrder の ${id} は publicRegionAggregation.enabled が必要です`);
        }
        continue;
      }
      const q = byId.get(id);
      if (!q) {
        err('public_order_question_missing', `publicResultsOrder の question が存在しません: ${id}`);
      } else if (!(q.publication && q.publication.visibility === 'public')) {
        err('public_order_not_public', `publicResultsOrder の ${id} は public ではありません`);
      }
    }
    for (const id of publicIds) {
      if (!seen.has(id)) err('public_order_omitted', `public 設問が publicResultsOrder にありません: ${id}`);
    }
  }

  // ---- publicRegionAggregation ----
  const region = schema.publicRegionAggregation;
  if (isObject(region) && region.enabled) {
    const src = byId.get(region.sourceQuestion);
    if (!src) {
      err('region_source_missing', `publicRegionAggregation.sourceQuestion が存在しません: ${region.sourceQuestion}`);
    } else {
      const srcIds = (src.options || []).map((o) => o.id);
      const excluded = new Set(region.excludeOptionIds || []);
      const mapped = [];
      for (const block of region.blocks || []) {
        for (const id of block.prefectureOptionIds || []) {
          if (!srcIds.includes(id)) err('region_option_missing', `地方block ${block.id}: option が存在しません: ${id}`);
          mapped.push(id);
        }
      }
      if (new Set(mapped).size !== mapped.length) err('region_option_duplicate', '地方block間で option が重複しています');
      for (const id of srcIds) {
        if (!excluded.has(id) && !mapped.includes(id)) {
          err('region_option_unmapped', `${src.id}.${id} がどの地方blockにも割り当てられていません`);
        }
      }
    }
    const rp = region.publication;
    if (!(isObject(rp) && rp.minCell >= MIN_CELL && rp.minTarget >= 10)) {
      err('region_publication', 'publicRegionAggregation.publication は minCell>=3 / minTarget>=10 が必要です');
    }
    if (region.privacy && (region.privacy.publishPrefectureDetail !== false || region.privacy.publishAichiAreaDetail !== false)) {
      err('region_privacy', '詳細都道府県・愛知県内地域は公開できません');
    }
  }

  // ---- analysisFunnels / adminAnalysis（Issue #440。Admin 専用の分析定義。既存の設問・option ID だけを参照する） ----
  const optionIdsOf = (question) => {
    if (!question) return null;
    const source = question.type === 'single_dynamic' ? byId.get(question.sourceQuestion) : question;
    return source && Array.isArray(source.options) ? source.options.map((o) => o.id) : null;
  };
  const adminAnalysis = isObject(schema.adminAnalysis) ? schema.adminAnalysis : null;
  const funnelDefs = isObject(schema.analysisFunnels) ? schema.analysisFunnels : {};
  for (const [fid, funnel] of Object.entries(funnelDefs)) {
    if (!isObject(funnel) || !Array.isArray(funnel.stages)) continue; // method だけの比較定義（past_to_current_barriers）は対象外
    const checkIds = (where, qid, ids) => {
      const ids0 = optionIdsOf(byId.get(qid));
      if (!byId.has(qid)) { err('funnel_question_missing', `analysisFunnels.${fid} ${where}: 設問が存在しません: ${qid}`); return; }
      for (const id of ids) if (ids0 && !ids0.includes(id)) err('funnel_option_missing', `analysisFunnels.${fid} ${where}: ${qid}.${id} が存在しません`);
    };
    if (isObject(funnel.population)) {
      for (const [qid, ids] of Object.entries(funnel.population)) checkIds('population', qid, Array.isArray(ids) ? ids : []);
    } else if (typeof funnel.population !== 'string') {
      err('funnel_population_shape', `analysisFunnels.${fid}.population はオブジェクトまたは文字列が必要です`);
    }
    for (const stage of funnel.stages) {
      if (!isObject(stage)) { err('funnel_stage_shape', `analysisFunnels.${fid} の stage がオブジェクトではありません`); continue; }
      for (const [key, value] of Object.entries(stage)) {
        if (Array.isArray(value)) checkIds(`stage.${key}`, stage.question, value);
      }
      if (!byId.has(stage.question)) err('funnel_question_missing', `analysisFunnels.${fid} stage の設問が存在しません: ${stage.question}`);
    }
    if (adminAnalysis) {
      if (!(isObject(adminAnalysis.funnelLabels) && typeof adminAnalysis.funnelLabels[fid] === 'string')) {
        err('admin_analysis_funnel_label', `adminAnalysis.funnelLabels.${fid} がありません`);
      }
      const denominator = typeof funnel.denominator === 'string' ? funnel.denominator : 'stage_reached'; // 未指定は stage_reached
      if (!(isObject(adminAnalysis.denominatorLabels) && typeof adminAnalysis.denominatorLabels[denominator] === 'string')) {
        err('admin_analysis_denominator_label', `adminAnalysis.denominatorLabels.${denominator} がありません（analysisFunnels.${fid}.denominator）`);
      }
      for (const stage of funnel.stages) {
        if (isObject(stage) && typeof stage.role === 'string' && !(isObject(adminAnalysis.roleLabels) && typeof adminAnalysis.roleLabels[stage.role] === 'string')) {
          err('admin_analysis_role_label', `adminAnalysis.roleLabels.${stage.role} がありません（analysisFunnels.${fid}）`);
        }
      }
    }
  }
  if (adminAnalysis) {
    const crossIds = new Set();
    for (const [i, cross] of (Array.isArray(adminAnalysis.crossTabs) ? adminAnalysis.crossTabs : []).entries()) {
      if (!isObject(cross) || typeof cross.id !== 'string' || !cross.id) { err('cross_tab_id', `adminAnalysis.crossTabs[${i}] に id がありません`); continue; }
      if (crossIds.has(cross.id)) err('cross_tab_duplicate', `adminAnalysis.crossTabs の id が重複しています: ${cross.id}`);
      crossIds.add(cross.id);
      for (const axis of ['row', 'column']) {
        const question = byId.get(cross[axis]);
        if (!question) err('cross_tab_question_missing', `adminAnalysis.crossTabs.${cross.id}.${axis} の設問が存在しません: ${cross[axis]}`);
        else if (!OPTION_TYPES.has(question.type)) err('cross_tab_question_type', `adminAnalysis.crossTabs.${cross.id}.${axis} は選択式設問が必要です: ${cross[axis]}`);
      }
      if (cross.row === cross.column) err('cross_tab_same_axis', `adminAnalysis.crossTabs.${cross.id} の行と列が同じ設問です`);
    }
  }

  // ---- routeUx ----
  const catchball = byId.get('catchball_interest');
  const catchballIds = catchball && Array.isArray(catchball.options) ? catchball.options.map((o) => o.id) : [];
  const routeUx = isObject(schema.routeUx) ? schema.routeUx : {};
  for (const [name, route] of Object.entries(routeUx)) {
    if (!isObject(route)) continue;
    if (route.trigger !== undefined) checkCondition(`routeUx.${name}.trigger`, route.trigger);
    if (route.flow !== undefined) {
      if (!Array.isArray(route.flow)) {
        err('route_flow_shape', `routeUx.${name}.flow は配列が必要です`);
      } else {
        for (const id of route.flow) {
          if (!byId.has(id)) err('route_flow_question_missing', `routeUx.${name}.flow の question が存在しません: ${id}`);
        }
        if (new Set(route.flow).size !== route.flow.length) {
          err('route_flow_duplicate', `routeUx.${name}.flow に重複があります`);
        }
      }
    }
  }

  // ---- sectionUx ----
  const sectionUx = isObject(schema.sectionUx) ? schema.sectionUx : {};
  const lowAck = isObject(sectionUx.lowInterestAcknowledgement) ? sectionUx.lowInterestAcknowledgement : null;
  if (lowAck && lowAck.trigger !== undefined) {
    checkCondition('sectionUx.lowInterestAcknowledgement.trigger', lowAck.trigger);
  }
  for (const [i, m] of (Array.isArray(sectionUx.milestones) ? sectionUx.milestones : []).entries()) {
    for (const key of ['afterQuestion', 'fallbackAfterQuestion', 'beforeQuestion']) {
      if (m[key] !== undefined && !byId.has(m[key])) {
        err('milestone_question_missing', `sectionUx.milestones[${i}].${key} の question が存在しません: ${m[key]}`);
      }
    }
    if (m.conditionRef !== undefined && !(m.conditionRef in conditions)) {
      err('condition_ref_missing', `sectionUx.milestones[${i}].conditionRef が存在しません: ${m.conditionRef}`);
    }
  }

  // ---- 低関心 route の trigger が catchball_interest の実在 option と一致 ----
  const lowSet = lowInterestOptionIds(schema);
  for (const [where, ids] of Object.entries(lowSet)) {
    if (!ids) {
      err('low_interest_trigger_missing', `${where}: 低関心 trigger の option 参照を取得できません`);
      continue;
    }
    for (const id of ids) {
      if (!catchballIds.includes(id)) {
        err('low_interest_option_missing', `${where}: catchball_interest に存在しない option: ${id}`);
      }
    }
  }
  const lowRefs = Object.values(lowSet).filter(Boolean);
  if (lowRefs.length === 3 && !lowRefs.every((ids) => sameSet(ids, lowRefs[0]))) {
    err('low_interest_mismatch', '低関心 route の 3 参照 (uniform_social_interest.showIf / lowInterestAcknowledgement / pure_uniform_short_route) が一致しません');
  }

  // ---- testModes ----
  validateTestModes(schema, err);

  return errors;
}

// catchball_interest を参照する leaf から in/equals の値を取り出す。
function findCatchballValues(node) {
  if (!isObject(node)) return null;
  if (node.question === 'catchball_interest') {
    if (Array.isArray(node.in)) return node.in;
    if (typeof node.equals === 'string') return [node.equals];
    return null;
  }
  for (const op of GROUP_OPS) {
    if (Array.isArray(node[op])) {
      for (const child of node[op]) {
        const found = findCatchballValues(child);
        if (found) return found;
      }
    }
  }
  return null;
}

function lowInterestOptionIds(schema) {
  const q = (schema.questions || []).find((x) => x.id === 'uniform_social_interest');
  const ux = schema.sectionUx && schema.sectionUx.lowInterestAcknowledgement;
  const route = schema.routeUx && schema.routeUx.pure_uniform_short_route;
  return {
    'uniform_social_interest.showIf': q ? findCatchballValues(q.showIf) : null,
    'sectionUx.lowInterestAcknowledgement.trigger': ux ? findCatchballValues(ux.trigger) : null,
    'routeUx.pure_uniform_short_route.trigger': route ? findCatchballValues(route.trigger) : null,
  };
}

// preview_no_submit / closed_view は client-only（submit token 不要）、
// submit_excluded のみ server 送信 + server token 検証、という #378 の確定仕様。
function validateTestModes(schema, err) {
  const tm = schema.testModes;
  if (!isObject(tm) || !isObject(tm.modes)) {
    err('test_modes_missing', 'testModes.modes がありません');
    return;
  }
  const activation = isObject(tm.activation) ? tm.activation : {};
  const clientOnly = activation.clientOnlyModes;
  const serverVerified = activation.serverVerifiedModes;
  if (!Array.isArray(clientOnly) || !Array.isArray(serverVerified)) {
    err('test_modes_activation', 'testModes.activation に clientOnlyModes / serverVerifiedModes が必要です');
    return;
  }
  if (!sameSet(clientOnly, ['preview_no_submit', 'closed_view'])) {
    err('test_modes_activation', 'clientOnlyModes は preview_no_submit / closed_view のみ');
  }
  if (!sameSet(serverVerified, ['submit_excluded'])) {
    err('test_modes_activation', 'serverVerifiedModes は submit_excluded のみ');
  }
  const nonProduction = Object.keys(tm.modes).filter((m) => m !== 'production');
  if (!sameSet([...clientOnly, ...serverVerified], nonProduction)) {
    err('test_modes_activation', 'activation の分類が production 以外の全 mode と一致しません');
  }
  const expectBehavior = {
    preview_no_submit: 'simulate_success_without_save',
    closed_view: 'disabled',
    submit_excluded: 'save_as_test',
  };
  for (const [mode, behavior] of Object.entries(expectBehavior)) {
    const m = tm.modes[mode];
    if (!m) err('test_modes_missing', `testModes.modes.${mode} がありません`);
    else if (m.submitBehavior !== behavior) {
      err('test_modes_behavior', `${mode}: submitBehavior は ${behavior} が必要です (${m.submitBehavior})`);
    }
  }
  for (const [mode, m] of Object.entries(tm.modes)) {
    if (mode === 'production') continue;
    if (m.countInValidResponses !== false || m.includeInAdminProductionAnalysis !== false || m.includeInPublicResults !== false) {
      err('test_modes_isolation', `${mode}: 本番集計・Admin分析・公開結果から除外される必要があります`);
    }
  }
}

function main() {
  const file = path.resolve(process.argv[2] || DEFAULT_SCHEMA_PATH);
  let schema;
  try {
    schema = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`parse error: ${file}: ${e.message}`);
    process.exit(1);
  }
  const errors = validateSchema(schema);
  if (errors.length) {
    for (const e of errors) console.error(`[${e.code}] ${e.message}`);
    console.error(`\n${errors.length} validation error(s)`);
    process.exit(1);
  }
  console.log(`OK: ${path.relative(process.cwd(), file)} (design_version ${schema.design_version}, ${schema.questions.length} questions)`);
}

if (require.main === module) main();

module.exports = { validateSchema, lowInterestOptionIds, DEFAULT_SCHEMA_PATH };
