'use strict';

// Issue #319：tools/build-static-results-data.js のCLIスモークテスト。
// 実際の本番GASを叩かず、固定のpayloadファイルを --input に渡して、
// 書き出されるJSONの形（status/finalizedAt/surveyPeriod/results）と、
// 検証失敗時にファイルを書き出さずエラー終了することだけを確認する。

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const CLI_PATH = path.join(__dirname, '..', 'tools', 'build-static-results-data.js');

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failures++;
  } else {
    console.log('OK:', msg);
  }
}

function tmpFile(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'snbc-survey-results-')), name);
}

const validReadyPayload = {
  total: 30,
  generatedAt: new Date().toISOString(),
  ready: true,
  categories: [{ name: '野球ユニフォーム', count: 12, percent: 40 }],
  primaryInterestCategory: [{ name: '野球ユニフォーム', count: 12, percent: 40 }],
  engagement: [{ name: '自分で着たい', count: 10, percent: 33.3 }],
  region: [{ name: '関東', count: 10, percent: 33.3 }],
  age: [{ name: '20代以下', count: 10, percent: 33.3 }],
  snbcAwareness: { targetCount: 5, items: [{ name: '知っている', count: 3, percent: 60 }] },
  snbcInterest: { targetCount: 5, items: [{ name: 'はい', count: 2, percent: 40 }] }
};

/* ── 正常系：--status final で妥当なペイロードを渡すと、想定どおりの構造で書き出される ── */
{
  const inputPath = tmpFile('input.json');
  const outputPath = tmpFile('output.json');
  fs.writeFileSync(inputPath, JSON.stringify(validReadyPayload));

  execFileSync('node', [CLI_PATH, '--input', inputPath, '--output', outputPath, '--status', 'final',
    '--finalized-at', '2026-10-01T00:00:00+09:00', '--survey-start', '2026-08-01T00:00:00+09:00'
  ]);

  const written = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  assert(written.status === 'final', 'written file has status="final"');
  assert(written.finalizedAt === '2026-10-01T00:00:00+09:00', 'written file keeps the given --finalized-at, got ' + written.finalizedAt);
  assert(written.surveyPeriod.start === '2026-08-01T00:00:00+09:00', 'written file keeps the given --survey-start');
  assert(written.surveyPeriod.end === '2026-09-30T23:59:59+09:00', 'written file defaults --survey-end to the announced 9/30 23:59 JST deadline');
  assert(JSON.stringify(written.results) === JSON.stringify(validReadyPayload), 'written file embeds the input payload verbatim under results (no re-computation)');
}

/* ── 異常系：allowlist違反のペイロード（respondentHash混入）は書き出さずエラー終了する ── */
{
  const inputPath = tmpFile('input.json');
  const outputPath = tmpFile('output.json');
  fs.writeFileSync(inputPath, JSON.stringify(Object.assign({}, validReadyPayload, { respondentHash: 'abc' })));

  let threw = false;
  try {
    execFileSync('node', [CLI_PATH, '--input', inputPath, '--output', outputPath, '--status', 'final'], { stdio: 'pipe' });
  } catch (err) {
    threw = true;
  }
  assert(threw, 'CLI exits with a non-zero status when the payload fails validation');
  assert(!fs.existsSync(outputPath), 'CLI does not write the output file when validation fails (no accidental publish of unvalidated data)');
}

/* ── 異常系：--status final なのに ready:false のペイロードは「最終結果」として書き出させない ── */
{
  const inputPath = tmpFile('input.json');
  const outputPath = tmpFile('output.json');
  fs.writeFileSync(inputPath, JSON.stringify({ total: 4, generatedAt: new Date().toISOString(), ready: false }));

  let threw = false;
  try {
    execFileSync('node', [CLI_PATH, '--input', inputPath, '--output', outputPath, '--status', 'final'], { stdio: 'pipe' });
  } catch (err) {
    threw = true;
  }
  assert(threw, '--status final with ready:false input is rejected (Issue #319: never publish unconfirmed values as final results)');
  assert(!fs.existsSync(outputPath), 'CLI does not write the output file in that case');
}

/* ── 正常系：--status pending なら ready:false のプレースホルダーも書き出せる ── */
{
  const inputPath = tmpFile('input.json');
  const outputPath = tmpFile('output.json');
  fs.writeFileSync(inputPath, JSON.stringify({ total: 4, generatedAt: new Date().toISOString(), ready: false }));

  execFileSync('node', [CLI_PATH, '--input', inputPath, '--output', outputPath, '--status', 'pending']);
  const written = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  assert(written.status === 'pending', 'pending placeholder is written with status="pending"');
  assert(written.finalizedAt === null, 'pending placeholder has finalizedAt=null');
}

if (failures > 0) {
  console.error('\n' + failures + ' failure(s) in test_build_static_results_data_cli.js');
  process.exitCode = 1;
} else {
  console.log('\ntest_build_static_results_data_cli.js: all checks passed');
}
