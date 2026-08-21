/*
 * form-builder 管理アプリのメインロジック。
 * テンプレート選択 → 入力 → プレビュー → GitHub PR作成、の4ステップ。
 */
(function () {
  'use strict';

  var SITE_ORIGIN = 'https://nagoya-base.github.io/snb-community';

  var state = {
    config: null,
    step: 0,
    previewWidth: 390
  };

  function ce(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (attrs[k] === undefined || attrs[k] === null || attrs[k] === false) return;
        if (k === 'text') { node.textContent = attrs[k]; return; }
        if (k === 'on') {
          Object.keys(attrs.on).forEach(function (evt) { node.addEventListener(evt, attrs.on[evt]); });
          return;
        }
        if (attrs[k] === true) { node.setAttribute(k, ''); return; }
        node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function slugify(input) {
    return String(input || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
  }

  function applyDerivedFields() {
    var config = state.config;
    var slug = config.meta.slug || '';
    config.meta.fileName = slug ? slug + '.html' : '';
    config.meta.accent = window.FFSchema.accentForDir(config.meta.pageDir);
    config.meta.canonicalUrl = slug ? SITE_ORIGIN + '/' + config.meta.pageDir + '/' + config.meta.fileName : '';
    if (!config.analytics.formName || config.analytics.formName === config.analytics._auto) {
      config.analytics.formName = slug ? slug + '_form' : '';
      config.analytics._auto = config.analytics.formName;
    }
  }

  /* ── ステップ切り替え ── */

  function goToStep(n) {
    state.step = n;
    document.querySelectorAll('.fb-panel').forEach(function (p) {
      p.hidden = Number(p.getAttribute('data-panel')) !== n;
    });
    document.querySelectorAll('.fb-step').forEach(function (b) {
      var s = Number(b.getAttribute('data-step'));
      b.classList.toggle('is-active', s === n);
      b.disabled = s > 0 && !state.config;
    });
    if (n === 1) renderEditForm();
    if (n === 2) renderPreviewPanel();
    if (n === 3) renderPrPanel();
    window.scrollTo(0, 0);
  }

  document.getElementById('fb-steps').addEventListener('click', function (e) {
    var btn = e.target.closest('.fb-step');
    if (!btn || btn.disabled) return;
    var target = Number(btn.getAttribute('data-step'));
    if (target > 1 && !state.config) return;
    goToStep(target);
  });

  /* ── ステップ0: テンプレート／プリセット選択 ── */

  function renderTemplateList() {
    var wrap = document.getElementById('fb-template-list');
    wrap.textContent = '';
    Object.keys(window.FFSchema.TEMPLATE_DEFS).forEach(function (type) {
      var def = window.FFSchema.TEMPLATE_DEFS[type];
      wrap.appendChild(ce('button', {
        class: 'fb-card-btn', type: 'button',
        on: { click: function () {
          state.config = window.FFSchema.createConfig(type);
          applyDerivedFields();
          goToStep(1);
        } }
      }, [
        ce('strong', { text: def.label }),
        ce('span', { text: def.referenceNote })
      ]));
    });
  }

  function renderPresetList() {
    var wrap = document.getElementById('fb-preset-list');
    wrap.textContent = '';
    window.FFPresets.forEach(function (preset) {
      wrap.appendChild(ce('button', {
        class: 'fb-card-btn', type: 'button',
        on: { click: function () {
          state.config = preset.build();
          applyDerivedFields();
          goToStep(1);
        } }
      }, [ce('strong', { text: preset.label })]));
    });
  }

  /* ── ステップ1: 入力フォーム ── */

  function field(labelText, inputEl, note) {
    var children = [ce('label', { text: labelText }), note ? ce('p', { class: 'fb-field-note', text: note }) : null, inputEl];
    return ce('div', { class: 'fb-field' }, children);
  }

  function textInput(value, onChange, type, extra) {
    var input = ce('input', Object.assign({ type: type || 'text', value: value || '' }, extra || {}));
    input.addEventListener('input', function () { onChange(input.value); });
    return input;
  }

  function textareaInput(value, onChange, extra) {
    var input = ce('textarea', extra || {});
    input.value = value || '';
    input.addEventListener('input', function () { onChange(input.value); });
    return input;
  }

  function selectInput(value, options, onChange) {
    var select = ce('select', {});
    options.forEach(function (opt) {
      var o = ce('option', { value: opt.value, text: opt.label });
      if (opt.value === value) o.selected = true;
      select.appendChild(o);
    });
    select.addEventListener('change', function () { onChange(select.value); });
    return select;
  }

  function checkboxLine(checked, labelText, onChange) {
    var input = ce('input', { type: 'checkbox' });
    input.checked = !!checked;
    input.addEventListener('change', function () { onChange(input.checked); });
    return ce('label', { class: 'fb-checkbox-line' }, [input, ce('span', { text: labelText })]);
  }

  function renderBasicInfoSection(config) {
    var section = ce('div', { class: 'fb-section' }, [ce('h3', { text: '基本情報' })]);
    section.appendChild(field('フォーム種別', ce('p', { text: window.FFSchema.TEMPLATE_DEFS[config.type].label })));
    section.appendChild(field('タイトル', textInput(config.meta.title, function (v) { config.meta.title = v; })));
    section.appendChild(field('サブタイトル／説明', textareaInput(config.meta.subtitle, function (v) { config.meta.subtitle = v; })));
    section.appendChild(field('slug（半角英小文字・数字・アンダースコア）', textInput(config.meta.slug, function (v) {
      config.meta.slug = slugify(v);
      applyDerivedFields();
      updateDerivedDisplay();
    }, 'text', { placeholder: '例: enquete_202610' })));
    section.appendChild(field('公開先ディレクトリ', selectInput(config.meta.pageDir, [
      { value: 'community', label: 'community/' },
      { value: 'baseball', label: 'baseball/' },
      { value: 'portrait', label: 'portrait/' }
    ], function (v) { config.meta.pageDir = v; applyDerivedFields(); updateDerivedDisplay(); })));
    section.appendChild(field('生成ファイル名（自動）', ce('p', { id: 'fb-derived-filename', text: config.meta.fileName || '（slugを入力すると自動生成されます）' })));
    section.appendChild(field('公開URL（自動）', ce('p', { id: 'fb-derived-canonical', text: config.meta.canonicalUrl || '' })));
    section.appendChild(checkboxLine(config.meta.noindex, '検索エンジンにインデックスさせない（noindex）', function (v) { config.meta.noindex = v; }));
    section.appendChild(field('OGP画像URL（任意・既存画像の絶対URLを入力）', textInput(config.meta.ogImage, function (v) { config.meta.ogImage = v; })));
    return section;
  }

  function updateDerivedDisplay() {
    var fn = document.getElementById('fb-derived-filename');
    var cu = document.getElementById('fb-derived-canonical');
    if (fn) fn.textContent = state.config.meta.fileName || '（slugを入力すると自動生成されます）';
    if (cu) cu.textContent = state.config.meta.canonicalUrl || '';
  }

  function renderEventSection(config) {
    if (config.type !== 'event_entry') return null;
    var ev = config.event;
    var section = ce('div', { class: 'fb-section' }, [ce('h3', { text: 'イベント情報' })]);
    section.appendChild(field('開催日', textInput(ev.eventDate, function (v) { ev.eventDate = v; }, 'date')));
    var row = ce('div', { class: 'fb-row' }, [
      field('開始時刻', textInput(ev.startTime, function (v) { ev.startTime = v; }, 'text', { placeholder: '14:00' })),
      field('終了時刻', textInput(ev.endTime, function (v) { ev.endTime = v; }, 'text', { placeholder: '17:00' }))
    ]);
    section.appendChild(row);
    section.appendChild(field('料金', textInput(ev.fee, function (v) { ev.fee = v; }, 'text', { placeholder: '3,500円' })));
    section.appendChild(field('定員', textInput(ev.capacity, function (v) { ev.capacity = v; }, 'text', { placeholder: '5〜6名程度' })));
    section.appendChild(field('会場', textInput(ev.venue, function (v) { ev.venue = v; })));
    section.appendChild(field('申込締切（任意）', textInput(ev.deadline, function (v) { ev.deadline = v; }, 'date')));
    return section;
  }

  function renderDatesSection(config) {
    var dm = config.dateModel;
    if (dm.mode === 'none') return null;
    var section = ce('div', { class: 'fb-section' }, [ce('h3', { text: '候補日' })]);
    if (dm.mode === 'multi-select') {
      section.appendChild(checkboxLine(dm.allowNoneOption, '「どちらも／どの日も難しい」の排他選択肢を出す', function (v) { dm.allowNoneOption = v; }));
    }
    var list = ce('div', {});
    (dm.dates || []).forEach(function (d, idx) {
      var row = ce('div', { class: 'fb-date-row' });
      row.appendChild(ce('div', { class: 'fb-date-row__head' }, [
        ce('strong', { text: '候補日 ' + (idx + 1) }),
        ce('button', { type: 'button', class: 'fb-btn fb-btn--danger fb-btn--small', text: '削除', on: { click: function () {
          dm.dates.splice(idx, 1);
          renderEditForm();
        } } })
      ]));
      row.appendChild(field('日付', textInput(d.date, function (v) {
        d.date = v;
        d.weekday = window.FFSchema.weekdayOf(v);
        d.label = window.FFSchema.shortLabel(v);
        d.key = 'd' + v.replace(/-/g, '').slice(4);
        labelPreview.textContent = d.label ? '表示ラベル: ' + d.label : '';
      }, 'date')));
      var labelPreview = ce('p', { class: 'fb-field-note', text: d.label ? '表示ラベル: ' + d.label : '' });
      row.appendChild(labelPreview);
      if (dm.mode === 'per-date-radio') {
        row.appendChild(field('この日の回答締切（任意）', textInput(d.deadline, function (v) { d.deadline = v; }, 'date')));
      }
      list.appendChild(row);
    });
    section.appendChild(list);
    section.appendChild(ce('button', {
      type: 'button', class: 'fb-btn', text: '＋候補日を追加',
      on: { click: function () {
        dm.dates = dm.dates || [];
        dm.dates.push(window.FFSchema.makeDateEntry(''));
        renderEditForm();
      } }
    }));
    return section;
  }

  function renderIdentitySection(config) {
    var section = ce('div', { class: 'fb-section' }, [ce('h3', { text: '連絡先設定' })]);
    section.appendChild(checkboxLine(config.identity.showXAccount, 'Xアカウント欄を表示する', function (v) { config.identity.showXAccount = v; }));
    if (config.type === 'event_entry') {
      section.appendChild(checkboxLine(config.identity.consent.enabled, '同意チェックボックスを表示する', function (v) {
        config.identity.consent.enabled = v;
        renderEditForm();
      }));
      if (config.identity.consent.enabled) {
        section.appendChild(field('同意文言', textInput(config.identity.consent.label, function (v) { config.identity.consent.label = v; })));
      }
    }
    return section;
  }

  function optionsEditor(question) {
    var wrap = ce('div', {});
    (question.options || []).forEach(function (opt, oi) {
      var row = ce('div', { class: 'fb-option-row' }, [
        ce('div', { class: 'fb-row' }, [
          textInput(opt.label, function (v) { opt.label = v; opt.value = opt.value || slugify(v); }, 'text', { placeholder: '選択肢の表示名' }),
          textInput(opt.value, function (v) { opt.value = slugify(v); }, 'text', { placeholder: 'value' })
        ]),
        ce('button', { type: 'button', class: 'fb-btn fb-btn--danger fb-btn--small', text: '選択肢を削除', on: { click: function () {
          question.options.splice(oi, 1);
          renderEditForm();
        } } })
      ]);
      wrap.appendChild(row);
    });
    wrap.appendChild(ce('button', {
      type: 'button', class: 'fb-btn fb-btn--small', text: '＋選択肢を追加',
      on: { click: function () {
        question.options = question.options || [];
        question.options.push({ value: '', label: '' });
        renderEditForm();
      } }
    }));
    return wrap;
  }

  function renderQuestionCard(question, onRemove, removable) {
    var card = ce('div', { class: 'fb-question-card' });
    card.appendChild(ce('div', { class: 'fb-question-card__head' }, [
      checkboxLine(question.enabled !== false, '有効にする', function (v) { question.enabled = v; }),
      removable ? ce('button', { type: 'button', class: 'fb-btn fb-btn--danger fb-btn--small', text: '削除', on: { click: onRemove } }) : null
    ]));
    card.appendChild(field('ラベル', textInput(question.label, function (v) { question.label = v; })));
    card.appendChild(field('key（内部識別子）', textInput(question.key, function (v) { question.key = slugify(v); })));
    card.appendChild(field('種類', selectInput(question.type, [
      { value: 'text', label: '一行テキスト' },
      { value: 'textarea', label: '複数行テキスト' },
      { value: 'radio', label: 'ラジオボタン' },
      { value: 'checkbox', label: 'チェックボックス' },
      { value: 'select', label: 'セレクト' }
    ], function (v) { question.type = v; if (['radio', 'checkbox', 'select'].indexOf(v) !== -1 && !question.options) question.options = []; renderEditForm(); })));
    card.appendChild(checkboxLine(question.required, '必須', function (v) { question.required = v; }));
    card.appendChild(field('補足文（任意）', textInput(question.helpText, function (v) { question.helpText = v; })));
    if (['radio', 'checkbox', 'select'].indexOf(question.type) !== -1) {
      if (question.type !== 'select') {
        card.appendChild(checkboxLine(question.otherOption, '「その他」自由記述を追加する', function (v) { question.otherOption = v; }));
      }
      card.appendChild(field('選択肢', optionsEditor(question)));
    }
    return card;
  }

  function renderQuestionsSection(config) {
    var section = ce('div', { class: 'fb-section' }, [
      ce('h3', { text: '質問項目' }),
      ce('p', { class: 'fb-field-note', text: 'プリセット質問はON/OFFで調整できます。内容（ラベル・選択肢）も自由に編集してください。' })
    ]);
    config.questions.forEach(function (q, idx) {
      section.appendChild(renderQuestionCard(q, function () { config.questions.splice(idx, 1); renderEditForm(); }, true));
    });
    section.appendChild(ce('button', {
      type: 'button', class: 'fb-btn', text: '＋独自の質問を追加',
      on: { click: function () {
        config.questions.push({ key: 'custom_' + (config.questions.length + 1), type: 'text', label: '', required: false, enabled: true, options: [] });
        renderEditForm();
      } }
    }));
    return section;
  }

  function renderEndpointSection(config) {
    var section = ce('div', { class: 'fb-section' }, [
      ce('h3', { text: 'GAS Web App連携' }),
      ce('p', { class: 'fb-field-note', text: '新規GASプロジェクトの作成・初回デプロイ・/exec URL発行はこのツールでは行いません。Google側で運営者が手動デプロイした後、発行済みの/exec URLをここに入力してください。' })
    ]);
    section.appendChild(field('GAS Web App /exec URL', textInput(config.endpoints.submitUrl, function (v) { config.endpoints.submitUrl = v.trim(); }, 'url', { placeholder: 'https://script.google.com/macros/s/xxx/exec' })));
    section.appendChild(field('analytics用 form_name（自動）', textInput(config.analytics.formName, function (v) { config.analytics.formName = slugify(v); config.analytics._auto = null; })));
    if (config.type === 'event_entry') {
      section.appendChild(field('lead_type（GA4 generate_lead用）', textInput(config.analytics.leadType, function (v) { config.analytics.leadType = v; })));
    }
    return section;
  }

  function renderEditForm() {
    var root = document.getElementById('fb-edit-form');
    root.textContent = '';
    var config = state.config;
    root.appendChild(renderBasicInfoSection(config));
    var ev = renderEventSection(config);
    if (ev) root.appendChild(ev);
    var dates = renderDatesSection(config);
    if (dates) root.appendChild(dates);
    root.appendChild(renderIdentitySection(config));
    root.appendChild(renderQuestionsSection(config));
    root.appendChild(renderEndpointSection(config));

    var nav = ce('div', { class: 'fb-nav-actions' }, [
      ce('button', { type: 'button', class: 'fb-btn', text: '← テンプレート選択に戻る', on: { click: function () { goToStep(0); } } }),
      ce('button', { type: 'button', class: 'fb-btn fb-btn--primary', text: 'プレビューへ進む →', on: { click: function () { goToStep(2); } } })
    ]);
    root.appendChild(nav);
  }

  /* ── ステップ2: プレビュー ── */

  function renderPreviewPanel() {
    var errors = window.FFValidate.validateSync(state.config);
    var errBox = document.getElementById('fb-validation-errors');
    if (errors.length) {
      errBox.hidden = false;
      errBox.textContent = '';
      errBox.appendChild(ce('strong', { text: '入力内容に問題があります。' }));
      var ul = ce('ul', {});
      errors.forEach(function (e) { ul.appendChild(ce('li', { text: e.message })); });
      errBox.appendChild(ul);
      document.getElementById('fb-preview-frame-wrap').style.display = 'none';
      document.getElementById('fb-preview-url').textContent = '';
      appendPreviewNav(false);
      return;
    }
    errBox.hidden = true;
    document.getElementById('fb-preview-frame-wrap').style.display = '';
    document.getElementById('fb-preview-url').textContent = state.config.meta.canonicalUrl;

    var html = window.FFRenderer.render(state.config, { forcePreview: true });
    var frontMatterCheck = window.FFValidate.checkFrontMatter(html);
    if (!frontMatterCheck.ok) {
      errBox.hidden = false;
      errBox.textContent = frontMatterCheck.message;
    }

    var iframe = document.getElementById('fb-preview-iframe');
    iframe.setAttribute('srcdoc', html);
    setPreviewWidth(state.previewWidth);
    appendPreviewNav(frontMatterCheck.ok);
  }

  function appendPreviewNav(canAdvance) {
    var root = document.getElementById('fb-panels').querySelector('[data-panel="2"]');
    var existing = root.querySelector('.fb-nav-actions');
    if (existing) existing.remove();
    var nav = ce('div', { class: 'fb-nav-actions' }, [
      ce('button', { type: 'button', class: 'fb-btn', text: '← 入力に戻る', on: { click: function () { goToStep(1); } } }),
      ce('button', { type: 'button', class: 'fb-btn fb-btn--primary', text: 'PR作成へ進む →', disabled: !canAdvance, on: { click: function () { goToStep(3); } } })
    ]);
    root.appendChild(nav);
  }

  function setPreviewWidth(w) {
    state.previewWidth = w;
    var iframe = document.getElementById('fb-preview-iframe');
    iframe.style.width = w + 'px';
    iframe.style.height = w >= 1440 ? '900px' : '720px';
  }

  document.querySelectorAll('[data-preview-width]').forEach(function (btn) {
    btn.addEventListener('click', function () { setPreviewWidth(Number(btn.getAttribute('data-preview-width'))); });
  });

  /* ── ステップ3: GitHub PR作成 ── */

  function renderPrPanel() {
    var root = document.getElementById('fb-pr-panel');
    root.textContent = '';

    root.appendChild(ce('div', { class: 'fb-section' }, [
      ce('h3', { text: 'GitHub認証（Fine-grained PAT）' }),
      ce('p', { class: 'fb-field-note', text: '第一候補: Fine-grained Personal Access Token。トークンはこの画面のメモリ上でのみ保持し、保存（localStorage等）はしません。ページを閉じる／再読み込みすると消えます。必要な権限はREADMEを参照してください。' }),
      field('Personal Access Token', ce('input', { type: 'password', id: 'fb-pat-input', autocomplete: 'off', placeholder: 'github_pat_xxx' }))
    ]));

    var actionSection = ce('div', { class: 'fb-section' });
    var runBtn = ce('button', { type: 'button', class: 'fb-btn fb-btn--primary', text: 'PRを作成' });
    var log = ce('div', { class: 'fb-log' }, []);
    var resultBox = ce('div', {});
    actionSection.appendChild(runBtn);
    actionSection.appendChild(log);
    actionSection.appendChild(resultBox);
    root.appendChild(actionSection);

    root.appendChild(ce('div', { class: 'fb-nav-actions' }, [
      ce('button', { type: 'button', class: 'fb-btn', text: '← プレビューに戻る', on: { click: function () { goToStep(2); } } })
    ]));

    function appendLog(line) {
      log.textContent += (log.textContent ? '\n' : '') + line;
      log.scrollTop = log.scrollHeight;
    }

    runBtn.addEventListener('click', function () {
      var token = document.getElementById('fb-pat-input').value.trim();
      if (!token) { appendLog('✗ トークンを入力してください。'); return; }

      var errors = window.FFValidate.validateSync(state.config);
      if (errors.length) { appendLog('✗ 入力内容にエラーがあります。入力画面に戻って修正してください。'); return; }

      var config = state.config;
      var html = window.FFRenderer.render(config, { forcePreview: false });
      var fm = window.FFValidate.checkFrontMatter(html);
      if (!fm.ok) { appendLog('✗ ' + fm.message); return; }

      var htmlPath = config.meta.pageDir + '/' + config.meta.fileName;
      var jsonPath = config.meta.pageDir + '/' + config.meta.slug + '.form.json';
      var branchName = 'form-builder/' + config.meta.slug + '-' + Date.now();

      runBtn.disabled = true;
      appendLog('公開前チェックを開始します…');

      Promise.resolve()
        .then(function () {
          appendLog('・既存ファイルとの衝突を確認中: ' + htmlPath);
          return window.FFGitHubApi.fileExists(token, htmlPath);
        })
        .then(function (exists) {
          if (exists) throw new Error('既に ' + htmlPath + ' が存在します。slugを変更してください。');
          appendLog('・既存ファイルとの衝突を確認中: ' + jsonPath);
          return window.FFGitHubApi.fileExists(token, jsonPath);
        })
        .then(function (exists) {
          if (exists) throw new Error('既に ' + jsonPath + ' が存在します。slugを変更してください。');
          appendLog('・main の最新SHAを取得中…');
          return window.FFGitHubApi.getMainSha(token);
        })
        .then(function (sha) {
          appendLog('  main SHA: ' + sha.slice(0, 10) + '…');
          appendLog('・作業ブランチを作成中: ' + branchName);
          return window.FFGitHubApi.createBranch(token, branchName, sha);
        })
        .then(function () {
          appendLog('・生成HTMLをコミット中: ' + htmlPath);
          return window.FFGitHubApi.putFile(token, branchName, htmlPath, html, 'feat: add ' + config.meta.fileName + ' via form-builder');
        })
        .then(function () {
          appendLog('・設定JSONをコミット中: ' + jsonPath);
          return window.FFGitHubApi.putFile(token, branchName, jsonPath, JSON.stringify(config, null, 2) + '\n', 'chore: add form config for ' + config.meta.slug);
        })
        .then(function () {
          appendLog('・Pull Requestを作成中…');
          return window.FFGitHubApi.createPullRequest(token, {
            title: '[form-builder] ' + config.meta.title,
            head: branchName,
            body: buildPrBody(config, htmlPath, jsonPath)
          });
        })
        .then(function (pr) {
          appendLog('✓ PR作成に成功しました。');
          resultBox.appendChild(ce('div', { class: 'fb-pr-result' }, [
            ce('p', { text: 'PR #' + pr.number + ' を作成しました。' }),
            ce('a', { href: pr.html_url, target: '_blank', rel: 'noopener noreferrer', text: pr.html_url })
          ]));
          document.getElementById('fb-pat-input').value = '';
          runBtn.disabled = false;
        })
        .catch(function (err) {
          appendLog('✗ エラー: ' + err.message);
          if (err.status === 403) {
            appendLog('  Fine-grained PATで403の場合、Pull requests: Read and write 権限を確認してください。それでも解決しない場合はclassic PAT（repoスコープ）を比較検討してください。');
          }
          runBtn.disabled = false;
        });
    });
  }

  function buildPrBody(config, htmlPath, jsonPath) {
    return [
      '## 概要',
      'form-builder（`tools/form-builder/`）から生成した「' + window.FFSchema.TEMPLATE_DEFS[config.type].label + '」です。',
      '',
      '## 生成物',
      '- ' + htmlPath,
      '- ' + jsonPath + '（設定JSON）',
      '',
      '## 確認事項',
      '- [ ] front matter(`---`)混入なしを確認済み（form-builderが自動チェック）',
      '- [ ] GitHub Pagesデプロイ後、実URLで表示確認（' + config.meta.canonicalUrl + '）',
      '- [ ] 390px幅で表示・操作確認',
      '- [ ] GAS Web Appの初回デプロイは運営者が手動で完了させていること（このPRはGitHub公開までが範囲です）',
      '',
      '---',
      '_Generated by [Claude Code](https://claude.ai/code) via form-builder_'
    ].join('\n');
  }

  /* ── init ── */

  renderTemplateList();
  renderPresetList();
  goToStep(0);
})();
