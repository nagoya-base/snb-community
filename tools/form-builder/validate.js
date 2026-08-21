/*
 * PR作成前の公開前バリデーション。
 * ここを全て通過するまで「PRを作成」を実行させない。
 */
(function (global) {
  'use strict';

  var RESERVED_KEYS = ['display_name', 'contact_email', 'contact_x', 'agree_terms', 'unavailable', 'website', 'submission_id', 'form_type', 'form_version', 'dates'];
  var SLUG_RE = /^[a-z][a-z0-9_]{2,60}$/;
  var GAS_EXEC_RE = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;
  var ALLOWED_DIRS = ['community', 'baseball', 'portrait'];

  function enabledQuestions(config) {
    return (config.questions || []).filter(function (q) { return q.enabled !== false; });
  }

  function validateSync(config) {
    var errors = [];
    function fail(field, message) { errors.push({ field: field, message: message }); }

    if (!config.meta.title || !config.meta.title.trim()) fail('meta.title', 'タイトルを入力してください。');
    if (!config.meta.slug || !SLUG_RE.test(config.meta.slug)) {
      fail('meta.slug', 'slugは英小文字で始まる英数字・アンダースコアのみ、3〜60文字で入力してください（例: enquete_202610）。');
    }
    if (ALLOWED_DIRS.indexOf(config.meta.pageDir) === -1) {
      fail('meta.pageDir', '公開先ディレクトリは community / baseball / portrait のいずれかを選択してください。');
    }
    if (!config.meta.fileName || !/^[a-z][a-z0-9_]*\.html$/.test(config.meta.fileName)) {
      fail('meta.fileName', '生成ファイル名が不正です（slugから自動生成されます）。');
    }
    if (!config.meta.canonicalUrl || !/^https:\/\//.test(config.meta.canonicalUrl)) {
      fail('meta.canonicalUrl', 'canonical URLが正しく生成されていません。');
    }

    if (config.type === 'event_entry') {
      if (!config.event || !config.event.eventDate) fail('event.eventDate', '開催日を入力してください。');
      else if (!/^\d{4}-\d{2}-\d{2}$/.test(config.event.eventDate)) fail('event.eventDate', '開催日の形式が不正です。');
    }

    var dm = config.dateModel;
    if (dm && dm.mode !== 'none') {
      if (!dm.dates || dm.dates.length === 0) {
        fail('dateModel.dates', '候補日を1件以上追加してください。');
      } else {
        dm.dates.forEach(function (d, i) {
          if (!d.date || !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) fail('dateModel.dates[' + i + ']', '候補日' + (i + 1) + 'の日付が不正です。');
          if (!d.label) fail('dateModel.dates[' + i + ']', '候補日' + (i + 1) + 'の表示ラベルが空です。');
        });
        var keys = dm.dates.map(function (d) { return d.key; });
        if (new Set(keys).size !== keys.length) fail('dateModel.dates', '候補日のキーが重複しています。');
      }
    }

    var seenKeys = {};
    RESERVED_KEYS.forEach(function (k) { seenKeys[k] = true; });
    enabledQuestions(config).forEach(function (q, i) {
      if (!q.key || !/^[a-z][a-z0-9_]*$/.test(q.key)) {
        fail('questions[' + i + '].key', '質問' + (i + 1) + 'のkeyは英小文字で始まる英数字・アンダースコアのみで入力してください。');
      } else if (seenKeys[q.key]) {
        fail('questions[' + i + '].key', '質問キー「' + q.key + '」が重複しているか予約語と衝突しています。');
      } else {
        seenKeys[q.key] = true;
      }
      if (!q.label || !q.label.trim()) fail('questions[' + i + '].label', '質問' + (i + 1) + 'のラベルを入力してください。');
      if (['radio', 'select'].indexOf(q.type) !== -1 && (!q.options || q.options.length < 2)) {
        fail('questions[' + i + '].options', '質問「' + (q.label || q.key) + '」には選択肢を2つ以上設定してください。');
      }
      if (q.type === 'checkbox' && (!q.options || q.options.length < 1)) {
        fail('questions[' + i + '].options', '質問「' + (q.label || q.key) + '」には選択肢を1つ以上設定してください。');
      }
      (q.options || []).forEach(function (opt, oi) {
        if (!opt.label || !opt.label.trim() || !opt.value || !opt.value.trim()) {
          fail('questions[' + i + '].options[' + oi + ']', '質問「' + (q.label || q.key) + '」の選択肢' + (oi + 1) + 'が空です。');
        }
      });
    });

    if (!config.endpoints || !config.endpoints.submitUrl || !GAS_EXEC_RE.test(config.endpoints.submitUrl)) {
      fail('endpoints.submitUrl', 'GAS Web AppのURLは https://script.google.com/macros/s/xxx/exec の形式で入力してください。');
    }

    if (!config.analytics || !config.analytics.formName || !/^[a-z][a-z0-9_]*$/.test(config.analytics.formName)) {
      fail('analytics.formName', 'analytics用のform_nameが不正です。');
    }

    return errors;
  }

  function checkFrontMatter(html) {
    var trimmed = html.replace(/^﻿/, '').replace(/^\s+/, '');
    if (trimmed.indexOf('---') === 0) {
      return { ok: false, message: '生成HTMLの先頭に front matter(`---`) が混入しています。.nojekyll環境では画面にそのまま表示されるため公開できません。' };
    }
    if (trimmed.indexOf('<!DOCTYPE html>') !== 0) {
      return { ok: false, message: '生成HTMLの先頭が <!DOCTYPE html> ではありません。' };
    }
    return { ok: true };
  }

  global.FFValidate = {
    validateSync: validateSync,
    checkFrontMatter: checkFrontMatter,
    enabledQuestions: enabledQuestions,
    RESERVED_KEYS: RESERVED_KEYS,
    SLUG_RE: SLUG_RE,
    GAS_EXEC_RE: GAS_EXEC_RE,
    ALLOWED_DIRS: ALLOWED_DIRS
  };
})(window);
