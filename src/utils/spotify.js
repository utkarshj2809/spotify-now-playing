import { spotifyLimiter } from './rateLimiter';

const SPOTIFY_SCOPES = [
  'user-read-currently-playing',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-library-read',
  'user-library-modify',
  'user-read-recently-played',
  'streaming',
].join(' ');

const REDIRECT_URI = window.location.origin + window.location.pathname;

// Client ID baked in at build time by the app owner (via VITE_SPOTIFY_CLIENT_ID).
// When set, visitors never need to enter a Client ID themselves.
export const BUILT_IN_CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID || '';

function generateRandomString(length) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  // Use rejection sampling to eliminate modulo bias.
  // Discard any byte >= floor(256 / alphabet.length) * alphabet.length so that
  // the remaining values map uniformly onto the alphabet.
  const maxValid = Math.floor(256 / alphabet.length) * alphabet.length; // 248
  const result = [];
  while (result.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array((length - result.length) * 2));
    for (const byte of bytes) {
      if (result.length >= length) break;
      if (byte < maxValid) result.push(alphabet[byte % alphabet.length]);
    }
  }
  return result.join('');
}

async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function initiateSpotifyLogin(clientId) {
  // Use the provided ID, the built-in env-var ID, or fall back to localStorage.
  const id = clientId || getClientId();
  if (!id) throw new Error('No Spotify Client ID configured.');

  const verifier = generateRandomString(64);
  const challenge = await generateCodeChallenge(verifier);

  localStorage.setItem('spotify_code_verifier', verifier);
  // Only persist to localStorage when NOT using the built-in env-var ID
  // (so the build-time value always wins after a logout/re-login).
  if (!BUILT_IN_CLIENT_ID) {
    localStorage.setItem('spotify_client_id', id);
  }

  const params = new URLSearchParams({
    client_id: id,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    scope: SPOTIFY_SCOPES,
  });

  window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

export async function exchangeCodeForToken(code) {
  const verifier  = localStorage.getItem('spotify_code_verifier');
  const clientId  = getClientId();

  if (!verifier || !clientId) {
    throw new Error('Missing code verifier or client ID');
  }

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }).toString(),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error_description || 'Token exchange failed');
  }

  const data = await response.json();
  const expiresAt = Date.now() + data.expires_in * 1000;

  localStorage.setItem('spotify_access_token', data.access_token);
  localStorage.setItem('spotify_refresh_token', data.refresh_token);
  localStorage.setItem('spotify_expires_at', String(expiresAt));
  localStorage.removeItem('spotify_code_verifier');

  // Schedule proactive refresh
  _scheduleProactiveRefresh(expiresAt);

  return data.access_token;
}

// Refresh mutex: prevents multiple concurrent refresh requests
let _refreshInFlight = null;
let _proactiveRefreshTimer = null;

function _scheduleProactiveRefresh(expiresAt) {
  if (_proactiveRefreshTimer) clearTimeout(_proactiveRefreshTimer);
  const delay = expiresAt - Date.now() - 60_000;
  if (delay > 0) {
    _proactiveRefreshTimer = setTimeout(() => {
      _proactiveRefreshTimer = null;
      refreshAccessToken().catch(() => {});
    }, delay);
  }
}

async function _doRefresh() {
  const refreshToken = localStorage.getItem('spotify_refresh_token');
  const clientId     = getClientId();

  if (!refreshToken || !clientId) {
    throw new Error('No refresh token available');
  }

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
  });

  if (!response.ok) {
    throw new Error('Token refresh failed');
  }

  const data = await response.json();
  const expiresAt = Date.now() + data.expires_in * 1000;

  localStorage.setItem('spotify_access_token', data.access_token);
  localStorage.setItem('spotify_expires_at', String(expiresAt));
  if (data.refresh_token) {
    localStorage.setItem('spotify_refresh_token', data.refresh_token);
  }

  // Schedule next proactive refresh
  _scheduleProactiveRefresh(expiresAt);

  return data.access_token;
}

export async function refreshAccessToken() {
  if (_refreshInFlight) return _refreshInFlight;
  _refreshInFlight = _doRefresh().finally(() => { _refreshInFlight = null; });
  return _refreshInFlight;
}

export async function getValidToken() {
  const expiresAt = parseInt(localStorage.getItem('spotify_expires_at') || '0', 10);
  const token = localStorage.getItem('spotify_access_token');

  if (!token) return null;

  // Refresh 60 seconds before expiry
  if (Date.now() > expiresAt - 60_000) {
    try {
      return await refreshAccessToken();
    } catch {
      logout();
      return null;
    }
  }

  return token;
}

// In-flight deduplication for getCurrentlyPlaying
let _currentlyPlayingInFlight = null;

export async function getCurrentlyPlaying() {
  if (_currentlyPlayingInFlight) return _currentlyPlayingInFlight;

  _currentlyPlayingInFlight = spotifyLimiter.schedule(async () => {
    const token = await getValidToken();
    if (!token) return null;

    const response = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.status === 204 || response.status === 404) return null;
    if (!response.ok) return null;

    return response.json();
  }).finally(() => {
    _currentlyPlayingInFlight = null;
  });

  return _currentlyPlayingInFlight;
}

export function logout() {
  localStorage.removeItem('spotify_access_token');
  localStorage.removeItem('spotify_refresh_token');
  localStorage.removeItem('spotify_expires_at');
  localStorage.removeItem('spotify_code_verifier');
}

export function isLoggedIn() {
  return !!localStorage.getItem('spotify_access_token');
}

export function getClientId() {
  // Prefer the build-time env var so the owner's Client ID is always used.
  return BUILT_IN_CLIENT_ID || localStorage.getItem('spotify_client_id') || '';
}

// ── Playback controls ─────────────────────────────────────────

export async function skipToNext() {
  const token = await getValidToken();
  if (!token) return;
  const res = await spotifyLimiter.schedule(() =>
    fetch('https://api.spotify.com/v1/me/player/next', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
  );
  if (!res.ok && res.status !== 204) {
    console.warn('skipToNext failed:', res.status);
  }
}

export async function skipToPrevious() {
  const token = await getValidToken();
  if (!token) return;
  const res = await spotifyLimiter.schedule(() =>
    fetch('https://api.spotify.com/v1/me/player/previous', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
  );
  if (!res.ok && res.status !== 204) {
    console.warn('skipToPrevious failed:', res.status);
  }
}

export async function seekToPosition(positionMs) {
  const token = await getValidToken();
  if (!token) return;
  const res = await spotifyLimiter.schedule(() =>
    fetch(`https://api.spotify.com/v1/me/player/seek?position_ms=${Math.round(positionMs)}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
    })
  );
  if (!res.ok && res.status !== 204) {
    console.warn('seekToPosition failed:', res.status);
  }
}

export async function getQueue() {
  return spotifyLimiter.schedule(async () => {
    const token = await getValidToken();
    if (!token) return null;
    const res = await fetch('https://api.spotify.com/v1/me/player/queue', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return res.json(); // { currently_playing, queue: [...] }
  });
}

export async function togglePlayback(isCurrentlyPlaying) {
  const token = await getValidToken();
  if (!token) return;
  const endpoint = isCurrentlyPlaying
    ? 'https://api.spotify.com/v1/me/player/pause'
    : 'https://api.spotify.com/v1/me/player/play';
  const res = await spotifyLimiter.schedule(() =>
    fetch(endpoint, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
    })
  );
  if (!res.ok && res.status !== 204) {
    console.warn('togglePlayback failed:', res.status);
  }
}

export async function toggleShuffle(state) {
  const token = await getValidToken();
  if (!token) return;
  const res = await spotifyLimiter.schedule(() =>
    fetch(`https://api.spotify.com/v1/me/player/shuffle?state=${state}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
    })
  );
  if (!res.ok && res.status !== 204) {
    console.warn('toggleShuffle failed:', res.status);
  }
}

export async function setRepeatMode(state) {
  const token = await getValidToken();
  if (!token) return;
  const res = await spotifyLimiter.schedule(() =>
    fetch(`https://api.spotify.com/v1/me/player/repeat?state=${state}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
    })
  );
  if (!res.ok && res.status !== 204) {
    console.warn('setRepeatMode failed:', res.status);
  }
}

export async function setVolume(volumePercent) {
  const token = await getValidToken();
  if (!token) return;
  const res = await spotifyLimiter.schedule(() =>
    fetch(`https://api.spotify.com/v1/me/player/volume?volume_percent=${Math.round(volumePercent)}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
    })
  );
  if (!res.ok && res.status !== 204) {
    console.warn('setVolume failed:', res.status);
  }
}

export async function checkTrackSaved(id) {
  const token = await getValidToken();
  if (!token) return false;
  const res = await spotifyLimiter.schedule(() =>
    fetch(`https://api.spotify.com/v1/me/tracks/contains?ids=${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  );
  if (!res.ok) return false;
  const data = await res.json();
  return Array.isArray(data) ? data[0] === true : false;
}

export async function saveTrack(id) {
  const token = await getValidToken();
  if (!token) return;
  await spotifyLimiter.schedule(() =>
    fetch(`https://api.spotify.com/v1/me/tracks?ids=${id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    })
  );
}

export async function removeTrack(id) {
  const token = await getValidToken();
  if (!token) return;
  await spotifyLimiter.schedule(() =>
    fetch(`https://api.spotify.com/v1/me/tracks?ids=${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    })
  );
}

export async function getRecentlyPlayed() {
  return spotifyLimiter.schedule(async () => {
    const token = await getValidToken();
    if (!token) return null;
    const res = await fetch('https://api.spotify.com/v1/me/player/recently-played?limit=15', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return res.json();
  });
}

export async function playTrack(uri, deviceId) {
  const token = await getValidToken();
  if (!token) return;
  const body = { uris: [uri] };
  await spotifyLimiter.schedule(() =>
    fetch(`https://api.spotify.com/v1/me/player/play${deviceId ? `?device_id=${deviceId}` : ''}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}
