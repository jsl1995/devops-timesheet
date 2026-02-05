// === DOM references ===
const $header = document.getElementById('header');
const $settingsView = document.getElementById('settings-view');
const $workitemsView = document.getElementById('workitems-view');
const $errorView = document.getElementById('error-view');
const $settingsForm = document.getElementById('settings-form');
const $inputOrg = document.getElementById('input-org');
const $inputProject = document.getElementById('input-project');
const $inputPat = document.getElementById('input-pat');
const $typeFilter = document.getElementById('type-filter');
const $iterationFilter = document.getElementById('iteration-filter');
const $summary = document.getElementById('summary');
const $tbody = document.getElementById('workitems-body');
const $errorMessage = document.getElementById('error-message');
const $btnRetry = document.getElementById('btn-retry');
const $btnRefresh = document.getElementById('btn-refresh');
const $btnSettings = document.getElementById('btn-settings');
const $btnDarkMode = document.getElementById('btn-darkmode');
const $statusBar = document.getElementById('status-bar');
const $loading = document.getElementById('loading-overlay');

// === State ===
let config = { org: '', project: '', pat: '' };
let workItems = [];
let iterations = [];
let workItemTypes = [];
let selectedType = '';
let selectedIteration = '';

// === State Machine ===
const States = { INIT: 'INIT', SETTINGS: 'SETTINGS', LOADING: 'LOADING', LOADED: 'LOADED', SAVING: 'SAVING', ERROR: 'ERROR' };
let currentState = States.INIT;

function transition(state, data) {
  currentState = state;
  switch (state) {
    case States.SETTINGS:
      showView('settings');
      $loading.hidden = true;
      break;
    case States.LOADING:
      showView('workitems');
      $loading.hidden = false;
      clearStatus();
      loadWorkItems();
      break;
    case States.LOADED:
      $loading.hidden = true;
      renderWorkItems();
      break;
    case States.SAVING:
      break;
    case States.ERROR:
      $loading.hidden = true;
      showView('error');
      $errorMessage.textContent = data || 'An error occurred.';
      break;
  }
}

function showView(name) {
  $settingsView.hidden = name !== 'settings';
  $workitemsView.hidden = name !== 'workitems';
  $errorView.hidden = name !== 'error';
}

// === Status bar ===
function setStatus(msg, type = '') {
  $statusBar.textContent = msg;
  $statusBar.className = type ? `status-${type}` : '';
}

function clearStatus() {
  $statusBar.textContent = '';
  $statusBar.className = '';
}

// === Auth header ===
function authHeaders() {
  const token = btoa(':' + config.pat);
  return {
    'Authorization': 'Basic ' + token,
    'Content-Type': 'application/json'
  };
}

function apiBase() {
  return `https://dev.azure.com/${encodeURIComponent(config.org)}/${encodeURIComponent(config.project)}`;
}

// === API: Load work items ===
async function loadWorkItems() {
  try {
    // Step 1: WIQL query for items assigned to me
    const wiqlUrl = `${apiBase()}/_apis/wit/wiql?api-version=7.1`;
    const query = `SELECT [System.Id] FROM WorkItems WHERE [System.AssignedTo] = @Me AND [System.State] NOT IN ('Closed', 'Done', 'Removed', 'Resolved') ORDER BY [System.ChangedDate] DESC`;

    const wiqlRes = await fetch(wiqlUrl, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ query })
    });

    if (!wiqlRes.ok) {
      const text = await wiqlRes.text();
      throw new Error(`WIQL query failed (${wiqlRes.status}): ${text}`);
    }

    const wiqlData = await wiqlRes.json();
    const ids = wiqlData.workItems?.map(wi => wi.id) || [];

    if (ids.length === 0) {
      workItems = [];
      iterations = [];
      transition(States.LOADED);
      return;
    }

    // Step 2: Batch fetch work item details (200 at a time)
    const fields = [
      'System.Id',
      'System.WorkItemType',
      'System.Title',
      'System.State',
      'System.IterationPath',
      'System.AreaPath',
      'System.AssignedTo',
      'System.Description',
      'Microsoft.VSTS.Common.Priority',
      'Microsoft.VSTS.Scheduling.OriginalEstimate',
      'Microsoft.VSTS.Scheduling.RemainingWork',
      'Microsoft.VSTS.Scheduling.CompletedWork'
    ].join(',');

    const batchSize = 200;
    const allItems = [];

    for (let i = 0; i < ids.length; i += batchSize) {
      const batchIds = ids.slice(i, i + batchSize).join(',');
      const detailUrl = `${apiBase()}/_apis/wit/workitems?ids=${batchIds}&fields=${fields}&api-version=7.1`;
      const detailRes = await fetch(detailUrl, { headers: authHeaders() });

      if (!detailRes.ok) {
        const text = await detailRes.text();
        throw new Error(`Fetch details failed (${detailRes.status}): ${text}`);
      }

      const detailData = await detailRes.json();
      allItems.push(...(detailData.value || []));
    }

    // Parse work items
    workItems = allItems.map(wi => ({
      id: wi.id,
      rev: wi.rev,
      type: wi.fields['System.WorkItemType'],
      title: wi.fields['System.Title'],
      state: wi.fields['System.State'],
      iteration: wi.fields['System.IterationPath'] || '',
      areaPath: wi.fields['System.AreaPath'] || '',
      assignedTo: wi.fields['System.AssignedTo']?.displayName || '',
      description: wi.fields['System.Description'] || '',
      priority: wi.fields['Microsoft.VSTS.Common.Priority'] ?? null,
      originalEstimate: wi.fields['Microsoft.VSTS.Scheduling.OriginalEstimate'] ?? null,
      remainingWork: wi.fields['Microsoft.VSTS.Scheduling.RemainingWork'] ?? null,
      completedWork: wi.fields['Microsoft.VSTS.Scheduling.CompletedWork'] ?? null
    }));

    // Extract unique iterations and types
    const iterSet = new Set(workItems.map(wi => wi.iteration).filter(Boolean));
    iterations = [...iterSet].sort();
    const typeSet = new Set(workItems.map(wi => wi.type).filter(Boolean));
    workItemTypes = [...typeSet].sort();

    transition(States.LOADED);
  } catch (err) {
    transition(States.ERROR, err.message);
  }
}

// === API: Update a field ===
async function updateField(itemId, fieldName, value) {
  const url = `https://dev.azure.com/${encodeURIComponent(config.org)}/_apis/wit/workitems/${itemId}?api-version=7.1`;
  const body = [{ op: 'replace', path: `/fields/${fieldName}`, value: value }];

  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': authHeaders()['Authorization'],
      'Content-Type': 'application/json-patch+json'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Update failed (${res.status}): ${text}`);
  }

  return res.json();
}

// === Rendering ===
function getFiltered() {
  let items = workItems;
  if (selectedType) items = items.filter(wi => wi.type === selectedType);
  if (selectedIteration) items = items.filter(wi => wi.iteration === selectedIteration);
  return items;
}

function renderWorkItems() {
  const filtered = getFiltered();

  // Update filter dropdowns
  renderTypeFilter();
  renderIterationFilter();

  // Update summary
  const totalOrig = filtered.reduce((s, wi) => s + (wi.originalEstimate || 0), 0);
  const totalRem = filtered.reduce((s, wi) => s + (wi.remainingWork || 0), 0);
  const totalComp = filtered.reduce((s, wi) => s + (wi.completedWork || 0), 0);
  $summary.textContent = `${filtered.length} items | Est: ${fmt(totalOrig)} | Rem: ${fmt(totalRem)} | Done: ${fmt(totalComp)}`;

  // Render cards
  $tbody.innerHTML = '';
  for (const wi of filtered) {
    const card = document.createElement('div');
    card.className = 'wi-card';
    card.dataset.id = wi.id;
    const priorityLabel = wi.priority ? `P${wi.priority}` : '-';
    const descPlain = wi.description ? new DOMParser().parseFromString(wi.description, 'text/html').body.textContent.trim() : '';
    const tooltip = [
      `#${wi.id} ${wi.title}`,
      `State: ${wi.state}`,
      `Type: ${wi.type}`,
      `Priority: ${priorityLabel}`,
      `Assigned To: ${wi.assignedTo || '-'}`,
      `Iteration: ${wi.iteration.split('\\').pop()}`,
      `Area: ${wi.areaPath.split('\\').pop()}`,
      `Original: ${fmt(wi.originalEstimate)}  Remaining: ${fmt(wi.remainingWork)}  Completed: ${fmt(wi.completedWork)}`,
      descPlain ? `\nDescription:\n${descPlain.substring(0, 300)}${descPlain.length > 300 ? '...' : ''}` : ''
    ].filter(Boolean).join('\n');
    card.title = tooltip;
    card.innerHTML = `
      <div class="wi-card-header">
        <button class="wi-toggle" aria-expanded="false" aria-label="Expand details">&#x25b6;</button>
        <span class="wi-id">#${wi.id}</span>
        <span class="wi-title" title="${esc(wi.title)}">${esc(wi.title)}</span>
      </div>
      <div class="wi-details" hidden>
        <div class="wi-detail-row"><span class="wi-detail-label">State</span><span class="wi-detail-value">${esc(wi.state)}</span></div>
        <div class="wi-detail-row"><span class="wi-detail-label">Type</span><span class="wi-detail-value">${esc(wi.type)}</span></div>
        <div class="wi-detail-row"><span class="wi-detail-label">Priority</span><span class="wi-detail-value">${priorityLabel}</span></div>
        <div class="wi-detail-row"><span class="wi-detail-label">Assigned To</span><span class="wi-detail-value">${esc(wi.assignedTo) || '-'}</span></div>
        <div class="wi-detail-row"><span class="wi-detail-label">Iteration</span><span class="wi-detail-value">${esc(wi.iteration.split('\\').pop())}</span></div>
        <div class="wi-detail-row"><span class="wi-detail-label">Area</span><span class="wi-detail-value">${esc(wi.areaPath.split('\\').pop())}</span></div>
        ${wi.description ? `<div class="wi-detail-desc"><span class="wi-detail-label">Description</span><div class="wi-detail-desc-body">${wi.description}</div></div>` : ''}
      </div>
      <div class="wi-fields">
        <div class="wi-field">
          <span class="wi-field-label">Original</span>
          <div class="wi-field-value">${fmt(wi.originalEstimate)}</div>
        </div>
        <div class="wi-field">
          <span class="wi-field-label">Remaining</span>
          <div class="wi-field-value editable" data-id="${wi.id}" data-field="Microsoft.VSTS.Scheduling.RemainingWork" data-prop="remainingWork">${fmt(wi.remainingWork)}</div>
        </div>
        <div class="wi-field">
          <span class="wi-field-label">Completed</span>
          <div class="wi-field-value editable" data-id="${wi.id}" data-field="Microsoft.VSTS.Scheduling.CompletedWork" data-prop="completedWork">${fmt(wi.completedWork)}</div>
        </div>
      </div>
    `;
    $tbody.appendChild(card);
  }
}

function renderTypeFilter() {
  const prev = $typeFilter.value;
  $typeFilter.innerHTML = '<option value="">All Types</option>';
  for (const type of workItemTypes) {
    const opt = document.createElement('option');
    opt.value = type;
    opt.textContent = type;
    $typeFilter.appendChild(opt);
  }
  $typeFilter.value = prev || '';
}

function renderIterationFilter() {
  const prev = $iterationFilter.value;
  $iterationFilter.innerHTML = '<option value="">All Iterations</option>';
  for (const iter of iterations) {
    const opt = document.createElement('option');
    opt.value = iter;
    opt.textContent = iter.split('\\').pop();
    $iterationFilter.appendChild(opt);
  }
  $iterationFilter.value = prev || '';
}

// === Helpers ===
function fmt(val) {
  if (val === null || val === undefined) return '-';
  return Number(val).toFixed(1);
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

// === Expand/collapse details ===
$tbody.addEventListener('click', (e) => {
  const toggle = e.target.closest('.wi-toggle');
  if (!toggle) return;
  const card = toggle.closest('.wi-card');
  const details = card.querySelector('.wi-details');
  const expanded = !details.hidden;
  details.hidden = expanded;
  toggle.setAttribute('aria-expanded', !expanded);
  toggle.innerHTML = expanded ? '&#x25b6;' : '&#x25bc;';
});

// === Double-click to open work item ===
$tbody.addEventListener('dblclick', (e) => {
  if (e.target.closest('.editable')) return;
  const card = e.target.closest('.wi-card');
  if (!card) return;
  const id = card.dataset.id;
  if (!id) return;
  const url = `https://dev.azure.com/${encodeURIComponent(config.org)}/${encodeURIComponent(config.project)}/_workitems/edit/${id}`;
  window.open(url, '_blank');
});

// === Inline Editing ===
$tbody.addEventListener('click', (e) => {
  const cell = e.target.closest('.editable');
  if (!cell || cell.querySelector('input') || currentState === States.SAVING) return;

  const itemId = Number(cell.dataset.id);
  const fieldName = cell.dataset.field;
  const prop = cell.dataset.prop;
  const item = workItems.find(wi => wi.id === itemId);
  if (!item) return;

  const originalValue = item[prop];
  const input = document.createElement('input');
  input.type = 'number';
  input.step = '0.1';
  input.min = '0';
  input.value = originalValue !== null && originalValue !== undefined ? originalValue : '';
  cell.textContent = '';
  cell.appendChild(input);
  input.focus();
  input.select();

  async function save() {
    const raw = input.value.trim();
    const newValue = raw === '' ? 0 : parseFloat(raw);

    if (isNaN(newValue) || newValue < 0) {
      cancel();
      return;
    }

    if (newValue === originalValue) {
      cancel();
      return;
    }

    cell.textContent = fmt(newValue);
    currentState = States.SAVING;
    setStatus(`Saving ${prop} for #${itemId}...`);

    try {
      await updateField(itemId, fieldName, newValue);
      item[prop] = newValue;
      currentState = States.LOADED;
      setStatus(`Updated #${itemId} ${prop} to ${fmt(newValue)}`, 'success');
      flash(cell, 'flash-success');
      renderSummary();
    } catch (err) {
      cell.textContent = fmt(originalValue);
      currentState = States.LOADED;
      setStatus(`Failed to update #${itemId}: ${err.message}`, 'error');
      flash(cell, 'flash-error');
    }
  }

  function cancel() {
    cell.textContent = fmt(originalValue);
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.removeEventListener('blur', onBlur);
      save();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      input.removeEventListener('blur', onBlur);
      cancel();
    }
  });

  function onBlur() {
    save();
  }

  input.addEventListener('blur', onBlur);
});

function flash(el, cls) {
  el.classList.remove('flash-success', 'flash-error');
  // Force reflow
  void el.offsetWidth;
  el.classList.add(cls);
  el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
}

function renderSummary() {
  const filtered = getFiltered();
  const totalOrig = filtered.reduce((s, wi) => s + (wi.originalEstimate || 0), 0);
  const totalRem = filtered.reduce((s, wi) => s + (wi.remainingWork || 0), 0);
  const totalComp = filtered.reduce((s, wi) => s + (wi.completedWork || 0), 0);
  $summary.textContent = `${filtered.length} items | Est: ${fmt(totalOrig)} | Rem: ${fmt(totalRem)} | Done: ${fmt(totalComp)}`;
}

// === Event Listeners ===

// Settings form
$settingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  config.org = $inputOrg.value.trim();
  config.project = $inputProject.value.trim();
  config.pat = $inputPat.value.trim();

  await chrome.storage.sync.set({ devopsConfig: config });
  transition(States.LOADING);
});

// Refresh
$btnRefresh.addEventListener('click', () => {
  if (currentState === States.LOADED || currentState === States.ERROR) {
    transition(States.LOADING);
  }
});

// Settings gear
$btnSettings.addEventListener('click', () => {
  $inputOrg.value = config.org;
  $inputProject.value = config.project;
  $inputPat.value = config.pat;
  transition(States.SETTINGS);
});

// Retry
$btnRetry.addEventListener('click', () => {
  transition(States.LOADING);
});

// Type filter
$typeFilter.addEventListener('change', () => {
  selectedType = $typeFilter.value;
  renderWorkItems();
});

// Iteration filter
$iterationFilter.addEventListener('change', () => {
  selectedIteration = $iterationFilter.value;
  renderWorkItems();
});

// Dark mode toggle
$btnDarkMode.addEventListener('click', async () => {
  const dark = document.body.classList.toggle('dark');
  $btnDarkMode.innerHTML = dark ? '&#x2600;' : '&#x263d;';
  await chrome.storage.sync.set({ darkMode: dark });
});

// === Init ===
async function init() {
  // Restore dark mode preference
  const { darkMode } = await chrome.storage.sync.get('darkMode');
  if (darkMode) {
    document.body.classList.add('dark');
    $btnDarkMode.innerHTML = '&#x2600;';
  }

  const data = await chrome.storage.sync.get('devopsConfig');
  if (data.devopsConfig?.org && data.devopsConfig?.pat) {
    config = data.devopsConfig;
    transition(States.LOADING);
  } else {
    transition(States.SETTINGS);
  }
}

init();
