const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const WebTorrent = require('webtorrent');

const app = express();
const PORT = process.env.PORT || 3000;

// Download directory (create if missing)
const DOWNLOAD_DIR = path.join(__dirname, 'downloads');
if (!fs.existsSync(DOWNLOAD_DIR)) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

// Persistence: saved torrent list (magnet + infoHash for reliable remove)
const STATE_FILE = path.join(__dirname, 'state.json');

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn('Could not load state:', e.message);
    return [];
  }
}

function saveState(entries) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(entries, null, 2), 'utf8');
  } catch (e) {
    console.error('Could not save state:', e.message);
  }
}

function addToState(magnet, infoHash) {
  const entries = loadState();
  if (entries.some((e) => (e.infoHash || '').toLowerCase() === (infoHash || '').toLowerCase())) return;
  entries.push({ magnet, infoHash: (infoHash || '').toLowerCase() });
  saveState(entries);
}

function removeFromState(infoHash) {
  const key = (infoHash || '').toLowerCase();
  const entries = loadState().filter((e) => (e.infoHash || '').toLowerCase() !== key);
  saveState(entries);
}

// Multer for .torrent file uploads
const upload = multer({
  dest: path.join(__dirname, 'tmp'),
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.torrent') cb(null, true);
    else cb(new Error('Only .torrent files are allowed'));
  },
});

const client = new WebTorrent();
const previewClient = new WebTorrent(); // separate client for preview only — never appears in main list
const torrents = new Map(); // infoHash -> torrent ref for lookup

// Restore saved torrents on startup (resumes partial downloads)
const saved = loadState();
const seen = new Set();
saved.forEach((entry) => {
  const infoHash = (entry.infoHash || '').toLowerCase();
  if (!infoHash || seen.has(infoHash)) return;
  seen.add(infoHash);
  const magnet = entry.magnet || `magnet:?xt=urn:btih:${infoHash}`;
  if (!magnet.startsWith('magnet:')) return;
  client.add(magnet, { path: DOWNLOAD_DIR }, (torrent) => {
    torrents.set(torrent.infoHash, torrent);
    console.log('Restored torrent:', torrent.name || torrent.infoHash);
  });
});
if (saved.length > 0) console.log('Restoring', saved.length, 'saved torrent(s)...');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ensure tmp dir exists
const tmpDir = path.join(__dirname, 'tmp');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

const PREVIEW_TIMEOUT_MS = 30000;

function sendPreviewAndDestroy(res, torrent, previewDir) {
  if (res.headersSent) return;
  const name = torrent.name || 'Unknown';
  const length = torrent.length || 0;
  const files = (torrent.files || []).map((f) => ({ name: f.name, length: f.length }));
  res.json({ name, length, files });
  torrent.destroy();
  fs.rm(previewDir, { recursive: true, force: true }, () => {});
}

// Preview (metadata only) for magnet — used by confirmation modal
app.post('/api/torrents/preview', (req, res) => {
  const { magnet } = req.body;
  if (!magnet || typeof magnet !== 'string' || !magnet.trim().startsWith('magnet:')) {
    return res.status(400).json({ error: 'Valid magnet link is required' });
  }
  const previewDir = path.join(tmpDir, 'preview-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  fs.mkdirSync(previewDir, { recursive: true });
  previewClient.add(magnet.trim(), { path: previewDir }, (torrent) => {
    const done = () => sendPreviewAndDestroy(res, torrent, previewDir);
    if (torrent.files && torrent.files.length > 0) {
      return done();
    }
    torrent.once('metadata', done);
    torrent.on('error', (err) => {
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || 'Failed to get metadata' });
        torrent.destroy();
        fs.rm(previewDir, { recursive: true, force: true }, () => {});
      }
    });
    setTimeout(() => {
      if (!res.headersSent) {
        res.status(408).json({ error: 'Metadata timeout — try adding anyway' });
        torrent.destroy();
        fs.rm(previewDir, { recursive: true, force: true }, () => {});
      }
    }, PREVIEW_TIMEOUT_MS);
  });
});

// Preview for .torrent file
app.post('/api/torrents/preview/file', upload.single('torrent'), (req, res) => {
  if (!req.file || !req.file.path) {
    return res.status(400).json({ error: 'No .torrent file uploaded' });
  }
  const torrentPath = req.file.path;
  const previewDir = path.join(tmpDir, 'preview-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  fs.mkdirSync(previewDir, { recursive: true });
  previewClient.add(torrentPath, { path: previewDir }, (torrent) => {
    fs.unlink(torrentPath, () => {});
    const done = () => sendPreviewAndDestroy(res, torrent, previewDir);
    if (torrent.files && torrent.files.length > 0) {
      return done();
    }
    torrent.once('metadata', done);
    torrent.on('error', (err) => {
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || 'Failed to get metadata' });
        torrent.destroy();
        fs.rm(previewDir, { recursive: true, force: true }, () => {});
      }
    });
    setTimeout(() => {
      if (!res.headersSent) {
        res.status(408).json({ error: 'Metadata timeout' });
        torrent.destroy();
        fs.rm(previewDir, { recursive: true, force: true }, () => {});
      }
    }, PREVIEW_TIMEOUT_MS);
  });
});

// Add torrent from magnet link
app.post('/api/torrents', (req, res) => {
  const { magnet } = req.body;
  if (!magnet || typeof magnet !== 'string') {
    console.warn('POST /api/torrents called without magnet or with non-string body', req.body);
    return res.status(400).json({ error: 'Magnet link is required' });
  }
  if (!magnet.trim().startsWith('magnet:')) {
    console.warn('POST /api/torrents received invalid magnet link', magnet);
    return res.status(400).json({ error: 'Invalid magnet link' });
  }

  client.add(magnet, { path: DOWNLOAD_DIR }, (torrent) => {
    torrents.set(torrent.infoHash, torrent);
    addToState(magnet, torrent.infoHash);
    res.json({
      infoHash: torrent.infoHash,
      name: torrent.name,
      progress: 0,
      downloadSpeed: 0,
      uploadSpeed: 0,
      numPeers: 0,
      length: torrent.length,
      done: false,
    });
  });
});

// Add torrent from uploaded .torrent file
app.post('/api/torrents/file', upload.single('torrent'), (req, res) => {
  if (!req.file || !req.file.path) {
    console.warn('POST /api/torrents/file without file payload');
    return res.status(400).json({ error: 'No .torrent file uploaded' });
  }
  const torrentPath = req.file.path;

  client.add(torrentPath, { path: DOWNLOAD_DIR }, (torrent) => {
    torrents.set(torrent.infoHash, torrent);
    fs.unlink(torrentPath, () => {}); // delete tmp file
    const magnet = `magnet:?xt=urn:btih:${torrent.infoHash}`;
    addToState(magnet, torrent.infoHash);
    res.json({
      infoHash: torrent.infoHash,
      name: torrent.name,
      progress: 0,
      downloadSpeed: 0,
      uploadSpeed: 0,
      numPeers: 0,
      length: torrent.length,
      done: false,
    });
  });
});

// List all torrents with current stats
app.get('/api/torrents', (req, res) => {
  console.debug('GET /api/torrents - active torrents:', client.torrents.length);
  const list = client.torrents.map((torrent) => ({
    infoHash: torrent.infoHash,
    name: torrent.name,
    progress: Math.round(torrent.progress * 100 * 100) / 100,
    downloadSpeed: torrent.downloadSpeed,
    uploadSpeed: torrent.uploadSpeed,
    numPeers: torrent.numPeers,
    length: torrent.length,
    downloaded: torrent.downloaded,
    done: torrent.progress === 1,
    files: torrent.files.map((f) => ({
      name: f.name,
      length: f.length,
      progress: Math.round(f.progress * 100 * 100) / 100,
    })),
  }));
  res.json(list);
});

// Get single torrent stats
app.get('/api/torrents/:infoHash', (req, res) => {
  const torrent = client.get(req.params.infoHash);
  if (!torrent) return res.status(404).json({ error: 'Torrent not found' });
  res.json({
    infoHash: torrent.infoHash,
    name: torrent.name,
    progress: Math.round(torrent.progress * 100 * 100) / 100,
    downloadSpeed: torrent.downloadSpeed,
    uploadSpeed: torrent.uploadSpeed,
    numPeers: torrent.numPeers,
    length: torrent.length,
    downloaded: torrent.downloaded,
    done: torrent.progress === 1,
    files: torrent.files.map((f) => ({
      name: f.name,
      length: f.length,
      progress: Math.round(f.progress * 100 * 100) / 100,
    })),
  });
});

// Remove torrent (optional: delete files)
app.delete('/api/torrents/:infoHash', (req, res) => {
  const torrent = client.get(req.params.infoHash);
  if (!torrent) return res.status(404).json({ error: 'Torrent not found' });
  const removeFiles = req.query.removeFiles === 'true';
  torrent.destroy(removeFiles);
  torrents.delete(torrent.infoHash);
  removeFromState(torrent.infoHash);
  res.json({ ok: true });
});

// Pause / resume
app.patch('/api/torrents/:infoHash', (req, res) => {
  const torrent = client.get(req.params.infoHash);
  if (!torrent) return res.status(404).json({ error: 'Torrent not found' });
  const { pause } = req.body;
  if (pause === true) torrent.pause();
  else if (pause === false) torrent.resume();
  res.json({ ok: true });
});

// Global error handler and logger
app.use((err, req, res, next) => {
  console.error('Unhandled error while handling request', {
    method: req.method,
    url: req.url,
    message: err.message,
    stack: err.stack,
  });
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Torrent Downloader running at http://localhost:${PORT}`);
  console.log(`Downloads save to: ${DOWNLOAD_DIR}`);
});
