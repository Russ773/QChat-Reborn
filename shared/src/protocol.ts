/**
 * QChat native real-time protocol (JSON over WebSocket).
 *
 * There is no IRC here. The browser and server exchange these tagged messages
 * directly. `t` is the discriminator on every message.
 */

export interface ChatUser {
  /** Stable per-connection id. */
  id: string;
  nick: string;
  /** The registered account this connection is logged in as, else null. */
  account?: string | null;
}

export interface ChatLine {
  id: string;
  from: string;
  text: string;
  ts: number;
}

/**
 * The room's current synced media (a YouTube video). The timeline is
 * server-authoritative: while playing, position(sec) = (Date.now() - startedAt)
 * / 1000; while paused, position = pausedPos.
 */
export interface MediaState {
  kind: 'youtube';
  ref: string; // youtube video id
  title?: string;
  by: string;
  paused: boolean;
  startedAt: number; // server epoch ms for position 0
  pausedPos: number; // seconds, used while paused
}

/** Extract an 11-char YouTube id from a url or raw id, else null. */
export function youTubeId(input: string): string | null {
  const s = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const m = s.match(/(?:v=|\/embed\/|youtu\.be\/|\/v\/|\/shorts\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

/** Messages the browser sends to the server. */
export type ClientMsg =
  | { t: 'hello'; nick: string; token?: string }
  | { t: 'join'; room: string }
  | { t: 'leave'; room: string }
  | { t: 'say'; room: string; text: string }
  | { t: 'nick'; nick: string }
  | { t: 'playYouTube'; room: string; ref: string; title?: string }
  | { t: 'mediaControl'; room: string; op: 'pause' | 'resume' | 'seek' | 'stop'; pos?: number }
  | { t: 'playSound'; room: string; sound: string }
  | { t: 'listRooms' }
  | { t: 'ping' };

/** Messages the server sends to the browser. */
export type ServerMsg =
  | { t: 'welcome'; you: ChatUser }
  | { t: 'rooms'; rooms: RoomInfo[] }
  | { t: 'joined'; room: string; members: string[]; history: ChatLine[] }
  | { t: 'left'; room: string }
  | { t: 'message'; room: string; line: ChatLine }
  | { t: 'presence'; room: string; members: string[] }
  | { t: 'joinNotice'; room: string; nick: string }
  | { t: 'leaveNotice'; room: string; nick: string; reason?: string }
  | { t: 'nickNotice'; room: string; from: string; to: string }
  | { t: 'nickChanged'; nick: string }
  | { t: 'system'; room?: string; text: string }
  | { t: 'media'; room: string; state: MediaState | null }
  | { t: 'sound'; room: string; sound: string; from: string }
  | { t: 'error'; text: string }
  | { t: 'pong' };

export function encodeMsg(msg: ClientMsg | ServerMsg): string {
  return JSON.stringify(msg);
}

export function decodeMsg<T = ClientMsg | ServerMsg>(data: string): T | null {
  try {
    const parsed = JSON.parse(data);
    return parsed && typeof parsed.t === 'string' ? (parsed as T) : null;
  } catch {
    return null;
  }
}

/** One row of the room browser. */
export interface RoomInfo {
  name: string;
  members: number;
  /** True while a synced video is playing in the room. */
  media: boolean;
  /** Built-in rooms are permanent; user-made rooms vanish when empty. */
  permanent: boolean;
}

export const MAX_ROOM_NAME = 30;

/** Normalise a room name: lowercase, leading '#', no spaces. */
export function normalizeRoom(name: string): string {
  const cleaned = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/^#+/, '');
  return cleaned ? `#${cleaned}` : '';
}

/** A normalised room name is valid if it is #, then 1..30 of a-z 0-9 _ -. */
export function validRoom(room: string): boolean {
  return new RegExp(`^#[a-z0-9_-]{1,${MAX_ROOM_NAME}}$`).test(room);
}

/** Validate a nickname: 1..24 chars, letters/digits/_-[]. */
export function validNick(nick: string): boolean {
  return /^[A-Za-z0-9_\-[\]]{1,24}$/.test(nick);
}
