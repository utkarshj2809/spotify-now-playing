import { useState, useEffect, useRef, useCallback } from 'react';
import { getCurrentlyPlaying, logout, skipToNext, skipToPrevious, seekToPosition, getQueue, togglePlayback, toggleShuffle, setRepeatMode, setVolume, checkTrackSaved, saveTrack, removeTrack, getRecentlyPlayed } from '../utils/spotify';
import { fetchLyrics, getActiveLyricIndex } from '../utils/lrclib';
import {
  searchAppleMusic,
  fetchAppleMusicLyrics,
  findBestMatch,
  resolveArtworkUrl,
  decodeHtmlEntities,
} from '../utils/applemusic';
import Lyrics from './Lyrics';
import { useToast } from './Toast';
import './NowPlaying.css';

// How often (ms) we poll Spotify for track state
const POLL_MS = 3_000;

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

/** Extract the dominant (darkened) RGB from an 8×8 canvas sample of the art. */
function sampleColor(imgEl) {
  try {
    const size = 8;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    ctx.drawImage(imgEl, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);
    const pixels = size * size;
    let rSum = 0, gSum = 0, bSum = 0;
    for (let i = 0; i < pixels * 4; i += 4) {
      rSum += data[i];
      gSum += data[i + 1];
      bSum += data[i + 2];
    }
    const f = 0.3;
    const r = Math.round((rSum / pixels) * f);
    const g = Math.round((gSum / pixels) * f);
    const b = Math.round((bSum / pixels) * f);
    return `rgb(${r},${g},${b})`;
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
    () => localStorage.getItem('lyrics-provider') || 'apple-music',
  );
  // Apple Music search results & picker
  const [amResults, setAmResults]       = useState([]);
  const [amPickerOpen, setAmPickerOpen] = useState(false);
  const [amSelectedId, setAmSelectedId] = useState(null);

  // ── UI state ─────────────────────────────────────────────────
  const [accentColor, setAccentColor] = useState('rgb(18,18,18)');
  const [projector, setProjector]     = useState(false);
  const [lyricsOpen, setLyricsOpen]   = useState(true);
  const [queue, setQueue]             = useState([]);
  const [queueOpen, setQueueOpen]     = useState(false);
  const [shuffle, setShuffle]         = useState(false);
  const [repeatState, setRepeatState] = useState('off');   // 'off' | 'context' | 'track'
  const [volume, setVolumeState]      = useState(100);
  const [liked, setLiked]             = useState(false);
  const [recentlyPlayed, setRecentlyPlayed] = useState([]);

  // ── Toast ─────────────────────────────────────────────────────
  const { showToast, ToastContainer } = useToast();

  // ── Internal refs (survive re-renders without causing them) ──
  const trackIdRef    = useRef(null);
  const progressRef   = useRef(0);
  const playingRef    = useRef(false);
  const shuffleRef    = useRef(false);
  const repeatRef     = useRef('off');
  const lyricsRef     = useRef(null);   // mirror of lyrics state for the ticker
  const tickerRef     = useRef(null);
  const hiddenImgRef  = useRef(null);
  const providerRef   = useRef(provider); // always holds latest provider value
  const volumeDebRef  = useRef(null);     // debounce timer for volume

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
      // Search Apple Music, using Spotify track ID as cache key
      const query   = `${primaryArtist} ${item.name}`;
      const results = await searchAppleMusic(query, item.id);
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
    } else {
      // LRCLib — pass Spotify track ID as cache key
      commitLyrics(await fetchLyrics({
        title:    item.name,
        artist:   primaryArtist,
        album:    albumName,
        duration: durationSec,
        trackId:  item.id,
      }));
    }
  }, [commitLyrics]);

  // ── Core poller ───────────────────────────────────────────────
  const poll = useCallback(async () => {
    try {
      const [data, queueData] = await Promise.all([
        getCurrentlyPlaying(),
        getQueue(),
      ]);

      if (!data || !data.item) {
        setTrack(null);
        setPlaying(false);
        playingRef.current = false;
        // Load recently played when idle
        try {
          const recent = await getRecentlyPlayed();
          if (recent?.items) {
            setRecentlyPlayed(recent.items.slice(0, 5));
          }
        } catch {
          // ignore
        }
        return;
      }

      const item      = data.item;
      const isPlaying = data.is_playing;

      // Sync progress & playing state every poll
      progressRef.current = data.progress_ms;
      playingRef.current  = isPlaying;
      setProgress(data.progress_ms);
      setPlaying(isPlaying);
      const shuffleState = data.shuffle_state ?? false;
      shuffleRef.current = shuffleState;
      setShuffle(shuffleState);

      // Sync repeat state
      if (data.repeat_state) {
        repeatRef.current = data.repeat_state;
        setRepeatState(data.repeat_state);
      }

      // Sync volume from active device
      if (data.device?.volume_percent != null) {
        setVolumeState(data.device.volume_percent);
      }

      // Update queue on every poll
      if (queueData?.queue) {
        setQueue(queueData.queue.filter((t) => t.type === 'track').slice(0, 15));
      }

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

      // Check if track is liked
      checkTrackSaved(item.id).then(setLiked).catch(() => {});

      // Extract album-art accent color
      extractColor(item.album?.images?.[0]?.url);

      await fetchLyricsForTrack(item);
    } catch (err) {
      console.error('Spotify poll error:', err);
      setError('Could not reach Spotify. Check your connection and try again.');
    }
  }, [extractColor, fetchLyricsForTrack]);

  // ── Smooth progress ticker (runs every 100 ms for word-level accuracy) ──
  const startTicker = useCallback(() => {
    if (tickerRef.current) clearInterval(tickerRef.current);
    tickerRef.current = setInterval(() => {
      if (!playingRef.current) return;

      progressRef.current += 100;
      const ms = progressRef.current;
      setProgress(ms);

      const lines = lyricsRef.current;
      if (lines) {
        setActiveIdx(getActiveLyricIndex(lines, ms / 1000));
      }
    }, 100);
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

  // ── Keyboard shortcuts ────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e) {
      // Ignore when typing in an input/textarea
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if (e.code === 'Space') {
        e.preventDefault();
        const wasPlaying = playingRef.current;
        playingRef.current = !wasPlaying;
        setPlaying(!wasPlaying);
        togglePlayback(wasPlaying).then(() => setTimeout(poll, 800)).catch(() => {});
      } else if (e.code === 'ArrowRight' && e.shiftKey) {
        e.preventDefault();
        skipToNext().then(() => setTimeout(poll, 800)).catch(() => {});
      } else if (e.code === 'ArrowLeft' && e.shiftKey) {
        e.preventDefault();
        skipToPrevious().then(() => setTimeout(poll, 800)).catch(() => {});
      } else if (e.key === 'l' || e.key === 'L') {
        setLyricsOpen((v) => !v);
      } else if (e.key === 's' || e.key === 'S') {
        const newShuffle = !shuffleRef.current;
        shuffleRef.current = newShuffle;
        setShuffle(newShuffle);
        toggleShuffle(newShuffle).catch(() => {});
      } else if (e.key === 'r' || e.key === 'R') {
        const cycle = { off: 'context', context: 'track', track: 'off' };
        const newRepeat = cycle[repeatRef.current] ?? 'off';
        repeatRef.current = newRepeat;
        setRepeatState(newRepeat);
        setRepeatMode(newRepeat).catch(() => {});
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  // Stable: only reads from refs (playingRef, shuffleRef, repeatRef) and stable setters.
  // poll is excluded intentionally — reading it via closure is safe since it's derived from refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Handlers ─────────────────────────────────────────────────
  function handleLogout() { logout(); onLogout(); }

  function retry() { setError(''); poll(); }

  async function handleSkipNext() {
    await skipToNext();
    setTimeout(poll, 800);
  }

  async function handleSkipPrev() {
    await skipToPrevious();
    setTimeout(poll, 800);
  }

  async function handleTogglePlayback() {
    const wasPlaying = playingRef.current;
    // Optimistic update
    playingRef.current = !wasPlaying;
    setPlaying(!wasPlaying);
    await togglePlayback(wasPlaying);
    setTimeout(poll, 800);
  }

  async function handleToggleShuffle() {
    const newState = !shuffleRef.current;
    shuffleRef.current = newState;
    setShuffle(newState);
    await toggleShuffle(newState);
    showToast(newState ? '🔀 Shuffle on' : '🔀 Shuffle off');
  }

  async function handleToggleRepeat() {
    const cycle = { off: 'context', context: 'track', track: 'off' };
    const newState = cycle[repeatRef.current] ?? 'off';
    repeatRef.current = newState;
    setRepeatState(newState);
    await setRepeatMode(newState);
    const labels = { off: '🔁 Repeat off', context: '🔁 Repeat all', track: '🔂 Repeat one' };
    showToast(labels[newState] ?? '🔁 Repeat');
  }

  async function handleLike() {
    const newLiked = !liked;
    setLiked(newLiked);
    if (track?.id) {
      if (newLiked) {
        await saveTrack(track.id);
        showToast('❤️ Liked');
      } else {
        await removeTrack(track.id);
        showToast('🖤 Removed from liked');
      }
    }
  }

  function handleVolumeChange(e) {
    const val = Number(e.target.value);
    setVolumeState(val);
    clearTimeout(volumeDebRef.current);
    volumeDebRef.current = setTimeout(async () => {
      try {
        await setVolume(val);
        if (val === 0) showToast('🔇 Muted');
      } catch {
        // Revert UI on failure
        setVolumeState((prev) => prev);
      }
    }, 300);
  }

  function handleSeek(e) {
    if (!track?.duration_ms) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const posMs = fraction * track.duration_ms;
    // Optimistic update: move the UI immediately for instant feedback.
    // The next poll (≤3 s) will correct the position if the API call fails.
    progressRef.current = posMs;
    setProgress(posMs);
    if (lyricsRef.current) {
      setActiveIdx(getActiveLyricIndex(lyricsRef.current, posMs / 1000));
    }
    seekToPosition(posMs);
  }

  function handleLyricSeek(posMs) {
    // Optimistic update: move the UI immediately for instant feedback.
    // The next poll (≤3 s) will correct the position if the API call fails.
    progressRef.current = posMs;
    setProgress(posMs);
    if (lyricsRef.current) {
      setActiveIdx(getActiveLyricIndex(lyricsRef.current, posMs / 1000));
    }
    seekToPosition(posMs);
  }

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
  const queuePanelOpen  = queueOpen && queue.length > 0;
  const panelOpen = lyricsPanelOpen || queuePanelOpen;

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

        <span className="np-header-greeting">{getGreeting()}</span>

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
      <main className={`np-main ${panelOpen ? 'np-main--split' : ''}`}>
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
            <h2 className="np-track">
              {track.name}
              {track.explicit && <span className="np-explicit-badge">E</span>}
            </h2>
            <p className="np-artist">{artist}</p>
            <p className="np-album">{album}</p>
          </div>

          {/* Clickable progress / scrubber */}
          <div className="np-scrubber">
            <span className="np-time">{fmt(progress)}</span>
            <div
              className="np-bar-track np-bar-track--seekable"
              role="slider"
              aria-valuenow={Math.round(pct)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Track progress"
              onClick={handleSeek}
            >
              <div className="np-bar-fill" style={{ width: `${pct}%` }} />
            </div>
            <span className="np-time">{fmt(track.duration_ms)}</span>
          </div>

          {/* Volume slider */}
          <div className="np-volume-row">
            <svg className="np-volume-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              {volume === 0 ? (
                <path d="M3.63 3.63a.996.996 0 0 0 0 1.41L7.29 8.7 7 9H4c-.55 0-1 .45-1 1v4c0 .55.45 1 1 1h3l3.29 3.29c.63.63 1.71.18 1.71-.71v-4.17l4.18 4.18c-.49.37-1.02.68-1.6.91-.36.15-.58.53-.58.92 0 .72.73 1.18 1.39.91.8-.33 1.55-.77 2.22-1.31l1.34 1.34a.996.996 0 1 0 1.41-1.41L5.05 3.63c-.39-.39-1.02-.39-1.42 0zM19 12c0 .82-.15 1.61-.41 2.34l1.53 1.53c.56-1.17.88-2.48.88-3.87 0-3.83-2.4-7.11-5.78-8.4-.59-.23-1.22.23-1.22.86v.19c0 .38.25.71.61.85C17.18 6.54 19 9.06 19 12zm-8.71-6.29-.17.17L12 7.76V6.41c0-.89-1.08-1.33-1.71-.7zM16.5 12A4.5 4.5 0 0 0 14 7.97v1.79l2.48 2.48c.01-.08.02-.16.02-.24z" />
              ) : volume < 50 ? (
                <path d="M18.5 12A4.5 4.5 0 0 0 16 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z" />
              ) : (
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
              )}
            </svg>
            <input
              type="range"
              className="np-volume-slider"
              min="0"
              max="100"
              value={volume}
              onChange={handleVolumeChange}
              aria-label="Volume"
            />
          </div>

          {/* Playback controls */}
          <div className="np-controls">
            {/* ── Row 1: like / shuffle / prev / play-pause / next / repeat ── */}
            <div className="np-playback-row">
              {/* Like button */}
              <button
                className={`np-like-btn${liked ? ' np-like-btn--liked' : ''}`}
                onClick={handleLike}
                title={liked ? 'Remove from Liked Songs' : 'Save to Liked Songs'}
                aria-label={liked ? 'Remove from Liked Songs' : 'Save to Liked Songs'}
                aria-pressed={liked}
              >
                <svg viewBox="0 0 24 24" fill={liked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                </svg>
              </button>

              <button
                className={`np-skip-btn${shuffle ? ' np-skip-btn--active' : ''}`}
                onClick={handleToggleShuffle}
                title={shuffle ? 'Disable shuffle' : 'Enable shuffle'}
                aria-label="Toggle shuffle"
                aria-pressed={shuffle}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="16 3 21 3 21 8" />
                  <line x1="4" y1="20" x2="21" y2="3" />
                  <polyline points="21 16 21 21 16 21" />
                  <line x1="15" y1="15" x2="21" y2="21" />
                </svg>
              </button>

              <button
                className="np-skip-btn"
                onClick={handleSkipPrev}
                title="Previous track"
                aria-label="Previous track"
              >
                <svg viewBox="0 0 20 20" fill="currentColor">
                  <path d="M4 4h2v12H4V4zm10 0l-8 6 8 6V4z" />
                </svg>
              </button>

              <button
                className="np-play-btn"
                onClick={handleTogglePlayback}
                title={playing ? 'Pause' : 'Play'}
                aria-label={playing ? 'Pause' : 'Play'}
              >
                {playing ? (
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="4" width="4" height="16" rx="1" />
                    <rect x="14" y="4" width="4" height="16" rx="1" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </button>

              <button
                className="np-skip-btn"
                onClick={handleSkipNext}
                title="Next track"
                aria-label="Next track"
              >
                <svg viewBox="0 0 20 20" fill="currentColor">
                  <path d="M14 4h2v12h-2V4zM4 4l8 6-8 6V4z" />
                </svg>
              </button>

              {/* Repeat button */}
              <button
                className={`np-repeat-btn${repeatState !== 'off' ? ' np-repeat-active' : ''}${repeatState === 'track' ? ' np-repeat-one' : ''}`}
                onClick={handleToggleRepeat}
                title={repeatState === 'off' ? 'Enable repeat' : repeatState === 'context' ? 'Repeat one track' : 'Disable repeat'}
                aria-label="Toggle repeat"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="17 1 21 5 17 9" />
                  <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                  <polyline points="7 23 3 19 7 15" />
                  <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                </svg>
              </button>
            </div>

            {/* ── Row 2: pill toggles ── */}
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

              {queue.length > 0 && (
                <button
                  className={`np-lyrics-toggle ${queueOpen ? 'active' : ''}`}
                  onClick={() => setQueueOpen((v) => !v)}
                  title="Up Next queue"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 5h18M3 10h18M3 15h12" />
                    <path d="M17 17l3 2.5-3 2.5V17z" strokeLinejoin="round" strokeLinecap="round" />
                  </svg>
                  Up Next
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
          </div>

          {/* Inline active lyric peek (when lyrics panel is collapsed) */}
          {hasLyrics && !lyricsOpen && synced && activeIdx >= 0 && lyrics[activeIdx]?.text && (
            <p className="np-lyric-peek" onClick={() => setLyricsOpen(true)}>
              {lyrics[activeIdx].text}
            </p>
          )}
        </section>

        {/* ── Center panel: lyrics or AM picker ─────────────── */}
        {lyricsPanelOpen && (
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
                onSeek={handleLyricSeek}
              />
            )}
          </section>
        )}

        {/* ── Right panel: Up Next queue ─────────────────────── */}
        {queuePanelOpen && (
          <section className="np-queue-panel">
            <div className="np-queue">
              <div className="np-queue-header">
                <span>Up Next</span>
                <button className="am-picker-close" onClick={() => setQueueOpen(false)}>✕</button>
              </div>
              <ul className="np-queue-list">
                {queue.map((t, i) => {
                  const qArt    = t.album?.images?.[1]?.url ?? t.album?.images?.[0]?.url;
                  const qArtist = t.artists?.map((a) => a.name).join(', ') ?? '';
                  return (
                    <li key={`${t.id}-${i}`} className="np-queue-item">
                      <span className="np-queue-num">{i + 1}</span>
                      {qArt && (
                        <img className="np-queue-art" src={qArt} alt={t.name} />
                      )}
                      <div className="np-queue-meta">
                        <span className="np-queue-title">{t.name}</span>
                        <span className="np-queue-artist">{qArtist}</span>
                      </div>
                      <span className="np-queue-dur">{fmt(t.duration_ms)}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        )}
      </main>
      <ToastContainer />
    </div>
  );
}
