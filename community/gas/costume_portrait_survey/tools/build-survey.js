#!/usr/bin/env node
'use strict';

// survey.schema.json（正本）+ src/survey-core.js から Frontend / Public GAS / Admin GAS 用の
// 生成物を作る。`--check` は生成物との差分を検出して非0終了する（CIで実行）。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCHEMA_PATH = path.join(ROOT, 'survey.schema.json');
const CORE_PATH = path.join(ROOT, 'src', 'survey-core.js');

const TARGETS = [
  { file: path.join(ROOT, 'public', 'SurveyGenerated.gs'), label: 'Public GAS' },
  { file: path.join(ROOT, 'admin', 'SurveyGenerated.gs'), label: 'Admin GAS' },
  { file: path.join(ROOT, '..', '..', 'costume-portrait-survey', 'survey.generated.js'), label: 'Frontend' }
];

function render(label) {
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const core = fs.readFileSync(CORE_PATH, 'utf8');
  return [
    '/*',
    ' * AUTO-GENERATED (' + label + ') — DO NOT EDIT.',
    ' * 正本: community/gas/costume_portrait_survey/survey.schema.json と src/survey-core.js',
    ' * 再生成: (community/gas/costume_portrait_survey で) npm run build',
    ' * CIは `npm run build:check` で生成物との差分を検出する。',
    ' */',
    'var SURVEY_SCHEMA = ' + JSON.stringify(schema) + ';',
    '',
    core
  ].join('\n');
}

function main(argv) {
  const check = argv.includes('--check');
  let drift = 0;
  for (const target of TARGETS) {
    const expected = render(target.label);
    const actual = fs.existsSync(target.file) ? fs.readFileSync(target.file, 'utf8') : null;
    if (check) {
      if (actual !== expected) {
        console.error('生成物が正本と一致しません: ' + path.relative(process.cwd(), target.file));
        drift++;
      }
    } else {
      fs.mkdirSync(path.dirname(target.file), { recursive: true });
      fs.writeFileSync(target.file, expected);
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
module.exports = { render, TARGETS, SCHEMA_PATH, CORE_PATH };
