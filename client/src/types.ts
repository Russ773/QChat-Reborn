import type { DmThread, MediaState, RoomInfo, RoomRole, RoomTopic } from '@qchat/shared';
import type { ChatStatus } from './chat/client.js';

export type ChatEventKind =
  | 'message'
  | 'action'
  | 'notice'
  | 'system'
  | 'join'
  | 'part'
  | 'quit'
  | 'nick'
  | 'announcement';

export interface ChatEvent {
  id: string;
  kind: ChatEventKind;
  from?: string;
  text: string;
  ts: number;
  /** True when the local user is the author. */
  self?: boolean;
  /** Server sequence number (saved messages only). */
  seq?: number;
  /** When the message was last edited. */
  edited?: number;
  /** True when the message mentions the local user. */
  mention?: boolean;
}

export interface RoomState {
  name: string;
  members: string[];
  events: ChatEvent[];
  /** Unread count while the room is not active. */
  unread: number;
  /** Unread messages that mention you. */
  mentions: number;
  /** The room's current synced media, or null. */
  media: MediaState | null;
  topic: RoomTopic | null;
  roles: Record<string, RoomRole>;
  away: string[];
  /** True when older saved messages can be loaded. */
  more: boolean;
  loadingMore: boolean;
  /** Who is typing, with the time each indicator expires. */
  typing: Record<string, number>;
}

/** A private conversation. */
export interface DmState {
  /** The other person, as spelled on their account. */
  with: string;
  events: ChatEvent[];
  more: boolean;
  loadingMore: boolean;
  /** True once saved history has been fetched. */
  loaded: boolean;
  typingUntil: number;
}

/** A buffer key: rooms are "#name", private chats are "@name" (lower case). */
export const dmKey = (name: string) => `@${name.toLowerCase()}`;
export const isDmKey = (key: string | null): key is string => !!key && key.startsWith('@');

export interface AppState {
  nick: string;
  /** The logged-in account, or null before login. */
  account: string | null;
  status: ChatStatus;
  /** Every room on the server, as last reported (room browser). */
  roomList: RoomInfo[];
  /** Rooms the user has joined, keyed by room name. */
  rooms: Record<string, RoomState>;
  /** Ordered list of joined room names (for the sidebar). */
  order: string[];
  /** Private conversations, keyed by dmKey(). */
  dms: Record<string, DmState>;
  /** The conversation list with unread counts, newest first. */
  threads: DmThread[];
  /** The room ("#name") or private chat ("@name") being viewed. */
  active: string | null;
  /** System/notice log (server errors show as a toast). */
  serverLog: ChatEvent[];
  /** The latest admin announcement, shown as a dismissible banner. */
  announcement: { id: number; text: string; by: string } | null;
  /** The most recent sound to play (bumped id so effects re-fire). */
  lastSound: { id: number; room: string; sound: string; from: string } | null;
  /** Something that should get your attention (a mention or a new private message). */
  alert: { id: number; kind: 'mention' | 'dm'; from: string } | null;
}
