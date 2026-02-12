// === DOM references ===
const $header = document.getElementById('header');
const $settingsView = document.getElementById('settings-view');
const $workitemsView = document.getElementById('workitems-view');
const $errorView = document.getElementById('error-view');
const $projectManagement = document.getElementById('project-management');
const $projectList = document.getElementById('project-list');
const $btnAddProject = document.getElementById('btn-add-project');
const $wizard = document.getElementById('wizard');
const $wizardBar = document.getElementById('wizard-bar');
const $inputOrg = document.getElementById('input-org');
const $inputProject = document.getElementById('input-project');
const $inputPat = document.getElementById('input-pat');
const $projectFilter = document.getElementById('project-filter');
const $typeFilter = document.getElementById('type-filter');
const $iterationFilter = document.getElementById('iteration-filter');
const $summary = document.getElementById('summary');
const $tbody = document.getElementById('workitems-body');
const $errorMessage = document.getElementById('error-message');
const $btnRetry = document.getElementById('btn-retry');
const $btnRefresh = document.getElementById('btn-refresh');
const $btnSettings = document.getElementById('btn-settings');
const $searchInput = document.getElementById('search-input');
const $btnExpandAll = document.getElementById('btn-expand-all');
const $btnFilterToggle = document.getElementById('btn-filter-toggle');
const $filterPanel = document.getElementById('filter-panel');
const $btnDarkMode = document.getElementById('btn-darkmode');
const $statusBar = document.getElementById('status-bar');
const $loading = document.getElementById('loading-overlay');
const $walkthroughOverlay = document.getElementById('walkthrough-overlay');
const $walkthroughClose = document.getElementById('walkthrough-close');
const $walkthroughDone = document.getElementById('walkthrough-done');
const $feedbackFooter = document.getElementById('feedback-footer');

// === State ===
let projects = []; // Array of { id, name, org, project, pat }
let currentProjectId = 'all'; // 'all' or specific project id
let workItems = [];
let iterations = [];
let workItemTypes = [];
let selectedType = '';
let selectedIteration = '';
let searchQuery = '';
let showWalkthroughAfterLoad = false;

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
      // Show walkthrough if this is the first successful load after setup
      if (showWalkthroughAfterLoad) {
        showWalkthroughAfterLoad = false;
        showWalkthrough();
      }
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
  // Only show feedback footer in workitems view
  $feedbackFooter.hidden = name !== 'workitems';
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
function authHeaders(project) {
  const token = btoa(':' + project.pat);
  return {
    'Authorization': 'Basic ' + token,
    'Content-Type': 'application/json'
  };
}

function apiBase(project) {
  return `https://dev.azure.com/${encodeURIComponent(project.org)}/${encodeURIComponent(project.project)}`;
}

// === API: Load work items ===
async function loadWorkItems() {
  try {
    // Determine which projects to fetch from
    const projectsToFetch = currentProjectId === 'all'
      ? projects
      : projects.filter(p => p.id === currentProjectId);

    if (projectsToFetch.length === 0) {
      workItems = [];
      iterations = [];
      transition(States.LOADED);
      return;
    }

    const allItems = [];

    // Fetch work items from each project
    for (const project of projectsToFetch) {
      try {
        // Step 1: WIQL query for items assigned to me
        const wiqlUrl = `${apiBase(project)}/_apis/wit/wiql?api-version=7.1`;
        const query = `SELECT [System.Id] FROM WorkItems WHERE [System.AssignedTo] = @Me AND [System.State] NOT IN ('Closed', 'Done', 'Removed', 'Resolved') ORDER BY [System.ChangedDate] DESC`;

        const wiqlRes = await fetch(wiqlUrl, {
          method: 'POST',
          headers: authHeaders(project),
          body: JSON.stringify({ query })
        });

        if (!wiqlRes.ok) {
          console.error(`WIQL query failed for ${project.name} (${wiqlRes.status})`);
          continue; // Skip this project on error
        }

        const wiqlData = await wiqlRes.json();
        const ids = wiqlData.workItems?.map(wi => wi.id) || [];

        if (ids.length === 0) continue;

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

        for (let i = 0; i < ids.length; i += batchSize) {
          const batchIds = ids.slice(i, i + batchSize).join(',');
          const detailUrl = `${apiBase(project)}/_apis/wit/workitems?ids=${batchIds}&fields=${fields}&api-version=7.1`;
          const detailRes = await fetch(detailUrl, { headers: authHeaders(project) });

          if (!detailRes.ok) {
            console.error(`Fetch details failed for ${project.name} (${detailRes.status})`);
            continue;
          }

          const detailData = await detailRes.json();
          const projectItems = (detailData.value || []).map(wi => ({
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
            completedWork: wi.fields['Microsoft.VSTS.Scheduling.CompletedWork'] ?? null,
            // Add project metadata
            projectId: project.id,
            projectName: project.name,
            projectOrg: project.org,
            projectProject: project.project
          }));
          allItems.push(...projectItems);
        }
      } catch (err) {
        console.error(`Error fetching from ${project.name}:`, err);
        // Continue with other projects
      }
    }

    workItems = allItems;

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
async function updateField(itemId, fieldName, value, projectOrg, projectPat) {
  const url = `https://dev.azure.com/${encodeURIComponent(projectOrg)}/_apis/wit/workitems/${itemId}?api-version=7.1`;
  const body = [{ op: 'replace', path: `/fields/${fieldName}`, value: value }];

  const token = btoa(':' + projectPat);
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': 'Basic ' + token,
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
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    items = items.filter(wi =>
      String(wi.id).includes(q) ||
      wi.title.toLowerCase().includes(q)
    );
  }
  if (selectedType) items = items.filter(wi => wi.type === selectedType);
  if (selectedIteration) items = items.filter(wi => wi.iteration === selectedIteration);
  return items;
}

function renderWorkItems() {
  const filtered = getFiltered();

  // Update filter dropdowns
  renderProjectFilter();
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
    const status = hoursStatus(wi);
    card.className = 'wi-card' + (status ? ` status-${status}` : '');
    card.dataset.id = wi.id;
    card.dataset.projectId = wi.projectId;
    const priorityLabel = wi.priority ? `P${wi.priority}` : '-';
    const descPlain = wi.description ? new DOMParser().parseFromString(wi.description, 'text/html').body.textContent.trim() : '';
    const tooltip = [
      `#${wi.id} ${wi.title}`,
      `Project: ${wi.projectName}`,
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
    const wiUrl = `https://dev.azure.com/${encodeURIComponent(wi.projectOrg)}/${encodeURIComponent(wi.projectProject)}/_workitems/edit/${wi.id}`;
    card.innerHTML = `
      <div class="wi-card-header">
        <button class="wi-toggle" aria-expanded="false" aria-label="Expand details">&#x25b6;</button>
        <span class="wi-id">#${wi.id}</span>
        ${projects.length > 1 ? `<span class="wi-project-badge" title="${esc(wi.projectName)}">${esc(wi.projectName)}</span>` : ''}
        <span class="wi-title" title="${esc(wi.title)}">${esc(wi.title)}</span>
        <button class="wi-copy-link" data-url="${esc(wiUrl)}" title="Copy link (Ctrl+Click for #ID only)">&#x1F517;</button>
      </div>
      <div class="wi-details" hidden>
        ${projects.length > 1 ? `<div class="wi-detail-row"><span class="wi-detail-label">Project</span><span class="wi-detail-value">${esc(wi.projectName)}</span></div>` : ''}
        <div class="wi-detail-row"><span class="wi-detail-label">State</span><span class="wi-detail-value">${esc(wi.state)}</span></div>
        <div class="wi-detail-row"><span class="wi-detail-label">Type</span><span class="wi-detail-value">${esc(wi.type)}</span></div>
        <div class="wi-detail-row"><span class="wi-detail-label">Priority</span><span class="wi-detail-value">${priorityLabel}</span></div>
        <div class="wi-detail-row"><span class="wi-detail-label">Assigned To</span><span class="wi-detail-value">${esc(wi.assignedTo) || '-'}</span></div>
        <div class="wi-detail-row"><span class="wi-detail-label">Iteration</span><span class="wi-detail-value">${esc(wi.iteration.split('\\').pop())}</span></div>
        <div class="wi-detail-row"><span class="wi-detail-label">Area</span><span class="wi-detail-value">${esc(wi.areaPath.split('\\').pop())}</span></div>
        ${wi.description ? `<div class="wi-detail-desc"><span class="wi-detail-label">Description</span><div class="wi-detail-desc-body">${sanitizeHtml(wi.description)}</div></div>` : ''}
      </div>
      <div class="wi-fields">
        <div class="wi-field">
          <span class="wi-field-label">Original</span>
          <div class="wi-field-value">${fmt(wi.originalEstimate)}</div>
        </div>
        <div class="wi-field">
          <span class="wi-field-label">Remaining</span>
          <div class="wi-field-value editable${status ? ` hrs-${status}` : ''}" tabindex="0" data-id="${wi.id}" data-field="Microsoft.VSTS.Scheduling.RemainingWork" data-prop="remainingWork" data-project-org="${esc(wi.projectOrg)}" data-project-id="${esc(wi.projectId)}">${fmt(wi.remainingWork)}</div>
        </div>
        <div class="wi-field">
          <span class="wi-field-label">Completed</span>
          <div class="wi-field-value editable" tabindex="0" data-id="${wi.id}" data-field="Microsoft.VSTS.Scheduling.CompletedWork" data-prop="completedWork" data-project-org="${esc(wi.projectOrg)}" data-project-id="${esc(wi.projectId)}">${fmt(wi.completedWork)}</div>
        </div>
      </div>
    `;
    $tbody.appendChild(card);
  }
}

function renderProjectFilter() {
  const prev = $projectFilter.value;
  $projectFilter.innerHTML = '<option value="all">All Projects</option>';
  for (const project of projects) {
    const opt = document.createElement('option');
    opt.value = project.id;
    opt.textContent = project.name;
    $projectFilter.appendChild(opt);
  }
  $projectFilter.value = prev || 'all';
  // Hide project filter if only one project
  $projectFilter.style.display = projects.length <= 1 ? 'none' : '';
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

// Allowed tags and attributes for description HTML from Azure DevOps
const ALLOWED_TAGS = new Set([
  'p', 'br', 'b', 'i', 'em', 'strong', 'u', 's', 'strike',
  'ul', 'ol', 'li', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'blockquote', 'pre', 'code', 'span', 'div', 'img', 'hr',
  'sub', 'sup', 'dl', 'dt', 'dd'
]);
const ALLOWED_ATTRS = {
  'a': new Set(['href', 'title']),
  'img': new Set(['src', 'alt', 'width', 'height']),
  'td': new Set(['colspan', 'rowspan']),
  'th': new Set(['colspan', 'rowspan']),
  '*': new Set(['class'])
};

function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  sanitizeNode(doc.body);
  return doc.body.innerHTML;
}

function sanitizeNode(node) {
  const children = [...node.childNodes];
  for (const child of children) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const tag = child.tagName.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) {
        // Replace disallowed element with its text content
        child.replaceWith(document.createTextNode(child.textContent));
        continue;
      }
      // Remove disallowed attributes
      const allowedForTag = ALLOWED_ATTRS[tag] || new Set();
      const allowedGlobal = ALLOWED_ATTRS['*'] || new Set();
      for (const attr of [...child.attributes]) {
        if (!allowedForTag.has(attr.name) && !allowedGlobal.has(attr.name)) {
          child.removeAttribute(attr.name);
        }
      }
      // Sanitize href and src to prevent javascript: URLs
      if (child.hasAttribute('href')) {
        const href = child.getAttribute('href');
        if (!/^https?:\/\//i.test(href) && !/^mailto:/i.test(href)) {
          child.removeAttribute('href');
        }
      }
      if (child.hasAttribute('src')) {
        const src = child.getAttribute('src');
        if (!/^https?:\/\//i.test(src) && !/^data:image\//i.test(src)) {
          child.removeAttribute('src');
        }
      }
      sanitizeNode(child);
    }
  }
}

function hoursStatus(wi) {
  const orig = wi.originalEstimate;
  const rem = wi.remainingWork;
  const comp = wi.completedWork;
  // No estimate set
  if (!orig && !comp && !rem) return '';
  // Overrun: completed exceeds original, or no remaining but work incomplete
  if (orig && comp > orig) return 'overrun';
  if (orig && rem === 0 && comp < orig) return 'done';
  if (orig && rem === 0 && comp >= orig) return 'done';
  // Low: remaining is 25% or less of original
  if (orig && rem !== null && rem > 0 && rem <= orig * 0.25) return 'low';
  // On track
  if (orig && rem > 0) return 'on-track';
  // Has remaining but no estimate
  if (!orig && rem > 0) return '';
  return '';
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
  const projectId = card.dataset.projectId;
  if (!id || !projectId) return;

  const item = workItems.find(wi => wi.id === Number(id));
  if (!item) return;

  const url = `https://dev.azure.com/${encodeURIComponent(item.projectOrg)}/${encodeURIComponent(item.projectProject)}/_workitems/edit/${id}`;
  window.open(url, '_blank');
});

// === Keyboard & Cell Navigation ===
function getAllEditableCells() {
  return [...$tbody.querySelectorAll('.editable')];
}

function getAdjacentCell(cell, direction) {
  const cells = getAllEditableCells();
  const idx = cells.indexOf(cell);
  if (idx === -1) return null;
  if (direction === 'next') return cells[idx + 1] || null;
  if (direction === 'prev') return cells[idx - 1] || null;
  // up/down: move by 2 (each card has 2 editable cells: remaining + completed)
  if (direction === 'up') return cells[idx - 2] || null;
  if (direction === 'down') return cells[idx + 2] || null;
  return null;
}

// Keyboard navigation on focused cells
$tbody.addEventListener('keydown', (e) => {
  const cell = e.target.closest('.editable');
  if (!cell || cell.querySelector('input')) return;

  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    startEditing(cell);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    getAdjacentCell(cell, 'up')?.focus();
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    getAdjacentCell(cell, 'down')?.focus();
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    getAdjacentCell(cell, 'prev')?.focus();
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    getAdjacentCell(cell, 'next')?.focus();
  }
});

// === Inline Editing ===
function startEditing(cell, focusAfter) {
  if (cell.querySelector('input') || currentState === States.SAVING) return;

  const itemId = Number(cell.dataset.id);
  const fieldName = cell.dataset.field;
  const prop = cell.dataset.prop;
  const projectOrg = cell.dataset.projectOrg;
  const projectId = cell.dataset.projectId;
  const item = workItems.find(wi => wi.id === itemId);
  if (!item) return;

  // Find the project to get PAT
  const project = projects.find(p => p.id === projectId);
  if (!project) return;

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

  let handled = false;

  async function save(nextCell) {
    if (handled) return;
    handled = true;

    const raw = input.value.trim();
    const newValue = raw === '' ? 0 : parseFloat(raw);

    if (isNaN(newValue) || newValue < 0) {
      cancel(nextCell);
      return;
    }

    if (newValue === originalValue) {
      cancel(nextCell);
      return;
    }

    // Validation: Remaining cannot exceed Original Estimate
    if (prop === 'remainingWork' && item.originalEstimate !== null && newValue > item.originalEstimate) {
      cell.textContent = fmt(originalValue);
      setStatus(`Remaining (${fmt(newValue)}) cannot exceed Original Estimate (${fmt(item.originalEstimate)})`, 'error');
      flash(cell, 'flash-error');
      if (nextCell) nextCell.focus();
      else cell.focus();
      return;
    }

    cell.textContent = fmt(newValue);
    currentState = States.SAVING;
    setStatus(`Saving ${prop} for #${itemId}...`);

    try {
      await updateField(itemId, fieldName, newValue, projectOrg, project.pat);
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

    if (nextCell) nextCell.focus();
  }

  function cancel(nextCell) {
    cell.textContent = fmt(originalValue);
    if (nextCell) nextCell.focus();
    else cell.focus();
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.removeEventListener('blur', onBlur);
      const next = getAdjacentCell(cell, 'next');
      save(next);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      input.removeEventListener('blur', onBlur);
      const dir = e.shiftKey ? 'prev' : 'next';
      const next = getAdjacentCell(cell, dir);
      save(next);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      input.removeEventListener('blur', onBlur);
      cancel();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      input.removeEventListener('blur', onBlur);
      const next = getAdjacentCell(cell, 'up');
      save(next);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      input.removeEventListener('blur', onBlur);
      const next = getAdjacentCell(cell, 'down');
      save(next);
    }
  });

  function onBlur() {
    save(focusAfter || null);
  }

  input.addEventListener('blur', onBlur);
}

$tbody.addEventListener('click', (e) => {
  const cell = e.target.closest('.editable');
  if (!cell) return;
  startEditing(cell);
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

// === Wizard ===
function renderProjectList() {
  $projectList.innerHTML = '';
  if (projects.length === 0) {
    $projectList.innerHTML = '<p class="project-empty">No projects configured yet.</p>';
    return;
  }

  for (const project of projects) {
    const item = document.createElement('div');
    item.className = 'project-item';
    item.dataset.projectId = project.id;
    item.innerHTML = `
      <div class="project-item-info">
        <div class="project-item-name">${esc(project.name)}</div>
        <div class="project-item-details">${esc(project.org)}/${esc(project.project)}</div>
      </div>
      <button class="project-item-delete" data-project-id="${project.id}" title="Delete project">&#x2715;</button>
    `;
    $projectList.appendChild(item);
  }
}

function showProjectManagement() {
  $projectManagement.hidden = false;
  $wizard.hidden = true;
  renderProjectList();
}

function showWizardForNewProject() {
  $projectManagement.hidden = true;
  $wizard.hidden = false;
  $inputOrg.value = '';
  $inputProject.value = '';
  $inputPat.value = '';
  showWizardStep(0);
  // Show back button on welcome step if there are existing projects
  const $backBtn = document.getElementById('wizard-back-to-projects');
  if ($backBtn) {
    $backBtn.hidden = projects.length === 0;
  }
}

// Add project button
$btnAddProject.addEventListener('click', () => {
  showWizardForNewProject();
});

// Delete project
$projectList.addEventListener('click', async (e) => {
  const deleteBtn = e.target.closest('.project-item-delete');
  if (deleteBtn) {
    const projectId = deleteBtn.dataset.projectId;
    if (!confirm('Delete this project? This cannot be undone.')) return;

    projects = projects.filter(p => p.id !== projectId);
    await chrome.storage.sync.set({ devopsProjects: projects });

    // If deleted the current project, reset to all
    if (currentProjectId === projectId) {
      currentProjectId = 'all';
    }

    renderProjectList();

    // If no projects left, stay in settings
    if (projects.length === 0) {
      return;
    }

    // Show success message
    setStatus('Project deleted', 'success');
    return;
  }

  // Click on project item to open timesheet for that project
  const projectItem = e.target.closest('.project-item');
  if (projectItem) {
    const projectId = projectItem.dataset.projectId;
    if (projectId) {
      currentProjectId = projectId;
      transition(States.LOADING);
    }
  }
});

const wizardSteps = $wizard.querySelectorAll('.wizard-step');
const totalSteps = wizardSteps.length;
let wizardStep = 0;

function showWizardStep(step) {
  wizardStep = step;
  wizardSteps.forEach((el, i) => { el.hidden = i !== step; });
  $wizardBar.style.width = `${((step + 1) / totalSteps) * 100}%`;
  // When reaching PAT step, update the link based on org input
  if (step === 3) {
    const org = $inputOrg.value.trim();
    updatePatLink(org);
  }
  // Auto-focus input on the current step
  const input = wizardSteps[step].querySelector('input');
  if (input) setTimeout(() => input.focus(), 50);
}

function validateCurrentStep() {
  // Welcome step (step 0) doesn't require validation - user can proceed with either method
  if (wizardStep === 0) return true;

  const input = wizardSteps[wizardStep].querySelector('input');
  if (input && !input.value.trim()) {
    input.focus();
    input.classList.add('shake');
    input.addEventListener('animationend', () => input.classList.remove('shake'), { once: true });
    return false;
  }
  return true;
}

async function wizardFinish() {
  const org = $inputOrg.value.trim();
  const project = $inputProject.value.trim();
  const pat = $inputPat.value.trim();

  // Create a new project entry
  const newProject = {
    id: Date.now().toString(),
    name: project,
    org: org,
    project: project,
    pat: pat
  };

  projects.push(newProject);
  await chrome.storage.sync.set({ devopsProjects: projects });

  // Check if walkthrough has been shown before
  const { walkthroughShown } = await chrome.storage.sync.get('walkthroughShown');
  if (!walkthroughShown && projects.length === 1) {
    showWalkthroughAfterLoad = true;
  }

  // If this is the first project, go straight to loading
  // Otherwise show project management
  if (projects.length === 1) {
    transition(States.LOADING);
  } else {
    showProjectManagement();
    setStatus('Project added successfully', 'success');
  }
}

$wizard.addEventListener('click', (e) => {
  if (e.target.closest('.wizard-next')) {
    if (wizardStep < totalSteps - 1) {
      if (!validateCurrentStep()) return;
      showWizardStep(wizardStep + 1);
    } else {
      if (!validateCurrentStep()) return;
      wizardFinish();
    }
  } else if (e.target.closest('.wizard-back')) {
    // If on first step and we have existing projects, go back to project management
    if (wizardStep === 0 && projects.length > 0) {
      showProjectManagement();
    } else if (wizardStep > 0) {
      showWizardStep(wizardStep - 1);
    }
  }
});

// Allow Enter key to advance wizard
$wizard.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
    // Don't advance wizard from the URL shortcut input
    if (e.target.id === 'input-url') return;
    e.preventDefault();
    $wizard.querySelector('.wizard-step:not([hidden]) .wizard-next')?.click();
  }
});

// URL shortcut on welcome step
const $inputUrl = document.getElementById('input-url');
const $urlHint = document.getElementById('url-hint');
const $patLinkContainer = document.getElementById('pat-link-container');
const $patLink = document.getElementById('pat-link');

// Update PAT link with detected org
function updatePatLink(org) {
  if (org) {
    const tokenUrl = `https://dev.azure.com/${encodeURIComponent(org)}/_usersSettings/tokens`;
    $patLink.href = tokenUrl;
    $patLinkContainer.hidden = false;
  } else {
    $patLinkContainer.hidden = true;
  }
}

function parseDevOpsUrl(raw) {
  try {
    const url = new URL(raw.trim());
    // Format: https://dev.azure.com/org/project/...
    if (url.hostname === 'dev.azure.com') {
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length >= 2) {
        return { org: decodeURIComponent(parts[0]), project: decodeURIComponent(parts[1]) };
      }
      if (parts.length === 1) {
        return { org: decodeURIComponent(parts[0]), project: '' };
      }
    }
    // Format: https://org.visualstudio.com/project/...
    const vsMatch = url.hostname.match(/^(.+)\.visualstudio\.com$/);
    if (vsMatch) {
      const parts = url.pathname.split('/').filter(Boolean);
      const project = parts.length >= 1 ? decodeURIComponent(parts[0]) : '';
      return { org: vsMatch[1], project };
    }
  } catch { /* not a valid URL */ }
  return null;
}

$inputUrl.addEventListener('input', () => {
  const val = $inputUrl.value.trim();
  if (!val) {
    $urlHint.hidden = true;
    return;
  }
  const parsed = parseDevOpsUrl(val);
  if (parsed && parsed.org) {
    $urlHint.hidden = false;
    $urlHint.className = 'wizard-url-hint url-success';
    const projectText = parsed.project ? `, project: ${parsed.project}` : '';
    $urlHint.textContent = `Found org: ${parsed.org}${projectText}`;
    // Pre-fill and skip to PAT step (or project step if no project found)
    $inputOrg.value = parsed.org;
    // Update the PAT link with the detected org
    updatePatLink(parsed.org);
    if (parsed.project) {
      $inputProject.value = parsed.project;
      showWizardStep(3);
    } else {
      showWizardStep(2);
    }
  } else {
    $urlHint.hidden = false;
    $urlHint.className = 'wizard-url-hint url-error';
    $urlHint.textContent = 'Could not parse URL. Try: https://dev.azure.com/org/project';
  }
});

// === Event Listeners ===

// Copy link button
$tbody.addEventListener('click', (e) => {
  const copyBtn = e.target.closest('.wi-copy-link');
  if (!copyBtn) return;
  e.stopPropagation();

  const url = copyBtn.dataset.url;
  const card = copyBtn.closest('.wi-card');
  const id = card?.dataset.id;

  // Ctrl+Click or Cmd+Click copies just the #ID
  const textToCopy = (e.ctrlKey || e.metaKey) ? `#${id}` : url;

  navigator.clipboard.writeText(textToCopy).then(() => {
    // Visual feedback
    const original = copyBtn.innerHTML;
    copyBtn.innerHTML = '&#x2713;';
    copyBtn.classList.add('copied');
    setTimeout(() => {
      copyBtn.innerHTML = original;
      copyBtn.classList.remove('copied');
    }, 1000);
    setStatus(`Copied ${(e.ctrlKey || e.metaKey) ? '#' + id : 'link'} to clipboard`, 'success');
  }).catch(() => {
    setStatus('Failed to copy to clipboard', 'error');
  });
});

// Refresh
$btnRefresh.addEventListener('click', () => {
  if (currentState === States.LOADED || currentState === States.ERROR) {
    transition(States.LOADING);
  }
});

// Global keyboard shortcuts
document.addEventListener('keydown', (e) => {
  // Don't trigger shortcuts when typing in inputs
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  // R = Refresh
  if (e.key === 'r' || e.key === 'R') {
    if (currentState === States.LOADED || currentState === States.ERROR) {
      e.preventDefault();
      transition(States.LOADING);
    }
  }

  // F = Toggle filters
  if (e.key === 'f' || e.key === 'F') {
    if (currentState === States.LOADED) {
      e.preventDefault();
      toggleFilterPanel();
    }
  }

  // E = Expand/collapse all
  if (e.key === 'e' || e.key === 'E') {
    if (currentState === States.LOADED) {
      e.preventDefault();
      $btnExpandAll.click();
    }
  }
});

// Filter panel toggle
let filtersVisible = false;
function toggleFilterPanel() {
  filtersVisible = !filtersVisible;
  $filterPanel.hidden = !filtersVisible;
  $btnFilterToggle.classList.toggle('active', filtersVisible);
}

$btnFilterToggle.addEventListener('click', toggleFilterPanel);

// Settings gear - now opens project management
$btnSettings.addEventListener('click', () => {
  transition(States.SETTINGS);
  showProjectManagement();
});



// Retry
$btnRetry.addEventListener('click', () => {
  transition(States.LOADING);
});

// Search
let searchTimeout;
$searchInput.addEventListener('input', () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    searchQuery = $searchInput.value.trim();
    renderWorkItems();
  }, 150);
});

// Project filter
$projectFilter.addEventListener('change', () => {
  currentProjectId = $projectFilter.value;
  transition(States.LOADING);
});

// Type filter
$typeFilter.addEventListener('change', () => {
  selectedType = $typeFilter.value;
  updateFilterIndicator();
  renderWorkItems();
});

// Iteration filter
$iterationFilter.addEventListener('change', () => {
  selectedIteration = $iterationFilter.value;
  updateFilterIndicator();
  renderWorkItems();
});

// Update filter button to show indicator when filters are active
function updateFilterIndicator() {
  const hasFilter = selectedType || selectedIteration;
  $btnFilterToggle.classList.toggle('has-filter', hasFilter);
  $btnFilterToggle.title = hasFilter
    ? `Filters active (F) - Type: ${selectedType || 'All'}, Iteration: ${selectedIteration ? selectedIteration.split('\\').pop() : 'All'}`
    : 'Toggle filters (F)';
}

// Expand/collapse all
let allExpanded = false;
$btnExpandAll.addEventListener('click', () => {
  allExpanded = !allExpanded;
  $tbody.querySelectorAll('.wi-card').forEach(card => {
    const details = card.querySelector('.wi-details');
    const toggle = card.querySelector('.wi-toggle');
    details.hidden = !allExpanded;
    toggle.setAttribute('aria-expanded', allExpanded);
    toggle.innerHTML = allExpanded ? '&#x25bc;' : '&#x25b6;';
  });
  $btnExpandAll.innerHTML = allExpanded ? '&#x25B2;' : '&#x25BC;';
  $btnExpandAll.title = allExpanded ? 'Collapse all (E)' : 'Expand all (E)';
});

// Dark mode toggle
$btnDarkMode.addEventListener('click', async () => {
  const dark = document.body.classList.toggle('dark');
  $btnDarkMode.innerHTML = dark ? '&#x2600;' : '&#x263d;';
  await chrome.storage.sync.set({ darkMode: dark });
});

// === Walkthrough ===
async function showWalkthrough() {
  $walkthroughOverlay.hidden = false;
}

async function hideWalkthrough() {
  $walkthroughOverlay.hidden = true;
  await chrome.storage.sync.set({ walkthroughShown: true });
}

$walkthroughClose.addEventListener('click', hideWalkthrough);
$walkthroughDone.addEventListener('click', hideWalkthrough);

// Close walkthrough on overlay click (outside modal)
$walkthroughOverlay.addEventListener('click', (e) => {
  if (e.target === $walkthroughOverlay) {
    hideWalkthrough();
  }
});

// Close walkthrough on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$walkthroughOverlay.hidden) {
    hideWalkthrough();
  }
});

// === Init ===
async function init() {
  // Restore dark mode preference
  const { darkMode } = await chrome.storage.sync.get('darkMode');
  if (darkMode) {
    document.body.classList.add('dark');
    $btnDarkMode.innerHTML = '&#x2600;';
  }

  // Load projects - support migration from old single project format
  const data = await chrome.storage.sync.get(['devopsProjects', 'devopsConfig']);

  if (data.devopsProjects && data.devopsProjects.length > 0) {
    // New multi-project format
    projects = data.devopsProjects;
    transition(States.LOADING);
  } else if (data.devopsConfig?.org && data.devopsConfig?.pat) {
    // Migrate from old single-project format
    projects = [{
      id: Date.now().toString(),
      name: data.devopsConfig.project || data.devopsConfig.org,
      org: data.devopsConfig.org,
      project: data.devopsConfig.project,
      pat: data.devopsConfig.pat
    }];
    await chrome.storage.sync.set({ devopsProjects: projects });
    transition(States.LOADING);
  } else {
    // No projects configured
    transition(States.SETTINGS);
  }
}

init();
