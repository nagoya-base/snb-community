'use strict';
// Admin / maintenance の初回 bootstrap workflow（Issue #390）。実Googleへは接続しない。
// clasp push だけを行い、version / deployment / Web App access / Script Properties には触れないこと、
// 通常 deploy workflow と分離されていることを検査する。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
const prepareGas = require(path.join(REPO, 'scripts', 'baseball-uniform-survey', 'prepare-gas.js'));
const script = path.join(REPO, 'scripts', 'baseball-uniform-survey', 'bootstrap-gas.sh');
const { TARGETS } = prepareGas;
const BOOT = ['admin', 'maintenance'];
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bus-boot-'));
const wf = read('.github/workflows/baseball-uniform-survey-bootstrap-gas.yml');
const code = read('scripts/baseball-uniform-survey/bootstrap-gas.sh').replace(/^\s*#.*$/gm, '');

function job(text, name) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l === `  ${name}:`);
  assert.ok(start >= 0, name);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^ {2}[a-z_-]+:/.test(lines[i])) { end = i; break; }
  return lines.slice(start, end).join('\n');
}
function remote(files, manifest) {
  const dir = tmp();
  for (const f of files) fs.writeFileSync(path.join(dir, f), f === 'Code.gs' ? 'function myFunction() {\n}\n' : '// pulled');
  fs.writeFileSync(path.join(dir, 'appsscript.json'), JSON.stringify(manifest || { timeZone: 'Asia/Tokyo' }));
  return dir;
}

test('bootstrap 対象は admin / maintenance のみ。専用の bootstrap Script ID 名を持ち、通常 deploy の ID と重ならない', () => {
  assert.strictEqual(TARGETS.public.bootstrapScriptIdEnv, undefined);
  const names = BOOT.map((n) => TARGETS[n].bootstrapScriptIdEnv);
  assert.deepStrictEqual(names, ['BASEBALL_UNIFORM_SURVEY_ADMIN_BOOTSTRAP_SCRIPT_ID', 'BASEBALL_UNIFORM_SURVEY_MAINTENANCE_BOOTSTRAP_SCRIPT_ID']);
  const all = [...names, ...Object.values(TARGETS).flatMap((t) => [t.scriptIdEnv, t.deploymentIdEnv])];
  assert.strictEqual(new Set(all).size, all.length);
  assert.throws(() => prepareGas.validateBootstrapRemote('public', remote(['Code.gs'])), /no bootstrap workflow/);
});

test('空の初期 project（placeholder のみ）だけ受け付け、bootstrap 済み・別 target・公開 Web App は拒否する', () => {
  for (const name of BOOT) {
    assert.doesNotThrow(() => prepareGas.validateBootstrapRemote(name, remote(['Code.gs'])), `${name}: 空 project`);
    assert.doesNotThrow(() => prepareGas.validateBootstrapRemote(name, remote([])), `${name}: ファイル無し`);
    assert.throws(() => prepareGas.validateBootstrapRemote(name, remote(TARGETS[name].files)), /already bootstrapped/, `${name}: 再実行は拒否`);
    assert.throws(() => prepareGas.validateBootstrapRemote(name, remote(['Code.gs', TARGETS[name].files[0]])), /already bootstrapped/);
    const other = BOOT.find((n) => n !== name);
    assert.throws(() => prepareGas.validateBootstrapRemote(name, remote(TARGETS[other].files)), /refusing to replace/, `${name}: 別 target の project`);
    assert.throws(() => prepareGas.validateBootstrapRemote(name, remote(['Code.gs'], { webapp: { executeAs: 'USER_DEPLOYING', access: 'ANYONE_ANONYMOUS' } })), /refusing to bootstrap/);
    assert.throws(() => prepareGas.validateBootstrapRemote(name, remote(['Code.gs'], { timeZone: 'Asia/Tokyo', unknownKey: 1 })), /additional settings/);
    const handwritten = remote(['Code.gs']);
    fs.writeFileSync(path.join(handwritten, 'Code.gs'), 'function doGet() { return 1; }');
    assert.throws(() => prepareGas.validateBootstrapRemote(name, handwritten), /refusing to replace/, `${name}: 手書きコード`);
  }
});

test('stage-bootstrap：allowlist のファイルと MYSELF の manifest だけを出力し、リモートが無ければ拒否する', () => {
  for (const name of BOOT) {
    const out = path.join(tmp(), 'out');
    const files = prepareGas.prepare(name, REPO, out, 'script-id', remote(['Code.gs'], { timeZone: 'Asia/Tokyo', dependencies: { x: 1 } }), { bootstrap: true });
    assert.deepStrictEqual(files.slice().sort(), [...TARGETS[name].files, 'appsscript.json'].sort());
    assert.deepStrictEqual(fs.readdirSync(out).filter((n) => !n.startsWith('.')).sort(), files.slice().sort());
    const manifest = JSON.parse(fs.readFileSync(path.join(out, 'appsscript.json'), 'utf8'));
    assert.deepStrictEqual(manifest.webapp, prepareGas.OWNER_ONLY_WEBAPP);
    assert.deepStrictEqual(manifest.dependencies, { x: 1 });
    assert.deepStrictEqual([...manifest.oauthScopes].sort(), [...TARGETS[name].requiredScopes].sort());
    assert.throws(() => prepareGas.prepare(name, REPO, path.join(tmp(), 'o'), 'id', undefined, { bootstrap: true }), /requires the pulled remote/);
  }
});

test('bootstrap workflow：dispatch は main のみ、PR は dry-run のみ。自動 deploy のトリガーも auto-merge も持たない', () => {
  assert.match(wf, /on:\n {2}pull_request:\n {4}branches: \[main\]/);
  assert.ok(!/\n {2}push:/.test(wf) && !/schedule:/.test(wf) && !/pull_request_target/.test(wf));
  assert.ok(!/auto-merge|automerge|enable_pr_auto_merge/i.test(wf.replace(/^\s*#.*$/gm, '')));
  assert.match(wf, /workflow_dispatch:\n {4}inputs:\n {6}target:\n(?:.*\n)*? {8}type: choice\n {8}options:\n {10}- admin\n {10}- maintenance\n/);
  assert.match(wf, /confirm_first_bootstrap:\n(?:.*\n)*? {8}required: true\n {8}type: boolean\n {8}default: false/);
  const verify = job(wf, 'verify');
  assert.ok(!/secrets\.|environment:|bootstrap-gas\.sh|clasp --auth|CLASPRC/.test(verify), 'verify（PR）で secret / clasp / Environment を使わない');
  assert.ok(verify.includes('stage-bootstrap') && verify.includes("'dry-run-only'") && verify.includes('npm test'));
  assert.ok(verify.indexOf('refs/heads/main') >= 0 && verify.indexOf('refs/heads/main') < verify.indexOf('Check out code under test'));
  assert.ok(!/continue-on-error|\|\| true|if: always\(\)|if: failure\(\)/.test(wf));
  assert.ok(!/(salt|test_token|TEST_TOKEN|RESPONDENT_SALT)/i.test(wf));
});

test('bootstrap workflow：target ごとに専用 Environment / bootstrap Script ID だけを使い、Deployment ID・通常 deploy の Secret を参照しない', () => {
  const secrets = wf.match(/secrets\.[A-Z0-9_]+/g).sort();
  assert.deepStrictEqual([...new Set(secrets)], [
    'secrets.BASEBALL_UNIFORM_SURVEY_ADMIN_BOOTSTRAP_SCRIPT_ID',
    'secrets.BASEBALL_UNIFORM_SURVEY_MAINTENANCE_BOOTSTRAP_SCRIPT_ID',
    'secrets.CLASPRC_JSON'
  ]);
  assert.ok(!/DEPLOYMENT_ID/.test(wf));
  for (const name of BOOT) {
    const j = job(wf, `bootstrap-${name}`);
    assert.match(j, new RegExp(`if: github\\.event_name == 'workflow_dispatch' && inputs\\.target == '${name}'`));
    assert.match(j, /needs: verify/);
    assert.match(j, new RegExp(`environment: baseball-uniform-survey-${name}-bootstrap\\n`));
    assert.match(j, new RegExp(`BASEBALL_UNIFORM_SURVEY_TARGET: ${name}\\n`));
    assert.match(j, /ref: \$\{\{ github\.sha \}\}/);
    assert.ok(j.indexOf('first-bootstrap confirmation') < j.indexOf('actions/checkout'), '確認は checkout / clasp より前');
    assert.ok(!/-production/.test(j), '通常 deploy の Environment を使わない');
    const other = BOOT.find((n) => n !== name);
    assert.ok(!new RegExp(other.toUpperCase() + '_BOOTSTRAP').test(j), `${name} job は ${other} の Secret を参照しない`);
  }
  // 通常 deploy workflow は bootstrap の Environment / Secret を参照しない（分離）
  for (const name of ['public', 'admin', 'maintenance']) {
    const normal = read(`.github/workflows/baseball-uniform-survey-${name}-gas.yml`);
    assert.ok(!/BOOTSTRAP|-bootstrap/.test(normal.replace(/^\s*#.*$/gm, '')), name);
  }
});

test('bootstrap script：clasp push だけを行い、version / deployment / Script Properties / 実行には触れず、ID を出力しない', () => {
  assert.match(code, /clasp --auth "\$auth_file" push --force/);
  assert.ok(!/create-version|create-deployment|update-deployment|undeploy|setProperty|PropertiesService|run-function|clasp[^\n]* run\b|clasp[^\n]* deploy\b/.test(code));
  assert.ok(!/echo[^\n]*\$\{?(script_id|CLASPRC_JSON|BASEBALL_UNIFORM_SURVEY_\w*SCRIPT_ID)/.test(code));
  assert.ok(code.indexOf('validate-bootstrap-remote') < code.indexOf('clasp --auth "$auth_file" push'));
  assert.ok(code.indexOf('list-deployments') < code.indexOf('clasp --auth "$auth_file" pull'));
});

test('bootstrap script：不正な target・他の ID の混入・Script ID 欠落は clasp を呼ぶ前に拒否する', () => {
  const bin = tmp();
  const marker = path.join(bin, 'clasp-called');
  fs.writeFileSync(path.join(bin, 'clasp'), `#!/usr/bin/env bash\ntouch "${marker}"\nexit 1\n`, { mode: 0o755 });
  const base = { PATH: `${bin}:${process.env.PATH}`, GITHUB_WORKSPACE: REPO, RUNNER_TEMP: tmp(), CLASPRC_JSON: '{"a":1}' };
  const run = (env) => {
    fs.rmSync(marker, { force: true });
    const r = spawnSync('bash', [script], { env: Object.assign({}, base, env), encoding: 'utf8' });
    return { status: r.status, called: fs.existsSync(marker), err: r.stderr };
  };
  for (const bad of [{}, { BASEBALL_UNIFORM_SURVEY_TARGET: 'public' }, { BASEBALL_UNIFORM_SURVEY_TARGET: 'other' }]) {
    const r = run(bad);
    assert.strictEqual(r.status, 1);
    assert.ok(!r.called);
  }
  for (const name of BOOT) {
    const own = TARGETS[name].bootstrapScriptIdEnv;
    const missing = run({ BASEBALL_UNIFORM_SURVEY_TARGET: name });
    assert.strictEqual(missing.status, 1);
    assert.match(missing.err, /Bootstrap Script ID secret/);
    assert.ok(!missing.called);
    const extras = [TARGETS[name].scriptIdEnv, TARGETS[name].deploymentIdEnv, TARGETS[BOOT.find((n) => n !== name)].bootstrapScriptIdEnv, TARGETS.public.scriptIdEnv];
    for (const extra of extras) {
      const r = run({ BASEBALL_UNIFORM_SURVEY_TARGET: name, [own]: 'sid', [extra]: 'x' });
      assert.strictEqual(r.status, 1, `${name}: ${extra} が混ざっていたら拒否`);
      assert.match(r.err, /Nothing was changed/);
      assert.ok(!r.called, 'clasp を呼ばない');
    }
  }
});
