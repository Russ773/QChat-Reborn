import { useEffect, useState } from 'react';
import { MAX_RULES, MAX_TOPIC, type RadioTrack } from '@qchat/shared';
import type { RoomAdminInfo } from '../types.js';

interface Props {
  room: string;
  info: RoomAdminInfo | null;
  /** The topic as it is now. */
  topic: string;
  /** The rules as they are now. */
  rules: string;
  /** The room's radio. */
  radio: { on: boolean; tracks: RadioTrack[] };
  /** Live video: is it allowed on this site, and is it on in this room? */
  video: { siteOn: boolean; on: boolean };
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
export function RoomSettingsModal({ room, info, topic, rules, radio, video, canManageMods, onCommand, onClose }: Props) {
  const [draft, setDraft] = useState(topic);
  const [rulesDraft, setRulesDraft] = useState(rules);
  const [trackLink, setTrackLink] = useState('');
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

        {canManageMods && (
          <form
            className="rs-section rs-topic"
            onSubmit={(e) => {
              e.preventDefault();
              onCommand(rulesDraft.trim() ? `/rules ${rulesDraft.trim()}` : '/rules clear');
            }}
          >
            <div className="rs-title">Room rules</div>
            <textarea
              rows={4}
              maxLength={MAX_RULES}
              value={rulesDraft}
              onChange={(e) => setRulesDraft(e.target.value)}
              placeholder="Shown to everyone in a Rules button above the chat."
            />
            <div className="rs-topic-btns">
              <button type="submit" className="mini">Save rules</button>
              {rules && (
                <button
                  type="button"
                  className="mini"
                  onClick={() => {
                    setRulesDraft('');
                    onCommand('/rules clear');
                  }}
                >
                  Remove
                </button>
              )}
            </div>
          </form>
        )}

        {canManageMods && (
          <div className="rs-section">
            <div className="rs-title">Live video {video.on ? '(on)' : '(off)'}</div>
            {video.siteOn ? (
              <>
                <p className="muted small">
                  When it is on, anyone in the room can join a video call: up to 4 people on camera, everyone else watching.
                  Members must have had their account for a day to use a camera. Moderators can remove anyone from the call.
                </p>
                <button className="mini" onClick={() => onCommand(video.on ? '/video off' : '/video on')}>
                  {video.on ? 'Turn video off' : 'Turn video on'}
                </button>
              </>
            ) : (
              <p className="muted small">An administrator has switched live video off for the whole site.</p>
            )}
          </div>
        )}

        {canManageMods && (
          <div className="rs-section">
            <div className="rs-title">Room radio {radio.on ? '(on)' : '(off)'}</div>
            <p className="muted small">
              When the radio is on, the room always has something playing while people are here: the queue first, then these tracks in a loop.
            </p>
            {radio.tracks.length === 0 && <p className="muted small">No tracks yet. Paste a YouTube, Vimeo or SoundCloud link below.</p>}
            {radio.tracks.map((t, i) => (
              <div className="rs-row" key={t.id}>
                <span>{i + 1}. {t.title || `${t.provider} link`}</span>
                <button className="mini" onClick={() => onCommand(`/radio remove ${i + 1}`)}>Remove</button>
              </div>
            ))}
            <form
              className="rs-topic-btns"
              onSubmit={(e) => {
                e.preventDefault();
                if (trackLink.trim()) onCommand(`/radio add ${trackLink.trim()}`);
                setTrackLink('');
              }}
            >
              <input value={trackLink} onChange={(e) => setTrackLink(e.target.value)} placeholder="Link to add" aria-label="Link to add to the radio" />
              <button type="submit" className="mini">Add</button>
            </form>
            <div className="rs-topic-btns">
              <button className="mini" disabled={radio.tracks.length === 0} onClick={() => onCommand(radio.on ? '/radio off' : '/radio on')}>
                {radio.on ? 'Turn radio off' : 'Turn radio on'}
              </button>
              {radio.tracks.length > 0 && <button className="mini" onClick={() => onCommand('/radio clear')}>Clear all</button>}
            </div>
          </div>
        )}

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
