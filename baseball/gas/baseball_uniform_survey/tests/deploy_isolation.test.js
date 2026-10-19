'use strict';
// Public / Admin / maintenance の deploy 分離（Issue #390）。実Googleへは接続しない。
// 各 target は専用 workflow・専用 allowlist・専用 Environment / Script ID / Deployment ID を持ち、
// 互いに別 project のファイルを push できない。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
const prepareGas = require(path.join(REPO, 'scripts', 'baseball-uniform-survey', 'prepare-gas.js'));
const deployScript = path.join(REPO, 'scripts', 'baseball-uniform-survey', 'deploy-gas.sh');
const { TARGETS } = prepareGas;
const NAMES = ['public', 'admin', 'maintenance'];
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bus-iso-'));
const workflowOf = (name) => read(`.github/workflows/baseball-uniform-survey-${name}-gas.yml`);
const upper = (name) => name.toUpperCase();

function job(text, name) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l === `  ${name}:`);
  assert.ok(start >= 0, name);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^ {2}[a-z_-]+:/.test(lines[i])) { end = i; break; }
  return lines.slice(start, end).join('\n');
}

function remoteWith(files, manifest) {
  const dir = tmp();
  for (const f of files) fs.writeFileSync(path.join(dir, f), '// pulled');
  fs.writeFileSync(path.join(dir, 'appsscript.json'), JSON.stringify(manifest || {}));
  return dir;
}

test('3 target は専用 allowlist を持ち、ソースディレクトリの .gs/.html と完全一致する', () => {
  assert.deepStrictEqual(Object.keys(TARGETS).sort(), [...NAMES].sort());
  for (const name of NAMES) {
    const present = fs.readdirSync(path.join(REPO, TARGETS[name].dir)).filter((n) => /\.(gs|html)$/.test(n)).sort();
    assert.deepStrictEqual(present, [...TARGETS[name].files].sort(), name);
    assert.ok(!TARGETS[name].dir.endsWith('/') && TARGETS[name].dir.split('/').pop() === name, `${name} は自分のディレクトリだけを指す`);
  }
});

test('各 target の bundle には他 project 専用のファイルが含まれない', () => {
  const only = (a, b) => TARGETS[a].files.filter((f) => !TARGETS[b].files.includes(f));
  for (const a of NAMES) {
    for (const b of NAMES.filter((n) => n !== a)) {
      assert.ok(only(a, b).length > 0, `${a} は ${b} にないファイルを持つ（相互に取り違えを検出できる）`);
    }
  }
  const forbidden = { admin: ['Finalize.gs', 'Cleanup.gs', 'Retention.gs', 'Maintenance.html', 'Submission.gs', 'Respondent.gs'],
    maintenance: ['Snapshot.gs', 'FreeText.gs', 'Dashboard.html', 'Submission.gs', 'Respondent.gs'],
    public: ['Snapshot.gs', 'FreeText.gs', 'Dashboard.html', 'Finalize.gs', 'Cleanup.gs', 'Retention.gs', 'Maintenance.html'] };
  for (const name of NAMES) for (const f of forbidden[name]) assert.ok(!TARGETS[name].files.includes(f), `${name} bundle に ${f} を含めない`);
});

test('stage は target のファイルだけを出力し、別 target の source ディレクトリは読まない', () => {
  for (const name of NAMES) {
    const out = path.join(tmp(), 'out');
    const files = prepareGas.prepare(name, REPO, out, 'script-id');
    assert.deepStrictEqual(fs.readdirSync(out).filter((n) => !n.startsWith('.')).sort(), [...files].sort(), name);
    assert.deepStrictEqual(files.slice().sort(), [...TARGETS[name].files, 'appsscript.json'].sort());
  }
  assert.throws(() => prepareGas.prepare('other', REPO, path.join(tmp(), 'o'), 'id'), /Unknown target/);
  // 混入ファイル（allowlist 外）があれば拒否する
  const fake = tmp();
  for (const name of NAMES) {
    fs.mkdirSync(path.join(fake, TARGETS[name].dir), { recursive: true });
    for (const f of TARGETS[name].files) fs.writeFileSync(path.join(fake, TARGETS[name].dir, f), '//');
    fs.copyFileSync(path.join(REPO, TARGETS[name].dir, 'appsscript.json'), path.join(fake, TARGETS[name].dir, 'appsscript.json'));
  }
  fs.writeFileSync(path.join(fake, TARGETS.admin.dir, 'Finalize.gs'), '// maintenance のファイルが admin に混入');
  assert.throws(() => prepareGas.prepare('admin', fake, path.join(tmp(), 'o'), 'id'), /Unexpected or missing source files/);
});

test('リモート project が別 target のものなら、どの組み合わせでも push 前に拒否する', () => {
  const owner = { webapp: { executeAs: 'USER_DEPLOYING', access: 'MYSELF' } };
  for (const target of NAMES) {
    assert.doesNotThrow(() => prepareGas.validateRemote(target, remoteWith(TARGETS[target].files, owner)), `${target} 自身は許可`);
    for (const other of NAMES.filter((n) => n !== target)) {
      const remote = remoteWith(TARGETS[other].files, owner);
      assert.throws(() => prepareGas.validateRemote(target, remote), /refusing to replace/, `${target} は ${other} の project に push しない`);
    }
  }
  // 手書きの追加ファイル・ディレクトリも拒否
  const extra = remoteWith(TARGETS.admin.files, owner);
  fs.writeFileSync(path.join(extra, 'Extra.js'), '// x');
  assert.throws(() => prepareGas.validateRemote('admin', extra), /refusing to replace/);
});

test('manifest：scope は target ごとに完全一致のみ。Admin は read-only、書込み scope は maintenance だけ', () => {
  assert.deepStrictEqual(TARGETS.admin.requiredScopes, ['https://www.googleapis.com/auth/spreadsheets.readonly']);
  assert.deepStrictEqual(TARGETS.maintenance.requiredScopes, ['https://www.googleapis.com/auth/spreadsheets']);
  for (const name of NAMES) {
    const manifest = JSON.parse(read(`${TARGETS[name].dir}/appsscript.json`));
    assert.deepStrictEqual([...manifest.oauthScopes].sort(), [...TARGETS[name].requiredScopes].sort(), name);
    const withExtra = Object.assign({}, manifest, { oauthScopes: [...manifest.oauthScopes, 'https://www.googleapis.com/auth/drive'] });
    assert.throws(() => prepareGas.stageManifest(name, withExtra, null), /not allowed/, name);
  }
  const admin = JSON.parse(read(`${TARGETS.admin.dir}/appsscript.json`));
  // Admin に書込み scope を入れて maintenance 相当にはできない
  assert.throws(() => prepareGas.stageManifest('admin', Object.assign({}, admin, { oauthScopes: TARGETS.maintenance.requiredScopes }), null), /missing a required|not allowed/);
  const maintenance = JSON.parse(read(`${TARGETS.maintenance.dir}/appsscript.json`));
  assert.throws(() => prepareGas.stageManifest('maintenance', Object.assign({}, maintenance, { oauthScopes: TARGETS.admin.requiredScopes }), null), /missing a required|not allowed/);
});

test('Admin / maintenance の Web App は MYSELF / USER_DEPLOYING のみ。リモートが公開設定・未定義なら配備しない', () => {
  for (const name of ['admin', 'maintenance']) {
    const repoManifest = JSON.parse(read(`${TARGETS[name].dir}/appsscript.json`));
    assert.deepStrictEqual(repoManifest.webapp, { executeAs: 'USER_DEPLOYING', access: 'MYSELF' }, name);
    for (const bad of [undefined, { executeAs: 'USER_DEPLOYING', access: 'ANYONE_ANONYMOUS' }, { executeAs: 'USER_ACCESSING', access: 'MYSELF' }, { access: 'DOMAIN', executeAs: 'USER_DEPLOYING' }]) {
      assert.throws(() => prepareGas.stageManifest(name, Object.assign({}, repoManifest, { webapp: bad }), null), /must define the Web App/, name);
      const remote = Object.assign({ timeZone: 'Asia/Tokyo' }, bad === undefined ? {} : { webapp: bad });
      assert.throws(() => prepareGas.validateRemoteManifest(name, remote), /refusing to deploy/, name);
      assert.throws(() => prepareGas.stageManifest(name, repoManifest, remote), /refusing to deploy/, name);
    }
    const ok = prepareGas.stageManifest(name, repoManifest, { timeZone: 'Asia/Tokyo', dependencies: { x: 1 }, webapp: repoManifest.webapp });
    assert.deepStrictEqual(ok.webapp, repoManifest.webapp);
    assert.deepStrictEqual(ok.dependencies, { x: 1 });
  }
  const pub = JSON.parse(read(`${TARGETS.public.dir}/appsscript.json`));
  assert.strictEqual(pub.webapp, undefined, 'Public はリモートの webapp を保持し、CI で変更しない');
});

test('workflow：target ごとに専用ファイル・Environment・Script ID・Deployment ID を持ち、他 target の名前を一切参照しない', () => {
  const envName = (n) => `baseball-uniform-survey-${n}-production`;
  const idNames = {
    public: ['BASEBALL_UNIFORM_SURVEY_SCRIPT_ID', 'BASEBALL_UNIFORM_SURVEY_DEPLOYMENT_ID'],
    admin: ['BASEBALL_UNIFORM_SURVEY_ADMIN_SCRIPT_ID', 'BASEBALL_UNIFORM_SURVEY_ADMIN_DEPLOYMENT_ID'],
    maintenance: ['BASEBALL_UNIFORM_SURVEY_MAINTENANCE_SCRIPT_ID', 'BASEBALL_UNIFORM_SURVEY_MAINTENANCE_DEPLOYMENT_ID']
  };
  for (const name of NAMES) {
    const wf = workflowOf(name);
    const deploy = job(wf, 'deploy');
    assert.ok(!/environment:/.test(job(wf, 'verify')), 'environment は deploy job のみ（verify に置かない）');
    assert.match(deploy, new RegExp(`environment: ${envName(name)}\\n`));
    assert.match(deploy, new RegExp(`BASEBALL_UNIFORM_SURVEY_TARGET: ${name}\\n`));
    assert.deepStrictEqual([TARGETS[name].scriptIdEnv, TARGETS[name].deploymentIdEnv], idNames[name]);
    for (const id of idNames[name]) assert.match(deploy, new RegExp(`${id}: \\$\\{\\{ secrets\\.${id} \\}\\}`));
    assert.match(deploy, /CLASPRC_JSON: \$\{\{ secrets\.CLASPRC_JSON \}\}/);
    for (const other of NAMES.filter((n) => n !== name)) {
      assert.ok(!wf.includes(envName(other)), `${name} workflow は ${other} の Environment を参照しない`);
      for (const id of idNames[other]) assert.ok(!new RegExp(`\\b${id}\\b`).test(wf), `${name} workflow は ${other} の ${id} を参照しない`);
      assert.ok(!wf.includes(`workflows/baseball-uniform-survey-${other}-gas.yml`), `${name} workflow の paths に ${other} の workflow を入れない`);
    }
    // secrets.* は deploy job 内のみ
    assert.ok(!/secrets\./.test(job(wf, 'verify')), 'verify に secret を置かない');
  }
  // Environment 名・Script ID 名・Deployment ID 名は 3 つとも重複しない
  const all = NAMES.flatMap((n) => [envName(n), ...idNames[n]]);
  assert.strictEqual(new Set(all).size, all.length);
});

test('workflow：PR は build / test / bundle dry-run のみ。production deploy は main の workflow_dispatch + Environment 承認 + MYSELF 確認', () => {
  for (const name of NAMES) {
    const wf = workflowOf(name);
    const verify = job(wf, 'verify');
    const deploy = job(wf, 'deploy');
    assert.match(wf, /on:\n {2}pull_request:\n {4}branches: \[main\]/);
    assert.ok(!/\n {2}push:/.test(wf) && !/schedule:/.test(wf) && !/pull_request_target/.test(wf), `${name}: 自動 deploy のトリガーを持たない`);
    assert.ok(!/deploy-gas\.sh|CLASPRC|clasp --auth|update-deployment/.test(verify), `${name}: verify（PR）で deploy / clasp を実行しない`);
    for (const step of ['npm ci --ignore-scripts', 'npm run validate', 'npm run build:check', 'npm test', 'dry-run']) assert.ok(verify.includes(step), `${name}: ${step}`);
    assert.ok(verify.includes(`prepare-gas.js stage ${name} `), `${name}: dry-run は自分の target を stage する`);
    assert.match(verify, new RegExp(`BASEBALL_UNIFORM_SURVEY_${upper(name === 'public' ? '' : name + '_')}SCRIPT_ID='dry-run-only'`));
    assert.match(deploy, /if: github\.event_name == 'workflow_dispatch'/);
    assert.match(deploy, /needs: verify/);
    assert.match(deploy, /ref: \$\{\{ github\.sha \}\}/);
    assert.match(deploy, /BASEBALL_UNIFORM_SURVEY_SOURCE_SHA: \$\{\{ github\.sha \}\}/);
    assert.ok(verify.indexOf('refs/heads/main') >= 0 && verify.indexOf('refs/heads/main') < verify.indexOf('Check out code under test'), `${name}: main 以外の dispatch は checkout 前に拒否`);
    assert.ok(!/continue-on-error|\|\| true|if: always\(\)|if: failure\(\)/.test(wf), name);
    assert.ok(!/(salt|test_token|TEST_TOKEN|RESPONDENT_SALT)/i.test(wf), `${name}: salt / token は workflow に出てこない`);
    assert.match(wf, /npm ci --ignore-scripts/);
    if (name === 'public') {
      assert.ok(!/workflow_dispatch:\n {4}inputs:/.test(wf));
    } else {
      assert.match(wf, /workflow_dispatch:\n {4}inputs:\n {6}webapp_access_set_to_myself:\n(?:.*\n)*? {8}required: true\n {8}type: boolean\n {8}default: false/);
      assert.match(deploy, /BASEBALL_UNIFORM_SURVEY_OWNER_ONLY_CONFIRMED: \$\{\{ inputs\.webapp_access_set_to_myself && 'true' \|\| 'false' \}\}/);
      assert.ok(deploy.indexOf('Require the existing deployment to be owner-only') < deploy.indexOf('actions/checkout'), `${name}: 確認は checkout / clasp より前`);
    }
  }
});

test('deploy script：別 target の ID が環境にあれば clasp を呼ぶ前に拒否し、MYSELF 確認が無ければ admin / maintenance は拒否する', () => {
  const bin = tmp();
  const marker = path.join(bin, 'clasp-called');
  fs.writeFileSync(path.join(bin, 'clasp'), `#!/usr/bin/env bash\ntouch "${marker}"\nexit 1\n`, { mode: 0o755 });
  const base = { PATH: `${bin}:${process.env.PATH}`, GITHUB_WORKSPACE: REPO, RUNNER_TEMP: tmp(), CLASPRC_JSON: '{"a":1}', BASEBALL_UNIFORM_SURVEY_SOURCE_SHA: 'abc' };
  const run = (env) => {
    fs.rmSync(marker, { force: true });
    const r = spawnSync('bash', [deployScript], { env: Object.assign({}, base, env), encoding: 'utf8' });
    return { status: r.status, called: fs.existsSync(marker), err: r.stderr };
  };
  const ids = (name) => ({ [TARGETS[name].scriptIdEnv]: 'sid-' + name, [TARGETS[name].deploymentIdEnv]: 'did-' + name });
  // 不正 / 欠落した target
  assert.strictEqual(run({}).status, 1);
  assert.strictEqual(run({ BASEBALL_UNIFORM_SURVEY_TARGET: 'costume' }).status, 1);
  for (const name of NAMES) {
    const own = Object.assign({ BASEBALL_UNIFORM_SURVEY_TARGET: name, BASEBALL_UNIFORM_SURVEY_OWNER_ONLY_CONFIRMED: 'true' }, ids(name));
    for (const other of NAMES.filter((n) => n !== name)) {
      const r = run(Object.assign({}, own, ids(other)));
      assert.strictEqual(r.status, 1, `${name}: ${other} の ID が混ざっていたら拒否`);
      assert.match(r.err, /belongs to another GAS project/);
      assert.ok(!r.called, 'clasp を呼ばない');
    }
    // 自分の ID が欠けている（他 target の ID だけがある）場合も拒否
    const wrong = run({ BASEBALL_UNIFORM_SURVEY_TARGET: name, BASEBALL_UNIFORM_SURVEY_OWNER_ONLY_CONFIRMED: 'true', ...ids(NAMES.find((n) => n !== name)) });
    assert.strictEqual(wrong.status, 1);
    assert.ok(!wrong.called);
    if (name !== 'public') {
      const noConfirm = run(Object.assign({}, own, { BASEBALL_UNIFORM_SURVEY_OWNER_ONLY_CONFIRMED: 'false' }));
      assert.strictEqual(noConfirm.status, 1);
      assert.match(noConfirm.err, /Nothing was changed/);
      assert.ok(!noConfirm.called, 'clasp を呼ばない');
    }
  }
});

test('deploy script：target ごとに version / deployment の説明が分かれ、既存 deployment の更新のみ。secret を出力しない', () => {
  const code = read('scripts/baseball-uniform-survey/deploy-gas.sh').replace(/^\s*#.*$/gm, '');
  assert.match(code, /create-version "baseball-uniform-survey \$target main /);
  assert.match(code, /update-deployment/);
  assert.ok(!/clasp[^\n]*create-deployment|clasp[^\n]* deploy\b/.test(code), '新規 deployment を作らない');
  assert.ok(!/setProperty|PropertiesService|run-function|clasp[^\n]* run\b/.test(code), 'Script Properties に触れない');
  assert.ok(!/echo[^\n]*\$\{?(script_id|deployment_id|CLASPRC_JSON|BASEBALL_UNIFORM_SURVEY_\w*(SCRIPT|DEPLOYMENT)_ID)/.test(code), 'ID / credentials を echo しない');
  assert.match(code, /validate-remote "\$target"/);
  assert.match(code, /stage "\$target"/);
  assert.ok(code.indexOf('validate-remote') < code.indexOf('clasp --auth "$auth_file" push'));
});
