/**
 * Shared playable media: which services QChat can play together, how to read a link for each, and the
 * shapes of the queue and the room radio. The server and the browser use the same parser, so the browser
 * can only ever embed what the server has accepted.
 */

export type MediaProvider = 'youtube' | 'vimeo' | 'soundcloud' | 'twitch';

export const PROVIDER_NAME: Record<MediaProvider, string> = {
  youtube: 'YouTube',
  vimeo: 'Vimeo',
  soundcloud: 'SoundCloud',
  twitch: 'Twitch',
};

/** A link understood and reduced to a safe reference. */
export interface MediaRef {
  provider: MediaProvider;
  /**
   * What identifies it: a YouTube video id, a Vimeo id (or "id:hash" for an unlisted video), a SoundCloud path
   * ("artist/track"), or a Twitch channel name.
   */
  ref: string;
}

/** Live streams never end, so they cannot be queued or put on the radio. */
export const isLive = (p: MediaProvider): boolean => p === 'twitch';

const SC_SEGMENT = /^[A-Za-z0-9_.-]{1,80}$/;
const SC_RESERVED = new Set([
  'discover', 'stream', 'you', 'upload', 'charts', 'search', 'pages', 'settings', 'messages', 'notifications', 'tags', 'feed', 'terms-of-use', 'imprint', 'jobs', 'popular',
]);
const TWITCH_RESERVED = new Set([
  'directory', 'videos', 'downloads', 'jobs', 'turbo', 'p', 'settings', 'subscriptions', 'friends', 'wallet', 'inventory', 'drops', 'search', 'login', 'signup', 'following', 'store', 'about', 'prime',
]);

/** Extract an 11-char YouTube id from a url or raw id, else null. */
export function youTubeId(input: string): string | null {
  const s = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const m = s.match(/(?:v=|\/embed\/|youtu\.be\/|\/v\/|\/shorts\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

/** Read a link (or, for YouTube only, a bare video id) and return what it points at, or null. */
export function parseMediaUrl(input: string): MediaRef | null {
  const s = input.trim();
  if (!s || s.length > 300) return null;

  const yt = /^[A-Za-z0-9_-]{11}$/.test(s) ? s : null;
  if (yt) return { provider: 'youtube', ref: yt };

  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase().replace(/^(www|m|player|music)\./, '');
  const parts = url.pathname.split('/').filter(Boolean);

  if (host === 'youtube.com' || host === 'youtu.be' || host === 'youtube-nocookie.com') {
    const id = youTubeId(url.href);
    return id ? { provider: 'youtube', ref: id } : null;
  }

  if (host === 'vimeo.com') {
    const segs = parts[0] === 'video' ? parts.slice(1) : parts;
    if (!/^\d{5,12}$/.test(segs[0] ?? '')) return null;
    const hash = /^[a-f0-9]{6,16}$/i.test(segs[1] ?? '') ? segs[1] : (url.searchParams.get('h') ?? '');
    return { provider: 'vimeo', ref: /^[a-f0-9]{6,16}$/i.test(hash) ? `${segs[0]}:${hash}` : segs[0] };
  }

  if (host === 'soundcloud.com') {
    if (parts.length < 2 || parts.length > 3) return null;
    if (SC_RESERVED.has(parts[0].toLowerCase())) return null;
    if (parts.length === 3 && parts[1] !== 'sets') return null;
    if (!parts.every((p) => SC_SEGMENT.test(p))) return null;
    return { provider: 'soundcloud', ref: parts.join('/') };
  }

  if (host === 'twitch.tv') {
    if (parts.length !== 1) return null;
    const channel = parts[0].toLowerCase();
    if (!/^[a-z0-9_]{3,25}$/.test(channel) || TWITCH_RESERVED.has(channel)) return null;
    return { provider: 'twitch', ref: channel };
  }

  return null;
}

/** A normal link for something, to show people or to ask the service about it. */
export function mediaLink(m: MediaRef): string {
  switch (m.provider) {
    case 'youtube':
      return `https://www.youtube.com/watch?v=${m.ref}`;
    case 'vimeo':
      return `https://vimeo.com/${m.ref.replace(':', '/')}`;
    case 'soundcloud':
      return `https://soundcloud.com/${m.ref}`;
    case 'twitch':
      return `https://www.twitch.tv/${m.ref}`;
  }
}

/** Something waiting in a room's queue. */
export interface QueueItem {
  id: string;
  provider: MediaProvider;
  ref: string;
  title: string;
  by: string;
}

/** One track of a room's radio playlist. */
export interface RadioTrack {
  id: number;
  provider: MediaProvider;
  ref: string;
  title: string;
}

export const MAX_QUEUE = 20;
export const MAX_QUEUE_PER_MEMBER = 5;
export const MAX_RADIO_TRACKS = 50;
export const MAX_MEDIA_TITLE = 120;
