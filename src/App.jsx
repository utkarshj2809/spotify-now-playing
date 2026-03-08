import { useState, useEffect } from 'react';
import { isLoggedIn, exchangeCodeForToken } from './utils/spotify';
import Setup from './components/Setup';
import NowPlaying from './components/NowPlaying';
import './App.css';

export default function App() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function boot() {
      const params = new URLSearchParams(window.location.search);
      const code  = params.get('code');
      const error = params.get('error');

      // Always clean OAuth params from the URL immediately
      if (code || error) {
        window.history.replaceState({}, '', window.location.pathname);
      }

      if (error) {
        setLoading(false);
        return;
      }

      if (code) {
        try {
          await exchangeCodeForToken(code);
          setLoggedIn(true);
        } catch (err) {
          console.error('Spotify token exchange failed:', err);
        }
      } else {
        setLoggedIn(isLoggedIn());
      }

      setLoading(false);
    }

    boot();
  }, []);

  if (loading) {
    return (
      <div className="app-loading">
        <div className="spinner" />
      </div>
    );
  }

  return loggedIn
    ? <NowPlaying onLogout={() => setLoggedIn(false)} />
    : <Setup />;
}
