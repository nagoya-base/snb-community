// SNB Form Builder: ブラウザから直接 GitHub REST API を叩くための最小クライアント。
//
// 認証: Fine-grained Personal Access Token を前提とする。
// - トークンはこのモジュール内のメモリ変数にのみ保持する。
// - localStorage / sessionStorage には一切保存しない（タブを閉じる・再読込すると消える）。
// - console.log / エラーメッセージ / URL / DOM にトークンを出力しない。
//
// 必要な権限（Fine-grained PAT, リポジトリ単位）:
//   - Contents: Read and write
//   - Pull requests: Read and write
// 詳細は README.md を参照。

const API_BASE = 'https://api.github.com';

let _token = null;

export function setToken(token) {
  _token = token || null;
}

export function hasToken() {
  return !!_token;
}

export function clearToken() {
  _token = null;
}

function authHeaders() {
  if (!_token) throw new Error('GitHubトークンが設定されていません。');
  return {
    Authorization: 'Bearer ' + _token,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

// レスポンスやエラーにトークンを含めないよう、メッセージは定型文＋HTTPステータスのみにする。
async function request(path, options) {
  let res;
  try {
    res = await fetch(API_BASE + path, Object.assign({}, options, {
      headers: Object.assign({}, authHeaders(), (options && options.headers) || {})
    }));
  } catch (e) {
    throw new Error('GitHub APIへの通信に失敗しました（ネットワークエラー）。');
  }
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body && body.message ? body.message : '';
    } catch (e) { /* ignore */ }
    const err = new Error('GitHub API エラー (HTTP ' + res.status + ')' + (detail ? ': ' + detail : ''));
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

export async function getMe() {
  return request('/user', { method: 'GET' });
}

export async function getBranchSha(owner, repo, branch) {
  const data = await request('/repos/' + owner + '/' + repo + '/git/ref/heads/' + encodeURIComponent(branch), { method: 'GET' });
  return data.object.sha;
}

export async function fileExists(owner, repo, path, ref) {
  try {
    await request('/repos/' + owner + '/' + repo + '/contents/' + path.split('/').map(encodeURIComponent).join('/') + (ref ? '?ref=' + encodeURIComponent(ref) : ''), { method: 'GET' });
    return true;
  } catch (e) {
    if (e.status === 404) return false;
    throw e;
  }
}

export async function createBranch(owner, repo, newBranch, fromSha) {
  return request('/repos/' + owner + '/' + repo + '/git/refs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'refs/heads/' + newBranch, sha: fromSha })
  });
}

// UTF-8安全なbase64エンコード（日本語コンテンツを含むため TextEncoder 経由で行う）。
function toBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach(function (b) { binary += String.fromCharCode(b); });
  return btoa(binary);
}

export async function createOrUpdateFile(owner, repo, path, content, branch, message) {
  return request('/repos/' + owner + '/' + repo + '/contents/' + path.split('/').map(encodeURIComponent).join('/'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: message,
      content: toBase64Utf8(content),
      branch: branch
    })
  });
}

export async function createPullRequest(owner, repo, title, head, base, body) {
  return request('/repos/' + owner + '/' + repo + '/pulls', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: title, head: head, base: base, body: body })
  });
}
