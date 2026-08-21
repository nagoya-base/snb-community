// SNB Form Builder: 「前回を複製」用のプリセット。
// 現行の代表フォームを参考に、テンプレート設定(JSON)として再構成したもの。
// 既存HTMLをDOM解析して複製するのではなく、代表的な項目構成を手作業でJSON化している。
// 実際の生成前に、日付・料金・定員・文言などは必ず今回の開催に合わせて編集すること。

import { emptyConfig, newQuestion, newDate, newPlan } from './schema.js';

export function classroomPreset() {
  var c = emptyConfig();
  c.type = 'event_entry';
  c.pillar = 'community';
  c.slug = '';
  c.title = '（新しい開催回のタイトルに変更してください）教室撮影会';
  c.subtitle = '学校机・椅子・教卓・黒板のある教室セットで撮影と交流を楽しむ少人数イベントです。一人参加・初参加も歓迎です。';
  c.meta.description = '（開催日時・会場・参加費・定員を記載した紹介文に変更してください）';
  c.event = { date: '', startTime: '14:00', endTime: '17:00', price: '3500円', capacity: '5〜6名程度', venue: 'Studio Nagoya Base（名古屋市中区上前津）', deadline: '' };
  c.consentText = '利用規約・参加ルールに同意します';
  c.questions = [
    newQuestion({ key: 'display_name', type: 'text', label: '表示名／ハンドルネーム', required: true, help: '例：アタル' }),
    newQuestion({ key: 'contact_email', type: 'text', label: 'メールアドレス', required: false }),
    newQuestion({ key: 'contact_x', type: 'text', label: 'Xアカウント', required: false }),
    newQuestion({
      key: 'wear', type: 'checkbox', label: '参加予定の衣装', required: true, allowOther: true,
      options: [
        { value: '野球ユニフォーム', label: '野球ユニフォーム' },
        { value: 'サッカーユニフォーム', label: 'サッカーユニフォーム' },
        { value: '陸上ユニフォーム', label: '陸上ユニフォーム' },
        { value: '制服・体操服', label: '制服・体操服' },
        { value: '私服', label: '私服' }
      ]
    }),
    newQuestion({
      key: 'wear_ownership', type: 'radio', label: '当日着用する衣装を用意できますか？', required: true,
      help: '衣装の貸出は行っていません。',
      options: [
        { value: 'have', label: '持っている' },
        { value: 'preparing', label: '現在準備中' },
        { value: 'none', label: '持っていない' }
      ]
    }),
    newQuestion({
      key: 'concern', type: 'checkbox', label: '撮影について、希望・不安なこと', required: false, allowOther: true,
      options: [
        { value: '一人参加が不安', label: '一人参加が不安' },
        { value: '初対面の人との交流が不安', label: '初対面の人との交流が不安' },
        { value: '撮られるのが苦手', label: '撮られるのが苦手' },
        { value: '衣装を持っていない', label: '衣装を持っていない' },
        { value: '料金', label: '料金' }
      ]
    }),
    newQuestion({ key: 'free_comment', type: 'textarea', label: '自由記述', required: false, help: '運営への質問やメッセージなど、自由にどうぞ' })
  ];
  return c;
}

export function baseballDateSurveyPreset() {
  var c = emptyConfig();
  c.type = 'date_survey';
  c.pillar = 'baseball';
  c.slug = '';
  c.title = '（新しい開催回のタイトルに変更してください）キャッチボール会 初参加エントリー';
  c.subtitle = '候補日から参加できる日を教えてください。';
  c.meta.description = '（対象・持ち物・参加可能日の候補を記載した紹介文に変更してください）';
  c.dates = [
    newDate({ key: 'date_0905', date: '2026-09-05', label: '第1候補' }),
    newDate({ key: 'date_0913', date: '2026-09-13', label: '第2候補' })
  ];
  c.consentText = '参加ルールに同意します';
  c.questions = [
    newQuestion({ key: 'display_name', type: 'text', label: '表示名／ハンドルネーム', required: true }),
    newQuestion({ key: 'contact_x', type: 'text', label: 'Xアカウント', required: false }),
    newQuestion({ key: 'available_dates', type: 'date_multi', label: '参加可能日', required: true, help: '参加できる日を選んでください（複数選択可）。' }),
    newQuestion({ key: 'first_choice_date', type: 'date_single', label: '第一希望日', required: false }),
    newQuestion({ key: 'second_choice_date', type: 'date_single', label: '第二希望日', required: false }),
    newQuestion({
      key: 'concern', type: 'checkbox', label: '不安・質問があれば教えてください', required: false, allowOther: true,
      options: [
        { value: '一人参加が不安', label: '一人参加が不安' },
        { value: '経験がなく不安', label: '経験がなく不安' },
        { value: '道具を持っていない', label: '道具を持っていない' }
      ]
    })
  ];
  return c;
}

export function communityCrossSurveyPreset() {
  var c = emptyConfig();
  c.type = 'cross_survey';
  c.pillar = 'community';
  c.slug = '';
  c.title = '（新しい企画名に変更してください）企画アンケート';
  c.subtitle = '候補企画への参加意向・候補日・価格感を教えてください。';
  c.meta.description = '（企画概要・回答目的を記載した紹介文に変更してください）';
  c.plans = [
    newPlan({ key: 'plan_main', label: '学校セット撮影会' })
  ];
  c.dates = [
    newDate({ key: 'date_0919', date: '2026-09-19' }),
    newDate({ key: 'date_0926', date: '2026-09-26' })
  ];
  c.consentText = '';
  c.questions = [
    newQuestion({ key: 'contact_x', type: 'text', label: 'Xアカウント等（任意）', required: false }),
    newQuestion({
      key: 'intent', type: 'radio', label: '参加意向', required: true,
      options: [
        { value: '日程が合えばかなり参加したい', label: 'かなり行きたい' },
        { value: '条件（料金・人数など）が合えば参加を検討したい', label: '条件が合えば' },
        { value: '参加してみたいが、名古屋は遠い', label: '行きたいが名古屋は遠い' },
        { value: '興味はあるが参加までは分からない', label: '興味はある' },
        { value: '見るだけ・投票だけ', label: '投票だけしたい' }
      ]
    }),
    newQuestion({ key: 'available_dates', type: 'date_multi', label: '参加できそうな候補日', required: false }),
    newQuestion({
      key: 'price_pref', type: 'radio', label: '価格帯の希望', required: false,
      options: [
        { value: '3000円まで', label: '〜3,000円' },
        { value: '5000円まで', label: '〜5,000円' },
        { value: '価格は気にしない', label: '価格は気にしない' }
      ]
    }),
    newQuestion({
      key: 'concern', type: 'checkbox', label: '不安があれば教えてください', required: false, allowOther: true,
      options: [
        { value: '一人参加が不安', label: '一人参加が不安' },
        { value: '初対面の人との交流が不安', label: '初対面の人との交流が不安' }
      ]
    }),
    newQuestion({ key: 'free_comment', type: 'textarea', label: '自由記述', required: false })
  ];
  return c;
}

export const PRESETS = [
  { id: 'classroom', label: '9/12教室セット撮影会応募フォームを雛形にする', build: classroomPreset },
  { id: 'baseball-date-survey', label: '9月キャッチボール会アンケートを雛形にする', build: baseballDateSurveyPreset },
  { id: 'community-cross-survey', label: '9月企画アンケートを雛形にする', build: communityCrossSurveyPreset }
];
