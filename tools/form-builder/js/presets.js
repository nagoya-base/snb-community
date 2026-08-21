// 「前回を複製」用のプリセット。既存3フォームのDOM解析ではなく、
// テンプレート設定（このアプリのconfigスキーマ）として手動で再現したもの。
// フィールド構成は簡略化されており、既存公開ページの完全な複製ではない
// （詳細は tools/form-builder/README.md を参照）。

export const PRESETS = [
  {
    id: 'classroom_20260912',
    label: '9/12教室撮影会応募フォームを雛形にする',
    config: {
      type: 'event_entry',
      title: '2026年9月SNBC教室撮影会',
      subtitle: '学校セットで撮影と交流を楽しむ少人数イベント',
      yearMonthOrId: '202609',
      directory: 'community',
      slug: 'classroom_yyyymmdd',
      description: '名古屋・上前津のStudio Nagoya Baseで開催する教室撮影会の参加申込ページです。',
      ogpImagePath: '',
      eventDate: '',
      startTime: '14:00',
      endTime: '17:00',
      price: '3500',
      capacity: '6',
      venue: 'Studio Nagoya Base',
      entryDeadline: '',
      consentRequired: true,
      dates: [],
      plans: [],
      questions: [
        { key: 'costume', type: 'select', label: '衣装・参加内容', required: true, options: [{ value: 'own', label: '私服' }, { value: 'rental', label: '貸出衣装' }], help: '' },
        { key: 'note', type: 'textarea', label: '備考・質問', required: false, options: [], help: '運営への質問・要望があればご記入ください。' },
      ],
      contact: { name: true, xAccount: true, email: true, emailRequired: true },
      gasExecUrl: '',
      resultsGasExecUrl: '',
      leadType: 'snbc_event_entry',
    },
  },
  {
    id: 'baseball_enquete_202609',
    label: '9月キャッチボール会アンケートを雛形にする',
    config: {
      type: 'date_survey',
      title: '9月キャッチボール会 開催日アンケート',
      subtitle: '参加可能な候補日を教えてください',
      yearMonthOrId: '202609',
      directory: 'baseball',
      slug: 'enquete_yyyymm',
      description: '名古屋野球ユニ部のキャッチボール会、開催候補日アンケートです。',
      ogpImagePath: '',
      dates: [
        { date: '2026-09-05', label: '9/5(土)' },
        { date: '2026-09-13', label: '9/13(日)' },
      ],
      plans: [],
      questions: [
        { key: 'concern', type: 'textarea', label: '不安・質問', required: false, options: [], help: '初参加の方はご不安な点をご記入ください。' },
      ],
      contact: { name: true, xAccount: true, email: false, emailRequired: false },
      gasExecUrl: '',
      resultsGasExecUrl: '',
      leadType: '',
    },
  },
  {
    id: 'community_enquete_202609',
    label: '9月企画アンケートを雛形にする',
    config: {
      type: 'cross_survey',
      title: '9月企画アンケート',
      subtitle: '候補企画と参加可能日を教えてください',
      yearMonthOrId: '202609',
      directory: 'community',
      slug: 'enquete_yyyymm',
      description: 'SNBコミュニティ、次回企画とスケジュールに関するアンケートです。',
      ogpImagePath: '',
      dates: [
        { date: '2026-09-19', label: '9/19(土)' },
        { date: '2026-09-26', label: '9/26(土)' },
      ],
      plans: [
        { key: 'plan_a', label: '企画A' },
        { key: 'plan_b', label: '企画B' },
      ],
      questions: [
        { key: 'price_expectation', type: 'radio', label: '参加費の目安', required: true, options: [{ value: 'under_3000', label: '3,000円以内' }, { value: 'over_3000', label: '3,000円超も可' }], help: '' },
        { key: 'concern', type: 'textarea', label: '不安・懸念', required: false, options: [], help: '' },
      ],
      contact: { name: true, xAccount: true, email: false, emailRequired: false },
      gasExecUrl: '',
      resultsGasExecUrl: '',
      leadType: '',
    },
  },
];
