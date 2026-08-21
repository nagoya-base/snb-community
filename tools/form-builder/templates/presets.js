/*
 * 「前回を複製」用プリセット。現行の代表3フォームを雛形として読み込む。
 * slug・公開先ファイル名は既存ファイルと衝突しないよう空欄にしてあり、
 * 読み込み後に必ず編集させる（衝突チェックは validate.js で行う）。
 */
(function (global) {
  'use strict';

  function base(type, overrides) {
    var config = global.FFSchema.createConfig(type);
    return Object.assign(config, overrides, {
      meta: Object.assign(config.meta, overrides.meta),
      event: config.event ? Object.assign(config.event, overrides.event) : config.event,
      dateModel: Object.assign(config.dateModel, overrides.dateModel)
    });
  }

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
      label: '9月キャッチボール会アンケートを雛形にする',
      build: function () {
        var d1 = global.FFSchema.makeDateEntry(nextMonthDate(5));
        var d2 = global.FFSchema.makeDateEntry(nextMonthDate(13));
        var config = base('date_survey', {
          meta: {
            title: '（新しいキャッチボール会）開催日アンケート',
            subtitle: '参加可能な日を教えてください。初参加の方も大歓迎です。',
            pageDir: 'baseball',
            accent: global.FFSchema.accentForDir('baseball')
          },
          event: null
        });
        config.dateModel.dates = [d1, d2];
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
