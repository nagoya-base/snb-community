import { escapeHtml, formatDateLabel, dateToKey, isValidSlug, isValidQuestionKey, utf8ToBase64, clone } from './lib/util.js';
import { validateConfig } from './lib/validate.js';
import { renderFormHtml, renderConfigJson } from './lib/render.js';
import { GitHubClient, GitHubApiError } from './lib/github.js';

const OWNER = 'nagoya-base';
const REPO = 'snb-community';
const BASE_BRANCH = 'main';

const STEPS = [
  { id: 'template', label: '1. テンプレート' },
  { id: 'basic', label: '2. 基本情報' },
  { id: 'details', label: '3. 日程/イベント' },
  { id: 'questions', label: '4. 質問項目' },
  { id: 'integration', label: '5. 連絡先/GAS/計測' },
  { id: 'preview', label: '6. プレビュー' },
  { id: 'publish', label: '7. PR作成' }
];

const TYPE_LABEL = {
  event_entry: 'イベント応募フォーム',
  date_survey: '開催日アンケート',
  cross_tab_survey: '企画・クロス集計アンケート'
};

const state = {
  step: 0,
  config: null,
  presets: [],
  presetsLoadError: '',
  githubToken: '',
  branchName: '',
  publishing: false,
  publishLog: [],
  publishResult: null,
  publishErrors: [],
  previewMode: 'mobile',
  previewClosed: false
};

function emptyConfig(type) {
  const base = {
    schemaVersion: 1,
    type,
    section: 'community',
    slug: '',
    title: '',
    subtitle: '',
    description: '',
    ogImagePath: '',
    event: type === 'event_entry'
      ? { eventDate: '', startTime: '', endTime: '', fee: '', capacity: '', venue: '', deadline: '', entryStatus: 'open' }
      : {},
    dates: [],
    questions: [
      { key: 'display_name', type: 'text', label: 'お名前／表示名', required: true, help: '', maxLength: 60, options: [], allowOther: false }
    ],
    contact: { email: true, x: true },
    consent: { enabled: type === 'event_entry', label: '注意事項に同意します' },
    analytics: {
      formName: '',
      leadEvent: type === 'event_entry' ? 'generate_lead' : 'survey_submit',
      leadType: type === 'event_entry' ? 'snbc_event_entry' : ''
    },
    gas: { execUrl: '', deployedManually: false }
  };
  if (type !== 'event_entry') {
    base.dates = [
      { key: 'date_0000', date: '', label: '', hosted: true }
    ];
  }
  return base;
}

async function loadPresets() {
  const files = [
    { file: 'event-entry.json', label: '9/12教室セット撮影会を雛形にする', kind: 'event_entry' },
    { file: 'date-survey.json', label: '9月キャッチボール会アンケートを雛形にする', kind: 'date_survey' },
    { file: 'cross-tab-survey.json', label: '9月企画アンケートを雛形にする', kind: 'cross_tab_survey' }
  ];
  const results = [];
  for (const f of files) {
    try {
      const res = await fetch(`./templates/${f.file}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      results.push({ ...f, config: json });
    } catch (e) {
      state.presetsLoadError = 'プリセットの読み込みに失敗しました。ローカルで確認する場合は簡易HTTPサーバー経由（例: python3 -m http.server）で開いてください。file:// では動作しません。';
    }
  }
  state.presets = results;
}

function ensureAnalyticsDefaults(config) {
  if (!config.analytics.formName) config.analytics.formName = `${config.slug || 'form'}_form`;
  if (config.analytics.leadEvent === 'generate_lead') config.analytics.leadType = 'snbc_event_entry';
  else config.analytics.leadType = '';
}

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function render() {
  renderStepsNav();
  const app = document.getElementById('app');
  app.innerHTML = '';
  const renderer = STEP_RENDERERS[STEPS[state.step].id];
  app.appendChild(renderer());
}

function renderStepsNav() {
  const nav = document.getElementById('steps');
  nav.innerHTML = '';
  STEPS.forEach((s, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'steps__item';
    btn.textContent = s.label;
    btn.disabled = i > 0 && !state.config;
    if (i === state.step) btn.setAttribute('aria-current', 'step');
    btn.addEventListener('click', () => { state.step = i; render(); });
    nav.appendChild(btn);
  });
}

function stepNavButtons(opts = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'btn-row';
  if (state.step > 0) {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'btn btn-outline';
    back.textContent = '戻る';
    back.addEventListener('click', () => { state.step -= 1; render(); });
    wrap.appendChild(back);
  }
  if (state.step < STEPS.length - 1 && !opts.hideNext) {
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'btn btn-primary';
    next.textContent = '次へ';
    next.addEventListener('click', () => { state.step += 1; render(); });
    wrap.appendChild(next);
  }
  return wrap;
}

// ── Step 0: テンプレート選択 ──────────────────────────────
function renderTemplateStep() {
  const wrap = document.createElement('div');

  const scratchCard = document.createElement('div');
  scratchCard.className = 'card';
  scratchCard.innerHTML = `<h2>テンプレートを選択</h2><p class="card__note">フォーム種別を選び、空の状態から作成します。</p>`;
  const grid = document.createElement('div');
  grid.className = 'template-grid';
  Object.entries(TYPE_LABEL).forEach(([type, label]) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'template-card';
    card.innerHTML = `<h3>${escapeHtml(label)}</h3><p>空の状態から作成します。</p>`;
    card.addEventListener('click', () => {
      state.config = emptyConfig(type);
      state.step = 1;
      render();
    });
    grid.appendChild(card);
  });
  scratchCard.appendChild(grid);
  wrap.appendChild(scratchCard);

  const presetCard = document.createElement('div');
  presetCard.className = 'card';
  presetCard.innerHTML = `<h2>前回を複製</h2><p class="card__note">現行の代表フォーム相当のプリセットを読み込んで編集します。</p>`;
  if (state.presetsLoadError) {
    const notice = document.createElement('p');
    notice.className = 'notice notice--warn';
    notice.textContent = state.presetsLoadError;
    presetCard.appendChild(notice);
  }
  const presetGrid = document.createElement('div');
  presetGrid.className = 'template-grid';
  state.presets.forEach((p) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'template-card';
    card.innerHTML = `<h3>${escapeHtml(p.label)}</h3><p>${escapeHtml(TYPE_LABEL[p.kind])}</p>`;
    card.addEventListener('click', () => {
      state.config = clone(p.config);
      state.step = 1;
      render();
    });
    presetGrid.appendChild(card);
  });
  presetCard.appendChild(presetGrid);
  wrap.appendChild(presetCard);

  return wrap;
}

// ── Step 1: 基本情報 ──────────────────────────────
function renderBasicStep() {
  const c = state.config;
  const wrap = document.createElement('div');
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<h2>基本情報</h2><p class="card__note">フォーム種別: ${escapeHtml(TYPE_LABEL[c.type])}</p>`;

  const fields = [
    ['title', 'タイトル', 'text'],
    ['subtitle', 'サブタイトル／説明（画面上部）', 'text'],
    ['description', 'meta description / OGP説明文', 'textarea']
  ];
  fields.forEach(([key, label, kind]) => {
    const field = document.createElement('div');
    field.className = 'field';
    field.innerHTML = `<label for="f-${key}">${escapeHtml(label)}</label>`;
    const input = document.createElement(kind === 'textarea' ? 'textarea' : 'input');
    if (kind !== 'textarea') input.type = 'text';
    input.id = `f-${key}`;
    input.value = c[key] || '';
    input.addEventListener('input', () => { c[key] = input.value; });
    field.appendChild(input);
    card.appendChild(field);
  });

  const grid = document.createElement('div');
  grid.className = 'grid-2';

  const sectionField = document.createElement('div');
  sectionField.className = 'field';
  sectionField.innerHTML = '<label for="f-section">公開先ディレクトリ</label>';
  const sectionSelect = document.createElement('select');
  sectionSelect.id = 'f-section';
  [['community', 'community（SNBコミュニティ）'], ['baseball', 'baseball（名古屋野球ユニ部）']].forEach(([v, l]) => {
    const opt = document.createElement('option');
    opt.value = v; opt.textContent = l;
    if (c.section === v) opt.selected = true;
    sectionSelect.appendChild(opt);
  });
  sectionSelect.addEventListener('change', () => { c.section = sectionSelect.value; updateComputedPaths(); });
  sectionField.appendChild(sectionSelect);
  grid.appendChild(sectionField);

  const slugField = document.createElement('div');
  slugField.className = 'field';
  slugField.innerHTML = '<label for="f-slug">slug（生成ファイル名の元）</label>';
  const slugInput = document.createElement('input');
  slugInput.type = 'text';
  slugInput.id = 'f-slug';
  slugInput.value = c.slug || '';
  slugInput.placeholder = 'enquete_202609';
  slugInput.addEventListener('input', () => { c.slug = slugInput.value.trim(); updateComputedPaths(); });
  slugField.appendChild(slugInput);
  const slugHint = document.createElement('span');
  slugHint.className = 'hint';
  slugHint.textContent = '英小文字・数字・アンダースコアのみ（例: enquete_202609, classroom_20260912）';
  slugField.appendChild(slugHint);
  grid.appendChild(slugField);

  card.appendChild(grid);

  const ogField = document.createElement('div');
  ogField.className = 'field';
  ogField.innerHTML = '<label for="f-og">OGP画像パス（任意・省略時は共通デフォルト画像）</label>';
  const ogInput = document.createElement('input');
  ogInput.type = 'text';
  ogInput.id = 'f-og';
  ogInput.value = c.ogImagePath || '';
  ogInput.placeholder = 'images/community/xxx/meta-ogp-main.jpg';
  ogInput.addEventListener('input', () => { c.ogImagePath = ogInput.value.trim(); });
  ogField.appendChild(ogInput);
  card.appendChild(ogField);

  const computed = document.createElement('p');
  computed.className = 'hint';
  computed.id = 'computed-paths';
  card.appendChild(computed);

  wrap.appendChild(card);
  wrap.appendChild(stepNavButtons());

  setTimeout(updateComputedPaths, 0);
  return wrap;
}

function updateComputedPaths() {
  const c = state.config;
  const el2 = document.getElementById('computed-paths');
  if (!el2) return;
  const slugOk = isValidSlug(c.slug || '');
  el2.textContent = slugOk
    ? `生成先: ${c.section}/${c.slug}.html ・ ${c.section}/${c.slug}.config.json ／ canonical: https://nagoya-base.github.io/snb-community/${c.section}/${c.slug}.html`
    : 'slugを正しい形式で入力すると生成先パスを表示します。';
}

// ── Step 2: 日程 / イベント情報 ──────────────────────────────
function renderDetailsStep() {
  const c = state.config;
  const wrap = document.createElement('div');

  if (c.type === 'event_entry') {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = '<h2>イベント情報</h2>';
    const grid = document.createElement('div');
    grid.className = 'grid-2';
    const rows = [
      ['eventDate', '開催日', 'date'],
      ['startTime', '開始時刻', 'time'],
      ['endTime', '終了時刻', 'time'],
      ['fee', '料金', 'text'],
      ['capacity', '定員', 'number'],
      ['venue', '会場', 'text'],
      ['deadline', '締切（ISO日時、例: 2026-09-10T23:59:59+09:00）', 'text']
    ];
    rows.forEach(([key, label, type]) => {
      const field = document.createElement('div');
      field.className = 'field';
      field.innerHTML = `<label>${escapeHtml(label)}</label>`;
      const input = document.createElement('input');
      input.type = type;
      input.value = c.event[key] ?? '';
      input.addEventListener('input', () => { c.event[key] = input.value; });
      field.appendChild(input);
      grid.appendChild(field);
    });
    card.appendChild(grid);

    const statusField = document.createElement('div');
    statusField.className = 'field';
    statusField.innerHTML = '<label>受付状態</label>';
    const statusSelect = document.createElement('select');
    [['open', '受付中'], ['closed', '受付終了'], ['waitlist', 'キャンセル待ち']].forEach(([v, l]) => {
      const opt = document.createElement('option');
      opt.value = v; opt.textContent = l;
      if ((c.event.entryStatus || 'open') === v) opt.selected = true;
      statusSelect.appendChild(opt);
    });
    statusSelect.addEventListener('change', () => { c.event.entryStatus = statusSelect.value; });
    statusField.appendChild(statusSelect);
    card.appendChild(statusField);

    wrap.appendChild(card);
  } else {
    wrap.appendChild(renderDatesCard());
  }

  wrap.appendChild(stepNavButtons());
  return wrap;
}

function renderDatesCard() {
  const c = state.config;
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = '<h2>候補日</h2><p class="card__note">日付を入力すると曜日を自動表示します。「開催する」を外すと非表示の候補日として常に×固定で送信されます。</p>';

  (c.dates || []).forEach((d, i) => {
    const item = document.createElement('div');
    item.className = 'list-item';
    const label = formatDateLabel(d.date) || '（未入力）';
    item.innerHTML = `<div class="list-item__head"><strong>${escapeHtml(label)}</strong></div>`;

    const actions = document.createElement('div');
    actions.className = 'list-item__actions';
    const upBtn = makeIconBtn('↑', i === 0, () => { moveItem(c.dates, i, -1); render(); });
    const downBtn = makeIconBtn('↓', i === c.dates.length - 1, () => { moveItem(c.dates, i, 1); render(); });
    const delBtn = makeIconBtn('✕', c.dates.length <= 1, () => { c.dates.splice(i, 1); render(); });
    actions.append(upBtn, downBtn, delBtn);
    item.querySelector('.list-item__head').appendChild(actions);

    const grid = document.createElement('div');
    grid.className = 'grid-2';

    const dateField = document.createElement('div');
    dateField.className = 'field';
    dateField.innerHTML = '<label>日付</label>';
    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.value = d.date || '';
    dateInput.addEventListener('input', () => {
      d.date = dateInput.value;
      d.label = formatDateLabel(d.date);
      d.key = dateToKey(d.date);
      render();
    });
    dateField.appendChild(dateInput);
    grid.appendChild(dateField);

    const hostedField = document.createElement('div');
    hostedField.className = 'field';
    hostedField.innerHTML = '<label>&nbsp;</label>';
    const hostedRow = document.createElement('div');
    hostedRow.className = 'checkbox-row';
    const hostedCheck = document.createElement('input');
    hostedCheck.type = 'checkbox';
    hostedCheck.checked = d.hosted !== false;
    hostedCheck.addEventListener('change', () => { d.hosted = hostedCheck.checked; });
    hostedRow.append(hostedCheck, document.createTextNode('この日は開催する'));
    hostedField.appendChild(hostedRow);
    grid.appendChild(hostedField);

    item.appendChild(grid);
    card.appendChild(item);
  });

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn btn-outline btn-sm';
  addBtn.textContent = '＋候補日を追加';
  addBtn.addEventListener('click', () => {
    c.dates.push({ key: '', date: '', label: '', hosted: true });
    render();
  });
  card.appendChild(addBtn);

  return card;
}

function makeIconBtn(text, disabled, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'icon-btn';
  btn.textContent = text;
  btn.disabled = disabled;
  btn.addEventListener('click', onClick);
  return btn;
}

function moveItem(arr, index, delta) {
  const target = index + delta;
  if (target < 0 || target >= arr.length) return;
  const [item] = arr.splice(index, 1);
  arr.splice(target, 0, item);
}

// ── Step 3: 質問項目 ──────────────────────────────
function renderQuestionsStep() {
  const c = state.config;
  const wrap = document.createElement('div');
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = '<h2>質問項目</h2><p class="card__note">nameは自動生成されます（q2, q3…）。重複しないよう必要に応じて手動で変更してください。</p>';

  c.questions.forEach((q, i) => {
    card.appendChild(renderQuestionEditor(q, i, c));
  });

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn btn-outline btn-sm';
  addBtn.textContent = '＋質問を追加';
  addBtn.addEventListener('click', () => {
    const nextIndex = c.questions.length + 1;
    let key = `q${nextIndex}`;
    while (c.questions.some((q) => q.key === key)) key = `${key}x`;
    c.questions.push({ key, type: 'text', label: '', required: false, help: '', maxLength: 200, options: [], allowOther: false });
    render();
  });
  card.appendChild(addBtn);

  wrap.appendChild(card);
  wrap.appendChild(stepNavButtons());
  return wrap;
}

function renderQuestionEditor(q, i, c) {
  const item = document.createElement('div');
  item.className = 'list-item';

  const head = document.createElement('div');
  head.className = 'list-item__head';
  head.innerHTML = `<strong>Q${i + 1} ${escapeHtml(q.label || '(未入力)')}</strong>`;
  const actions = document.createElement('div');
  actions.className = 'list-item__actions';
  actions.append(
    makeIconBtn('↑', i === 0, () => { moveItem(c.questions, i, -1); render(); }),
    makeIconBtn('↓', i === c.questions.length - 1, () => { moveItem(c.questions, i, 1); render(); }),
    makeIconBtn('✕', c.questions.length <= 1, () => { c.questions.splice(i, 1); render(); })
  );
  head.appendChild(actions);
  item.appendChild(head);

  const grid = document.createElement('div');
  grid.className = 'grid-2';

  const labelField = document.createElement('div');
  labelField.className = 'field';
  labelField.innerHTML = '<label>質問文（label）</label>';
  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.value = q.label || '';
  labelInput.addEventListener('input', () => { q.label = labelInput.value; head.querySelector('strong').textContent = `Q${i + 1} ${q.label || '(未入力)'}`; });
  labelField.appendChild(labelInput);
  grid.appendChild(labelField);

  const keyField = document.createElement('div');
  keyField.className = 'field';
  keyField.innerHTML = '<label>キー（name）</label>';
  const keyInput = document.createElement('input');
  keyInput.type = 'text';
  keyInput.value = q.key || '';
  keyInput.addEventListener('input', () => { q.key = keyInput.value.trim(); });
  keyField.appendChild(keyInput);
  grid.appendChild(keyField);

  item.appendChild(grid);

  const grid2 = document.createElement('div');
  grid2.className = 'grid-2';

  const typeField = document.createElement('div');
  typeField.className = 'field';
  typeField.innerHTML = '<label>種別</label>';
  const typeSelect = document.createElement('select');
  [['text', '一行テキスト'], ['textarea', '複数行テキスト'], ['radio', 'ラジオボタン'], ['checkbox', 'チェックボックス'], ['select', 'セレクト']].forEach(([v, l]) => {
    const opt = document.createElement('option');
    opt.value = v; opt.textContent = l;
    if (q.type === v) opt.selected = true;
    typeSelect.appendChild(opt);
  });
  typeSelect.addEventListener('change', () => {
    q.type = typeSelect.value;
    if (['radio', 'checkbox', 'select'].includes(q.type) && (!q.options || q.options.length === 0)) {
      q.options = [{ label: '' }, { label: '' }];
    }
    render();
  });
  typeField.appendChild(typeSelect);
  grid2.appendChild(typeField);

  const requiredField = document.createElement('div');
  requiredField.className = 'field';
  requiredField.innerHTML = '<label>&nbsp;</label>';
  const reqRow = document.createElement('div');
  reqRow.className = 'checkbox-row';
  const reqCheck = document.createElement('input');
  reqCheck.type = 'checkbox';
  reqCheck.checked = !!q.required;
  reqCheck.addEventListener('change', () => { q.required = reqCheck.checked; });
  reqRow.append(reqCheck, document.createTextNode('必須'));
  requiredField.appendChild(reqRow);
  grid2.appendChild(requiredField);

  item.appendChild(grid2);

  const helpField = document.createElement('div');
  helpField.className = 'field';
  helpField.innerHTML = '<label>補足文（任意）</label>';
  const helpInput = document.createElement('input');
  helpInput.type = 'text';
  helpInput.value = q.help || '';
  helpInput.addEventListener('input', () => { q.help = helpInput.value; });
  helpField.appendChild(helpInput);
  item.appendChild(helpField);

  if (q.type === 'text' || q.type === 'textarea') {
    const mlField = document.createElement('div');
    mlField.className = 'field';
    mlField.innerHTML = '<label>最大文字数</label>';
    const mlInput = document.createElement('input');
    mlInput.type = 'number';
    mlInput.min = '1';
    mlInput.value = q.maxLength || 200;
    mlInput.addEventListener('input', () => { q.maxLength = Number(mlInput.value) || 200; });
    mlField.appendChild(mlInput);
    item.appendChild(mlField);
  }

  if (q.type === 'radio' || q.type === 'checkbox' || q.type === 'select') {
    const optsWrap = document.createElement('div');
    optsWrap.className = 'field';
    optsWrap.innerHTML = '<label>選択肢</label>';
    (q.options || []).forEach((o, oi) => {
      const row = document.createElement('div');
      row.className = 'option-row';
      const input = document.createElement('input');
      input.type = 'text';
      input.value = o.label || '';
      input.placeholder = `選択肢${oi + 1}`;
      input.addEventListener('input', () => { o.label = input.value; });
      const del = makeIconBtn('✕', q.options.length <= 2, () => { q.options.splice(oi, 1); render(); });
      row.append(input, del);
      optsWrap.appendChild(row);
    });
    const addOpt = document.createElement('button');
    addOpt.type = 'button';
    addOpt.className = 'btn btn-outline btn-sm';
    addOpt.textContent = '＋選択肢を追加';
    addOpt.addEventListener('click', () => { q.options.push({ label: '' }); render(); });
    optsWrap.appendChild(addOpt);
    item.appendChild(optsWrap);

    if (q.type === 'radio' || q.type === 'checkbox') {
      const otherRow = document.createElement('div');
      otherRow.className = 'checkbox-row';
      const otherCheck = document.createElement('input');
      otherCheck.type = 'checkbox';
      otherCheck.checked = !!q.allowOther;
      otherCheck.addEventListener('change', () => { q.allowOther = otherCheck.checked; });
      otherRow.append(otherCheck, document.createTextNode('「その他」自由記述を追加する'));
      item.appendChild(otherRow);
    }
  }

  return item;
}

// ── Step 4: 連絡先 / GAS / 計測 ──────────────────────────────
function renderIntegrationStep() {
  const c = state.config;
  const wrap = document.createElement('div');

  const contactCard = document.createElement('div');
  contactCard.className = 'card';
  contactCard.innerHTML = '<h2>連絡先項目</h2>';
  [['email', 'メールアドレス欄を表示する'], ['x', 'Xアカウント欄を表示する']].forEach(([key, label]) => {
    const row = document.createElement('div');
    row.className = 'checkbox-row';
    row.style.marginBottom = '.5rem';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = c.contact[key] !== false;
    check.addEventListener('change', () => { c.contact[key] = check.checked; });
    row.append(check, document.createTextNode(label));
    contactCard.appendChild(row);
  });
  wrap.appendChild(contactCard);

  if (c.type === 'event_entry') {
    const consentCard = document.createElement('div');
    consentCard.className = 'card';
    consentCard.innerHTML = '<h2>同意項目</h2>';
    const row = document.createElement('div');
    row.className = 'checkbox-row';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = !!c.consent.enabled;
    check.addEventListener('change', () => { c.consent.enabled = check.checked; render(); });
    row.append(check, document.createTextNode('同意チェックボックスを必須にする'));
    consentCard.appendChild(row);
    if (c.consent.enabled) {
      const field = document.createElement('div');
      field.className = 'field';
      field.style.marginTop = '.7rem';
      field.innerHTML = '<label>同意文言</label>';
      const input = document.createElement('input');
      input.type = 'text';
      input.value = c.consent.label || '';
      input.addEventListener('input', () => { c.consent.label = input.value; });
      field.appendChild(input);
      consentCard.appendChild(field);
    }
    wrap.appendChild(consentCard);
  }

  const analyticsCard = document.createElement('div');
  analyticsCard.className = 'card';
  analyticsCard.innerHTML = '<h2>GA4計測</h2><p class="card__note">analytics.js の既存規約に従い、成果イベント種別を選びます。generate_lead の lead_type は snbc_event_entry 固定です。新しいイベント名は追加しません。</p>';

  const leadField = document.createElement('div');
  leadField.className = 'field';
  leadField.innerHTML = '<label>成果イベント種別</label>';
  const leadSelect = document.createElement('select');
  [['survey_submit', 'survey_submit（アンケート・参加確定ではない）'], ['generate_lead', 'generate_lead（参加申込・主成果）']].forEach(([v, l]) => {
    const opt = document.createElement('option');
    opt.value = v; opt.textContent = l;
    if (c.analytics.leadEvent === v) opt.selected = true;
    leadSelect.appendChild(opt);
  });
  leadSelect.addEventListener('change', () => { c.analytics.leadEvent = leadSelect.value; ensureAnalyticsDefaults(c); });
  leadField.appendChild(leadSelect);
  analyticsCard.appendChild(leadField);

  const formNameField = document.createElement('div');
  formNameField.className = 'field';
  formNameField.innerHTML = '<label>form_name</label>';
  const formNameInput = document.createElement('input');
  formNameInput.type = 'text';
  formNameInput.value = c.analytics.formName || `${c.slug || 'form'}_form`;
  formNameInput.addEventListener('input', () => { c.analytics.formName = formNameInput.value.trim(); });
  formNameField.appendChild(formNameInput);
  analyticsCard.appendChild(formNameField);
  wrap.appendChild(analyticsCard);

  const gasCard = document.createElement('div');
  gasCard.className = 'card';
  gasCard.innerHTML = `<h2>GAS Web App連携</h2>
    <p class="notice notice--warn">新規GASプロジェクトの作成・初回デプロイ・/exec URLの発行はGoogle側で運営者が手動で行います。ここでは発行済みURLを入力するだけです。「PRを作成」＝GitHub上にPRを作成するところまでで、GASデプロイの完了を意味しません。</p>`;
  const gasField = document.createElement('div');
  gasField.className = 'field';
  gasField.innerHTML = '<label>GAS Web App /exec URL（未定なら空欄のままでOK）</label>';
  const gasInput = document.createElement('input');
  gasInput.type = 'url';
  gasInput.value = c.gas.execUrl || '';
  gasInput.placeholder = 'https://script.google.com/macros/s/xxxxx/exec';
  gasInput.addEventListener('input', () => { c.gas.execUrl = gasInput.value.trim(); });
  gasField.appendChild(gasInput);
  gasCard.appendChild(gasField);

  const gasRow = document.createElement('div');
  gasRow.className = 'checkbox-row';
  const gasCheck = document.createElement('input');
  gasCheck.type = 'checkbox';
  gasCheck.checked = !!c.gas.deployedManually;
  gasCheck.addEventListener('change', () => { c.gas.deployedManually = gasCheck.checked; });
  gasRow.append(gasCheck, document.createTextNode('上記URLはGoogle側で手動デプロイ済みで、現在有効である'));
  gasCard.appendChild(gasRow);
  wrap.appendChild(gasCard);

  wrap.appendChild(stepNavButtons());
  return wrap;
}

// ── Step 5: プレビュー ──────────────────────────────
function renderPreviewStep() {
  ensureAnalyticsDefaults(state.config);
  const wrap = document.createElement('div');
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = '<h2>プレビュー</h2><p class="card__note">このプレビューではGAS送信・GA4送信は一切行われません（常にテストモード相当で描画しています）。</p>';

  const html = renderFormHtml(state.config, { preview: true, previewClosed: state.previewClosed });

  const fmOk = html.startsWith('<!DOCTYPE');
  const fmNotice = document.createElement('p');
  fmNotice.className = fmOk ? 'notice notice--ok' : 'notice notice--error';
  fmNotice.textContent = fmOk
    ? 'front matter（---）混入チェック: OK（先頭は<!DOCTYPE html>）'
    : 'front matter混入チェック: NG（先頭が<!DOCTYPE html>になっていません）';
  card.appendChild(fmNotice);

  const toolbar = document.createElement('div');
  toolbar.className = 'preview-toolbar';
  const mobileBtn = document.createElement('button');
  mobileBtn.type = 'button';
  mobileBtn.className = `btn btn-sm ${state.previewMode === 'mobile' ? 'btn-primary' : 'btn-outline'}`;
  mobileBtn.textContent = '390px（iPhone想定）';
  mobileBtn.addEventListener('click', () => { state.previewMode = 'mobile'; render(); });
  const desktopBtn = document.createElement('button');
  desktopBtn.type = 'button';
  desktopBtn.className = `btn btn-sm ${state.previewMode === 'desktop' ? 'btn-primary' : 'btn-outline'}`;
  desktopBtn.textContent = 'デスクトップ幅';
  desktopBtn.addEventListener('click', () => { state.previewMode = 'desktop'; render(); });
  const closedRow = document.createElement('label');
  closedRow.className = 'checkbox-row';
  closedRow.innerHTML = '<input type="checkbox"> 受付終了表示を確認';
  closedRow.querySelector('input').checked = state.previewClosed;
  closedRow.querySelector('input').addEventListener('change', (e) => { state.previewClosed = e.target.checked; render(); });
  toolbar.append(mobileBtn, desktopBtn, closedRow);
  card.appendChild(toolbar);

  const frameWrap = document.createElement('div');
  frameWrap.className = 'preview-frame-wrap';
  const iframe = document.createElement('iframe');
  iframe.className = `preview-frame ${state.previewMode === 'mobile' ? 'w-mobile' : 'w-desktop'}`;
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  iframe.setAttribute('title', 'フォームプレビュー');
  frameWrap.appendChild(iframe);
  card.appendChild(frameWrap);

  wrap.appendChild(card);
  wrap.appendChild(stepNavButtons());

  setTimeout(() => { iframe.srcdoc = html; }, 0);
  return wrap;
}

// ── Step 6: PR作成 ──────────────────────────────
function renderPublishStep() {
  const c = state.config;
  ensureAnalyticsDefaults(c);
  const wrap = document.createElement('div');

  const validationErrors = validateConfig(c);
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = '<h2>公開前チェック</h2>';
  if (validationErrors.length > 0) {
    const notice = document.createElement('div');
    notice.className = 'notice notice--error';
    notice.innerHTML = `<strong>PRを作成する前に修正してください：</strong><ul>${validationErrors.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>`;
    card.appendChild(notice);
  } else {
    const notice = document.createElement('p');
    notice.className = 'notice notice--ok';
    notice.textContent = '入力内容の検証: OK';
    card.appendChild(notice);
  }
  if (!c.gas.execUrl) {
    const notice = document.createElement('p');
    notice.className = 'notice notice--warn';
    notice.textContent = 'GAS Web AppのURLが未設定です。この状態でもPRは作成できますが、生成ページは送信できない旨の注意書き付きで公開されます。';
    card.appendChild(notice);
  }
  wrap.appendChild(card);

  const ghCard = document.createElement('div');
  ghCard.className = 'card';
  ghCard.innerHTML = `<h2>GitHub連携</h2>
    <p class="card__note">対象リポジトリ: ${OWNER}/${REPO}（ベース: ${BASE_BRANCH}）。mainへの直接commitは行いません。</p>
    <p class="notice notice--warn">Personal Access Tokenはこの画面のメモリ上にのみ保持し、localStorageや生成ファイルには保存されません。ページを閉じる／再読み込みすると消えます。第一候補はFine-grained PAT（Contents: Read and write / Pull requests: Read and write / Metadata: Read-onlyのみ）です。</p>`;

  const tokenField = document.createElement('div');
  tokenField.className = 'field';
  tokenField.innerHTML = '<label>GitHub Personal Access Token</label>';
  const tokenInput = document.createElement('input');
  tokenInput.type = 'password';
  tokenInput.autocomplete = 'off';
  tokenInput.value = state.githubToken;
  tokenInput.addEventListener('input', () => { state.githubToken = tokenInput.value; });
  tokenField.appendChild(tokenInput);
  ghCard.appendChild(tokenField);

  const branchField = document.createElement('div');
  branchField.className = 'field';
  branchField.innerHTML = '<label>作業ブランチ名</label>';
  const branchInput = document.createElement('input');
  branchInput.type = 'text';
  if (!state.branchName) state.branchName = `form-builder/${c.slug || 'new-form'}-${Date.now().toString(36)}`;
  branchInput.value = state.branchName;
  branchInput.addEventListener('input', () => { state.branchName = branchInput.value.trim(); });
  branchField.appendChild(branchInput);
  ghCard.appendChild(branchField);

  const publishBtn = document.createElement('button');
  publishBtn.type = 'button';
  publishBtn.className = 'btn btn-primary';
  publishBtn.textContent = state.publishing ? '作成中…' : 'PRを作成';
  publishBtn.disabled = state.publishing || validationErrors.length > 0 || !state.githubToken || !state.branchName;
  publishBtn.addEventListener('click', () => { runPublish(); });
  ghCard.appendChild(publishBtn);

  if (state.publishLog.length > 0) {
    const pre = document.createElement('pre');
    pre.className = 'log';
    pre.textContent = state.publishLog.join('\n');
    ghCard.appendChild(pre);
  }

  if (state.publishResult) {
    const notice = document.createElement('div');
    notice.className = 'notice notice--ok';
    notice.innerHTML = `PRを作成しました: <a href="${escapeHtml(state.publishResult.html_url)}" target="_blank" rel="noopener">${escapeHtml(state.publishResult.html_url)}</a><br>人間によるレビュー・mergeをお願いします。`;
    ghCard.appendChild(notice);
  }

  wrap.appendChild(ghCard);
  wrap.appendChild(stepNavButtons({ hideNext: true }));
  return wrap;
}

function buildPrBody(config) {
  const gasStatus = config.gas.execUrl
    ? (config.gas.deployedManually ? 'GAS Web Appは手動デプロイ済み・URLは有効という申告あり' : 'URLは入力済みだが「手動デプロイ済み」は未チェック')
    : 'GAS Web App URL未設定（このPRのマージ後、運営者が手動デプロイしURLを設定する必要あり）';
  return `## 概要
form-builder管理画面から生成したフォームです。

- 種別: ${TYPE_LABEL[config.type]}
- タイトル: ${config.title}
- 公開先: \`${config.section}/${config.slug}.html\`

## 生成ファイル
- \`${config.section}/${config.slug}.html\`
- \`${config.section}/${config.slug}.config.json\`

## GAS Web App
${gasStatus}

GASの新規プロジェクト作成・初回デプロイ・/exec URL発行はGoogle側の手動作業です。このPRはGitHub上に公開用ページを追加するところまでを行います。

## 確認事項
- [ ] front matter（\`---\`）が生成HTML先頭に混入していないこと
- [ ] GitHub Pagesデプロイ後、実URLで表示・コンソールエラー無しを確認
- [ ] GASデプロイ後、実際の送信テスト（\`?test=1\`ではない本番導線）を実施

---
_Generated by [Claude Code](https://claude.ai/code) form-builder_`;
}

async function runPublish() {
  const c = state.config;
  state.publishing = true;
  state.publishLog = [];
  state.publishResult = null;
  render();

  const log = (msg) => { state.publishLog.push(msg); render(); };

  try {
    const client = new GitHubClient(OWNER, REPO, state.githubToken);

    log('接続確認中…');
    await client.ping();
    log('OK: リポジトリへアクセスできました。');

    const htmlPath = `${c.section}/${c.slug}.html`;
    const jsonPath = `${c.section}/${c.slug}.config.json`;

    log('入力内容を再検証中…');
    const errors = validateConfig(c);
    if (errors.length > 0) throw new Error(`検証エラー: ${errors.join(' / ')}`);
    log('OK: 入力内容は妥当です。既存ファイルの衝突を確認中…');
    if (await client.fileExists(htmlPath, BASE_BRANCH)) throw new Error(`${htmlPath} は既に存在します。slugを変更してください。`);
    if (await client.fileExists(jsonPath, BASE_BRANCH)) throw new Error(`${jsonPath} は既に存在します。slugを変更してください。`);
    log('OK: ファイル名の衝突はありません。');

    log(`${BASE_BRANCH} の最新SHAを取得中…`);
    const baseSha = await client.getBranchSha(BASE_BRANCH);
    log(`OK: ${baseSha.slice(0, 7)}`);

    log(`作業branch ${state.branchName} を作成中…`);
    await client.createBranch(state.branchName, baseSha);
    log('OK: branch作成完了。');

    const html = renderFormHtml(c, { preview: false });
    const json = renderConfigJson(c);

    log(`${htmlPath} をcommit中…`);
    await client.createFile(htmlPath, state.branchName, utf8ToBase64(html), `feat: add ${c.slug} form page`);
    log('OK');

    log(`${jsonPath} をcommit中…`);
    await client.createFile(jsonPath, state.branchName, utf8ToBase64(json), `feat: add ${c.slug} form config`);
    log('OK');

    log('Pull Requestを作成中…');
    const pr = await client.createPullRequest(
      `feat: ${c.title || c.slug} フォームを追加`,
      buildPrBody(c),
      state.branchName,
      BASE_BRANCH
    );
    log(`OK: PR #${pr.number}`);

    state.publishResult = pr;
  } catch (e) {
    const message = e instanceof GitHubApiError ? `GitHub APIエラー（${e.status}）: ${e.message}` : `エラー: ${e.message}`;
    state.publishLog.push(message);
  } finally {
    state.publishing = false;
    render();
  }
}

const STEP_RENDERERS = {
  template: renderTemplateStep,
  basic: renderBasicStep,
  details: renderDetailsStep,
  questions: renderQuestionsStep,
  integration: renderIntegrationStep,
  preview: renderPreviewStep,
  publish: renderPublishStep
};

async function init() {
  await loadPresets();
  render();
}

init();
