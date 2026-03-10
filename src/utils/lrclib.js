import { appCache } from './cache';
import { lrclibLimiter } from './rateLimiter';

const LRCLIB_API = 'https://lrclib.net/api';
// Recommended by lrclib.net — identifies this client in server logs
const LRCLIB_CLIENT_HEADER = {
  'Lrclib-Client': 'spotify-now-playing v1.0 (https://github.com/utkarshj2809/spotify-now-playing)',
};

const TTL_HIT  = 7 * 24 * 60 * 60 * 1000; // 7 days for found lyrics
const TTL_MISS = 24 * 60 * 60 * 1000;      // 24 hours for not-found

/**
 * Fetch synced (or plain) lyrics from lrclib.
 * Returns an array of { time: number (seconds), text: string } objects
 * for synced lyrics, or an array of { time: null, text } for plain lyrics,
 * or null if not found.
 *
 * Strategy:
 *  1. Try GET /api/get with exact metadata (track_name required; artist_name,
 *     album_name, duration included when available).
 *  2. On 404, fall back to GET /api/search using "artist title" as a query.
 *
 * @param {{ artist: string, title: string, album?: string, duration?: number, trackId?: string }} opts
 */
export async function fetchLyrics({ artist, title, album, duration, trackId }) {
  // Cache key: prefer Spotify track ID, fall back to artist:title
  const cacheKey = trackId ? `lrclib:${trackId}` : `lrclib:${artist}:${title}`;

  // Check cache first
  const cached = appCache.get(cacheKey);
  if (cached !== null) return cached;

  // Build params – only include fields that have a non-empty value
  const params = new URLSearchParams({ track_name: title });
  if (artist) params.set('artist_name', artist);
  if (album) params.set('album_name', album);
  // Duration must be decimal seconds (not rounded) for the best match
  if (duration != null) params.set('duration', String(duration));

  try {
    const response = await lrclibLimiter.schedule(() =>
      fetch(`${LRCLIB_API}/get?${params.toString()}`, {
        headers: LRCLIB_CLIENT_HEADER,
      })
    );

    if (response.status === 404) {
      // Exact match not found — try the search endpoint as a fallback
      const result = await searchLyrics(artist, title, cacheKey);
      return result;
    }

    if (!response.ok) return null;

    const data = await response.json();
    const result = extractLyricsFromResponse(data);
    appCache.set(cacheKey, result, result ? TTL_HIT : TTL_MISS);
    return result;
  } catch {
    return null;
  }
}

/**
 * Fallback: search for lyrics by "artist title" query string.
 * Picks the first result that has synced lyrics, else plain, else the first result.
 */
async function searchLyrics(artist, title, cacheKey) {
  const q = [artist, title].filter(Boolean).join(' ');
  const params = new URLSearchParams({ q });

  try {
    const response = await lrclibLimiter.schedule(() =>
      fetch(`${LRCLIB_API}/search?${params.toString()}`, {
        headers: LRCLIB_CLIENT_HEADER,
      })
    );

    if (!response.ok) return null;

    const results = await response.json();
    if (!Array.isArray(results) || results.length === 0) {
      if (cacheKey) appCache.set(cacheKey, null, TTL_MISS);
      return null;
    }

    const best =
      results.find((r) => r.syncedLyrics) ||
      results.find((r) => r.plainLyrics) ||
      results[0];

    const result = extractLyricsFromResponse(best);
    if (cacheKey) appCache.set(cacheKey, result, result ? TTL_HIT : TTL_MISS);
    return result;
  } catch {
    return null;
  }
}

/**
 * Convert a single lrclib response object into our internal lyrics format.
 */
function extractLyricsFromResponse(data) {
  if (!data) return null;

  if (data.instrumental) {
    return [{ time: 0, text: '♪ Instrumental ♪' }];
  }

  if (data.syncedLyrics) {
    return parseSyncedLyrics(data.syncedLyrics);
  }

  if (data.plainLyrics) {
    return data.plainLyrics
      .split('\n')
      .map((line) => ({ time: null, text: line }));
  }

  return null;
}

/**
 * Parse LRC format: [mm:ss.xx] lyric line
 */
export function parseSyncedLyrics(lrc) {
  const lines = lrc.split('\n');
  const result = [];

  for (const line of lines) {
    const match = line.match(/^\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/);
    if (match) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const ms = match[3].length === 2 ? parseInt(match[3], 10) * 10 : parseInt(match[3], 10);
      const time = minutes * 60 + seconds + ms / 1000;
      const text = match[4].trim();
      result.push({ time, text });
    }
  }

  return result.length > 0 ? result : null;
}

/**
 * Given sorted synced lyrics and current playback position (seconds),
 * return the index of the currently active line.
 */
export function getActiveLyricIndex(lines, positionSec) {
  if (!lines || lines.length === 0) return -1;

  let activeIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time !== null && lines[i].time <= positionSec) {
      activeIndex = i;
    } else if (lines[i].time !== null) {
      break;
    }
  }

  return activeIndex;
}
