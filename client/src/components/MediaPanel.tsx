import { useState } from 'react';
import { youTubeId, type MediaState } from '@qchat/shared';
import { YouTubePlayer } from './YouTubePlayer.js';

interface Props {
  roomMedia: MediaState | null;
  autoplay: boolean;
  onPlayRoom: (ref: string) => void;
  onControlRoom: (op: 'pause' | 'resume' | 'seek' | 'stop', pos?: number) => void;
}

export function MediaPanel({ roomMedia, autoplay, onPlayRoom, onControlRoom }: Props) {
  const [link, setLink] = useState('');
  const [personal, setPersonal] = useState<string | null>(null);
  const [optIn, setOptIn] = useState<string | null>(null);

  const watchingRoom = !!roomMedia && !personal && (autoplay || optIn === roomMedia.ref);
  const showPrompt = !!roomMedia && !personal && !watchingRoom;

  const go = (forSelf: boolean) => {
    const id = youTubeId(link);
    if (!id) return;
    setLink('');
    if (forSelf) {
      setPersonal(id);
    } else {
      setPersonal(null);
      onPlayRoom(id);
    }
  };

  return (
    <div className="media-panel">
      <form className="media-input" onSubmit={(e) => { e.preventDefault(); go(false); }}>
        <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste a YouTube link…" />
        <button type="submit" title="Play for everyone in the room">▶ Room</button>
        <button type="button" className="secondary" title="Play just for you" onClick={() => go(true)}>👤 Just me</button>
      </form>

      {personal && (
        <div className="media-stage">
          <div className="media-head">
            <span>▶ Playing just for you</span>
            <button className="media-x" onClick={() => setPersonal(null)} aria-label="Close">✕</button>
          </div>
          <div className="yt-frame">
            <YouTubePlayer videoId={personal} autoplay />
          </div>
        </div>
      )}

      {watchingRoom && roomMedia && (
        <div className="media-stage">
          <div className="media-head">
            <span className="media-by">
              ▶ For the room{roomMedia.title ? ` · ${roomMedia.title}` : ''} · by {roomMedia.by}
            </span>
            <div className="media-controls">
              {roomMedia.paused ? (
                <button onClick={() => onControlRoom('resume')}>Resume</button>
              ) : (
                <button onClick={() => onControlRoom('pause')}>Pause</button>
              )}
              <button className="secondary" onClick={() => onControlRoom('stop')}>Stop</button>
            </div>
          </div>
          <div className="yt-frame">
            <YouTubePlayer videoId={roomMedia.ref} sync={roomMedia} autoplay onControl={onControlRoom} />
          </div>
        </div>
      )}

      {showPrompt && roomMedia && (
        <div className="media-prompt">
          <span>▶ {roomMedia.by} is playing a video{roomMedia.title ? `: ${roomMedia.title}` : ''}</span>
          <div className="media-controls">
            <button onClick={() => setOptIn(roomMedia.ref)}>Watch with the room</button>
            <button className="secondary" onClick={() => setPersonal(roomMedia.ref)}>Just for me</button>
          </div>
        </div>
      )}
    </div>
  );
}
