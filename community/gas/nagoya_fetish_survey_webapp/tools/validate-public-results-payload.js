'use strict';

/**
 * Issue #319：`/exec?view=results&format=json`（getPublicResults()の戻り値そのもの）を
 * 静的JSONとしてリポジトリへ取り込む前に通す、厳格な形状チェック。
 *
 * 「危険そうなキー名を拒否する」denylist方式ではなく、getPublicResults()が実際に返しうる
 * キーだけを列挙するallowlist方式にしている。理由：Code.gs側で将来キーが追加された場合
 * （例：分析用に何らかの識別子を混ぜてしまった場合）、denylistは想定していない新キー名を
 * 見逃すが、allowlistは未知のキーを問答無用で拒否するため、個人識別情報混入を「気づかず
 * 静的公開してしまう」事故を構造的に防げる。
 *
 * 氏名・メール・自由記述・UUID・ハッシュ・個別回答のタイムスタンプ等は、そもそも
 * getPublicResults()の集計処理（buildPublicResultsPayload_/buildPublicSimpleBreakdown_）が
 * 生成しない値であり、このバリデータもそれらのキー名を許可リストに含めない。
 */

function fail(errors, path, message) {
  errors.push(path + ': ' + message);
}

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validateItem(item, path, errors) {
  if (!isPlainObject(item)) {
    fail(errors, path, '項目はオブジェクトである必要があります');
    return;
  }
  var keys = Object.keys(item).sort();
  var allowed = ['count', 'name', 'percent'];
  if (keys.join(',') !== allowed.join(',')) {
    fail(errors, path, '許可されていないキーです（許可: name/count/percent）、実際: ' + keys.join(','));
    return;
  }
  if (typeof item.name !== 'string' || item.name === '') {
    fail(errors, path + '.name', '空でない文字列である必要があります');
  }
  if (typeof item.count !== 'number' || !isFinite(item.count) || item.count < 0 || Math.floor(item.count) !== item.count) {
    fail(errors, path + '.count', '0以上の整数である必要があります');
  }
  if (typeof item.percent !== 'number' || !isFinite(item.percent) || item.percent < 0 || item.percent > 100) {
    fail(errors, path + '.percent', '0〜100の数値である必要があります');
  }
}

function validateItems(items, path, errors) {
  if (!Array.isArray(items)) {
    fail(errors, path, '配列である必要があります');
    return;
  }
  items.forEach(function (item, i) { validateItem(item, path + '[' + i + ']', errors); });
}

function validateBranchBlock(block, path, errors) {
  if (!isPlainObject(block)) {
    fail(errors, path, 'オブジェクトである必要があります');
    return;
  }
  var keys = Object.keys(block).sort();
  if (keys.join(',') !== ['items', 'targetCount'].join(',')) {
    fail(errors, path, '許可されていないキーです（許可: targetCount/items）、実際: ' + keys.join(','));
    return;
  }
  if (typeof block.targetCount !== 'number' || block.targetCount < 0 || Math.floor(block.targetCount) !== block.targetCount) {
    fail(errors, path + '.targetCount', '0以上の整数である必要があります');
  }
  validateItems(block.items, path + '.items', errors);
}

function validateKeyedItemsGroup(obj, path, allowedKeys, errors) {
  if (!isPlainObject(obj)) {
    fail(errors, path, 'オブジェクトである必要があります');
    return;
  }
  var keys = Object.keys(obj).sort();
  var expected = ['targetCount'].concat(allowedKeys).sort();
  if (keys.join(',') !== expected.join(',')) {
    fail(errors, path, '許可されていないキーです（許可: ' + expected.join(',') + '）、実際: ' + keys.join(','));
    return;
  }
  if (typeof obj.targetCount !== 'number' || obj.targetCount < 0 || Math.floor(obj.targetCount) !== obj.targetCount) {
    fail(errors, path + '.targetCount', '0以上の整数である必要があります');
  }
  allowedKeys.forEach(function (key) { validateItems(obj[key], path + '.' + key, errors); });
}

var SUIT_KEYS = ['engagement', 'types', 'states', 'eventInterest'];
var STEP3_KEYS = [
  'frequency', 'price', 'groupSize', 'format', 'eventAwareness',
  'barriers', 'helpfulInformation', 'atmosphere', 'hypotheticalIntent', 'gap'
];

var SIMPLE_BREAKDOWN_KEYS = ['categories', 'primaryInterestCategory', 'engagement', 'region', 'age'];
var REQUIRED_BRANCH_BLOCK_KEYS = ['snbcAwareness', 'snbcInterest'];
var OPTIONAL_KEYS = ['snbcUncertainReasons', 'suit', 'step3', 'gapReasons'];

/**
 * getPublicResults()の戻り値を検証する。問題なければ{ ok: true }、
 * 1件以上の違反があれば{ ok: false, errors: string[] }を返す（例外は投げない。
 * CLI側で呼び出し結果に応じてexit codeを決める）。
 */
function validatePublicResultsPayload(payload) {
  var errors = [];

  if (!isPlainObject(payload)) {
    return { ok: false, errors: ['payload: オブジェクトである必要があります'] };
  }

  if (typeof payload.total !== 'number' || payload.total < 0 || Math.floor(payload.total) !== payload.total) {
    fail(errors, 'total', '0以上の整数である必要があります');
  }
  if (typeof payload.generatedAt !== 'string' || isNaN(Date.parse(payload.generatedAt))) {
    fail(errors, 'generatedAt', 'ISO日時文字列である必要があります');
  }
  if (typeof payload.ready !== 'boolean') {
    fail(errors, 'ready', 'boolean である必要があります');
  }

  if (payload.ready === false) {
    var pendingKeys = Object.keys(payload).sort();
    if (pendingKeys.join(',') !== ['generatedAt', 'ready', 'total'].join(',')) {
      fail(errors, 'payload', 'ready=falseのときはtotal/generatedAt/ready以外のキーを含めてはいけません（未確定値を公開しないため）、実際: ' + pendingKeys.join(','));
    }
    return errors.length === 0 ? { ok: true } : { ok: false, errors: errors };
  }

  var allowedTopKeys = ['total', 'generatedAt', 'ready']
    .concat(SIMPLE_BREAKDOWN_KEYS)
    .concat(REQUIRED_BRANCH_BLOCK_KEYS)
    .concat(OPTIONAL_KEYS);
  var topKeys = Object.keys(payload);
  topKeys.forEach(function (key) {
    if (allowedTopKeys.indexOf(key) === -1) {
      fail(errors, 'payload.' + key, '許可されていないトップレベルキーです（個人識別情報・生回答が混入していないか確認してください）');
    }
  });

  SIMPLE_BREAKDOWN_KEYS.forEach(function (key) {
    if (!(key in payload)) {
      fail(errors, key, 'ready=trueのとき必須です');
      return;
    }
    validateItems(payload[key], key, errors);
  });

  REQUIRED_BRANCH_BLOCK_KEYS.forEach(function (key) {
    if (!(key in payload)) {
      fail(errors, key, 'ready=trueのとき必須です');
      return;
    }
    validateBranchBlock(payload[key], key, errors);
  });

  if ('snbcUncertainReasons' in payload) validateBranchBlock(payload.snbcUncertainReasons, 'snbcUncertainReasons', errors);
  if ('suit' in payload) validateKeyedItemsGroup(payload.suit, 'suit', SUIT_KEYS, errors);
  if ('step3' in payload) validateKeyedItemsGroup(payload.step3, 'step3', STEP3_KEYS, errors);
  if ('gapReasons' in payload) validateBranchBlock(payload.gapReasons, 'gapReasons', errors);

  return errors.length === 0 ? { ok: true } : { ok: false, errors: errors };
}

module.exports = { validatePublicResultsPayload: validatePublicResultsPayload };
