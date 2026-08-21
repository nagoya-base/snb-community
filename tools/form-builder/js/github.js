// ブラウザから直接 GitHub REST API を呼び出す最小クライアント。
// token はこのモジュールの外（呼び出し元の変数）にしか保持させない設計とし、
// このファイル自身も token を localStorage/sessionStorage へ書き込むコードを
// 一切持たない。エラーメッセージにも token を含めない。

const API_BASE = 'https://api.github.com';

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

class GitHubApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'GitHubApiError';
    this.status = status;
  }
}

export class GitHubClient {
  constructor({ owner, repo, token }) {
    this.owner = owner;
    this.repo = repo;
    this.token = token; // インスタンス生存中のみメモリ上に保持。永続化しない。
  }

  async _request(path, options = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.headers || {}),
      },
    });
    let body = null;
    try { body = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      const message = (body && body.message) || `GitHub API error (HTTP ${res.status})`;
      throw new GitHubApiError(message, res.status);
    }
    return body;
  }

  async getBranchSha(branch = 'main') {
    const data = await this._request(`/repos/${this.owner}/${this.repo}/git/ref/heads/${branch}`);
    return data.object.sha;
  }

  async fileExists(path, ref = 'main') {
    try {
      await this._request(`/repos/${this.owner}/${this.repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(ref)}`);
      return true;
    } catch (e) {
      if (e instanceof GitHubApiError && e.status === 404) return false;
      throw e;
    }
  }

  async createBranch(branchName, fromSha) {
    return this._request(`/repos/${this.owner}/${this.repo}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: fromSha }),
    });
  }

  async putFile({ path, content, branch, message }) {
    return this._request(`/repos/${this.owner}/${this.repo}/contents/${encodeURI(path)}`, {
      method: 'PUT',
      body: JSON.stringify({
        message,
        content: utf8ToBase64(content),
        branch,
      }),
    });
  }

  async createPullRequest({ title, head, base = 'main', body }) {
    return this._request(`/repos/${this.owner}/${this.repo}/pulls`, {
      method: 'POST',
      body: JSON.stringify({ title, head, base, body }),
    });
  }
}

export { GitHubApiError };
