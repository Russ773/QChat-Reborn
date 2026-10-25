import { useEffect, useRef } from 'react';
import type { MediaState } from '@qchat/shared';
import { YouTubePlayer } from './YouTubePlayer.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Control = (op: 'pause' | 'resume' | 'seek' | 'stop' | 'ended', pos?: number) => void;

interface PlayerProps {
  /** What to play: see parseMediaUrl. */
  mediaRef: string;
  /** When set, follow this server-authoritative state (room mode). */
  sync?: MediaState | null;
  autoplay?: boolean;
  onControl?: Control;
}

const scripts = new Map<string, Promise<void>>();
/** Load a player's script once. */
function loadScript(src: string, ready: () => boolean): Promise<void> {
  const known = scripts.get(src);
  if (known) return known;
  const p = new Promise<void>((resolve, reject) => {
    if (ready()) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scripts.delete(src);
      reject(new Error(`Could not load ${src}`));
    };
    document.head.appendChild(s);
  });
  scripts.set(src, p);
  return p;
}

const targetPos = (s: MediaState): number => (s.paused ? s.pausedPos : (Date.now() - s.startedAt) / 1000);

/**
 * What every synced player needs, whatever service it talks to. The service's own API is described by a few
 * small functions; this keeps following the room's timeline, fixes drift, tells the room when it has ended, and
 * turns a person's own pause/play into a room-wide one.
 */
interface Api {
  play: () => void;
  pause: () => void;
  seek: (sec: number) => void;
  /** Where the player is now, in seconds. */
  position: () => Promise<number>;
  duration: () => Promise<number>;
}

function useSync(api: React.MutableRefObject<Api | null>, ready: React.MutableRefObject<boolean>, p: PlayerProps) {
  const syncRef = useRef(p.sync);
  syncRef.current = p.sync;
  const autoplayRef = useRef(p.autoplay ?? true);
  autoplayRef.current = p.autoplay ?? true;
  const controlRef = useRef(p.onControl);
  controlRef.current = p.onControl;
  const ignoreUntil = useRef(0);
  const endedFor = useRef<string | null>(null);

  const reportEnded = () => {
    const s = syncRef.current;
    const ctl = controlRef.current;
    if (!s || !ctl) return;
    const key = `${s.ref}:${s.startedAt}`;
    if (endedFor.current === key) return;
    endedFor.current = key;
    ctl('ended');
  };

  const apply = async (driftOnly = false) => {
    const a = api.current;
    const s = syncRef.current;
    if (!a || !ready.current || !s) return;
    const target = targetPos(s);
    let cur = 0;
    let dur = 0;
    try {
      [cur, dur] = await Promise.all([a.position(), a.duration()]);
    } catch {
      /* ignore */
    }
    if (!s.paused && dur > 0 && target >= dur - 0.5) return reportEnded();
    ignoreUntil.current = Date.now() + 2000;
    if (!driftOnly || Math.abs(cur - target) > 2.5) a.seek(Math.max(0, target));
    if (s.paused) a.pause();
    else if (autoplayRef.current) a.play();
  };

  useEffect(() => {
    void apply();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.sync?.ref, p.sync?.paused, p.sync?.startedAt, p.sync?.pausedPos]);

  useEffect(() => {
    if (!p.sync) return;
    const iv = window.setInterval(() => {
      if (!syncRef.current?.paused) void apply(true);
    }, 4000);
    return () => window.clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!p.sync]);

  /** The player reported something: a person pressing play or pause themselves is the whole room's pause. */
  const userMoved = async (state: 'play' | 'pause') => {
    const s = syncRef.current;
    const ctl = controlRef.current;
    const a = api.current;
    if (!s || !ctl || !a || Date.now() < ignoreUntil.current) return;
    if (document.visibilityState !== 'visible') return;
    let cur = 0;
    try {
      cur = await a.position();
    } catch {
      return;
    }
    if (state === 'pause' && !s.paused) {
      ctl('seek', cur);
      ctl('pause');
    } else if (state === 'play' && s.paused) {
      ctl('seek', cur);
      ctl('resume');
    }
  };

  return { apply, reportEnded, userMoved };
}

// --- Vimeo ---------------------------------------------------------------------------

export function VimeoPlayer(props: PlayerProps) {
  const mount = useRef<HTMLDivElement | null>(null);
  const player = useRef<any>(null);
  const api = useRef<Api | null>(null);
  const ready = useRef(false);
  const { apply, reportEnded, userMoved } = useSync(api, ready, props);
  const [id, hash] = props.mediaRef.split(':');

  useEffect(() => {
    let dead = false;
    loadScript('https://player.vimeo.com/api/player.js', () => !!(window as any).Vimeo?.Player)
      .then(() => {
        if (dead || !mount.current) return;
        const p = new (window as any).Vimeo.Player(mount.current, {
          url: `https://vimeo.com/${id}${hash ? `/${hash}` : ''}`,
          responsive: true,
          dnt: true,
        });
        player.current = p;
        api.current = {
          play: () => void p.play().catch(() => undefined),
          pause: () => void p.pause().catch(() => undefined),
          seek: (sec) => void p.setCurrentTime(sec).catch(() => undefined),
          position: () => p.getCurrentTime(),
          duration: () => p.getDuration(),
        };
        p.on('ended', () => reportEnded());
        p.on('play', () => void userMoved('play'));
        p.on('pause', () => void userMoved('pause'));
        void p.ready().then(() => {
          ready.current = true;
          void apply();
        });
      })
      .catch(() => undefined);
    return () => {
      dead = true;
      try {
        player.current?.destroy();
      } catch {
        /* ignore */
      }
      player.current = null;
      api.current = null;
      ready.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, hash]);

  return <div className="yt-mount vimeo-mount" ref={mount} />;
}

// --- SoundCloud ---------------------------------------------------------------------

export function SoundCloudPlayer(props: PlayerProps) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const widget = useRef<any>(null);
  const api = useRef<Api | null>(null);
  const ready = useRef(false);
  const { apply, reportEnded, userMoved } = useSync(api, ready, props);
  const src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(`https://soundcloud.com/${props.mediaRef}`)}&auto_play=false&hide_related=true&show_comments=false&show_teaser=false&visual=false`;

  useEffect(() => {
    let dead = false;
    loadScript('https://w.soundcloud.com/player/api.js', () => !!(window as any).SC?.Widget)
      .then(() => {
        if (dead || !frame.current) return;
        const SC = (window as any).SC;
        const w = SC.Widget(frame.current);
        widget.current = w;
        const ask = <T,>(fn: (cb: (v: T) => void) => void): Promise<T> => new Promise((resolve) => fn(resolve));
        api.current = {
          play: () => w.play(),
          pause: () => w.pause(),
          seek: (sec) => w.seekTo(sec * 1000),
          position: () => ask<number>((cb) => w.getPosition(cb)).then((ms) => ms / 1000),
          duration: () => ask<number>((cb) => w.getDuration(cb)).then((ms) => ms / 1000),
        };
        w.bind(SC.Widget.Events.READY, () => {
          ready.current = true;
          void apply();
        });
        w.bind(SC.Widget.Events.FINISH, () => reportEnded());
        w.bind(SC.Widget.Events.PLAY, () => void userMoved('play'));
        w.bind(SC.Widget.Events.PAUSE, () => void userMoved('pause'));
      })
      .catch(() => undefined);
    return () => {
      dead = true;
      try {
        widget.current?.unbind?.('ready');
      } catch {
        /* ignore */
      }
      widget.current = null;
      api.current = null;
      ready.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.mediaRef]);

  return (
    <iframe
      ref={frame}
      className="sc-frame"
      title="SoundCloud player"
      src={src}
      allow="autoplay"
      height={166}
    />
  );
}

// --- Twitch (live: nothing to keep in step) ---------------------------------------------

export function TwitchPlayer({ mediaRef }: PlayerProps) {
  const src = `https://player.twitch.tv/?channel=${encodeURIComponent(mediaRef)}&parent=${encodeURIComponent(window.location.hostname)}&autoplay=true&muted=false`;
  return <iframe className="tw-frame" title={`${mediaRef} on Twitch`} src={src} allow="autoplay; fullscreen" allowFullScreen />;
}

/** Whichever player fits what is playing. */
export function MediaPlayer({ kind, ...p }: PlayerProps & { kind: MediaState['kind'] }) {
  switch (kind) {
    case 'vimeo':
      return <VimeoPlayer {...p} />;
    case 'soundcloud':
      return <SoundCloudPlayer {...p} />;
    case 'twitch':
      return <TwitchPlayer {...p} />;
    default:
      return <YouTubePlayer videoId={p.mediaRef} sync={p.sync} autoplay={p.autoplay} onControl={p.onControl} />;
  }
}
