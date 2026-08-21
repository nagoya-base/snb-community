/*
 * GitHub REST API の最小ラッパー（ブラウザから直接呼び出す）。
 * 認証トークンはこのモジュール内の関数引数として都度渡すのみで、
 * どこにも永続化しない（localStorage/sessionStorageへの保存禁止）。
 * console.log等でtokenを出力しないこと。
 */
(function (global) {
  'use strict';

  var OWNER = 'nagoya-base';
  var REPO = 'snb-community';
  var BASE_BRANCH = 'main';
  var API_ROOT = 'https://api.github.com';

  function utf8ToBase64(str) {
    var bytes = new TextEncoder().encode(str);
    var binary = '';
    var chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function request(token, method, path, body) {
    var headers = {
      'Accept': 'application/vnd.github+json',
      'Authorization': 'Bearer ' + token,
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    return fetch(API_ROOT + path, {
      method: method,
      headers: headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { /* ignore */ }
        if (!res.ok) {
          var err = new Error((data && data.message) || ('GitHub API error: ' + res.status));
          err.status = res.status;
          err.githubMessage = data && data.message;
          err.githubData = data;
          throw err;
        }
        return data;
      });
    });
  }

  function getMainSha(token) {
    return request(token, 'GET', '/repos/' + OWNER + '/' + REPO + '/git/ref/heads/' + BASE_BRANCH)
      .then(function (data) { return data.object.sha; });
  }

  function fileExists(token, path) {
    return request(token, 'GET', '/repos/' + OWNER + '/' + REPO + '/contents/' + encodeURIComponentPath(path) + '?ref=' + BASE_BRANCH)
      .then(function () { return true; })
      .catch(function (err) {
        if (err.status === 404) return false;
        throw err;
      });
  }

  function encodeURIComponentPath(path) {
    return path.split('/').map(encodeURIComponent).join('/');
  }

  function createBranch(token, branchName, sha) {
    return request(token, 'POST', '/repos/' + OWNER + '/' + REPO + '/git/refs', {
      ref: 'refs/heads/' + branchName,
      sha: sha
    });
  }

  function putFile(token, branchName, path, content, message) {
    return request(token, 'PUT', '/repos/' + OWNER + '/' + REPO + '/contents/' + encodeURIComponentPath(path), {
      message: message,
      content: utf8ToBase64(content),
      branch: branchName
    });
  }

  function createPullRequest(token, opts) {
    return request(token, 'POST', '/repos/' + OWNER + '/' + REPO + '/pulls', {
      title: opts.title,
      head: opts.head,
      base: BASE_BRANCH,
      body: opts.body,
      draft: false
    });
  }

  global.FFGitHubApi = {
    OWNER: OWNER,
    REPO: REPO,
    BASE_BRANCH: BASE_BRANCH,
    getMainSha: getMainSha,
    fileExists: fileExists,
    createBranch: createBranch,
    putFile: putFile,
    createPullRequest: createPullRequest
  };
})(window);
