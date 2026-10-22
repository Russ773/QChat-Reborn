import type { MediaState, RoomInfo } from '@qchat/shared';
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
}

export interface RoomState {
  name: string;
  members: string[];
  events: ChatEvent[];
  /** Unread count while the room is not active. */
  unread: number;
  /** The room's current synced media, or null. */
  media: MediaState | null;
}

export interface AppState {
  nick: string;
  /** The logged-in account, or null for guests. */
  account: string | null;
  status: ChatStatus;
  /** Every room on the server, as last reported (room browser). */
  roomList: RoomInfo[];
  /** Rooms the user has joined, keyed by room name. */
  rooms: Record<string, RoomState>;
  /** Ordered list of joined room names (for the sidebar). */
  order: string[];
  active: string | null;
  /** System/notice log shown when no room is active. */
  serverLog: ChatEvent[];
  /** The latest admin announcement, shown as a dismissible banner. */
  announcement: { id: number; text: string; by: string } | null;
  /** The most recent sound to play (bumped id so effects re-fire). */
  lastSound: { id: number; room: string; sound: string; from: string } | null;
}
