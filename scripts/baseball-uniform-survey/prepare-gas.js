#!/usr/bin/env node
'use strict';

// Issue #380：名古屋野球ユニ部アンケート Public GAS のデプロイ用ステージング。
// 他の survey（fetish / costume portrait）の prepare スクリプト・allowlist・IDとは共有しない。
// 許可ファイルだけを flat なディレクトリへコピーし、clasp rootDir を "." にして push する。
const fs = require('fs');
const path = require('path');

const DIR = 'baseball/gas/baseball_uniform_survey/public';
const MANIFEST = 'appsscript.json';
const FILES = ['Config.gs', 'Log.gs', 'Main.gs', 'Notify.gs', 'Respondent.gs', 'SheetStore.gs', 'Setup.gs', 'Submission.gs', 'SurveyGenerated.gs', 'Validation.gs'];
// 承認が必要な権限。これ以外（外部通信・Drive等）は追加させない。
const REQUIRED_SCOPES = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/script.send_mail'];
// 初回に手動作成したGASプロジェクトに最初から入っている空のスタブ（Code.gs / コード.gs）は上書きしてよい。
const PLACEHOLDER_NAMES = new Set(['Code.js', 'Code.gs', 'コード.js', 'コード.gs']);
const PLACEHOLDER_BODY = /^\s*(function myFunction\(\)\s*\{\s*\}\s*)?$/;
const MANAGED_KEYS = ['timeZone', 'exceptionLogging', 'runtimeVersion', 'oauthScopes'];
const PRESERVED_KEYS = ['dependencies', 'webapp'];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// pull した名前（Main.js 等）を、リポジトリ上の名前（Main.gs）へ正規化する。
function normalizeRemoteName(name) {
  const nfc = name.normalize('NFC');
  return /\.js$/.test(nfc) ? nfc.replace(/\.js$/, '.gs') : nfc;
}

// リモートプロジェクトが「この survey の Public GAS、または初期状態の空プロジェクト」であることを確認する。
// 想定外のファイル（別surveyのファイル・手書きの追加コード・ディレクトリ）があれば上書きせず拒否する。
function validateRemote(remoteDir) {
  const expected = new Set(FILES);
  const names = fs.readdirSync(remoteDir).filter((n) => !n.startsWith('.'));
  if (!names.includes(MANIFEST)) throw new Error('Existing GAS manifest is missing.');
  const report = [];
  for (const name of names.sort()) {
    const full = path.join(remoteDir, name);
    const isFile = fs.statSync(full).isFile();
    let kind = 'unexpected';
    if (!isFile) kind = 'directory';
    else if (name === MANIFEST) kind = 'manifest';
    else if (expected.has(normalizeRemoteName(name))) kind = 'expected';
    else if (PLACEHOLDER_NAMES.has(name.normalize('NFC')) && PLACEHOLDER_BODY.test(fs.readFileSync(full, 'utf8'))) kind = 'placeholder';
    report.push({ name, kind });
  }
  if (report.some((r) => r.kind === 'unexpected' || r.kind === 'directory')) {
    throw new Error('Existing project is not the baseball uniform survey public GAS project (unexpected files); refusing to replace them.');
  }
  return report;
}

function validateRemoteManifest(manifest) {
  if (!isPlainObject(manifest)) throw new Error('Existing GAS manifest must be a JSON object.');
  const extra = Object.keys(manifest).filter((k) => !MANAGED_KEYS.includes(k) && !PRESERVED_KEYS.includes(k));
  if (extra.length) throw new Error('Existing GAS manifest has additional settings; review before overwriting.');
  return manifest;
}

// リポジトリのmanifestが管理するキーはリポジトリ側を正とし、dependencies / webapp はリモートの値をそのまま残す
// （公開範囲は CI で変更しない）。リポジトリ側は webapp を定義してはならない。
function stageManifest(repoManifest, remoteManifest) {
  if (!isPlainObject(repoManifest)) throw new Error('Repository manifest must be a JSON object.');
  const scopes = repoManifest.oauthScopes || [];
  for (const scope of REQUIRED_SCOPES) {
    if (!scopes.includes(scope)) throw new Error('Repository manifest is missing a required OAuth scope.');
  }
  if (scopes.some((scope) => !REQUIRED_SCOPES.includes(scope))) throw new Error('Repository manifest has an OAuth scope that is not allowed for this GAS bundle.');
  if (repoManifest.webapp !== undefined) throw new Error('The public manifest must not define the Web App settings.');
  const staged = JSON.parse(JSON.stringify(repoManifest));
  if (remoteManifest) {
    validateRemoteManifest(remoteManifest);
    for (const key of PRESERVED_KEYS) {
      if (Object.prototype.hasOwnProperty.call(remoteManifest, key)) staged[key] = JSON.parse(JSON.stringify(remoteManifest[key]));
    }
  }
  return staged;
}

function prepare(repoRoot, outputRoot, scriptId, remoteDir) {
  if (!scriptId || !scriptId.trim() || scriptId !== scriptId.trim() || /\s/.test(scriptId)) {
    throw new Error('A single valid Script ID is required.');
  }
  if (fs.existsSync(outputRoot) && fs.readdirSync(outputRoot).length) throw new Error('Deployment staging directory must be empty.');
  const source = path.join(repoRoot, DIR);
  // 配備対象ディレクトリに allowlist 外の .gs/.html が紛れていないこと（意図しないファイルの混入を防ぐ）。
  const present = fs.readdirSync(source).filter((n) => /\.(gs|html)$/.test(n)).sort();
  if (JSON.stringify(present) !== JSON.stringify([...FILES].sort())) {
    throw new Error('Unexpected or missing source files for the baseball uniform survey GAS bundle.');
  }
  let remoteManifest;
  if (remoteDir) {
    validateRemote(remoteDir);
    remoteManifest = JSON.parse(fs.readFileSync(path.join(remoteDir, MANIFEST), 'utf8'));
  }
  fs.mkdirSync(outputRoot, { recursive: true });
  for (const name of FILES) fs.copyFileSync(path.join(source, name), path.join(outputRoot, name));
  const repoManifest = JSON.parse(fs.readFileSync(path.join(source, MANIFEST), 'utf8'));
  fs.writeFileSync(path.join(outputRoot, MANIFEST), JSON.stringify(stageManifest(repoManifest, remoteManifest), null, 2) + '\n');
  fs.writeFileSync(path.join(outputRoot, '.clasp.json'), JSON.stringify({ scriptId, rootDir: '.' }) + '\n', { mode: 0o600 });
  return [...FILES, MANIFEST];
}

if (require.main === module) {
  try {
    const [mode, a, b, c] = process.argv.slice(2);
    if (mode === 'validate-remote') {
      // validate-remote <remoteDir>
      const report = validateRemote(a);
      console.log(`Existing GAS files after clasp pull (${report.length}):`);
      for (const r of report) console.log('  ' + JSON.stringify(r.name) + ' kind=' + r.kind);
      validateRemoteManifest(JSON.parse(fs.readFileSync(path.join(a, MANIFEST), 'utf8')));
    } else if (mode === 'stage') {
      // stage <repoRoot> <outputRoot> [remoteDir]   (Script ID は環境変数 BASEBALL_UNIFORM_SURVEY_SCRIPT_ID)
      const files = prepare(a, b, process.env.BASEBALL_UNIFORM_SURVEY_SCRIPT_ID, c);
      console.log(`Prepared ${files.length} GAS files (including the manifest).`);
    } else {
      throw new Error('Usage: prepare-gas.js validate-remote <remoteDir> | stage <repoRoot> <outputRoot> [remoteDir]');
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { prepare, validateRemote, validateRemoteManifest, stageManifest, normalizeRemoteName, FILES, REQUIRED_SCOPES, MANIFEST, DIR };
