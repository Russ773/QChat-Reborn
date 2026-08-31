import { useEffect, useRef } from 'react';
import type { Profile } from '@qchat/shared';
import type { WhoisInfo } from '../types.js';
import { Avatar } from './Avatar.js';

interface Props {
  nick: string;
  info?: WhoisInfo;
  profile?: Profile | null;
  x: number;
  y: number;
  onClose: () => void;
  onMention: (nick: string) => void;
}

function formatIdle(seconds?: number): string | null {
  if (seconds === undefined) return null;
  if (seconds < 60) return `${seconds}s idle`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m idle`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m idle`;
}

export function MiniProfile({ nick, info, profile, x, y, onClose, onMention }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const style: React.CSSProperties = {
    left: Math.max(8, Math.min(x, window.innerWidth - 268)),
    top: Math.max(8, Math.min(y, window.innerHeight - 300)),
  };

  const idle = formatIdle(info?.idleSeconds);
  const displayName = profile?.displayName || nick;

  return (
    <div className="mini-profile" ref={ref} style={style} role="dialog" aria-label={`Profile of ${nick}`}>
      <div className="mp-head">
        <Avatar name={nick} src={profile?.avatar} size={48} />
        <div className="mp-title">
          <span className="mp-nick">{displayName}</span>
          <span className="mp-sub">
            {displayName !== nick ? `${nick} · ` : ''}
            {profile?.pronouns ?? ''}
          </span>
          {info?.account ? (
            <span className="mp-account">✓ registered as {info.account}</span>
          ) : (
            <span className="mp-account guest">not registered</span>
          )}
        </div>
      </div>

      <div className="mp-body">
        {profile?.status && <div className="mp-status">💬 {profile.status}</div>}
        {profile?.bio && <div className="mp-bio">{profile.bio}</div>}
        {profile?.links?.map((link) => (
          <a key={link} className="mp-link" href={link} target="_blank" rel="noreferrer noopener">
            {link}
          </a>
        ))}
        {info?.host && (
          <div className="mp-row">
            <span>Host</span>
            <b>{info.host}</b>
          </div>
        )}
        {info?.channels && (
          <div className="mp-row">
            <span>In</span>
            <b className="mp-chans">{info.channels}</b>
          </div>
        )}
        {idle && (
          <div className="mp-row">
            <span>Idle</span>
            <b>{idle}</b>
          </div>
        )}
        {!info && !profile && <div className="mp-loading">Loading…</div>}
      </div>

      <div className="mp-actions">
        <button
          onClick={() => {
            onMention(nick);
            onClose();
          }}
        >
          Mention
        </button>
        {info?.account && (
          <a
            className="mp-fullprofile"
            href={`/u.php?a=${encodeURIComponent(info.account)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            View full profile ↗
          </a>
        )}
      </div>
    </div>
  );
}
