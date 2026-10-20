'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'PublicSnapshot.gs'), 'utf8');

test('PublicSnapshot.gs は SnapshotStore 未定義の読み込み順でもトップレベル評価で落ちない', () => {
  assert.doesNotThrow(() => vm.runInNewContext(source, {}));
});

test('SnapshotStore.SHEET_NAME はトップレベルで即時評価せず、関数実行時に遅延参照する', () => {
  assert.ok(!/var\s+SNAPSHOT_STORE_SHEET\s*=\s*SnapshotStore\.SHEET_NAME/.test(source));
  assert.match(source, /function\s+snapshotStoreSheetName_\s*\(\)\s*\{[\s\S]*return\s+SnapshotStore\.SHEET_NAME/);
});
