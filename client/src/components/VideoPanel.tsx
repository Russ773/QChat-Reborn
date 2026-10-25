import { useEffect, useRef, useState } from 'react';
import type { ClientMsg, IceServer, VideoParticipant } from '@qchat/shared';
import { useVideoCall } from '../video/useVideoCall.js';

interface Props {
  room: string;
  me: string;
  open: boolean;
  participants: VideoParticipant[];
  ice: IceServer[];
  canModerate: boolean;
  send: (m: ClientMsg) => void;
}

const CONSENT_KEY = 'qchat_video_ok';
const consented = () => {
  try {
    return sessionStorage.getItem(CONSENT_KEY) === '1';
  } catch {
    return false;
  }
};

/** One person's picture. */
function Tile({ stream, nick, muted, children }: { stream: MediaStream | null; nick: string; muted?: boolean; children?: React.ReactNode }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <figure className="vid-tile">
      <video ref={ref} autoPlay playsInline muted={muted} aria-label={`${nick}'s camera`} />
      <figcaption>
        <span>{nick}</span>
        {children}
      </figcaption>
    </figure>
  );
}

/** The room's live video: join with a camera or just watch, and see who is on camera. */
export function VideoPanel({ room, me, open, participants, ice, canModerate, send }: Props) {
  const call = useVideoCall(room, send, participants, ice);
  const [agreed, setAgreed] = useState(consented);
  const cams = participants.filter((p) => p.cam && p.nick.toLowerCase() !== me.toLowerCase());
  const label = `${participants.length} in the call`;

  const agree = (v: boolean) => {
    setAgreed(v);
    try {
      sessionStorage.setItem(CONSENT_KEY, v ? '1' : '0');
    } catch {
      /* fine */
    }
  };

  return (
    <section className="vid-panel" hidden={!open} aria-label="Live video">
      <div className="vid-head">
        <b>🎥 Live video</b>
        <span className="muted small">{participants.length === 0 ? 'Nobody is in the call yet' : label}</span>
        <div className="vid-controls">
          {call.mode === 'cam' && (
            <>
              <button type="button" className="mini" aria-pressed={!call.micOn} onClick={call.toggleMic}>{call.micOn ? '🎤 Mute' : '🔇 Unmute'}</button>
              <button type="button" className="mini" aria-pressed={!call.camOn} onClick={call.toggleCam}>{call.camOn ? '📷 Camera off' : '📷 Camera on'}</button>
            </>
          )}
          {call.mode !== 'none' && <button type="button" className="mini danger" onClick={call.leave}>Leave call</button>}
        </div>
      </div>

      {call.error && <p className="pm-error" role="alert">{call.error}</p>}

      {call.mode === 'none' && (
        <div className="vid-join">
          <p className="dialog-msg">
            Live video goes straight between the people in the call. Everyone in it can see and hear whoever is on camera, and
            can see your internet address. Anyone could record what they see, so only show what you are happy to show strangers.
          </p>
          <label className="toggle">
            <input type="checkbox" checked={agreed} onChange={(e) => agree(e.target.checked)} />
            <span>I understand, and I am 13 or over.</span>
          </label>
          <div className="vid-join-buttons">
            <button type="button" disabled={!agreed} onClick={() => void call.join(true)}>📷 Join with my camera</button>
            <button type="button" className="secondary" disabled={!agreed} onClick={() => void call.join(false)}>👀 Just watch</button>
          </div>
        </div>
      )}

      {call.mode !== 'none' && (
        <div className="vid-grid">
          {call.mode === 'cam' && <Tile stream={call.local} nick={`${me} (you)`} muted />}
          {cams.map((p) => (
            <Tile key={p.nick} stream={call.remotes[p.nick] ?? null} nick={p.nick}>
              {canModerate && <button type="button" className="mini" onClick={() => send({ t: 'say', room, text: `/video kick ${p.nick}` })}>Remove</button>}
              <button type="button" className="mini" onClick={() => send({ t: 'videoReport', room, nick: p.nick })}>⚑ Report</button>
            </Tile>
          ))}
          {call.mode === 'watch' && cams.length === 0 && <p className="muted">Nobody is on camera yet. You will see them here when they join.</p>}
          {call.mode === 'cam' && cams.length === 0 && <p className="muted">You are the only one on camera for now.</p>}
        </div>
      )}
    </section>
  );
}
