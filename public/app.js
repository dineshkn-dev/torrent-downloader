const API = '/api';

// Client-side pause state tracking
// The PATCH API persists pause on the server; we track display state locally.
const pausedSet = new Set();

// Pause/play icon SVG strings
const pauseIconSvg = `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>`;
const playIconSvg  = `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;

/* ─── Toast notifications ───────────────────────────── */
function showToast(msg, type = 'error') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const icons = {
    error:   `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    success: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    info:    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
  };

  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${icons[type] || icons.info}<span>${escapeHtml(msg)}</span>`;
  container.appendChild(el);

  setTimeout(() => {
    el.style.animation = 'toastOut 0.25s var(--ease) both';
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, 4000);

  console[type === 'error' ? 'error' : 'log']('[toast]', msg);
}

// Backward-compat alias — all existing showError() calls continue to work
function showError(msg) { showToast(msg, 'error'); }

/* ─── Formatters ────────────────────────────────────── */
function formatSpeed(bytesPerSec) {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '—';
  const units = ['B/s', 'KB/s', 'MB/s'];
  let i = 0, v = bytesPerSec;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ─── Render torrent card ───────────────────────────── */
function renderTorrent(t) {
  const progress = Number.isFinite(t?.progress)      ? t.progress      : 0;
  const dlSpeed  = Number.isFinite(t?.downloadSpeed) ? t.downloadSpeed : 0;
  const ulSpeed  = Number.isFinite(t?.uploadSpeed)   ? t.uploadSpeed   : 0;
  const numPeers = Number.isFinite(t?.numPeers)      ? t.numPeers      : 0;
  const length   = Number.isFinite(t?.length)        ? t.length        : 0;
  const isDone   = !!t?.done;
  const isPaused = pausedSet.has(t?.infoHash || '');

  const card = document.createElement('div');
  card.className = 'torrent-card' + (isDone ? ' done' : '');
  card.dataset.infoHash = t?.infoHash || '';
  card.dataset.paused   = isPaused ? 'true' : 'false';

  const badgeClass = isDone ? 'done' : (isPaused ? 'paused' : 'downloading');
  const badgeLabel = isDone ? 'Complete' : (isPaused ? 'Paused' : 'Downloading');

  card.innerHTML = `
    <div class="card-top">
      <div class="torrent-name">${escapeHtml(t?.name || 'Unknown')}</div>
      <span class="card-badge ${badgeClass}">${badgeLabel}</span>
    </div>
    <div class="progress-row">
      <div class="progress-track">
        <div class="progress-fill" style="width:${progress}%"></div>
      </div>
      <span class="progress-pct">${progress.toFixed(1)}%</span>
    </div>
    <div class="torrent-stats">
      <span class="stat stat-speed-down">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="7 10 12 15 17 10"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        <span class="stat-val">${formatSpeed(dlSpeed)}</span>
      </span>
      <span class="stat stat-speed-up">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 14 12 9 7 14"/><line x1="12" y1="21" x2="12" y2="9"/></svg>
        <span class="stat-val">${formatSpeed(ulSpeed)}</span>
      </span>
      <span class="stat stat-peers">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        ${numPeers} peers
      </span>
      <span class="stat">${formatSize(length)}</span>
    </div>
    <div class="card-actions">
      <div class="card-actions-normal">
        ${!isDone ? `<button type="button" class="btn-pause" title="${isPaused ? 'Resume' : 'Pause'}">${isPaused ? playIconSvg : pauseIconSvg}</button>` : ''}
        <button type="button" class="btn btn-ghost btn-sm btn-details-open">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          Details
        </button>
        <button type="button" class="btn-danger-sm btn-remove">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          Remove
        </button>
      </div>
      <div class="confirm-remove-row">
        <span class="confirm-remove-label">Remove this torrent?</span>
        <button type="button" class="btn-cancel-remove">Cancel</button>
        <button type="button" class="btn-confirm-remove">Remove</button>
      </div>
    </div>
  `;

  // Pause/resume
  const pauseBtn = card.querySelector('.btn-pause');
  if (pauseBtn) {
    pauseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePause(t.infoHash);
    });
  }

  // Remove → show inline confirm
  card.querySelector('.btn-remove').addEventListener('click', (e) => {
    e.stopPropagation();
    card.classList.add('confirming-remove');
  });

  // Cancel confirm
  card.querySelector('.btn-cancel-remove').addEventListener('click', (e) => {
    e.stopPropagation();
    card.classList.remove('confirming-remove');
  });

  // Confirm remove
  card.querySelector('.btn-confirm-remove').addEventListener('click', (e) => {
    e.stopPropagation();
    card.classList.remove('confirming-remove');
    removeTorrent(t.infoHash);
  });

  // Details
  card.querySelector('.btn-details-open').addEventListener('click', (e) => {
    e.stopPropagation();
    openDetails(t.infoHash);
  });

  return card;
}

/* ─── In-place card update (no DOM recreation) ──────── */
function updateCardInPlace(card, t) {
  const progress = Number.isFinite(t?.progress)      ? t.progress      : 0;
  const dlSpeed  = Number.isFinite(t?.downloadSpeed) ? t.downloadSpeed : 0;
  const ulSpeed  = Number.isFinite(t?.uploadSpeed)   ? t.uploadSpeed   : 0;
  const numPeers = Number.isFinite(t?.numPeers)      ? t.numPeers      : 0;
  const isDone   = !!t?.done;
  const isPaused = pausedSet.has(t?.infoHash || '');

  // Card-level classes + data attribute
  card.classList.toggle('done', isDone);
  card.dataset.paused = isPaused ? 'true' : 'false';

  // Progress bar
  const fill = card.querySelector('.progress-fill');
  if (fill) fill.style.width = `${progress}%`;

  // Progress text
  const pct = card.querySelector('.progress-pct');
  if (pct) pct.textContent = `${progress.toFixed(1)}%`;

  // Badge (don't overwrite if in confirming state — minor edge case)
  if (!card.classList.contains('confirming-remove')) {
    const badge = card.querySelector('.card-badge');
    if (badge && !isPaused) {
      badge.className = 'card-badge ' + (isDone ? 'done' : 'downloading');
      badge.textContent = isDone ? 'Complete' : 'Downloading';
    }
  }

  // Stats (targets .stat-val span inside each stat)
  const dlVal = card.querySelector('.stat-speed-down .stat-val');
  if (dlVal) dlVal.textContent = formatSpeed(dlSpeed);

  const ulVal = card.querySelector('.stat-speed-up .stat-val');
  if (ulVal) ulVal.textContent = formatSpeed(ulSpeed);

  const peersEl = card.querySelector('.stat-peers');
  if (peersEl) {
    // Update just the text node, keeping the SVG
    const textNodes = [...peersEl.childNodes].filter(n => n.nodeType === Node.TEXT_NODE);
    if (textNodes.length) {
      textNodes[0].textContent = ` ${numPeers} peers`;
    } else {
      peersEl.lastChild.textContent = `${numPeers} peers`;
    }
  }
}

/* ─── Fetch ─────────────────────────────────────────── */
async function fetchTorrents() {
  const res = await fetch(`${API}/torrents`);
  if (!res.ok) throw new Error('Failed to load torrents');
  return res.json();
}

/* ─── Render list (DOM diffing — no innerHTML reset) ── */
function renderList(list) {
  const container  = document.getElementById('torrent-list');
  const emptyState = document.getElementById('empty-state');

  // Map of existing cards by infoHash
  const existing = new Map();
  container.querySelectorAll('.torrent-card[data-info-hash]').forEach(
    el => existing.set(el.dataset.infoHash, el)
  );

  // Remove cards no longer in the list
  existing.forEach((el, hash) => {
    if (!list.some(t => t.infoHash === hash)) el.remove();
  });

  // Update or insert cards in server order
  list.forEach((t, idx) => {
    const existingCard = existing.get(t.infoHash);
    if (existingCard) {
      updateCardInPlace(existingCard, t);
      // Keep order consistent
      if (container.children[idx] !== existingCard) {
        container.insertBefore(existingCard, container.children[idx] || null);
      }
    } else {
      const newCard = renderTorrent(t);
      container.insertBefore(newCard, container.children[idx] || null);
    }
  });

  // Empty state — only .show, never .hidden (fix bug)
  if (emptyState) {
    emptyState.classList.toggle('show', list.length === 0);
  }

  // Active-download badge in nav
  const badge = document.getElementById('count-badge');
  if (badge) {
    const active = list.filter(t => !t.done).length;
    badge.textContent = active;
    badge.style.display = active > 0 ? 'flex' : 'none';
  }

  // Sidebar total speeds
  updateSidebarSpeeds(list);
}

/* ─── Sidebar speeds ────────────────────────────────── */
function updateSidebarSpeeds(list) {
  const dlEl = document.getElementById('total-dl-speed');
  const ulEl = document.getElementById('total-ul-speed');
  if (!dlEl || !ulEl) return;

  let totalDl = 0, totalUl = 0;
  list.forEach(t => {
    if (!t.done && !pausedSet.has(t.infoHash)) {
      totalDl += (Number.isFinite(t.downloadSpeed) ? t.downloadSpeed : 0);
    }
    totalUl += (Number.isFinite(t.uploadSpeed) ? t.uploadSpeed : 0);
  });

  dlEl.textContent = formatSpeed(totalDl);
  ulEl.textContent = formatSpeed(totalUl);
}

/* ─── Poll ──────────────────────────────────────────── */
async function poll() {
  try {
    const list = await fetchTorrents();
    renderList(list);
  } catch (e) {
    console.error('[poll]', e);
    showError(e.message || 'Could not refresh list');
  }
}

/* ─── Preview API ───────────────────────────────────── */
async function fetchPreview(magnet) {
  const res = await fetch(`${API}/torrents/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ magnet: magnet.trim() }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to get preview');
  return data;
}

async function fetchPreviewFile(file) {
  const form = new FormData();
  form.append('torrent', file);
  const res = await fetch(`${API}/torrents/preview/file`, {
    method: 'POST',
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to get preview');
  return data;
}

/* ─── Preview modal ─────────────────────────────────── */
function buildMetaGrid(data) {
  const name   = data?.name   || 'Unknown';
  const length = Number.isFinite(data?.length) ? data.length : 0;
  return `
    <div class="detail-row">
      <span class="detail-label">Name</span>
      <span class="detail-value">${escapeHtml(name)}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Size</span>
      <span class="detail-value">${formatSize(length)}</span>
    </div>
  `;
}

function buildFilesTable(files, showProgress = false) {
  if (!files || files.length === 0) {
    return '<p style="color:var(--text-3);font-size:0.85rem;padding:0.75rem">No file list yet — metadata still loading.</p>';
  }
  const cols = showProgress
    ? '<th>File</th><th>Size</th><th>Progress</th>'
    : '<th>File</th><th>Size</th>';
  const rows = files.map((f) => {
    const fPct = Number.isFinite(f?.progress) ? f.progress : 0;
    return `<tr>
      <td class="file-name">${escapeHtml(f?.name || '—')}</td>
      <td>${formatSize(f?.length ?? 0)}</td>
      ${showProgress ? `<td>${fPct.toFixed(1)}%</td>` : ''}
    </tr>`;
  }).join('');
  return `<table><thead><tr>${cols}</tr></thead><tbody>${rows}</tbody></table>`;
}

function showPreviewModal(data, onConfirm) {
  document.getElementById('preview-summary').innerHTML = buildMetaGrid(data);
  document.getElementById('preview-files').innerHTML   = buildFilesTable(Array.isArray(data?.files) ? data.files : []);
  window.__previewOnConfirm = onConfirm;
  document.getElementById('preview-modal').classList.add('is-open');
  document.body.style.overflow = 'hidden';
}

function closePreviewModal() {
  document.getElementById('preview-modal').classList.remove('is-open');
  document.body.style.overflow = '';
  window.__previewOnConfirm = null;
}

async function confirmAddFromPreview() {
  const fn = window.__previewOnConfirm;
  if (!fn) return;
  closePreviewModal();
  try {
    await fn();
    showToast('Torrent added successfully', 'success');
    poll();
    const list = await fetchTorrents();
    const added = list[list.length - 1];
    if (added?.infoHash) openDetails(added.infoHash);
  } catch (err) {
    console.error('[preview confirm]', err);
    showError(err.message || 'Failed to add torrent');
  }
}

/* ─── Add torrent ───────────────────────────────────── */
async function addMagnet(magnet) {
  const res = await fetch(`${API}/torrents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ magnet: magnet.trim() }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to add torrent');
}

async function addFile(file) {
  const form = new FormData();
  form.append('torrent', file);
  const res = await fetch(`${API}/torrents/file`, { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to add torrent');
}

/* ─── Remove torrent (no window.confirm) ────────────── */
async function removeTorrent(infoHash) {
  const res = await fetch(`${API}/torrents/${encodeURIComponent(infoHash)}`, { method: 'DELETE' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    showError(data.error || 'Failed to remove');
    return;
  }
  pausedSet.delete(infoHash);
  if (detailsModalOpenFor === infoHash) closeModal();
  showToast('Torrent removed', 'success');
  poll();
}

/* ─── Pause / resume ────────────────────────────────── */
async function togglePause(infoHash) {
  const currentlyPaused = pausedSet.has(infoHash);
  const newPausedState  = !currentlyPaused;

  try {
    const res = await fetch(`${API}/torrents/${encodeURIComponent(infoHash)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pause: newPausedState }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showToast(data.error || 'Failed to pause/resume', 'error');
      return;
    }

    if (newPausedState) { pausedSet.add(infoHash); }
    else                { pausedSet.delete(infoHash); }

    // Update card in-place immediately
    const card = document.querySelector(`.torrent-card[data-info-hash="${infoHash}"]`);
    if (card) {
      card.dataset.paused = newPausedState ? 'true' : 'false';

      const badge = card.querySelector('.card-badge');
      if (badge) {
        badge.className  = 'card-badge ' + (newPausedState ? 'paused' : 'downloading');
        badge.textContent = newPausedState ? 'Paused' : 'Downloading';
      }

      const pauseBtn = card.querySelector('.btn-pause');
      if (pauseBtn) {
        pauseBtn.innerHTML = newPausedState ? playIconSvg : pauseIconSvg;
        pauseBtn.title     = newPausedState ? 'Resume' : 'Pause';
      }
    }

    showToast(newPausedState ? 'Torrent paused' : 'Torrent resumed', 'success');
  } catch (err) {
    showError(err.message || 'Failed to pause/resume');
  }
}

/* ─── Details modal ─────────────────────────────────── */
let detailsModalOpenFor      = null;
let detailsModalRefreshTimer = null;

async function fetchTorrentDetails(infoHash) {
  const res = await fetch(`${API}/torrents/${encodeURIComponent(infoHash)}`);
  if (!res.ok) throw new Error('Torrent not found');
  return res.json();
}

function populateDetailsModal(t) {
  const progress = Number.isFinite(t?.progress)      ? t.progress      : 0;
  const dlSpeed  = Number.isFinite(t?.downloadSpeed) ? t.downloadSpeed : 0;
  const ulSpeed  = Number.isFinite(t?.uploadSpeed)   ? t.uploadSpeed   : 0;
  const numPeers = Number.isFinite(t?.numPeers)      ? t.numPeers      : 0;
  const length   = Number.isFinite(t?.length)        ? t.length        : 0;

  document.getElementById('details-summary').innerHTML = `
    <div class="detail-row"><span class="detail-label">Name</span><span class="detail-value">${escapeHtml(t?.name || 'Unknown')}</span></div>
    <div class="detail-row"><span class="detail-label">Hash</span><span class="detail-value">${escapeHtml(t?.infoHash || '')}</span></div>
    <div class="detail-row"><span class="detail-label">Size</span><span class="detail-value">${formatSize(length)}</span></div>
    <div class="detail-row"><span class="detail-label">Progress</span><span class="detail-value">${progress.toFixed(1)}%</span></div>
    <div class="detail-row"><span class="detail-label">Download</span><span class="detail-value">${formatSpeed(dlSpeed)}</span></div>
    <div class="detail-row"><span class="detail-label">Upload</span><span class="detail-value">${formatSpeed(ulSpeed)}</span></div>
    <div class="detail-row"><span class="detail-label">Peers</span><span class="detail-value">${numPeers}</span></div>
  `;
  document.getElementById('details-files').innerHTML = buildFilesTable(Array.isArray(t?.files) ? t.files : [], true);
}

function openModal() {
  document.getElementById('details-modal').classList.add('is-open');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('details-modal').classList.remove('is-open');
  document.body.style.overflow = '';
  detailsModalOpenFor = null;
  if (detailsModalRefreshTimer) {
    clearInterval(detailsModalRefreshTimer);
    detailsModalRefreshTimer = null;
  }
}

async function openDetails(infoHash) {
  if (detailsModalRefreshTimer) {
    clearInterval(detailsModalRefreshTimer);
    detailsModalRefreshTimer = null;
  }
  try {
    const t = await fetchTorrentDetails(infoHash);
    detailsModalOpenFor = infoHash;
    populateDetailsModal(t);
    openModal();
    detailsModalRefreshTimer = setInterval(async () => {
      if (detailsModalOpenFor !== infoHash) return;
      try {
        populateDetailsModal(await fetchTorrentDetails(infoHash));
      } catch (_) {
        closeModal();
      }
    }, 2000);
  } catch (err) {
    console.error('[openDetails]', err);
    showError(err.message || 'Could not load torrent details');
  }
}

/* ─── Modal init ────────────────────────────────────── */
function initModal() {
  const modal = document.getElementById('details-modal');
  modal.querySelector('.modal-backdrop').addEventListener('click', closeModal);
  modal.querySelector('.modal-close').addEventListener('click', closeModal);
  modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
}

function initPreviewModal() {
  const modal = document.getElementById('preview-modal');
  modal.querySelector('.modal-backdrop').addEventListener('click', closePreviewModal);
  modal.querySelector('.preview-modal-close').addEventListener('click', closePreviewModal);
  modal.querySelector('.preview-cancel').addEventListener('click', closePreviewModal);
  modal.querySelector('.preview-add').addEventListener('click', () => confirmAddFromPreview());
  modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePreviewModal(); });
}

/* ─── Theme toggle ──────────────────────────────────── */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('theme', theme);
  const label = document.getElementById('theme-label');
  const sun   = document.getElementById('icon-sun');
  const moon  = document.getElementById('icon-moon');
  if (label) label.textContent = theme === 'dark' ? 'Light mode' : 'Dark mode';
  if (sun)   sun.style.display  = theme === 'dark'  ? '' : 'none';
  if (moon)  moon.style.display = theme === 'light' ? '' : 'none';
}

function initTheme() {
  const stored = localStorage.getItem('theme') || 'dark';
  applyTheme(stored);
}

/* ─── Tabs ──────────────────────────────────────────── */
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    if (!target) return;
    const parent = tab.closest('.add-card') || document;
    parent.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    parent.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    const panel = document.getElementById(`panel-${target}`);
    if (panel) panel.classList.add('active');
  });
});

/* ─── Preview loading state ─────────────────────────── */
function setPreviewLoading(panel, loading) {
  const loader = document.getElementById(`preview-loader-${panel}`);
  const btn    = document.getElementById(`btn-add-${panel}`);
  if (loader) loader.classList.toggle('hidden', !loading);
  if (btn) {
    btn.disabled = loading;
    btn.innerHTML = loading
      ? `<span class="loader-ring" style="width:14px;height:14px;border-width:2px"></span> Loading…`
      : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Add Torrent`;
  }
}

/* ─── Magnet form ───────────────────────────────────── */
document.getElementById('form-magnet').addEventListener('submit', async (e) => {
  e.preventDefault();
  const textarea = document.getElementById('magnet');
  const magnet   = textarea.value?.trim();
  if (!magnet) { showError('Paste a magnet link first'); return; }

  setPreviewLoading('magnet', true);
  try {
    const data = await fetchPreview(magnet);
    setPreviewLoading('magnet', false);
    showPreviewModal(data, async () => {
      await addMagnet(magnet);
      textarea.value = '';
    });
  } catch (err) {
    setPreviewLoading('magnet', false);
    showError(err.message || 'Failed to get preview');
  }
});

/* ─── File form ─────────────────────────────────────── */
document.getElementById('form-file').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = e.target.querySelector('input[type="file"]');
  const file  = input.files?.[0];
  if (!file) { showError('Choose a .torrent file first'); return; }

  setPreviewLoading('file', true);
  try {
    const data = await fetchPreviewFile(file);
    setPreviewLoading('file', false);
    showPreviewModal(data, async () => {
      await addFile(file);
      input.value = '';
      const textEl = e.target.querySelector('.file-text');
      if (textEl) textEl.textContent = 'Click to choose .torrent file';
    });
  } catch (err) {
    setPreviewLoading('file', false);
    showError(err.message || 'Failed to get preview');
  }
});

/* File label update */
const fileInput = document.querySelector('#form-file input[type="file"]');
if (fileInput) {
  fileInput.addEventListener('change', () => {
    const label = document.querySelector('#form-file .file-text');
    if (label) label.textContent = fileInput.files?.[0]?.name || 'Click to choose .torrent file';
  });
}

/* Theme toggle click */
document.getElementById('theme-toggle')?.addEventListener('click', () => {
  const current = document.documentElement.dataset.theme || 'dark';
  applyTheme(current === 'dark' ? 'light' : 'dark');
});

/* ─── Boot ──────────────────────────────────────────── */
initTheme();
initModal();
initPreviewModal();
poll();
setInterval(poll, 2000);
