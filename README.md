# Spotify Now Playing

A sleek, self-hostable **Spotify Now Playing** web app built with **Vite + React**.  
No backend required — everything runs in the browser using the Spotify PKCE OAuth flow.

## ✨ Features

| | |
|---|---|
| 🎵 | Real-time track, artist, album, and album art |
| ⏱️ | Smooth progress bar with live timestamps — **click anywhere to seek** |
| ⏮ ⏭ | **Skip to previous / next track** with one tap |
| 📋 | **Up Next queue** — see the upcoming tracks in your Spotify queue |
| 📃 | Synced lyrics via [lrclib.net](https://lrclib.net) & Apple Music — Apple Music-style auto-scrolling |
| 🎯 | **Lyric timestamp seeking** — click any lyric line (or word) to jump to that moment |
| 🎨 | Dynamic background that shifts to match each album's colours |
| 🖥️ | **Projector / ambient mode** — minimal fullscreen screensaver, perfect for a second monitor |
| 📱 | Fully responsive — stacks gracefully on mobile |

## Screenshots

**Setup page**
![Setup](https://github.com/user-attachments/assets/2e43974b-9716-4068-8caa-5e2ff50a4526)

**Now Playing + Lyrics**
![Now Playing](https://github.com/user-attachments/assets/e77f002b-73c1-4cf4-868e-3ef3dc5f0f87)

**Projector / Ambient mode**
![Projector](https://github.com/user-attachments/assets/81dfb59d-09c3-4a3c-bb55-c58e7dc1be31)

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- A [Spotify Developer](https://developer.spotify.com/dashboard) account

### 1. Clone & install

```bash
git clone https://github.com/utkarshj2809/spotify-now-playing.git
cd spotify-now-playing
npm install
```

### 2. Create a Spotify app

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and create a new app.
2. Under **Redirect URIs**, add the URL where you will run the app, e.g. `http://localhost:5173/`
3. Save and note your **Client ID**.

> No Client Secret is needed — the app uses the PKCE flow entirely in the browser.

### 3. Configure the Client ID (recommended)

Copy `.env.example` to `.env` and paste your Client ID:

```bash
cp .env.example .env
# then edit .env:
# VITE_SPOTIFY_CLIENT_ID=your_32_char_client_id_here
```

When `VITE_SPOTIFY_CLIENT_ID` is set at build time, **any visitor can log in with their own
Spotify account by clicking a single button** — no Client ID entry required on their end.

> The `.env` file is gitignored so your Client ID is never committed to the repository.

If you skip this step the app falls back to a manual-entry form where each user must supply
their own Client ID (the original self-hosting flow).

### 4. Run

```bash
npm run dev
```

Open `http://localhost:5173` and click **Connect to Spotify**.

### 5. Build for production

```bash
npm run build
npm run preview
```

Deploy the `dist/` folder to any static host (Netlify, Vercel, GitHub Pages, etc.).  
Remember to add your production URL as a Redirect URI in your Spotify app settings.

---

## 🛠️ Tech Stack

- **Vite + React 19** — fast dev server & build
- **Spotify Web API** — `user-read-currently-playing`, `user-read-playback-state`, `user-modify-playback-state` scopes
- **lrclib.net** — free synced-lyrics API (`GET /api/get` with `/api/search` fallback)
- **Apple Music** — word-level (syllable) synced lyrics via the MusicKit catalogue
- Pure CSS — no UI framework; uses CSS custom properties for theming

---

## 📖 How it works

1. **Auth**: PKCE code-challenge flow — no client secret is ever needed. When `VITE_SPOTIFY_CLIENT_ID` is set the app owner's Client ID is baked in at build time; otherwise each user enters their own. Either way every user authenticates with their own Spotify account.
2. **Polling**: The app polls `/v1/me/player/currently-playing` and `/v1/me/player/queue` in parallel every 3 seconds. A 100 ms in-browser ticker keeps the progress bar and lyric highlights smooth between polls.
3. **Playback controls**: Skip previous/next calls `/v1/me/player/previous` and `/v1/me/player/next` (POST). Seeking calls `/v1/me/player/seek?position_ms=…` (PUT). All three require the `user-modify-playback-state` scope — users who already authorised the app will need to **log out and log back in** once to grant this new permission.
4. **Lyrics**: On track change, `GET /api/get` is called with `track_name`, `artist_name` (primary only), `album_name`, and `duration` (decimal seconds). A 404 falls back to `GET /api/search?q=artist+title`. The active lyric line scrolls to centre automatically. Clicking any synced line (or individual word in Apple Music word-level lyrics) seeks Spotify playback to that timestamp.
5. **Queue**: `/v1/me/player/queue` returns up to 15 upcoming tracks displayed in the "Up Next" panel, updated every poll cycle.
6. **Colour**: A tiny canvas samples the album art to extract a dominant colour used for the background tint.
