#!/usr/bin/env node
'use strict';

// 回答 0 件の初期 snapshot（全項目 非公開）を baseball/baseball-uniform-survey-results/snapshot.json に書く。
// 実運用の snapshot は Admin GAS が生成して置き換える。このスクリプトは Spreadsheet・実データに一切触れない。
// 既に snapshot.json がある場合は上書きしない（--force で上書き）。
const fs = require('fs');
const path = require('path');
const aggregate = require('../src/survey-aggregate.js');

const ROOT = path.join(__dirname, '..');
const SCHEMA_PATH = path.join(ROOT, 'survey.schema.json');
const SNAPSHOT_PATH = path.join(ROOT, '..', '..', 'baseball-uniform-survey-results', 'snapshot.json');

function renderInitial(generatedAt) {
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  return JSON.stringify(aggregate.buildSnapshot(schema, [], { generatedAt }), null, 2) + '\n';
}

if (require.main === module) {
  if (fs.existsSync(SNAPSHOT_PATH) && !process.argv.includes('--force')) {
    console.error('snapshot.json は既にあります（上書きは --force）。');
    process.exitCode = 1;
  } else {
    fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
    fs.writeFileSync(SNAPSHOT_PATH, renderInitial(new Date()));
    console.log('wrote ' + path.relative(process.cwd(), SNAPSHOT_PATH));
  }
}
module.exports = { renderInitial, SNAPSHOT_PATH };
