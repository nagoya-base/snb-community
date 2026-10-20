'use strict';
// 生成物（public/SurveyGenerated.gs）が schema + config + 専用core と一致し、直接編集されていないこと。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { render, TARGET } = require('../tools/build-public-gas');
const { loadPublic } = require('./helpers/gas-env');
const schema = require('../survey.schema.json');
const config = require('../survey.config.json');

test('生成物は survey.schema.json / survey.config.json / src/survey-core.js から再生成した内容と一致する', () => {
  assert.strictEqual(fs.readFileSync(TARGET, 'utf8'), render());
  assert.match(fs.readFileSync(TARGET, 'utf8'), /DO NOT EDIT/);
});

test('Public GAS が読み込む SURVEY_SCHEMA / SURVEY_CONFIG / SurveyCore は正本と同一', () => {
  const { ctx } = loadPublic({ committed: true });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.SURVEY_SCHEMA)), schema);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.SURVEY_CONFIG)), config);
  const core = require('../src/survey-core.js');
  assert.deepStrictEqual(Object.keys(ctx.SurveyCore).sort(), Object.keys(core).sort());
});

test('設問・option・branch条件・列名・modeをPublic GASへベタ書きしない', () => {
  const dir = path.join(__dirname, '..', 'public');
  const ids = new Set();
  schema.questions.forEach((q) => { ids.add(q.id); (q.options || []).forEach((o) => ids.add(o.id)); });
  const longIds = [...ids].filter((id) => id.length >= 8 && !['baseball', 'attended', 'overseas', 'ineligible' /* 応答statusと同名のoption IDがある */].includes(id));
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.gs') && f !== 'SurveyGenerated.gs')) {
    const code = fs.readFileSync(path.join(dir, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const id of longIds) assert.ok(!code.includes(`'${id}'`) && !code.includes(`"${id}"`), `${name} に設問/option ID '${id}' がベタ書きされている`);
    assert.ok(!/LIVE_TEST_ENABLED|SURVEY_CLOSES_AT|SURVEY_OPENS_AT/.test(code), `${name}: 旧surveyの設定名を持ち込まない`);
    assert.ok(!/completion_status\s*[:=]\s*'test'|'test'\s*\?\s*'test'/.test(code), `${name}: 旧 completion_status='test' を使わない`);
    assert.ok(!/sanitizeAnswers/.test(code), `${name}: server は sanitize しない`);
  }
});
