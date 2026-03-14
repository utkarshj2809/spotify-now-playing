import { useState, useEffect, useRef, useCallback } from 'react';
import {
  logout,
} from '../utils/spotify';
import { getActiveLyricIndex } from '../utils/lrclib';
import {
  resolveArtworkUrl,
  decodeHtmlEntities,
} from '../utils/applemusic';
import { useSpotifyPlayer } from '../hooks/useSpotifyPlayer';
import { useLyrics } from '../hooks/useLyrics';
import Lyrics from './Lyrics';
import ShortcutHelp from './ShortcutHelp';
import ThemePicker from './ThemePicker';
import { useToast } from './Toast';
import './NowPlaying.css';

function fmt(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function getGreeting() {
  const h = new Date().getHours();
  if (h >= 5  && h < 12) return 'Good Morning';
  if (h >= 12 && h < 17) return 'Good Afternoon';
  if (h >= 17 && h < 21) return 'Good Evening';
  return 'Good Night';
}

/** k-means color quantization for vibrant background color */
function extractVibrantColor(imgEl) {
  try {
    const size = 32;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    ctx.drawImage(imgEl, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);

    const pixels = [];
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const saturation = max === 0 ? 0 : (max - min) / max;
      if (saturation > 0.15 && max > 30 && max < 240) {
        pixels.push([r, g, b]);
      }
    }

    if (pixels.length === 0) return null;

    const k = 3;
    let centroids = pixels.slice(0, k).map((p) => [...p]);

    for (let iter = 0; iter < 10; iter++) {
      const clusters = Array.from({ length: k }, () => []);
      for (const pixel of pixels) {
        let minDist = Infinity, best = 0;
        for (let ci = 0; ci < k; ci++) {
          const d = Math.hypot(
            pixel[0] - centroids[ci][0],
            pixel[1] - centroids[ci][1],
            pixel[2] - centroids[ci][2],
          );
          if (d < minDist) { minDist = d; best = ci; }
        }
        clusters[best].push(pixel);
      }
      for (let ci = 0; ci < k; ci++) {
        if (clusters[ci].length === 0) continue;
        centroids[ci] = [
          clusters[ci].reduce((s, p) => s + p[0], 0) / clusters[ci].length,
          clusters[ci].reduce((s, p) => s + p[1], 0) / clusters[ci].length,
          clusters[ci].reduce((s, p) => s + p[2], 0) / clusters[ci].length,
        ];
      }
    }

    let best = centroids[0];
    let bestSat = 0;
    for (const cent of centroids) {
      const max = Math.max(...cent), min = Math.min(...cent);
      const sat = max === 0 ? 0 : (max - min) / max;
      if (sat > bestSat) { bestSat = sat; best = cent; }
    }

    const f = 0.25;
    return `rgb(${Math.round(best[0] * f)},${Math.round(best[1] * f)},${Math.round(best[2] * f)})`;
  } catch {
    return null;
  }
}

export default function NowPlaying({ onLogout }) {
  // -- UI state
  const [accentColor,      setAccentColor]      = useState('rgb(18,18,18)');
  const [projector,        setProjector]        = useState(false);
  const [lyricsOpen,       setLyricsOpen]       = useState(true);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [themePreset,      setThemePreset]      = useState(
    () => localStorage.getItem('np-theme') || 'dark',
  );

  // Album art crossfade: two bg layers
  const [bgA,      setBgA]      = useState('');
  const [bgB,      setBgB]      = useState('');
  const [activeBg, setActiveBg] = useState('a');
  const activeBgRef = useRef('a');

  const { ToastContainer } = useToast();
  const hiddenImgRef = useRef(null);

  // -- Color extraction
  const extractColor = useCallback((url) => {
    if (!url) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const color = extractVibrantColor(img);
      if (color) setAccentColor(color);
      // Crossfade to new background
      if (activeBgRef.current === 'a') {
        setBgB(url);
        setActiveBg('b');
        activeBgRef.current = 'b';
      } else {
        setBgA(url);
        setActiveBg('a');
        activeBgRef.current = 'a';
      }
    };
    img.src = url;
  }, []);

  // -- Stable forwarder refs to break the circular dependency between hooks
  // lyricsRefHolder: a ref whose .current holds the actual lyricsRef from useLyrics
  const lyricsRefHolder         = useRef(null);
  const fetchLyricsForTrackRef  = useRef(null);
  const setActiveIdxRef         = useRef(null);

  // -- Player hook (called first so we get the real progressRef/setProgress)
  const {
    track,
    playing,
    progress,
    setProgress,
    progressRef,
    recentlyPlayed,
    error,
    setError,
    isRateLimited,
    poll,
  } = useSpotifyPlayer({
    onTrackChange: useCallback((item) => {
      setLyricsOpen(true);
      extractColor(item.album?.images?.[0]?.url);
      fetchLyricsForTrackRef.current?.(item);
    }, [extractColor]),
    lyricsRef: lyricsRefHolder,
    setActiveIdx: useCallback((i) => setActiveIdxRef.current?.(i), []),
  });

  // -- Lyrics hook (called after useSpotifyPlayer so we have real progressRef/setProgress)
  const {
    lyrics,
    synced,
    activeIdx,
    provider,
    amResults,
    amPickerOpen,
    amSelectedId,
    lyricsRef,
    setActiveIdx,
    fetchLyricsForTrack,
    handleProviderChangeAndFetch,
    handleAmResultSelect,
    setAmPickerOpen,
  } = useLyrics({
    progressRef,
    setProgress,
  });

  // Sync forwarders every render so callbacks inside useSpotifyPlayer always see
  // the latest versions of these functions from useLyrics.
  // lyricsRefHolder.current points to the stable lyricsRef object from useLyrics
  // so useSpotifyPlayer can read lyricsRefHolder.current.current for the lyrics array.
  lyricsRefHolder.current        = lyricsRef;
  fetchLyricsForTrackRef.current = fetchLyricsForTrack;
  setActiveIdxRef.current        = setActiveIdx;

  // Bug 5: wrap handleAmResultSelect to always inject real progressRef
  const handleAmResultSelectWithProgress = useCallback(
    (result) => handleAmResultSelect(result, progressRef),
    [handleAmResultSelect, progressRef],
  );

  // -- Apply theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', themePreset);
    localStorage.setItem('np-theme', themePreset);
  }, [themePreset]);

  // -- Update browser tab title
  useEffect(() => {
    if (track) {
      const artist = track.artists?.map((a) => a.name).join(', ') ?? '';
      document.title = artist ? `${track.name} · ${artist}` : track.name;
    } else {
      document.title = 'Now Playing';
    }
  }, [track]);

  // -- Sync active lyric when lyrics load
  useEffect(() => {
    if (lyrics) {
      setActiveIdx(getActiveLyricIndex(lyrics, progressRef.current / 1000));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lyrics]);

  // -- Keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'l' || e.key === 'L') {
        setLyricsOpen((v) => !v);
      } else if (e.key === '?') {
        setShortcutHelpOpen((v) => !v);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // -- Handlers
  function handleLogout() { logout(); onLogout(); }
  function retry() { setError(''); poll(); }

  // -- Render: error
  if (error) {
    return (
      <div className="np-center-screen">
        <p className="np-msg">{error}</p>
        <button className="np-pill-btn" onClick={retry}>Retry</button>
        <button className="np-pill-btn np-pill-btn--ghost" onClick={handleLogout}>Logout</button>
      </div>
    );
  }

  // -- Render: nothing playing
  if (!track) {
    return (
      <div className="np-center-screen">
        <svg className="np-idle-icon" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
        </svg>
        <p className="np-msg">Nothing playing right now</p>
        <p className="np-hint">Open Spotify and play something!</p>
        {recentlyPlayed.length > 0 && (
          <>
            <p className="np-hint" style={{ marginTop: '1rem', opacity: 0.7 }}>Recently played</p>
            <ul className="np-recent-list">
              {recentlyPlayed.map((item, i) => {
                const t = item.track;
                const rArt = t?.album?.images?.[1]?.url ?? t?.album?.images?.[0]?.url;
                const rArtist = t?.artists?.map((a) => a.name).join(', ') ?? '';
                return (
                  <li key={`${t?.id}-${i}`} className="np-recent-item">
                    {rArt && <img className="np-recent-art" src={rArt} alt={t?.name} />}
                    <div className="np-recent-meta">
                      <span className="np-recent-title">{t?.name}</span>
                      <span className="np-recent-artist">{rArtist}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <button className="np-pill-btn np-pill-btn--ghost" onClick={handleLogout} style={{ marginTop: '1.5rem' }}>Logout</button>
        <ToastContainer />
      </div>
    );
  }

  const art      = track.album?.images?.[0]?.url;
  const artist   = track.artists?.map((a) => a.name).join(', ') ?? '';
  const album    = track.album?.name ?? '';
  const pct      = track.duration_ms ? Math.min(progress / track.duration_ms, 1) * 100 : 0;
  const hasLyrics = Array.isArray(lyrics) && lyrics.length > 0;
  const lyricsPanelOpen = amPickerOpen || (hasLyrics && lyricsOpen);
  const panelOpen = lyricsPanelOpen;

  // -- Render: projector mode
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

  // -- Render: main view
  return (
    <div className="np-root" style={{ '--accent-bg': accentColor }}>
      {/* Blurred album-art background (two layers for crossfade) */}
      <div
        className={`np-bg-layer ${activeBg === 'a' ? 'np-bg-layer--visible' : 'np-bg-layer--hidden'}`}
        style={{ backgroundImage: bgA ? `url(${bgA})` : 'none' }}
      />
      <div
        className={`np-bg-layer ${activeBg === 'b' ? 'np-bg-layer--visible' : 'np-bg-layer--hidden'}`}
        style={{ backgroundImage: bgB ? `url(${bgB})` : 'none' }}
      />
      <div className="np-bg-overlay" />

      {/* Accessibility: announce track changes to screen readers */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {track ? `Now playing: ${track.name} by ${artist}` : ''}
      </div>

      {/* Header bar */}
      <header className="np-header">
        <span className="np-header-brand">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
          </svg>
          Now Playing
        </span>

        <span className="np-header-greeting">{getGreeting()}</span>

        <div className="np-header-actions">
          {isRateLimited && (
            <span className="np-rate-limit-badge" title="Spotify API rate limited — retrying…">
              ⏱ Rate limited
            </span>
          )}

          {/* Provider selector */}
          <div className="np-provider-toggle">
            <button
              className={`np-provider-btn ${provider === 'lrclib' ? 'np-provider-btn--active' : ''}`}
              onClick={() => handleProviderChangeAndFetch('lrclib', track)}
              title="Use LRCLib lyrics"
            >
              LRCLib
            </button>
            <button
              className={`np-provider-btn ${provider === 'apple-music' ? 'np-provider-btn--active' : ''}`}
              onClick={() => handleProviderChangeAndFetch('apple-music', track)}
              title="Use Apple Music lyrics"
            >
              Apple Music
            </button>
          </div>

          <ThemePicker currentTheme={themePreset} onChange={setThemePreset} />

          <button
            className="np-icon-btn"
            onClick={() => setShortcutHelpOpen(true)}
            title="Keyboard shortcuts (?)"
            aria-label="Show keyboard shortcuts"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </button>

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
      <main className={`np-main ${panelOpen ? 'np-main--split' : ''}`}>
        {/* Left panel: player */}
        <section className="np-player">
          {/* Album art */}
          <div className="np-art-wrap">
            <img
              key={track.id}
              className={`np-art ${playing ? 'np-art--playing' : ''}`}
              src={art}
              alt={`${track.name} album art`}
              crossOrigin="anonymous"
              ref={hiddenImgRef}
            />
          </div>

          {/* Track info */}
          <div key={track.id} className="np-info">
            <h2 className="np-track">
              {track.name}
              {track.explicit && <span className="np-explicit-badge">E</span>}
            </h2>
            <p className="np-artist">{artist}</p>
            <p className="np-album">{album}</p>
          </div>

          {/* Progress bar */}
          <div className="np-scrubber">
            <span className="np-time">{fmt(progress)}</span>
            <div
              className="np-bar-track"
              role="progressbar"
              aria-valuenow={Math.round(pct)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Track progress"
              aria-valuetext={`${fmt(progress)} of ${fmt(track.duration_ms)}`}
            >
              <div
                className="np-bar-fill"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="np-time">{fmt(track.duration_ms)}</span>
          </div>

          {/* Pill toggles row */}
          <div className="np-controls">
            <div className="np-pill-row">
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
          </div>

          {/* Inline active lyric peek */}
          {hasLyrics && !lyricsOpen && synced && activeIdx >= 0 && lyrics[activeIdx]?.text && (
            <p key={activeIdx} className="np-lyric-peek" onClick={() => setLyricsOpen(true)}>
              {lyrics[activeIdx].text}
            </p>
          )}
        </section>

        {/* Center panel: lyrics or AM picker */}
        {lyricsPanelOpen && (
          <section className="np-lyrics-panel">
            {amPickerOpen ? (
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
                        onClick={() => handleAmResultSelectWithProgress(r)}
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
                trackId={track.id}
              />
            )}
          </section>
        )}
      </main>

      {/* Shortcut help modal */}
      {shortcutHelpOpen && (
        <ShortcutHelp onClose={() => setShortcutHelpOpen(false)} />
      )}

      <ToastContainer />
    </div>
  );
}
