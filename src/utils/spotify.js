const SPOTIFY_SCOPES = [
  'user-read-currently-playing',
  'user-read-playback-state',
].join(' ');

const REDIRECT_URI = window.location.origin + window.location.pathname;

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
  const verifier = generateRandomString(64);
  const challenge = await generateCodeChallenge(verifier);

  localStorage.setItem('spotify_code_verifier', verifier);
  localStorage.setItem('spotify_client_id', clientId);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    scope: SPOTIFY_SCOPES,
  });

  window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

export async function exchangeCodeForToken(code) {
  const verifier = localStorage.getItem('spotify_code_verifier');
  const clientId = localStorage.getItem('spotify_client_id');

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

  return data.access_token;
}

export async function refreshAccessToken() {
  const refreshToken = localStorage.getItem('spotify_refresh_token');
  const clientId = localStorage.getItem('spotify_client_id');

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

  return data.access_token;
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

export async function getCurrentlyPlaying() {
  const token = await getValidToken();
  if (!token) return null;

  const response = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.status === 204 || response.status === 404) return null;
  if (!response.ok) return null;

  return response.json();
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
  return localStorage.getItem('spotify_client_id') || '';
}
