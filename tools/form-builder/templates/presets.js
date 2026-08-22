/*
 * 「前回を複製」用プリセット。現行の代表3フォームを雛形として読み込む。
 * slug・公開先ファイル名は既存ファイルと衝突しないよう空欄にしてあり、
 * 読み込み後に必ず編集させる（衝突チェックは validate.js で行う）。
 */
(function (global) {
  'use strict';

  function base(type, overrides) {
    var config = global.FFSchema.createConfig(type);
    Object.assign(config, overrides, {
      meta: Object.assign(config.meta, overrides.meta),
      event: config.event ? Object.assign(config.event, overrides.event) : config.event,
      dateModel: Object.assign(config.dateModel, overrides.dateModel)
    });
    /*
     * createConfig()時点ではmeta.titleが空のため、通知メール件名の既定値も
     * 空タイトルを元に生成されている。ここでpreset側のタイトル確定後に
     * 作り直す（build()側で候補日・質問を追加変更する場合は、その後さらに
     * syncNotificationFields()を呼んで項目一覧を最新化すること）。
     */
    config.notification.subject = global.FFSchema.defaultNotificationSubject(config);
    global.FFSchema.syncNotificationFields(config);
    return config;
  }

  /*
   * 野球ユニ部プリセット（Issue #266）：Issue #263 で確定した
   * baseball/gas/enquete_202609_backend.gs のCOLUMNS（24列）と同じ項目構成を、
   * form-builderの一般化されたスキーマ（identity + dateModel + questions）で
   * 再現する。「同一人物1票・再回答upsert」等baseball方式固有の照合ロジックは
   * form-builderのGASテンプレート生成の対象外（README「できないこと」）のため
   * 再現しない。あくまで通知メール・Sheet列として24項目が揃うことが目的。
   * 日付6列は本文中の固定文字列ではなく、dateModel.datesのkeyから
   * 'date_' + key として生成される（gas-renderer.js）。既存本番Sheetとの列名
   * 互換のため、keyは 'd' + MMDD ではなくbaseball方式の '0905' 等を明示する。
   */
  var BASEBALL_DATE_DEFS = [
    { day: 5, key: '0905' },
    { day: 6, key: '0906' },
    { day: 13, key: '0913' },
    { day: 19, key: '0919' },
    { day: 20, key: '0920' },
    { day: 27, key: '0927' }
  ];

  function baseballDateEntries() {
    return BASEBALL_DATE_DEFS.map(function (d) {
      var entry = global.FFSchema.makeDateEntry(nextMonthDate(d.day));
      entry.key = d.key;
      return entry;
    });
  }

  var BASEBALL_QUESTIONS = [
    {
      key: 'participation_history', type: 'radio', label: '参加経験', required: true,
      options: [
        { value: 'first_time', label: '初参加' },
        { value: 'returning', label: '以前参加したことがある' }
      ]
    },
    {
      key: 'first_time_motivation', type: 'text', label: '参加のきっかけ', required: false, maxLength: 100,
      helpText: '初参加の方のみご記入ください。'
    },
    {
      key: 'age_group', type: 'radio', label: '年代', required: false,
      options: [
        { value: '10s', label: '10代' },
        { value: '20s', label: '20代' },
        { value: '30s', label: '30代' },
        { value: '40s', label: '40代' },
        { value: '50plus', label: '50代以上' }
      ]
    },
    {
      key: 'sports_experience', type: 'radio', label: '運動経験', required: false,
      options: [
        { value: 'none', label: '運動経験はほとんどない' },
        { value: 'student', label: '学生時代など少し前に運動していた' },
        { value: 'recent', label: '最近（1年以内）まで運動していた' },
        { value: 'current', label: '今も定期的に運動している' }
      ]
    },
    {
      key: 'uniform_status', type: 'radio', label: 'ユニフォーム着用予定', required: false,
      options: [
        { value: 'yes', label: '着用する予定' },
        { value: 'no', label: '着用しない予定（動きやすい服装で参加）' },
        { value: 'undecided', label: 'まだ決めていない' }
      ]
    },
    {
      key: 'glove_availability', type: 'radio', label: 'グローブ準備状況', required: false,
      options: [
        { value: 'have', label: '持参できる' },
        { value: 'none', label: '持っていない（相談したい）' },
        { value: 'undecided', label: 'まだわからない' }
      ]
    },
    {
      key: 'participation_intent', type: 'radio', label: '参加意向', required: true,
      options: [
        { value: 'join', label: '参加する' },
        { value: 'undecided', label: '参加を迷っている' }
      ]
    },
    {
      key: 'time_preferences', type: 'checkbox', label: '希望時間帯', required: false,
      options: [
        { value: 'morning', label: '午前中' },
        { value: 'afternoon', label: '13〜15時ごろ' },
        { value: 'any', label: '時間は特にこだわらない' }
      ]
    },
    {
      key: 'activity_preferences', type: 'checkbox', label: 'やってみたいこと', required: false,
      options: [
        { value: 'catch', label: 'キャッチボール' },
        { value: 'knock', label: 'ノック' },
        { value: 'fielding', label: '守備・送球練習' },
        { value: 'beginner', label: '初心者向け練習' },
        { value: 'photo', label: '軽く写真撮影' },
        { value: 'bath', label: '練習後の銭湯' }
      ]
    },
    { key: 'free_comment', type: 'textarea', label: '自由記述', required: false, maxLength: 300 },
    {
      key: 'x_follow_approval_ack', type: 'checkbox', label: 'Xフォロー確認', required: false,
      helpText: '初参加でXアカウントを記入した方のみ対象です。',
      options: [{ value: 'ack', label: '確認済み' }]
    },
    {
      key: 'x_contact_method', type: 'radio', label: 'X連絡方法（DMグループ希望など）', required: false,
      options: [
        { value: 'dm_group', label: '当日用DMグループへの追加を希望する' },
        { value: 'individual_dm', label: '個別DMで連絡してほしい' }
      ]
    }
  ];

  var PRESETS = [
    {
      id: 'classroom_20260912',
      label: '9/12教室セット撮影会応募フォームを雛形にする',
      build: function () {
        return base('event_entry', {
          meta: {
            title: '（新しい教室セット撮影会）参加申込',
            subtitle: '学校机・椅子・教卓・黒板のある教室セットで撮影と交流を楽しむ少人数イベント。',
            pageDir: 'community',
            accent: global.FFSchema.accentForDir('community')
          },
          event: { fee: '3,500円', capacity: '5〜6名程度', venue: 'Studio Nagoya Base（名古屋・上前津）' }
        });
      }
    },
    {
      id: 'enquete_202609_baseball',
      label: '9月キャッチボール会アンケートを雛形にする（野球ユニ部24項目通知に対応）',
      build: function () {
        var config = base('date_survey', {
          meta: {
            title: '（新しいキャッチボール会）開催日アンケート',
            subtitle: '参加可能な日を教えてください。初参加の方も大歓迎です。',
            pageDir: 'baseball',
            accent: global.FFSchema.accentForDir('baseball')
          },
          event: null
        });
        config.dateModel.mode = 'per-date-radio';
        config.dateModel.allowNoneOption = false;
        config.dateModel.dates = baseballDateEntries();
        config.identity.showXAccount = true;
        config.questions = JSON.parse(JSON.stringify(BASEBALL_QUESTIONS)).map(function (q) {
          return Object.assign({ enabled: true }, q);
        });
        global.FFSchema.syncNotificationFields(config);
        /* Issue #263のNOTIFICATION_COLUMN_LABELSに合わせる（他はbuildFieldSpecsの既定と一致）。 */
        config.notification.subject = '【名古屋野球ユニ部】9月日程アンケートに新しい回答があります';
        config.notification.fields.forEach(function (f) {
          if (f.key === 'display_name') { f.label = 'お名前／ハンドルネーム'; f.labelIsCustom = true; }
        });
        return config;
      }
    },
    {
      id: 'enquete_202609_community',
      label: '9月企画アンケートを雛形にする',
      build: function () {
        var d1 = global.FFSchema.makeDateEntry(nextMonthDate(19));
        var d2 = global.FFSchema.makeDateEntry(nextMonthDate(26));
        var config = base('cross_tab_survey', {
          meta: {
            title: '（新しい企画）候補日・興味アンケート',
            subtitle: '候補企画・候補日・価格帯についてのアンケートです。',
            pageDir: 'community',
            accent: global.FFSchema.accentForDir('community')
          },
          event: null
        });
        config.dateModel.dates = [d1, d2];
        global.FFSchema.syncNotificationFields(config);
        return config;
      }
    }
  ];

  function nextMonthDate(day) {
    var now = new Date();
    var y = now.getFullYear();
    var m = now.getMonth() + 1; /* 翌月 */
    if (m > 11) { m = 0; y += 1; }
    var mm = String(m + 1).padStart(2, '0');
    var dd = String(day).padStart(2, '0');
    return y + '-' + mm + '-' + dd;
  }

  global.FFPresets = PRESETS;
})(window);
