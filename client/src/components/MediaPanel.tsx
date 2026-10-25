import { useState } from 'react';
import { PROVIDER_NAME, parseMediaUrl, type MediaRef, type MediaState, type QueueItem } from '@qchat/shared';
import { MediaPlayer } from './EmbedPlayers.js';

export interface QueueInfo {
  items: QueueItem[];
  skipVotes: number;
  skipNeeded: number;
}

interface Props {
  roomMedia: MediaState | null;
  queue: QueueInfo;
  me: string;
  /** Moderators can remove anyone's queued items and skip straight away. */
  canModerate: boolean;
  autoplay: boolean;
  onPlayRoom: (url: string) => void;
  onQueue: (url: string) => void;
  onSkip: () => void;
  onRemove: (id: string) => void;
  onControlRoom: (op: 'pause' | 'resume' | 'seek' | 'stop' | 'ended', pos?: number) => void;
}

const nameOf = (q: QueueItem) => q.title || `${PROVIDER_NAME[q.provider]} link`;

export function MediaPanel({ roomMedia, queue, me, canModerate, autoplay, onPlayRoom, onQueue, onSkip, onRemove, onControlRoom }: Props) {
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [personal, setPersonal] = useState<MediaRef | null>(null);
  const [optIn, setOptIn] = useState<string | null>(null);
  const [showQueue, setShowQueue] = useState(true);

  const watchingRoom = !!roomMedia && !personal && (autoplay || optIn === roomMedia.ref);
  const showPrompt = !!roomMedia && !personal && !watchingRoom;
  const live = roomMedia?.kind === 'twitch';

  const take = (): MediaRef | null => {
    const m = parseMediaUrl(link);
    if (!m) {
      setError('That is not a link I can play. Try YouTube, Vimeo, SoundCloud or Twitch.');
      return null;
    }
    setError(null);
    setLink('');
    return m;
  };
  const playRoom = () => {
    if (!parseMediaUrl(link)) return void take();
    const url = link;
    take();
    setPersonal(null);
    onPlayRoom(url);
  };
  const addQueue = () => {
    if (!parseMediaUrl(link)) return void take();
    const url = link;
    take();
    onQueue(url);
  };
  const justMe = () => {
    const m = take();
    if (m) setPersonal(m);
  };

  return (
    <div className="media-panel">
      <form className="media-input" onSubmit={(e) => { e.preventDefault(); playRoom(); }}>
        <input
          value={link}
          onChange={(e) => { setLink(e.target.value); setError(null); }}
          placeholder="Paste a YouTube, Vimeo, SoundCloud or Twitch link…"
          aria-label="Link to play"
        />
        <button type="submit" title="Play for everyone in the room, now">▶ Room</button>
        <button type="button" className="secondary" title="Add to the queue, to play after what is on" onClick={addQueue}>＋ Queue</button>
        <button type="button" className="secondary" title="Play just for you" onClick={justMe}>👤 Just me</button>
      </form>
      {error && <p className="pm-error media-error" role="alert">{error}</p>}

      {personal && (
        <div className="media-stage">
          <div className="media-head">
            <span>▶ Playing just for you ({PROVIDER_NAME[personal.provider]})</span>
            <button className="media-x" onClick={() => setPersonal(null)} aria-label="Close">✕</button>
          </div>
          <div className={personal.provider === 'soundcloud' ? 'sc-wrap' : 'yt-frame'}>
            <MediaPlayer kind={personal.provider} mediaRef={personal.ref} autoplay />
          </div>
        </div>
      )}

      {watchingRoom && roomMedia && (
        <div className="media-stage">
          <div className="media-head">
            <span className="media-by">
              {roomMedia.radio ? '📻 Radio' : '▶ For the room'}
              {roomMedia.title ? ` · ${roomMedia.title}` : ''}
              {roomMedia.radio ? '' : ` · by ${roomMedia.by}`}
            </span>
            <div className="media-controls">
              {!live && (roomMedia.paused ? (
                <button onClick={() => onControlRoom('resume')}>Resume</button>
              ) : (
                <button onClick={() => onControlRoom('pause')}>Pause</button>
              ))}
              {!live && (
                <button className="secondary" onClick={onSkip} title={canModerate || roomMedia.by === me ? 'Skip this' : 'Vote to skip this'}>
                  ⏭ Skip{queue.skipVotes > 0 ? ` (${queue.skipVotes}/${queue.skipNeeded})` : ''}
                </button>
              )}
              <button className="secondary" onClick={() => onControlRoom('stop')}>Stop</button>
            </div>
          </div>
          <div className={roomMedia.kind === 'soundcloud' ? 'sc-wrap' : 'yt-frame'}>
            <MediaPlayer kind={roomMedia.kind} mediaRef={roomMedia.ref} sync={roomMedia} autoplay onControl={onControlRoom} />
          </div>
        </div>
      )}

      {showPrompt && roomMedia && (
        <div className="media-prompt">
          <span>{roomMedia.radio ? '📻 The radio is playing' : `▶ ${roomMedia.by} is playing ${roomMedia.kind === 'soundcloud' ? 'a track' : 'a video'}`}{roomMedia.title ? `: ${roomMedia.title}` : ''}</span>
          <div className="media-controls">
            <button onClick={() => setOptIn(roomMedia.ref)}>Watch with the room</button>
            <button className="secondary" onClick={() => setPersonal({ provider: roomMedia.kind, ref: roomMedia.ref })}>Just for me</button>
          </div>
        </div>
      )}

      {(queue.items.length > 0 || (!roomMedia && queue.items.length > 0)) && (
        <div className="media-queue">
          <div className="queue-head">
            <button type="button" className="queue-toggle" onClick={() => setShowQueue((s) => !s)} aria-expanded={showQueue}>
              {showQueue ? '▾' : '▸'} Up next ({queue.items.length})
            </button>
            {!roomMedia && <button type="button" className="mini" onClick={onSkip}>▶ Play next</button>}
            {canModerate && <button type="button" className="mini" onClick={() => onRemove('all')}>Clear</button>}
          </div>
          {showQueue && (
            <ol className="queue-list">
              {queue.items.map((q) => (
                <li key={q.id}>
                  <span className="queue-title">{nameOf(q)}</span>
                  <span className="queue-by">{PROVIDER_NAME[q.provider]} · {q.by}</span>
                  {(canModerate || q.by.toLowerCase() === me.toLowerCase()) && (
                    <button type="button" className="media-x" onClick={() => onRemove(q.id)} aria-label={`Remove ${nameOf(q)} from the queue`}>✕</button>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
