import {
  TEMPLATE_TYPES, DIRECTORIES, QUESTION_TYPES,
  createEmptyConfig, templateMeta, createEmptyQuestion, createEmptyOption,
  createEmptyDate, createEmptyPlan,
} from './schema.js';
import { validateConfig, warnings } from './validate.js';
import { renderFormHTML, renderConfigJSON, filePaths, escapeHtml } from './render.js';
import { GitHubClient, GitHubApiError } from './github.js';
import { PRESETS } from './presets.js';

const OWNER = 'nagoya-base';
const REPO = 'snb-community';

let config = createEmptyConfig();
let githubToken = ''; // メモリ上のみ。localStorage/sessionStorageへは一切書き込まない。

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function weekdayLabel(dateStr) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00+09:00`);
  if (Number.isNaN(d.getTime())) return '';
  const w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${m}/${day}(${w})`;
}

// ---- テンプレート種別 ----
function renderTemplatePicker() {
  const wrap = $('#template-picker');
  wrap.innerHTML = TEMPLATE_TYPES.map(
    (t) => `
    <label class="fb-radio-card ${config.type === t.type ? 'is-selected' : ''}">
      <input type="radio" name="template-type" value="${t.type}" ${config.type === t.type ? 'checked' : ''}>
      <strong>${escapeHtml(t.label)}</strong>
      <p>${escapeHtml(t.description)}</p>
    </label>`
  ).join('');
  wrap.querySelectorAll('input[name="template-type"]').forEach((el) => {
    el.addEventListener('change', () => {
      config.type = el.value;
      updateVisibility();
      renderTemplatePicker();
      renderDatesList();
      renderPlansList();
    });
  });
}

function updateVisibility() {
  const meta = templateMeta(config.type);
  $('#section-event-info').hidden = !meta.hasEventInfo;
  $('#section-dates').hidden = !meta.hasDates;
  $('#section-plans').hidden = !meta.hasPlans;
  $('#section-consent').hidden = !meta.hasConsent;
}

// ---- 基本情報バインド ----
function bindTextField(selector, key) {
  const el = $(selector);
  el.value = config[key] || '';
  el.addEventListener('input', () => { config[key] = el.value; });
}
function bindCheckbox(selector, key) {
  const el = $(selector);
  el.checked = !!config[key];
  el.addEventListener('change', () => { config[key] = el.checked; });
}
function bindContactCheckbox(selector, key) {
  const el = $(selector);
  el.checked = !!config.contact[key];
  el.addEventListener('change', () => { config.contact[key] = el.checked; });
}

function bindStaticFields() {
  bindTextField('#f-title', 'title');
  bindTextField('#f-subtitle', 'subtitle');
  bindTextField('#f-yearMonthOrId', 'yearMonthOrId');
  bindTextField('#f-slug', 'slug');
  bindTextField('#f-description', 'description');
  bindTextField('#f-ogpImagePath', 'ogpImagePath');

  const dirEl = $('#f-directory');
  dirEl.innerHTML = DIRECTORIES.map((d) => `<option value="${d}">${d}</option>`).join('');
  dirEl.value = config.directory;
  dirEl.addEventListener('change', () => { config.directory = dirEl.value; });

  bindTextField('#f-eventDate', 'eventDate');
  bindTextField('#f-startTime', 'startTime');
  bindTextField('#f-endTime', 'endTime');
  bindTextField('#f-price', 'price');
  bindTextField('#f-capacity', 'capacity');
  bindTextField('#f-venue', 'venue');
  bindTextField('#f-entryDeadline', 'entryDeadline');
  bindCheckbox('#f-consentRequired', 'consentRequired');

  bindContactCheckbox('#f-contact-name', 'name');
  bindContactCheckbox('#f-contact-x', 'xAccount');
  bindContactCheckbox('#f-contact-email', 'email');
  bindContactCheckbox('#f-contact-emailRequired', 'emailRequired');

  bindTextField('#f-gasExecUrl', 'gasExecUrl');
  bindTextField('#f-resultsGasExecUrl', 'resultsGasExecUrl');
  bindTextField('#f-leadType', 'leadType');

  $('#suggest-slug-btn').addEventListener('click', () => {
    const prefix = config.type === 'event_entry' ? 'event' : 'enquete';
    const suffix = (config.yearMonthOrId || '').replace(/[^0-9]/g, '') || 'yyyymm';
    config.slug = `${prefix}_${suffix}`;
    $('#f-slug').value = config.slug;
  });
}

function refreshStaticFieldsFromConfig() {
  $('#f-title').value = config.title || '';
  $('#f-subtitle').value = config.subtitle || '';
  $('#f-yearMonthOrId').value = config.yearMonthOrId || '';
  $('#f-slug').value = config.slug || '';
  $('#f-description').value = config.description || '';
  $('#f-ogpImagePath').value = config.ogpImagePath || '';
  $('#f-directory').value = config.directory;
  $('#f-eventDate').value = config.eventDate || '';
  $('#f-startTime').value = config.startTime || '';
  $('#f-endTime').value = config.endTime || '';
  $('#f-price').value = config.price || '';
  $('#f-capacity').value = config.capacity || '';
  $('#f-venue').value = config.venue || '';
  $('#f-entryDeadline').value = config.entryDeadline || '';
  $('#f-consentRequired').checked = !!config.consentRequired;
  $('#f-contact-name').checked = !!config.contact.name;
  $('#f-contact-x').checked = !!config.contact.xAccount;
  $('#f-contact-email').checked = !!config.contact.email;
  $('#f-contact-emailRequired').checked = !!config.contact.emailRequired;
  $('#f-gasExecUrl').value = config.gasExecUrl || '';
  $('#f-resultsGasExecUrl').value = config.resultsGasExecUrl || '';
  $('#f-leadType').value = config.leadType || '';
}

// ---- 候補日 ----
function renderDatesList() {
  const wrap = $('#dates-list');
  if (!wrap) return;
  wrap.innerHTML = (config.dates || []).map((d, i) => `
    <div class="fb-row" data-idx="${i}">
      <input type="date" class="fb-date-input" value="${escapeHtml(d.date)}">
      <input type="text" class="fb-date-label-input" placeholder="${escapeHtml(weekdayLabel(d.date) || '例: 9/5(土)')}" value="${escapeHtml(d.label)}">
      <button type="button" class="fb-remove-btn" aria-label="この候補日を削除">✕</button>
    </div>`).join('');
  wrap.querySelectorAll('.fb-row').forEach((row) => {
    const idx = Number(row.dataset.idx);
    row.querySelector('.fb-date-input').addEventListener('input', (e) => {
      config.dates[idx].date = e.target.value;
      if (!config.dates[idx].label) row.querySelector('.fb-date-label-input').placeholder = weekdayLabel(e.target.value);
    });
    row.querySelector('.fb-date-label-input').addEventListener('input', (e) => { config.dates[idx].label = e.target.value; });
    row.querySelector('.fb-remove-btn').addEventListener('click', () => {
      config.dates.splice(idx, 1);
      renderDatesList();
    });
  });
}

// ---- 候補企画 ----
function renderPlansList() {
  const wrap = $('#plans-list');
  if (!wrap) return;
  wrap.innerHTML = (config.plans || []).map((p, i) => `
    <div class="fb-row" data-idx="${i}">
      <input type="text" class="fb-plan-label-input" placeholder="企画名" value="${escapeHtml(p.label)}">
      <button type="button" class="fb-remove-btn" aria-label="この候補企画を削除">✕</button>
    </div>`).join('');
  wrap.querySelectorAll('.fb-row').forEach((row) => {
    const idx = Number(row.dataset.idx);
    row.querySelector('.fb-plan-label-input').addEventListener('input', (e) => {
      config.plans[idx].label = e.target.value;
      config.plans[idx].key = config.plans[idx].key || `plan_${idx + 1}`;
    });
    row.querySelector('.fb-remove-btn').addEventListener('click', () => {
      config.plans.splice(idx, 1);
      renderPlansList();
    });
  });
}

// ---- 質問項目 ----
function slugifyKey(label, fallbackIndex) {
  const romanized = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return romanized || `question_${fallbackIndex + 1}`;
}

function renderQuestionsList() {
  const wrap = $('#questions-list');
  if (!wrap) return;
  wrap.innerHTML = (config.questions || []).map((q, i) => `
    <div class="fb-question-card" data-idx="${i}">
      <div class="fb-row">
        <input type="text" class="fb-q-label" placeholder="質問文（label）" value="${escapeHtml(q.label)}">
        <button type="button" class="fb-remove-btn" aria-label="この質問を削除">✕</button>
      </div>
      <div class="fb-row">
        <label class="fb-inline-label">key
          <input type="text" class="fb-q-key" value="${escapeHtml(q.key)}">
        </label>
        <label class="fb-inline-label">種類
          <select class="fb-q-type">
            ${QUESTION_TYPES.map((t) => `<option value="${t.type}" ${t.type === q.type ? 'selected' : ''}>${t.label}</option>`).join('')}
          </select>
        </label>
        <label class="fb-inline-checkbox"><input type="checkbox" class="fb-q-required" ${q.required ? 'checked' : ''}> 必須</label>
      </div>
      <input type="text" class="fb-q-help" placeholder="補足文（任意）" value="${escapeHtml(q.help)}">
      <div class="fb-q-options" ${['radio', 'checkbox', 'select'].includes(q.type) ? '' : 'hidden'}>
        <p class="fb-mini-label">選択肢</p>
        <div class="fb-options-list"></div>
        <button type="button" class="fb-add-option-btn fb-btn-small">＋選択肢を追加</button>
      </div>
    </div>`).join('');

  wrap.querySelectorAll('.fb-question-card').forEach((card) => {
    const idx = Number(card.dataset.idx);
    const q = config.questions[idx];

    card.querySelector('.fb-q-label').addEventListener('input', (e) => {
      q.label = e.target.value;
      if (!card.dataset.keyTouched) {
        q.key = slugifyKey(e.target.value, idx);
        card.querySelector('.fb-q-key').value = q.key;
      }
    });
    card.querySelector('.fb-q-key').addEventListener('input', (e) => {
      card.dataset.keyTouched = '1';
      q.key = e.target.value;
    });
    card.querySelector('.fb-q-type').addEventListener('change', (e) => {
      q.type = e.target.value;
      renderQuestionsList();
    });
    card.querySelector('.fb-q-required').addEventListener('change', (e) => { q.required = e.target.checked; });
    card.querySelector('.fb-q-help').addEventListener('input', (e) => { q.help = e.target.value; });
    card.querySelector('.fb-remove-btn').addEventListener('click', () => {
      config.questions.splice(idx, 1);
      renderQuestionsList();
    });

    const optionsWrap = card.querySelector('.fb-options-list');
    if (optionsWrap) {
      optionsWrap.innerHTML = (q.options || []).map((o, oi) => `
        <div class="fb-row" data-oidx="${oi}">
          <input type="text" class="fb-option-label" placeholder="選択肢の表示名" value="${escapeHtml(o.label)}">
          <button type="button" class="fb-remove-btn" aria-label="この選択肢を削除">✕</button>
        </div>`).join('');
      optionsWrap.querySelectorAll('.fb-row').forEach((row) => {
        const oidx = Number(row.dataset.oidx);
        row.querySelector('.fb-option-label').addEventListener('input', (e) => {
          q.options[oidx].label = e.target.value;
          q.options[oidx].value = e.target.value;
        });
        row.querySelector('.fb-remove-btn').addEventListener('click', () => {
          q.options.splice(oidx, 1);
          renderQuestionsList();
        });
      });
      const addBtn = card.querySelector('.fb-add-option-btn');
      if (addBtn) addBtn.addEventListener('click', () => { q.options.push(createEmptyOption()); renderQuestionsList(); });
    }
  });
}

// ---- プリセット ----
function renderPresetButtons() {
  const wrap = $('#preset-buttons');
  wrap.innerHTML = PRESETS.map((p) => `<button type="button" class="fb-btn-small" data-preset="${p.id}">${escapeHtml(p.label)}</button>`).join('') +
    `<button type="button" class="fb-btn-small" data-preset="__new__">新規作成（空の状態から）</button>`;
  wrap.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.preset;
      if (id === '__new__') {
        config = createEmptyConfig();
      } else {
        const preset = PRESETS.find((p) => p.id === id);
        config = JSON.parse(JSON.stringify(preset.config));
      }
      refreshStaticFieldsFromConfig();
      updateVisibility();
      renderTemplatePicker();
      renderDatesList();
      renderPlansList();
      renderQuestionsList();
      clearResult();
    });
  });
}

// ---- 検証結果表示 ----
function showValidation() {
  const errors = validateConfig(config);
  const warns = warnings(config);
  const errBox = $('#validation-errors');
  const warnBox = $('#validation-warnings');
  errBox.innerHTML = errors.length
    ? `<p class="fb-error-title">公開前に以下を修正してください：</p><ul>${errors.map((e) => `<li>${escapeHtml(e.message)}</li>`).join('')}</ul>`
    : '';
  warnBox.innerHTML = warns.length
    ? `<p class="fb-warn-title">確認事項：</p><ul>${warns.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>`
    : '';
  return errors;
}

function clearResult() {
  $('#pr-result').innerHTML = '';
  $('#preview-frame-wrap').hidden = true;
}

// ---- プレビュー ----
function doPreview() {
  const errors = showValidation();
  const html = renderFormHTML(config, { preview: true });
  const { htmlPath, configPath, canonicalUrl } = filePaths(config);

  $('#preview-frame-wrap').hidden = false;
  const iframe = $('#preview-iframe');
  iframe.srcdoc = html;

  $('#preview-meta').innerHTML = `
    <p><strong>生成先HTML:</strong> <code>${escapeHtml(htmlPath)}</code></p>
    <p><strong>設定JSON:</strong> <code>${escapeHtml(configPath)}</code></p>
    <p><strong>公開URL（予定）:</strong> <code>${escapeHtml(canonicalUrl)}</code></p>
    <p class="fb-note">プレビューは常にテストモード扱いです。GAS送信・メール通知・GA4送信は発生しません。</p>
    ${errors.length ? '<p class="fb-error-title">※ 検証エラーがあるため、このままではPRを作成できません。</p>' : ''}
  `;
}

// ---- PR作成 ----
function setPrStatus(message, kind) {
  $('#pr-result').innerHTML = `<p class="fb-pr-status fb-pr-status--${kind}">${message}</p>`;
}

async function doCreatePr() {
  const errors = showValidation();
  if (errors.length) {
    setPrStatus('検証エラーがあるためPRを作成できません。上のエラー一覧を確認してください。', 'error');
    return;
  }

  const token = $('#f-github-token').value.trim();
  if (!token) {
    setPrStatus('GitHubのFine-grained PATを入力してください。トークンは保存されず、このページのメモリ上にのみ保持されます。', 'error');
    return;
  }
  githubToken = token;

  const client = new GitHubClient({ owner: OWNER, repo: REPO, token: githubToken });
  const { htmlPath, configPath } = filePaths(config);
  const prBtn = $('#pr-btn');
  prBtn.disabled = true;
  setPrStatus('確認中…（既存ファイルとの衝突をチェックしています）', 'info');

  try {
    const [htmlExists, configExists] = await Promise.all([
      client.fileExists(htmlPath),
      client.fileExists(configPath),
    ]);
    if (htmlExists || configExists) {
      setPrStatus(`既に存在するファイルと衝突しています（${htmlExists ? htmlPath : configPath}）。slugを変更してください。`, 'error');
      return;
    }

    setPrStatus('main の最新SHAを取得しています…', 'info');
    const sha = await client.getBranchSha('main');

    const branchName = `form-builder/${config.slug}-${Date.now()}`;
    setPrStatus(`作業ブランチ ${branchName} を作成しています…`, 'info');
    await client.createBranch(branchName, sha);

    setPrStatus('生成ファイルをコミットしています…', 'info');
    const html = renderFormHTML(config, { preview: false });
    const json = renderConfigJSON(config);
    await client.putFile({ path: htmlPath, content: html, branch: branchName, message: `Add ${htmlPath} via form-builder` });
    await client.putFile({ path: configPath, content: json, branch: branchName, message: `Add ${configPath} via form-builder` });

    setPrStatus('Pull Requestを作成しています…', 'info');
    const meta = templateMeta(config.type);
    const prBody = buildPrBody({ htmlPath, configPath });
    const pr = await client.createPullRequest({
      title: `[form-builder] ${config.title || config.slug} (${meta.label})を追加`,
      head: branchName,
      base: 'main',
      body: prBody,
    });

    setPrStatus(`PRを作成しました: <a href="${pr.html_url}" target="_blank" rel="noopener noreferrer">#${pr.number} ${escapeHtml(pr.title)}</a><br>このPRはauto-mergeされません。内容を確認のうえ人間がmergeしてください。GASの初回デプロイは別途手動で行ってください。`, 'success');
  } catch (e) {
    if (e instanceof GitHubApiError && e.status === 403) {
      setPrStatus(
        `GitHub APIが403を返しました: ${escapeHtml(e.message)}<br>` +
        'Fine-grained PATに Contents(Read and write) / Pull requests(Read and write) の権限が付与されているか確認してください。' +
        'PR作成のみ失敗する場合はPAT側のPull requests権限不足が典型的な原因です（フォールバックとしてclassic PATのrepoスコープも検討可）。',
        'error'
      );
    } else if (e instanceof GitHubApiError) {
      setPrStatus(`GitHub APIエラー: ${escapeHtml(e.message)}`, 'error');
    } else {
      setPrStatus(`エラーが発生しました: ${escapeHtml(e.message || String(e))}`, 'error');
    }
  } finally {
    prBtn.disabled = false;
  }
}

function buildPrBody({ htmlPath, configPath }) {
  const meta = templateMeta(config.type);
  return [
    `## form-builder から自動生成`,
    ``,
    `- テンプレート種別: ${meta.label}`,
    `- 生成HTML: \`${htmlPath}\``,
    `- 設定JSON: \`${configPath}\``,
    `- GAS Web App /exec URL: ${config.gasExecUrl ? '設定済み（本文には値を記載していません）' : '未設定（プレースホルダーのまま。送信は失敗するよう安全側に倒されています）'}`,
    ``,
    `GASの新規作成・初回デプロイ・/execURL発行は本ツールでは自動化されていません。`,
    `運営者が手動でGoogle側の作業を行ったうえで、上記/exec URLを本フォームに設定してください。`,
    ``,
    `このPRはauto-mergeされません。内容を確認のうえ人間がmergeしてください。`,
  ].join('\n');
}

function bindActions() {
  $('#preview-btn').addEventListener('click', doPreview);
  $('#pr-btn').addEventListener('click', doCreatePr);
  $('#validate-btn').addEventListener('click', showValidation);
  $('#discard-token-btn').addEventListener('click', () => {
    githubToken = '';
    $('#f-github-token').value = '';
    setPrStatus('GitHubトークンを破棄しました。', 'info');
  });
  $('#add-date-btn').addEventListener('click', () => { config.dates.push(createEmptyDate()); renderDatesList(); });
  $('#add-plan-btn').addEventListener('click', () => { config.plans.push(createEmptyPlan()); renderPlansList(); });
  $('#add-question-btn').addEventListener('click', () => { config.questions.push(createEmptyQuestion()); renderQuestionsList(); });
}

function init() {
  renderPresetButtons();
  renderTemplatePicker();
  updateVisibility();
  bindStaticFields();
  renderDatesList();
  renderPlansList();
  renderQuestionsList();
  bindActions();
}

document.addEventListener('DOMContentLoaded', init);
