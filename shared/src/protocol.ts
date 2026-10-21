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

/** Messages the browser sends to the server. */
export type ClientMsg =
  | { t: 'hello'; nick: string; token?: string }
  | { t: 'join'; room: string }
  | { t: 'leave'; room: string }
  | { t: 'say'; room: string; text: string }
  | { t: 'nick'; nick: string }
  | { t: 'ping' };

/** Messages the server sends to the browser. */
export type ServerMsg =
  | { t: 'welcome'; you: ChatUser; rooms: string[] }
  | { t: 'joined'; room: string; members: string[]; history: ChatLine[] }
  | { t: 'left'; room: string }
  | { t: 'message'; room: string; line: ChatLine }
  | { t: 'presence'; room: string; members: string[] }
  | { t: 'joinNotice'; room: string; nick: string }
  | { t: 'leaveNotice'; room: string; nick: string; reason?: string }
  | { t: 'nickNotice'; room: string; from: string; to: string }
  | { t: 'nickChanged'; nick: string }
  | { t: 'system'; room?: string; text: string }
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

/** Normalise a room name: lowercase, leading '#', no spaces. */
export function normalizeRoom(name: string): string {
  const cleaned = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/^#+/, '');
  return cleaned ? `#${cleaned}` : '';
}

/** Validate a nickname: 1..24 chars, letters/digits/_-[]. */
export function validNick(nick: string): boolean {
  return /^[A-Za-z0-9_\-[\]]{1,24}$/.test(nick);
}
