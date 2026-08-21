// ブラウザから直接叩くGitHub REST APIクライアント。
//
// 重要: tokenはこのモジュール内の呼び出しごとに引数として受け取るだけで、
// どこにも保存しない（localStorage/sessionStorageへ書き込まない）。
// エラーメッセージ・console出力・返り値にtoken文字列を含めないこと。

const API_BASE = 'https://api.github.com';

class GitHubApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'GitHubApiError';
    this.status = status;
  }
}

async function request(token, method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { /* JSON以外のレスポンスはそのまま無視 */ }

  if (!res.ok) {
    const message = (json && json.message) || `GitHub API ${res.status}`;
    throw new GitHubApiError(message, res.status);
  }
  return json;
}

export class GitHubClient {
  constructor(owner, repo, token) {
    this.owner = owner;
    this.repo = repo;
    this.token = token;
  }

  get repoPath() {
    return `/repos/${this.owner}/${this.repo}`;
  }

  async getBranchSha(branch) {
    const ref = await request(this.token, 'GET', `${this.repoPath}/git/ref/heads/${encodeURIComponent(branch)}`);
    return ref.object.sha;
  }

  async createBranch(newBranch, fromSha) {
    return request(this.token, 'POST', `${this.repoPath}/git/refs`, {
      ref: `refs/heads/${newBranch}`,
      sha: fromSha
    });
  }

  /** ファイルが既に存在するか（衝突チェック用）。存在しなければfalse、APIエラーはそのまま投げる。 */
  async fileExists(path, ref) {
    try {
      await request(this.token, 'GET', `${this.repoPath}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`);
      return true;
    } catch (e) {
      if (e instanceof GitHubApiError && e.status === 404) return false;
      throw e;
    }
  }

  /** 新規ファイルを1件commitする（既存ファイルの更新は想定しない＝事前のfileExistsチェックで弾く）。 */
  async createFile(path, branch, base64Content, message) {
    return request(this.token, 'PUT', `${this.repoPath}/contents/${encodeURIComponent(path)}`, {
      message,
      content: base64Content,
      branch
    });
  }

  async createPullRequest(title, body, head, base) {
    return request(this.token, 'POST', `${this.repoPath}/pulls`, {
      title,
      body,
      head,
      base
    });
  }

  /** トークンが repo に対して最低限のアクセスを持つかどうかの軽量な疎通確認。 */
  async ping() {
    return request(this.token, 'GET', this.repoPath);
  }
}

export { GitHubApiError };
