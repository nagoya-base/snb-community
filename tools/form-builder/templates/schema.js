/*
 * form-builder の設定JSONスキーマと、各テンプレート種別のデフォルト値・
 * プリセット質問（トグルON/OFF可能）を定義する。
 *
 * 設定JSON（生成物）の形：
 * {
 *   formVersion: 1,
 *   type: "event_entry" | "date_survey" | "cross_tab_survey",
 *   meta: {
 *     title, subtitle, slug, pageDir, fileName, canonicalUrl, ogImage, accent
 *   },
 *   event: {           // type === "event_entry" のときのみ使用
 *     eventDate, startTime, endTime, fee, capacity, venue, deadline
 *   },
 *   dateModel: {
 *     mode: "none" | "multi-select" | "per-date-radio",
 *     allowNoneOption: boolean,
 *     dates: [{ key, date, weekday, label, deadline }]
 *   },
 *   identity: {
 *     showXAccount: boolean,
 *     consent: { enabled: boolean, label }   // event_entry のみ意味を持つ
 *   },
 *   questions: [
 *     { key, type: "text"|"textarea"|"radio"|"checkbox"|"select",
 *       label, required, helpText, options: [{value,label}], otherOption }
 *   ],
 *   endpoints: { submitUrl },
 *   analytics: { formName, leadType }
 * }
 *
 * 個人情報（氏名・連絡先・同意）は identity ブロックとして固定の型を持ち、
 * questions[] には含めない（analytics.js の「個人情報は送信しない」規約と
 * 直接関わるため、汎用質問と混在させず明示的に扱う）。
 *
 * notification（Issue #266）：
 * {
 *   enabled: boolean,       // 通知メールを送信するか
 *   subject: string,        // 件名（新規・更新の別なし。GASテンプレートは
 *                            // upsertを実装しないため常に新規回答扱い）
 *   autoAllFields: boolean, // true＝保存対象の全項目を通知（既定）。
 *                            // falseの場合のみ fields[].enabled を個別に見る
 *   fields: [{ key, label, enabled, labelIsCustom }]
 * }
 * fields[] は buildFieldSpecs() が導出する「保存される全項目」から
 * syncNotificationFields() が自動生成・同期する。labelIsCustomがtrueの項目は
 * 質問ラベル等が変わっても自動追従させない（ユーザーが手動編集した値を保持する）。
 */
(function (global) {
  'use strict';

  var WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

  function weekdayOf(isoDate) {
    if (!isoDate) return '';
    var parts = isoDate.split('-');
    if (parts.length !== 3) return '';
    var y = Number(parts[0]), m = Number(parts[1]), d = Number(parts[2]);
    if (!y || !m || !d) return '';
    /*
     * 曜日はカレンダー上の日付そのものに対して一意に決まる値なので、
     * 実行環境のローカルタイムゾーンに依存しない Date.UTC + getUTCDay()
     * で計算する（"+09:00"付きでDateを作りgetDay()を使うと、実行環境の
     * ローカルタイムゾーンによって前日扱いになり曜日がずれることがある）。
     */
    var utcDate = new Date(Date.UTC(y, m - 1, d));
    if (isNaN(utcDate.getTime())) return '';
    return WEEKDAY_LABELS[utcDate.getUTCDay()];
  }

  function shortLabel(isoDate) {
    if (!isoDate) return '';
    var parts = isoDate.split('-');
    if (parts.length !== 3) return isoDate;
    var wd = weekdayOf(isoDate);
    return Number(parts[1]) + '/' + Number(parts[2]) + (wd ? '(' + wd + ')' : '');
  }

  function makeDateEntry(isoDate, deadline) {
    return {
      key: 'd' + isoDate.replace(/-/g, '').slice(4),
      date: isoDate,
      weekday: weekdayOf(isoDate),
      label: shortLabel(isoDate),
      deadline: deadline || ''
    };
  }

  var TEMPLATE_DEFS = {
    event_entry: {
      label: 'イベント応募フォーム',
      referenceNote: '参考実装: community/classroom_20260912.html',
      dateModel: { mode: 'none' },
      identityDefaults: { showXAccount: true, consent: { enabled: true, label: '注意事項・キャンセルポリシーに同意します' } },
      analyticsDefaults: { leadType: 'snbc_event_entry' },
      presetQuestions: [
        {
          key: 'wear_items', type: 'checkbox', label: '当日の衣装', required: true,
          helpText: '参考実装の代表的な選択肢です。実際のイベントに合わせて選択肢を編集してください。',
          otherOption: true,
          options: [
            { value: 'school_uniform', label: '学生服・セーラー服' },
            { value: 'blazer', label: 'ブレザー' },
            { value: 'gym_wear', label: '体操服・ジャージ' },
            { value: 'indoor_shoes', label: '上履き' }
          ]
        },
        {
          key: 'wear_ownership', type: 'radio', label: '衣装の準備状況', required: true,
          options: [
            { value: 'have', label: '持っている' },
            { value: 'preparing', label: '準備中' },
            { value: 'none', label: '持っていない（相談したい）' }
          ]
        },
        {
          key: 'first_time', type: 'radio', label: 'このイベントは初参加ですか', required: false,
          options: [
            { value: 'yes', label: 'はい、初めてです' },
            { value: 'no', label: 'いいえ、参加したことがあります' }
          ]
        },
        {
          key: 'concerns', type: 'checkbox', label: '不安な点・気になる点', required: false, otherOption: true,
          options: [
            { value: 'first_time_anxiety', label: '初参加で緊張する' },
            { value: 'talk', label: '会話が続くか不安' },
            { value: 'photo', label: '写真映りが心配' }
          ]
        },
        { key: 'free_comment', type: 'textarea', label: '運営への質問・備考', required: false, maxLength: 300 }
      ]
    },
    date_survey: {
      label: '開催日アンケート',
      referenceNote: '参考実装: baseball/enquete_202609.html',
      dateModel: { mode: 'per-date-radio', allowNoneOption: false },
      identityDefaults: { showXAccount: true, consent: { enabled: false } },
      analyticsDefaults: {},
      presetQuestions: [
        {
          key: 'age_group', type: 'radio', label: '年代', required: true,
          options: [
            { value: '10s', label: '10代' },
            { value: '20s', label: '20代' },
            { value: '30s', label: '30代' },
            { value: '40s', label: '40代' },
            { value: '50plus', label: '50代以上' }
          ]
        },
        {
          key: 'sports_experience', type: 'radio', label: 'スポーツ経験', required: true,
          options: [
            { value: 'none', label: '未経験' },
            { value: 'student', label: '経験あり（学生まで）' },
            { value: 'adult', label: '経験あり（社会人以降も）' },
            { value: 'current', label: '現役でプレーしている' }
          ]
        },
        {
          key: 'equipment_status', type: 'radio', label: '道具の準備状況', required: true,
          options: [
            { value: 'have', label: '持っている' },
            { value: 'rental', label: 'レンタル希望' },
            { value: 'undecided', label: '検討中' }
          ]
        },
        { key: 'activity_pref', type: 'checkbox', label: '当日やってみたいこと', required: false,
          options: [
            { value: 'catch', label: 'キャッチボール' },
            { value: 'batting', label: 'バッティング' },
            { value: 'talk', label: '交流・雑談' }
          ]
        },
        { key: 'free_comment', type: 'textarea', label: '不安な点・質問', required: false, maxLength: 300 }
      ]
    },
    cross_tab_survey: {
      label: '企画・クロス集計アンケート',
      referenceNote: '参考実装: community/enquete_202609.html',
      dateModel: { mode: 'multi-select', allowNoneOption: true },
      identityDefaults: { showXAccount: true, consent: { enabled: false } },
      analyticsDefaults: {},
      presetQuestions: [
        {
          key: 'wear', type: 'checkbox', label: '興味のある衣装', required: false, otherOption: true,
          options: [
            { value: 'school_uniform', label: '学生服・セーラー服' },
            { value: 'blazer', label: 'ブレザー' },
            { value: 'gym_wear', label: '体操服・ジャージ' }
          ]
        },
        {
          key: 'intent', type: 'radio', label: '参加意向', required: true,
          options: [
            { value: 'strong_yes', label: 'ぜひ参加したい' },
            { value: 'yes', label: '参加したい' },
            { value: 'undecided', label: '迷っている' },
            { value: 'weak_no', label: 'たぶん参加しない' },
            { value: 'no', label: '参加しない' }
          ]
        },
        {
          key: 'price_pref', type: 'radio', label: '希望価格帯', required: true,
          options: [
            { value: 'p3000', label: '〜3,000円' },
            { value: 'p4000', label: '3,001〜4,000円' },
            { value: 'p5000', label: '4,001〜5,000円' },
            { value: 'p5000plus', label: '5,001円以上' }
          ]
        },
        { key: 'concern', type: 'checkbox', label: '不安・懸念点', required: false, otherOption: true,
          options: [
            { value: 'first_time_anxiety', label: '初参加で緊張する' },
            { value: 'schedule', label: '日程が合うか不安' }
          ]
        },
        {
          key: 'source_channel', type: 'radio', label: 'このイベントを知ったきっかけ', required: true, otherOption: true,
          options: [
            { value: 'x', label: 'X（旧Twitter）' },
            { value: 'referral', label: '知人の紹介' },
            { value: 'search', label: '検索' }
          ]
        },
        { key: 'free_comment', type: 'textarea', label: '自由記述', required: false, maxLength: 300 }
      ]
    }
  };

  function accentForDir(pageDir) {
    if (pageDir === 'baseball') return 'baseball';
    if (pageDir === 'portrait') return 'portrait';
    return 'community';
  }

  /*
   * フォームが実際に保存する全項目（system fields + identity + dateModel + questions）を、
   * key・日本語ラベル・型・必須・選択肢等のメタ情報付きで列挙する（Issue #266）。
   * この一覧が「保存対象の全項目」の唯一の情報源であり、
   * - 通知メール項目の既定値（syncNotificationFields）
   * - GASテンプレートのSheet列構成・サーバー側バリデーション（gas-renderer.js）
   * の両方がここから導出される。forms.js の collectPayload() が実際に送信する
   * payloadのキー構成と1対1で対応させること（対応関係が崩れるとSheet列とpayloadが
   * ずれるため、forms.js側を変更した場合はここも必ず同期する）。
   *
   * 各要素の形：
   * { key, label, kind, required, maxLength, options, allowOther, otherOf, dateKey }
   * kind: 'system' | 'text' | 'textarea' | 'email' | 'bool' | 'radio' | 'select' |
   *       'checkbox' | 'dateRadio' | 'dateBool'
   */
  function buildFieldSpecs(config) {
    var specs = [];

    specs.push({ key: 'submission_id', label: '送信ID', kind: 'system', required: true, maxLength: 100 });
    specs.push({ key: 'created_at', label: '初回受付日時', kind: 'system' });
    specs.push({ key: 'updated_at', label: '今回受付日時', kind: 'system' });

    specs.push({ key: 'display_name', label: 'お名前／表示名', kind: 'text', required: true, maxLength: 50 });
    specs.push({ key: 'contact_email', label: 'メールアドレス', kind: 'email', required: false, maxLength: 200 });
    if (config.identity && config.identity.showXAccount !== false) {
      specs.push({ key: 'contact_x', label: 'Xアカウント', kind: 'text', required: false, maxLength: 200 });
    }
    if (config.type === 'event_entry' && config.identity && config.identity.consent && config.identity.consent.enabled) {
      specs.push({ key: 'agree_terms', label: '同意事項への同意', kind: 'bool', required: true });
    }

    var dm = config.dateModel;
    if (dm && dm.mode !== 'none') {
      (dm.dates || []).forEach(function (d) {
        specs.push({
          key: 'date_' + d.key,
          label: d.label || d.date,
          kind: dm.mode === 'per-date-radio' ? 'dateRadio' : 'dateBool',
          required: dm.mode === 'per-date-radio',
          dateKey: d.key
        });
      });
      if (dm.mode === 'multi-select' && dm.allowNoneOption) {
        specs.push({ key: 'unavailable', label: 'どの日も難しい', kind: 'bool', required: false });
      }
    }

    (config.questions || []).forEach(function (q) {
      if (q.enabled === false) return;
      var optionValues = (q.options || []).map(function (o) { return o.value; });
      if (q.type === 'text' || q.type === 'textarea') {
        specs.push({ key: q.key, label: q.label || q.key, kind: q.type, required: !!q.required, maxLength: q.maxLength || (q.type === 'textarea' ? 300 : 200) });
        return;
      }
      if (q.type === 'select') {
        specs.push({ key: q.key, label: q.label || q.key, kind: 'select', required: !!q.required, options: optionValues });
        return;
      }
      if (q.type === 'radio' || q.type === 'checkbox') {
        specs.push({ key: q.key, label: q.label || q.key, kind: q.type, required: !!q.required, options: optionValues, allowOther: !!q.otherOption });
        if (q.otherOption) {
          specs.push({ key: q.key + '_other', label: (q.label || q.key) + '（その他自由記述）', kind: 'text', required: false, maxLength: 100, otherOf: q.key });
        }
      }
    });

    return specs;
  }

  function computeNotificationSourceFields(config) {
    return buildFieldSpecs(config).map(function (spec) {
      return { key: spec.key, label: spec.label };
    });
  }

  function defaultNotificationSubject(config) {
    var title = (config.meta && config.meta.title) || '（無題フォーム）';
    return '【SNBコミュニティ】' + title + 'に新しい回答がありました';
  }

  /*
   * notification.fields を、その時点の保存対象全項目（computeNotificationSourceFields）と
   * 同期する。既存フィールドは originally保持していたenabled/labelをできる限り維持し、
   * labelIsCustomがtrueの項目はラベルの自動追従（質問ラベル変更等の反映）をしない。
   * 保存対象から外れた項目（質問OFF・削除等）はfieldsからも取り除かれる（Issue #266
   * 完了条件「質問をOFFにした場合、その項目は…通知対象からも除外される」）。
   * config.notification が未初期化の場合はここで作成する。副作用として config を書き換える。
   */
  function syncNotificationFields(config) {
    var notif = config.notification || { enabled: true, subject: '', autoAllFields: true, fields: [] };
    if (!notif.subject) notif.subject = defaultNotificationSubject(config);

    var existingByKey = {};
    (notif.fields || []).forEach(function (f) { existingByKey[f.key] = f; });

    var source = computeNotificationSourceFields(config);
    notif.fields = source.map(function (s) {
      var existing = existingByKey[s.key];
      var label = existing && existing.labelIsCustom ? existing.label : s.label;
      var enabled = notif.autoAllFields ? true : (existing ? existing.enabled !== false : true);
      return { key: s.key, label: label, enabled: enabled, labelIsCustom: !!(existing && existing.labelIsCustom) };
    });

    config.notification = notif;
    return config;
  }

  function createConfig(type) {
    var def = TEMPLATE_DEFS[type];
    if (!def) throw new Error('unknown template type: ' + type);
    var config = {
      formVersion: 1,
      type: type,
      meta: {
        title: '',
        subtitle: '',
        slug: '',
        pageDir: 'community',
        fileName: '',
        canonicalUrl: '',
        ogImage: '',
        accent: accentForDir('community'),
        noindex: false
      },
      event: type === 'event_entry' ? { eventDate: '', startTime: '', endTime: '', fee: '', capacity: '', venue: '', deadline: '' } : null,
      dateModel: JSON.parse(JSON.stringify(def.dateModel)),
      identity: JSON.parse(JSON.stringify(def.identityDefaults)),
      questions: JSON.parse(JSON.stringify(def.presetQuestions)).map(function (q) { return Object.assign({ enabled: true }, q); }),
      endpoints: { submitUrl: '' },
      analytics: Object.assign({ formName: '' }, def.analyticsDefaults),
      notification: { enabled: true, subject: '', autoAllFields: true, fields: [] }
    };
    syncNotificationFields(config);
    return config;
  }

  global.FFSchema = {
    TEMPLATE_DEFS: TEMPLATE_DEFS,
    createConfig: createConfig,
    weekdayOf: weekdayOf,
    shortLabel: shortLabel,
    makeDateEntry: makeDateEntry,
    accentForDir: accentForDir,
    buildFieldSpecs: buildFieldSpecs,
    computeNotificationSourceFields: computeNotificationSourceFields,
    defaultNotificationSubject: defaultNotificationSubject,
    syncNotificationFields: syncNotificationFields
  };
})(window);
