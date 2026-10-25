/**
 * QChat native real-time protocol (JSON over WebSocket).
 *
 * The browser and server exchange these tagged messages directly. `t` is the
 * discriminator on every message.
 */

import type { MediaProvider, QueueItem, RadioTrack } from './media.js';
import type { Placement, WordGameSummary, WordGameView } from './wordgame.js';

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
  /** True when a bot said it. */
  bot?: true;
  /** When it was last edited, if ever. */
  edited?: number;
  /** The message this one answers. */
  replyTo?: ReplyRef;
  /** A picture shared with the message: the path of an uploaded image. */
  image?: string;
  /** Emoji reactions: emoji -> who reacted. */
  reactions?: Record<string, string[]>;
}

/** A short snapshot of the message being replied to. */
export interface ReplyRef {
  id: string;
  from: string;
  /** The start of the original text (empty if it was deleted). */
  text: string;
  deleted?: boolean;
}

/** A bot that lives in rooms. Bots are not members: they are never counted as online. */
export interface BotInfo {
  name: string;
  description: string;
  /** Shown as its picture. */
  emoji: string;
  /** Built-in bots (QBot) cannot be removed from rooms or deleted. */
  builtin: boolean;
}

export const MAX_BOT_DESCRIPTION = 200;
export const BOT_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{1,23}$/;

/** The reactions people can add to a message. */
export const REACTION_EMOJI = ['👍', '❤️', '😂', '😮', '😢', '🎉', '🔥', '👀'] as const;

/** One entry in a friends list. */
export interface FriendInfo {
  name: string;
  online: boolean;
}

/** A person's standing in a room, from most to least powerful. */
export type RoomRole = 'admin' | 'owner' | 'mod';

export interface RoomTopic {
  text: string;
  by: string;
  at: number;
}

/** The rules a room's owner has posted. */
export interface RoomRules {
  text: string;
  by: string;
  at: number;
}

/** A message a moderator pinned to the top of a room. */
export interface PinInfo {
  id: string;
  from: string;
  text: string;
  ts: number;
  image?: string;
  pinnedBy: string;
  pinnedAt: number;
}

export interface VideoParticipant {
  nick: string;
  /** Sending a camera (as opposed to only watching). */
  cam: boolean;
}

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export const MAX_VIDEO_CAMS = 4;
export const MAX_VIDEO_PEOPLE = 12;

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
  kind: MediaProvider;
  /** What is playing: a video id, a SoundCloud path, a Twitch channel (see parseMediaUrl). */
  ref: string;
  /** True when the room's radio chose it. */
  radio?: true;
  title?: string;
  by: string;
  paused: boolean;
  startedAt: number; // server epoch ms for position 0
  pausedPos: number; // seconds, used while paused
}

/** Messages the browser sends to the server. */
export type ClientMsg =
  | { t: 'hello'; nick: string; token?: string }
  /** `restore` rejoins a remembered room quietly: never creates it, and says nothing if it is gone or you are banned. */
  /** `topic` is only used when this join creates a brand new room. */
  | { t: 'join'; room: string; restore?: boolean; topic?: string }
  | { t: 'leave'; room: string }
  /** `replyTo` is a message id; `image` is the name of a file you uploaded. */
  | { t: 'say'; room: string; text: string; replyTo?: string; image?: string }
  | { t: 'react'; room: string; id: string; emoji: string }
  /** Moderators pin a message to the top of the room (or unpin it). */
  | { t: 'pin'; room: string; id: string; pin: boolean }
  | { t: 'report'; room: string; id: string; reason?: string }
  | { t: 'search'; room: string; q: string }
  | { t: 'roomAdmin'; room: string }
  | { t: 'friendRequest'; to: string }
  | { t: 'friendRespond'; from: string; accept: boolean }
  | { t: 'friendRemove'; who: string }
  | { t: 'listFriends' }
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
  /** Play a link now, for the room: YouTube, Vimeo, SoundCloud or Twitch. */
  | { t: 'playMedia'; room: string; url: string }
  /** Add a link to the room's queue (or play it, if nothing is playing). */
  | { t: 'queueAdd'; room: string; url: string }
  /** Take something out of the queue. The id "all" clears it (moderators). */
  | { t: 'queueRemove'; room: string; id: string }
  /** Vote to skip what is playing (or start the next thing, if nothing is). */
  | { t: 'mediaSkip'; room: string }
  /** `ended` says the video finished; `ref` names the video, so a late report about an earlier one is ignored. */
  | { t: 'mediaControl'; room: string; op: 'pause' | 'resume' | 'seek' | 'stop' | 'ended'; pos?: number; ref?: string }
  | { t: 'playSound'; room: string; sound: string }
  | { t: 'listRooms' }
  /** QWords, the word game. The games in a room: */
  /** Join the room's live video, sending your camera (cam) or only watching. */
  | { t: 'videoJoin'; room: string; cam: boolean }
  | { t: 'videoLeave'; room: string }
  /** Set-up messages passed between two people in the same video session (the video itself goes directly between them). */
  | { t: 'rtc'; room: string; to: string; kind: 'offer' | 'answer' | 'ice'; data: unknown }
  | { t: 'videoReport'; room: string; nick: string }
  | { t: 'wgList'; room: string }
  | { t: 'wgCreate'; room: string; maxPlayers: number }
  | { t: 'wgJoin'; id: string }
  | { t: 'wgLeave'; id: string }
  | { t: 'wgStart'; id: string }
  /** Start watching a game, and get it. */
  | { t: 'wgOpen'; id: string }
  | { t: 'wgClose'; id: string }
  | { t: 'wgPlay'; id: string; tiles: Placement[] }
  | { t: 'wgPass'; id: string }
  | { t: 'wgExchange'; id: string; letters: string[] }
  | { t: 'wgResign'; id: string }
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
      rules: RoomRules | null;
      pins: PinInfo[];
      roles: Record<string, RoomRole>;
      away: string[];
      bots: BotInfo[];
    }
  | { t: 'left'; room: string }
  | { t: 'message'; room: string; line: ChatLine }
  | { t: 'history'; room: string; lines: ChatLine[]; more: boolean }
  | { t: 'presence'; room: string; members: string[]; roles: Record<string, RoomRole>; away: string[]; bots: BotInfo[] }
  | { t: 'topic'; room: string; topic: RoomTopic | null }
  | { t: 'rules'; room: string; rules: RoomRules | null }
  | { t: 'pins'; room: string; pins: PinInfo[] }
  | { t: 'typing'; room: string; nick: string }
  | { t: 'edited'; room: string; id: string; text: string; edited: number }
  | { t: 'deleted'; room: string; id: string }
  | { t: 'reactions'; room: string; id: string; reactions: Record<string, string[]> }
  | { t: 'searchResults'; room: string; q: string; lines: ChatLine[] }
  | {
      t: 'roomAdmin';
      room: string;
      owner: string | null;
      bans: string[];
      mods: string[];
      mutes: { name: string; until: number | null }[];
    }
  | { t: 'friends'; friends: FriendInfo[]; incoming: string[]; outgoing: string[] }
  /** A friendly confirmation (shown as a toast), as opposed to an error. */
  | { t: 'info'; text: string }
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
  | { t: 'queue'; room: string; items: QueueItem[]; skipVotes: number; skipNeeded: number }
  | { t: 'radio'; room: string; on: boolean; tracks: RadioTrack[] }
  | { t: 'sound'; room: string; sound: string; from: string }
  | { t: 'announce'; text: string; by: string; room?: string }
  | { t: 'error'; text: string }
  /** The state of a room's video. `enabled` is the site-wide switch, `on` is the room's. */
  | { t: 'video'; room: string; enabled: boolean; on: boolean; participants: VideoParticipant[]; ice: IceServer[] }
  /** Sent to someone who just joined the video: who to connect to. */
  | { t: 'videoPeers'; room: string; peers: string[] }
  | { t: 'videoEnded'; room: string; reason: string }
  | { t: 'rtc'; room: string; from: string; kind: 'offer' | 'answer' | 'ice'; data: unknown }
  | { t: 'wgList'; room: string; games: WordGameSummary[] }
  /** A game, as you see it. `game` is null when it has been removed. */
  | { t: 'wg'; id: string; game: WordGameView | null }
  /** The games where it is your turn. */
  | { t: 'wgTurns'; games: { id: string; room: string }[] }
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
export const MAX_RULES = 1000;
export const MAX_PINS = 5;
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
