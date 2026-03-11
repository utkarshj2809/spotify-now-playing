import { useState, useEffect, useRef, useCallback } from 'react';
import {
  getCurrentlyPlaying,
  getQueue,
  getRecentlyPlayed,
  getValidToken,
} from '../utils/spotify';
import { getActiveLyricIndex } from '../utils/lrclib';

// Fallback poll interval when SDK is active (30s), fast poll when no SDK (3s)
const POLL_MS_SDK    = 30_000;
const POLL_MS_NOSDK  = 3_000;

/**
 * Dynamically load the Spotify Web Playback SDK script once.
 * Returns a promise that resolves when window.Spotify is available.
 */
function loadSpotifySDK() {
  if (window.Spotify) return Promise.resolve();
  return new Promise((resolve) => {
    window.onSpotifyWebPlaybackSDKReady = resolve;
    if (!document.getElementById('spotify-sdk-script')) {
      const script = document.createElement('script');
      script.id  = 'spotify-sdk-script';
      script.src = 'https://sdk.scdn.co/spotify-player.js';
      script.async = true;
      document.head.appendChild(script);
    }
  });
}

/**
 * useSpotifyPlayer — manages SDK initialization, player state listener,
 * fallback polling, 100ms progress ticker, and exposes playback state.
 *
 * Returns:
 *   { track, playing, progress, progressRef, playingRef, repeatState, repeatRef,
 *     queue, recentlyPlayed, error, sdkReady, deviceId, poll, isRateLimited,
 *     lyricsRef, setActiveIdx }
 *
 * The caller must provide an `onTrackChange(item, extractColorFn)` callback and
 * `lyricsRef` + `setActiveIdx` from useLyrics.
 */
export function useSpotifyPlayer({ onTrackChange, lyricsRef, setActiveIdx }) {
  const [track,          setTrack]          = useState(null);
  const [playing,        setPlaying]        = useState(false);
  const [progress,       setProgress]       = useState(0);
  const [error,          setError]          = useState('');
  const [repeatState,    setRepeatState]    = useState('off');
  const [queue,          setQueue]          = useState([]);
  const [recentlyPlayed, setRecentlyPlayed] = useState([]);
  const [sdkReady,       setSdkReady]       = useState(false);
  const [deviceId,       setDeviceId]       = useState(null);
  const [isRateLimited,  setIsRateLimited]  = useState(false);

  const progressRef        = useRef(0);
  const playingRef         = useRef(false);
  const repeatRef          = useRef('off');
  const trackIdRef         = useRef(null);
  const tickerRef          = useRef(null);
  const playerRef          = useRef(null);      // SDK Player instance
  const sdkActiveRef       = useRef(false);     // is the SDK player the active device?
  const seekBlockUntilRef  = useRef(0);
  const skipCooldownRef    = useRef(false);
  const rateLimitTimerRef  = useRef(null);

  // ── Rate limit helpers ────────────────────────────────────────
  const markRateLimited = useCallback(() => {
    setIsRateLimited(true);
    if (rateLimitTimerRef.current) clearTimeout(rateLimitTimerRef.current);
    rateLimitTimerRef.current = setTimeout(() => setIsRateLimited(false), 10_000);
  }, []);

  // ── 100ms progress ticker ─────────────────────────────────────
  const stopTicker = useCallback(() => {
    if (tickerRef.current) {
      clearInterval(tickerRef.current);
      tickerRef.current = null;
    }
  }, []);

  const startTicker = useCallback(() => {
    if (tickerRef.current) clearInterval(tickerRef.current);
    tickerRef.current = setInterval(() => {
      if (document.hidden) return;

      progressRef.current += 100;
      setProgress(progressRef.current);

      const lines = lyricsRef?.current;
      if (lines && setActiveIdx) {
        setActiveIdx(getActiveLyricIndex(lines, progressRef.current / 1000));
      }
    }, 100);
  }, [lyricsRef, setActiveIdx]);

  // ── Core poll (REST API fallback) ────────────────────────────
  const poll = useCallback(async () => {
    // Skip progress update if we just seeked
    const blockProgress = Date.now() < seekBlockUntilRef.current;

    try {
      const [data, queueData] = await Promise.all([
        getCurrentlyPlaying(),
        getQueue(),
      ]);

      setIsRateLimited(false);

      if (!data || !data.item) {
        setTrack(null);
        setPlaying(false);
        playingRef.current = false;
        stopTicker();
        try {
          const recent = await getRecentlyPlayed();
          if (recent?.items) setRecentlyPlayed(recent.items.slice(0, 5));
        } catch { /* ignore */ }
        return;
      }

      const item      = data.item;
      const isPlaying = data.is_playing;

      if (!blockProgress) {
        progressRef.current = data.progress_ms;
        setProgress(data.progress_ms);
      }

      playingRef.current = isPlaying;
      setPlaying(isPlaying);
      if (isPlaying && !tickerRef.current) startTicker();
      else if (!isPlaying && tickerRef.current) stopTicker();

      if (data.repeat_state !== undefined && data.repeat_state !== null) {
        repeatRef.current = data.repeat_state;
        setRepeatState(data.repeat_state);
      }

      if (queueData?.queue) {
        setQueue(queueData.queue.filter((t) => t.type === 'track').slice(0, 15));
      }

      // Only update track / lyrics when song actually changes
      if (item.id === trackIdRef.current) return;
      trackIdRef.current = item.id;
      setTrack(item);

      if (setActiveIdx) setActiveIdx(-1);
      if (lyricsRef) lyricsRef.current = null;

      if (onTrackChange) onTrackChange(item);
    } catch (err) {
      console.error('Spotify poll error:', err);
      if (err?.message?.includes('429') || err?.status === 429) {
        markRateLimited();
      } else {
        setError('Could not reach Spotify. Check your connection and try again.');
      }
    }
  }, [onTrackChange, lyricsRef, setActiveIdx, markRateLimited, startTicker, stopTicker]);

  // ── SDK initialization ────────────────────────────────────────
  useEffect(() => {
    let player = null;
    let pollTimer = null;
    let destroyed = false;

    async function initSDK() {
      try {
        await loadSpotifySDK();
        if (destroyed) return;

        const token = await getValidToken();
        if (!token || destroyed) return;

        player = new window.Spotify.Player({
          name: 'Now Playing Web',
          getOAuthToken: async (cb) => {
            const t = await getValidToken();
            cb(t);
          },
          volume: 0.8,
        });

        playerRef.current = player;

        player.addListener('ready', ({ device_id }) => {
          if (destroyed) return;
          setDeviceId(device_id);
          setSdkReady(true);
        });

        player.addListener('not_ready', () => {
          setSdkReady(false);
          const wasActive = sdkActiveRef.current;
          sdkActiveRef.current = false;
          if (wasActive) startPolling(); // switch back to fast polling
        });

        player.addListener('player_state_changed', (state) => {
          if (destroyed) return;
          if (!state) {
            // SDK player is not the active device; rely on polling
            const wasActive = sdkActiveRef.current;
            sdkActiveRef.current = false;
            if (wasActive) startPolling(); // switch back to fast polling
            return;
          }

          const wasActive = sdkActiveRef.current;
          sdkActiveRef.current = true;
          if (!wasActive) startPolling(); // switch to slow polling now that SDK is active

          const ct = state.track_window?.current_track;
          if (!ct) return;

          const isPlaying = !state.paused;
          const posMs     = state.position;

          // Block progress updates during seek window
          if (Date.now() >= seekBlockUntilRef.current) {
            progressRef.current = posMs;
            setProgress(posMs);
          }

          playingRef.current = isPlaying;
          setPlaying(isPlaying);
          if (isPlaying && !tickerRef.current) startTicker();
          else if (!isPlaying && tickerRef.current) stopTicker();

          const rmMap = { 0: 'off', 1: 'context', 2: 'track' };
          const rm = rmMap[state.repeat_mode] ?? 'off';
          repeatRef.current = rm;
          setRepeatState(rm);

          // Track change detection
          const newId = ct.id;
          if (newId && newId !== trackIdRef.current) {
            trackIdRef.current = newId;

            // Build a Spotify-like item from SDK state
            const sdkItem = {
              id:           ct.id,
              name:         ct.name,
              uri:          ct.uri,
              duration_ms:  ct.duration_ms,
              explicit:     ct.is_explicit,
              artists:      ct.artists,
              album: {
                name:   ct.album?.name,
                images: ct.album?.images ?? [],
              },
            };

            setTrack(sdkItem);
            if (setActiveIdx) setActiveIdx(-1);
            if (lyricsRef) lyricsRef.current = null;
            if (onTrackChange) onTrackChange(sdkItem);
          }

          // Update queue from next_tracks
          if (state.track_window?.next_tracks) {
            const nextTracks = state.track_window.next_tracks
              .filter(Boolean)
              .slice(0, 15)
              .map((t) => ({
                id:          t.id,
                name:        t.name,
                uri:         t.uri,
                duration_ms: t.duration_ms,
                artists:     t.artists,
                album: {
                  name:   t.album?.name,
                  images: t.album?.images ?? [],
                },
              }));
            setQueue(nextTracks);
          }
        });

        player.addListener('initialization_error', ({ message }) => {
          console.warn('SDK init error:', message);
        });
        player.addListener('authentication_error', ({ message }) => {
          console.warn('SDK auth error:', message);
        });
        player.addListener('account_error', ({ message }) => {
          console.warn('SDK account error (Spotify Premium required):', message);
        });

        await player.connect();
      } catch (err) {
        console.warn('Spotify SDK init failed, using polling only:', err);
      }
    }

    // Initial poll + start polling
    const initTimer = setTimeout(poll, 0);
    startTicker();

    // Adjust poll interval based on SDK readiness
    function startPolling() {
      if (pollTimer) clearInterval(pollTimer);
      const interval = sdkActiveRef.current ? POLL_MS_SDK : POLL_MS_NOSDK;
      pollTimer = setInterval(poll, interval);
    }
    startPolling();

    // Re-poll when tab becomes visible
    function onVisibility() {
      if (!document.hidden) poll();
    }
    document.addEventListener('visibilitychange', onVisibility);

    // Init SDK (non-blocking)
    initSDK();

    return () => {
      destroyed = true;
      clearTimeout(initTimer);
      if (pollTimer) clearInterval(pollTimer);
      clearInterval(tickerRef.current);
      document.removeEventListener('visibilitychange', onVisibility);
      if (playerRef.current) {
        playerRef.current.disconnect();
        playerRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Trigger a re-poll when SDK becomes ready (once, on first ready event)
  useEffect(() => {
    if (sdkReady) poll();
    // poll is stable (defined with useCallback with only stable deps)
    // sdkReady changes only once from false->true after SDK connects
  }, [sdkReady, poll]);

  return {
    track,
    playing,
    setPlaying,
    progress,
    setProgress,
    progressRef,
    playingRef,
    repeatState,
    repeatRef,
    queue,
    recentlyPlayed,
    error,
    setError,
    sdkReady,
    deviceId,
    poll,
    isRateLimited,
    seekBlockUntilRef,
    skipCooldownRef,
  };
}
