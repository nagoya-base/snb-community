#!/usr/bin/env bash
set -euo pipefail
umask 077

# Issue #390：名古屋野球ユニ部アンケート Public / Admin / maintenance GAS の「初回 bootstrap」。手動 dispatch の bootstrap workflow からのみ実行する（PR では実行しない）。
# 空の初期 project（手動作成済み・placeholder のみ）へ allowlist のファイルを clasp push するだけ。次は一切行わない:
#   - version の作成 / deployment の新規作成・更新（clasp create-version / create-deployment / update-deployment）
#   - Web App のアクセス設定の変更（manifest の webapp はリポジトリ側の MYSELF / USER_DEPLOYING。deployment が無いので公開範囲は生まれない）
#   - Script Properties の設定 / 関数の実行（clasp run）
# bootstrap 済み（target のファイルが既にある）か、versioned deployment が既にある project は拒否する。以降は通常の deploy workflow を使う。
#   BASEBALL_UNIFORM_SURVEY_TARGET   public | admin | maintenance（workflow が渡す）
#   CLASPRC_JSON                     GitHub Environment secret
#   target 専用の bootstrap Script ID（専用 Environment Secret。他 target / 通常 deploy 用の ID が環境にあれば拒否）
#     public       BASEBALL_UNIFORM_SURVEY_PUBLIC_BOOTSTRAP_SCRIPT_ID
#     admin        BASEBALL_UNIFORM_SURVEY_ADMIN_BOOTSTRAP_SCRIPT_ID
#     maintenance  BASEBALL_UNIFORM_SURVEY_MAINTENANCE_BOOTSTRAP_SCRIPT_ID
: "${GITHUB_WORKSPACE:?Repository checkout is required}"
: "${RUNNER_TEMP:?Runner temporary directory is required}"
: "${BASEBALL_UNIFORM_SURVEY_TARGET:?BASEBALL_UNIFORM_SURVEY_TARGET (public|admin|maintenance) is required}"
: "${CLASPRC_JSON:?CLASPRC_JSON secret is required}"

target="$BASEBALL_UNIFORM_SURVEY_TARGET"
case "$target" in
  public)      script_id_var=BASEBALL_UNIFORM_SURVEY_PUBLIC_BOOTSTRAP_SCRIPT_ID ;;
  admin)       script_id_var=BASEBALL_UNIFORM_SURVEY_ADMIN_BOOTSTRAP_SCRIPT_ID ;;
  maintenance) script_id_var=BASEBALL_UNIFORM_SURVEY_MAINTENANCE_BOOTSTRAP_SCRIPT_ID ;;
  *) echo 'BASEBALL_UNIFORM_SURVEY_TARGET must be "public", "admin" or "maintenance".' >&2; exit 1 ;;
esac
for var in BASEBALL_UNIFORM_SURVEY_SCRIPT_ID BASEBALL_UNIFORM_SURVEY_DEPLOYMENT_ID BASEBALL_UNIFORM_SURVEY_PUBLIC_BOOTSTRAP_SCRIPT_ID \
           BASEBALL_UNIFORM_SURVEY_ADMIN_SCRIPT_ID BASEBALL_UNIFORM_SURVEY_ADMIN_DEPLOYMENT_ID BASEBALL_UNIFORM_SURVEY_ADMIN_BOOTSTRAP_SCRIPT_ID \
           BASEBALL_UNIFORM_SURVEY_MAINTENANCE_SCRIPT_ID BASEBALL_UNIFORM_SURVEY_MAINTENANCE_DEPLOYMENT_ID BASEBALL_UNIFORM_SURVEY_MAINTENANCE_BOOTSTRAP_SCRIPT_ID; do
  if [[ "$var" != "$script_id_var" && -n "${!var:-}" ]]; then
    echo "Refusing to bootstrap $target: an ID other than its bootstrap Script ID is present in the environment. Nothing was changed." >&2
    exit 1
  fi
done
script_id="${!script_id_var:-}"
[[ -n "$script_id" ]] || { echo "Bootstrap Script ID secret for $target is required." >&2; exit 1; }
export BASEBALL_UNIFORM_SURVEY_GAS_SCRIPT_ID="$script_id"

prepare="$GITHUB_WORKSPACE/scripts/baseball-uniform-survey/prepare-gas.js"
deploy_root="$(mktemp -d "$RUNNER_TEMP/baseball-uniform-survey-bootstrap-$target.XXXXXXXX")"
trap 'rm -rf "$deploy_root"' EXIT
auth_file="$deploy_root/.clasprc.json"
remote_dir="$deploy_root/remote"
project_dir="$deploy_root/project"
mkdir -p "$remote_dir" "$project_dir"

# 認証情報・Script ID・clasp の生出力は一切表示しない。
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
  JSON.stringify({ scriptId: process.env.BASEBALL_UNIFORM_SURVEY_GAS_SCRIPT_ID, rootDir: '.' }), { mode: 0o600 });
NODE

cd "$remote_dir"
# 1) まだ versioned deployment が無い（= Web App 未公開の）project であること。HEAD deployment（versionNumber なし）は許可。
if ! clasp --auth "$auth_file" --json list-deployments >"$deploy_root/deployments.json" 2>/dev/null; then
  echo 'Cannot list existing GAS deployments with this clasp credential.' >&2
  exit 1
fi
if ! DEPLOYMENTS="$deploy_root/deployments.json" node <<'NODE'
const fs = require('fs');
const deployments = JSON.parse(fs.readFileSync(process.env.DEPLOYMENTS, 'utf8'));
if (!Array.isArray(deployments)) process.exit(2);
process.exit(deployments.some(item => item.versionNumber !== undefined && item.versionNumber !== null) ? 1 : 0);
NODE
then
  echo 'This GAS project already has a versioned deployment (already bootstrapped?). Use the regular deploy workflow. Nothing was changed.' >&2
  exit 1
fi

# 2) リモートが空の初期 project（placeholder のみ）であること。bootstrap 済み・別 project・手書きコードは上書きしない。
if ! clasp --auth "$auth_file" pull >"$deploy_root/pull.log" 2>&1; then
  echo 'Cannot pull existing GAS project; refusing to push.' >&2
  exit 1
fi
if ! node "$prepare" validate-bootstrap-remote "$target" "$remote_dir"; then
  echo 'Existing project is not an empty initial GAS project for this target; refusing to bootstrap.' >&2
  exit 1
fi

# 3) allowlist のファイルだけをステージングして push（version / deployment には触れない）。
if ! BASEBALL_UNIFORM_SURVEY_PUBLIC_BOOTSTRAP_SCRIPT_ID="${BASEBALL_UNIFORM_SURVEY_PUBLIC_BOOTSTRAP_SCRIPT_ID:-}" \
     BASEBALL_UNIFORM_SURVEY_ADMIN_BOOTSTRAP_SCRIPT_ID="${BASEBALL_UNIFORM_SURVEY_ADMIN_BOOTSTRAP_SCRIPT_ID:-}" \
     BASEBALL_UNIFORM_SURVEY_MAINTENANCE_BOOTSTRAP_SCRIPT_ID="${BASEBALL_UNIFORM_SURVEY_MAINTENANCE_BOOTSTRAP_SCRIPT_ID:-}" \
     node "$prepare" stage-bootstrap "$target" "$GITHUB_WORKSPACE" "$project_dir" "$remote_dir"; then
  echo 'Failed to prepare the GAS bundle.' >&2
  exit 1
fi
cd "$project_dir"
if ! clasp --auth "$auth_file" show-file-status >"$deploy_root/status.log" 2>&1; then
  echo 'Cannot determine clasp push file status.' >&2
  exit 1
fi
echo "Pushing reviewed files to the empty baseball uniform survey $target GAS project (bootstrap; no version or deployment is created)."
if ! clasp --auth "$auth_file" push --force >"$deploy_root/push.log" 2>&1; then
  echo 'clasp push failed.' >&2
  exit 1
fi
echo "Bootstrap push for $target is complete. Next (manual): OAuth approval, Script Properties, first Web App deployment. Then use the regular deploy workflow; do not run this workflow again."
