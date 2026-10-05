'use strict';
// 使い捨て診断（diagnostics/AdminAuthDiagnostic.gs）: 実機確認の手順を保証する。本番バンドルには入らず、tokenを出力しない。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createEnv, loadAdmin, ROOT } = require('./helpers/gas-env');
const jwt = require('./helpers/jwt');
const { TARGETS } = require('../../../../scripts/costume-portrait-survey/prepare-gas');

const DIAG = path.join(ROOT, 'diagnostics', 'AdminAuthDiagnostic.gs');
const ID_TOKEN_GS = path.join(ROOT, 'admin', 'IdToken.gs');

/** 診断用の使い捨てプロジェクトを再現: IdToken.gs + 診断ファイルだけを読み込む（Admin APIは無い）。 */
function scratchProject() {
  const env = createEnv();
  const logs = [];
  env.sandbox.Logger = { log: (m) => logs.push(String(m)) };
  env.jwks = [jwt.GOOGLE_KEY.jwk];
  env.props.set('ADMIN_GOOGLE_CLIENT_ID', jwt.CLIENT_ID);
  const ctx = vm.createContext(env.sandbox);
  [ID_TOKEN_GS, DIAG].forEach((f) => vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f }));
  return { env, ctx, logs };
}

test('診断1: V8のBigInt RSA検証が既知解（テストベクタ）で正しく、改ざん署名を拒否する', () => {
  const { ctx, logs } = scratchProject();
  assert.strictEqual(ctx.diagBigIntAndRsa(), true, logs.join('\n'));
  for (const name of ['BigInt is available', 'modPow_ (BigInt) known answer', 'RS256 verify: valid signature accepted', 'RS256 verify: tampered signature rejected']) {
    assert.ok(logs.includes('PASS ' + name), name);
  }
  // テストベクタは本物のRS256署名（Node標準のcryptoでも検証できる）。秘密鍵はリポジトリに無い。
  const source = fs.readFileSync(DIAG, 'utf8');
  const vector = vm.runInNewContext(source.match(/var DIAG_VECTOR = (\{[\s\S]*?\n\});/)[1].replace(/^/, '(') + ')');
  const key = require('crypto').createPublicKey({ key: { kty: 'RSA', n: vector.jwk.n, e: vector.jwk.e }, format: 'jwk' });
  assert.strictEqual(require('crypto').verify('RSA-SHA256', Buffer.from(vector.input), key, Buffer.from(vector.signature, 'base64url')), true);
  assert.ok(!/PRIVATE KEY|"d"|\bd:/.test(source));
});

test('診断2: Google公開鍵の取得（UrlFetchApp）と kid 解決。失敗時は FAIL', () => {
  const ok = scratchProject();
  assert.strictEqual(ok.ctx.diagJwksFetch(), true, ok.logs.join('\n'));
  assert.ok(ok.logs.some((l) => l.startsWith('PASS JWKS fetched via UrlFetchApp')));
  const ng = scratchProject();
  ng.env.jwksStatus = 500;
  assert.strictEqual(ng.ctx.diagJwksFetch(), false);
  assert.ok(ng.logs.some((l) => l.startsWith('FAIL JWKS fetched')));
});

test('診断3: 実ID tokenの検証は成功/失敗だけを出力し、token・email・sub を一切出力しない。後で削除できる', () => {
  const p = scratchProject();
  const token = jwt.token('diag.person@gmail.com');
  p.env.props.set('DIAG_ID_TOKEN', token);
  assert.strictEqual(p.ctx.diagVerifyRealToken(), true, p.logs.join('\n'));
  const out = p.logs.join('\n') + p.env.logs.join('\n');
  assert.ok(/PASS real ID token verified/.test(out));
  for (const secret of [token, token.split('.')[1], token.split('.')[2], 'diag.person@gmail.com', 'sub-diag.person@gmail.com']) assert.ok(!out.includes(secret), secret.slice(0, 12));
  // 失敗（期限切れ / aud不一致 / 未設定）は分類のみ
  const bad = [[{ exp: Math.floor(Date.now() / 1000) - 5 }, 'unauthenticated'], [{ aud: 'other.apps.googleusercontent.com' }, 'unauthenticated']];
  for (const [claims, cls] of bad) {
    const q = scratchProject();
    const t = jwt.token('x@gmail.com', claims);
    q.env.props.set('DIAG_ID_TOKEN', t);
    assert.strictEqual(q.ctx.diagVerifyRealToken(), false);
    assert.ok(q.logs.some((l) => l.startsWith('FAIL') && l.includes(cls)));
    assert.ok(!q.logs.join('\n').includes(t) && !q.logs.join('\n').includes('x@gmail.com'));
  }
  const none = scratchProject();
  assert.strictEqual(none.ctx.diagVerifyRealToken(), false);
  p.ctx.diagClearToken();
  assert.strictEqual(p.env.props.has('DIAG_ID_TOKEN'), false);
  // まとめ実行
  const all = scratchProject();
  assert.strictEqual(all.ctx.runAdminAuthDiagnostics(), true);
  assert.ok(all.logs.includes('ALL PASS') && all.logs.some((l) => l.startsWith('SKIP real ID token')));
});

test('診断は本番Admin（doPost等を含むプロジェクト）では実行を拒否し、本番コードに診断の入口を残さない', () => {
  const admin = loadAdmin();
  admin.env.sandbox.Logger = { log() {} };
  vm.runInContext(fs.readFileSync(DIAG, 'utf8'), admin.ctx, { filename: DIAG });
  for (const fn of ['diagBigIntAndRsa', 'diagJwksFetch', 'diagVerifyRealToken', 'diagClearToken', 'runAdminAuthDiagnostics']) {
    assert.throws(() => admin.ctx[fn](), /refusing to run/, fn);
  }
  // 配備対象（admin/）に診断コード・DIAG_* が無く、診断ファイルは allowlist にも入らない
  const deployed = fs.readdirSync(path.join(ROOT, 'admin')).filter((f) => /\.(gs|html)$/.test(f));
  assert.ok(!deployed.some((f) => /diag/i.test(f)));
  assert.ok(!deployed.map((f) => fs.readFileSync(path.join(ROOT, 'admin', f), 'utf8')).join('\n').match(/DIAG_|diagnos/i));
  assert.ok(!TARGETS.admin.files.some((f) => /diag/i.test(f)) && !TARGETS.public.files.some((f) => /diag/i.test(f)));
  assert.deepStrictEqual(deployed.sort(), TARGETS.admin.files.slice().sort());
});

test('診断ファイルはtokenをLogger以外へ出さず、Spreadsheet・メール・本番Propertiesへ触れない', () => {
  const code = fs.readFileSync(DIAG, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const bad of ['SpreadsheetApp', 'MailApp', 'GmailApp', 'setProperty', 'console.', 'ContentService', 'HtmlService', 'SPREADSHEET_ID', 'ADMIN_OWNER', 'ADMIN_VIEWER']) assert.ok(!code.includes(bad), bad);
  // Logger.log に渡すのは固定文言・件数・分類のみ（token変数は渡さない）
  const loggerArgs = (code.match(/Logger\.log\(([^;]*)\);/g) || []).map((l) => l.replace(/'[^']*'/g, "''")); // 文字列リテラルは除いて変数だけ見る
  assert.ok(loggerArgs.length > 0 && loggerArgs.every((l) => !/token|jwt|credential|email|sub\b/i.test(l)), loggerArgs.join('\n'));
});
