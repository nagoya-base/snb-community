// SNB Form Builder: 管理画面本体。
// テンプレート選択 → 入力 → プレビュー → PR作成、の4ステップで構成する。
// DOMは createElement / textContent で組み立て、innerHTMLに利用者入力を流し込まない。

import { emptyConfig, newQuestion, newDate, newPlan, validateConfig, slugify, weekdayLabel,
  FORM_TYPES, PILLARS, QUESTION_TYPES, canonicalPath, canonicalUrl } from './schema.js';
import { generateHtml, generateConfigJson, outputPaths } from './generator.js';
import { PRESETS } from './presets.js';
import * as gh from './github.js';

const main = document.getElementById('fb-main');
const stepsNav = document.getElementById('fb-steps');

const state = {
  step: 'template',
  config: null,
  github: {
    owner: 'nagoya-base',
    repo: 'snb-community',
    branch: '',
    token: ''
  },
  prResult: null
};

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    Object.keys(attrs).forEach((k) => {
      if (attrs[k] == null || attrs[k] === false) return;
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k in node && k !== 'for' && k !== 'list') node[k] = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
  }
  (children || []).forEach((c) => {
    if (c == null) return;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return node;
}

function fieldWrap(labelText, hint, control) {
  const label = el('label', {}, [labelText]);
  if (hint) label.appendChild(el('span', { class: 'fb-hint', text: hint }));
  return el('div', { class: 'fb-field' }, [label, control]);
}

function textField(labelText, value, onChange, opts) {
  opts = opts || {};
  const input = el('input', { type: opts.type || 'text', value: value || '', placeholder: opts.placeholder || '' });
  input.addEventListener('input', () => onChange(input.value));
  return fieldWrap(labelText, opts.hint, input);
}

function textareaField(labelText, value, onChange, hint) {
  const ta = el('textarea', { value: value || '' });
  ta.value = value || '';
  ta.addEventListener('input', () => onChange(ta.value));
  return fieldWrap(labelText, hint, ta);
}

function selectField(labelText, value, options, onChange) {
  const sel = el('select', {});
  options.forEach((o) => sel.appendChild(el('option', { value: o.value, text: o.label, selected: o.value === value })));
  sel.value = value;
  sel.addEventListener('change', () => onChange(sel.value));
  return fieldWrap(labelText, null, sel);
}

function checkboxField(labelText, checked, onChange) {
  const input = el('input', { type: 'checkbox', checked: checked });
  input.addEventListener('change', () => onChange(input.checked));
  return el('label', { class: 'fb-checkbox-row' }, [input, labelText]);
}

function setStep(step) {
  state.step = step;
  render();
}

function updateStepsNav() {
  const order = ['template', 'edit', 'preview', 'publish'];
  const currentIdx = order.indexOf(state.step);
  Array.from(stepsNav.querySelectorAll('.fb-step')).forEach((btn) => {
    const s = btn.getAttribute('data-step');
    btn.classList.toggle('is-active', s === state.step);
    btn.classList.toggle('is-done', order.indexOf(s) < currentIdx);
    btn.disabled = !state.config && s !== 'template';
    btn.onclick = () => { if (!btn.disabled) setStep(s); };
  });
}

// ---------- Step 1: テンプレート選択 ----------
function renderTemplateStep() {
  const card1 = el('div', { class: 'fb-card' }, [
    el('h2', { text: '新規作成' }),
    el('p', { class: 'fb-note', text: 'フォーム種別を選んでください。' })
  ]);
  const row = el('div', { class: 'fb-btn-row' });
  Object.keys(FORM_TYPES).forEach((type) => {
    const btn = el('button', { class: 'fb-btn', type: 'button', text: FORM_TYPES[type].label });
    btn.addEventListener('click', () => {
      const c = emptyConfig();
      c.type = type;
      state.config = c;
      setStep('edit');
    });
    row.appendChild(btn);
  });
  card1.appendChild(row);

  const card2 = el('div', { class: 'fb-card' }, [
    el('h2', { text: '前回を複製' }),
    el('p', { class: 'fb-note', text: '現行の代表フォームを参考にした設定を読み込みます。日付・料金・文言は必ず今回の開催に合わせて編集してください。' })
  ]);
  const row2 = el('div', { class: 'fb-btn-row' });
  PRESETS.forEach((p) => {
    const btn = el('button', { class: 'fb-btn', type: 'button', text: p.label });
    btn.addEventListener('click', () => {
      state.config = p.build();
      setStep('edit');
    });
    row2.appendChild(btn);
  });
  card2.appendChild(row2);

  main.appendChild(card1);
  main.appendChild(card2);
}

// ---------- Step 2: 入力 ----------
function renderEditStep() {
  const config = state.config;
  const typeInfo = FORM_TYPES[config.type];

  const backLink = el('a', { href: '#', text: 'テンプレートに戻る' });
  backLink.addEventListener('click', (e) => { e.preventDefault(); setStep('template'); });

  main.appendChild(el('div', { class: 'fb-card' }, [
    el('h2', { text: '基本情報' }),
    el('p', { class: 'fb-note' }, ['フォーム種別: ', el('strong', { text: typeInfo.label }), ' ／ ', backLink])
  ]));

  const basicCard = main.lastChild;
  basicCard.appendChild(selectField('公開先ディレクトリ', config.pillar, PILLARS.map((p) => ({ value: p, label: p })), (v) => { config.pillar = v; renderEditStep_refreshPaths(); }));
  basicCard.appendChild(textField('タイトル', config.title, (v) => { config.title = v; renderEditStep_refreshPaths(); }));
  basicCard.appendChild(textareaField('サブタイトル／説明', config.subtitle, (v) => { config.subtitle = v; }));
  basicCard.appendChild(textareaField('meta description', config.meta.description, (v) => { config.meta.description = v; }, '検索結果・SNSシェア時に表示される説明文（120字程度目安）'));

  const slugRow = el('div', { class: 'fb-grid-2' });
  const slugInput = el('input', { type: 'text', value: config.slug });
  slugInput.addEventListener('input', () => { config.slug = slugInput.value; renderEditStep_refreshPaths(); });
  const slugGenBtn = el('button', { class: 'fb-btn', type: 'button', text: 'タイトルから自動生成' });
  slugGenBtn.addEventListener('click', () => { config.slug = slugify(config.title); slugInput.value = config.slug; renderEditStep_refreshPaths(); });
  slugRow.appendChild(fieldWrap('ファイル名(slug)', '例: enquete_202610（半角英数・アンダースコアのみ）', slugInput));
  basicCard.appendChild(slugRow);
  basicCard.appendChild(el('div', { class: 'fb-btn-row' }, [slugGenBtn]));
  basicCard.appendChild(textField('OGP画像パス（任意）', config.meta.ogpImage, (v) => { config.meta.ogpImage = v; }, { hint: '例: images/community/xxxx/meta-ogp-main.jpg（IMAGE_NAMING_RULES.md準拠、画像自体は別途手動で配置）' }));

  const pathsBox = el('p', { class: 'fb-note', id: 'fb-paths-preview' });
  basicCard.appendChild(pathsBox);
  renderEditStep_refreshPaths();

  if (config.type === 'event_entry') {
    const evCard = el('div', { class: 'fb-card' }, [el('h2', { text: 'イベント情報' })]);
    const grid = el('div', { class: 'fb-grid-2' });
    grid.appendChild(textField('開催日', config.event.date, (v) => { config.event.date = v; }, { type: 'date' }));
    grid.appendChild(textField('開始時刻', config.event.startTime, (v) => { config.event.startTime = v; }, { type: 'time' }));
    grid.appendChild(textField('終了時刻', config.event.endTime, (v) => { config.event.endTime = v; }, { type: 'time' }));
    grid.appendChild(textField('料金', config.event.price, (v) => { config.event.price = v; }));
    grid.appendChild(textField('定員', config.event.capacity, (v) => { config.event.capacity = v; }));
    grid.appendChild(textField('締切', config.event.deadline, (v) => { config.event.deadline = v; }, { type: 'date' }));
    evCard.appendChild(grid);
    evCard.appendChild(textField('会場', config.event.venue, (v) => { config.event.venue = v; }));
    main.appendChild(evCard);
  }

  if (typeInfo.usesDates) main.appendChild(buildDatesCard(config));
  if (typeInfo.usesPlans) main.appendChild(buildPlansCard(config));

  main.appendChild(buildQuestionsCard(config));

  const consentCard = el('div', { class: 'fb-card' }, [el('h2', { text: '同意事項' })]);
  consentCard.appendChild(textField('同意チェックボックスの文言（空欄で非表示）', config.consentText, (v) => { config.consentText = v; }));
  main.appendChild(consentCard);

  const gasCard = el('div', { class: 'fb-card' }, [el('h2', { text: 'GAS Web App 連携' })]);
  gasCard.appendChild(el('p', { class: 'fb-note fb-note--warn', text: 'Google Apps Scriptの新規プロジェクト作成・初回デプロイ・/exec URL発行は運営者が手動で行います。ここでは発行済みの/exec URLを入力してください。' }));
  gasCard.appendChild(textField('GAS Web App /exec URL（未発行なら空欄のまま）', config.gas.execUrl, (v) => { config.gas.execUrl = v.trim(); renderGasBadge(); }, { placeholder: 'https://script.google.com/macros/s/XXXX/exec' }));
  const badge = el('p', { id: 'fb-gas-badge' });
  gasCard.appendChild(badge);
  main.appendChild(gasCard);
  renderGasBadge();

  const nextBtn = el('button', { class: 'fb-btn fb-btn--primary fb-btn--block', type: 'button', text: 'プレビューへ進む' });
  nextBtn.addEventListener('click', () => setStep('preview'));
  main.appendChild(nextBtn);
}

function renderGasBadge() {
  const badge = document.getElementById('fb-gas-badge');
  if (!badge) return;
  badge.textContent = '';
  if (state.config.gas.execUrl) {
    badge.appendChild(el('span', { class: 'fb-badge fb-badge--ok', text: 'GAS設定済み' }));
  } else {
    badge.appendChild(el('span', { class: 'fb-badge fb-badge--warn', text: '未設定（生成ページは「準備中」表示になります）' }));
  }
}

function renderEditStep_refreshPaths() {
  const box = document.getElementById('fb-paths-preview');
  if (!box) return;
  box.textContent = '';
  if (!state.config.slug) { box.textContent = 'slugを入力すると生成先パスが表示されます。'; return; }
  const paths = outputPaths(state.config);
  box.appendChild(document.createTextNode('生成先: ' + paths.htmlPath + ' / ' + paths.jsonPath));
  box.appendChild(el('br'));
  box.appendChild(document.createTextNode('公開URL: ' + canonicalUrl(state.config)));
}

function buildDatesCard(config) {
  const card = el('div', { class: 'fb-card' }, [
    el('h2', { text: '候補日' }),
    el('p', { class: 'fb-note', text: '日付を追加すると曜日が自動表示されます。並び順は上下ボタンで入れ替えられます。' })
  ]);
  const list = el('div', {});
  card.appendChild(list);

  function renderList() {
    list.textContent = '';
    config.dates.forEach((d, i) => {
      const item = el('div', { class: 'fb-repeat-item' });
      const head = el('div', { class: 'fb-repeat-item__head' }, [
        el('strong', { text: '候補日 ' + (i + 1) + (d.date ? '（' + weekdayLabel(d.date) + '曜）' : '') })
      ]);
      const btnRow = el('div', { class: 'fb-btn-row' });
      if (i > 0) {
        const up = el('button', { class: 'fb-btn', type: 'button', text: '↑' });
        up.addEventListener('click', () => { const t = config.dates[i - 1]; config.dates[i - 1] = config.dates[i]; config.dates[i] = t; renderList(); });
        btnRow.appendChild(up);
      }
      if (i < config.dates.length - 1) {
        const down = el('button', { class: 'fb-btn', type: 'button', text: '↓' });
        down.addEventListener('click', () => { const t = config.dates[i + 1]; config.dates[i + 1] = config.dates[i]; config.dates[i] = t; renderList(); });
        btnRow.appendChild(down);
      }
      const del = el('button', { class: 'fb-btn fb-btn--danger', type: 'button', text: '削除' });
      del.addEventListener('click', () => { config.dates.splice(i, 1); renderList(); });
      btnRow.appendChild(del);
      head.appendChild(btnRow);
      item.appendChild(head);

      const grid = el('div', { class: 'fb-grid-2' });
      grid.appendChild(textField('日付', d.date, (v) => { d.date = v; if (!d.key) d.key = 'date_' + v.replace(/-/g, '').slice(2); renderList(); }, { type: 'date' }));
      grid.appendChild(textField('ラベル（任意・例: 第1候補）', d.label, (v) => { d.label = v; }));
      item.appendChild(grid);
      item.appendChild(textField('key（設定JSON内の識別子）', d.key, (v) => { d.key = v; }, { hint: '半角英小文字・数字・アンダースコアのみ' }));
      list.appendChild(item);
    });
  }
  renderList();

  const addBtn = el('button', { class: 'fb-btn', type: 'button', text: '＋候補日を追加' });
  addBtn.addEventListener('click', () => { config.dates.push(newDate()); renderList(); });
  card.appendChild(addBtn);
  return card;
}

function buildPlansCard(config) {
  const card = el('div', { class: 'fb-card' }, [el('h2', { text: '候補企画' })]);
  const list = el('div', {});
  card.appendChild(list);

  function renderList() {
    list.textContent = '';
    config.plans.forEach((p, i) => {
      const item = el('div', { class: 'fb-repeat-item' });
      const head = el('div', { class: 'fb-repeat-item__head' }, [el('strong', { text: '企画 ' + (i + 1) })]);
      const del = el('button', { class: 'fb-btn fb-btn--danger', type: 'button', text: '削除' });
      del.addEventListener('click', () => { config.plans.splice(i, 1); renderList(); });
      head.appendChild(del);
      item.appendChild(head);
      item.appendChild(textField('企画名', p.label, (v) => { p.label = v; if (!p.key) { p.key = 'plan_' + slugify(v); renderList(); } }));
      item.appendChild(textField('key', p.key, (v) => { p.key = v; }));
      list.appendChild(item);
    });
  }
  renderList();

  const addBtn = el('button', { class: 'fb-btn', type: 'button', text: '＋候補企画を追加' });
  addBtn.addEventListener('click', () => { config.plans.push(newPlan()); renderList(); });
  card.appendChild(addBtn);
  return card;
}

function buildQuestionsCard(config) {
  const card = el('div', { class: 'fb-card' }, [
    el('h2', { text: '質問項目' }),
    el('p', { class: 'fb-note', text: 'name/keyは重複できません。候補日・候補企画から自動で選択肢を作る質問タイプもあります。' })
  ]);
  const list = el('div', {});
  card.appendChild(list);

  function renderList() {
    list.textContent = '';
    config.questions.forEach((q, i) => {
      const item = el('div', { class: 'fb-repeat-item' });
      const head = el('div', { class: 'fb-repeat-item__head' }, [el('strong', { text: '質問 ' + (i + 1) })]);
      const btnRow = el('div', { class: 'fb-btn-row' });
      if (i > 0) {
        const up = el('button', { class: 'fb-btn', type: 'button', text: '↑' });
        up.addEventListener('click', () => { const t = config.questions[i - 1]; config.questions[i - 1] = config.questions[i]; config.questions[i] = t; renderList(); });
        btnRow.appendChild(up);
      }
      if (i < config.questions.length - 1) {
        const down = el('button', { class: 'fb-btn', type: 'button', text: '↓' });
        down.addEventListener('click', () => { const t = config.questions[i + 1]; config.questions[i + 1] = config.questions[i]; config.questions[i] = t; renderList(); });
        btnRow.appendChild(down);
      }
      const del = el('button', { class: 'fb-btn fb-btn--danger', type: 'button', text: '削除' });
      del.addEventListener('click', () => { config.questions.splice(i, 1); renderList(); });
      btnRow.appendChild(del);
      head.appendChild(btnRow);
      item.appendChild(head);

      item.appendChild(textField('label（画面表示）', q.label, (v) => {
        q.label = v;
        if (!q.userEditedKey) { q.key = slugify(v).replace(/^[0-9_]+/, '') || q.key; keyInput.value = q.key; }
      }));
      const keyInput = el('input', { type: 'text', value: q.key });
      keyInput.addEventListener('input', () => { q.key = keyInput.value; q.userEditedKey = true; });
      item.appendChild(fieldWrap('name / key', 'このリポジトリでは半角英小文字で開始し、英数字とアンダースコアのみ使用', keyInput));

      item.appendChild(selectField('質問タイプ', q.type, QUESTION_TYPES.map((t) => ({ value: t.value, label: t.label })), (v) => { q.type = v; renderList(); }));
      item.appendChild(checkboxField('必須', !!q.required, (v) => { q.required = v; }));
      item.appendChild(textField('補足文（任意）', q.help, (v) => { q.help = v; }));

      const qtype = QUESTION_TYPES.find((t) => t.value === q.type);
      if (qtype && qtype.needsOptions) {
        item.appendChild(buildOptionsEditor(q, renderList));
      }
      if (q.type !== 'text' && q.type !== 'textarea') {
        item.appendChild(checkboxField('「その他」の自由記述を追加する', !!q.allowOther, (v) => { q.allowOther = v; }));
      }

      list.appendChild(item);
    });
  }
  renderList();

  const addBtn = el('button', { class: 'fb-btn', type: 'button', text: '＋質問を追加' });
  addBtn.addEventListener('click', () => { config.questions.push(newQuestion({ key: 'question_' + (config.questions.length + 1) })); renderList(); });
  card.appendChild(addBtn);
  return card;
}

function buildOptionsEditor(q, onStructureChange) {
  const wrap = el('div', { class: 'fb-field' }, [el('label', { text: '選択肢（2つ以上）' })]);
  const list = el('div', {});
  wrap.appendChild(list);

  function renderOptions() {
    list.textContent = '';
    q.options.forEach((o, i) => {
      const row = el('div', { class: 'fb-option-row' });
      const valInput = el('input', { type: 'text', value: o.label, placeholder: '選択肢の表示名' });
      valInput.addEventListener('input', () => { o.label = valInput.value; if (!o.userEditedValue) o.value = valInput.value; });
      const del = el('button', { class: 'fb-btn fb-btn--danger', type: 'button', text: '削除' });
      del.addEventListener('click', () => { q.options.splice(i, 1); renderOptions(); });
      row.appendChild(valInput);
      row.appendChild(del);
      list.appendChild(row);
    });
  }
  renderOptions();

  const addBtn = el('button', { class: 'fb-btn', type: 'button', text: '＋選択肢を追加' });
  addBtn.addEventListener('click', () => { q.options.push({ value: '', label: '' }); renderOptions(); });
  wrap.appendChild(addBtn);
  return wrap;
}

// ---------- Step 3: プレビュー ----------
let previewObjectUrl = null;

function renderPreviewStep() {
  const config = state.config;
  const errors = validateConfig(config);
  if (errors.length) {
    main.appendChild(buildErrorsBox(errors, '入力内容に未解決の項目があります（プレビューは表示できますが、PR作成前に修正してください）。'));
  }

  const card = el('div', { class: 'fb-card' }, [el('h2', { text: 'プレビュー' })]);
  card.appendChild(el('p', { class: 'fb-note', text: 'このプレビューではGAS送信・GA4送信は行われません（?test=1相当）。' }));

  const toolbar = el('div', { class: 'fb-preview-toolbar' });
  const mobileBtn = el('button', { class: 'fb-btn', type: 'button', text: '📱 390px' });
  const desktopBtn = el('button', { class: 'fb-btn', type: 'button', text: '💻 デスクトップ幅' });
  toolbar.appendChild(mobileBtn);
  toolbar.appendChild(desktopBtn);
  card.appendChild(toolbar);

  const frameWrap = el('div', { class: 'fb-preview-frame-wrap is-mobile' });
  const iframe = el('iframe', { title: 'フォームプレビュー' });
  frameWrap.appendChild(iframe);
  card.appendChild(frameWrap);

  mobileBtn.addEventListener('click', () => frameWrap.classList.add('is-mobile'));
  desktopBtn.addEventListener('click', () => frameWrap.classList.remove('is-mobile'));

  try {
    const html = generateHtml(config);
    const previewHtml = toPreviewHtml(html);
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    const blob = new Blob([previewHtml], { type: 'text/html' });
    previewObjectUrl = URL.createObjectURL(blob);
    iframe.src = previewObjectUrl;
  } catch (e) {
    card.appendChild(el('p', { class: 'fb-note fb-note--warn', text: 'プレビュー生成に失敗しました: ' + e.message }));
  }

  main.appendChild(card);

  const pathsCard = el('div', { class: 'fb-card' }, [el('h2', { text: '生成されるファイル' })]);
  if (config.slug) {
    const paths = outputPaths(config);
    pathsCard.appendChild(el('p', { text: 'HTML: ' + paths.htmlPath }));
    pathsCard.appendChild(el('p', { text: '設定JSON: ' + paths.jsonPath }));
    pathsCard.appendChild(el('p', { text: '公開URL: ' + canonicalUrl(config) }));
  }
  main.appendChild(pathsCard);

  const nextBtn = el('button', { class: 'fb-btn fb-btn--primary fb-btn--block', type: 'button', text: 'PR作成へ進む' });
  nextBtn.addEventListener('click', () => setStep('publish'));
  main.appendChild(nextBtn);
}

// プレビューは Blob URL 経由で表示するため、生成HTMLがそのまま持つ相対パス
// (`../analytics.js` 等、実際の公開先である community/ 等からの相対パス)は
// Blob URL上では解決できない。絶対URLに差し替える。
// また Blob URL にはクエリ文字列(`?test=1`)を安定して付与できないため、
// テストモード判定を直接 true に固定する。
function toPreviewHtml(html) {
  const root = new URL('../../', import.meta.url);
  const abs = (name) => new URL(name, root).href;
  return html
    .replace('../analytics.js', abs('analytics.js'))
    .replace('../form-runtime.js', abs('form-runtime.js'))
    .replace('../form-runtime.css', abs('form-runtime.css'))
    .replace(/window\.SNB_TEST_MODE = \(function[\s\S]*?\)\(\);/, 'window.SNB_TEST_MODE = true;');
}

function buildErrorsBox(errors, title) {
  const box = el('div', { class: 'fb-errors' }, [el('strong', { text: title || '入力内容を確認してください。' })]);
  const ul = el('ul', {});
  errors.forEach((e) => ul.appendChild(el('li', { text: e })));
  box.appendChild(ul);
  return box;
}

// ---------- Step 4: PR作成 ----------
function renderPublishStep() {
  const config = state.config;

  const gasCard = el('div', { class: 'fb-card' }, [
    el('h2', { text: 'デプロイ状況' }),
    el('p', { class: 'fb-note fb-note--warn', text: '「PRを作成」は GitHub 上に公開用PRを作成するところまでです。Google Apps Script の新規プロジェクト作成・初回デプロイ・/exec URL発行は含まれません。GASの手動デプロイが未完了の場合、生成ページは「準備中」の表示になります。' })
  ]);
  gasCard.appendChild(el('p', {}, [config.gas.execUrl
    ? el('span', { class: 'fb-badge fb-badge--ok', text: 'GAS /exec URL 設定済み' })
    : el('span', { class: 'fb-badge fb-badge--warn', text: 'GAS未設定（準備中表示になります）' })]));
  main.appendChild(gasCard);

  const authCard = el('div', { class: 'fb-card' }, [el('h2', { text: 'GitHub認証' })]);
  authCard.appendChild(el('p', { class: 'fb-note', text: 'Fine-grained Personal Access Token（Contents: Read and write, Pull requests: Read and write）を入力してください。トークンはこの画面のメモリ上にのみ保持され、保存・送信先はGitHub API以外にありません。ページを再読込すると消えます。' }));

  const grid = el('div', { class: 'fb-grid-2' });
  grid.appendChild(textField('owner', state.github.owner, (v) => { state.github.owner = v; }));
  grid.appendChild(textField('repo', state.github.repo, (v) => { state.github.repo = v; }));
  authCard.appendChild(grid);

  authCard.appendChild(textField('Fine-grained PAT', state.github.token, (v) => { state.github.token = v; gh.setToken(v); }, { type: 'password', placeholder: 'github_pat_xxxxx' }));

  const branchDefault = state.github.branch || ('form-builder/' + config.pillar + '-' + (config.slug || 'new-form'));
  authCard.appendChild(textField('作成するbranch名', branchDefault, (v) => { state.github.branch = v; }));

  main.appendChild(authCard);

  const errors = validateConfig(config);
  if (errors.length) {
    main.appendChild(buildErrorsBox(errors, '以下を解決しないとPRを作成できません。'));
  }

  const actionCard = el('div', { class: 'fb-card' }, [el('h2', { text: 'PR作成' })]);
  const log = el('div', { class: 'fb-code-block', id: 'fb-publish-log' });
  const createBtn = el('button', { class: 'fb-btn fb-btn--primary fb-btn--block', type: 'button', text: 'PRを作成' });
  createBtn.disabled = errors.length > 0;
  createBtn.addEventListener('click', () => runPublish(createBtn, log));
  actionCard.appendChild(createBtn);
  actionCard.appendChild(log);
  main.appendChild(actionCard);

  if (state.prResult) {
    const box = el('div', { class: 'fb-result-box' }, [
      el('p', { text: 'PRを作成しました。' }),
      el('a', { href: state.prResult.html_url, text: state.prResult.html_url, target: '_blank', rel: 'noopener noreferrer' })
    ]);
    main.appendChild(box);
  }
}

function appendLog(logEl, text) {
  logEl.textContent += (logEl.textContent ? '\n' : '') + text;
}

async function runPublish(btn, logEl) {
  const config = state.config;
  logEl.textContent = '';
  btn.disabled = true;

  if (!gh.hasToken()) {
    appendLog(logEl, 'エラー: GitHubトークンが未入力です。');
    btn.disabled = false;
    return;
  }

  const { owner, repo, branch } = state.github;
  const actualBranch = branch || ('form-builder/' + config.pillar + '-' + config.slug);

  try {
    const paths = outputPaths(config);

    appendLog(logEl, '既存ファイルの衝突チェック中…');
    const exists = await gh.fileExists(owner, repo, paths.htmlPath, 'main');
    if (exists) {
      appendLog(logEl, 'エラー: ' + paths.htmlPath + ' は既にmain上に存在します。slugを変更してください。');
      btn.disabled = false;
      return;
    }

    appendLog(logEl, 'main の最新SHAを取得中…');
    const sha = await gh.getBranchSha(owner, repo, 'main');

    appendLog(logEl, 'branch を作成中: ' + actualBranch);
    await gh.createBranch(owner, repo, actualBranch, sha);

    appendLog(logEl, 'HTMLをcommit中: ' + paths.htmlPath);
    const html = generateHtml(config);
    await gh.createOrUpdateFile(owner, repo, paths.htmlPath, html, actualBranch, 'feat: ' + config.title + ' フォームを追加');

    appendLog(logEl, '設定JSONをcommit中: ' + paths.jsonPath);
    const json = generateConfigJson(config);
    await gh.createOrUpdateFile(owner, repo, paths.jsonPath, json, actualBranch, 'feat: ' + config.title + ' の設定JSONを追加');

    appendLog(logEl, 'Pull Requestを作成中…');
    const prBody = buildPrBody(config, paths);
    const pr = await gh.createPullRequest(owner, repo, 'フォーム追加: ' + config.title + '（' + paths.htmlPath + '）', actualBranch, 'main', prBody);

    appendLog(logEl, '完了: ' + pr.html_url);
    state.prResult = pr;
    render();
  } catch (e) {
    appendLog(logEl, 'エラー: ' + e.message);
  } finally {
    btn.disabled = false;
  }
}

function buildPrBody(config, paths) {
  const lines = [
    '## 概要',
    'form-builder（`/tools/form-builder/`）から生成したフォームです。',
    '',
    '- フォーム種別: ' + FORM_TYPES[config.type].label,
    '- 生成HTML: `' + paths.htmlPath + '`',
    '- 設定JSON: `' + paths.jsonPath + '`',
    '- 公開URL(予定): ' + canonicalUrl(config),
    '',
    '## GAS連携について',
    config.gas.execUrl
      ? '- GAS Web App /exec URLは設定済みです。'
      : '- GAS Web App /exec URLは未設定です。このPRのマージ後、Google Apps Script側の新規プロジェクト作成・初回デプロイ・/exec URL発行を手動で行い、設定JSON・生成HTML内のプレースホルダーを差し替えてください。',
    '- このPRの作成はGitHub上への反映のみを意味し、GASの手動デプロイ完了を意味しません。',
    '',
    '## 確認事項',
    '- [ ] 390px前後のモバイル幅で表示・操作確認',
    '- [ ] `?test=1` でGAS送信・GA4送信が行われないことを確認',
    '- [ ] GitHub Pagesデプロイ後、実URLで表示確認',
    '',
    '---',
    '_Generated by [Claude Code](https://claude.ai/code)_'
  ];
  return lines.join('\n');
}

// ---------- ルート ----------
function render() {
  main.textContent = '';
  updateStepsNav();
  if (state.step === 'template' || !state.config) renderTemplateStep();
  else if (state.step === 'edit') renderEditStep();
  else if (state.step === 'preview') renderPreviewStep();
  else if (state.step === 'publish') renderPublishStep();
}

render();
