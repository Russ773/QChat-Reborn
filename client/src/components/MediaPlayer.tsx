import { useEffect, useRef } from 'react';
import { effectivePosition, type MediaItem, type MediaState } from '@qchat/shared';

/** How far (seconds) a client may drift from the server timeline before we snap. */
const DRIFT_TOLERANCE = 1.5;

interface Props {
  state: MediaState;
  /** Local (per-viewer) mute. Not synced. Muted start makes autoplay reliable. */
  muted: boolean;
  onUserSeek: (position: number) => void;
  onUserPlay: () => void;
  onUserPause: () => void;
}

export function MediaPlayer({ state, muted, onUserSeek, onUserPlay, onUserPause }: Props) {
  const item = state.currentIndex >= 0 ? state.queue[state.currentIndex] : undefined;
  if (!item) {
    return <div className="media-empty">Nothing playing. Share a link to start the party.</div>;
  }
  if (item.kind === 'youtube' && item.providerId) {
    return <YouTubePlayer key={item.id} item={item} state={state} muted={muted} />;
  }
  return (
    <Html5Player
      key={item.id}
      item={item}
      state={state}
      muted={muted}
      onUserSeek={onUserSeek}
      onUserPlay={onUserPlay}
      onUserPause={onUserPause}
    />
  );
}

/** Native <audio>/<video> element kept in sync with the authoritative timeline. */
function Html5Player({
  item,
  state,
  muted,
  onUserSeek,
  onUserPlay,
  onUserPause,
}: {
  item: MediaItem;
  state: MediaState;
  muted: boolean;
} & Pick<Props, 'onUserSeek' | 'onUserPlay' | 'onUserPause'>) {
  const ref = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  // Ignore events we cause ourselves while applying server state.
  const applying = useRef(false);

  // Apply authoritative state (and mute) whenever either changes.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    applying.current = true;
    el.muted = muted; // muted playback is always allowed to autoplay
    const target = effectivePosition(state, Date.now());
    if (Math.abs(el.currentTime - target) > DRIFT_TOLERANCE) {
      el.currentTime = target;
    }
    if (state.playing && el.paused) void el.play().catch(() => {});
    if (!state.playing && !el.paused) el.pause();
    const timer = setTimeout(() => (applying.current = false), 50);
    return () => clearTimeout(timer);
  }, [state, muted]);

  // Periodic drift correction while playing.
  useEffect(() => {
    if (!state.playing) return;
    const id = setInterval(() => {
      const el = ref.current;
      if (!el) return;
      const target = effectivePosition(state, Date.now());
      if (Math.abs(el.currentTime - target) > DRIFT_TOLERANCE) {
        applying.current = true;
        el.currentTime = target;
        setTimeout(() => (applying.current = false), 50);
      }
    }, 3000);
    return () => clearInterval(id);
  }, [state]);

  const handlePlay = () => !applying.current && onUserPlay();
  const handlePause = () => !applying.current && onUserPause();
  const handleSeeked = () => {
    if (!applying.current && ref.current) onUserSeek(ref.current.currentTime);
  };

  const commonProps = {
    ref: ref as never,
    src: item.url,
    controls: true,
    muted,
    onPlay: handlePlay,
    onPause: handlePause,
    onSeeked: handleSeeked,
    className: 'media-el',
  };

  return item.kind === 'audio' ? (
    <audio {...commonProps} />
  ) : (
    <video {...commonProps} playsInline />
  );
}

// --- YouTube ---------------------------------------------------------------

let ytApiPromise: Promise<void> | null = null;

/** Load the YouTube IFrame Player API exactly once. */
function loadYouTubeApi(): Promise<void> {
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise<void>((resolve) => {
    const w = window as unknown as { YT?: unknown; onYouTubeIframeAPIReady?: () => void };
    if (w.YT) return resolve();
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
  });
  return ytApiPromise;
}

function YouTubePlayer({
  item,
  state,
  muted,
}: {
  item: MediaItem;
  state: MediaState;
  muted: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<any>(null);
  const ready = useRef(false);

  useEffect(() => {
    let disposed = false;
    loadYouTubeApi().then(() => {
      if (disposed || !containerRef.current) return;
      const YT = (window as any).YT;
      playerRef.current = new YT.Player(containerRef.current, {
        videoId: item.providerId,
        // Start muted so programmatic autoplay isn't blocked by the browser.
        playerVars: { autoplay: state.playing ? 1 : 0, playsinline: 1, mute: muted ? 1 : 0 },
        events: {
          onReady: () => {
            ready.current = true;
            applyState();
          },
        },
      });
    });
    return () => {
      disposed = true;
      ready.current = false;
      playerRef.current?.destroy?.();
      playerRef.current = null;
    };
    // Recreate the player only when the underlying video changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, item.providerId]);

  const applyState = () => {
    const player = playerRef.current;
    if (!player || !ready.current) return;
    if (muted) player.mute?.();
    else player.unMute?.();
    const target = effectivePosition(state, Date.now());
    const current = player.getCurrentTime?.() ?? 0;
    if (Math.abs(current - target) > DRIFT_TOLERANCE) player.seekTo(target, true);
    if (state.playing) player.playVideo?.();
    else player.pauseVideo?.();
  };

  useEffect(applyState, [state, muted]);

  // Drift correction loop.
  useEffect(() => {
    if (!state.playing) return;
    const id = setInterval(applyState, 3000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <div className="media-youtube">
      <div ref={containerRef} />
    </div>
  );
}
