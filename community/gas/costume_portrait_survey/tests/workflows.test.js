'use strict';
// GitHub Actions workflow の構造検査（YAMLパーサ無しの文字列検査）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
const workflows = { public: read('.github/workflows/costume-portrait-public-gas.yml'), admin: read('.github/workflows/costume-portrait-admin-gas.yml') };

/** "  deploy:" のようなトップレベルjobのブロックを取り出す */
function job(text, name) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l === `  ${name}:`);
  assert.ok(start >= 0, name);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^ {2}[a-z_-]+:/.test(lines[i])) { end = i; break; }
  return lines.slice(start, end).join('\n');
}

for (const [target, text] of Object.entries(workflows)) {
  test(`${target}: PRではテスト・dry-runのみで、本番deploymentを更新しない`, () => {
    assert.match(text, /on:\n {2}pull_request:\n {4}branches: \[main\]/);
    const deploy = job(text, 'deploy');
    assert.match(deploy, /if: github\.event_name == 'workflow_dispatch'/);
    assert.match(deploy, /needs: verify/);
    // verify ジョブにはデプロイ用の Secret / clasp / deploy script が無い
    const verify = job(text, 'verify');
    assert.ok(!/secrets\./.test(verify) && !/deploy-gas\.sh/.test(verify) && !/CLASPRC/.test(verify) && !/environment:/.test(verify));
    assert.match(verify, /npm run build:check/);
    assert.match(verify, /npm test/);
    assert.match(verify, /dry-run/);
  });

  test(`${target}: テストが失敗したらデプロイしない（deployは verify に依存し、verify内の各ステップが失敗で停止）`, () => {
    const verify = job(text, 'verify');
    assert.ok(!/continue-on-error/.test(text));
    assert.ok(!/\|\| true/.test(text));
    assert.ok(!/if: always\(\)|if: \$\{\{ always\(\) \}\}|if: failure\(\)/.test(text));
    assert.match(job(text, 'deploy'), /needs: verify/);
    assert.match(verify, /set -euo pipefail/);
  });

  test(`${target}: 手動dispatch・mainの最新commit限定・専用Environment・Secretは環境単位`, () => {
    assert.match(text, /workflow_dispatch:\n {4}inputs:\n {6}source_sha:/);
    assert.match(text, /refs\/heads\/main/);
    assert.match(text, /verify-snb-survey-source-sha\.sh/);
    const deploy = job(text, 'deploy');
    assert.match(deploy, new RegExp(`environment: costume-portrait-${target}-production`));
    for (const secret of ['CLASPRC_JSON', 'COSTUME_PORTRAIT_SCRIPT_ID', 'COSTUME_PORTRAIT_DEPLOYMENT_ID']) {
      assert.ok(deploy.includes(`secrets.${secret}`), secret);
    }
    assert.ok(deploy.includes(`COSTUME_PORTRAIT_TARGET: ${target}`));
    // 反対側のtargetや既存fetish用の識別子を参照しない
    const other = target === 'public' ? 'admin' : 'public';
    assert.ok(!text.includes(`costume-portrait-${other}-production`));
    assert.ok(!/SNB_SURVEY_/.test(text) && !/snb-survey-production|snb-survey-admin-production/.test(text));
  });

  test(`${target}: package-lock.json を使い npm ci のみ（npm install を使わない）、clasp はlockfileで固定`, () => {
    assert.ok(!/npm install/.test(text.replace(/#.*$/gm, '')), 'npm install is forbidden in CI');
    assert.ok((text.match(/npm ci/g) || []).length >= 2);
    assert.ok(!/@google\/clasp@/.test(text), 'clasp はlockfile固定（scripts/costume-portrait-survey/package-lock.json）');
    assert.match(text, /actions\/checkout@v4/);
    assert.match(text, /persist-credentials: false/);
    assert.match(text, /permissions:\n {2}contents: read/);
  });
}

test('package-lock.json がコミットされ、lockfile と package.json が整合している', () => {
  for (const dir of ['community/gas/costume_portrait_survey', 'scripts/costume-portrait-survey']) {
    const pkg = JSON.parse(read(`${dir}/package.json`));
    const lock = JSON.parse(read(`${dir}/package-lock.json`));
    assert.strictEqual(lock.lockfileVersion >= 2, true, dir);
    assert.deepStrictEqual(lock.packages[''].devDependencies, pkg.devDependencies, dir);
  }
  const clasp = JSON.parse(read('scripts/costume-portrait-survey/package.json')).devDependencies['@google/clasp'];
  assert.match(clasp, /^\d+\.\d+\.\d+$/, 'claspは完全固定');
});

test('既存のfetish用 workflow / script を変更していない（新規ファイルのみ追加）', () => {
  const { execSync } = require('child_process');
  let diff = '';
  try { diff = execSync('git diff --name-only origin/main...HEAD', { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { return; }
  const touched = diff.split('\n').filter(Boolean);
  const forbidden = touched.filter((f) => /^community\/gas\/(nagoya_fetish_survey_|enquete_|classroom_)|snb-survey|prepare-snb-survey|deploy-snb-survey|^\.github\/workflows\/static\.yml/.test(f));
  assert.deepStrictEqual(forbidden, []);
});

test('リポジトリに認証情報・clasp設定が含まれない', () => {
  const { execSync } = require('child_process');
  const files = execSync('git ls-files', { cwd: REPO, encoding: 'utf8' }).split('\n').filter(Boolean);
  assert.deepStrictEqual(files.filter((f) => /(^|\/)\.clasprc\.json$|(^|\/)\.clasp\.json$/.test(f)), []);
  // テストファイル自身は検査パターンやダミー値を含むため対象外。
  // GAS Web Appの /exec URL（AKfycb...）は公開エンドポイントであり認証情報ではない。
  const newFiles = files.filter((f) => /costume[-_]portrait/.test(f) && !/package-lock\.json$/.test(f) && !/(^|\/)tests\//.test(f) && fs.statSync(path.join(REPO, f)).isFile());
  for (const f of newFiles) {
    const content = fs.readFileSync(path.join(REPO, f), 'utf8');
    assert.ok(!/refresh_token|access_token"\s*:\s*"[A-Za-z0-9._-]{20,}|ya29\./.test(content), f);
  }
});

test('admin: dry-run は access=MYSELF・executeAs=USER_DEPLOYING・scopeはspreadsheetsのみを検証する（Issue #363: OWNER 1名専用）', () => {
  const verify = job(workflows.admin, 'verify');
  assert.match(verify, /manifest\.webapp\.access !== 'MYSELF'/);
  assert.match(verify, /manifest\.webapp\.executeAs !== 'USER_DEPLOYING'/);
  assert.match(verify, /auth\/spreadsheets'/);
  assert.ok(!/external_request/.test(verify.replace(/No external_request[^']*/, '')));
  assert.ok(!/ANYONE_ANONYMOUS/.test(verify));
  // 旧GitHub Pages Admin（移行案内ページ）の変更でもPR検証が走る。削除済みの admin/ ディレクトリは対象外
  assert.match(workflows.admin, /community\/costume-portrait-survey-admin\.html/);
  assert.ok(!/costume-portrait-survey-admin\/\*\*/.test(workflows.admin));
});
