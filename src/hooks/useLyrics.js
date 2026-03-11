import { useState, useRef, useCallback, useEffect } from 'react';
import { fetchLyrics, getActiveLyricIndex } from '../utils/lrclib';
import {
  searchAppleMusic,
  fetchAppleMusicLyrics,
  findBestMatch,
} from '../utils/applemusic';

/**
 * useLyrics — manages all lyrics state + fetching logic.
 *
 * Returns:
 *   { lyrics, synced, activeIdx, provider, amResults, amPickerOpen, amSelectedId,
 *     lyricsRef, setActiveIdx, commitLyrics, fetchLyricsForTrack,
 *     handleProviderChange, handleAmResultSelect, handleLyricSeek }
 *
 * Requires:
 *   progressRef, setProgress, seekToPosition from caller
 */
export function useLyrics({ progressRef, setProgress, seekToPositionFn }) {
  const [lyrics,        setLyrics]        = useState(null);
  const [synced,        setSynced]        = useState(false);
  const [activeIdx,     setActiveIdx]     = useState(-1);
  const [provider,      setProvider]      = useState(
    () => localStorage.getItem('lyrics-provider') || 'apple-music',
  );
  const [amResults,     setAmResults]     = useState([]);
  const [amPickerOpen,  setAmPickerOpen]  = useState(false);
  const [amSelectedId,  setAmSelectedId]  = useState(null);

  const lyricsRef   = useRef(null);
  const providerRef = useRef(provider);

  // Keep providerRef in sync
  useEffect(() => {
    providerRef.current = provider;
    localStorage.setItem('lyrics-provider', provider);
  }, [provider]);

  const commitLyrics = useCallback((result) => {
    const isSynced = Array.isArray(result) && result.every((l) => l.time !== null);
    setSynced(isSynced);
    setLyrics(result);
    lyricsRef.current = result;
  }, []);

  const fetchLyricsForTrack = useCallback(async (item, overrideProvider) => {
    const p = overrideProvider ?? providerRef.current;
    const primaryArtist = item.artists?.[0]?.name ?? '';
    const albumName     = item.album?.name ?? '';
    const durationSec   = item.duration_ms != null ? item.duration_ms / 1000 : undefined;

    if (p === 'apple-music') {
      const query   = `${primaryArtist} ${item.name}`;
      const results = await searchAppleMusic(query, item.id);
      setAmResults(results);

      const best = findBestMatch(results, { artist: primaryArtist, title: item.name });
      if (best) {
        setAmSelectedId(best.id);
        commitLyrics(await fetchAppleMusicLyrics(best.id));
      } else {
        setAmPickerOpen(true);
        setLyrics(null);
        lyricsRef.current = null;
      }
    } else {
      commitLyrics(await fetchLyrics({
        title:    item.name,
        artist:   primaryArtist,
        album:    albumName,
        duration: durationSec,
        trackId:  item.id,
      }));
    }
  }, [commitLyrics]);

  function handleProviderChange(next) {
    setProvider(next);
    providerRef.current = next;
    localStorage.setItem('lyrics-provider', next);
  }

  async function handleProviderChangeAndFetch(next, track) {
    handleProviderChange(next);
    if (!track) return;
    setLyrics(null);
    setAmResults([]);
    setAmSelectedId(null);
    setAmPickerOpen(false);
    lyricsRef.current = null;
    setActiveIdx(-1);
    await fetchLyricsForTrack(track, next);
  }

  async function handleAmResultSelect(result, progressRefArg) {
    setAmSelectedId(result.id);
    setAmPickerOpen(false);
    setLyrics(null);
    lyricsRef.current = null;
    setActiveIdx(-1);
    const fetched = await fetchAppleMusicLyrics(result.id);
    commitLyrics(fetched);
    if (fetched) {
      const pr = progressRefArg;
      if (!pr) return;
      setActiveIdx(getActiveLyricIndex(fetched, pr.current / 1000));
    }
  }

  function handleLyricSeek(posMs) {
    if (progressRef) progressRef.current = posMs;
    if (setProgress) setProgress(posMs);
    if (lyricsRef.current) {
      setActiveIdx(getActiveLyricIndex(lyricsRef.current, posMs / 1000));
    }
    if (seekToPositionFn) seekToPositionFn(posMs);
  }

  return {
    lyrics,
    synced,
    activeIdx,
    provider,
    amResults,
    amPickerOpen,
    amSelectedId,
    lyricsRef,
    setActiveIdx,
    commitLyrics,
    fetchLyricsForTrack,
    handleProviderChange,
    handleProviderChangeAndFetch,
    handleAmResultSelect,
    handleLyricSeek,
    setAmPickerOpen,
    setLyrics,
    setAmResults,
    setAmSelectedId,
  };
}
