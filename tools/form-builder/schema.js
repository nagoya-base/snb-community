// SNB Form Builder: 設定データのスキーマ定義・デフォルト値生成・バリデーション。
// このファイルは admin app (tools/form-builder) からのみ読み込まれる。
// 生成される公開ページは、ここで定義した形の JSON (config) を
// <script type="application/json" id="snb-form-config"> として埋め込み、
// リポジトリ直下の form-runtime.js が実行時に解釈する。

export const SCHEMA_VERSION = 1;

export const FORM_TYPES = {
  event_entry: {
    label: 'イベント応募フォーム',
    gaEvent: 'generate_lead',
    pageType: 'event_entry',
    usesDates: false,
    usesPlans: false
  },
  date_survey: {
    label: '開催日アンケート',
    gaEvent: 'survey_submit',
    pageType: 'survey',
    usesDates: true,
    usesPlans: false
  },
  cross_survey: {
    label: '企画・クロス集計アンケート',
    gaEvent: 'survey_submit',
    pageType: 'survey',
    usesDates: true,
    usesPlans: true
  }
};

export const PILLARS = ['community', 'baseball'];

export const QUESTION_TYPES = [
  { value: 'text', label: '一行テキスト', needsOptions: false },
  { value: 'textarea', label: '複数行テキスト', needsOptions: false },
  { value: 'radio', label: 'ラジオボタン', needsOptions: true },
  { value: 'checkbox', label: 'チェックボックス', needsOptions: true },
  { value: 'select', label: 'セレクト', needsOptions: true },
  { value: 'date_single', label: '候補日から1つ選択（自動選択肢）', needsOptions: false },
  { value: 'date_multi', label: '候補日から複数選択（自動選択肢）', needsOptions: false },
  { value: 'plan_single', label: '候補企画から1つ選択（自動選択肢）', needsOptions: false }
];

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];

// dateStr("YYYY-MM-DD")をUTC真夜中として解釈し、UTCアクセサで読み戻す。
// ローカルタイムゾーン変換を挟まないため、実行環境によらず同じ曜日になる。
export function weekdayLabel(dateStr) {
  if (!dateStr) return '';
  var d = new Date(dateStr + 'T00:00:00Z');
  if (isNaN(d.getTime())) return '';
  return WEEKDAY_JA[d.getUTCDay()];
}

export function dateKeyFromDate(dateStr) {
  if (!dateStr) return '';
  return 'date_' + dateStr.replace(/-/g, '').slice(2);
}

export function slugify(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function emptyConfig() {
  return {
    schemaVersion: SCHEMA_VERSION,
    type: 'event_entry',
    pillar: 'community',
    slug: '',
    title: '',
    subtitle: '',
    meta: {
      description: '',
      ogpImage: ''
    },
    event: {
      date: '',
      startTime: '',
      endTime: '',
      price: '',
      capacity: '',
      venue: '',
      deadline: ''
    },
    dates: [],
    plans: [],
    questions: [],
    consentText: '利用規約・参加ルールに同意します',
    gas: {
      execUrl: ''
    }
  };
}

export function newQuestion(overrides) {
  return Object.assign({
    key: '',
    type: 'text',
    label: '',
    required: false,
    help: '',
    options: [],
    allowOther: false
  }, overrides || {});
}

export function newDate(overrides) {
  return Object.assign({ key: '', date: '', label: '' }, overrides || {});
}

export function newPlan(overrides) {
  return Object.assign({ key: '', label: '' }, overrides || {});
}

export function canonicalPath(config) {
  return config.pillar + '/' + config.slug + '.html';
}

export function canonicalUrl(config) {
  return 'https://nagoya-base.github.io/snb-community/' + canonicalPath(config);
}

const SLUG_RE = /^[a-z][a-z0-9_]*$/;
const KEY_RE = /^[a-z][a-z0-9_]*$/;

// 公開前検証。ここを通らない限り PR は作成させない。
export function validateConfig(config, opts) {
  var errors = [];
  var existingFiles = (opts && opts.existingFiles) || [];

  if (!config.title || !config.title.trim()) errors.push('タイトルを入力してください。');
  if (!config.slug || !config.slug.trim()) {
    errors.push('ファイル名(slug)を入力してください。');
  } else if (!SLUG_RE.test(config.slug)) {
    errors.push('slugは半角小文字・数字・アンダースコアのみ、先頭は英字にしてください（例: enquete_202609）。');
  }
  if (PILLARS.indexOf(config.pillar) === -1) errors.push('公開先ディレクトリを選択してください。');
  if (!FORM_TYPES[config.type]) errors.push('フォーム種別を選択してください。');

  if (!config.meta || !config.meta.description || !config.meta.description.trim()) {
    errors.push('meta descriptionを入力してください。');
  }

  var typeInfo = FORM_TYPES[config.type];

  if (typeInfo && typeInfo.usesDates) {
    if (!config.dates || config.dates.length === 0) {
      errors.push('候補日を1件以上追加してください。');
    } else {
      var seenDateKeys = {};
      config.dates.forEach(function (d, i) {
        if (!d.date) errors.push('候補日 ' + (i + 1) + ' 件目の日付が未入力です。');
        if (!d.key || !KEY_RE.test(d.key)) {
          errors.push('候補日 ' + (i + 1) + ' 件目のkeyが不正です。');
        } else if (seenDateKeys[d.key]) {
          errors.push('候補日のkey「' + d.key + '」が重複しています。');
        }
        seenDateKeys[d.key] = true;
      });
    }
  }

  if (typeInfo && typeInfo.usesPlans) {
    if (!config.plans || config.plans.length === 0) {
      errors.push('候補企画を1件以上追加してください。');
    } else {
      var seenPlanKeys = {};
      config.plans.forEach(function (p, i) {
        if (!p.label || !p.label.trim()) errors.push('候補企画 ' + (i + 1) + ' 件目の名称が未入力です。');
        if (!p.key || !KEY_RE.test(p.key)) {
          errors.push('候補企画 ' + (i + 1) + ' 件目のkeyが不正です。');
        } else if (seenPlanKeys[p.key]) {
          errors.push('候補企画のkey「' + p.key + '」が重複しています。');
        }
        seenPlanKeys[p.key] = true;
      });
    }
  }

  if (config.type === 'event_entry') {
    if (!config.event || !config.event.date) errors.push('開催日を入力してください。');
  }

  var seenQKeys = {};
  (config.questions || []).forEach(function (q, i) {
    var idx = i + 1;
    if (!q.label || !q.label.trim()) errors.push('質問 ' + idx + ' 件目のlabelが未入力です。');
    if (!q.key || !KEY_RE.test(q.key)) {
      errors.push('質問 ' + idx + ' 件目のkeyが不正です（半角英小文字で開始、英数字とアンダースコアのみ）。');
    } else if (seenQKeys[q.key]) {
      errors.push('質問のkey「' + q.key + '」が重複しています。');
    }
    seenQKeys[q.key] = true;

    var qtype = QUESTION_TYPES.find(function (t) { return t.value === q.type; });
    if (qtype && qtype.needsOptions) {
      var opts = (q.options || []).filter(function (o) { return o.label && o.label.trim(); });
      if (opts.length < 2) {
        errors.push('質問「' + (q.label || idx) + '」の選択肢は2つ以上必要です。');
      }
    }
  });

  if (config.gas && config.gas.execUrl) {
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(config.gas.execUrl)) {
      errors.push('GAS /exec URLの形式が不正です。https://script.google.com/macros/s/xxxx/exec の形式で入力してください。');
    }
  }

  var path = canonicalPath(config);
  if (existingFiles.indexOf(path) !== -1) {
    errors.push('生成先ファイル「' + path + '」は既に存在します。slugを変更してください。');
  }

  return errors;
}
