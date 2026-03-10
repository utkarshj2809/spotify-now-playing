/**
 * PlayerControls — the playback controls row.
 * Props: playing, repeatState, onTogglePlayback, onSkipNext, onSkipPrev, onToggleRepeat
 */
export default function PlayerControls({
  playing,
  repeatState,
  onTogglePlayback,
  onSkipNext,
  onSkipPrev,
  onToggleRepeat,
}) {
  return (
    <div className="np-playback-row">
      <button
        className="np-skip-btn"
        onClick={onSkipPrev}
        title="Previous track"
        aria-label="Previous track"
      >
        <svg viewBox="0 0 20 20" fill="currentColor">
          <path d="M4 4h2v12H4V4zm10 0l-8 6 8 6V4z" />
        </svg>
      </button>

      <button
        className="np-play-btn"
        onClick={onTogglePlayback}
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
        onClick={onSkipNext}
        title="Next track"
        aria-label="Next track"
      >
        <svg viewBox="0 0 20 20" fill="currentColor">
          <path d="M14 4h2v12h-2V4zM4 4l8 6-8 6V4z" />
        </svg>
      </button>

      <button
        className={`np-repeat-btn${repeatState !== 'off' ? ' np-repeat-active' : ''}${repeatState === 'track' ? ' np-repeat-one' : ''}`}
        onClick={onToggleRepeat}
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
  );
}
