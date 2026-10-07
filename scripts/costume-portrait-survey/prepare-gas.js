#!/usr/bin/env node
'use strict';

// Issue #334：衣装・ポートレート意識調査の Public / Admin GAS デプロイ用ステージング。
// 既存 fetish 用の prepare-snb-survey-*.js とは独立（allowlistもIDも共有しない）。
// 許可ファイルだけを flat なディレクトリへコピーし、clasp rootDir を "." にして push する。
const fs = require('fs');
const path = require('path');

const BASE = 'community/gas/costume_portrait_survey';
const MANIFEST = 'appsscript.json';
const TARGETS = {
  public: {
    dir: BASE + '/public',
    files: ['Config.gs', 'Finalize.gs', 'Log.gs', 'Main.gs', 'Notify.gs', 'Respondent.gs', 'Results.gs', 'Setup.gs',
      'SheetStore.gs', 'Submission.gs', 'SurveyGenerated.gs', 'Validation.gs'],
    // 承認が必要な権限。無いまま配備すると MailApp / Spreadsheet が実行時に失敗する。
    requiredScopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/script.send_mail']
  },
  admin: {
    dir: BASE + '/admin',
    files: ['Aggregate.gs', 'Dashboard.html', 'DashboardScript.html', 'DashboardStyles.html', 'Data.gs', 'Main.gs', 'SurveyGenerated.gs'],
    // 旧構成（ID token 認証）のファイル。既存プロジェクトに残っていてもよい（push で置き換わり削除される）。
    legacyFiles: ['Auth.gs', 'IdToken.gs'],
    requiredScopes: ['https://www.googleapis.com/auth/spreadsheets'],
    // SpreadsheetApp.openById() は spreadsheets scope が必須（readonly では実行時に権限不足。#358）。Admin のコードは読み取り専用（テストで静的検査）。
    // これ以外のscope（メール送信・外部通信など）は追加させない。
    allowedScopes: ['https://www.googleapis.com/auth/spreadsheets']
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
  if (!Object.prototype.hasOwnProperty.call(TARGETS, target)) throw new Error('Unknown target: expected "public" or "admin".');
  return TARGETS[target];
}

// pull した名前（Main.js 等）を、リポジトリ上の名前（Main.gs）へ正規化する。
function normalizeRemoteName(name) {
  const nfc = name.normalize('NFC');
  return /\.js$/.test(nfc) ? nfc.replace(/\.js$/, '.gs') : nfc;
}

// リモートプロジェクトが「このtargetのプロジェクト、または初期状態の空プロジェクト」であることを確認する。
// 想定外のファイル（別targetのファイル・手書きの追加コード・ディレクトリ）があれば上書きせず拒否する。
function validateRemote(target, remoteDir) {
  const cfg = targetConfig(target);
  const expected = new Set(cfg.files);
  const legacy = new Set(cfg.legacyFiles || []);
  const names = fs.readdirSync(remoteDir).filter((n) => !n.startsWith('.'));
  if (!names.includes(MANIFEST)) throw new Error('Existing GAS manifest is missing.');
  const report = [];
  for (const name of names.sort()) {
    const full = path.join(remoteDir, name);
    const isFile = fs.statSync(full).isFile();
    const normalized = normalizeRemoteName(name);
    let kind = 'unexpected';
    if (!isFile) kind = 'directory';
    else if (name === MANIFEST) kind = 'manifest';
    else if (expected.has(normalized)) kind = 'expected';
    else if (legacy.has(normalized)) kind = 'legacy';
    else if (PLACEHOLDER_NAMES.has(name.normalize('NFC')) && PLACEHOLDER_BODY.test(fs.readFileSync(full, 'utf8'))) kind = 'placeholder';
    report.push({ name, kind });
  }
  if (report.some((r) => r.kind === 'unexpected' || r.kind === 'directory')) {
    throw new Error(`Existing project is not the ${target} GAS project (unexpected files); refusing to replace them.`);
  }
  return report;
}

// Admin Web App（Issue #363）: OWNER 1名専用。アクセス制御は Web App 設定そのもの（MYSELF = デプロイ者本人のみ）で行い、
// 独自の認証コードは持たない。executeAs=USER_DEPLOYING のため Spreadsheet はデプロイ者のみが読み、他ユーザーへ共有しない。
const ADMIN_WEBAPP_ACCESS = 'MYSELF';
const ADMIN_WEBAPP_EXECUTE_AS = 'USER_DEPLOYING';
// 既存Adminは旧構成（GitHub Pages + ID token 認証）の ANYONE_ANONYMOUS（または以前の ANYONE / DOMAIN）からの移行を許す。未知の値は拒否。
const ADMIN_REMOTE_ACCESS = ['MYSELF', 'DOMAIN', 'ANYONE', 'ANYONE_ANONYMOUS'];

function validateRemoteManifest(target, manifest) {
  if (!isPlainObject(manifest)) throw new Error('Existing GAS manifest must be a JSON object.');
  const extra = Object.keys(manifest).filter((k) => !MANAGED_KEYS.includes(k) && !PRESERVED_KEYS.includes(k));
  if (extra.length) throw new Error('Existing GAS manifest has additional settings; review before overwriting.');
  if (target === 'admin' && manifest.webapp !== undefined) {
    if (!isPlainObject(manifest.webapp) || !ADMIN_REMOTE_ACCESS.includes(manifest.webapp.access)) {
      throw new Error('Existing admin Web App access is unknown; refusing to deploy.');
    }
  }
  return manifest;
}

// リポジトリのmanifestが管理するキーはリポジトリ側を正とし、dependencies等はリモートの値をそのまま残す。
// Public の webapp はリモートの値を残す（公開範囲はCIで変更しない）。
// Admin の webapp はリポジトリ側（access=MYSELF / executeAs=USER_DEPLOYING）を正とする。
function stageManifest(target, repoManifest, remoteManifest) {
  const cfg = targetConfig(target);
  if (!isPlainObject(repoManifest)) throw new Error('Repository manifest must be a JSON object.');
  for (const scope of cfg.requiredScopes) {
    if (!(repoManifest.oauthScopes || []).includes(scope)) throw new Error('Repository manifest is missing a required OAuth scope.');
  }
  if (cfg.allowedScopes && (repoManifest.oauthScopes || []).some((scope) => !cfg.allowedScopes.includes(scope))) {
    throw new Error('Repository manifest has an OAuth scope that is not allowed for the ' + target + ' GAS bundle.');
  }
  if (target === 'public' && repoManifest.webapp !== undefined) throw new Error('The public manifest must not define the Web App settings.');
  const staged = JSON.parse(JSON.stringify(repoManifest));
  if (remoteManifest) {
    validateRemoteManifest(target, remoteManifest);
    for (const key of PRESERVED_KEYS) {
      if (Object.prototype.hasOwnProperty.call(remoteManifest, key)) staged[key] = JSON.parse(JSON.stringify(remoteManifest[key]));
    }
  }
  if (target === 'admin') {
    staged.webapp = JSON.parse(JSON.stringify(repoManifest.webapp || {}));
    if (staged.webapp.access !== ADMIN_WEBAPP_ACCESS || staged.webapp.executeAs !== ADMIN_WEBAPP_EXECUTE_AS) {
      throw new Error('Admin Web App must be access "MYSELF" (owner only) and executeAs "USER_DEPLOYING".');
    }
  }
  return staged;
}

function prepare(target, repoRoot, outputRoot, scriptId, remoteDir) {
  const cfg = targetConfig(target);
  if (!scriptId || !scriptId.trim() || scriptId !== scriptId.trim() || /\s/.test(scriptId)) {
    throw new Error('A single valid Script ID is required.');
  }
  if (fs.existsSync(outputRoot) && fs.readdirSync(outputRoot).length) throw new Error('Deployment staging directory must be empty.');
  const source = path.join(repoRoot, cfg.dir);
  // 配備対象ディレクトリに allowlist 外の .gs/.html が紛れていないこと（意図しないファイルの混入を防ぐ）。
  const present = fs.readdirSync(source).filter((n) => /\.(gs|html)$/.test(n)).sort();
  if (JSON.stringify(present) !== JSON.stringify([...cfg.files].sort())) {
    throw new Error('Unexpected or missing source files for the ' + target + ' GAS bundle.');
  }
  let remoteManifest;
  if (remoteDir) {
    validateRemote(target, remoteDir);
    remoteManifest = JSON.parse(fs.readFileSync(path.join(remoteDir, MANIFEST), 'utf8'));
  }
  fs.mkdirSync(outputRoot, { recursive: true });
  for (const name of cfg.files) fs.copyFileSync(path.join(source, name), path.join(outputRoot, name));
  const repoManifest = JSON.parse(fs.readFileSync(path.join(source, MANIFEST), 'utf8'));
  fs.writeFileSync(path.join(outputRoot, MANIFEST), JSON.stringify(stageManifest(target, repoManifest, remoteManifest), null, 2) + '\n');
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
    } else if (mode === 'stage') {
      // stage <target> <repoRoot> <outputRoot> [remoteDir]   (SCRIPT ID は環境変数 COSTUME_PORTRAIT_SCRIPT_ID)
      const files = prepare(target, a, b, process.env.COSTUME_PORTRAIT_SCRIPT_ID, c);
      console.log(`Prepared ${files.length} ${target} GAS files (including the manifest).`);
    } else {
      throw new Error('Usage: prepare-gas.js validate-remote <public|admin> <remoteDir> | stage <public|admin> <repoRoot> <outputRoot> [remoteDir]');
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { ADMIN_WEBAPP_ACCESS, ADMIN_WEBAPP_EXECUTE_AS, prepare, validateRemote, validateRemoteManifest, stageManifest, normalizeRemoteName, TARGETS, MANIFEST, BASE };
