import type { MediaKind } from '@qchat/shared';

export interface DetectedMedia {
  kind: MediaKind;
  providerId?: string;
  url: string;
}

const URL_RE = /(https?:\/\/[^\s]+)/g;

/** Classify a single URL for rendering (mirrors the server's classifier). */
export function classify(url: string): DetectedMedia {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { kind: 'unknown', url };
  }
  const host = parsed.hostname.replace(/^www\./, '').toLowerCase();

  if ((host === 'youtube.com' || host === 'm.youtube.com') && parsed.searchParams.get('v')) {
    return { kind: 'youtube', providerId: parsed.searchParams.get('v')!, url };
  }
  if (host === 'youtu.be' && parsed.pathname.length > 1) {
    return { kind: 'youtube', providerId: parsed.pathname.slice(1), url };
  }
  const path = parsed.pathname.toLowerCase();
  if (/\.(mp3|ogg|oga|wav|m4a|flac|aac)$/.test(path)) return { kind: 'audio', url };
  if (/\.(mp4|webm|mov|m4v|ogv)$/.test(path)) return { kind: 'video', url };
  return { kind: 'unknown', url };
}

/** First playable media URL found in a message, if any. */
export function firstMediaUrl(text: string): DetectedMedia | null {
  const matches = text.match(URL_RE);
  if (!matches) return null;
  for (const m of matches) {
    const detected = classify(m);
    if (detected.kind !== 'unknown') return detected;
  }
  return null;
}

/** Split text into plain and URL segments for linkified rendering. */
export interface TextSegment {
  type: 'text' | 'url';
  value: string;
}

export function linkify(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(URL_RE)) {
    const idx = match.index ?? 0;
    if (idx > lastIndex) segments.push({ type: 'text', value: text.slice(lastIndex, idx) });
    segments.push({ type: 'url', value: match[0] });
    lastIndex = idx + match[0].length;
  }
  if (lastIndex < text.length) segments.push({ type: 'text', value: text.slice(lastIndex) });
  return segments;
}
