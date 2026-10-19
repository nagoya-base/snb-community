#!/usr/bin/env node
'use strict';

// Issue #380 / #390：名古屋野球ユニ部アンケート Public / Admin / maintenance GAS のデプロイ用ステージング。
// 他の survey（fetish / costume portrait）の prepare スクリプト・allowlist・IDとは共有しない。
// target（public / admin / maintenance）ごとに専用の allowlist・OAuth scope・Script ID 環境変数を持ち、
// 別 target のファイルを push できない（push 前に clasp pull したリモートも target の allowlist で検証する）。
// 許可ファイルだけを flat なディレクトリへコピーし、clasp rootDir を "." にして push する。
const fs = require('fs');
const path = require('path');

const BASE = 'baseball/gas/baseball_uniform_survey';
const MANIFEST = 'appsscript.json';
// Web App を本人のみに閉じる target（個票・自由記述を扱う）。manifest の webapp はリポジトリ側を正とし、これ以外を拒否する。
const OWNER_ONLY_WEBAPP = { executeAs: 'USER_DEPLOYING', access: 'MYSELF' };
const TARGETS = {
  public: {
    dir: BASE + '/public',
    files: ['Config.gs', 'Log.gs', 'Main.gs', 'Notify.gs', 'Respondent.gs', 'SheetStore.gs', 'Setup.gs', 'Submission.gs', 'SurveyGenerated.gs', 'Validation.gs'],
    // 承認が必要な権限。これ以外（外部通信・Drive等）は追加させない。
    requiredScopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/script.send_mail'],
    // Public の webapp はリモート（初回手動 deploy）の値を残し、CI では変更しない。
    ownerOnly: false,
    scriptIdEnv: 'BASEBALL_UNIFORM_SURVEY_SCRIPT_ID',
    deploymentIdEnv: 'BASEBALL_UNIFORM_SURVEY_DEPLOYMENT_ID'
  },
  admin: {
    dir: BASE + '/admin',
    files: ['Config.gs', 'Dashboard.html', 'Data.gs', 'FreeText.gs', 'Main.gs', 'Snapshot.gs', 'SurveyGenerated.gs'],
    // Admin は read-only。書込み scope は持たない。
    requiredScopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    ownerOnly: true,
    scriptIdEnv: 'BASEBALL_UNIFORM_SURVEY_ADMIN_SCRIPT_ID',
    deploymentIdEnv: 'BASEBALL_UNIFORM_SURVEY_ADMIN_DEPLOYMENT_ID',
    // 初回 bootstrap（clasp push のみ）専用。通常 deploy 用の Script ID / Deployment ID とは別の Environment Secret。
    bootstrapScriptIdEnv: 'BASEBALL_UNIFORM_SURVEY_ADMIN_BOOTSTRAP_SCRIPT_ID'
  },
  maintenance: {
    dir: BASE + '/maintenance',
    files: ['Cleanup.gs', 'Config.gs', 'Data.gs', 'Finalize.gs', 'Main.gs', 'Maintenance.html', 'Retention.gs', 'SurveyGenerated.gs'],
    // 書込み権限が必要な scope はこの project だけが持つ。
    requiredScopes: ['https://www.googleapis.com/auth/spreadsheets'],
    ownerOnly: true,
    scriptIdEnv: 'BASEBALL_UNIFORM_SURVEY_MAINTENANCE_SCRIPT_ID',
    deploymentIdEnv: 'BASEBALL_UNIFORM_SURVEY_MAINTENANCE_DEPLOYMENT_ID',
    bootstrapScriptIdEnv: 'BASEBALL_UNIFORM_SURVEY_MAINTENANCE_BOOTSTRAP_SCRIPT_ID'
  }
};
// 初回に手動作成したGASプロジェクトに最初から入っている空のスタブ（Code.gs / コード.gs）は上書きしてよい。
const PLACEHOLDER_NAMES = new Set(['Code.js', 'Code.gs', 'コード.js', 'コード.gs']);
const PLACEHOLDER_BODY = /^\s*(function myFunction\(\)\s*\{\s*\}\s*)?$/;
const MANAGED_KEYS = ['timeZone', 'exceptionLogging', 'runtimeVersion', 'oauthScopes'];
const PRESERVED_KEYS = ['dependencies', 'webapp'];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function targetConfig(target) {
  if (!Object.prototype.hasOwnProperty.call(TARGETS, target)) throw new Error('Unknown target: expected "public", "admin" or "maintenance".');
  return TARGETS[target];
}

// pull した名前（Main.js 等）を、リポジトリ上の名前（Main.gs）へ正規化する。
function normalizeRemoteName(name) {
  const nfc = name.normalize('NFC');
  return /\.js$/.test(nfc) ? nfc.replace(/\.js$/, '.gs') : nfc;
}

// リモートプロジェクトが「この target の GAS、または初期状態の空プロジェクト」であることを確認する。
// 想定外のファイル（別surveyのファイル・手書きの追加コード・ディレクトリ）があれば上書きせず拒否する。
function validateRemote(target, remoteDir) {
  const cfg = targetConfig(target);
  const expected = new Set(cfg.files);
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
    throw new Error(`Existing project is not the baseball uniform survey ${target} GAS project (unexpected files); refusing to replace them.`);
  }
  return report;
}

// 初回 bootstrap 用：リモートが「空の初期 project」（placeholder のみ）であることを確認する。
// 既に target のファイルがある（= bootstrap 済み）場合は拒否し、再実行で上書きさせない。Web App 設定が公開側になっていても拒否する。
function validateBootstrapRemote(target, remoteDir) {
  const cfg = targetConfig(target);
  if (!cfg.bootstrapScriptIdEnv) throw new Error(`The ${target} GAS project has no bootstrap workflow.`);
  const report = validateRemote(target, remoteDir);
  if (report.some((r) => r.kind === 'expected')) {
    throw new Error(`The ${target} GAS project already has deployed files (already bootstrapped); use the regular deploy workflow.`);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(remoteDir, MANIFEST), 'utf8'));
  if (!isPlainObject(manifest)) throw new Error('Existing GAS manifest must be a JSON object.');
  const extra = Object.keys(manifest).filter((k) => !MANAGED_KEYS.includes(k) && !PRESERVED_KEYS.includes(k));
  if (extra.length) throw new Error('Existing GAS manifest has additional settings; review before overwriting.');
  if (manifest.webapp !== undefined && !isOwnerOnlyWebapp(manifest.webapp)) {
    throw new Error(`Existing ${target} Web App is not executeAs USER_DEPLOYING and access MYSELF; refusing to bootstrap.`);
  }
  return manifest;
}

function isOwnerOnlyWebapp(webapp) {
  return isPlainObject(webapp) && webapp.executeAs === OWNER_ONLY_WEBAPP.executeAs && webapp.access === OWNER_ONLY_WEBAPP.access;
}

function validateRemoteManifest(target, manifest) {
  const cfg = targetConfig(target);
  if (!isPlainObject(manifest)) throw new Error('Existing GAS manifest must be a JSON object.');
  const extra = Object.keys(manifest).filter((k) => !MANAGED_KEYS.includes(k) && !PRESERVED_KEYS.includes(k));
  if (extra.length) throw new Error('Existing GAS manifest has additional settings; review before overwriting.');
  // Admin / maintenance は bootstrap で MYSELF / USER_DEPLOYING の Web App を作成済みであること。それ以外（未定義・公開設定）は配備しない。
  if (cfg.ownerOnly && !isOwnerOnlyWebapp(manifest.webapp)) {
    throw new Error(`Existing ${target} Web App must be executeAs USER_DEPLOYING and access MYSELF; refusing to deploy.`);
  }
  return manifest;
}

// リポジトリのmanifestが管理するキーはリポジトリ側を正とし、dependencies はリモートの値をそのまま残す。
// Public の webapp はリモートの値を残す（公開範囲は CI で変更しない）。リポジトリ側は webapp を定義してはならない。
// Admin / maintenance の webapp はリポジトリ側（MYSELF / USER_DEPLOYING）を正とし、scope は required と完全一致のみ許可する。
// bootstrapRemote（初回 push 時のリモート manifest。検証は validateBootstrapRemote 済み）からは dependencies だけを引き継ぐ。
function stageManifest(target, repoManifest, remoteManifest, bootstrapRemote) {
  const cfg = targetConfig(target);
  if (!isPlainObject(repoManifest)) throw new Error('Repository manifest must be a JSON object.');
  const scopes = repoManifest.oauthScopes || [];
  for (const scope of cfg.requiredScopes) {
    if (!scopes.includes(scope)) throw new Error('Repository manifest is missing a required OAuth scope.');
  }
  if (scopes.some((scope) => !cfg.requiredScopes.includes(scope))) throw new Error(`Repository manifest has an OAuth scope that is not allowed for the ${target} GAS bundle.`);
  if (cfg.ownerOnly) {
    if (!isOwnerOnlyWebapp(repoManifest.webapp)) throw new Error(`The ${target} manifest must define the Web App as executeAs USER_DEPLOYING and access MYSELF.`);
  } else if (repoManifest.webapp !== undefined) {
    throw new Error('The public manifest must not define Web App settings.');
  }
  const staged = JSON.parse(JSON.stringify(repoManifest));
  if (remoteManifest) {
    validateRemoteManifest(target, remoteManifest);
    for (const key of PRESERVED_KEYS) {
      if (key === 'webapp' && cfg.ownerOnly) continue;
      if (Object.prototype.hasOwnProperty.call(remoteManifest, key)) staged[key] = JSON.parse(JSON.stringify(remoteManifest[key]));
    }
  }
  if (bootstrapRemote && Object.prototype.hasOwnProperty.call(bootstrapRemote, 'dependencies')) staged.dependencies = JSON.parse(JSON.stringify(bootstrapRemote.dependencies));
  return staged;
}

function prepare(target, repoRoot, outputRoot, scriptId, remoteDir, options) {
  const bootstrap = Boolean(options && options.bootstrap);
  const cfg = targetConfig(target);
  if (!scriptId || !scriptId.trim() || scriptId !== scriptId.trim() || /\s/.test(scriptId)) {
    throw new Error('A single valid Script ID is required.');
  }
  if (fs.existsSync(outputRoot) && fs.readdirSync(outputRoot).length) throw new Error('Deployment staging directory must be empty.');
  const source = path.join(repoRoot, cfg.dir);
  // 配備対象ディレクトリに allowlist 外の .gs/.html が紛れていないこと（意図しないファイルの混入を防ぐ）。
  const present = fs.readdirSync(source).filter((n) => /\.(gs|html)$/.test(n)).sort();
  if (JSON.stringify(present) !== JSON.stringify([...cfg.files].sort())) {
    throw new Error(`Unexpected or missing source files for the baseball uniform survey ${target} GAS bundle.`);
  }
  let remoteManifest;
  if (remoteDir && bootstrap) {
    remoteManifest = validateBootstrapRemote(target, remoteDir);
  } else if (remoteDir) {
    validateRemote(target, remoteDir);
    remoteManifest = JSON.parse(fs.readFileSync(path.join(remoteDir, MANIFEST), 'utf8'));
  }
  if (bootstrap && !remoteDir) throw new Error('Bootstrap staging requires the pulled remote directory.');
  fs.mkdirSync(outputRoot, { recursive: true });
  for (const name of cfg.files) fs.copyFileSync(path.join(source, name), path.join(outputRoot, name));
  const repoManifest = JSON.parse(fs.readFileSync(path.join(source, MANIFEST), 'utf8'));
  fs.writeFileSync(path.join(outputRoot, MANIFEST), JSON.stringify(stageManifest(target, repoManifest, bootstrap ? null : remoteManifest, bootstrap ? remoteManifest : null), null, 2) + '\n');
  fs.writeFileSync(path.join(outputRoot, '.clasp.json'), JSON.stringify({ scriptId, rootDir: '.' }) + '\n', { mode: 0o600 });
  return [...cfg.files, MANIFEST];
}

if (require.main === module) {
  try {
    const [mode, target, a, b, c] = process.argv.slice(2);
    if (mode === 'validate-remote') {
      // validate-remote <target> <remoteDir>
      const report = validateRemote(target, a);
      console.log(`Existing ${target} GAS files after clasp pull (${report.length}):`);
      for (const r of report) console.log('  ' + JSON.stringify(r.name) + ' kind=' + r.kind);
      validateRemoteManifest(target, JSON.parse(fs.readFileSync(path.join(a, MANIFEST), 'utf8')));
    } else if (mode === 'validate-bootstrap-remote') {
      // validate-bootstrap-remote <admin|maintenance> <remoteDir>
      validateBootstrapRemote(target, a);
      console.log(`Existing ${target} GAS project is an empty initial project.`);
    } else if (mode === 'stage-bootstrap') {
      // stage-bootstrap <admin|maintenance> <repoRoot> <outputRoot> <remoteDir>   (Script ID は bootstrapScriptIdEnv)
      const cfg = targetConfig(target);
      if (!cfg.bootstrapScriptIdEnv) throw new Error(`The ${target} GAS project has no bootstrap workflow.`);
      const files = prepare(target, a, b, process.env[cfg.bootstrapScriptIdEnv], c, { bootstrap: true });
      console.log(`Prepared ${files.length} ${target} GAS files for the initial bootstrap push (including the manifest).`);
    } else if (mode === 'stage') {
      // stage <target> <repoRoot> <outputRoot> [remoteDir]   (Script ID は target 専用の環境変数 TARGETS[target].scriptIdEnv)
      const files = prepare(target, a, b, process.env[targetConfig(target).scriptIdEnv], c);
      console.log(`Prepared ${files.length} ${target} GAS files (including the manifest).`);
    } else {
      throw new Error('Usage: prepare-gas.js validate-remote <public|admin|maintenance> <remoteDir> | stage <public|admin|maintenance> <repoRoot> <outputRoot> [remoteDir] | validate-bootstrap-remote <admin|maintenance> <remoteDir> | stage-bootstrap <admin|maintenance> <repoRoot> <outputRoot> <remoteDir>');
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { prepare, validateRemote, validateBootstrapRemote, validateRemoteManifest, stageManifest, normalizeRemoteName, targetConfig, TARGETS, OWNER_ONLY_WEBAPP, MANIFEST, BASE };
