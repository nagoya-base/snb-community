#!/usr/bin/env bash
set -euo pipefail
umask 077

# Issue #380：名古屋野球ユニ部アンケート Public GAS を更新する。手動 dispatch のワークフローからのみ実行する（PR では実行しない）。
# 既存の Web App deployment を「更新」するだけで、deployment を新規作成せず、Script Properties・
# SPREADSHEET_ID・RESPONDENT_SALT・TEST_TOKEN・Web Appのアクセス設定には触れない（/exec URL は変わらない）。
#   CLASPRC_JSON                          GitHub Environment secret
#   BASEBALL_UNIFORM_SURVEY_SCRIPT_ID     GitHub Environment secret（対象GASのScript ID）
#   BASEBALL_UNIFORM_SURVEY_DEPLOYMENT_ID GitHub Environment secret（既存Web AppのDeployment ID）
#   BASEBALL_UNIFORM_SURVEY_SOURCE_SHA    配備するmain HEAD（ワークフローが github.sha を渡す）
# 受付期間（opens_at / closes_at）は survey.config.json（生成物に埋め込み済み）が正本で、このスクリプトは設定しない。
: "${GITHUB_WORKSPACE:?Repository checkout is required}"
: "${RUNNER_TEMP:?Runner temporary directory is required}"
: "${CLASPRC_JSON:?CLASPRC_JSON secret is required}"
: "${BASEBALL_UNIFORM_SURVEY_SCRIPT_ID:?BASEBALL_UNIFORM_SURVEY_SCRIPT_ID secret is required}"
: "${BASEBALL_UNIFORM_SURVEY_DEPLOYMENT_ID:?BASEBALL_UNIFORM_SURVEY_DEPLOYMENT_ID secret is required}"
: "${BASEBALL_UNIFORM_SURVEY_SOURCE_SHA:?Reviewed main SHA is required}"

prepare="$GITHUB_WORKSPACE/scripts/baseball-uniform-survey/prepare-gas.js"
deploy_root="$(mktemp -d "$RUNNER_TEMP/baseball-uniform-survey.XXXXXXXX")"
trap 'rm -rf "$deploy_root"' EXIT
auth_file="$deploy_root/.clasprc.json"
remote_dir="$deploy_root/remote"
project_dir="$deploy_root/project"
mkdir -p "$remote_dir" "$project_dir"

# 認証情報・Script ID・Deployment ID・clasp の生出力は一切表示しない。
AUTH_FILE="$auth_file" REMOTE_DIR="$remote_dir" node <<'NODE'
const fs = require('fs');
let auth;
try { auth = JSON.parse(process.env.CLASPRC_JSON); }
catch (_) { throw new Error('Invalid clasp authentication JSON.'); }
if (!auth || typeof auth !== 'object' || !Object.keys(auth).length) {
  throw new Error('Empty clasp authentication JSON.');
}
fs.writeFileSync(process.env.AUTH_FILE, process.env.CLASPRC_JSON, { mode: 0o600 });
fs.writeFileSync(process.env.REMOTE_DIR + '/.clasp.json',
  JSON.stringify({ scriptId: process.env.BASEBALL_UNIFORM_SURVEY_SCRIPT_ID, rootDir: '.' }), { mode: 0o600 });
NODE

cd "$remote_dir"
# 1) Deployment ID が、この Script ID の既存 deployment であること。
if ! clasp --auth "$auth_file" --json list-deployments >"$deploy_root/deployments-before.json" 2>/dev/null; then
  echo 'Cannot list existing GAS deployments with this clasp credential.' >&2
  exit 1
fi
DEPLOYMENTS="$deploy_root/deployments-before.json" node <<'NODE'
const fs = require('fs');
const deployments = JSON.parse(fs.readFileSync(process.env.DEPLOYMENTS, 'utf8'));
if (!Array.isArray(deployments) ||
    !deployments.some(item => item.deploymentId === process.env.BASEBALL_UNIFORM_SURVEY_DEPLOYMENT_ID)) {
  throw new Error('Deployment ID is not part of this existing GAS project.');
}
NODE

# 2) 現在のリモートが想定したプロジェクト（または空の初期状態）であること。違えば上書きしない。
if ! clasp --auth "$auth_file" pull >"$deploy_root/pull.log" 2>&1; then
  echo 'Cannot pull existing GAS project; refusing to push.' >&2
  exit 1
fi
if ! node "$prepare" validate-remote "$remote_dir"; then
  echo 'Existing project does not match the expected GAS project; refusing to replace it.' >&2
  exit 1
fi

# 3) allowlist のファイルと、リモートの webapp 設定を保った manifest をステージングして push。
if ! node "$prepare" stage "$GITHUB_WORKSPACE" "$project_dir" "$remote_dir"; then
  echo 'Failed to prepare the GAS bundle.' >&2
  exit 1
fi
cd "$project_dir"
if ! clasp --auth "$auth_file" show-file-status >"$deploy_root/status.log" 2>&1; then
  echo 'Cannot determine clasp push file status.' >&2
  exit 1
fi
echo "Pushing reviewed files to the existing baseball uniform survey GAS project."
if ! clasp --auth "$auth_file" push --force >"$deploy_root/push.log" 2>&1; then
  echo 'clasp push failed. No version or deployment update was attempted.' >&2
  exit 1
fi

# 4) 新しい version を作り、既存 deployment だけをその version に更新する（新規 deployment は作らない）。
if ! clasp --auth "$auth_file" --json create-version "baseball-uniform-survey public main ${BASEBALL_UNIFORM_SURVEY_SOURCE_SHA}" \
    >"$deploy_root/version.json" 2>"$deploy_root/version.log"; then
  echo 'Creating a GAS version failed. The existing Web App deployment was not updated.' >&2
  exit 1
fi
version_number="$(VERSION_FILE="$deploy_root/version.json" node <<'NODE'
const fs = require('fs');
const version = JSON.parse(fs.readFileSync(process.env.VERSION_FILE, 'utf8')).versionNumber;
if (!Number.isSafeInteger(version) || version < 1) throw new Error('Invalid GAS version number.');
process.stdout.write(String(version));
NODE
)"

if ! clasp --auth "$auth_file" --json update-deployment "$BASEBALL_UNIFORM_SURVEY_DEPLOYMENT_ID" \
    --versionNumber "$version_number" --description "baseball-uniform-survey public main ${BASEBALL_UNIFORM_SURVEY_SOURCE_SHA}" \
    >"$deploy_root/update.json" 2>"$deploy_root/update.log"; then
  echo 'Updating the existing Web App deployment failed.' >&2
  exit 1
fi
UPDATE_FILE="$deploy_root/update.json" VERSION="$version_number" node <<'NODE'
const fs = require('fs');
const result = JSON.parse(fs.readFileSync(process.env.UPDATE_FILE, 'utf8'));
if (result.deploymentId !== process.env.BASEBALL_UNIFORM_SURVEY_DEPLOYMENT_ID ||
    result.versionNumber !== Number(process.env.VERSION)) {
  throw new Error('Updated deployment ID or version differs from the requested existing deployment.');
}
NODE

# 5) 同じ deployment ID が新しい version を指していること（= /exec URL は維持されたまま）。
# Apps Script API は update-deployment 成功直後の list-deployments に旧 version を返すことがあるため、
# 一時的な反映遅延を false failure にしないよう短時間だけ再確認する。
verification_ok=0
for attempt in 1 2 3 4 5; do
  deployments_after="$deploy_root/deployments-after-$attempt.json"
  if clasp --auth "$auth_file" --json list-deployments >"$deployments_after" 2>/dev/null; then
    if DEPLOYMENTS="$deployments_after" VERSION="$version_number" node <<'NODE'
const fs = require('fs');
const deployments = JSON.parse(fs.readFileSync(process.env.DEPLOYMENTS, 'utf8'));
if (!Array.isArray(deployments)) process.exit(2);
const matches = deployments.some(item =>
  item.deploymentId === process.env.BASEBALL_UNIFORM_SURVEY_DEPLOYMENT_ID &&
  item.versionNumber === Number(process.env.VERSION));
process.exit(matches ? 0 : 1);
NODE
    then
      verification_ok=1
      break
    fi
  fi

  if [[ "$attempt" -lt 5 ]]; then
    echo "Deployment verification is not visible yet; retrying ($attempt/5)."
    sleep $((attempt * 2))
  fi
done

if [[ "$verification_ok" -ne 1 ]]; then
  echo 'The updated deployment did not become visible after retries.' >&2
  exit 1
fi

echo "Existing baseball uniform survey Web App deployment now references version $version_number."
