#!/usr/bin/env bash
set -euo pipefail
umask 077

# Admin GAS only. Run only from the manually dispatched admin workflow, never from PR CI.
# Updates the EXISTING admin Web App deployment; never creates a deployment, never changes
# Script Properties, SPREADSHEET_ID or access settings.
: "${GITHUB_WORKSPACE:?Repository checkout is required}"
: "${RUNNER_TEMP:?Runner temporary directory is required}"
: "${CLASPRC_JSON:?CLASPRC_JSON secret is required}"
: "${SNB_SURVEY_ADMIN_SCRIPT_ID:?SNB_SURVEY_ADMIN_SCRIPT_ID secret is required}"
: "${SNB_SURVEY_ADMIN_DEPLOYMENT_ID:?SNB_SURVEY_ADMIN_DEPLOYMENT_ID secret is required}"
: "${SNB_SURVEY_ADMIN_SOURCE_SHA:?Reviewed main SHA is required}"

deploy_root="$(mktemp -d "$RUNNER_TEMP/snb-survey-admin-deploy.XXXXXXXX")"
trap 'rm -rf "$deploy_root"' EXIT
auth_file="$deploy_root/.clasprc.json"
remote_dir="$deploy_root/remote"
project_dir="$deploy_root/project"
mkdir -p "$remote_dir" "$project_dir"

# Never print credentials, script identifiers, deployment identifiers or raw clasp output.
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
  JSON.stringify({ scriptId: process.env.SNB_SURVEY_ADMIN_SCRIPT_ID, rootDir: '.' }),
  { mode: 0o600 });
NODE

cd "$remote_dir"
# Deployment ownership: the deployment ID must belong to the admin script ID.
if ! clasp --auth "$auth_file" --json list-deployments >"$deploy_root/deployments-before.json" 2>/dev/null; then
  echo 'Cannot list existing admin GAS deployments with this clasp credential.' >&2
  exit 1
fi
DEPLOYMENTS="$deploy_root/deployments-before.json" node <<'NODE'
const fs = require('fs');
const deployments = JSON.parse(fs.readFileSync(process.env.DEPLOYMENTS, 'utf8'));
if (!Array.isArray(deployments) ||
    !deployments.some(item => item.deploymentId === process.env.SNB_SURVEY_ADMIN_DEPLOYMENT_ID)) {
  throw new Error('Deployment ID is not part of this existing admin GAS project.');
}
NODE

# Script ID check: the pulled project must be exactly the admin project (no public GAS files).
if ! clasp --auth "$auth_file" pull >"$deploy_root/pull.log" 2>&1; then
  echo 'Cannot pull existing admin GAS project; refusing to push.' >&2
  exit 1
fi
REMOTE_DIR="$remote_dir" node <<'NODE'
const fs = require('fs');
const path = require('path');
const { classifyRemoteFile, detectRemoteProfile, validateRemoteManifest } =
  require(process.env.GITHUB_WORKSPACE + '/scripts/prepare-snb-survey-admin-gas.js');
const existing = fs.readdirSync(process.env.REMOTE_DIR).filter(name => !name.startsWith('.'));
// Diagnostic output: file names and classification only, never contents or identifiers.
const entries = existing.sort().map(name => {
  const entry = classifyRemoteFile(name);
  const isFile = fs.statSync(path.join(process.env.REMOTE_DIR, name)).isFile();
  return { ...entry, expected: entry.expected && isFile, kind: isFile ? entry.kind : 'directory' };
});
console.log('Existing admin GAS files after clasp pull (' + entries.length + '):');
for (const entry of entries) {
  console.log('  ' + JSON.stringify(entry.name) + ' kind=' + entry.kind +
    ' normalized=' + JSON.stringify(entry.normalized) +
    ' ' + (entry.expected ? 'EXPECTED' : 'UNEXPECTED'));
}
// The remote must match exactly one naming profile (canonical or current production legacy):
// no mixes, no alias + canonical duplicates, no extra or missing files, no directories.
let profile = null;
try { profile = detectRemoteProfile(existing); } catch (_) { /* reported below */ }
if (!profile || entries.some(entry => entry.kind === 'directory')) {
  throw new Error('Existing project is not the admin GAS project (unexpected files); refusing to replace them.');
}
console.log('Remote naming profile: ' + profile);
validateRemoteManifest(JSON.parse(fs.readFileSync(path.join(process.env.REMOTE_DIR, 'appsscript.json'), 'utf8')));
NODE

# Stage four admin files + the unchanged remote manifest into a clean directory.
SNB_SURVEY_ADMIN_SCRIPT_ID="$SNB_SURVEY_ADMIN_SCRIPT_ID" \
  node "$GITHUB_WORKSPACE/scripts/prepare-snb-survey-admin-gas.js" "$GITHUB_WORKSPACE" "$project_dir" \
  "$remote_dir/appsscript.json"
cd "$project_dir"
if ! clasp --auth "$auth_file" show-file-status >"$deploy_root/status.log" 2>&1; then
  echo 'Cannot determine clasp push file status.' >&2
  exit 1
fi
echo 'Pushing reviewed files to the existing admin GAS project.'
if ! clasp --auth "$auth_file" push --force >"$deploy_root/push.log" 2>&1; then
  echo 'clasp push failed. No version or deployment update was attempted.' >&2
  exit 1
fi

if ! clasp --auth "$auth_file" --json create-version "admin main ${SNB_SURVEY_ADMIN_SOURCE_SHA}" \
    >"$deploy_root/version.json" 2>"$deploy_root/version.log"; then
  echo 'Creating an admin GAS version failed. Existing Web App deployment was not updated.' >&2
  exit 1
fi
version_number="$(VERSION_FILE="$deploy_root/version.json" node <<'NODE'
const fs = require('fs');
const version = JSON.parse(fs.readFileSync(process.env.VERSION_FILE, 'utf8')).versionNumber;
if (!Number.isSafeInteger(version) || version < 1) throw new Error('Invalid GAS version number.');
process.stdout.write(String(version));
NODE
)"

if ! clasp --auth "$auth_file" --json update-deployment "$SNB_SURVEY_ADMIN_DEPLOYMENT_ID" \
    --versionNumber "$version_number" --description "admin main ${SNB_SURVEY_ADMIN_SOURCE_SHA}" \
    >"$deploy_root/update.json" 2>"$deploy_root/update.log"; then
  echo 'Updating the existing admin Web App deployment failed.' >&2
  exit 1
fi
UPDATE_FILE="$deploy_root/update.json" VERSION="$version_number" node <<'NODE'
const fs = require('fs');
const result = JSON.parse(fs.readFileSync(process.env.UPDATE_FILE, 'utf8'));
if (result.deploymentId !== process.env.SNB_SURVEY_ADMIN_DEPLOYMENT_ID ||
    result.versionNumber !== Number(process.env.VERSION)) {
  throw new Error('Updated deployment ID or version differs from the requested existing deployment.');
}
NODE

if ! clasp --auth "$auth_file" --json list-deployments >"$deploy_root/deployments-after.json" 2>/dev/null; then
  echo 'Updated deployment could not be listed for verification.' >&2
  exit 1
fi
DEPLOYMENTS="$deploy_root/deployments-after.json" VERSION="$version_number" node <<'NODE'
const fs = require('fs');
const deployments = JSON.parse(fs.readFileSync(process.env.DEPLOYMENTS, 'utf8'));
if (!Array.isArray(deployments) ||
    !deployments.some(item => item.deploymentId === process.env.SNB_SURVEY_ADMIN_DEPLOYMENT_ID &&
      item.versionNumber === Number(process.env.VERSION))) {
  throw new Error('The existing deployment does not reference the newly created version.');
}
NODE
echo "Existing admin Web App deployment now references version $version_number."
