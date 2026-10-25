import type { BotInfo, DmThread, FriendInfo, MediaState, ReplyRef, RoomInfo, RoomRole, PinInfo, RoomRules, QueueItem, RadioTrack, WordGameSummary, WordGameView, IceServer, VideoParticipant, RoomTopic } from '@qchat/shared';
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
  /** True when a bot said it. */
  bot?: boolean;
  /** True when the message mentions the local user. */
  mention?: boolean;
  /** The message this one answers. */
  replyTo?: ReplyRef;
  /** The path of a shared picture. */
  image?: string;
  /** Emoji reactions: emoji -> who reacted. */
  reactions?: Record<string, string[]>;
}

/** The result of searching a room. */
export interface SearchState {
  q: string;
  events: ChatEvent[];
}

/** What the room settings panel shows (for moderators). */
export interface RoomAdminInfo {
  room: string;
  owner: string | null;
  bans: string[];
  mods: string[];
  mutes: { name: string; until: number | null }[];
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
  /** Live video: the site and room switches, and who is in the call. */
  video: { enabled: boolean; on: boolean; participants: VideoParticipant[]; ice: IceServer[] };
  /** What is waiting to play, and the vote to skip the current thing. */
  queue: { items: QueueItem[]; skipVotes: number; skipNeeded: number };
  /** The room's radio: on or off, and its tracks. */
  radio: { on: boolean; tracks: RadioTrack[] };
  topic: RoomTopic | null;
  /** The rules the room's owner posted, if any. */
  rules: RoomRules | null;
  /** Messages moderators pinned, newest first. */
  pins: PinInfo[];
  roles: Record<string, RoomRole>;
  away: string[];
  /** The bots in this room (never counted as members). */
  bots: BotInfo[];
  /** True when older saved messages can be loaded. */
  more: boolean;
  loadingMore: boolean;
  /** Who is typing, with the time each indicator expires. */
  typing: Record<string, number>;
  /** The latest search in this room, if any. */
  search: SearchState | null;
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
  alert: { id: number; kind: 'mention' | 'dm'; from: string; text: string } | null;
  /** Your friends (online first) and pending requests. */
  friends: FriendInfo[];
  requests: { incoming: string[]; outgoing: string[] };
  /** Room settings for the panel moderators can open. */
  roomAdmin: RoomAdminInfo | null;
  /** The word games in each room (as last reported). */
  wgGames: Record<string, WordGameSummary[]>;
  /** Games you have opened or play in, as you see them (null once removed). */
  wgViews: Record<string, WordGameView | null>;
  /** The games where it is your turn. */
  wgTurns: { id: string; room: string }[];
}
