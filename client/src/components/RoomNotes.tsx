import { useState } from 'react';
import type { PinInfo, RoomRules } from '@qchat/shared';

interface Props {
  pins: PinInfo[];
  rules: RoomRules | null;
  /** Moderators can unpin. */
  canUnpin: boolean;
  onUnpin: (id: string) => void;
  onProfile: (name: string) => void;
}

const short = (p: PinInfo) => (p.text || (p.image ? 'a picture' : '')).slice(0, 160);

/** Pinned messages and the room's rules, in a slim bar above the conversation. */
export function RoomNotes({ pins, rules, canUnpin, onUnpin, onProfile }: Props) {
  const [i, setI] = useState(0);
  const [openRules, setOpenRules] = useState(false);
  const [openPins, setOpenPins] = useState(false);
  if (pins.length === 0 && !rules) return null;
  const pin = pins[Math.min(i, pins.length - 1)];

  return (
    <div className="room-notes">
      {pin && (
        <div className="note-row">
          <span className="note-icon" aria-hidden="true">📌</span>
          <button type="button" className="note-text" onClick={() => setOpenPins((o) => !o)} aria-expanded={openPins} title="Show all pinned messages">
            <b>{pin.from}:</b> {short(pin)}
          </button>
          {pins.length > 1 && (
            <span className="note-nav">
              <button type="button" aria-label="Previous pinned message" onClick={() => setI((i - 1 + pins.length) % pins.length)}>‹</button>
              <span>{Math.min(i, pins.length - 1) + 1}/{pins.length}</span>
              <button type="button" aria-label="Next pinned message" onClick={() => setI((i + 1) % pins.length)}>›</button>
            </span>
          )}
          {rules && (
            <button type="button" className="note-btn" onClick={() => setOpenRules((o) => !o)} aria-expanded={openRules}>
              📜 Rules
            </button>
          )}
        </div>
      )}
      {!pin && rules && (
        <div className="note-row">
          <button type="button" className="note-btn" onClick={() => setOpenRules((o) => !o)} aria-expanded={openRules}>
            📜 Room rules
          </button>
        </div>
      )}
      {openRules && rules && (
        <div className="note-body" role="region" aria-label="Room rules">
          <p>{rules.text}</p>
          <span className="note-by">Set by {rules.by}</span>
        </div>
      )}
      {openPins && pins.length > 0 && (
        <div className="note-body" role="region" aria-label="Pinned messages">
          {pins.map((p) => (
            <div className="note-pin" key={p.id}>
              <div>
                <button type="button" className="note-author" onClick={() => onProfile(p.from)}>{p.from}</button>
                <span className="note-by"> pinned by {p.pinnedBy}</span>
                <p>{p.text || '(picture)'}</p>
                {p.image && <img className="note-img" src={p.image} alt="Pinned picture" loading="lazy" />}
              </div>
              {canUnpin && (
                <button type="button" className="mini" onClick={() => onUnpin(p.id)}>Unpin</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
