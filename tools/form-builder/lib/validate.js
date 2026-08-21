// PR作成前の検証ロジック。ここを通らない設定ではPRを作成させない。
import { isValidSlug, isValidQuestionKey } from './util.js';

const CHOICE_TYPES = ['radio', 'checkbox', 'select'];

/**
 * @param {object} config フォーム設定JSON（lib/presets.js の形）
 * @param {{ exists: (path: string) => boolean }} [opts] 既存ファイル衝突チェック用
 * @returns {string[]} エラーメッセージの配列。空配列なら検証OK。
 */
export function validateConfig(config, opts = {}) {
  const errors = [];
  const add = (msg) => errors.push(msg);

  if (!config.title || !config.title.trim()) add('タイトルを入力してください。');
  if (!config.slug) {
    add('slugを入力してください。');
  } else if (!isValidSlug(config.slug)) {
    add('slugは英小文字で始まり、英小文字・数字・アンダースコアのみ使用できます（例: enquete_202609）。');
  }
  if (!['community', 'baseball'].includes(config.section)) {
    add('公開先ディレクトリ（community / baseball）を選択してください。');
  }
  if (!config.description || !config.description.trim()) {
    add('meta description / OGP用の説明文を入力してください。');
  }

  if (config.type === 'event_entry') {
    const ev = config.event || {};
    if (!ev.eventDate) add('開催日を入力してください。');
    if (!ev.startTime) add('開始時刻を入力してください。');
    if (!ev.fee) add('料金を入力してください（「無料」等でも可）。');
    if (!ev.capacity || Number(ev.capacity) <= 0) add('定員を1以上の数値で入力してください。');
  }

  if (config.type === 'date_survey' || config.type === 'cross_tab_survey') {
    const dates = config.dates || [];
    const hosted = dates.filter((d) => d.hosted !== false);
    if (hosted.length === 0) add('候補日を1件以上追加してください。');
    const seen = new Set();
    dates.forEach((d) => {
      if (!d.date) { add('候補日に空の日付があります。'); return; }
      if (seen.has(d.date)) add(`候補日「${d.date}」が重複しています。`);
      seen.add(d.date);
    });
  }

  const questions = config.questions || [];
  const keySeen = new Set();
  questions.forEach((q, i) => {
    const label = q.label || `質問${i + 1}`;
    if (!q.key) {
      add(`「${label}」のキー(name)が未設定です。`);
    } else if (!isValidQuestionKey(q.key)) {
      add(`質問キー「${q.key}」は英小文字で始まる英数字・アンダースコアのみ使用できます。`);
    } else if (keySeen.has(q.key)) {
      add(`質問キー「${q.key}」が重複しています。キーは一意である必要があります。`);
    } else {
      keySeen.add(q.key);
    }

    if (!q.label || !q.label.trim()) add(`質問「${q.key || i + 1}」のlabelを入力してください。`);

    if (CHOICE_TYPES.includes(q.type)) {
      const opts2 = (q.options || []).filter((o) => o.label && o.label.trim());
      if (opts2.length < 2) {
        add(`質問「${label}」は選択肢が2件以上必要です（現在${opts2.length}件）。`);
      }
    } else if (!['text', 'textarea'].includes(q.type)) {
      add(`質問「${label}」の種別「${q.type}」は未対応です。`);
    }
  });

  if (config.analytics?.leadEvent === 'generate_lead' && config.analytics.leadType !== 'snbc_event_entry') {
    add('generate_lead の lead_type は snbc_event_entry 固定です（README.md の GA4 規約参照）。');
  }
  if (!['survey_submit', 'generate_lead'].includes(config.analytics?.leadEvent)) {
    add('成果イベント種別（survey_submit / generate_lead）を選択してください。');
  }

  if (config.gas?.execUrl) {
    const url = config.gas.execUrl.trim();
    const gasUrlOk = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url);
    if (!gasUrlOk) {
      add('GAS Web AppのURLの形式が不正です（https://script.google.com/macros/s/.../exec の形式で入力してください）。');
    }
  }

  if (config.slug && isValidSlug(config.slug) && ['community', 'baseball'].includes(config.section)) {
    const htmlPath = `${config.section}/${config.slug}.html`;
    const jsonPath = `${config.section}/${config.slug}.config.json`;
    if (typeof opts.exists === 'function') {
      if (opts.exists(htmlPath)) add(`${htmlPath} は既に存在します。slugを変更してください。`);
      if (opts.exists(jsonPath)) add(`${jsonPath} は既に存在します。slugを変更してください。`);
    }
  }

  const canonical = `https://nagoya-base.github.io/snb-community/${config.section}/${config.slug}.html`;
  if (config.section && config.slug && config.canonicalUrl && config.canonicalUrl !== canonical) {
    add('canonical URLがsection/slugから導出される値と一致していません。');
  }

  return errors;
}
