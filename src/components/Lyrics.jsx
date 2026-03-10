import { useRef, useEffect } from 'react';
import { getActiveWordIndex } from '../utils/applemusic';
import './Lyrics.css';

export default function Lyrics({ lines, activeIndex, isSynced, progressSec, onSeek }) {
  const containerRef = useRef(null);
  const activeRef    = useRef(null);

  // Smoothly scroll the active line to the vertical center
  useEffect(() => {
    if (!activeRef.current || !containerRef.current) return;

    const container = containerRef.current;
    const el        = activeRef.current;

    const containerH = container.clientHeight;
    const elTop      = el.offsetTop;
    const elH        = el.clientHeight;

    container.scrollTo({
      top:      elTop - containerH / 2 + elH / 2,
      behavior: 'smooth',
    });
  }, [activeIndex]);

  if (!lines || lines.length === 0) {
    return (
      <div className="lrc-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" />
        </svg>
        <p>No lyrics found for this track</p>
      </div>
    );
  }

  return (
    <div className="lrc-wrapper">
      <ul className="lrc-list" ref={containerRef}>
        {lines.map((line, i) => {
          const isActive    = i === activeIndex;
          const isPast      = isSynced && i < activeIndex;
          const isEmpty     = !line.text;
          // Word-level (syllable) line — has per-word timing data
          const isWordLevel = Array.isArray(line.words) && line.words.length > 0;
          const hasWords    = isActive && isWordLevel;
          const activeWord  = hasWords ? getActiveWordIndex(line.words, progressSec ?? 0) : -1;

          return (
            <li
              key={i}
              ref={isActive ? activeRef : null}
              className={[
                'lrc-line',
                isActive
                  ? isWordLevel
                    ? 'lrc-line--active-word'
                    : 'lrc-line--active'
                  : '',
                isPast   ? 'lrc-line--past'    : '',
                isEmpty  ? 'lrc-line--music'   : '',
                onSeek && line.time != null ? 'lrc-line--seekable' : '',
              ].filter(Boolean).join(' ')}
              onClick={onSeek && line.time != null ? () => onSeek(line.time * 1000) : undefined}
            >
              {isEmpty
                ? (
                  <>
                    <span className="lrc-note" style={{ animationDelay: '0s' }}>♪</span>
                    <span className="lrc-note" style={{ animationDelay: '0.2s' }}>♫</span>
                    <span className="lrc-note" style={{ animationDelay: '0.4s' }}>♪</span>
                  </>
                )
                : hasWords
                  ? line.words.map((w, wi) => (
                      <span
                        key={wi}
                        className={
                          wi < activeWord
                            ? 'lrc-word lrc-word--past'
                            : wi === activeWord
                              ? 'lrc-word lrc-word--lit'
                              : 'lrc-word'
                        }
                        onClick={onSeek && w.time != null ? (e) => { e.stopPropagation(); onSeek(w.time * 1000); } : undefined}
                        style={onSeek && w.time != null ? { cursor: 'pointer' } : undefined}
                      >
                        {wi < line.words.length - 1 ? `${w.text} ` : w.text}
                      </span>
                    ))
                  : line.text}
            </li>
          );
        })}
      </ul>

      {!isSynced && (
        <p className="lrc-plain-note">Unsynced lyrics</p>
      )}
    </div>
  );
}
