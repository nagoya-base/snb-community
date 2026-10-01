#!/usr/bin/env bash
set -euo pipefail
umask 077

# Only run this script from the manually dispatched workflow, never from PR CI.
: "${GITHUB_WORKSPACE:?Repository checkout is required}"
: "${RUNNER_TEMP:?Runner temporary directory is required}"
: "${CLASPRC_JSON:?CLASPRC_JSON secret is required}"
: "${SNB_SURVEY_SCRIPT_ID:?SNB_SURVEY_SCRIPT_ID secret is required}"
: "${SNB_SURVEY_DEPLOYMENT_ID:?SNB_SURVEY_DEPLOYMENT_ID secret is required}"
: "${SNB_SURVEY_SOURCE_SHA:?Reviewed PR head SHA is required}"

deploy_root="$(mktemp -d "$RUNNER_TEMP/snb-survey-deploy.XXXXXXXX")"
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
  JSON.stringify({ scriptId: process.env.SNB_SURVEY_SCRIPT_ID, rootDir: '.' }),
  { mode: 0o600 });
NODE

cd "$remote_dir"
if ! clasp --auth "$auth_file" --json list-deployments >"$deploy_root/deployments-before.json" 2>/dev/null; then
  echo 'Cannot list existing GAS deployments with this clasp credential.' >&2
  exit 1
fi
DEPLOYMENTS="$deploy_root/deployments-before.json" node <<'NODE'
const fs = require('fs');
const deployments = JSON.parse(fs.readFileSync(process.env.DEPLOYMENTS, 'utf8'));
if (!Array.isArray(deployments) ||
    !deployments.some(item => item.deploymentId === process.env.SNB_SURVEY_DEPLOYMENT_ID)) {
  throw new Error('Deployment ID is not part of this existing GAS project.');
}
NODE

# Refuse to overwrite an unexpected remote project rather than deleting its files.
if ! clasp --auth "$auth_file" pull >"$deploy_root/pull.log" 2>&1; then
  echo 'Cannot pull existing GAS project; refusing to push.' >&2
  exit 1
fi
REMOTE_DIR="$remote_dir" node <<'NODE'
const fs = require('fs');
const path = require('path');
const { classifyRemoteFile } = require(process.env.GITHUB_WORKSPACE + '/scripts/prepare-snb-survey-gas');
const existing = fs.readdirSync(process.env.REMOTE_DIR)
  .filter(name => !name.startsWith('.'));
// Diagnostic output: file names and classification only, never contents or identifiers.
const entries = existing.sort().map(name => {
  const entry = classifyRemoteFile(name);
  const isFile = fs.statSync(path.join(process.env.REMOTE_DIR, name)).isFile();
  return { ...entry, expected: entry.expected && isFile, kind: isFile ? entry.kind : 'directory' };
});
console.log('Existing GAS files after clasp pull (' + entries.length + '):');
for (const entry of entries) {
  console.log('  ' + JSON.stringify(entry.name) + ' kind=' + entry.kind +
    ' normalized=' + JSON.stringify(entry.normalized) +
    ' ' + (entry.expected ? 'EXPECTED' : 'UNEXPECTED'));
}
const normalizedNames = entries.map(entry => entry.normalized);
if (!existing.includes('appsscript.json') ||
    entries.some(entry => !entry.expected) ||
    new Set(normalizedNames).size !== normalizedNames.length) {
  throw new Error('Existing GAS project contains unexpected files; refusing to replace them.');
}
const manifest = JSON.parse(fs.readFileSync(path.join(process.env.REMOTE_DIR, 'appsscript.json'), 'utf8'));
const allowedKeys = new Set(['timeZone', 'exceptionLogging', 'runtimeVersion', 'oauthScopes']);
// Diagnostic output: top-level key names and classification only, never values.
const manifestKeys = Object.keys(manifest);
console.log('Existing GAS manifest keys:');
for (const key of manifestKeys) {
  console.log('  ' + JSON.stringify(key) + ' ' + (allowedKeys.has(key) ? 'EXPECTED' : 'UNEXPECTED'));
}
if (manifestKeys.some(key => !allowedKeys.has(key))) {
  throw new Error('Existing GAS manifest has additional settings; review before overwriting.');
}
const next = JSON.parse(fs.readFileSync(path.join(process.env.GITHUB_WORKSPACE,
  'community/gas/nagoya_fetish_survey_webapp/appsscript.json'), 'utf8'));
if (Array.isArray(manifest.oauthScopes) &&
    manifest.oauthScopes.some(scope => !next.oauthScopes.includes(scope))) {
  throw new Error('Existing GAS manifest has additional OAuth scopes; review before overwriting.');
}
NODE

node "$GITHUB_WORKSPACE/scripts/prepare-snb-survey-gas.js" "$GITHUB_WORKSPACE" "$project_dir"
cd "$project_dir"
if ! clasp --auth "$auth_file" show-file-status >"$deploy_root/status.log" 2>&1; then
  echo 'Cannot determine clasp push file status.' >&2
  exit 1
fi
echo 'Pushing reviewed files to the existing GAS project.'
if ! clasp --auth "$auth_file" push --force >"$deploy_root/push.log" 2>&1; then
  echo 'clasp push failed. No version or deployment update was attempted.' >&2
  exit 1
fi

if ! clasp --auth "$auth_file" --json create-version "main ${SNB_SURVEY_SOURCE_SHA}" \
    >"$deploy_root/version.json" 2>"$deploy_root/version.log"; then
  echo 'Creating a GAS version failed. Existing Web App deployment was not updated.' >&2
  exit 1
fi
version_number="$(VERSION_FILE="$deploy_root/version.json" node <<'NODE'
const fs = require('fs');
const version = JSON.parse(fs.readFileSync(process.env.VERSION_FILE, 'utf8')).versionNumber;
if (!Number.isSafeInteger(version) || version < 1) throw new Error('Invalid GAS version number.');
process.stdout.write(String(version));
NODE
)"

if ! clasp --auth "$auth_file" --json update-deployment "$SNB_SURVEY_DEPLOYMENT_ID" \
    --versionNumber "$version_number" --description "main ${SNB_SURVEY_SOURCE_SHA}" \
    >"$deploy_root/update.json" 2>"$deploy_root/update.log"; then
  echo 'Updating the existing Web App deployment failed.' >&2
  exit 1
fi
UPDATE_FILE="$deploy_root/update.json" VERSION="$version_number" node <<'NODE'
const fs = require('fs');
const result = JSON.parse(fs.readFileSync(process.env.UPDATE_FILE, 'utf8'));
if (result.deploymentId !== process.env.SNB_SURVEY_DEPLOYMENT_ID ||
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
    !deployments.some(item => item.deploymentId === process.env.SNB_SURVEY_DEPLOYMENT_ID &&
      item.versionNumber === Number(process.env.VERSION))) {
  throw new Error('The existing deployment does not reference the newly created version.');
}
NODE
echo "Existing Web App deployment now references version $version_number."
