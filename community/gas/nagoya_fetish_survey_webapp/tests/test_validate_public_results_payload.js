'use strict';

// Issue #319：静的公開データの検証ロジック（tools/validate-public-results-payload.js）のテスト。
// 「allowlistに無いキーは個人識別情報混入の疑いとして問答無用で拒否する」という設計そのものを
// 検証する（正常系だけでなく、危険なキーが混入したケースを確実に弾けることを確認する）。

const { validatePublicResultsPayload } = require('../tools/validate-public-results-payload');

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failures++;
  } else {
    console.log('OK:', msg);
  }
}

function item(name, count, percent) { return { name, count, percent }; }

function minimalReadyPayload(overrides) {
  return Object.assign({
    total: 20,
    generatedAt: new Date().toISOString(),
    ready: true,
    categories: [item('野球ユニフォーム', 8, 40)],
    primaryInterestCategory: [item('野球ユニフォーム', 12, 60)],
    engagement: [item('自分で着たい', 10, 50)],
    region: [item('関東', 10, 50)],
    age: [item('20代以下', 10, 50)],
    snbcAwareness: { targetCount: 5, items: [item('知っている', 3, 60)] },
    snbcInterest: { targetCount: 5, items: [item('はい', 2, 40)] }
  }, overrides || {});
}

/* ── 正常系：最小構成のready=trueペイロードは検証を通る ── */
{
  const result = validatePublicResultsPayload(minimalReadyPayload());
  assert(result.ok === true, 'minimal ready=true payload passes validation, got ' + JSON.stringify(result.errors || []));
}

/* ── 正常系：任意ブロック（suit/step3/gapReasons/snbcUncertainReasons）を含んでいても通る ── */
{
  const payload = minimalReadyPayload({
    snbcUncertainReasons: { targetCount: 5, items: [item('よくわからない', 5, 100)] },
    suit: {
      targetCount: 12,
      engagement: [item('自分で着たい', 6, 50)],
      types: [item('ビジネススーツ', 6, 50)],
      states: [item('新品', 6, 50)],
      eventInterest: [item('はい', 6, 50)]
    },
    step3: {
      targetCount: 25,
      frequency: [item('月2回程度', 10, 40)],
      price: [item('1000円台', 10, 40)],
      groupSize: [item('2〜4人', 10, 40)],
      format: [item('平日夜', 10, 40)],
      eventAwareness: [item('知っている', 10, 40)],
      barriers: [item('時間が合わない', 10, 40)],
      helpfulInformation: [item('参加者の年齢層', 10, 40)],
      atmosphere: [item('落ち着いた雰囲気', 10, 40)],
      hypotheticalIntent: [item('参加したい', 10, 40)],
      gap: [item('ときどきある', 10, 40)]
    },
    gapReasons: { targetCount: 20, items: [item('日程が合わない', 9, 45)] }
  });
  const result = validatePublicResultsPayload(payload);
  assert(result.ok === true, 'ready=true payload with all optional blocks passes validation, got ' + JSON.stringify(result.errors || []));
}

/* ── 正常系：ready=falseは total/generatedAt/ready の3キーのみで通る ── */
{
  const result = validatePublicResultsPayload({ total: 4, generatedAt: new Date().toISOString(), ready: false });
  assert(result.ok === true, 'ready=false payload with only total/generatedAt/ready passes validation, got ' + JSON.stringify(result.errors || []));
}

/* ── 異常系：ready=falseなのに集計値が付いている（未確定値の混入）は拒否する ── */
{
  const result = validatePublicResultsPayload({
    total: 4, generatedAt: new Date().toISOString(), ready: false,
    categories: [item('野球ユニフォーム', 2, 50)]
  });
  assert(result.ok === false, 'ready=false payload with extra aggregate keys (categories) is rejected');
}

/* ── 異常系：許可リストに無いトップレベルキー（個人識別情報混入の想定）は拒否する ── */
['respondentHash', 'uuid', 'email', 'name', 'freeComment', 'completionStage', 'submittedAt'].forEach((key) => {
  const payload = minimalReadyPayload();
  payload[key] = 'something';
  const result = validatePublicResultsPayload(payload);
  assert(result.ok === false, 'payload with disallowed top-level key "' + key + '" is rejected');
});

/* ── 異常系：items配列の要素に許可リスト外のキー（例：respondentId）が混入していたら拒否する ── */
{
  const payload = minimalReadyPayload({
    categories: [{ name: '野球ユニフォーム', count: 8, percent: 40, respondentId: 'abc123' }]
  });
  const result = validatePublicResultsPayload(payload);
  assert(result.ok === false, 'item with an extra key (respondentId) beyond name/count/percent is rejected');
}

/* ── 異常系：percentが100超・countが負数など、値の範囲外は拒否する ── */
{
  const badPercent = validatePublicResultsPayload(minimalReadyPayload({ categories: [item('X', 5, 150)] }));
  assert(badPercent.ok === false, 'percent > 100 is rejected');

  const badCount = validatePublicResultsPayload(minimalReadyPayload({ categories: [item('X', -1, 10)] }));
  assert(badCount.ok === false, 'negative count is rejected');
}

/* ── 異常系：必須ブロック（snbcAwareness等）が欠けていたら拒否する ── */
{
  const payload = minimalReadyPayload();
  delete payload.snbcAwareness;
  const result = validatePublicResultsPayload(payload);
  assert(result.ok === false, 'ready=true payload missing a required block (snbcAwareness) is rejected');
}

if (failures > 0) {
  console.error('\n' + failures + ' failure(s) in test_validate_public_results_payload.js');
  process.exitCode = 1;
} else {
  console.log('\ntest_validate_public_results_payload.js: all checks passed');
}
