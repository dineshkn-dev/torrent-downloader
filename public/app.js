const API = '/api';

function showError(msg) {
  const el = document.createElement('div');
  el.className = 'error-toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
  // Also log to console for debugging
  // eslint-disable-next-line no-console
  console.error('[UI error]', msg);
}

function formatSpeed(bytesPerSec) {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '—';
  const units = ['B/s', 'KB/s', 'MB/s'];
  let i = 0;
  let v = bytesPerSec;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function renderTorrent(t) {
  // Defensive defaults so we don't crash on bad data
  const progress = Number.isFinite(t?.progress) ? t.progress : 0;
  const downloadSpeed = Number.isFinite(t?.downloadSpeed) ? t.downloadSpeed : 0;
  const uploadSpeed = Number.isFinite(t?.uploadSpeed) ? t.uploadSpeed : 0;
  const numPeers = Number.isFinite(t?.numPeers) ? t.numPeers : 0;
  const length = Number.isFinite(t?.length) ? t.length : 0;

  const card = document.createElement('div');
  card.className = 'torrent-card' + (t?.done ? ' done' : '');
  card.dataset.infoHash = t?.infoHash || '';
  card.innerHTML = `
    <div class="torrent-name">${escapeHtml(t?.name || 'Unknown')}</div>
    <div class="torrent-meta">
      <span>${progress.toFixed(1)}%</span>
      <span>↓ ${formatSpeed(downloadSpeed)}</span>
      <span>↑ ${formatSpeed(uploadSpeed)}</span>
      <span>${numPeers} peers</span>
      <span>${formatSize(length)}</span>
    </div>
    <div class="torrent-progress-wrap">
      <div class="torrent-progress-bar" style="width:${progress}%"></div>
    </div>
    <div class="torrent-actions">
      <button type="button" class="btn btn-details btn-details-open">Details</button>
      <button type="button" class="btn btn-danger btn-remove">Remove</button>
    </div>
  `;
  const removeBtn = card.querySelector('.btn-remove');
  const detailsBtn = card.querySelector('.btn-details-open');
  removeBtn.addEventListener('click', (e) => { e.stopPropagation(); removeTorrent(t.infoHash); });
  detailsBtn.addEventListener('click', (e) => { e.stopPropagation(); openDetails(t.infoHash); });
  return card;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function fetchTorrents() {
  const res = await fetch(`${API}/torrents`);
  if (!res.ok) throw new Error('Failed to load torrents');
  return res.json();
}

function renderList(list) {
  const container = document.getElementById('torrent-list');
  const empty = document.getElementById('empty-state');
  container.innerHTML = '';
  // eslint-disable-next-line no-console
  console.debug('[renderList] received', list);
  list.forEach((t) => container.appendChild(renderTorrent(t)));
  empty.classList.toggle('hidden', list.length > 0);
}

async function poll() {
  try {
    const list = await fetchTorrents();
    renderList(list);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[poll] Failed to fetch torrents', e);
    showError(e.message || 'Could not refresh list');
  }
}

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

function showPreviewModal(data, onConfirm) {
  const name = data?.name || 'Unknown';
  const length = Number.isFinite(data?.length) ? data.length : 0;
  const files = Array.isArray(data?.files) ? data.files : [];

  document.getElementById('preview-summary').innerHTML = `
    <div class="detail-row"><span class="detail-label">Name</span><span class="detail-value">${escapeHtml(name)}</span></div>
    <div class="detail-row"><span class="detail-label">Size</span><span class="detail-value">${formatSize(length)}</span></div>
  `;

  const filesEl = document.getElementById('preview-files');
  if (files.length === 0) {
    filesEl.innerHTML = '<p class="detail-value">No file list yet (metadata may still be loading).</p>';
  } else {
    const rows = files.map((f) => `<tr><td class="file-name">${escapeHtml(f?.name || '—')}</td><td>${formatSize(f?.length ?? 0)}</td></tr>`).join('');
    filesEl.innerHTML = `<table><thead><tr><th>File</th><th>Size</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

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
    poll();
    const list = await fetchTorrents();
    const added = list[list.length - 1];
    if (added?.infoHash) openDetails(added.infoHash);
  } catch (err) {
    console.error('[preview confirm] Add failed', err);
    showError(err.message || 'Failed to add torrent');
  }
}

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
  const res = await fetch(`${API}/torrents/file`, {
    method: 'POST',
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to add torrent');
}

async function removeTorrent(infoHash) {
  if (!confirm('Remove this torrent from the list? Files on disk will stay.')) return;
  const res = await fetch(`${API}/torrents/${encodeURIComponent(infoHash)}`, { method: 'DELETE' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    showError(data.error || 'Failed to remove');
    return;
  }
  if (detailsModalOpenFor === infoHash) closeModal();
  poll();
}

// --- Details modal ---
let detailsModalOpenFor = null;
let detailsModalRefreshTimer = null;

async function fetchTorrentDetails(infoHash) {
  const res = await fetch(`${API}/torrents/${encodeURIComponent(infoHash)}`);
  if (!res.ok) throw new Error('Torrent not found');
  return res.json();
}

function populateDetailsModal(t) {
  const progress = Number.isFinite(t?.progress) ? t.progress : 0;
  const downloadSpeed = Number.isFinite(t?.downloadSpeed) ? t.downloadSpeed : 0;
  const uploadSpeed = Number.isFinite(t?.uploadSpeed) ? t.uploadSpeed : 0;
  const numPeers = Number.isFinite(t?.numPeers) ? t.numPeers : 0;
  const length = Number.isFinite(t?.length) ? t.length : 0;
  const name = t?.name || 'Unknown';
  const infoHash = t?.infoHash || '';
  const files = Array.isArray(t?.files) ? t.files : [];

  const summaryEl = document.getElementById('details-summary');
  summaryEl.innerHTML = `
    <div class="detail-row"><span class="detail-label">Name</span><span class="detail-value">${escapeHtml(name)}</span></div>
    <div class="detail-row"><span class="detail-label">Info hash</span><span class="detail-value">${escapeHtml(infoHash)}</span></div>
    <div class="detail-row"><span class="detail-label">Size</span><span class="detail-value">${formatSize(length)}</span></div>
    <div class="detail-row"><span class="detail-label">Progress</span><span class="detail-value">${progress.toFixed(1)}%</span></div>
    <div class="detail-row"><span class="detail-label">Download</span><span class="detail-value">${formatSpeed(downloadSpeed)}</span></div>
    <div class="detail-row"><span class="detail-label">Upload</span><span class="detail-value">${formatSpeed(uploadSpeed)}</span></div>
    <div class="detail-row"><span class="detail-label">Peers</span><span class="detail-value">${numPeers}</span></div>
  `;

  const filesEl = document.getElementById('details-files');
  if (files.length === 0) {
    filesEl.innerHTML = '<p class="detail-value">No file list yet (metadata may still be loading).</p>';
  } else {
    const rows = files.map((f) => {
      const fProgress = Number.isFinite(f?.progress) ? f.progress : 0;
      return `<tr><td class="file-name">${escapeHtml(f?.name || '—')}</td><td>${formatSize(f?.length ?? 0)}</td><td>${fProgress.toFixed(1)}%</td></tr>`;
    }).join('');
    filesEl.innerHTML = `<table><thead><tr><th>File</th><th>Size</th><th>Progress</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
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
        const updated = await fetchTorrentDetails(infoHash);
        populateDetailsModal(updated);
      } catch (_) {
        closeModal();
      }
    }, 2000);
  } catch (err) {
    console.error('[openDetails] Failed to load torrent details', err);
    showError(err.message || 'Could not load torrent details');
  }
}

function initModal() {
  const modal = document.getElementById('details-modal');
  const overlay = modal.querySelector('.modal-overlay');
  const closeBtn = modal.querySelector('.modal-close');
  overlay.addEventListener('click', closeModal);
  closeBtn.addEventListener('click', closeModal);
  modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
}

function initPreviewModal() {
  const modal = document.getElementById('preview-modal');
  modal.querySelector('.modal-overlay').addEventListener('click', closePreviewModal);
  modal.querySelector('.preview-modal-close').addEventListener('click', closePreviewModal);
  modal.querySelector('.preview-cancel').addEventListener('click', closePreviewModal);
  modal.querySelector('.preview-add').addEventListener('click', () => confirmAddFromPreview());
  modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePreviewModal(); });
}

// Tabs
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    const panel = document.getElementById(`panel-${target}`);
    if (panel) panel.classList.add('active');
  });
});

function setPreviewLoading(panel, loading) {
  const loader = panel === 'magnet' ? document.getElementById('preview-loader-magnet') : document.getElementById('preview-loader-file');
  const btn = panel === 'magnet' ? document.getElementById('btn-add-magnet') : document.getElementById('btn-add-file');
  if (loader) loader.classList.toggle('hidden', !loading);
  if (btn) {
    btn.disabled = loading;
    btn.textContent = loading ? 'Loading…' : 'Add torrent';
  }
}

// Magnet form: preview first, then confirm to add
document.getElementById('form-magnet').addEventListener('submit', async (e) => {
  e.preventDefault();
  const textarea = document.getElementById('magnet');
  const magnet = textarea.value?.trim();
  if (!magnet) {
    showError('Paste a magnet link first');
    return;
  }
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
    // eslint-disable-next-line no-console
    console.error('[preview] Failed to get preview', err);
    showError(err.message || 'Failed to get preview');
  }
});

// File form: preview first, then confirm to add
document.getElementById('form-file').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = e.target.querySelector('input[type="file"]');
  const file = input.files?.[0];
  if (!file) {
    showError('Choose a .torrent file first');
    return;
  }
  setPreviewLoading('file', true);
  try {
    const data = await fetchPreviewFile(file);
    setPreviewLoading('file', false);
    showPreviewModal(data, async () => {
      await addFile(file);
      input.value = '';
      e.target.querySelector('.file-text').textContent = 'Choose .torrent file';
    });
  } catch (err) {
    setPreviewLoading('file', false);
    // eslint-disable-next-line no-console
    console.error('[preview] Failed to get preview', err);
    showError(err.message || 'Failed to get preview');
  }
});

const fileInput = document.querySelector('#form-file input[type="file"]');
if (fileInput) {
  fileInput.addEventListener('change', () => {
    const label = document.querySelector('#form-file .file-text');
    if (label) label.textContent = fileInput.files?.[0]?.name || 'Choose .torrent file';
  });
}

initModal();
initPreviewModal();

// Poll every 2s
poll();
setInterval(poll, 2000);
