// === DOM references ===
const $header = document.getElementById('header');
const $settingsView = document.getElementById('settings-view');
const $workitemsView = document.getElementById('workitems-view');
const $errorView = document.getElementById('error-view');
const $settingsForm = document.getElementById('settings-form');
const $inputOrg = document.getElementById('input-org');
const $inputProject = document.getElementById('input-project');
const $inputPat = document.getElementById('input-pat');
const $iterationFilter = document.getElementById('iteration-filter');
const $summary = document.getElementById('summary');
const $tbody = document.getElementById('workitems-body');
const $errorMessage = document.getElementById('error-message');
const $btnRetry = document.getElementById('btn-retry');
const $btnRefresh = document.getElementById('btn-refresh');
const $btnSettings = document.getElementById('btn-settings');
const $statusBar = document.getElementById('status-bar');
const $loading = document.getElementById('loading-overlay');

// === State ===
let config = { org: '', project: '', pat: '' };
let workItems = [];
let iterations = [];
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
      originalEstimate: wi.fields['Microsoft.VSTS.Scheduling.OriginalEstimate'] ?? null,
      remainingWork: wi.fields['Microsoft.VSTS.Scheduling.RemainingWork'] ?? null,
      completedWork: wi.fields['Microsoft.VSTS.Scheduling.CompletedWork'] ?? null
    }));

    // Extract unique iterations
    const iterSet = new Set(workItems.map(wi => wi.iteration).filter(Boolean));
    iterations = [...iterSet].sort();

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
function renderWorkItems() {
  // Filter by iteration
  const filtered = selectedIteration
    ? workItems.filter(wi => wi.iteration === selectedIteration)
    : workItems;

  // Update iteration dropdown
  renderIterationFilter();

  // Update summary
  const totalOrig = filtered.reduce((s, wi) => s + (wi.originalEstimate || 0), 0);
  const totalRem = filtered.reduce((s, wi) => s + (wi.remainingWork || 0), 0);
  const totalComp = filtered.reduce((s, wi) => s + (wi.completedWork || 0), 0);
  $summary.textContent = `${filtered.length} items | Est: ${fmt(totalOrig)} | Rem: ${fmt(totalRem)} | Done: ${fmt(totalComp)}`;

  // Render rows
  $tbody.innerHTML = '';
  for (const wi of filtered) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="cell-id">${wi.id}</td>
      <td class="cell-type"><span class="type-badge ${typeBadgeClass(wi.type)}" title="${esc(wi.type)}">${typeAbbr(wi.type)}</span></td>
      <td class="cell-title" title="${esc(wi.title)}">${esc(wi.title)}</td>
      <td class="cell-state">${esc(wi.state)}</td>
      <td class="cell-hours">${fmt(wi.originalEstimate)}</td>
      <td class="cell-hours cell-editable" data-id="${wi.id}" data-field="Microsoft.VSTS.Scheduling.RemainingWork" data-prop="remainingWork">${fmt(wi.remainingWork)}</td>
      <td class="cell-hours cell-editable" data-id="${wi.id}" data-field="Microsoft.VSTS.Scheduling.CompletedWork" data-prop="completedWork">${fmt(wi.completedWork)}</td>
    `;
    $tbody.appendChild(tr);
  }
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

function typeBadgeClass(type) {
  const t = (type || '').toLowerCase();
  if (t === 'task') return 'task';
  if (t === 'bug') return 'bug';
  if (t.includes('user story') || t === 'story') return 'story';
  if (t === 'feature') return 'feature';
  return 'default';
}

function typeAbbr(type) {
  const t = (type || '').toLowerCase();
  if (t === 'task') return 'T';
  if (t === 'bug') return 'B';
  if (t.includes('user story') || t === 'story') return 'S';
  if (t === 'feature') return 'F';
  return '?';
}

// === Inline Editing ===
$tbody.addEventListener('click', (e) => {
  const td = e.target.closest('td.cell-editable');
  if (!td || td.querySelector('input') || currentState === States.SAVING) return;

  const itemId = Number(td.dataset.id);
  const fieldName = td.dataset.field;
  const prop = td.dataset.prop;
  const item = workItems.find(wi => wi.id === itemId);
  if (!item) return;

  const originalValue = item[prop];
  const input = document.createElement('input');
  input.type = 'number';
  input.step = '0.1';
  input.min = '0';
  input.value = originalValue !== null && originalValue !== undefined ? originalValue : '';
  td.textContent = '';
  td.appendChild(input);
  input.focus();
  input.select();

  async function save() {
    const raw = input.value.trim();
    const newValue = raw === '' ? 0 : parseFloat(raw);

    if (isNaN(newValue) || newValue < 0) {
      cancel();
      return;
    }

    // No change
    if (newValue === originalValue) {
      cancel();
      return;
    }

    td.textContent = fmt(newValue);
    currentState = States.SAVING;
    setStatus(`Saving ${prop} for #${itemId}...`);

    try {
      await updateField(itemId, fieldName, newValue);
      item[prop] = newValue;
      currentState = States.LOADED;
      setStatus(`Updated #${itemId} ${prop} to ${fmt(newValue)}`, 'success');
      flash(td, 'flash-success');
      // Re-render summary
      renderSummary();
    } catch (err) {
      td.textContent = fmt(originalValue);
      currentState = States.LOADED;
      setStatus(`Failed to update #${itemId}: ${err.message}`, 'error');
      flash(td, 'flash-error');
    }
  }

  function cancel() {
    td.textContent = fmt(originalValue);
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
  const filtered = selectedIteration
    ? workItems.filter(wi => wi.iteration === selectedIteration)
    : workItems;
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

// Iteration filter
$iterationFilter.addEventListener('change', () => {
  selectedIteration = $iterationFilter.value;
  renderWorkItems();
});

// === Init ===
async function init() {
  const data = await chrome.storage.sync.get('devopsConfig');
  if (data.devopsConfig?.org && data.devopsConfig?.pat) {
    config = data.devopsConfig;
    transition(States.LOADING);
  } else {
    transition(States.SETTINGS);
  }
}

init();
