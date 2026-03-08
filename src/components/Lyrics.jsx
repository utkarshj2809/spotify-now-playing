import { useRef, useEffect } from 'react';
import './Lyrics.css';

export default function Lyrics({ lines, activeIndex, isSynced }) {
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
      <div className="lrc-fade lrc-fade--top" />

      <ul className="lrc-list" ref={containerRef}>
        {lines.map((line, i) => {
          const isActive = i === activeIndex;
          const isPast   = isSynced && i < activeIndex;
          const isEmpty  = !line.text;

          return (
            <li
              key={i}
              ref={isActive ? activeRef : null}
              className={[
                'lrc-line',
                isActive ? 'lrc-line--active'  : '',
                isPast   ? 'lrc-line--past'    : '',
                isEmpty  ? 'lrc-line--spacer'  : '',
              ].filter(Boolean).join(' ')}
            >
              {isEmpty ? '\u00A0' : line.text}
            </li>
          );
        })}
      </ul>

      <div className="lrc-fade lrc-fade--bottom" />

      {!isSynced && (
        <p className="lrc-plain-note">Unsynced lyrics</p>
      )}
    </div>
  );
}
