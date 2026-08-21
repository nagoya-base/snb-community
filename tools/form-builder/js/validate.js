// PR作成前の検証ロジック。ここでエラーが1件でもあれば PR は作成しない。

import { DIRECTORIES } from './schema.js';

const SLUG_RE = /^[a-z][a-z0-9_]*$/;
const KEY_RE = /^[a-z][a-z0-9_]*$/;
const GAS_EXEC_RE = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function pushError(errors, field, message) {
  errors.push({ field, message });
}

export function validateConfig(config) {
  const errors = [];

  if (!config.title || !config.title.trim()) {
    pushError(errors, 'title', 'タイトルを入力してください。');
  }

  if (!config.slug || !config.slug.trim()) {
    pushError(errors, 'slug', 'ファイル名（slug）を入力してください。');
  } else if (!SLUG_RE.test(config.slug)) {
    pushError(errors, 'slug', 'slugは半角小文字英数字とアンダースコアのみ、先頭は英字にしてください（例: enquete_202609）。');
  }

  if (!DIRECTORIES.includes(config.directory)) {
    pushError(errors, 'directory', '公開先ディレクトリを選択してください。');
  }

  if (config.type === 'event_entry') {
    if (!config.eventDate) {
      pushError(errors, 'eventDate', '開催日を入力してください。');
    }
    if (!config.price || !config.price.trim()) {
      pushError(errors, 'price', '料金を入力してください（無料の場合は「無料」と入力）。');
    }
  }

  if (config.type === 'date_survey' || config.type === 'cross_survey') {
    if (!config.dates || config.dates.length === 0) {
      pushError(errors, 'dates', '候補日を1件以上追加してください。');
    } else {
      config.dates.forEach((d, i) => {
        if (!d.date || !DATE_RE.test(d.date)) {
          pushError(errors, `dates.${i}`, `候補日 ${i + 1} の日付形式が不正です（YYYY-MM-DD）。`);
        }
      });
    }
  }

  if (config.type === 'cross_survey') {
    if (!config.plans || config.plans.length === 0) {
      pushError(errors, 'plans', '候補企画を1件以上追加してください。');
    } else {
      config.plans.forEach((p, i) => {
        if (!p.label || !p.label.trim()) {
          pushError(errors, `plans.${i}`, `候補企画 ${i + 1} の表示名を入力してください。`);
        }
      });
    }
  }

  // 質問項目のkey重複・選択肢不足チェック
  const seenKeys = new Set();
  (config.questions || []).forEach((q, i) => {
    if (!q.label || !q.label.trim()) {
      pushError(errors, `questions.${i}.label`, `質問 ${i + 1} のlabelを入力してください。`);
    }
    if (!q.key || !KEY_RE.test(q.key)) {
      pushError(errors, `questions.${i}.key`, `質問 ${i + 1} のkeyが不正です（半角小文字英数字とアンダースコア、先頭は英字）。`);
    } else if (seenKeys.has(q.key)) {
      pushError(errors, `questions.${i}.key`, `質問 ${i + 1} のkey「${q.key}」が他の質問と重複しています。`);
    } else {
      seenKeys.add(q.key);
    }

    if (['radio', 'checkbox', 'select'].includes(q.type)) {
      const validOptions = (q.options || []).filter((o) => o.label && o.label.trim());
      if (validOptions.length < 2) {
        pushError(errors, `questions.${i}.options`, `質問 ${i + 1}「${q.label || '(無題)'}」の選択肢は2件以上入力してください。`);
      }
    }
  });

  // 既存フィールド名との衝突チェック（生成HTML内で予約しているname属性）
  const reservedKeys = new Set([
    'website', 'submission_id', 'display_name', 'x_account', 'email', 'agree_terms',
  ]);
  (config.questions || []).forEach((q, i) => {
    if (reservedKeys.has(q.key)) {
      pushError(errors, `questions.${i}.key`, `質問 ${i + 1} のkey「${q.key}」は予約済みの項目名と衝突しています。別のkeyにしてください。`);
    }
  });

  if (config.gasExecUrl && config.gasExecUrl.trim() && !GAS_EXEC_RE.test(config.gasExecUrl.trim())) {
    pushError(errors, 'gasExecUrl', 'GAS Web App /exec URLの形式が不正です（https://script.google.com/macros/s/xxxx/exec）。');
  }
  if (config.resultsGasExecUrl && config.resultsGasExecUrl.trim() && !GAS_EXEC_RE.test(config.resultsGasExecUrl.trim())) {
    pushError(errors, 'resultsGasExecUrl', '集計結果用GAS /exec URLの形式が不正です。');
  }

  return errors;
}

export function warnings(config) {
  const list = [];
  if (!config.gasExecUrl || !config.gasExecUrl.trim()) {
    list.push('GAS Web App の /exec URL が未設定です。生成後のHTMLはプレースホルダーのままで、送信は失敗するよう安全側に倒されます。運営者がGASを手動デプロイし、URLを入力してから本番公開してください。');
  }
  if (!config.ogpImagePath || !config.ogpImagePath.trim()) {
    list.push('OGP画像パスが未設定です。SNSシェア時の画像が表示されません。');
  }
  return list;
}
