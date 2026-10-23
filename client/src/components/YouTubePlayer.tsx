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
  onControl?: (op: 'pause' | 'resume' | 'seek' | 'stop' | 'ended', pos?: number) => void;
}

export function YouTubePlayer({ videoId, sync, autoplay = true, onControl }: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<any>(null);
  const ready = useRef(false);
  // Player events before this time are echoes of our own seek/play/pause calls
  // (YouTube emits late PAUSED/BUFFERING events after a seek), not the user.
  const ignoreUntil = useRef(0);
  const settleTimer = useRef<number | null>(null);
  const unloading = useRef(false);
  // Which playing of which video we have already reported as finished (so it is said once).
  const endedFor = useRef<string | null>(null);
  const syncRef = useRef(sync);
  syncRef.current = sync;
  const autoplayRef = useRef(autoplay);
  autoplayRef.current = autoplay;
  const onControlRef = useRef(onControl);
  onControlRef.current = onControl;

  // Note when the page is going away so teardown events are not treated as input.
  useEffect(() => {
    const mark = () => {
      unloading.current = true;
    };
    window.addEventListener('pagehide', mark);
    window.addEventListener('beforeunload', mark);
    return () => {
      window.removeEventListener('pagehide', mark);
      window.removeEventListener('beforeunload', mark);
    };
  }, []);

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
      if (settleTimer.current) window.clearTimeout(settleTimer.current);
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
      ignoreUntil.current = Date.now() + 2500;
      try {
        p.loadVideoById(videoId);
      } catch {
        /* ignore */
      }
      window.setTimeout(() => applySync(), 600);
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

  /** Tell the room this video has finished, once. The server then clears it for everyone. */
  function reportEnded() {
    const s = syncRef.current;
    const ctl = onControlRef.current;
    if (!s || !ctl) return;
    const key = `${s.ref}:${s.startedAt}`;
    if (endedFor.current === key) return;
    endedFor.current = key;
    ctl('ended');
  }

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
    const YT = (window as any).YT;
    let state = -2;
    try {
      state = p.getPlayerState();
    } catch {
      /* ignore */
    }
    // A video that has run its course is over. Never seek past its end or press play again: that is
    // what made a finished video start over, play a few seconds, and be dragged back to the end, forever.
    let duration = 0;
    try {
      duration = p.getDuration?.() || 0;
    } catch {
      /* ignore */
    }
    if (!s.paused && duration > 0 && target >= duration - 0.5) {
      reportEnded();
      return;
    }
    if (state === YT?.PlayerState?.ENDED) {
      reportEnded();
      return;
    }
    // Only seek when we are properly out of sync; a loose threshold avoids
    // fighting normal buffering jitter (and seeks while still loading).
    const loading = state === YT?.PlayerState?.BUFFERING || state === YT?.PlayerState?.UNSTARTED;
    const needsSeek = driftOnly ? !loading && Math.abs(cur - target) > 2.5 : true;    ignoreUntil.current = Date.now() + 2000;
    if (needsSeek) {
      try {
        p.seekTo(Math.max(0, target), true);
      } catch {
        /* ignore */
      }
    }
    try {
      if (s.paused) {
        if (state !== YT?.PlayerState?.PAUSED) p.pauseVideo();
      } else if (autoplayRef.current && state !== YT?.PlayerState?.PLAYING) {
        p.playVideo();
      }
    } catch {
      /* ignore */
    }
  }

  /**
   * A player event only counts as the user's own pause/resume if it is not an
   * echo of our sync calls AND the player is still in that state after a short
   * settle delay (transient states during seeks are dropped).
   */
  function onPlayerState(e: any) {
    const YT = (window as any).YT;
    if (!YT) return;
    if (e.data === YT.PlayerState.ENDED) {
      reportEnded();
      return;
    }
    if (!onControlRef.current) return;
    if (e.data !== YT.PlayerState.PAUSED && e.data !== YT.PlayerState.PLAYING) return;
    if (Date.now() < ignoreUntil.current) return;
    if (settleTimer.current) window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      const p = playerRef.current;
      const s = syncRef.current;
      const ctl = onControlRef.current;
      if (!p || !s || !ctl || Date.now() < ignoreUntil.current) return;
      // Closing/reloading the tab or backgrounding it makes the iframe report
      // PAUSED. That must never pause the room for everyone else.
      if (unloading.current || document.visibilityState !== 'visible') return;
      let state = -2;
      let cur = 0;
      try {
        // A real click or keypress on the player focuses its iframe; teardown
        // and other automatic pauses do not.
        if (document.activeElement !== p.getIframe?.()) return;
        state = p.getPlayerState();
        cur = p.getCurrentTime() || 0;
      } catch {
        return;
      }
      if (state === YT.PlayerState.PAUSED && !s.paused) {
        ctl('seek', cur);
        ctl('pause');
      } else if (state === YT.PlayerState.PLAYING && s.paused) {
        ctl('seek', cur);
        ctl('resume');
      }
    }, 500);
  }

  return (
    <div className="yt-mount">
      <div ref={mountRef} />
    </div>
  );
}
