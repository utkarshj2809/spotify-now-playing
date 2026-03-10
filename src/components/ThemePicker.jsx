import { useState } from 'react';

const THEMES = [
  { key: 'dark',   label: 'Dark',          color: '#1a1a1a' },
  { key: 'amoled', label: 'AMOLED',        color: '#000000' },
  { key: 'sepia',  label: 'Sepia',         color: '#1a1208' },
  { key: 'hc',     label: 'High Contrast', color: '#000000' },
];

/**
 * ThemePicker — small popover with 4 theme swatches.
 * Props: currentTheme, onChange(themeKey)
 */
export default function ThemePicker({ currentTheme, onChange }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="np-theme-picker">
      <button
        className="np-icon-btn"
        onClick={() => setOpen((v) => !v)}
        title="Change theme"
        aria-label="Change theme"
        aria-haspopup="true"
        aria-expanded={open}
      >
        {/* Palette icon */}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <circle cx="8"  cy="14" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="12" cy="8"  r="1.5" fill="currentColor" stroke="none" />
          <circle cx="16" cy="14" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      </button>

      {open && (
        <div className="np-theme-popover" role="listbox" aria-label="Choose theme">
          {THEMES.map(({ key, label, color }) => (
            <button
              key={key}
              className={`np-theme-swatch${currentTheme === key ? ' np-theme-swatch--active' : ''}`}
              style={{ background: color }}
              onClick={() => { onChange(key); setOpen(false); }}
              title={label}
              aria-label={label}
              role="option"
              aria-selected={currentTheme === key}
            />
          ))}
        </div>
      )}
    </div>
  );
}
