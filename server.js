import express      from 'express';
import cors         from 'cors';
import path         from 'path';
import fs           from 'fs';
import os           from 'os';
import { exec }     from 'child_process';
import multer       from 'multer';
import WebTorrent   from 'webtorrent';
import parseTorrent from 'parse-torrent';

const app  = express();
const PORT = process.env.PORT || 3000;

const __dirname          = import.meta.dirname;
const TMP_DIR            = path.join(__dirname, 'tmp');
const STATE_FILE         = path.join(__dirname, 'state.json');
const CONFIG_FILE        = path.join(__dirname, 'config.json');
const PREVIEW_TIMEOUT_MS = 30_000;

/* ─── Config (download dir) ──────────────────────────────────────────────── */
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; }
}
function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

let downloadDir = loadConfig().downloadDir || path.join(__dirname, 'downloads');

for (const d of [downloadDir, TMP_DIR]) fs.mkdirSync(d, { recursive: true });

/* ─── WebTorrent client ──────────────────────────────────────────────────── */
const client = new WebTorrent();

client.on('error', err => console.error('[webtorrent]', err.message));

/* ─── State persistence ──────────────────────────────────────────────────── */
function loadState() {
  try { 
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return Array.isArray(state) ? state : [];
  } catch { 
    return []; 
  }
}

function saveState() {
  const activeState = client.torrents.map(t => ({
    infoHash:      t.infoHash,
    magnet:        t.magnetURI,
    selectedFiles: t._selectedFiles ?? null,
    seeding:       true, // Active torrents are seeding
    name:          t.name,
    length:        t.length,
    path:          t.path,
    files:         t.files?.map(f => ({ name: f.name, length: f.length })),
  }));
  
  // Load existing state to preserve stopped torrents
  const existingState = loadState();
  const stoppedState = existingState.filter(entry => 
    !client.torrents.some(t => t.infoHash === entry.infoHash) && entry.seeding === false
  );
  
  const state = [...activeState, ...stoppedState];
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); } catch (e) {
    console.error('[state]', e.message);
  }
}

/* ─── Format torrent for frontend ───────────────────────────────────────── */
function fmt(t) {
  const totalLength = t.length     || 0;
  const downloaded  = t.downloaded || 0;
  const done        = totalLength > 0 && downloaded >= totalLength;
  const rawProgress = totalLength > 0 ? (downloaded / totalLength) * 100 : 0;
  const progress    = done ? 100 : Math.min(99.9, rawProgress);

  const seeding = t._seeding ?? true;
  return {
    infoHash:      t.infoHash,
    name:          t.name  || null,
    progress:      Math.round(progress * 10) / 10,
    downloadSpeed: seeding ? (t.downloadSpeed || 0) : 0,
    uploadSpeed:   seeding ? (t.uploadSpeed   || 0) : 0,
    numPeers:      seeding ? (t.numPeers      || 0) : 0,
    length:        totalLength,
    downloaded,
    done,
    failed:  !!t._failed,
    seeding,
    files: (t.files || []).map(f => ({
      name:     f.name,
      length:   f.length,
      progress: Math.round((f.progress || 0) * 1000) / 10,
    })),
  };
}

/* ─── Middleware ─────────────────────────────────────────────────────────── */
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/test-torrents', express.static(path.join(__dirname, 'test-torrents')));

const upload = multer({ dest: TMP_DIR });

/* ─── Restore state on startup ───────────────────────────────────────────── */
for (const entry of loadState()) {
  if (!entry.magnet) continue;
  try {
    const t = client.add(entry.magnet, { path: downloadDir }, torrent => {
      if (Array.isArray(entry.selectedFiles)) {
        torrent._selectedFiles = entry.selectedFiles;
        torrent.files.forEach((f, i) => { if (!entry.selectedFiles.includes(i)) f.deselect(); });
      }
      torrent._seeding = entry.seeding ?? true;
      saveState();
    });
    t._selectedFiles = entry.selectedFiles;
    t._seeding = entry.seeding ?? true;
    t.on('error', err => { t._failed = true; t._error = err.message; saveState(); });
  } catch { /* skip bad entries */ }
}

/* ─── GET /api/torrents ──────────────────────────────────────────────────── */
app.get('/api/torrents', (req, res) => {
  const activeTorrents = client.torrents.map(fmt);
  const allState = loadState();
  const stoppedTorrents = allState
    .filter(entry => entry.seeding === false)
    .map(entry => ({
      infoHash: entry.infoHash,
      name: entry.name || 'Unknown',
      progress: 100,
      downloadSpeed: 0,
      uploadSpeed: 0,
      numPeers: 0,
      length: entry.length || 0,
      downloaded: entry.length || 0,
      done: true,
      failed: false,
      seeding: false,
      files: entry.files || [],
    }));
  
  res.json([...activeTorrents, ...stoppedTorrents]);
});

/* ─── GET /api/torrents/:hash ────────────────────────────────────────────── */
app.get('/api/torrents/:hash', async (req, res) => {
  const t = await client.get(req.params.hash);
  if (!t) return res.status(404).json({ error: 'Not found' });
  res.json(fmt(t));
});

/* ─── POST /api/torrents/preview  (magnet) ─────────────────────────────── */
// NOTE: must be registered before /api/torrents/:hash
app.post('/api/torrents/preview', (req, res) => {
  const magnet = req.body?.magnet?.trim();
  if (!magnet?.startsWith('magnet:')) return res.status(400).json({ error: 'Valid magnet link required' });

  const previewDir = path.join(TMP_DIR, `preview-${Date.now()}`);
  fs.mkdirSync(previewDir, { recursive: true });

  let settled = false;
  const settle = (cb) => { if (settled) return; settled = true; cb(); };

  let t;
  const timer = setTimeout(() => {
    settle(() => {
      res.status(408).json({ error: 'Metadata timeout — peers unreachable' });
      if (t) t.destroy({ destroyStore: true }, () =>
        fs.rm(previewDir, { recursive: true, force: true }, () => {}));
    });
  }, PREVIEW_TIMEOUT_MS);

  try {
    t = client.add(magnet, { path: previewDir });
  } catch (err) {
    clearTimeout(timer);
    fs.rm(previewDir, { recursive: true, force: true }, () => {});
    return res.status(500).json({ error: err.message });
  }

  t.on('ready', () => {
    clearTimeout(timer);
    settle(() => {
      res.json({
        name:   t.name,
        length: t.length,
        files:  t.files.map(f => ({ name: f.name, length: f.length })),
      });
      t.destroy({ destroyStore: true }, () =>
        fs.rm(previewDir, { recursive: true, force: true }, () => {}));
    });
  });

  t.on('error', err => {
    clearTimeout(timer);
    settle(() => {
      res.status(500).json({ error: err.message });
      fs.rm(previewDir, { recursive: true, force: true }, () => {});
    });
  });
});

/* ─── POST /api/torrents/preview/file  (.torrent) ─────────────────────── */
app.post('/api/torrents/preview/file', upload.single('torrent'), (req, res) => {
  if (!req.file?.path) return res.status(400).json({ error: 'No .torrent file uploaded' });

  const previewDir = path.join(TMP_DIR, `preview-${Date.now()}`);
  fs.mkdirSync(previewDir, { recursive: true });

  const cleanup = () => {
    fs.rm(previewDir, { recursive: true, force: true }, () => {});
    fs.unlink(req.file.path, () => {});
  };

  let t;
  try {
    t = client.add(req.file.path, { path: previewDir });
  } catch (err) {
    cleanup();
    return res.status(500).json({ error: err.message });
  }

  t.on('ready', () => {
    res.json({
      name:   t.name,
      length: t.length,
      files:  t.files.map(f => ({ name: f.name, length: f.length })),
    });
    t.destroy({ destroyStore: true }, cleanup);
  });

  t.on('error', err => {
    res.status(500).json({ error: err.message });
    t.destroy({ destroyStore: true }, cleanup);
  });
});

/* ─── POST /api/torrents  (add magnet) ───────────────────────────────────── */
app.post('/api/torrents', async (req, res) => {
  const magnet = req.body?.magnet?.trim();
  if (!magnet?.startsWith('magnet:')) return res.status(400).json({ error: 'Valid magnet link required' });

  let existing = await client.get(magnet);
  let parsedTorrent;
  try {
    parsedTorrent = parseTorrent(magnet);
  } catch (err) {
    parsedTorrent = null;
  }

  if (!existing && parsedTorrent?.infoHash) {
    existing = client.get(parsedTorrent.infoHash);
  }

  if (existing) return res.json(fmt(existing));

  if (parsedTorrent?.infoHash) {
    const stoppedEntry = loadState().find(e => e.infoHash === parsedTorrent.infoHash && e.seeding === false);
    if (stoppedEntry) {
      return res.json({
        infoHash: stoppedEntry.infoHash,
        name: stoppedEntry.name || 'Unknown',
        progress: 100,
        downloadSpeed: 0,
        uploadSpeed: 0,
        numPeers: 0,
        length: stoppedEntry.length || 0,
        downloaded: stoppedEntry.length || 0,
        done: true,
        failed: false,
        seeding: false,
        files: stoppedEntry.files || [],
      });
    }
  }

  const selectedFiles = Array.isArray(req.body?.selectedFiles) ? req.body.selectedFiles : null;
  try {
    const t = client.add(magnet, { path: downloadDir }, torrent => {
      if (selectedFiles) {
        torrent._selectedFiles = selectedFiles;
        torrent.files.forEach((f, i) => { if (!selectedFiles.includes(i)) f.deselect(); });
      }
      torrent._seeding = true;
      saveState();
    });
    t._selectedFiles = selectedFiles;
    t._seeding = true;
    t.on('error', err => { t._failed = true; t._error = err.message; saveState(); });
    saveState();
    res.json(fmt(t));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ─── POST /api/torrents/file  (add .torrent) ────────────────────────────── */
app.post('/api/torrents/file', upload.single('torrent'), (req, res) => {
  if (!req.file?.path) return res.status(400).json({ error: 'No .torrent file uploaded' });

  const rawSel = req.body?.selectedFiles;
  const selectedFiles = rawSel ? (() => { try { return JSON.parse(rawSel); } catch { return null; } })() : null;

  let parsed;
  try {
    parsed = parseTorrent(fs.readFileSync(req.file.path));
  } catch (err) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'Invalid torrent file' });
  }

  if (parsed?.infoHash) {
    const existing = client.get(parsed.infoHash);
    if (existing) {
      fs.unlink(req.file.path, () => {});
      return res.json(fmt(existing));
    }
    const stoppedEntry = loadState().find(e => e.infoHash === parsed.infoHash && e.seeding === false);
    if (stoppedEntry) {
      fs.unlink(req.file.path, () => {});
      return res.json({
        infoHash: stoppedEntry.infoHash,
        name: stoppedEntry.name || 'Unknown',
        progress: 100,
        downloadSpeed: 0,
        uploadSpeed: 0,
        numPeers: 0,
        length: stoppedEntry.length || 0,
        downloaded: stoppedEntry.length || 0,
        done: true,
        failed: false,
        seeding: false,
        files: stoppedEntry.files || [],
      });
    }
  }

  try {
    const t = client.add(req.file.path, { path: downloadDir }, torrent => {
      if (Array.isArray(selectedFiles)) {
        torrent._selectedFiles = selectedFiles;
        torrent.files.forEach((f, i) => { if (!selectedFiles.includes(i)) f.deselect(); });
      }
      torrent._seeding = true;
      saveState();
      fs.unlink(req.file.path, () => {});
    });
    t._selectedFiles = Array.isArray(selectedFiles) ? selectedFiles : null;
    t._seeding = true;
    t.on('error', err => { t._failed = true; t._error = err.message; saveState(); });
    saveState();
    res.json(fmt(t));
  } catch (err) {
    fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: err.message });
  }
});

/* ─── DELETE /api/torrents/:hash ─────────────────────────────────────────── */
app.delete('/api/torrents/:hash', async (req, res) => {
  const t = await client.get(req.params.hash);

  if (!t) {
    // May be a stopped (non-seeding) torrent persisted only in state
    const state = loadState();
    const idx = state.findIndex(e => e.infoHash === req.params.hash);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    state.splice(idx, 1);
    try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); } catch (e) {
      return res.status(500).json({ error: e.message });
    }
    return res.json({ ok: true });
  }

  t.destroy({ destroyStore: false }, err => {
    if (err) return res.status(500).json({ error: err.message });
    saveState();
    res.json({ ok: true });
  });
});

/* ─── POST /api/torrents/:hash/retry ─────────────────────────────────────── */
app.post('/api/torrents/:hash/retry', async (req, res) => {
  const existing = await client.get(req.params.hash);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const magnet = existing.magnetURI;
  existing.destroy({ destroyStore: false }, () => {
    try {
      const t = client.add(magnet, { path: downloadDir }, () => saveState());
      t.on('error', err => { t._failed = true; saveState(); });
      saveState();
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
});

/* ─── POST /api/torrents/:hash/stop-seeding ─────────────────────────────── */
app.post('/api/torrents/:hash/stop-seeding', async (req, res) => {
  const t = await client.get(req.params.hash);
  if (!t) return res.status(404).json({ error: 'Not found' });

  // Update state to mark as not seeding and immediately respond
  const state = loadState();
  const entry = state.find(e => e.infoHash === req.params.hash);
  if (entry) {
    entry.seeding = false;
    entry.name = t.name;
    entry.length = t.length;
    entry.files = t.files?.map(f => ({ name: f.name, length: f.length }));
    try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); } catch (e) {
      console.error('[state]', e.message);
    }
  }

  t._seeding = false;

  t.destroy({ destroyStore: false }, err => {
    if (err) console.error('[torrent destroy]', err.message);
  });

  res.json({ ok: true });
});

/* ─── POST /api/torrents/:hash/resume-seeding ───────────────────────────── */
app.post('/api/torrents/:hash/resume-seeding', async (req, res) => {
  const state = loadState();
  const entry = state.find(e => e.infoHash === req.params.hash && e.seeding === false);
  if (!entry) return res.status(404).json({ error: 'Not found or already seeding' });

  try {
    const t = client.add(entry.magnet, { path: downloadDir }, torrent => {
      if (Array.isArray(entry.selectedFiles)) {
        torrent._selectedFiles = entry.selectedFiles;
        torrent.files.forEach((f, i) => { if (!entry.selectedFiles.includes(i)) f.deselect(); });
      }
      // Update state to mark as seeding
      const currentState = loadState();
      const stateEntry = currentState.find(e => e.infoHash === req.params.hash);
      if (stateEntry) {
        stateEntry.seeding = true;
        try { fs.writeFileSync(STATE_FILE, JSON.stringify(currentState, null, 2)); } catch (e) {
          console.error('[state]', e.message);
        }
      }
    });
    t._selectedFiles = entry.selectedFiles;
    t.on('error', err => { t._failed = true; t._error = err.message; saveState(); });
    saveState();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ─── GET /api/fs/browse ─────────────────────────────────────────────────── */
app.get('/api/fs/browse', (req, res) => {
  const requested = req.query.dir || os.homedir();
  const resolved  = path.isAbsolute(requested) ? requested : path.join(__dirname, requested);
  try {
    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    const dirs = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => e.name)
      .sort((a, b) => a.localeCompare(b));
    res.json({ dir: resolved, parent: path.dirname(resolved), entries: dirs });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* ─── GET /api/config ────────────────────────────────────────────────────── */
app.get('/api/config', (req, res) => {
  res.json({ downloadDir });
});

/* ─── PATCH /api/config ──────────────────────────────────────────────────── */
app.patch('/api/config', (req, res) => {
  const newDir = req.body?.downloadDir?.trim();
  if (!newDir) return res.status(400).json({ error: 'downloadDir is required' });
  const resolved = path.isAbsolute(newDir) ? newDir : path.join(__dirname, newDir);
  try {
    fs.mkdirSync(resolved, { recursive: true });
    downloadDir = resolved;
    saveConfig({ downloadDir: resolved });
    res.json({ downloadDir: resolved });
  } catch (err) {
    res.status(400).json({ error: `Cannot use that folder: ${err.message}` });
  }
});

function openPathInOS(folder) {
  if (!folder) throw new Error('No folder to open');
  const normalized = path.resolve(folder);
  if (!fs.existsSync(normalized)) throw new Error('Path does not exist');

  let cmd;
  if (process.platform === 'win32') {
    cmd = `start "" "${normalized}"`;
  } else if (process.platform === 'darwin') {
    cmd = `open "${normalized}"`;
  } else {
    cmd = `xdg-open "${normalized}"`;
  }

  exec(cmd, (err) => {
    if (err) console.error('[open]', err.message);
  });
}

/* ─── POST /api/torrents/:hash/open ────────────────────────────────────── */
app.post('/api/torrents/:hash/open', async (req, res) => {
  const infoHash = req.params.hash;
  const t = await client.get(infoHash);

  let folder = null;
  if (t) {
    // Prefer the torrent path if available (folder or file path), otherwise use downloadDir
    folder = t.path ? t.path : downloadDir;
  } else {
    const state = loadState();
    const entry = state.find(e => e.infoHash === infoHash);
    if (entry) {
      // Try to open own folder if we can, else fallback to global download dir
      folder = entry.path || path.join(downloadDir, entry.name || '');
      if (!folder || !fs.existsSync(folder)) {
        folder = downloadDir;
      }
    }
  }

  if (!folder || !fs.existsSync(folder)) {
    return res.status(404).json({ error: 'Torrent not found or no local folder available' });
  }

  try {
    openPathInOS(folder);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unable to open folder' });
  }
});

/* ─── GET /api/test-torrents ────────────────────────────────────────────── */
app.get('/api/test-torrents', (req, res) => {
  const testDir = path.join(__dirname, 'test-torrents');
  try {
    const files = fs.readdirSync(testDir)
      .filter(f => /^test-torrent-\d+\.torrent$/i.test(f))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map(f => ({
        name: f,
        url: `/test-torrents/${f}`
      }));
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: `Cannot read test torrents: ${err.message}` });
  }
});

/* ─── 404 for unknown API routes ─────────────────────────────────────────── */
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

/* ─── Start ──────────────────────────────────────────────────────────────── */
app.listen(PORT, () => {
  console.log(`\nTorrent Downloader  →  http://localhost:${PORT}`);
  console.log(`Downloads           →  ${downloadDir}`);
  console.log(`Engine              →  WebTorrent\n`);
});
