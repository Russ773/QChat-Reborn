/**
 * Looking up the title of a video or track, so the queue and the room can show a name instead of a bare link.
 * The server asks the service itself (YouTube, Vimeo, SoundCloud), using only an address built from a link it
 * has already validated, so a member cannot make it fetch anything else. Failures just mean "no title".
 */
import { MAX_MEDIA_TITLE, mediaLink, type MediaProvider } from '@qchat/shared';

const ENDPOINT: Partial<Record<MediaProvider, string>> = {
  youtube: 'https://www.youtube.com/oembed?format=json&url=',
  vimeo: 'https://vimeo.com/api/oembed.json?url=',
  soundcloud: 'https://soundcloud.com/oembed?format=json&url=',
};

const cache = new Map<string, string | null>();

/** Tests (and sites with no outside access) can switch lookups off with QCHAT_OEMBED=off. */
const enabled = () => process.env.QCHAT_OEMBED !== 'off';

export const cleanTitle = (s: string): string =>
  // eslint-disable-next-line no-control-regex
  s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_MEDIA_TITLE);

export async function lookupTitle(provider: MediaProvider, ref: string): Promise<string | null> {
  if (provider === 'twitch') return `${ref} (live)`;
  const base = ENDPOINT[provider];
  if (!base || !enabled()) return null;
  const key = `${provider}:${ref}`;
  if (cache.has(key)) return cache.get(key) ?? null;
  let title: string | null = null;
  try {
    const res = await fetch(base + encodeURIComponent(mediaLink({ provider, ref })), {
      signal: AbortSignal.timeout(3000),
      headers: { accept: 'application/json', 'user-agent': 'QChat/1.0' },
    });
    if (res.ok) {
      const body = (await res.text()).slice(0, 200_000);
      const data = JSON.parse(body) as { title?: unknown };
      if (typeof data.title === 'string') title = cleanTitle(data.title) || null;
    }
  } catch {
    /* no title, no problem */
  }
  if (cache.size > 500) cache.clear();
  cache.set(key, title);
  return title;
}
