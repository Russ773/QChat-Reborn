import { useState } from 'react';
import { SOUNDS } from '../media/sounds.js';
import { useCustomSounds } from '../media/customSounds.js';
import { AddSoundModal } from './AddSoundModal.js';

/** A soundboard popover: click a sound to play it into the room. */
export function SoundPicker({ onPlay, token }: { onPlay: (id: string) => void; token: string | null }) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const { approved } = useCustomSounds(token);
  return (
    <div className="sound-picker">
      <button
        type="button"
        className={`sound-toggle ${open ? 'active' : ''}`}
        title="Soundboard"
        aria-label="Soundboard"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        🔊
      </button>
      {open && (
        <div className="sound-pop">
          {SOUNDS.map((s) => (
            <button type="button" key={s.id} className="sound-item" title={s.label} onClick={() => onPlay(s.id)}>
              <span className="si-emoji">{s.emoji}</span>
              <span className="si-label">{s.label}</span>
            </button>
          ))}
          {approved.map((s) => (
            <button type="button" key={s.id} className="sound-item" title={`${s.name}, added by ${s.by}`} onClick={() => onPlay(s.id)}>
              <span className="si-emoji">{s.emoji}</span>
              <span className="si-label">{s.name}</span>
            </button>
          ))}
          {token && (
            <button
              type="button"
              className="sound-item sound-add"
              title="Add your own sound"
              onClick={() => {
                setAdding(true);
                setOpen(false);
              }}
            >
              <span className="si-emoji">＋</span>
              <span className="si-label">Add yours</span>
            </button>
          )}
        </div>
      )}
      {adding && token && <AddSoundModal token={token} onClose={() => setAdding(false)} />}
    </div>
  );
}
