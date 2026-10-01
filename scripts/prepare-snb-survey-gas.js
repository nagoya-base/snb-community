#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT_DIR = 'community/gas/nagoya_fetish_survey_webapp';
const FILES = [
  'Code.gs',
  'Index.html',
  'Results.html',
  'ResultsScript.html',
  'Script.html',
  'Styles.html',
  'appsscript.json'
];

// Manifest keys owned by this repository (values come from the repository manifest).
const MANAGED_MANIFEST_KEYS = ['timeZone', 'exceptionLogging', 'runtimeVersion', 'oauthScopes'];
// Manifest keys only preserved from the existing GAS project; never defined or changed here.
const PRESERVED_MANIFEST_KEYS = ['dependencies', 'webapp'];
const ALLOWED_MANIFEST_KEYS = new Set([...MANAGED_MANIFEST_KEYS, ...PRESERVED_MANIFEST_KEYS]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Classify top-level key names only (never values) for logging and the allowlist check.
function classifyManifestKeys(manifest) {
  if (!isPlainObject(manifest)) throw new Error('GAS manifest must be a JSON object.');
  return Object.keys(manifest).map(key => ({
    key,
    status: !ALLOWED_MANIFEST_KEYS.has(key) ? 'UNEXPECTED'
      : PRESERVED_MANIFEST_KEYS.includes(key) ? 'PRESERVED' : 'EXPECTED'
  }));
}

// Repository manifest wins for managed keys; dependencies/webapp are copied unchanged from the
// existing remote manifest (only if present) and may never be defined by the repository.
function stageManifest(repoManifest, remoteManifest) {
  const repoKeys = classifyManifestKeys(repoManifest);
  if (repoKeys.some(entry => entry.status !== 'EXPECTED')) {
    throw new Error('Repository manifest may only define the managed keys.');
  }
  const staged = JSON.parse(JSON.stringify(repoManifest));
  if (remoteManifest !== undefined) {
    if (classifyManifestKeys(remoteManifest).some(entry => entry.status === 'UNEXPECTED')) {
      throw new Error('Existing GAS manifest has additional settings; review before overwriting.');
    }
    for (const key of PRESERVED_MANIFEST_KEYS) {
      if (Object.prototype.hasOwnProperty.call(remoteManifest, key)) {
        staged[key] = JSON.parse(JSON.stringify(remoteManifest[key]));
      }
    }
  }
  return staged;
}

function prepare(repoRoot, outputRoot, scriptId, remoteManifestPath) {
  if (!scriptId || !scriptId.trim() || scriptId !== scriptId.trim() || /\s/.test(scriptId)) {
    throw new Error('A single valid Script ID is required.');
  }
  if (fs.existsSync(outputRoot) && fs.readdirSync(outputRoot).length) {
    throw new Error('Deployment staging directory must be empty.');
  }
  const source = path.join(repoRoot, ROOT_DIR);
  const target = path.join(outputRoot, ROOT_DIR);
  fs.mkdirSync(target, { recursive: true });
  for (const name of FILES) {
    const input = path.join(source, name);
    if (!fs.statSync(input).isFile()) throw new Error(`Missing GAS file: ${name}`);
    fs.copyFileSync(input, path.join(target, name));
  }
  const manifestPath = path.join(target, 'appsscript.json');
  const remoteManifest = remoteManifestPath
    ? JSON.parse(fs.readFileSync(remoteManifestPath, 'utf8')) : undefined;
  // Only the staging copy is rewritten; the repository manifest is never modified.
  const staged = stageManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')), remoteManifest);
  fs.writeFileSync(manifestPath, JSON.stringify(staged, null, 2) + '\n');
  fs.writeFileSync(path.join(outputRoot, '.clasp.json'),
    JSON.stringify({ scriptId, rootDir: ROOT_DIR }) + '\n', { mode: 0o600 });
  return FILES;
}

// clasp pull stores Apps Script files as .js (or .gs depending on configuration).
// Map each pulled name to its allowlisted repository name; unknown names stay unexpected.
function classifyRemoteFile(name) {
  const allowed = new Set(FILES);
  let kind = 'other';
  let normalized = name;
  if (name === 'appsscript.json') kind = 'manifest';
  else if (/^[^/\\]+\.html$/.test(name)) kind = 'html';
  else if (/^[^/\\]+\.(js|gs)$/.test(name)) {
    kind = 'script';
    normalized = name.replace(/\.js$/, '.gs');
  }
  return { name, kind, normalized, expected: kind !== 'other' && allowed.has(normalized) };
}

if (require.main === module) {
  try {
    const [repoRoot, outputRoot, remoteManifestPath] = process.argv.slice(2);
    if (!repoRoot || !outputRoot) {
      throw new Error('Usage: prepare-snb-survey-gas.js REPO_ROOT OUTPUT_ROOT [REMOTE_MANIFEST]');
    }
    prepare(repoRoot, outputRoot, process.env.SNB_SURVEY_SCRIPT_ID, remoteManifestPath);
    console.log('Prepared seven allowlisted GAS files.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { prepare, classifyRemoteFile, classifyManifestKeys, stageManifest,
  MANAGED_MANIFEST_KEYS, PRESERVED_MANIFEST_KEYS, ROOT_DIR, FILES };
