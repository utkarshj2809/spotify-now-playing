import { useState } from 'react';
import { initiateSpotifyLogin, getClientId } from '../utils/spotify';
import './Setup.css';

const REDIRECT_HINT = window.location.origin + window.location.pathname;

export default function Setup() {
  const [clientId, setClientId] = useState(getClientId);
  const [error, setError]       = useState('');
  const [busy, setBusy]         = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    const id = clientId.trim();

    if (!id) {
      setError('Client ID is required.');
      return;
    }
    if (!/^[a-f0-9]{32}$/.test(id)) {
      setError('Client ID must be a 32-character hexadecimal string. Check your Spotify dashboard.');
      return;
    }

    setError('');
    setBusy(true);
    await initiateSpotifyLogin(id);
    // page redirects — no need to setBusy(false)
  }

  return (
    <div className="setup-root">
      {/* Ambient orbs */}
      <div className="setup-orb setup-orb-1" />
      <div className="setup-orb setup-orb-2" />

      <div className="setup-card">
        {/* Logo */}
        <div className="setup-brand">
          <svg className="setup-spotify-svg" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
          </svg>
          <div>
            <h1 className="setup-title">Now Playing</h1>
            <p className="setup-sub">Connect your Spotify account</p>
          </div>
        </div>

        {/* Steps */}
        <ol className="setup-steps">
          <li>
            Open the{' '}
            <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">
              Spotify Developer Dashboard
            </a>{' '}
            and create (or select) an app.
          </li>
          <li>
            Under <strong>Redirect URIs</strong>, add exactly:{' '}
            <code className="setup-code">{REDIRECT_HINT}</code>
          </li>
          <li>Copy your <strong>Client ID</strong> and paste it below.</li>
        </ol>

        {/* Form */}
        <form className="setup-form" onSubmit={handleSubmit} autoComplete="off">
          <label className="setup-label" htmlFor="cid">Spotify Client ID</label>
          <input
            id="cid"
            className="setup-input"
            type="text"
            value={clientId}
            onChange={(e) => { setClientId(e.target.value); setError(''); }}
            placeholder="e.g. 4b3c2a1d…  (32 hex chars)"
            spellCheck={false}
          />

          {error && <p className="setup-error" role="alert">{error}</p>}

          <button className="setup-btn" type="submit" disabled={busy}>
            {busy ? (
              <>
                <span className="btn-spinner" />
                Redirecting…
              </>
            ) : (
              <>
                <svg className="btn-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
                </svg>
                Connect to Spotify
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
