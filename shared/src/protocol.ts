/**
 * QChat native real-time protocol (JSON over WebSocket).
 *
 * The browser and server exchange these tagged messages directly. `t` is the
 * discriminator on every message.
 */

export interface ChatUser {
  /** Stable per-connection id. */
  id: string;
  nick: string;
  /** The registered account this connection is logged in as. */
  account?: string | null;
}

/** One saved room message. */
export interface ChatLine {
  id: string;
  /** Stable order and paging cursor. */
  seq: number;
  from: string;
  text: string;
  ts: number;
  /** 'action' for /me lines. */
  kind?: 'action';
  /** When it was last edited, if ever. */
  edited?: number;
}

/** A person's standing in a room, from most to least powerful. */
export type RoomRole = 'admin' | 'owner' | 'mod';

export interface RoomTopic {
  text: string;
  by: string;
  at: number;
}

/** One saved private message. */
export interface Dm {
  id: string;
  seq: number;
  from: string;
  to: string;
  text: string;
  ts: number;
  kind?: 'action';
}

/** One row of the private message list. */
export interface DmThread {
  with: string;
  last: string;
  ts: number;
  unread: number;
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
  /** `restore` rejoins a remembered room quietly: never creates it, and says nothing if it is gone or you are banned. */
  | { t: 'join'; room: string; restore?: boolean }
  | { t: 'leave'; room: string }
  | { t: 'say'; room: string; text: string }
  | { t: 'nick'; nick: string }
  | { t: 'history'; room: string; before: number }
  | { t: 'typing'; room: string }
  | { t: 'edit'; room: string; id: string; text: string }
  | { t: 'delete'; room: string; id: string }
  | { t: 'dm'; to: string; text: string }
  | { t: 'dmHistory'; with: string; before?: number }
  | { t: 'dmRead'; with: string }
  | { t: 'dmTyping'; to: string }
  | { t: 'listDms' }
  | { t: 'playYouTube'; room: string; ref: string; title?: string }
  | { t: 'mediaControl'; room: string; op: 'pause' | 'resume' | 'seek' | 'stop'; pos?: number }
  | { t: 'playSound'; room: string; sound: string }
  | { t: 'listRooms' }
  | { t: 'ping' };

/** Messages the server sends to the browser. */
export type ServerMsg =
  | { t: 'welcome'; you: ChatUser }
  | {
      t: 'joined';
      room: string;
      members: string[];
      history: ChatLine[];
      /** True when older messages are saved and can be loaded. */
      more: boolean;
      topic: RoomTopic | null;
      roles: Record<string, RoomRole>;
      away: string[];
    }
  | { t: 'left'; room: string }
  | { t: 'message'; room: string; line: ChatLine }
  | { t: 'history'; room: string; lines: ChatLine[]; more: boolean }
  | { t: 'presence'; room: string; members: string[]; roles: Record<string, RoomRole>; away: string[] }
  | { t: 'topic'; room: string; topic: RoomTopic | null }
  | { t: 'typing'; room: string; nick: string }
  | { t: 'edited'; room: string; id: string; text: string; edited: number }
  | { t: 'deleted'; room: string; id: string }
  | { t: 'joinNotice'; room: string; nick: string }
  | { t: 'leaveNotice'; room: string; nick: string; reason?: string }
  | { t: 'dm'; msg: Dm }
  | { t: 'dmHistory'; with: string; lines: Dm[]; more: boolean }
  | { t: 'dms'; threads: DmThread[] }
  | { t: 'dmTyping'; from: string }
  | { t: 'dmNotice'; with: string; text: string }
  | { t: 'system'; room?: string; text: string }
  | { t: 'rooms'; rooms: RoomInfo[] }
  | { t: 'media'; room: string; state: MediaState | null }
  | { t: 'sound'; room: string; sound: string; from: string }
  | { t: 'announce'; text: string; by: string; room?: string }
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
  /** Built-in rooms are permanent. */
  permanent: boolean;
  topic?: string;
  owner?: string;
}

export const MAX_ROOM_NAME = 30;
export const MAX_MESSAGE = 2000;
export const MAX_TOPIC = 200;
export const HISTORY_PAGE = 50;

/** Normalise a room name: lowercase, leading '#', no spaces. */
export function normalizeRoom(name: string): string {
  const cleaned = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/^#+/, '');
  return cleaned ? `#${cleaned}` : '';
}

/** A normalised room name is valid if it is #, then 1..30 of a-z 0-9 _ -. */
export function validRoom(room: string): boolean {
  return new RegExp(`^#[a-z0-9_-]{1,${MAX_ROOM_NAME}}$`).test(room);
}

/** Does this text mention the given name (as @name or a standalone word)? */
export function mentions(text: string, name: string): boolean {
  if (!name) return false;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9_])@?${esc}(?![A-Za-z0-9_])`, 'i').test(text);
}
