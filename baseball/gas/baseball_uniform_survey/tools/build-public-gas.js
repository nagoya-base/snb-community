#!/usr/bin/env node
'use strict';

// survey.schema.json（正本）+ survey.config.json（受付期間・最短回答時間・通知設定の正本）+ src/survey-core.js から
// 生成物を作る。生成物は直接編集しない。
// Frontend の表示辞書（i18n.generated.js）は i18n/*.json から生成し、辞書の完全性は tests/i18n.test.js が検証する（Issue #398）。
// Public GAS（public/SurveyGenerated.gs）・Frontend（baseball/baseball-uniform-survey/survey.generated.js）・
// Admin GAS（admin/SurveyGenerated.gs。schema + 専用 core + src/survey-aggregate.js。受付設定・通知設定は含めない）、
// maintenance GAS（maintenance/SurveyGenerated.gs。schema + core + aggregate + src/maintenance-core.js + 受付期間 + retention.config.json。通知設定・salt/token は含めない）の4つを生成する。
// `--check` は生成物との差分を検出して非0終了する（CIで実行）。
const fs = require('fs');
const path = require('path');
const i18n = require('./i18n');

const ROOT = path.join(__dirname, '..');
const SCHEMA_PATH = path.join(ROOT, 'survey.schema.json');
const CONFIG_PATH = path.join(ROOT, 'survey.config.json');
const CORE_PATH = path.join(ROOT, 'src', 'survey-core.js');
const AGGREGATE_PATH = path.join(ROOT, 'src', 'survey-aggregate.js');
const MAINTENANCE_CORE_PATH = path.join(ROOT, 'src', 'maintenance-core.js');
const RETENTION_PATH = path.join(ROOT, 'retention.config.json');
const TARGET = path.join(ROOT, 'public', 'SurveyGenerated.gs');
const ADMIN_TARGET = path.join(ROOT, 'admin', 'SurveyGenerated.gs');
const MAINTENANCE_TARGET = path.join(ROOT, 'maintenance', 'SurveyGenerated.gs');
// Frontend 用生成物（schema + 専用 core。server 専用の config は含めない）。GitHub Pages から公開される。
const FRONTEND_TARGET = path.join(ROOT, '..', '..', 'baseball-uniform-survey', 'survey.generated.js');
// Frontend 専用の表示辞書（i18n/*.json から生成。Public/Admin/maintenance GAS には含めない。保存値は変わらない）。
const FRONTEND_I18N_TARGET = path.join(ROOT, '..', '..', 'baseball-uniform-survey', 'i18n.generated.js');

function renderAdmin() {
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const core = fs.readFileSync(CORE_PATH, 'utf8');
  const aggregate = fs.readFileSync(AGGREGATE_PATH, 'utf8');
  return [
    '/*',
    ' * AUTO-GENERATED (Admin GAS) — DO NOT EDIT.',
    ' * 正本: baseball/gas/baseball_uniform_survey/survey.schema.json, src/survey-core.js, src/survey-aggregate.js',
    ' * 再生成: (baseball/gas/baseball_uniform_survey で) npm run build',
    ' * CIは `npm run build:check` で生成物との差分を検出する。',
    ' */',
    'var SURVEY_SCHEMA = ' + JSON.stringify(schema) + ';',
    '',
    core,
    '',
    aggregate
  ].join('\n');
}

// maintenance は #380 の受付設定のうち「締切後であることの前提確認」に使う reception だけを参照する（受付可否は判定しない）。
function renderMaintenance() {
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const retention = JSON.parse(fs.readFileSync(RETENTION_PATH, 'utf8'));
  const core = fs.readFileSync(CORE_PATH, 'utf8');
  const aggregate = fs.readFileSync(AGGREGATE_PATH, 'utf8');
  const maintenance = fs.readFileSync(MAINTENANCE_CORE_PATH, 'utf8');
  return [
    '/*',
    ' * AUTO-GENERATED (maintenance GAS) — DO NOT EDIT.',
    ' * 正本: baseball/gas/baseball_uniform_survey/survey.schema.json, survey.config.json（reception のみ）, retention.config.json,',
    ' *       src/survey-core.js, src/survey-aggregate.js, src/maintenance-core.js',
    ' * 再生成: (baseball/gas/baseball_uniform_survey で) npm run build',
    ' * CIは `npm run build:check` で生成物との差分を検出する。',
    ' */',
    'var SURVEY_SCHEMA = ' + JSON.stringify(schema) + ';',
    'var SURVEY_RECEPTION = ' + JSON.stringify(config.reception) + ';',
    'var RETENTION_CONFIG = ' + JSON.stringify(retention) + ';',
    '',
    core,
    '',
    aggregate,
    '',
    maintenance
  ].join('\n');
}

function renderFrontend() {
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const core = fs.readFileSync(CORE_PATH, 'utf8');
  return [
    '/*',
    ' * AUTO-GENERATED (Frontend) — DO NOT EDIT.',
    ' * 正本: baseball/gas/baseball_uniform_survey/survey.schema.json と src/survey-core.js',
    ' * 再生成: (baseball/gas/baseball_uniform_survey で) npm run build',
    ' * CIは `npm run build:check` で生成物との差分を検出する。',
    ' */',
    'var SURVEY_SCHEMA = ' + JSON.stringify(schema) + ';',
    '',
    core
  ].join('\n');
}

// 辞書に欠落・不明key・意味の上書きがあれば生成しない（翻訳漏れを fallback で隠さない）。
function renderFrontendI18n() {
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const dicts = i18n.loadDicts();
  const problems = i18n.validate(schema, dicts);
  if (problems.length) {
    throw new Error('i18n 辞書が不完全です（' + problems.length + '件）:\n' + problems.slice(0, 20).map((p) => '  ' + p.locale + ' ' + p.code + ' ' + p.key).join('\n'));
  }
  return i18n.renderFrontend(dicts);
}

function render() {
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const core = fs.readFileSync(CORE_PATH, 'utf8');
  return [
    '/*',
    ' * AUTO-GENERATED (Public GAS) — DO NOT EDIT.',
    ' * 正本: baseball/gas/baseball_uniform_survey/survey.schema.json, survey.config.json, src/survey-core.js',
    ' * 再生成: (baseball/gas/baseball_uniform_survey で) npm run build',
    ' * CIは `npm run build:check` で生成物との差分を検出する。',
    ' */',
    'var SURVEY_SCHEMA = ' + JSON.stringify(schema) + ';',
    'var SURVEY_CONFIG = ' + JSON.stringify(config) + ';',
    '',
    core
  ].join('\n');
}

function main(argv) {
  const check = argv.includes('--check');
  const targets = [
    { file: TARGET, content: render() },
    { file: FRONTEND_TARGET, content: renderFrontend() },
    { file: FRONTEND_I18N_TARGET, content: renderFrontendI18n() },
    { file: ADMIN_TARGET, content: renderAdmin() },
    { file: MAINTENANCE_TARGET, content: renderMaintenance() }
  ];
  let drift = 0;
  for (const target of targets) {
    const actual = fs.existsSync(target.file) ? fs.readFileSync(target.file, 'utf8') : null;
    if (check) {
      if (actual !== target.content) {
        console.error('生成物が正本と一致しません: ' + path.relative(process.cwd(), target.file));
        drift++;
      }
    } else {
      fs.mkdirSync(path.dirname(target.file), { recursive: true });
      fs.writeFileSync(target.file, target.content);
      console.log('generated ' + path.relative(process.cwd(), target.file));
    }
  }
  if (check && drift) {
    console.error('`npm run build` を実行して生成物をコミットしてください。');
    return 1;
  }
  if (check) console.log('生成物は正本と一致しています。');
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = {
  render, renderFrontend, renderFrontendI18n, renderAdmin, renderMaintenance,
  TARGET, FRONTEND_TARGET, FRONTEND_I18N_TARGET, ADMIN_TARGET, MAINTENANCE_TARGET,
  SCHEMA_PATH, CONFIG_PATH, CORE_PATH, AGGREGATE_PATH, MAINTENANCE_CORE_PATH, RETENTION_PATH
};
