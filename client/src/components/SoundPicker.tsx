import { useState } from 'react';
import { SOUNDS } from '../media/sounds.js';

/** A soundboard popover: click a sound to play it into the room. */
export function SoundPicker({ onPlay }: { onPlay: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="sound-picker">
      <button
        type="button"
        className={`sound-toggle ${open ? 'active' : ''}`}
        title="Soundboard"
        onClick={() => setOpen((o) => !o)}
      >
        🔊
      </button>
      {open && (
        <div className="sound-pop">
          {SOUNDS.map((s) => (
            <button
              type="button"
              key={s.id}
              className="sound-item"
              title={s.label}
              onClick={() => onPlay(s.id)}
            >
              <span className="si-emoji">{s.emoji}</span>
              <span className="si-label">{s.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
