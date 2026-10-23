import { useEffect, useState } from 'react';
import { MAX_TOPIC } from '@qchat/shared';
import type { RoomAdminInfo } from '../types.js';

interface Props {
  room: string;
  info: RoomAdminInfo | null;
  /** The topic as it is now. */
  topic: string;
  /** Owners and admins can also appoint and remove moderators. */
  canManageMods: boolean;
  /** Run a room command (like "/unban Dan") and refresh. */
  onCommand: (command: string) => void;
  onClose: () => void;
}

const label = (room: string) => room.replace(/^#/, '');

function until(ts: number | null): string {
  if (ts === null) return 'until unmuted';
  const mins = Math.max(1, Math.ceil((ts - Date.now()) / 60000));
  return mins >= 120 ? `${Math.round(mins / 60)} more hours` : `${mins} more minute${mins === 1 ? '' : 's'}`;
}

/** Who moderates a room, who is muted and who is banned, with buttons to undo each. */
export function RoomSettingsModal({ room, info, topic, canManageMods, onCommand, onClose }: Props) {
  const [draft, setDraft] = useState(topic);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal rs-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Room settings">
        <button className="modal-x" onClick={onClose} aria-label="Close">✕</button>
        <h2 className="modal-title">{label(room)} settings</h2>

        <form
          className="rs-section rs-topic"
          onSubmit={(e) => {
            e.preventDefault();
            onCommand(draft.trim() ? `/topic ${draft.trim()}` : '/topic clear');
          }}
        >
          <div className="rs-title">Topic</div>
          <input
            value={draft}
            maxLength={MAX_TOPIC}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="What is this room about?"
          />
          <div className="rs-topic-btns">
            <button type="submit" className="mini">Save topic</button>
            {topic && (
              <button
                type="button"
                className="mini"
                onClick={() => {
                  setDraft('');
                  onCommand('/topic clear');
                }}
              >
                Clear
              </button>
            )}
          </div>
        </form>

        {!info ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            <div className="rs-section">
              <div className="rs-title">Owner</div>
              <p className="rs-row-plain">{info.owner ?? 'This is a built-in room, so it has no owner.'}</p>
            </div>

            <div className="rs-section">
              <div className="rs-title">Moderators</div>
              {info.mods.length === 0 && <p className="muted small">No moderators yet. Use /mod name to appoint one.</p>}
              {info.mods.map((m) => (
                <div className="rs-row" key={m}>
                  <span>{m}</span>
                  {canManageMods && (
                    <button className="mini" onClick={() => onCommand(`/unmod ${m}`)}>Remove</button>
                  )}
                </div>
              ))}
            </div>

            <div className="rs-section">
              <div className="rs-title">Muted</div>
              {info.mutes.length === 0 && <p className="muted small">Nobody is muted.</p>}
              {info.mutes.map((m) => (
                <div className="rs-row" key={m.name}>
                  <span>
                    {m.name} <span className="rs-sub">{until(m.until)}</span>
                  </span>
                  <button className="mini" onClick={() => onCommand(`/unmute ${m.name}`)}>Unmute</button>
                </div>
              ))}
            </div>

            <div className="rs-section">
              <div className="rs-title">Banned</div>
              {info.bans.length === 0 && <p className="muted small">Nobody is banned.</p>}
              {info.bans.map((b) => (
                <div className="rs-row" key={b}>
                  <span>{b}</span>
                  <button className="mini" onClick={() => onCommand(`/unban ${b}`)}>Unban</button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
