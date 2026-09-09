'use strict';

// Issue #298の要件のうち、Code.gsの中身を読み込んで動的に検証するのが難しい構造的な要件
// （読み取り専用であること／公開プロジェクトから独立していること）を、ソースコードの
// 静的な文字列検査で確認する。

const fs = require('fs');
const path = require('path');

const ADMIN_DIR = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'nagoya_fetish_survey_webapp');

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failures++;
  } else {
    console.log('OK:', msg);
  }
}

/* ══════════════════════════════════════════════════════════════
 * 管理プロジェクトが独立ディレクトリであること
 * ══════════════════════════════════════════════════════════════ */
assert(path.resolve(ADMIN_DIR) !== path.resolve(PUBLIC_DIR), 'admin project directory is different from the public project directory');
assert(fs.existsSync(path.join(ADMIN_DIR, 'Code.gs')), 'admin project has its own Code.gs');
assert(fs.existsSync(path.join(PUBLIC_DIR, 'Code.gs')), 'public project has its own Code.gs (sanity check)');

const adminCode = fs.readFileSync(path.join(ADMIN_DIR, 'Code.gs'), 'utf8');
const publicCode = fs.readFileSync(path.join(PUBLIC_DIR, 'Code.gs'), 'utf8');

/* ══════════════════════════════════════════════════════════════
 * 管理プロジェクトが読み取り専用であること（responsesシートへの書き込みが一切ない）
 * ══════════════════════════════════════════════════════════════ */
const writeOperationPatterns = [
  /\.appendRow\s*\(/, /\.setValue\s*\(/, /\.setValues\s*\(/, /\.setFormula\s*\(/, /\.setFormulas\s*\(/,
  /\.deleteRow\s*\(/, /\.deleteRows\s*\(/, /\.deleteColumn\s*\(/, /\.clear\s*\(/, /\.clearContent\s*\(/,
  /\.insertSheet\s*\(/, /\.deleteSheet\s*\(/, /\.insertRow\s*\(/, /\.setFrozenRows\s*\(/
];
writeOperationPatterns.forEach((pattern) => {
  assert(!pattern.test(adminCode), 'admin Code.gs contains no ' + pattern + ' (read-only requirement)');
});

/* ══════════════════════════════════════════════════════════════
 * 公開プロジェクトから管理関連コードを参照していないこと
 * ══════════════════════════════════════════════════════════════ */
const forbiddenInPublicProject = [
  { pattern: /getAdminResults/, label: 'getAdminResults' },
  { pattern: /getAdminDashboardData/, label: 'getAdminDashboardData' },
  { pattern: /['"]admin['"]/i, label: "the literal string 'admin'" },
  { pattern: /createTemplateFromFile\(\s*['"]Admin/i, label: "createTemplateFromFile('Admin...')" },
  { pattern: /createTemplateFromFile\(\s*['"]Dashboard/i, label: "createTemplateFromFile('Dashboard...')" },
  { pattern: /ADMIN_SECRET|ADMIN_TOKEN|adminToken|secretToken/i, label: 'a secret-token based admin auth constant' }
];
forbiddenInPublicProject.forEach(({ pattern, label }) => {
  assert(!pattern.test(publicCode), 'public project Code.gs does not reference ' + label);
});

// 公開プロジェクトのHTMLファイルにも管理画面用ファイルが存在しないこと。
['Admin.html', 'Dashboard.html', 'DashboardScript.html', 'DashboardStyles.html'].forEach((filename) => {
  assert(!fs.existsSync(path.join(PUBLIC_DIR, filename)), 'public project does not contain ' + filename);
});

// 管理プロジェクトのファイルが公開プロジェクトのディレクトリに漏れ出していないこと。
['Code.gs', 'Dashboard.html', 'DashboardStyles.html', 'DashboardScript.html'].forEach((filename) => {
  assert(fs.existsSync(path.join(ADMIN_DIR, filename)), 'admin project contains its own ' + filename);
});

if (failures > 0) {
  console.error('\n' + failures + ' failure(s) in test_read_only_and_isolation.js');
  process.exitCode = 1;
} else {
  console.log('\ntest_read_only_and_isolation.js: all checks passed');
}
