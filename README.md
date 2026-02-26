# Torrent Downloader Web App

A simple, local-only web app to download torrents via **magnet links** or **.torrent files**. Runs on your machine and saves files into a `downloads` folder.

## Features

- Add torrents via **magnet link** (paste and click Add)
- Add torrents via **.torrent file** upload
- **Details modal** — click **Details** on any torrent to see name, info hash, size, progress, speed, peers, and a full file list (refreshes every 2s while open)
- Live progress (%, speed, peers) for each download
- **Persistence** — torrent list is saved to `state.json`; after a restart the app restores and resumes all torrents (partial downloads continue from where they left off)
- Remove torrents from the list (files on disk are kept unless you change the API call)
- Dark UI with minimal dependencies

## Requirements

- **Node.js** 18+ (or 16+)

## Setup & run

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the server:

   ```bash
   npm start
   ```

3. Open in browser:

   **http://localhost:3000**

4. Downloads are saved to:

   **`./downloads`** (created automatically next to `server.js`)

## Usage

- **Magnet**: Paste a `magnet:?xt=urn:btih:...` link in the text area and click **Add torrent**.
- **File**: Switch to “.torrent file”, choose a file, then click **Add torrent**.
- Click **Details** on a torrent to open a modal with connection/stats and the list of files.
- The list refreshes every couple of seconds; you can remove a torrent with **Remove** (this only removes it from the app, not the files from disk).
- After restarting the server, open the app again — your torrent list is restored and downloads resume automatically.

## Tech

- **Backend**: Node.js, Express, **WebTorrent**, Multer (for file uploads)
- **Frontend**: Vanilla HTML/CSS/JS, no build step

## Engine & safety

- **No third-party torrent engine or cloud.** The app uses [WebTorrent](https://webtorrent.io) as an npm library inside your own Node process. All downloading happens on your machine; no torrent data is sent to any external service.
- **Runs 100% locally.** The server listens on your computer only. Don’t expose it to the internet (e.g. port forwarding or public hosting) without authentication.
- **Open source.** WebTorrent is widely used and open source; you can audit the code.
- Use only for content you are allowed to download.

## Notes

- Use only for content you are allowed to download.
- WebTorrent connects to both normal BitTorrent peers and WebRTC peers where available; some torrents may have fewer peers than in a full desktop client.
- For heavy use or very large torrents, a dedicated client (e.g. Transmission, qBittorrent) may be more suitable; this app is aimed at quick, local use.
