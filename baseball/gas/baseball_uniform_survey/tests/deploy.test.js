'use strict';
// Public GAS のデプロイ構成（Issue #380）。実Googleへは接続しない。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
const prepareGas = require(path.join(REPO, 'scripts', 'baseball-uniform-survey', 'prepare-gas.js'));
const workflow = read('.github/workflows/baseball-uniform-survey-public-gas.yml');
const deploySh = read('scripts/baseball-uniform-survey/deploy-gas.sh');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bus-deploy-'));

function job(text, name) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l === `  ${name}:`);
  assert.ok(start >= 0, name);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^ {2}[a-z_-]+:/.test(lines[i])) { end = i; break; }
  return lines.slice(start, end).join('\n');
}

test('配備対象ファイルは public/ の .gs と完全一致し、他survey/テスト/schemaの正本を含まない', () => {
  const present = fs.readdirSync(path.join(REPO, prepareGas.DIR)).filter((n) => /\.(gs|html)$/.test(n)).sort();
  assert.deepStrictEqual(present, [...prepareGas.FILES].sort());
  const out = path.join(tmp(), 'out');
  const files = prepareGas.prepare(REPO, out, 'script-id');
  assert.deepStrictEqual(fs.readdirSync(out).filter((n) => !n.startsWith('.')).sort(), [...files].sort());
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(out, '.clasp.json'), 'utf8')), { scriptId: 'script-id', rootDir: '.' });
  assert.throws(() => prepareGas.prepare(REPO, out, 'script-id'), /must be empty/);
  assert.throws(() => prepareGas.prepare(REPO, path.join(tmp(), 'o'), ' bad id'), /valid Script ID/);
});

test('manifest：scopeはspreadsheetsとsend_mailのみ、webappは定義せずリモートの値を保持', () => {
  const repoManifest = JSON.parse(read('baseball/gas/baseball_uniform_survey/public/appsscript.json'));
  assert.deepStrictEqual([...repoManifest.oauthScopes].sort(), [...prepareGas.REQUIRED_SCOPES].sort());
  assert.strictEqual(repoManifest.webapp, undefined);
  const remote = { timeZone: 'Asia/Tokyo', webapp: { access: 'ANYONE_ANONYMOUS', executeAs: 'USER_DEPLOYING' }, dependencies: {} };
  const staged = prepareGas.stageManifest(repoManifest, remote);
  assert.deepStrictEqual(staged.webapp, remote.webapp);
  assert.throws(() => prepareGas.stageManifest(Object.assign({}, repoManifest, { webapp: {} }), null), /must not define/);
  assert.throws(() => prepareGas.stageManifest(Object.assign({}, repoManifest, { oauthScopes: [...repoManifest.oauthScopes, 'https://www.googleapis.com/auth/drive'] }), null), /not allowed/);
  assert.throws(() => prepareGas.stageManifest(Object.assign({}, repoManifest, { oauthScopes: [] }), null), /missing a required/);
  assert.throws(() => prepareGas.stageManifest(repoManifest, { timeZone: 'Asia/Tokyo', extra: 1 }), /additional settings/);
});

test('リモートが別survey/手書きコードのプロジェクトなら上書きを拒否し、空の初期プロジェクトは許可', () => {
  const remote = tmp();
  fs.writeFileSync(path.join(remote, 'appsscript.json'), '{}');
  fs.writeFileSync(path.join(remote, 'Code.gs'), 'function myFunction() {}\n');
  fs.writeFileSync(path.join(remote, 'Main.js'), '// pulled');
  assert.deepStrictEqual(prepareGas.validateRemote(remote).map((r) => r.kind).sort(), ['expected', 'manifest', 'placeholder']);
  fs.writeFileSync(path.join(remote, 'Finalize.gs'), '// 別surveyのファイル');
  assert.throws(() => prepareGas.validateRemote(remote), /refusing to replace/);
  const handwritten = tmp();
  fs.writeFileSync(path.join(handwritten, 'appsscript.json'), '{}');
  fs.writeFileSync(path.join(handwritten, 'Code.gs'), 'function doGet() { return 1; }');
  assert.throws(() => prepareGas.validateRemote(handwritten), /refusing to replace/);
});

test('workflow：PRはテスト・dry-runのみで、production deployは手動dispatch・main限定・Environment承認', () => {
  assert.match(workflow, /on:\n {2}pull_request:\n {4}branches: \[main\]/);
  assert.ok(!/\n {2}push:/.test(workflow) && !/schedule:/.test(workflow), '自動deployのトリガーを持たない');
  const verify = job(workflow, 'verify');
  const deploy = job(workflow, 'deploy');
  assert.ok(!/secrets\./.test(verify) && !/deploy-gas\.sh/.test(verify) && !/CLASPRC/.test(verify) && !/environment:/.test(verify), 'verify に secret / deploy を置かない');
  for (const step of ['npm ci --ignore-scripts', 'npm run validate', 'npm run build:check', 'npm test', 'dry-run']) assert.ok(verify.includes(step), step);
  assert.match(deploy, /if: github\.event_name == 'workflow_dispatch'/);
  assert.match(deploy, /needs: verify/);
  assert.match(deploy, /environment: baseball-uniform-survey-public-production/);
  assert.match(deploy, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(deploy, /BASEBALL_UNIFORM_SURVEY_SOURCE_SHA: \$\{\{ github\.sha \}\}/);
  assert.ok(verify.indexOf("refs/heads/main") >= 0 && verify.indexOf('refs/heads/main') < verify.indexOf('Check out code under test'));
  assert.ok(!/continue-on-error|\|\| true|if: always\(\)|if: failure\(\)/.test(workflow));
  for (const secret of ['CLASPRC_JSON', 'BASEBALL_UNIFORM_SURVEY_SCRIPT_ID', 'BASEBALL_UNIFORM_SURVEY_DEPLOYMENT_ID']) {
    assert.match(deploy, new RegExp(`${secret}: \\$\\{\\{ secrets\\.${secret} \\}\\}`));
  }
  assert.ok(!/(salt|test_token|TEST_TOKEN|RESPONDENT_SALT)/i.test(workflow), 'salt / token は workflow に出てこない');
  assert.match(workflow, /npm ci --ignore-scripts/);
});

test('deploy script：既存deploymentの更新だけで、新規作成・Script Properties変更をしない。secretを出力しない', () => {
  const code = deploySh.replace(/^\s*#.*$/gm, '');
  assert.match(code, /update-deployment/);
  assert.ok(!/clasp[^\n]*create-deployment|clasp[^\n]* deploy\b/.test(code), '新規deploymentを作らない');
  assert.ok(!/setProperty|PropertiesService|run-function|clasp[^\n]* run\b/.test(code), 'Script Propertiesに触れない');
  assert.ok(!/echo[^\n]*(CLASPRC_JSON|SCRIPT_ID|DEPLOYMENT_ID)/.test(code), 'secretをechoしない');
  assert.match(code, /validate-remote/);
  assert.ok(code.indexOf('validate-remote') < code.indexOf('clasp --auth "$auth_file" push'), '検証 → push の順');
  assert.ok(code.indexOf('push --force') < code.indexOf('create-version') && code.indexOf('create-version') < code.indexOf('update-deployment'));
  const prepareCode = fs.readFileSync(path.join(REPO, 'scripts/baseball-uniform-survey/prepare-gas.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/costume|COSTUME|fetish/i.test(code + prepareCode), '他surveyのIDを共有しない');
});

test('clasp は lockfile で固定されている', () => {
  const pkg = JSON.parse(read('scripts/baseball-uniform-survey/package.json'));
  assert.strictEqual(pkg.devDependencies['@google/clasp'], '3.4.1');
  const lock = JSON.parse(read('scripts/baseball-uniform-survey/package-lock.json'));
  assert.strictEqual(lock.name, pkg.name);
  assert.strictEqual(lock.packages['node_modules/@google/clasp'].version, '3.4.1');
});
