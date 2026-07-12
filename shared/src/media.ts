/**
 * QChat media protocol.
 *
 * Watch-party media rides on top of IRC via a custom `MEDIA` command whose
 * single trailing parameter is a JSON-encoded {@link MediaEvent}. The server
 * is authoritative: clients send intents (enqueue/play/pause/seek/skip) and the
 * server replies to the whole channel with a normalized {@link MediaState}
 * snapshot so that late-joiners and drifting clients can reconcile.
 *
 * Standard IRC clients that don't understand `MEDIA` still see a plain PRIVMSG
 * fallback ("Alice shared a video: <url>") emitted alongside it by the server.
 */

export const MEDIA_COMMAND = 'MEDIA';

/** Supported media source kinds. Extend as new providers are added. */
export type MediaKind = 'youtube' | 'audio' | 'video' | 'unknown';

export interface MediaItem {
  /** Stable id for this queue entry (server-assigned). */
  id: string;
  /** Original URL as shared by the user. */
  url: string;
  kind: MediaKind;
  /** Provider-specific id (e.g. a YouTube video id) when resolvable. */
  providerId?: string;
  /** Human-readable title once resolved; falls back to the URL. */
  title?: string;
  /** Duration in seconds if known. */
  duration?: number;
  /** Nick of whoever added it. */
  addedBy: string;
}

/**
 * Authoritative playback state for a channel, broadcast by the server.
 *
 * `positionAt` pairs a playback `position` (seconds into the item) with the
 * server timestamp `atServerMs` it was sampled. A client computes the current
 * position as `position + (playing ? (now - atServerMs) / 1000 : 0)`.
 */
export interface MediaState {
  channel: string;
  queue: MediaItem[];
  /** Index into `queue` of the current item, or -1 when idle. */
  currentIndex: number;
  playing: boolean;
  position: number;
  atServerMs: number;
}

/** Client -> server: add a URL to the channel queue. */
export interface MediaEnqueue {
  t: 'enqueue';
  url: string;
}

/** Client -> server: resume playback of the current item. */
export interface MediaPlay {
  t: 'play';
}

/** Client -> server: pause the current item. */
export interface MediaPause {
  t: 'pause';
}

/** Client -> server: seek the current item to `position` seconds. */
export interface MediaSeek {
  t: 'seek';
  position: number;
}

/** Client -> server: skip to the next item (or to `index` if given). */
export interface MediaSkip {
  t: 'skip';
  index?: number;
}

/** Client -> server: remove a queue item by id. */
export interface MediaRemove {
  t: 'remove';
  id: string;
}

/** Server -> clients: full authoritative snapshot. */
export interface MediaStateEvent {
  t: 'state';
  state: MediaState;
}

export type MediaClientEvent =
  | MediaEnqueue
  | MediaPlay
  | MediaPause
  | MediaSeek
  | MediaSkip
  | MediaRemove;

export type MediaServerEvent = MediaStateEvent;

export type MediaEvent = MediaClientEvent | MediaServerEvent;

/** Parse a MEDIA command's JSON payload, returning null on malformed input. */
export function parseMediaEvent(payload: string): MediaEvent | null {
  try {
    const value = JSON.parse(payload);
    if (value && typeof value === 'object' && typeof value.t === 'string') {
      return value as MediaEvent;
    }
  } catch {
    /* fall through */
  }
  return null;
}

export function encodeMediaEvent(event: MediaEvent): string {
  return JSON.stringify(event);
}

/** Compute the effective playback position given an authoritative snapshot. */
export function effectivePosition(state: MediaState, nowMs: number): number {
  if (!state.playing) return state.position;
  return state.position + (nowMs - state.atServerMs) / 1000;
}
