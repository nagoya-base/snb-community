#!/usr/bin/env node
'use strict';

// survey.schema.json（正本）+ survey.config.json（受付期間・最短回答時間・通知設定の正本）+ src/survey-core.js から
// Public GAS 用の生成物 public/SurveyGenerated.gs を作る。生成物は直接編集しない。
// `--check` は生成物との差分を検出して非0終了する（CIで実行）。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCHEMA_PATH = path.join(ROOT, 'survey.schema.json');
const CONFIG_PATH = path.join(ROOT, 'survey.config.json');
const CORE_PATH = path.join(ROOT, 'src', 'survey-core.js');
const TARGET = path.join(ROOT, 'public', 'SurveyGenerated.gs');

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
  const expected = render();
  const actual = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, 'utf8') : null;
  if (check) {
    if (actual !== expected) {
      console.error('生成物が正本と一致しません: ' + path.relative(process.cwd(), TARGET));
      console.error('`npm run build` を実行して生成物をコミットしてください。');
      return 1;
    }
    console.log('生成物は正本と一致しています。');
    return 0;
  }
  fs.mkdirSync(path.dirname(TARGET), { recursive: true });
  fs.writeFileSync(TARGET, expected);
  console.log('generated ' + path.relative(process.cwd(), TARGET));
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { render, TARGET, SCHEMA_PATH, CONFIG_PATH, CORE_PATH };
