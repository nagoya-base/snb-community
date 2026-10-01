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

function prepare(repoRoot, outputRoot, scriptId) {
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
  JSON.parse(fs.readFileSync(path.join(target, 'appsscript.json'), 'utf8'));
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
    const [repoRoot, outputRoot] = process.argv.slice(2);
    if (!repoRoot || !outputRoot) throw new Error('Usage: prepare-snb-survey-gas.js REPO_ROOT OUTPUT_ROOT');
    prepare(repoRoot, outputRoot, process.env.SNB_SURVEY_SCRIPT_ID);
    console.log('Prepared seven allowlisted GAS files.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { prepare, classifyRemoteFile, ROOT_DIR, FILES };
