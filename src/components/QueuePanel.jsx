/**
 * QueuePanel — the "Up Next" panel.
 * Props: queue, onClose, onPlayFromQueue(track, index)
 */

function fmt(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function QueuePanel({ queue, onClose, onPlayFromQueue }) {
  return (
    <section className="np-queue-panel">
      <div className="np-queue">
        <div className="np-queue-header">
          <span>Up Next</span>
          <button className="am-picker-close" onClick={onClose}>✕</button>
        </div>
        <ul className="np-queue-list" role="list">
          {queue.map((t, i) => {
            const qArt    = t.album?.images?.[1]?.url ?? t.album?.images?.[0]?.url;
            const qArtist = t.artists?.map((a) => a.name).join(', ') ?? '';
            return (
              <li
                key={`${t.id}-${i}`}
                className="np-queue-item np-queue-item--clickable"
                role="listitem"
                onClick={() => onPlayFromQueue && onPlayFromQueue(t, i)}
                title={`Play ${t.name}`}
              >
                <span className="np-queue-num">{i + 1}</span>
                {qArt && (
                  <img className="np-queue-art" src={qArt} alt={t.name} />
                )}
                <div className="np-queue-meta">
                  <span className="np-queue-title">{t.name}</span>
                  <span className="np-queue-artist">{qArtist}</span>
                </div>
                <span className="np-queue-dur">{fmt(t.duration_ms)}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
