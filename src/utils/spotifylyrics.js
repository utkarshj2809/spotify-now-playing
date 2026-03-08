import { parseSyncedLyrics } from './lrclib';

const PAXSENIX_API = 'https://lyrics.paxsenix.org';

/**
 * Fetch synced lyrics for a Spotify track directly by its Spotify track ID.
 * The paxsenix endpoint returns a plain LRC-formatted string (not JSON).
 *
 * Returns an array of { time: number (seconds), text: string } objects,
 * or null when lyrics are unavailable.
 */
export async function fetchSpotifyLyrics(trackId) {
  if (!trackId) return null;
  try {
    const params = new URLSearchParams({ id: trackId });
    const res = await fetch(`${PAXSENIX_API}/spotify/lyrics?${params}`);
    if (!res.ok) return null;
    const lrc = await res.text();
    return parseSyncedLyrics(lrc);
  } catch {
    return null;
  }
}
