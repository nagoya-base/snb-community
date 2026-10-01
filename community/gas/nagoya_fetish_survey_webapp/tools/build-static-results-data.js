#!/usr/bin/env node
'use strict';

/**
 * Issue #319：9/30 23:59 JST締切・最終データ確定後に、公開GASの集計結果を
 * `community/fetish-survey-results.html` が読む静的JSON（`community/fetish-survey-results.data.json`）
 * へ書き出すためのメンテナ用スクリプト。
 *
 * 想定フロー（本番反映は別途・このスクリプト自体はリポジトリへの書き込みのみ行う）：
 *   1. 締切後、本番の公開GASデプロイへ curl 等で以下を取得する
 *        curl "https://script.google.com/macros/s/<DEPLOY_ID>/exec?view=results&format=json" -o /tmp/public-results.json
 *      （ブラウザから直接叩かない。既存の`getPublicResults()`をそのままJSON化するだけの
 *      エンドポイントで、独自の再計算は行わない＝既存の集計処理を再利用する設計。）
 *   2. このスクリプトで検証・整形し、静的JSONを書き出す
 *        node build-static-results-data.js --input /tmp/public-results.json --status final
 *   3. `community/fetish-survey-results.data.json`の差分をレビューし、PRに含める。
 *
 * 検証は validate-public-results-payload.js（allowlist方式）に委譲する。ここを通らない
 * 入力（未知のキー＝個人識別情報混入の疑いを含む）は書き出さずにエラー終了する。
 */

const fs = require('fs');
const path = require('path');
const { validatePublicResultsPayload } = require('./validate-public-results-payload');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const DEFAULT_OUTPUT = path.join(REPO_ROOT, 'community', 'fetish-survey-results.data.json');

function parseArgs(argv) {
  const args = { status: 'final', output: DEFAULT_OUTPUT };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input') args.input = argv[++i];
    else if (arg === '--output') args.output = argv[++i];
    else if (arg === '--status') args.status = argv[++i];
    else if (arg === '--finalized-at') args.finalizedAt = argv[++i];
    else if (arg === '--survey-start') args.surveyStart = argv[++i];
    else if (arg === '--survey-end') args.surveyEnd = argv[++i];
    else throw new Error('未知の引数です: ' + arg);
  }
  return args;
}

function readInput(inputPath) {
  const raw = inputPath ? fs.readFileSync(inputPath, 'utf8') : fs.readFileSync(0, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error('入力がJSONとして解析できませんでした: ' + err.message);
  }
  return parsed;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.status !== 'final' && args.status !== 'pending') {
    throw new Error('--status は final または pending のみ指定できます');
  }

  const payload = readInput(args.input);
  const validation = validatePublicResultsPayload(payload);
  if (!validation.ok) {
    console.error('静的公開データの検証に失敗しました。個人識別情報や想定外のキーが混入していないか確認してください:');
    validation.errors.forEach((e) => console.error('  - ' + e));
    process.exitCode = 1;
    return;
  }

  if (args.status === 'final' && payload.ready !== true) {
    console.error('--status final は payload.ready === true（総回答数が公開基準に達している）のときのみ指定できます。' +
      '未確定・非公開状態のデータを最終結果として公開しないでください（Issue #319）。');
    process.exitCode = 1;
    return;
  }

  const out = {
    status: args.status,
    finalizedAt: args.status === 'final' ? (args.finalizedAt || new Date().toISOString()) : null,
    surveyPeriod: {
      start: args.surveyStart || null,
      end: args.surveyEnd || '2026-09-30T23:59:59+09:00'
    },
    results: payload
  };

  fs.writeFileSync(args.output, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log('書き出しました: ' + args.output + '（status=' + args.status + '）');
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}

module.exports = { parseArgs, readInput };
