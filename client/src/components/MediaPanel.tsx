import { useState } from 'react';
import type { MediaClientEvent, MediaState } from '@qchat/shared';
import { MediaPlayer } from './MediaPlayer.js';

interface Props {
  channel: string;
  media: MediaState | undefined;
  onSend: (channel: string, event: MediaClientEvent) => void;
}

export function MediaPanel({ channel, media, onSend }: Props) {
  const [url, setUrl] = useState('');
  // Local mute — each viewer controls their own audio. Starts muted so that
  // programmatic play isn't blocked by the browser's autoplay policy.
  const [muted, setMuted] = useState(true);

  const send = (event: MediaClientEvent) => onSend(channel, event);

  const share = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    send({ t: 'enqueue', url: trimmed });
    setUrl('');
  };

  const current = media && media.currentIndex >= 0 ? media.queue[media.currentIndex] : undefined;
  const hasNext = !!media && media.currentIndex >= 0 && media.currentIndex < media.queue.length - 1;

  return (
    <div className="media-panel">
      <div className="media-stage">
        {media ? (
          <MediaPlayer
            state={media}
            muted={muted}
            onUserPlay={() => send({ t: 'play' })}
            onUserPause={() => send({ t: 'pause' })}
            onUserSeek={(position) => send({ t: 'seek', position })}
          />
        ) : (
          <div className="media-empty">Share a link below to start a watch party.</div>
        )}
      </div>

      {current && (
        <div className="media-controls">
          <button
            className="mc-primary"
            onClick={() => send(media!.playing ? { t: 'pause' } : { t: 'play' })}
          >
            {media!.playing ? '❚❚ Pause' : '▶ Play'}
          </button>
          <button
            className={`mc-mute ${muted ? 'is-muted' : ''}`}
            title={muted ? 'Unmute (your audio only)' : 'Mute (your audio only)'}
            onClick={() => setMuted((m) => !m)}
          >
            {muted ? '🔇 Unmute' : '🔊 Mute'}
          </button>
          {hasNext && <button onClick={() => send({ t: 'skip' })}>⏭ Next</button>}
          <span className="media-now">
            {current.title ?? current.url}{' '}
            <span className="muted">· added by {current.addedBy}</span>
          </span>
        </div>
      )}

      <form className="media-share" onSubmit={share}>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste a YouTube / audio / video URL…"
        />
        <button type="submit">Share</button>
      </form>

      {media && media.queue.length > 0 && (
        <ol className="media-queue">
          {media.queue.map((qitem, idx) => (
            <li key={qitem.id} className={idx === media.currentIndex ? 'active' : ''}>
              <button className="queue-jump" onClick={() => send({ t: 'skip', index: idx })}>
                {idx === media.currentIndex ? '♪ ' : ''}
                {qitem.title ?? qitem.url}
              </button>
              <span className="muted">{qitem.addedBy}</span>
              <button className="queue-remove" onClick={() => send({ t: 'remove', id: qitem.id })}>
                ✕
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
