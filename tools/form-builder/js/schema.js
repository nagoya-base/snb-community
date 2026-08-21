// フォームジェネレーターの設定スキーマ定義。
// 実データは config オブジェクト（下記 createEmptyConfig の形）として保持し、
// render.js が HTML を、validate.js が公開前チェックを行う。

export const TEMPLATE_TYPES = [
  {
    type: 'event_entry',
    label: 'イベント応募フォーム',
    description: '開催確定済みイベントへの参加申込みフォーム（例：教室撮影会）',
    hasEventInfo: true,
    hasDates: false,
    hasPlans: false,
    hasConsent: true,
    leadEvent: 'generate_lead',
  },
  {
    type: 'date_survey',
    label: '開催日アンケート',
    description: '複数の候補日から参加可能日を集めるアンケート（例：キャッチボール会日程調整）',
    hasEventInfo: false,
    hasDates: true,
    hasPlans: false,
    hasConsent: false,
    leadEvent: 'survey_submit',
  },
  {
    type: 'cross_survey',
    label: '企画・クロス集計アンケート',
    description: '候補企画×候補日×価格などを同時に調査するアンケート（例：企画アンケート）',
    hasEventInfo: false,
    hasDates: true,
    hasPlans: true,
    hasConsent: false,
    leadEvent: 'survey_submit',
  },
];

export const DIRECTORIES = ['community', 'baseball', 'portrait'];

export const QUESTION_TYPES = [
  { type: 'text', label: '一行テキスト' },
  { type: 'textarea', label: '複数行テキスト' },
  { type: 'radio', label: 'ラジオボタン' },
  { type: 'checkbox', label: 'チェックボックス（複数選択）' },
  { type: 'select', label: 'セレクト' },
];

export function createEmptyConfig() {
  return {
    type: 'event_entry',
    title: '',
    subtitle: '',
    yearMonthOrId: '',
    directory: 'community',
    slug: '',
    description: '',
    ogpImagePath: '',
    // event_entry
    eventDate: '',
    startTime: '',
    endTime: '',
    price: '',
    capacity: '',
    venue: 'Studio Nagoya Base',
    entryDeadline: '',
    consentRequired: true,
    // date_survey / cross_survey
    dates: [],
    // cross_survey
    plans: [],
    // common
    questions: [],
    contact: { name: true, xAccount: true, email: true, emailRequired: false },
    gasExecUrl: '',
    resultsGasExecUrl: '',
    leadType: '',
  };
}

export function templateMeta(type) {
  return TEMPLATE_TYPES.find((t) => t.type === type) || TEMPLATE_TYPES[0];
}

let questionSeq = 0;
export function createEmptyQuestion() {
  questionSeq += 1;
  return {
    key: `question_${questionSeq}`,
    type: 'text',
    label: '',
    required: false,
    options: [],
    help: '',
  };
}

export function createEmptyOption() {
  return { value: '', label: '' };
}

export function createEmptyDate() {
  return { date: '', label: '' };
}

export function createEmptyPlan() {
  return { key: '', label: '' };
}
