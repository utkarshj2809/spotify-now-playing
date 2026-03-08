import { useState, useEffect, useRef, useCallback } from 'react';
import { getCurrentlyPlaying, logout } from '../utils/spotify';
import { fetchLyrics, getActiveLyricIndex } from '../utils/lrclib';
import { fetchSpotifyLyrics } from '../utils/spotifylyrics';
import {
  searchAppleMusic,
  fetchAppleMusicLyrics,
  findBestMatch,
  resolveArtworkUrl,
  decodeHtmlEntities,
} from '../utils/applemusic';
import Lyrics from './Lyrics';
import './NowPlaying.css';

// How often (ms) we poll Spotify for track state
const POLL_MS = 3_000;

function fmt(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Extract the dominant (darkened) RGB from a small canvas sample of the art. */
function sampleColor(imgEl) {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 4;
    const ctx = c.getContext('2d');
    ctx.drawImage(imgEl, 0, 0, 4, 4);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    const f = 0.3;
    return `rgb(${Math.round(r * f)},${Math.round(g * f)},${Math.round(b * f)})`;
  } catch {
    return null;
  }
}

export default function NowPlaying({ onLogout }) {
  // ── Track state ───────────────────────────────────────────────
  const [track, setTrack]         = useState(null);   // Spotify track object
  const [playing, setPlaying]     = useState(false);
  const [progress, setProgress]   = useState(0);      // ms
  const [error, setError]         = useState('');

  // ── Lyrics state ─────────────────────────────────────────────
  const [lyrics, setLyrics]       = useState(null);   // parsed line array or null
  const [synced, setSynced]       = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);

  // ── Provider state ────────────────────────────────────────────
  const [provider, setProvider]   = useState(
    () => localStorage.getItem('lyrics-provider') || 'lrclib',
  );
  // Apple Music search results & picker
  const [amResults, setAmResults]       = useState([]);
  const [amPickerOpen, setAmPickerOpen] = useState(false);
  const [amSelectedId, setAmSelectedId] = useState(null);

  // ── UI state ─────────────────────────────────────────────────
  const [accentColor, setAccentColor] = useState('rgb(18,18,18)');
  const [projector, setProjector]     = useState(false);
  const [lyricsOpen, setLyricsOpen]   = useState(true);

  // ── Internal refs (survive re-renders without causing them) ──
  const trackIdRef   = useRef(null);
  const progressRef  = useRef(0);
  const playingRef   = useRef(false);
  const lyricsRef    = useRef(null);   // mirror of lyrics state for the ticker
  const tickerRef    = useRef(null);
  const hiddenImgRef = useRef(null);
  const providerRef  = useRef(provider); // always holds latest provider value

  // Keep providerRef in sync with provider state
  useEffect(() => {
    providerRef.current = provider;
    localStorage.setItem('lyrics-provider', provider);
  }, [provider]);

  // ── Color extraction ─────────────────────────────────────────
  const extractColor = useCallback((url) => {
    if (!url) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const color = sampleColor(img);
      if (color) setAccentColor(color);
    };
    img.src = url;
  }, []);

  // ── Shared helper: commit a fetched lyrics result to state ───
  const commitLyrics = useCallback((result) => {
    const isSynced = Array.isArray(result) && result.every((l) => l.time !== null);
    setSynced(isSynced);
    setLyrics(result);
    lyricsRef.current = result;
  }, []);

  // ── Fetch lyrics for a track (uses current provider via ref) ─
  const fetchLyricsForTrack = useCallback(async (item) => {
    const primaryArtist = item.artists?.[0]?.name ?? '';
    const albumName     = item.album?.name ?? '';
    const durationSec   = item.duration_ms != null ? item.duration_ms / 1000 : undefined;

    if (providerRef.current === 'apple-music') {
      // Search Apple Music
      const query   = `${primaryArtist} ${item.name}`;
      const results = await searchAppleMusic(query);
      setAmResults(results);

      const best = findBestMatch(results, { artist: primaryArtist, title: item.name });
      if (best) {
        setAmSelectedId(best.id);
        commitLyrics(await fetchAppleMusicLyrics(best.id));
      } else {
        // No match found — open picker so the user can choose
        setAmPickerOpen(true);
        setLyrics(null);
        lyricsRef.current = null;
      }
    } else if (providerRef.current === 'spotify') {
      // Spotify lyrics via paxsenix (LRC text by Spotify track ID)
      commitLyrics(await fetchSpotifyLyrics(item.id));
    } else {
      // LRCLib (default)
      commitLyrics(await fetchLyrics({
        title:    item.name,
        artist:   primaryArtist,
        album:    albumName,
        duration: durationSec,
      }));
    }
  }, [commitLyrics]);

  // ── Core poller ───────────────────────────────────────────────
  const poll = useCallback(async () => {
    try {
      const data = await getCurrentlyPlaying();

      if (!data || !data.item) {
        setTrack(null);
        setPlaying(false);
        playingRef.current = false;
        return;
      }

      const item      = data.item;
      const isPlaying = data.is_playing;

      // Sync progress & playing state every poll
      progressRef.current = data.progress_ms;
      playingRef.current  = isPlaying;
      setProgress(data.progress_ms);
      setPlaying(isPlaying);

      // Only fetch lyrics / update track when the song actually changes
      if (item.id === trackIdRef.current) return;
      trackIdRef.current = item.id;

      setTrack(item);
      setActiveIdx(-1);
      setLyrics(null);
      setAmResults([]);
      setAmSelectedId(null);
      setAmPickerOpen(false);
      lyricsRef.current = null;

      // Extract album-art accent color
      extractColor(item.album?.images?.[0]?.url);

      await fetchLyricsForTrack(item);
    } catch (err) {
      console.error('Spotify poll error:', err);
      setError('Could not reach Spotify. Check your connection and try again.');
    }
  }, [extractColor, fetchLyricsForTrack]);

  // ── Smooth progress ticker (runs every second) ────────────────
  const startTicker = useCallback(() => {
    if (tickerRef.current) clearInterval(tickerRef.current);
    tickerRef.current = setInterval(() => {
      if (!playingRef.current) return;

      progressRef.current += 1_000;
      const ms = progressRef.current;
      setProgress(ms);

      const lines = lyricsRef.current;
      if (lines) {
        setActiveIdx(getActiveLyricIndex(lines, ms / 1000));
      }
    }, 1_000);
  }, []);

  // ── Mount / unmount ───────────────────────────────────────────
  useEffect(() => {
    // Defer initial poll so it runs outside the synchronous effect body,
    // satisfying the react-hooks/set-state-in-effect lint rule.
    const initTimer = setTimeout(poll, 0);
    startTicker();
    const pollTimer = setInterval(poll, POLL_MS);
    return () => {
      clearTimeout(initTimer);
      clearInterval(pollTimer);
      clearInterval(tickerRef.current);
    };
  }, [poll, startTicker]);

  // ── Sync active lyric when lyrics first load ──────────────────
  useEffect(() => {
    if (lyrics) {
      setActiveIdx(getActiveLyricIndex(lyrics, progressRef.current / 1000));
    }
  }, [lyrics]);

  // ── Update browser tab title with the current track ──────────
  useEffect(() => {
    if (track) {
      const artist = track.artists?.map((a) => a.name).join(', ') ?? '';
      document.title = artist ? `${track.name} · ${artist}` : track.name;
    } else {
      document.title = 'Now Playing';
    }
  }, [track]);

  // ── Handlers ─────────────────────────────────────────────────
  function handleLogout() { logout(); onLogout(); }

  function retry() { setError(''); poll(); }

  // Switch provider and re-fetch lyrics for the current track
  async function handleProviderChange(next) {
    setProvider(next);
    providerRef.current = next;
    localStorage.setItem('lyrics-provider', next);

    if (!track) return;
    setLyrics(null);
    setAmResults([]);
    setAmSelectedId(null);
    setAmPickerOpen(false);
    lyricsRef.current = null;
    setActiveIdx(-1);
    await fetchLyricsForTrack(track);
  }

  // User picked a specific Apple Music search result
  async function handleAmResultSelect(result) {
    setAmSelectedId(result.id);
    setAmPickerOpen(false);
    setLyrics(null);
    lyricsRef.current = null;
    setActiveIdx(-1);
    const fetched = await fetchAppleMusicLyrics(result.id);
    commitLyrics(fetched);
    if (fetched) {
      setActiveIdx(getActiveLyricIndex(fetched, progressRef.current / 1000));
    }
  }

  // ── Render: error ─────────────────────────────────────────────
  if (error) {
    return (
      <div className="np-center-screen">
        <p className="np-msg">{error}</p>
        <button className="np-pill-btn" onClick={retry}>Retry</button>
        <button className="np-pill-btn np-pill-btn--ghost" onClick={handleLogout}>Logout</button>
      </div>
    );
  }

  // ── Render: nothing playing ───────────────────────────────────
  if (!track) {
    return (
      <div className="np-center-screen">
        <svg className="np-idle-icon" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
        </svg>
        <p className="np-msg">Nothing playing right now</p>
        <p className="np-hint">Open Spotify and play something!</p>
        <button className="np-pill-btn np-pill-btn--ghost" onClick={handleLogout}>Logout</button>
      </div>
    );
  }

  const art      = track.album?.images?.[0]?.url;
  const artist   = track.artists?.map((a) => a.name).join(', ') ?? '';
  const album    = track.album?.name ?? '';
  const pct      = track.duration_ms ? Math.min(progress / track.duration_ms, 1) * 100 : 0;
  const hasLyrics = Array.isArray(lyrics) && lyrics.length > 0;

  // ── Render: projector mode ────────────────────────────────────
  if (projector) {
    return (
      <div className="proj-root" style={{ '--art-bg': art ? `url(${art})` : 'none' }}>
        <div className="proj-blur" />
        <div className="proj-overlay" />

        <button className="proj-exit" onClick={() => setProjector(false)} title="Exit projector mode">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M8 21H5a2 2 0 0 0-2-2v-3M21 16v3a2 2 0 0 0-2 2h-3" />
          </svg>
        </button>

        <img className="proj-art" src={art} alt={track.name} />
        <h1 className="proj-title">{track.name}</h1>
        <p className="proj-artist">{artist}</p>

        <div className="proj-progress">
          <div className="proj-fill" style={{ width: `${pct}%` }} />
        </div>

        {playing && (
          <div className="proj-bars" aria-label="Playing">
            <span /><span /><span /><span />
          </div>
        )}
      </div>
    );
  }

  // ── Render: main view ─────────────────────────────────────────
  return (
    <div className="np-root" style={{ '--accent-bg': accentColor }}>
      {/* Blurred album-art background */}
      {art && <div className="np-bg-art" style={{ backgroundImage: `url(${art})` }} />}
      <div className="np-bg-overlay" />

      {/* Header bar */}
      <header className="np-header">
        <span className="np-header-brand">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
          </svg>
          Now Playing
        </span>

        <div className="np-header-actions">
          {/* Provider selector */}
          <div className="np-provider-toggle">
            <button
              className={`np-provider-btn ${provider === 'lrclib' ? 'np-provider-btn--active' : ''}`}
              onClick={() => handleProviderChange('lrclib')}
              title="Use LRCLib lyrics"
            >
              LRCLib
            </button>
            <button
              className={`np-provider-btn ${provider === 'spotify' ? 'np-provider-btn--active' : ''}`}
              onClick={() => handleProviderChange('spotify')}
              title="Use Spotify lyrics"
            >
              Spotify
            </button>
            <button
              className={`np-provider-btn ${provider === 'apple-music' ? 'np-provider-btn--active' : ''}`}
              onClick={() => handleProviderChange('apple-music')}
              title="Use Apple Music lyrics"
            >
              Apple Music
            </button>
          </div>

          <button
            className="np-icon-btn"
            onClick={() => setProjector(true)}
            title="Projector / ambient mode"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M8 21H5a2 2 0 0 0-2-2v-3M21 16v3a2 2 0 0 0-2 2h-3" />
            </svg>
          </button>
          <button className="np-icon-btn" onClick={handleLogout} title="Logout">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
            </svg>
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className={`np-main ${hasLyrics && lyricsOpen ? 'np-main--split' : ''}`}>
        {/* ── Left panel: player ─────────────────────────────── */}
        <section className="np-player">
          {/* Album art */}
          <div className="np-art-wrap">
            <img
              className={`np-art ${playing ? 'np-art--playing' : ''}`}
              src={art}
              alt={`${track.name} album art`}
              crossOrigin="anonymous"
              ref={hiddenImgRef}
            />
          </div>

          {/* Track info */}
          <div className="np-info">
            <h2 className="np-track">{track.name}</h2>
            <p className="np-artist">{artist}</p>
            <p className="np-album">{album}</p>
          </div>

          {/* Progress bar */}
          <div className="np-scrubber">
            <span className="np-time">{fmt(progress)}</span>
            <div className="np-bar-track" role="progressbar" aria-valuenow={pct}>
              <div className="np-bar-fill" style={{ width: `${pct}%` }} />
            </div>
            <span className="np-time">{fmt(track.duration_ms)}</span>
          </div>

          {/* Status / lyrics toggle */}
          <div className="np-controls">
            {playing ? (
              <div className="np-playing-tag" aria-label="Playing">
                <span className="np-eq-bar" /><span className="np-eq-bar" /><span className="np-eq-bar" /><span className="np-eq-bar" />
                Playing
              </div>
            ) : (
              <div className="np-paused-tag">Paused</div>
            )}

            {hasLyrics && (
              <button
                className={`np-lyrics-toggle ${lyricsOpen ? 'active' : ''}`}
                onClick={() => setLyricsOpen((v) => !v)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 6h18M3 12h18M3 18h12" />
                </svg>
                Lyrics
              </button>
            )}

            {/* Apple Music: button to open/re-open result picker */}
            {provider === 'apple-music' && amResults.length > 0 && (
              <button
                className="np-lyrics-toggle"
                onClick={() => setAmPickerOpen((v) => !v)}
                title="Choose a different Apple Music match"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
                </svg>
                Match
              </button>
            )}
          </div>

          {/* Inline active lyric peek (when lyrics panel is collapsed) */}
          {hasLyrics && !lyricsOpen && synced && activeIdx >= 0 && lyrics[activeIdx]?.text && (
            <p className="np-lyric-peek" onClick={() => setLyricsOpen(true)}>
              {lyrics[activeIdx].text}
            </p>
          )}
        </section>

        {/* ── Right panel: lyrics or AM picker ──────────────── */}
        {(hasLyrics && lyricsOpen) || amPickerOpen ? (
          <section className="np-lyrics-panel">
            {amPickerOpen ? (
              /* Apple Music search result picker */
              <div className="am-picker">
                <div className="am-picker-header">
                  <span>Choose the correct match</span>
                  {hasLyrics && (
                    <button className="am-picker-close" onClick={() => setAmPickerOpen(false)}>
                      ✕
                    </button>
                  )}
                </div>
                {amResults.length === 0 ? (
                  <p className="am-picker-empty">No results found for this track.</p>
                ) : (
                  <ul className="am-picker-list">
                    {amResults.map((r) => (
                      <li
                        key={r.id}
                        className={`am-picker-item ${amSelectedId === r.id ? 'am-picker-item--selected' : ''}`}
                        onClick={() => handleAmResultSelect(r)}
                      >
                        {r.artwork && (
                          <img
                            className="am-picker-art"
                            src={resolveArtworkUrl(r.artwork, 60)}
                            alt={r.songName}
                          />
                        )}
                        <div className="am-picker-meta">
                          <span className="am-picker-title">{r.songName}</span>
                          <span className="am-picker-artist">{decodeHtmlEntities(r.artistName)}</span>
                          <span className="am-picker-album">{r.albumName}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <Lyrics
                lines={lyrics}
                activeIndex={activeIdx}
                isSynced={synced}
                progressSec={progress / 1000}
              />
            )}
          </section>
        ) : null}
      </main>
    </div>
  );
}
