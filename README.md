# Spotify Now Playing

A sleek, self-hostable **Spotify Now Playing** web app built with **Vite + React**.  
No backend required — everything runs in the browser using the Spotify PKCE OAuth flow.

## ✨ Features

| | |
|---|---|
| 🎵 | Real-time track, artist, album, and album art |
| ⏱️ | Smooth progress bar with live timestamps |
| 📃 | Synced lyrics via [lrclib.net](https://lrclib.net) — Apple Music-style auto-scrolling |
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
- **Spotify Web API** — `user-read-currently-playing` + `user-read-playback-state` scopes
- **lrclib.net** — free synced-lyrics API (`GET /api/get` with `/api/search` fallback)
- Pure CSS — no UI framework; uses CSS custom properties for theming

---

## 📖 How it works

1. **Auth**: PKCE code-challenge flow — no client secret is ever needed. When `VITE_SPOTIFY_CLIENT_ID` is set the app owner's Client ID is baked in at build time; otherwise each user enters their own. Either way every user authenticates with their own Spotify account.
2. **Polling**: The app polls `/v1/me/player/currently-playing` every 3 seconds. A 1-second in-browser ticker keeps the progress bar smooth between polls.
3. **Lyrics**: On track change, `GET /api/get` is called with `track_name`, `artist_name` (primary only), `album_name`, and `duration` (decimal seconds). A 404 falls back to `GET /api/search?q=artist+title`. The active lyric line scrolls to centre automatically.
4. **Colour**: A tiny canvas samples the album art to extract a dominant colour used for the background tint.
