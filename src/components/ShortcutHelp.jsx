import { useEffect } from 'react';

const SHORTCUTS = [
  { key: 'L',           action: 'Toggle lyrics'           },
  { key: '?',           action: 'Show / hide this help'   },
];

/**
 * ShortcutHelp — keyboard shortcut cheatsheet modal.
 * Props: onClose
 */
export default function ShortcutHelp({ onClose }) {
  // Close on Escape
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="shortcut-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div className="shortcut-card">
        <h2>Keyboard Shortcuts</h2>
        <table className="shortcut-table">
          <tbody>
            {SHORTCUTS.map(({ key, action }) => (
              <tr key={key}>
                <td>
                  {key.split(' + ').map((k, i, arr) => (
                    <span key={k}>
                      <kbd className="shortcut-key">{k}</kbd>
                      {i < arr.length - 1 && <span style={{ margin: '0 4px', color: 'var(--text-3)' }}>+</span>}
                    </span>
                  ))}
                </td>
                <td>{action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
