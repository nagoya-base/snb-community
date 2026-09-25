'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Issue #319：`/exec?view=results&format=json` の検証。
// 9/30締切後、メンテナがtools/build-static-results-data.jsで静的JSONを組み立てる際の
// 取得元となるエンドポイント。ブラウザから直接叩かれる想定ではないため、Results.html側の
// テスト（test_results_frontend.js）とは別に、doGet()のルーティングだけを検証する
// （getPublicResults()自体の集計ロジックはtest_backend.js側で既に検証済みのため、ここでは
// 「JSONエンドポイントがgetPublicResults()の戻り値をそのままJSONへシリアライズして返すだけで、
// 独自の再計算や値の加工を一切行わない」ことだけを確認する）。

const CODE_PATH = path.join(__dirname, '..', 'Code.gs');
const code = fs.readFileSync(CODE_PATH, 'utf8');

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failures++;
  } else {
    console.log('OK:', msg);
  }
}

function freshSandbox() {
  const sandbox = {
    console,
    PropertiesService: {},
    SpreadsheetApp: {},
    LockService: {},
    CacheService: {},
    Utilities: {
      computeDigest: () => [],
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      getUuid: () => 'x'
    },
    HtmlService: {
      createTemplateFromFile: () => ({
        evaluate: () => ({
          setTitle: function () { return this; },
          addMetaTag: function () { return this; },
          setXFrameOptionsMode: function () { return this; }
        })
      }),
      XFrameOptionsMode: { DEFAULT: 'DEFAULT' }
    },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput: (text) => ({
        _text: text,
        _mimeType: null,
        setMimeType: function (mime) { this._mimeType = mime; return this; }
      })
    },
    Logger: { log: () => {} }
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox;
}

const FAKE_PAYLOAD = {
  total: 42,
  generatedAt: '2026-10-01T00:00:00.000Z',
  ready: true,
  categories: [{ name: '野球ユニフォーム', count: 10, percent: 23.8 }]
};

/* ── view=results&format=json は getPublicResults() の戻り値をそのままJSONで返す ── */
{
  const sandbox = freshSandbox();
  sandbox.getPublicResults = () => FAKE_PAYLOAD;

  const output = sandbox.doGet({ parameter: { view: 'results', format: 'json' } });

  assert(output && output._mimeType === sandbox.ContentService.MimeType.JSON,
    'format=json response is created via ContentService.createTextOutput(...).setMimeType(JSON)');
  assert(JSON.parse(output._text).total === 42 && JSON.parse(output._text).categories[0].count === 10,
    'format=json response body is exactly JSON.stringify(getPublicResults()) with no field renaming/omission, got ' + output._text);
  assert(Object.keys(JSON.parse(output._text)).sort().join(',') === Object.keys(FAKE_PAYLOAD).sort().join(','),
    'format=json response introduces no extra top-level keys beyond what getPublicResults() already returns');
}

/* ── view=results（format無し）は従来どおりHTMLテンプレート（Results）を返す ── */
{
  const sandbox = freshSandbox();
  let calledWithFile = null;
  sandbox.HtmlService.createTemplateFromFile = (file) => {
    calledWithFile = file;
    return {
      evaluate: () => ({
        setTitle: function () { return this; },
        addMetaTag: function () { return this; },
        setXFrameOptionsMode: function () { return this; }
      })
    };
  };
  sandbox.getPublicResults = () => FAKE_PAYLOAD;

  sandbox.doGet({ parameter: { view: 'results' } });
  assert(calledWithFile === 'Results', 'view=results without format=json still renders the Results.html template (unaffected by the new JSON route)');
}

/* ── パラメータ無し（アンケートフォーム）は従来どおりIndexテンプレートを返す ── */
{
  const sandbox = freshSandbox();
  let calledWithFile = null;
  sandbox.HtmlService.createTemplateFromFile = (file) => {
    calledWithFile = file;
    return {
      evaluate: () => ({
        setTitle: function () { return this; },
        addMetaTag: function () { return this; },
        setXFrameOptionsMode: function () { return this; }
      })
    };
  };

  sandbox.doGet({ parameter: {} });
  assert(calledWithFile === 'Index', 'no view parameter still renders the survey form (Index.html), unaffected by the new JSON route');
}

if (failures > 0) {
  console.error('\n' + failures + ' failure(s) in test_json_export_endpoint.js');
  process.exitCode = 1;
} else {
  console.log('\ntest_json_export_endpoint.js: all checks passed');
}
