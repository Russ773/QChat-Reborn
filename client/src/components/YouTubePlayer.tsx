import { useEffect, useRef } from 'react';
import type { MediaState } from '@qchat/shared';

/* eslint-disable @typescript-eslint/no-explicit-any */

let apiPromise: Promise<void> | null = null;
function loadApi(): Promise<void> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    const w = window as any;
    if (w.YT?.Player) {
      resolve();
      return;
    }
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  });
  return apiPromise;
}

/** Where the synced timeline is right now, in seconds. */
function targetPos(s: MediaState): number {
  return s.paused ? s.pausedPos : (Date.now() - s.startedAt) / 1000;
}

interface Props {
  videoId: string;
  /** When set, follow this server-authoritative state (room mode). */
  sync?: MediaState | null;
  autoplay?: boolean;
  /** Report user-driven control changes back (room mode). */
  onControl?: (op: 'pause' | 'resume' | 'seek' | 'stop', pos?: number) => void;
}

export function YouTubePlayer({ videoId, sync, autoplay = true, onControl }: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<any>(null);
  const ready = useRef(false);
  const applying = useRef(false);
  const syncRef = useRef(sync);
  syncRef.current = sync;
  const autoplayRef = useRef(autoplay);
  autoplayRef.current = autoplay;

  // Create the player once.
  useEffect(() => {
    let dead = false;
    loadApi().then(() => {
      if (dead || !mountRef.current) return;
      const w = window as any;
      playerRef.current = new w.YT.Player(mountRef.current, {
        videoId,
        playerVars: { autoplay: autoplay ? 1 : 0, modestbranding: 1, rel: 0, playsinline: 1 },
        events: {
          onReady: () => {
            ready.current = true;
            applySync();
          },
          onStateChange: onPlayerState,
        },
      });
    });
    return () => {
      dead = true;
      try {
        playerRef.current?.destroy();
      } catch {
        /* ignore */
      }
      playerRef.current = null;
      ready.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swap the video when the id changes.
  useEffect(() => {
    const p = playerRef.current;
    if (p && ready.current && p.getVideoData?.().video_id !== videoId) {
      applying.current = true;
      try {
        p.loadVideoById(videoId);
      } catch {
        /* ignore */
      }
      window.setTimeout(() => {
        applying.current = false;
        applySync();
      }, 400);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  // Re-apply whenever the server state changes.
  useEffect(() => {
    applySync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync?.ref, sync?.paused, sync?.startedAt, sync?.pausedPos]);

  // Correct drift every few seconds while playing a synced video.
  useEffect(() => {
    if (!sync) return;
    const iv = window.setInterval(() => {
      if (!syncRef.current?.paused) applySync(true);
    }, 4000);
    return () => window.clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!sync]);

  function applySync(driftOnly = false) {
    const p = playerRef.current;
    const s = syncRef.current;
    if (!p || !ready.current || !s || !p.seekTo) return;
    const target = targetPos(s);
    let cur = 0;
    try {
      cur = p.getCurrentTime() || 0;
    } catch {
      /* ignore */
    }
    applying.current = true;
    if (!driftOnly || Math.abs(cur - target) > 1.5) {
      try {
        p.seekTo(Math.max(0, target), true);
      } catch {
        /* ignore */
      }
    }
    try {
      if (s.paused) p.pauseVideo();
      else if (autoplayRef.current) p.playVideo();
    } catch {
      /* ignore */
    }
    window.setTimeout(() => {
      applying.current = false;
    }, 350);
  }

  function onPlayerState(e: any) {
    if (applying.current || !onControl) return;
    const YT = (window as any).YT;
    const s = syncRef.current;
    if (!s || !YT) return;
    if (e.data === YT.PlayerState.PAUSED && !s.paused) {
      let cur = 0;
      try {
        cur = e.target.getCurrentTime() || 0;
      } catch {
        /* ignore */
      }
      onControl('seek', cur);
      onControl('pause');
    } else if (e.data === YT.PlayerState.PLAYING && s.paused) {
      onControl('resume');
    }
  }

  return (
    <div className="yt-mount">
      <div ref={mountRef} />
    </div>
  );
}
