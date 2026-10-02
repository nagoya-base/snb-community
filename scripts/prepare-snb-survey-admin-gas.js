#!/usr/bin/env node
'use strict';

// Admin GAS staging. Intentionally separate from prepare-snb-survey-gas.js (public GAS):
// different source directory, different file allowlist, different identifiers.
const fs = require('fs');
const path = require('path');

const ROOT_DIR = 'community/gas/nagoya_fetish_survey_admin';
const SOURCE_FILES = ['Code.gs', 'Dashboard.html', 'DashboardStyles.html', 'DashboardScript.html'];
const MANIFEST = 'appsscript.json';
// Remote naming profiles, keyed by canonical (GitHub) name. clasp pull of the current production
// admin GAS yields the legacy names; staging reuses the remote's own names so that clasp push
// updates the existing files in place instead of adding differently named ones.
const REMOTE_PROFILES = {
  canonical: {
    'Code.gs': ['Code.js', 'Code.gs'],
    'Dashboard.html': ['Dashboard.html'],
    'DashboardStyles.html': ['DashboardStyles.html'],
    'DashboardScript.html': ['DashboardScript.html'],
  },
  legacy: {
    'Code.gs': ['コード.js', 'コード.gs'],
    'Dashboard.html': ['Dashboard.html.html'],
    'DashboardStyles.html': ['DashboardStyles.html.html'],
    'DashboardScript.html': ['DashboardScript.html.html'],
  },
  // Observed production (clasp pull): コード.js plus plain *.html names.
  production_current: {
    'Code.gs': ['コード.js', 'コード.gs'],
    'Dashboard.html': ['Dashboard.html'],
    'DashboardStyles.html': ['DashboardStyles.html'],
    'DashboardScript.html': ['DashboardScript.html'],
  },
};
// Staging (clasp push) name per profile. Apps Script derives the remote file name from it:
// コード.gs -> "コード", Dashboard.html.html -> "Dashboard.html".
const STAGING_NAMES = {
  canonical: { 'Code.gs': 'Code.gs', 'Dashboard.html': 'Dashboard.html',
    'DashboardStyles.html': 'DashboardStyles.html', 'DashboardScript.html': 'DashboardScript.html' },
  legacy: { 'Code.gs': 'コード.gs', 'Dashboard.html': 'Dashboard.html.html',
    'DashboardStyles.html': 'DashboardStyles.html.html', 'DashboardScript.html': 'DashboardScript.html.html' },
  production_current: { 'Code.gs': 'コード.gs', 'Dashboard.html': 'Dashboard.html',
    'DashboardStyles.html': 'DashboardStyles.html', 'DashboardScript.html': 'DashboardScript.html' },
};
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

// Decide the remote naming profile from the names clasp pull produced. Fail closed on anything
// unexpected, duplicated (alias + canonical, .js + .gs) or mixed between profiles.
function detectRemoteProfile(names) {
  const list = names.map(name => name.normalize('NFC'));
  if (!list.includes(MANIFEST)) throw new Error('Existing admin GAS manifest is missing.');
  const files = list.filter(name => name !== MANIFEST);
  const matches = [];
  for (const [profile, table] of Object.entries(REMOTE_PROFILES)) {
    const used = new Set();
    let complete = true;
    for (const aliases of Object.values(table)) {
      const found = aliases.filter(alias => files.includes(alias));
      if (found.length !== 1) { complete = false; break; }
      used.add(found[0]);
    }
    if (complete && used.size === files.length && files.length === SOURCE_FILES.length) {
      matches.push(profile);
    }
  }
  if (matches.length !== 1) {
    throw new Error('Existing project is not the admin GAS project (unexpected files); refusing to replace them.');
  }
  return matches[0];
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
  // The pulled project (manifest's directory) decides the staging names.
  const remoteDir = path.dirname(remoteManifestPath);
  const remoteNames = fs.readdirSync(remoteDir).filter(name => !name.startsWith('.'));
  for (const name of remoteNames) {
    if (!fs.statSync(path.join(remoteDir, name)).isFile()) {
      throw new Error('Existing project is not the admin GAS project (unexpected files); refusing to replace them.');
    }
  }
  const stagingNames = STAGING_NAMES[detectRemoteProfile(remoteNames)];
  const source = path.join(repoRoot, ROOT_DIR);
  if (ROOT_DIR.includes(PUBLIC_ROOT_DIR)) throw new Error('Admin source must not be the public GAS directory.');
  // Stage flat: clasp rootDir "." so only the files placed here are pushed.
  fs.mkdirSync(outputRoot, { recursive: true });
  for (const name of SOURCE_FILES) {
    const input = path.join(source, name);
    if (!fs.statSync(input).isFile()) throw new Error(`Missing admin GAS file: ${name}`);
    fs.copyFileSync(input, path.join(outputRoot, stagingNames[name]));
  }
  fs.writeFileSync(path.join(outputRoot, MANIFEST), JSON.stringify(remoteManifest, null, 2) + '\n');
  fs.writeFileSync(path.join(outputRoot, '.clasp.json'),
    JSON.stringify({ scriptId, rootDir: '.' }) + '\n', { mode: 0o600 });
  return [...SOURCE_FILES.map(name => stagingNames[name]), MANIFEST];
}

// Per-file classification for diagnostics: maps a pulled name to its canonical (GitHub) name.
// Profile consistency, duplicates and completeness are enforced by detectRemoteProfile().
function classifyRemoteFile(name) {
  const nfc = name.normalize('NFC');
  let kind = 'other';
  let normalized = name;
  if (nfc === MANIFEST) { kind = 'manifest'; normalized = MANIFEST; }
  else {
    for (const table of Object.values(REMOTE_PROFILES)) {
      for (const [canonical, aliases] of Object.entries(table)) {
        if (aliases.includes(nfc)) {
          kind = canonical.endsWith('.html') ? 'html' : 'script';
          normalized = canonical;
        }
      }
    }
  }
  return { name, kind, normalized, expected: kind !== 'other' };
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

module.exports = { prepare, classifyRemoteFile, detectRemoteProfile, REMOTE_PROFILES, STAGING_NAMES, validateRemoteManifest, ROOT_DIR, SOURCE_FILES, MANIFEST };
