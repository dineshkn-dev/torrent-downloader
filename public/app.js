'use strict';

const API = '/api';
const FOLDER_FILTER_STORAGE_KEY = 'torrex.activeFolderFilter';

let activeFolderFilter = 'all';
let latestTorrentList = [];
let latestVisibleList = [];
const selectedInfoHashes = new Set();
let focusedCardIndex = -1;

function getSelectedTorrents() {
  if (!latestTorrentList.length || !selectedInfoHashes.size) return [];
  return latestTorrentList.filter(t => selectedInfoHashes.has(t.infoHash));
}

function pruneSelection() {
  const valid = new Set(latestTorrentList.map(t => t.infoHash));
  [...selectedInfoHashes].forEach(hash => {
    if (!valid.has(hash)) selectedInfoHashes.delete(hash);
  });
}

function syncCardSelectionState(card, hash) {
  const selected = selectedInfoHashes.has(hash);
  card.classList.toggle('is-selected', selected);
  const input = card.querySelector('.card-select-input');
  if (input) input.checked = selected;
}

function updateBulkToolbar() {
  const bar = document.getElementById('bulk-toolbar');
  if (!bar) return;

  const selected = getSelectedTorrents();
  const totalSelected = selected.length;

  const selectedCount = document.getElementById('bulk-selected-count');
  if (selectedCount) selectedCount.textContent = totalSelected;

  bar.hidden = totalSelected === 0;

  const inProgress = selected.filter(t => !t.done && !t.failed).length;
  const completedNoSeed = selected.filter(t => t.done && t.seeding === false).length;
  const failed = selected.filter(t => t.failed).length;

  const btnStop = document.getElementById('bulk-stop-seeding');
  const btnResume = document.getElementById('bulk-resume-seeding');
  const btnRetry = document.getElementById('bulk-retry-failed');
  const btnRemove = document.getElementById('bulk-remove');
  const btnSelectAll = document.getElementById('bulk-select-all-visible');

  if (btnStop) btnStop.disabled = inProgress === 0;
  if (btnResume) btnResume.disabled = completedNoSeed === 0;
  if (btnRetry) btnRetry.disabled = failed === 0;
  if (btnRemove) btnRemove.disabled = totalSelected === 0;
  if (btnSelectAll) btnSelectAll.disabled = latestVisibleList.length === 0;
}

function clearSelection() {
  selectedInfoHashes.clear();
  document.querySelectorAll('.torrent-card[data-info-hash]').forEach(card => {
    syncCardSelectionState(card, card.dataset.infoHash || '');
  });
  updateBulkToolbar();
}

function selectAllVisible() {
  latestVisibleList.forEach(t => selectedInfoHashes.add(t.infoHash));
  document.querySelectorAll('.torrent-card[data-info-hash]').forEach(card => {
    syncCardSelectionState(card, card.dataset.infoHash || '');
  });
  updateBulkToolbar();
}

const EMPTY_STATE_COPY = {
  all: {
    title: 'No downloads yet',
    sub: 'Add a magnet link or drop a .torrent file to get started',
    buttonLabel: 'Add your first torrent',
    action: 'add',
  },
  'in-progress': {
    title: 'Nothing in progress',
    sub: 'All torrents are either completed or not started yet.',
    buttonLabel: 'Show all torrents',
    action: 'show-all',
  },
  completed: {
    title: 'No completed torrents',
    sub: 'Completed downloads will appear here.',
    buttonLabel: 'Show all torrents',
    action: 'show-all',
  },
  failed: {
    title: 'No failed torrents',
    sub: 'Failed downloads will be listed here for quick retry.',
    buttonLabel: 'Show all torrents',
    action: 'show-all',
  },
  'seeding-off': {
    title: 'Nothing with seeding off',
    sub: 'Completed torrents with seeding disabled will appear here.',
    buttonLabel: 'Show all torrents',
    action: 'show-all',
  },
};

function updateEmptyStateContent(visibleList) {
  const titleEl = document.getElementById('empty-title');
  const subEl   = document.getElementById('empty-sub');
  const btn     = document.getElementById('empty-add-btn');
  if (!titleEl || !subEl || !btn) return;

  const key = (visibleList.length === 0 ? activeFolderFilter : 'all');
  const copy = EMPTY_STATE_COPY[key] ?? EMPTY_STATE_COPY.all;

  titleEl.textContent = copy.title;
  subEl.textContent = copy.sub;

  const textNode = btn.childNodes[btn.childNodes.length - 1];
  if (textNode && textNode.nodeType === Node.TEXT_NODE) {
    textNode.textContent = ` ${copy.buttonLabel}`;
  }

  btn.dataset.action = copy.action;
  btn.classList.toggle('btn-primary', copy.action === 'add');
  btn.classList.toggle('btn-ghost', copy.action !== 'add');
}

function initEmptyStateButtonBehavior() {
  const btn = document.getElementById('empty-add-btn');
  if (!btn) return;
  btn.addEventListener('click', (e) => {
    if (btn.dataset.action !== 'show-all') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    setActiveFolderFilter('all');
  }, true);
}

function filterTorrentsByFolder(list, filter) {
  switch (filter) {
    case 'in-progress':
      return list.filter(t => !t.done && !t.failed);
    case 'completed':
      return list.filter(t => !!t.done);
    case 'failed':
      return list.filter(t => !!t.failed);
    case 'seeding-off':
      return list.filter(t => !!t.done && t.seeding === false);
    case 'all':
    default:
      return list;
  }
}

function updateFolderCounts(list) {
  const counts = {
    all: list.length,
    'in-progress': list.filter(t => !t.done && !t.failed).length,
    completed: list.filter(t => !!t.done).length,
    failed: list.filter(t => !!t.failed).length,
    'seeding-off': list.filter(t => !!t.done && t.seeding === false).length,
  };

  const map = {
    all: 'folder-count-all',
    'in-progress': 'folder-count-in-progress',
    completed: 'folder-count-completed',
    failed: 'folder-count-failed',
    'seeding-off': 'folder-count-seeding-off',
  };

  Object.entries(map).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = counts[key];
  });
}

function updateFolderActiveState() {
  document.querySelectorAll('.folder-item[data-folder-filter]').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.folderFilter === activeFolderFilter);
  });
}

function normalizeFolderFilter(filter) {
  return Object.prototype.hasOwnProperty.call(EMPTY_STATE_COPY, filter) ? filter : 'all';
}

function setActiveFolderFilter(filter) {
  activeFolderFilter = normalizeFolderFilter(filter || 'all');
  focusedCardIndex = -1;
  try {
    localStorage.setItem(FOLDER_FILTER_STORAGE_KEY, activeFolderFilter);
  } catch {}
  updateFolderActiveState();
  renderList(latestTorrentList);
}

function initFolderFilters() {
  try {
    const saved = localStorage.getItem(FOLDER_FILTER_STORAGE_KEY);
    if (saved) activeFolderFilter = normalizeFolderFilter(saved);
  } catch {}

  document.querySelectorAll('.folder-item[data-folder-filter]').forEach(btn => {
    btn.addEventListener('click', () => setActiveFolderFilter(btn.dataset.folderFilter || 'all'));
  });
  updateFolderActiveState();
}

/* ═══════════════════════════════════════════════════════════════
   Utilities
════════════════════════════════════════════════════════════════ */
function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = String(str ?? '');
  return d.innerHTML;
}

function formatSpeed(bps) {
  if (!Number.isFinite(bps) || bps <= 0) return '—';
  if (bps < 1024)        return `${bps} B/s`;
  if (bps < 1048576)     return `${(bps / 1024).toFixed(1)} KB/s`;
  return `${(bps / 1048576).toFixed(2)} MB/s`;
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1048576)     return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824)  return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

/* ═══════════════════════════════════════════════════════════════
   Toast
════════════════════════════════════════════════════════════════ */
const TOAST_ICONS = {
  error:   `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
  success: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  info:    `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
};

function showToast(msg, type = 'info') {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<div class="toast-icon">${TOAST_ICONS[type] ?? TOAST_ICONS.info}</div><span>${escapeHtml(msg)}</span>`;
  c.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'toastOut .25s var(--ease) both';
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, 4000);
  console[type === 'error' ? 'error' : 'log']('[toast]', msg);
}

function showError(msg) { showToast(msg, 'error'); }

/* ═══════════════════════════════════════════════════════════════
   SVG icons (inline, reused)
════════════════════════════════════════════════════════════════ */
const IC = {
  dl:     `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="7 10 12 15 17 10"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
  ul:     `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 14 12 9 7 14"/><line x1="12" y1="21" x2="12" y2="9"/></svg>`,
  peers:  `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  retry:  `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`,
  info:   `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
  folder: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
  trash:  `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>`,
  stopSeed: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6"/></svg>`,
};

function cardActionsHtml({ isFailed, isSeeding }) {
  return `
    <div class="action-cluster action-cluster-main">
      ${isFailed
        ? `<button class="action-btn action-btn-priority retry-btn" title="Retry">${IC.retry}</button>`
        : `<button class="action-btn action-btn-priority details-btn" title="Details">${IC.info}</button>`
      }
      <button class="action-btn action-btn-quiet open-folder-btn" title="Open folder">${IC.folder}</button>
    </div>
    <div class="action-cluster action-cluster-state">
      ${isSeeding && !isFailed
        ? `<button class="action-btn action-btn-state stop-seed-btn" title="Stop seeding">${IC.stopSeed}</button>`
        : `<span class="seed-state-chip">Seeding off</span>`
      }
    </div>
    <div class="action-cluster action-cluster-danger">
      <button class="action-btn action-btn-danger remove-btn" title="Remove">${IC.trash}</button>
    </div>
  `;
}

/* ═══════════════════════════════════════════════════════════════
   Card rendering
════════════════════════════════════════════════════════════════ */
function getCardState(t) {
  const isDone   = !!t?.done;
  const isFailed = !!t?.failed;
  const isSeeding = t?.seeding !== false; // Default to true if not specified
  const isActive = !isDone && !isFailed;

  let badgeClass = 'downloading';
  let badgeLabel = 'Downloading';
  if (isDone && isSeeding) { badgeClass = 'done'; badgeLabel = 'Seeding'; }
  if (isDone && !isSeeding) { badgeClass = 'done'; badgeLabel = 'Complete'; }
  if (isFailed) { badgeClass = 'failed'; badgeLabel = 'Failed'; }

  return { isDone, isFailed, isActive, isSeeding, badgeClass, badgeLabel };
}

function renderTorrent(t) {
  const progress = clamp(Number.isFinite(t?.progress) ? t.progress : 0, 0, 100);
  const dlSpeed  = Number.isFinite(t?.downloadSpeed) ? t.downloadSpeed : 0;
  const ulSpeed  = Number.isFinite(t?.uploadSpeed)   ? t.uploadSpeed   : 0;
  const numPeers = Number.isFinite(t?.numPeers)      ? t.numPeers      : 0;
  const length   = Number.isFinite(t?.length)        ? t.length        : 0;

  const { isDone, isFailed, isSeeding, badgeClass, badgeLabel } = getCardState(t);

  const card = document.createElement('div');
  card.className = [
    'torrent-card',
    isDone   ? 'done'   : '',
    isFailed ? 'failed' : '',
  ].filter(Boolean).join(' ');
  card.dataset.infoHash = t?.infoHash ?? '';
  card.dataset.failed   = isFailed ? 'true' : 'false';

  card.innerHTML = `
    <div class="card-body">
      <div class="card-top">
        <label class="card-select" title="Select torrent">
          <input type="checkbox" class="card-select-input" aria-label="Select torrent" />
          <span class="card-select-box"></span>
        </label>
        <p class="card-name">${escapeHtml(t?.name || 'Connecting…')}</p>
        <span class="card-badge ${badgeClass}">
          <span class="badge-dot"></span>${badgeLabel}
        </span>
      </div>

      <div class="card-progress">
        <div class="progress-header">
          <span class="progress-pct">${progress.toFixed(1)}%</span>
          <span class="progress-eta">${length > 0 ? formatSize(length) : ''}</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill" style="width:${progress}%"></div>
        </div>
      </div>

      <div class="card-stats">
        <span class="stat-chip dl">${IC.dl}<span class="sv-dl">${formatSpeed(dlSpeed)}</span></span>
        <span class="stat-chip ul">${IC.ul}<span class="sv-ul">${formatSpeed(ulSpeed)}</span></span>
        <span class="stat-chip">${IC.peers}<span class="sv-peers">${numPeers} peers</span></span>
      </div>
    </div>

    <div class="card-footer">
      <div class="card-actions-default card-actions">
        ${cardActionsHtml({ isFailed, isSeeding })}
      </div>

      <div class="confirm-remove-row card-actions">
        <span class="confirm-remove-label">Remove this torrent?</span>
        <button class="action-btn cancel-remove-btn">Cancel</button>
        <button class="action-btn confirm-remove-btn">Remove</button>
      </div>
    </div>
  `;

  syncCardSelectionState(card, t.infoHash);

  card.querySelector('.card-select-input')?.addEventListener('change', e => {
    const checked = !!e.target.checked;
    if (checked) selectedInfoHashes.add(t.infoHash);
    else selectedInfoHashes.delete(t.infoHash);
    syncCardSelectionState(card, t.infoHash);
    updateBulkToolbar();
  });

  // Retry
  card.querySelector('.retry-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    retryTorrent(t.infoHash);
  });

  // Details
  card.querySelector('.details-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    openDetails(t.infoHash);
  });

  // Remove flow
  card.querySelector('.remove-btn').addEventListener('click', e => {
    e.stopPropagation();
    card.classList.add('confirming-remove');
  });
  card.querySelector('.cancel-remove-btn').addEventListener('click', e => {
    e.stopPropagation();
    card.classList.remove('confirming-remove');
  });
  card.querySelector('.confirm-remove-btn').addEventListener('click', e => {
    e.stopPropagation();
    card.classList.remove('confirming-remove');
    removeTorrent(t.infoHash);
  });

  // Stop seeding
  card.querySelector('.stop-seed-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    stopSeeding(t.infoHash);
  });

  // Resume seeding
  card.querySelector('.resume-seed-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    resumeSeeding(t.infoHash);
  });

  // Open in Explorer/Finder
  card.querySelector('.open-folder-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    openInExplorer(t.infoHash);
  });

  return card;
}

/* In-place update — no DOM thrashing */
function updateCardInPlace(card, t) {
  const progress = clamp(Number.isFinite(t?.progress) ? t.progress : 0, 0, 100);
  const dlSpeed  = Number.isFinite(t?.downloadSpeed) ? t.downloadSpeed : 0;
  const ulSpeed  = Number.isFinite(t?.uploadSpeed)   ? t.uploadSpeed   : 0;
  const numPeers = Number.isFinite(t?.numPeers)      ? t.numPeers      : 0;

  const { isDone, isFailed, isSeeding, badgeClass, badgeLabel } = getCardState(t);

  // Card-level classes / attributes
  card.classList.toggle('done',   isDone);
  card.classList.toggle('failed', isFailed);
  card.dataset.failed = isFailed ? 'true' : 'false';

  // Name (only if changed)
  const nameEl = card.querySelector('.card-name');
  const newName = escapeHtml(t?.name || 'Connecting…');
  if (nameEl && nameEl.innerHTML !== newName) nameEl.innerHTML = newName;

  // Badge
  if (!card.classList.contains('confirming-remove')) {
    const badge = card.querySelector('.card-badge');
    if (badge) {
      badge.className = `card-badge ${badgeClass}`;
      badge.innerHTML = `<span class="badge-dot"></span>${badgeLabel}`;
    }
  }

  // Progress bar
  const fill = card.querySelector('.progress-fill');
  if (fill) fill.style.width = `${progress}%`;

  const pct = card.querySelector('.progress-pct');
  if (pct) pct.textContent = `${progress.toFixed(1)}%`;

  // Stats
  const svDl    = card.querySelector('.sv-dl');
  const svUl    = card.querySelector('.sv-ul');
  const svPeers = card.querySelector('.sv-peers');
  if (svDl)    svDl.textContent    = formatSpeed(dlSpeed);
  if (svUl)    svUl.textContent    = formatSpeed(ulSpeed);
  if (svPeers) svPeers.textContent = `${numPeers} peers`;

  syncCardSelectionState(card, t.infoHash);

  // Update card actions if status changed
  if (!card.classList.contains('confirming-remove')) {
    const actionsContainer = card.querySelector('.card-actions-default');
    if (actionsContainer) {
      const currentButtons = Array.from(actionsContainer.querySelectorAll('.action-btn'));
      const hasRetry = currentButtons.some(btn => btn.classList.contains('retry-btn'));
      const hasDetails = currentButtons.some(btn => btn.classList.contains('details-btn'));
      const hasStopSeed = currentButtons.some(btn => btn.classList.contains('stop-seed-btn'));
      
      const shouldHaveRetry = isFailed;
      const shouldHaveDetails = !isFailed;
      const shouldHaveStopSeed = isSeeding && !isFailed;

      if (hasRetry !== shouldHaveRetry || hasDetails !== shouldHaveDetails || 
          hasStopSeed !== shouldHaveStopSeed) {
        actionsContainer.innerHTML = cardActionsHtml({ isFailed, isSeeding });
        
        const retryBtn = actionsContainer.querySelector('.retry-btn');
        if (retryBtn) retryBtn.addEventListener('click', e => {
          e.stopPropagation();
          retryTorrent(t.infoHash);
        });
        
        const detailsBtn = actionsContainer.querySelector('.details-btn');
        if (detailsBtn) detailsBtn.addEventListener('click', e => {
          e.stopPropagation();
          openDetails(t.infoHash);
        });
        
        const stopSeedBtn = actionsContainer.querySelector('.stop-seed-btn');
        if (stopSeedBtn) stopSeedBtn.addEventListener('click', e => {
          e.stopPropagation();
          stopSeeding(t.infoHash);
        });

        const openFolderBtn = actionsContainer.querySelector('.open-folder-btn');
        if (openFolderBtn) openFolderBtn.addEventListener('click', e => {
          e.stopPropagation();
          openInExplorer(t.infoHash);
        });
        
        const removeBtn = actionsContainer.querySelector('.remove-btn');
        if (removeBtn) {
          removeBtn.addEventListener('click', e => {
            e.stopPropagation();
            card.classList.add('confirming-remove');
          });
        }
      }
    }
  }

}

/* ═══════════════════════════════════════════════════════════════
   Render list (DOM diff — no full re-render)
════════════════════════════════════════════════════════════════ */
function renderList(list) {
  latestTorrentList = Array.isArray(list) ? list : [];
  pruneSelection();
  updateFolderCounts(latestTorrentList);

  const visibleList = filterTorrentsByFolder(latestTorrentList, activeFolderFilter);
  latestVisibleList = visibleList;
  const container  = document.getElementById('torrent-list');
  const emptyState = document.getElementById('empty-state');

  // Map existing cards
  const existing = new Map();
  container.querySelectorAll('.torrent-card[data-info-hash]').forEach(el =>
    existing.set(el.dataset.infoHash, el)
  );

  // Remove stale cards
  existing.forEach((el, hash) => {
    if (!visibleList.some(t => t.infoHash === hash)) {
      el.style.animation = 'none';
      el.style.transition = 'opacity .2s, transform .2s';
      el.style.opacity = '0';
      el.style.transform = 'scale(0.97)';
      setTimeout(() => el.remove(), 200);
    }
  });

  // Update or insert
  visibleList.forEach((t, idx) => {
    const existingCard = existing.get(t.infoHash);
    if (existingCard) {
      updateCardInPlace(existingCard, t);
      if (container.children[idx] !== existingCard) {
        container.insertBefore(existingCard, container.children[idx] ?? null);
      }
    } else {
      const newCard = renderTorrent(t);
      newCard.style.animationDelay = `${idx * 40}ms`;
      container.insertBefore(newCard, container.children[idx] ?? null);
    }
  });

  // Empty state
  if (emptyState) emptyState.classList.toggle('show', visibleList.length === 0);
  updateEmptyStateContent(visibleList);

  // Active count badge (main header)
  const badge = document.getElementById('count-badge');
  const active = visibleList.filter(t => !t.done && !t.failed).length;
  if (badge) {
    badge.textContent = active;
    badge.style.display = active > 0 ? 'flex' : 'none';
  }

  updateSpeeds(latestTorrentList);
  updateBulkToolbar();
  syncFocusedCardAfterRender();
}

/* ═══════════════════════════════════════════════════════════════
   Sidebar speeds
════════════════════════════════════════════════════════════════ */
function updateSpeeds(list) {
  let totalDl = 0, totalUl = 0;
  list.forEach(t => {
    if (t.failed || t.done) return;
    totalDl += Number.isFinite(t.downloadSpeed) ? t.downloadSpeed : 0;
    totalUl += Number.isFinite(t.uploadSpeed)   ? t.uploadSpeed   : 0;
  });
  const dlEl = document.getElementById('total-dl-speed');
  const ulEl = document.getElementById('total-ul-speed');
  if (dlEl) dlEl.textContent = formatSpeed(totalDl);
  if (ulEl) ulEl.textContent = formatSpeed(totalUl);
}

/* ═══════════════════════════════════════════════════════════════
   API helpers
════════════════════════════════════════════════════════════════ */
async function fetchTorrents() {
  const res = await fetch(`${API}/torrents`);
  if (!res.ok) throw new Error('Failed to load torrents');
  return res.json();
}

async function poll() {
  try {
    renderList(await fetchTorrents());
  } catch (e) {
    console.error('[poll]', e);
  }
}

async function removeTorrent(infoHash) {
  const res = await fetch(`${API}/torrents/${encodeURIComponent(infoHash)}`, { method: 'DELETE' });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    showError(d.error || 'Failed to remove');
    return;
  }
  if (detailsOpenFor === infoHash) closeDetailsModal();
  showToast('Torrent removed', 'success');
  poll();
}


async function retryTorrent(infoHash) {
  try {
    const res = await fetch(`${API}/torrents/${encodeURIComponent(infoHash)}/retry`, { method: 'POST' });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'Failed to retry');
    showToast('Re-connecting to peers…', 'success');
    poll();
  } catch (err) {
    showError(err.message || 'Failed to retry torrent');
  }
}

async function stopSeeding(infoHash) {
  try {
    const res = await fetch(`${API}/torrents/${encodeURIComponent(infoHash)}/stop-seeding`, { method: 'POST' });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'Failed to stop seeding');
    showToast('Seeding stopped', 'success');
    poll();
  } catch (err) {
    showError(err.message || 'Failed to stop seeding');
  }
}

async function resumeSeeding(infoHash) {
  try {
    const res = await fetch(`${API}/torrents/${encodeURIComponent(infoHash)}/resume-seeding`, { method: 'POST' });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'Failed to resume seeding');
    showToast('Seeding resumed', 'success');
    poll();
  } catch (err) {
    showError(err.message || 'Failed to resume seeding');
  }
}

async function openInExplorer(infoHash) {
  try {
    const res = await fetch(`${API}/torrents/${encodeURIComponent(infoHash)}/open`, { method: 'POST' });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'Failed to open folder');
    showToast('Opened in file explorer', 'success');
  } catch (err) {
    showError(err.message || 'Failed to open folder');
  }
}

async function runBulkAction(targets, requestFn, successLabel) {
  if (!targets.length) return;

  const results = await Promise.allSettled(targets.map(t => requestFn(t.infoHash)));
  const ok = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.length - ok;

  if (ok > 0) {
    showToast(`${successLabel}: ${ok} torrent${ok === 1 ? '' : 's'}`, 'success');
  }
  if (failed > 0) {
    showError(`${failed} action${failed === 1 ? '' : 's'} failed`);
  }

  poll();
}

function requestStopSeeding(infoHash) {
  return fetch(`${API}/torrents/${encodeURIComponent(infoHash)}/stop-seeding`, { method: 'POST' })
    .then(async (res) => {
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to stop seeding');
      }
    });
}

function requestResumeSeeding(infoHash) {
  return fetch(`${API}/torrents/${encodeURIComponent(infoHash)}/resume-seeding`, { method: 'POST' })
    .then(async (res) => {
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to resume seeding');
      }
    });
}

function requestRetry(infoHash) {
  return fetch(`${API}/torrents/${encodeURIComponent(infoHash)}/retry`, { method: 'POST' })
    .then(async (res) => {
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to retry');
      }
    });
}

function requestRemove(infoHash) {
  return fetch(`${API}/torrents/${encodeURIComponent(infoHash)}`, { method: 'DELETE' })
    .then(async (res) => {
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to remove');
      }
    });
}

function initBulkActions() {
  document.getElementById('bulk-select-all-visible')?.addEventListener('click', selectAllVisible);
  document.getElementById('bulk-clear-selection')?.addEventListener('click', clearSelection);

  document.getElementById('bulk-stop-seeding')?.addEventListener('click', async () => {
    const targets = getSelectedTorrents().filter(t => !t.done && !t.failed);
    await runBulkAction(targets, requestStopSeeding, 'Stopped seeding');
  });

  document.getElementById('bulk-resume-seeding')?.addEventListener('click', async () => {
    const targets = getSelectedTorrents().filter(t => t.done && t.seeding === false);
    await runBulkAction(targets, requestResumeSeeding, 'Resumed seeding');
  });

  document.getElementById('bulk-retry-failed')?.addEventListener('click', async () => {
    const targets = getSelectedTorrents().filter(t => t.failed);
    await runBulkAction(targets, requestRetry, 'Retry started');
  });

  document.getElementById('bulk-remove')?.addEventListener('click', async () => {
    const targets = getSelectedTorrents();
    await runBulkAction(targets, requestRemove, 'Removed');
    clearSelection();
  });

  updateBulkToolbar();
}

/* ═══════════════════════════════════════════════════════════════
   Preview modal
════════════════════════════════════════════════════════════════ */
function buildDetailGrid(data) {
  const name   = data?.name   ?? 'Unknown';
  const length = Number.isFinite(data?.length) ? data.length : 0;
  return `
    <div class="detail-row">
      <span class="detail-label">Name</span>
      <span class="detail-value">${escapeHtml(name)}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Size</span>
      <span class="detail-value">${formatSize(length)}</span>
    </div>`;
}

function buildFilesTable(files, showProgress = false, selectable = false) {
  if (!files?.length) {
    return '<p style="padding:14px 16px;font-size:12.5px;color:var(--text-3)">No file list — metadata still loading.</p>';
  }
  const rows = files.map((f, i) => {
    const fPct = Number.isFinite(f?.progress) ? clamp(f.progress, 0, 100) : 0;
    return `<tr>
      ${selectable ? `<td class="file-check-cell"><input type="checkbox" class="file-check" data-idx="${i}" checked /></td>` : ''}
      <td class="file-name-cell">${escapeHtml(f?.name ?? '—')}</td>
      <td style="font-family:var(--mono);font-size:11.5px;color:var(--text-2);white-space:nowrap">${formatSize(f?.length ?? 0)}</td>
      ${showProgress ? `<td>
        <div class="mini-progress">
          <div class="mini-bar"><div class="mini-bar-fill" style="width:${fPct}%"></div></div>
          <span class="mini-pct">${fPct.toFixed(0)}%</span>
        </div>
      </td>` : ''}
    </tr>`;
  }).join('');
  const checkAllTh = selectable
    ? `<th class="file-check-cell"><input type="checkbox" id="check-all-files" checked title="Select / deselect all" /></th>`
    : '';
  return `<table>
    <thead><tr>
      ${checkAllTh}<th>File</th><th>Size</th>${showProgress ? '<th style="width:110px">Progress</th>' : ''}
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function openPreviewModal(data, onConfirm) {
  document.getElementById('preview-summary').innerHTML = buildDetailGrid(data);
  document.getElementById('preview-files').innerHTML   = buildFilesTable(Array.isArray(data?.files) ? data.files : [], false, true);
  window.__previewConfirm = onConfirm;
  document.getElementById('preview-modal').classList.add('is-open');
  document.body.style.overflow = 'hidden';
}

function closePreviewModal() {
  document.getElementById('preview-modal').classList.remove('is-open');
  document.body.style.overflow = '';
  window.__previewConfirm = null;
}

async function confirmPreview() {
  const fn = window.__previewConfirm;
  if (!fn) return;
  const checkboxes = [...document.querySelectorAll('#preview-files .file-check')];
  const selectedFiles = checkboxes.length
    ? checkboxes.reduce((acc, cb, i) => { if (cb.checked) acc.push(i); return acc; }, [])
    : null;
  closePreviewModal();
  try {
    await fn(selectedFiles);
    showToast('Torrent added — connecting to peers…', 'success');
    // Close the add modal
    document.getElementById('add-modal')?.classList.remove('is-open');
    document.body.style.overflow = '';
    poll();
    // Open details for latest torrent
    const list = await fetchTorrents();
    const added = list[list.length - 1];
    if (added?.infoHash) setTimeout(() => openDetails(added.infoHash), 600);
  } catch (err) {
    showError(err.message || 'Failed to add torrent');
  }
}

/* ═══════════════════════════════════════════════════════════════
   Add torrent API calls
════════════════════════════════════════════════════════════════ */
async function fetchPreviewMagnet(magnet) {
  const res = await fetch(`${API}/torrents/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ magnet: magnet.trim() }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || 'Failed to fetch metadata');
  return d;
}

async function fetchPreviewFile(file) {
  const form = new FormData();
  form.append('torrent', file);
  const res = await fetch(`${API}/torrents/preview/file`, { method: 'POST', body: form });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || 'Failed to read .torrent file');
  return d;
}

async function addMagnet(magnet, selectedFiles) {
  const res = await fetch(`${API}/torrents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ magnet: magnet.trim(), selectedFiles: selectedFiles ?? null }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || 'Failed to add torrent');
}

async function addFile(file, selectedFiles) {
  const form = new FormData();
  form.append('torrent', file);
  if (selectedFiles) form.append('selectedFiles', JSON.stringify(selectedFiles));
  const res = await fetch(`${API}/torrents/file`, { method: 'POST', body: form });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || 'Failed to add torrent');
}

/* ═══════════════════════════════════════════════════════════════
   Details modal
════════════════════════════════════════════════════════════════ */
let detailsOpenFor      = null;
let detailsRefreshTimer = null;

async function openDetails(infoHash) {
  if (detailsRefreshTimer) { clearInterval(detailsRefreshTimer); detailsRefreshTimer = null; }
  try {
    const t = await fetch(`${API}/torrents/${encodeURIComponent(infoHash)}`).then(r => r.json());
    detailsOpenFor = infoHash;
    populateDetails(t);
    document.getElementById('details-modal').classList.add('is-open');
    document.body.style.overflow = 'hidden';
    detailsRefreshTimer = setInterval(async () => {
      if (detailsOpenFor !== infoHash) return;
      try { populateDetails(await fetch(`${API}/torrents/${encodeURIComponent(infoHash)}`).then(r => r.json())); }
      catch { closeDetailsModal(); }
    }, 2000);
  } catch (err) {
    showError(err.message || 'Could not load details');
  }
}

function populateDetails(t) {
  const progress = clamp(Number.isFinite(t?.progress) ? t.progress : 0, 0, 100);
  document.getElementById('details-summary').innerHTML = `
    <div class="detail-row">
      <span class="detail-label">Name</span>
      <span class="detail-value" style="font-family:var(--font)">${escapeHtml(t?.name ?? 'Unknown')}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Hash</span>
      <span class="detail-value" style="font-size:11.5px;word-break:break-all">${escapeHtml(t?.infoHash ?? '—')}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Size</span>
      <span class="detail-value">${formatSize(t?.length ?? 0)}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Done</span>
      <span class="detail-value">${formatSize(t?.downloaded ?? 0)} (${progress.toFixed(2)}%)</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Down</span>
      <span class="detail-value">${formatSpeed(t?.downloadSpeed ?? 0)}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Up</span>
      <span class="detail-value">${formatSpeed(t?.uploadSpeed ?? 0)}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Peers</span>
      <span class="detail-value">${t?.numPeers ?? 0}</span>
    </div>`;
  document.getElementById('details-files').innerHTML = buildFilesTable(Array.isArray(t?.files) ? t.files : [], true);
}

function closeDetailsModal() {
  document.getElementById('details-modal').classList.remove('is-open');
  document.body.style.overflow = '';
  detailsOpenFor = null;
  if (detailsRefreshTimer) { clearInterval(detailsRefreshTimer); detailsRefreshTimer = null; }
}

/* ═══════════════════════════════════════════════════════════════
   Modal init
════════════════════════════════════════════════════════════════ */
function initModals() {
  const previewModal = document.getElementById('preview-modal');
  previewModal.querySelector('.modal-scrim').addEventListener('click', closePreviewModal);
  previewModal.querySelector('.preview-modal-close').addEventListener('click', closePreviewModal);
  previewModal.querySelector('.preview-cancel').addEventListener('click', closePreviewModal);
  previewModal.querySelector('.preview-add').addEventListener('click', () => confirmPreview());
  previewModal.addEventListener('keydown', e => { if (e.key === 'Escape') closePreviewModal(); });

  // File selection checkboxes (delegated — table is rendered dynamically)
  previewModal.addEventListener('change', e => {
    if (e.target.id === 'check-all-files') {
      const checked = e.target.checked;
      document.querySelectorAll('#preview-files .file-check').forEach(cb => {
        cb.checked = checked;
        cb.closest('tr').classList.toggle('deselected', !checked);
      });
    } else if (e.target.classList.contains('file-check')) {
      e.target.closest('tr').classList.toggle('deselected', !e.target.checked);
      const all = [...document.querySelectorAll('#preview-files .file-check')];
      const checkAll = document.getElementById('check-all-files');
      if (checkAll) checkAll.indeterminate = all.some(c => c.checked) && !all.every(c => c.checked);
      if (checkAll) checkAll.checked = all.every(c => c.checked);
    }
  });

  const detailsModal = document.getElementById('details-modal');
  detailsModal.querySelector('.modal-scrim').addEventListener('click', closeDetailsModal);
  detailsModal.querySelector('.modal-close').addEventListener('click', closeDetailsModal);
  detailsModal.addEventListener('keydown', e => { if (e.key === 'Escape') closeDetailsModal(); });
}

/* ═══════════════════════════════════════════════════════════════
   Preview loading state
════════════════════════════════════════════════════════════════ */
function setPreviewLoading(panel, loading) {
  const loader = document.getElementById(`preview-loader-${panel}`);
  const btn    = document.getElementById(`btn-add-${panel}`);
  if (loader) loader.classList.toggle('hidden', !loading);
  if (btn) {
    btn.disabled = loading;
    if (loading) {
      btn.innerHTML = `<div class="loader-dots" style="margin-right:6px"><span></span><span></span><span></span></div> Loading…`;
    } else {
      btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Add Torrent`;
    }
  }
}

/* ═══════════════════════════════════════════════════════════════
   Form handlers
════════════════════════════════════════════════════════════════ */
document.getElementById('form-magnet').addEventListener('submit', async e => {
  e.preventDefault();
  const ta     = document.getElementById('magnet');
  const magnet = ta.value.trim();
  if (!magnet) { showError('Paste a magnet link first'); return; }

  setPreviewLoading('magnet', true);
  try {
    const data = await fetchPreviewMagnet(magnet);
    setPreviewLoading('magnet', false);
    openPreviewModal(data, async (sel) => { await addMagnet(magnet, sel); ta.value = ''; });
  } catch (err) {
    setPreviewLoading('magnet', false);
    // Timeout: offer to add anyway
    if (err.message.includes('timeout') || err.message.includes('Timeout')) {
      openPreviewModal({ name: 'Unknown (metadata timeout)', length: 0, files: [] },
        async (sel) => { await addMagnet(magnet, sel); ta.value = ''; });
    } else {
      showError(err.message || 'Failed to get preview');
    }
  }
});

document.getElementById('form-file').addEventListener('submit', async e => {
  e.preventDefault();
  const input = e.target.querySelector('input[type="file"]');
  const file  = input.files?.[0];
  if (!file) { showError('Choose a .torrent file first'); return; }

  setPreviewLoading('file', true);
  try {
    const data = await fetchPreviewFile(file);
    setPreviewLoading('file', false);
    openPreviewModal(data, async (sel) => {
      await addFile(file, sel);
      input.value = '';
      document.getElementById('file-drop-title').textContent = 'Drop .torrent file here';
    });
  } catch (err) {
    setPreviewLoading('file', false);
    showError(err.message || 'Failed to read file');
  }
});

// File input label
document.querySelector('#form-file input[type="file"]')?.addEventListener('change', function () {
  const titleEl = document.getElementById('file-drop-title');
  if (titleEl) titleEl.textContent = this.files?.[0]?.name || 'Drop .torrent file here';
});

// Drag-over styling for file drop zone
const dropZone = document.getElementById('file-drop-zone');
if (dropZone) {
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', () => dropZone.classList.remove('drag-over'));
}

/* ═══════════════════════════════════════════════════════════════
   Theme
════════════════════════════════════════════════════════════════ */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('theme', theme);
  const label = document.getElementById('theme-label');
  const sun   = document.getElementById('icon-sun');
  const moon  = document.getElementById('icon-moon');
  if (label) label.textContent = theme === 'dark' ? 'Light mode' : 'Dark mode';
  if (sun)  sun.style.display  = theme === 'dark'  ? '' : 'none';
  if (moon) moon.style.display = theme === 'light' ? '' : 'none';
}

document.getElementById('theme-toggle')?.addEventListener('click', () => {
  const cur = document.documentElement.dataset.theme || 'dark';
  applyTheme(cur === 'dark' ? 'light' : 'dark');
});

/* ═══════════════════════════════════════════════════════════════
   Downloads folder
════════════════════════════════════════════════════════════════ */
function setDirDisplay(dir) {
  const el = document.getElementById('download-dir-display');
  if (el) el.textContent = dir;
}

let _browserParent = null;

async function loadBrowserDir(dir) {
  const list    = document.getElementById('browser-list');
  const pathEl  = document.getElementById('browser-current-path');
  const upBtn   = document.getElementById('browser-up');
  if (!list) return;

  list.innerHTML = '<div class="browser-loading">Loading…</div>';

  try {
    const res = await fetch(`${API}/fs/browse?dir=${encodeURIComponent(dir)}`);
    const d   = await res.json();
    if (!res.ok) throw new Error(d.error || 'Cannot open folder');

    _browserParent = d.parent !== d.dir ? d.parent : null;
    if (pathEl) pathEl.textContent = d.dir;
    if (upBtn)  upBtn.disabled = (d.parent === d.dir);

    // Update input to reflect browsed dir
    const input = document.getElementById('folder-input');
    if (input) input.value = d.dir;

    if (!d.entries.length) {
      list.innerHTML = '<div class="browser-empty">No subfolders here</div>';
      return;
    }

    const folderIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
    list.innerHTML = d.entries.map(name =>
      `<div class="browser-entry" data-path="${escapeHtml(d.dir + '/' + name)}">${folderIcon}<span>${escapeHtml(name)}</span></div>`
    ).join('');

    list.querySelectorAll('.browser-entry').forEach(el => {
      el.addEventListener('click', () => loadBrowserDir(el.dataset.path));
    });
  } catch (err) {
    list.innerHTML = `<div class="browser-error">${escapeHtml(err.message)}</div>`;
  }
}

function openFolderModal() {
  fetch(`${API}/config`).then(r => r.json()).then(cfg => {
    const dir   = cfg.downloadDir || '';
    const input = document.getElementById('folder-input');
    if (input) input.value = dir;
    setDirDisplay(dir || './downloads');
    loadBrowserDir(dir);
  }).catch(() => {});
  document.getElementById('folder-modal').classList.add('is-open');
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('folder-input')?.select(), 50);
}

function closeFolderModal() {
  document.getElementById('folder-modal').classList.remove('is-open');
  document.body.style.overflow = '';
}

document.getElementById('btn-change-folder')?.addEventListener('click', openFolderModal);
document.getElementById('browser-up')?.addEventListener('click', () => { if (_browserParent) loadBrowserDir(_browserParent); });
document.getElementById('folder-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); loadBrowserDir(e.target.value.trim()); } });
document.querySelectorAll('.folder-modal-close').forEach(b => b.addEventListener('click', closeFolderModal));
document.querySelector('.folder-modal-scrim')?.addEventListener('click', closeFolderModal);
document.getElementById('folder-modal')?.addEventListener('keydown', e => { if (e.key === 'Escape') closeFolderModal(); });

document.getElementById('btn-save-folder')?.addEventListener('click', async () => {
  const input = document.getElementById('folder-input');
  const dir = input?.value?.trim();
  if (!dir) { showError('Enter a folder path'); return; }
  const btn = document.getElementById('btn-save-folder');
  btn.disabled = true;
  try {
    const res = await fetch(`${API}/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ downloadDir: dir }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'Failed to update folder');
    setDirDisplay(d.downloadDir);
    closeFolderModal();
    showToast('Downloads folder updated', 'success');
  } catch (err) {
    showError(err.message || 'Failed to update folder');
  } finally {
    btn.disabled = false;
  }
});

/* ═══════════════════════════════════════════════════════════════
   Test Torrents
════════════════════════════════════════════════════════════════ */
document.getElementById('btn-test-torrents')?.addEventListener('click', async function () {
  if (this.disabled) return;
  this.disabled = true;
  const originalText = this.innerHTML;
  this.innerHTML = '<div class="loader-dots" style="margin-right:6px"><span></span><span></span><span></span></div>Adding…';

  try {
    const listRes = await fetch(`${API}/test-torrents`);
    if (!listRes.ok) throw new Error(`Failed to get test torrents list: ${listRes.status}`);
    const listData = await listRes.json();
    const files = Array.isArray(listData.files) ? listData.files : [];
    if (!files.length) throw new Error('No test torrents found');

    let added = 0;
    const errors = [];

    for (const fileInfo of files) {
      try {
        const response = await fetch(fileInfo.url);
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

        const blob = await response.blob();
        const file = new File([blob], fileInfo.name, { type: 'application/x-bittorrent' });

        const previewData = await fetchPreviewFile(file);

        await addFile(file, previewData.files.map(f => f.path));
        added++;
      } catch (err) {
        errors.push(`${fileInfo.name}: ${err.message}`);
      }
    }

    if (added > 0) {
      showToast(`Added ${added} test torrent${added === 1 ? '' : 's'}`, 'success');
    }
    if (errors.length > 0) {
      if (added === 0) {
        showError('Failed to add any test torrents');
      } else {
        showError(`${errors.length} test torrent${errors.length === 1 ? '' : 's'} failed`);
      }
    }
  } catch (err) {
    showError(err.message || 'Failed to add test torrents');
  } finally {
    this.disabled = false;
    this.innerHTML = originalText;
  }
});

/* ═══════════════════════════════════════════════════════════════
   Keyboard shortcuts
════════════════════════════════════════════════════════════════ */
function isTypingContext() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function isAnyModalOpen() {
  return !!document.querySelector('.modal.is-open');
}

function syncFocusedCardAfterRender() {
  document.querySelectorAll('.torrent-card.is-keyboard-focused').forEach(c => c.classList.remove('is-keyboard-focused'));
  if (focusedCardIndex >= latestVisibleList.length) focusedCardIndex = latestVisibleList.length - 1;
  if (focusedCardIndex >= 0 && focusedCardIndex < latestVisibleList.length) {
    const t = latestVisibleList[focusedCardIndex];
    const card = document.querySelector(`.torrent-card[data-info-hash="${t.infoHash}"]`);
    if (card) card.classList.add('is-keyboard-focused');
  }
}

function setFocusedCard(index) {
  document.querySelectorAll('.torrent-card.is-keyboard-focused').forEach(c => c.classList.remove('is-keyboard-focused'));
  focusedCardIndex = index;
  if (index >= 0 && index < latestVisibleList.length) {
    const t = latestVisibleList[index];
    const card = document.querySelector(`.torrent-card[data-info-hash="${t.infoHash}"]`);
    if (card) {
      card.classList.add('is-keyboard-focused');
      card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
}

function moveFocus(delta) {
  if (!latestVisibleList.length) return -1;
  let newIndex;
  if (focusedCardIndex < 0) {
    newIndex = delta > 0 ? 0 : latestVisibleList.length - 1;
  } else {
    newIndex = Math.max(0, Math.min(latestVisibleList.length - 1, focusedCardIndex + delta));
  }
  setFocusedCard(newIndex);
  return newIndex;
}

function openShortcutsPanel() {
  document.getElementById('shortcuts-modal')?.classList.add('is-open');
  document.body.style.overflow = 'hidden';
}

function closeShortcutsPanel() {
  document.getElementById('shortcuts-modal')?.classList.remove('is-open');
  document.body.style.overflow = '';
}

function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    const shortcutsOpen = document.getElementById('shortcuts-modal')?.classList.contains('is-open');

    if (e.key === 'Escape') {
      if (shortcutsOpen) { closeShortcutsPanel(); return; }
      if (isAnyModalOpen()) return;
      if (selectedInfoHashes.size > 0) { clearSelection(); return; }
      if (focusedCardIndex >= 0) { setFocusedCard(-1); return; }
      return;
    }

    if (shortcutsOpen) return;
    if (isAnyModalOpen()) return;
    if (isTypingContext()) return;

    const modKey = e.metaKey || e.ctrlKey;

    if (modKey && e.key === 'a') {
      e.preventDefault();
      selectAllVisible();
      return;
    }

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      const newIndex = moveFocus(delta);
      if (e.shiftKey && newIndex >= 0) {
        const t = latestVisibleList[newIndex];
        if (t) {
          selectedInfoHashes.add(t.infoHash);
          const card = document.querySelector(`.torrent-card[data-info-hash="${t.infoHash}"]`);
          if (card) syncCardSelectionState(card, t.infoHash);
          updateBulkToolbar();
        }
      }
      return;
    }

    if (e.key === '?') {
      e.preventDefault();
      openShortcutsPanel();
      return;
    }
  });

  document.getElementById('btn-shortcuts')?.addEventListener('click', openShortcutsPanel);
  const sm = document.getElementById('shortcuts-modal');
  sm?.querySelector('.modal-scrim')?.addEventListener('click', closeShortcutsPanel);
  sm?.querySelector('.shortcuts-close')?.addEventListener('click', closeShortcutsPanel);
}

/* ═══════════════════════════════════════════════════════════════
   Boot
════════════════════════════════════════════════════════════════ */
applyTheme(localStorage.getItem('theme') || 'dark');
initModals();
initFolderFilters();
initEmptyStateButtonBehavior();
initBulkActions();
initKeyboardShortcuts();
fetch(`${API}/config`).then(r => r.json()).then(cfg => setDirDisplay(cfg.downloadDir || './downloads')).catch(() => {});
poll();
setInterval(poll, 2500);
