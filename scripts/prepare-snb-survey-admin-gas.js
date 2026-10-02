#!/usr/bin/env node
'use strict';

// Admin GAS staging. Intentionally separate from prepare-snb-survey-gas.js (public GAS):
// different source directory, different file allowlist, different identifiers.
const fs = require('fs');
const path = require('path');

const ROOT_DIR = 'community/gas/nagoya_fetish_survey_admin';
const SOURCE_FILES = ['Code.gs', 'Dashboard.html', 'DashboardStyles.html', 'DashboardScript.html'];
const MANIFEST = 'appsscript.json';
const PUBLIC_ROOT_DIR = 'community/gas/nagoya_fetish_survey_webapp';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// The repository has no admin manifest: the existing remote manifest (which carries the
// "MYSELF" Web App access setting) is staged unchanged. Refuse anything that is not "MYSELF".
function validateRemoteManifest(manifest) {
  if (!isPlainObject(manifest)) throw new Error('Existing admin GAS manifest must be a JSON object.');
  if (manifest.webapp !== undefined) {
    if (!isPlainObject(manifest.webapp) || manifest.webapp.access !== 'MYSELF') {
      throw new Error('Existing admin Web App access is not "MYSELF"; refusing to deploy.');
    }
  }
  return manifest;
}

function prepare(repoRoot, outputRoot, scriptId, remoteManifestPath) {
  if (!scriptId || !scriptId.trim() || scriptId !== scriptId.trim() || /\s/.test(scriptId)) {
    throw new Error('A single valid admin Script ID is required.');
  }
  if (!remoteManifestPath) throw new Error('The existing remote admin manifest is required.');
  if (fs.existsSync(outputRoot) && fs.readdirSync(outputRoot).length) {
    throw new Error('Deployment staging directory must be empty.');
  }
  const remoteManifest = validateRemoteManifest(JSON.parse(fs.readFileSync(remoteManifestPath, 'utf8')));
  const source = path.join(repoRoot, ROOT_DIR);
  if (ROOT_DIR.includes(PUBLIC_ROOT_DIR)) throw new Error('Admin source must not be the public GAS directory.');
  // Stage flat: clasp rootDir "." so only the files placed here are pushed.
  fs.mkdirSync(outputRoot, { recursive: true });
  for (const name of SOURCE_FILES) {
    const input = path.join(source, name);
    if (!fs.statSync(input).isFile()) throw new Error(`Missing admin GAS file: ${name}`);
    fs.copyFileSync(input, path.join(outputRoot, name));
  }
  fs.writeFileSync(path.join(outputRoot, MANIFEST), JSON.stringify(remoteManifest, null, 2) + '\n');
  fs.writeFileSync(path.join(outputRoot, '.clasp.json'),
    JSON.stringify({ scriptId, rootDir: '.' }) + '\n', { mode: 0o600 });
  return [...SOURCE_FILES, MANIFEST];
}

// clasp pull stores Apps Script files as .js (or .gs). Normalize and check against the allowlist.
function classifyRemoteFile(name) {
  const allowed = new Set([...SOURCE_FILES, MANIFEST]);
  let kind = 'other';
  let normalized = name;
  if (name === MANIFEST) kind = 'manifest';
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
    if (!repoRoot || !outputRoot || !remoteManifestPath) {
      throw new Error('Usage: prepare-snb-survey-admin-gas.js REPO_ROOT OUTPUT_ROOT REMOTE_MANIFEST');
    }
    prepare(repoRoot, outputRoot, process.env.SNB_SURVEY_ADMIN_SCRIPT_ID, remoteManifestPath);
    console.log('Prepared four admin GAS files plus the existing manifest.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { prepare, classifyRemoteFile, validateRemoteManifest, ROOT_DIR, SOURCE_FILES, MANIFEST };
