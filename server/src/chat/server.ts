import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import {
  COMMANDS,
  HISTORY_PAGE,
  MAX_MESSAGE,
  MAX_GAMES_PER_MEMBER,
  MAX_PINS,
  MAX_VIDEO_CAMS,
  MAX_VIDEO_PEOPLE,
  MAX_RULES,
  MAX_TOPIC,
  REACTION_EMOJI,
  decodeMsg,
  encodeMsg,
  normalizeRoom,
  validRoom,
  MAX_QUEUE,
  MAX_QUEUE_PER_MEMBER,
  MAX_RADIO_TRACKS,
  isLive,
  mediaLink,
  parseMediaUrl,
  type AdminRoom,
  type ChatLine,
  type ClientMsg,
  type FriendInfo,
  type IceServer,
  type MediaProvider,
  type MediaState,
  type QueueItem,
  type RoomInfo,
  type RoomRole,
  type ServerMsg,
} from '@qchat/shared';
import { QBOT, WEATHER_BOT, botInRoom, botsInRoom, claimGreeting, ensureBuiltInBots, ensureTriviaBot, ensureWeatherBot, getBot } from '../bots.js';
import { takeDailyPost } from '../daily.js';
import { WEATHER_HELP, weatherReply } from '../weather.js';
import { getProfile as getProfileOf } from '../profiles.js';
import { PollBoard } from '../qbot-polls.js';
import { qbotReply, welcomeText } from '../qbot.js';
import {
  MAX_REMIND_MS,
  MAX_REMIND_TEXT,
  MIN_REMIND_S,
  STALE_MS,
  addReminder,
  clearReminders,
  deleteReminder,
  dueReminders,
  formatDuration,
  listReminders,
  parseDuration,
} from '../reminders.js';
import {
  CATEGORIES,
  DEFAULT_QUESTIONS,
  GAP_MS,
  MAX_QUESTIONS,
  MIN_QUESTIONS,
  TRIVIA_BOT,
  TriviaGame,
  findCategory,
  pickQuestions,
  recordGame,
  recordPoints,
  scoreFor,
  topScores,
} from '../trivia.js';
import { screenText } from '../filter.js';
import { cleanTitle, lookupTitle } from '../oembed.js';
import { isApprovedSound } from '../sounds.js';
import * as wg from '../wordgame.js';
import { recordError } from '../monitor.js';
import * as stats from '../stats.js';
import { SpamWatch } from '../spam.js';
import { getSettings } from '../settings.js';
import { WS_LOGIN_TIMEOUT_MS } from '../security.js';
import { UPLOAD_NAME_RE, removeUploadFiles } from '../uploads.js';
import * as store from './store.js';

interface Conn {
  id: string;
  ws: WebSocket;
  nick: string;
  account: string | null;
  rooms: Set<string>;
  /** Away message, or null when present. */
  away: string | null;
  alive: boolean;
  lastTyping: number;
  /** Recent send times, for flood control. */
  stamps: number[];
}

/** What the chat engine needs to know from the rest of the app. */
export interface ChatPolicy {
  /** Resolve a session token to an account name, or null. */
  resolve: (token: string) => string | null;
  /** The line shown to everyone as they join a room ('' for none). */
  welcome: () => string;
  /** While true, only administrators may be connected. */
  maintenance: () => boolean;
  isAdmin: (account: string) => boolean;
  /** Find a member by name (any case): the proper spelling and when they joined. */
  lookup: (name: string) => { account: string; createdAt: number } | null;
  /** Whether a member accepts private messages. */
  allowsPm: (account: string) => boolean;
  /** Which of QBot's jobs are switched on. */
  qbot: () => { welcome: boolean; commands: boolean };
}

/**
 * How long to wait before telling a room someone "left chat" after their window closes. A page reload comes
 * straight back, and should not be announced as a leave and a join.
 */
const LEAVE_GRACE_MS = Number.isFinite(Number(process.env.QCHAT_LEAVE_GRACE_MS)) && process.env.QCHAT_LEAVE_GRACE_MS !== undefined && process.env.QCHAT_LEAVE_GRACE_MS !== '' ? Number(process.env.QCHAT_LEAVE_GRACE_MS) : 4000;

const DEFAULT_ROOMS = ['#lobby', '#general', '#help', '#trivia'];
const DEFAULT_TOPICS: Record<string, string> = {
  '#lobby': 'Welcome to QChat Reborn. Say hello!',
  '#general': 'Chat about anything.',
  '#help': 'Stuck? Ask here and someone will help.',
  '#trivia': 'Trivia time! Type !trivia to start a round, or !triviahelp for the rules.',
};
/** Cap on rooms in existence, so nobody can fill the database by spamming creates. */
const MAX_ROOMS = 300;
const MAX_CONNS_PER_ACCOUNT = 8;
/** At most this many messages in this many milliseconds (admins are exempt). */
const FLOOD_COUNT = 6;
const FLOOD_WINDOW = 8000;
const DAY = 24 * 3600 * 1000;
/** User rooms nobody has touched for this long are deleted. */
const ROOM_EXPIRY = 30 * DAY;
const KEEP_MESSAGES = 5000;
/** Private messages kept per conversation. */
const KEEP_DMS = 2000;
/** A picture nobody uses is removed after this long (so a picture you are about to send is safe). */
const UNUSED_PICTURE_GRACE = DAY;

/** Newlines and tabs become a space; other control characters are dropped. */
const sanitize = (text: string) =>
  text
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, MAX_MESSAGE);
const label = (room: string) => room.replace(/^#/, '');

/**
 * The native real-time chat engine: live connections, rooms (saved in the
 * database, with owners, moderators, topics and saved history), private
 * messages, slash commands, and the admin controls.
 */
export class ChatServer {
  private conns = new Map<string, Conn>();
  /** room|account -> a "left chat" announcement waiting out the grace period. */
  private pendingLeaves = new Map<string, ReturnType<typeof setTimeout>>();
  /** Live membership: room -> connection ids. Rooms themselves live in the database. */
  private live = new Map<string, Set<string>>();
  private media = new Map<string, MediaState>(); // room -> current synced media
  private blocks = new Map<string, Set<string>>(); // account (lower) -> blocked (lower)

  constructor(
    private log: (msg: string) => void,
    private policy: ChatPolicy,
  ) {
    store.ensureBuiltInRooms(DEFAULT_ROOMS);
    store.seedDefaultTopics(DEFAULT_TOPICS);
    ensureBuiltInBots();
    ensureTriviaBot();
    ensureWeatherBot();

    // Drop dead connections.
    setInterval(() => {
      for (const c of this.conns.values()) {
        if (!c.alive) {
          c.ws.terminate();
          continue;
        }
        c.alive = false;
        try {
          c.ws.ping();
        } catch {
          /* closing */
        }
      }
    }, 30000).unref();

    // Tidy up old rooms and messages now and then.
    const tidy = () => {
      const gone = store.expireRooms(Date.now() - ROOM_EXPIRY, (n) => (this.live.get(n)?.size ?? 0) > 0);
      for (const n of gone) this.log(`room expired (unused for 30 days): ${n}`);
      store.trimMessages(KEEP_MESSAGES);
      store.trimDms(KEEP_DMS);
      this.spam.sweep();
      this.dailyPost();
      this.wgSweep();
      const unused = store.takeUnusedUploads(Date.now() - UNUSED_PICTURE_GRACE);
      if (unused.length > 0) {
        removeUploadFiles(unused);
        this.log(`removed ${unused.length} unused picture(s)`);
      }
    };
    tidy();
    setInterval(tidy, 3600 * 1000).unref();

    // QBot: close polls whose time is up and deliver reminders that are due.
    setInterval(() => this.qbotSweep(), 5000).unref();
  }

  accept(ws: WebSocket): void {
    const conn: Conn = {
      id: randomUUID(),
      ws,
      nick: '',
      account: null,
      rooms: new Set(),
      away: null,
      alive: true,
      lastTyping: 0,
      stamps: [],
    };
    this.conns.set(conn.id, conn);

    ws.on('message', (data) => {
      conn.alive = true;
      const raw = typeof data === 'string' ? data : data.toString();
      // Only a video set-up message may be more than 16 KB; anything else that big is not from a real client.
      if (raw.length > 16 * 1024 && !raw.startsWith('{"t":"rtc"')) return void conn.ws.close(1009, 'Message too big');
      const msg = decodeMsg<ClientMsg>(raw);
      if (!msg) return;
      // One bad message (or a bug it uncovers) must never take the whole server down.
      try {
        this.handle(conn, msg);
      } catch (err) {
        recordError('message', err);
        this.log(`error handling a "${String(msg.t).slice(0, 20)}" message: ${String(err)}`);
        this.send(conn, { t: 'error', text: 'Something went wrong with that. Please try again.' });
      }
    });
    ws.on('pong', () => (conn.alive = true));
    ws.on('close', () => {
      clearTimeout(loginTimer);
      this.disconnect(conn);
    });
    // A connection that never logs in is not kept open.
    const loginTimer = setTimeout(() => {
      if (!conn.account) ws.close(4001, 'Login required');
    }, WS_LOGIN_TIMEOUT_MS);
    ws.on('error', () => this.disconnect(conn));
  }

  // --- Dispatch -------------------------------------------------------------

  private handle(conn: Conn, msg: ClientMsg): void {
    if (msg.t === 'ping') return this.send(conn, { t: 'pong' });
    if (msg.t === 'hello') return this.onHello(conn, msg.token);
    if (!conn.account) return this.send(conn, { t: 'error', text: 'Please log in to chat.' });

    switch (msg.t) {
      case 'join':
        return this.onJoin(conn, msg.room, msg.restore === true, msg.topic);
      case 'leave':
        return this.onLeave(conn, msg.room, 'left');
      case 'say':
        return this.onSay(conn, msg.room, String(msg.text ?? ''), msg.replyTo, msg.image);
      case 'pin':
        return this.onPin(conn, msg.room, String(msg.id ?? ''), msg.pin !== false);
      case 'react':
        return this.onReact(conn, msg.room, String(msg.id ?? ''), String(msg.emoji ?? ''));
      case 'report':
        return this.onReport(conn, msg.room, String(msg.id ?? ''), msg.reason);
      case 'search':
        return this.onSearch(conn, msg.room, String(msg.q ?? ''));
      case 'roomAdmin':
        return this.onRoomAdmin(conn, msg.room);
      case 'friendRequest':
        return this.onFriendRequest(conn, String(msg.to ?? ''));
      case 'friendRespond':
        return this.onFriendRespond(conn, String(msg.from ?? ''), msg.accept === true);
      case 'friendRemove':
        return this.onFriendRemove(conn, String(msg.who ?? ''));
      case 'listFriends':
        return this.send(conn, { t: 'friends', ...this.friendList(conn.account!) });
      case 'nick':
        return this.send(conn, { t: 'error', text: 'Your chat name is your account name.' });
      case 'history':
        return this.onHistory(conn, msg.room, Number(msg.before));
      case 'typing':
        return this.onTyping(conn, msg.room);
      case 'edit':
        return this.onEdit(conn, msg.room, String(msg.id ?? ''), String(msg.text ?? ''));
      case 'delete':
        return this.onDelete(conn, msg.room, String(msg.id ?? ''));
      case 'dm':
        return this.onDm(conn, String(msg.to ?? ''), String(msg.text ?? ''));
      case 'dmHistory':
        return this.onDmHistory(conn, String(msg.with ?? ''), msg.before ? Number(msg.before) : undefined);
      case 'dmRead':
        return this.onDmRead(conn, String(msg.with ?? ''));
      case 'dmTyping':
        return this.onDmTyping(conn, String(msg.to ?? ''));
      case 'listDms':
        return this.sendThreads(conn.account);
      case 'playYouTube':
        return this.onPlayMedia(conn, msg.room, String(msg.ref ?? ''), msg.title);
      case 'playMedia':
        return this.onPlayMedia(conn, msg.room, String(msg.url ?? ''));
      case 'queueAdd':
        return this.onQueueAdd(conn, msg.room, String(msg.url ?? ''));
      case 'queueRemove':
        return this.onQueueRemove(conn, msg.room, String(msg.id ?? ''));
      case 'mediaSkip':
        return this.onMediaSkip(conn, msg.room);
      case 'mediaControl':
        return this.onMediaControl(conn, msg.room, msg.op, msg.pos, msg.ref);
      case 'playSound':
        return this.onPlaySound(conn, msg.room, msg.sound);
      case 'listRooms':
        return this.send(conn, { t: 'rooms', rooms: this.roomInfos() });
      case 'videoJoin':
        return this.onVideoJoin(conn, msg.room, msg.cam === true);
      case 'videoLeave':
        return void this.leaveVideo(conn.id, normalizeRoom(msg.room), 'You left the video.');
      case 'rtc':
        return this.onRtc(conn, msg.room, String(msg.to ?? ''), msg.kind, msg.data);
      case 'videoReport':
        return this.onVideoReport(conn, msg.room, String(msg.nick ?? ''));
      case 'wgList':
        return this.onWgList(conn, msg.room);
      case 'wgCreate':
        return this.onWgCreate(conn, msg.room, Number(msg.maxPlayers));
      case 'wgJoin':
        return this.onWgJoin(conn, String(msg.id ?? ''));
      case 'wgLeave':
        return this.onWgLeave(conn, String(msg.id ?? ''));
      case 'wgStart':
        return this.onWgStart(conn, String(msg.id ?? ''));
      case 'wgOpen':
        return this.onWgOpen(conn, String(msg.id ?? ''));
      case 'wgClose':
        return void this.wgWatchers.get(String(msg.id ?? ''))?.delete(conn.id);
      case 'wgPlay':
        return this.onWgMove(conn, String(msg.id ?? ''), (g, me) => wg.playTiles(g, me, Array.isArray(msg.tiles) ? msg.tiles.slice(0, 7) : []));
      case 'wgPass':
        return this.onWgMove(conn, String(msg.id ?? ''), (g, me) => wg.passTurn(g, me));
      case 'wgExchange':
        return this.onWgMove(conn, String(msg.id ?? ''), (g, me) => wg.exchangeTiles(g, me, Array.isArray(msg.letters) ? msg.letters.slice(0, 7).map(String) : []));
      case 'wgResign':
        return this.onWgMove(conn, String(msg.id ?? ''), (g, me) => wg.resign(g, me));
    }
  }

  private onHello(conn: Conn, token?: string): void {
    // Chatting needs an account: no valid session token, no connection.
    const account = token ? this.policy.resolve(token) : null;
    if (!account) return this.reject(conn, 'Please log in to chat.');
    if (this.policy.maintenance() && !this.policy.isAdmin(account)) {
      return this.reject(conn, 'QChat is down for maintenance. Please try again soon.');
    }
    if (this.connsOf(account).length >= MAX_CONNS_PER_ACCOUNT) {
      return this.reject(conn, 'You have too many QChat windows open. Close one and try again.');
    }
    conn.account = account;
    conn.nick = account;
    stats.noteActive(account.toLowerCase());
    stats.notePeak(this.onlineAccounts().size);
    this.send(conn, { t: 'welcome', you: { id: conn.id, nick: conn.nick, account } });
    this.sendThreads(account, conn);
    this.send(conn, { t: 'friends', ...this.friendList(account) });
    if (this.connsOf(account).length === 1) this.pushToFriends(account); // just came online
    this.deliverReminders(account); // anything that came due while they were away
    this.sendWgTurns(account.toLowerCase());
  }

  // --- Rooms ------------------------------------------------------------------

  private onJoin(conn: Conn, roomName: string, restore = false, topic?: string): void {
    const account = conn.account!;
    const room = normalizeRoom(roomName);
    if (!validRoom(room)) {
      if (restore) return;
      return this.send(conn, {
        t: 'error',
        text: 'Room names can use letters, numbers, - and _ (up to 30 characters).',
      });
    }
    const isAdmin = this.policy.isAdmin(account);
    if (!isAdmin && store.isBanned(room, account.toLowerCase())) {
      if (restore) return;
      return this.send(conn, { t: 'error', text: `You are banned from ${label(room)}.` });
    }

    let row = store.getRoom(room);
    if (!row && restore) return; // a remembered room that no longer exists is not re-created
    if (!row) {
      if (store.roomCount() >= MAX_ROOMS) {
        return this.send(conn, { t: 'error', text: 'There are too many rooms right now. Try joining an existing one.' });
      }
      row = store.createRoom(room, account);
      this.log(`room created: ${room} by ${conn.nick}`);
      // The creator can give a brand new room its topic straight away.
      const first = topic ? sanitize(topic).slice(0, MAX_TOPIC) : '';
      if (first) {
        store.setTopic(room, first, conn.nick);
        row = store.getRoom(room)!;
      }
    }

    let members = this.live.get(room);
    if (!members) {
      members = new Set();
      this.live.set(room, members);
    }
    const joinedNow = !members.has(conn.id);
    if (joinedNow) {
      members.add(conn.id);
      conn.rooms.add(room);
      // Coming straight back (a page reload) or opening a second window is not announced again.
      const key = `${room}|${account.toLowerCase()}`;
      const waiting = this.pendingLeaves.get(key);
      if (waiting) {
        clearTimeout(waiting);
        this.pendingLeaves.delete(key);
      } else if (!this.connsOf(account).some((c) => c.id !== conn.id && c.rooms.has(room))) {
        this.broadcast(room, { t: 'joinNotice', room, nick: conn.nick }, conn.id);
      }
    }
    store.touchRoom(room);

    const page = store.getMessages(room, undefined, HISTORY_PAGE);
    this.send(conn, {
      t: 'joined',
      room,
      members: this.memberNicks(room),
      history: this.unblocked(page.lines, account),
      more: page.more,
      topic: store.topicOf(store.getRoom(room)),
      rules: store.rulesOf(store.getRoom(room)),
      pins: store.pinsOf(room),
      roles: this.roleMap(room),
      away: this.awayNicks(room),
      bots: botsInRoom(room),
    });
    this.broadcastPresence(room);
    const media = this.media.get(room);
    if (media) this.send(conn, { t: 'media', room, state: media });
    this.send(conn, this.queueState(room));
    this.send(conn, this.radioState(room));
    this.send(conn, this.videoState(room));
    if (joinedNow) {
      // A room that has been empty starts fresh: a stopped radio may play again.
      if (this.memberNicks(room).length <= 1) this.radioHold.delete(room);
      this.maybeStartRadio(room);
    }
    const welcome = this.policy.welcome();
    if (welcome && joinedNow) this.send(conn, { t: 'system', room, text: welcome });
    // QBot's first job: welcome a member the first time they ever join a room (never on a quiet rejoin).
    // They only count as welcomed once the welcome is really sent, so leaving straight away loses nothing.
    if (joinedNow && !restore && this.policy.qbot().welcome) {
      const nick = conn.nick;
      setTimeout(() => {
        if (this.live.get(room)?.has(conn.id) && this.policy.qbot().welcome && claimGreeting(account)) {
          this.botSay(QBOT, room, welcomeText(nick));
        }
      }, 1500);
    }
  }

  private onLeave(conn: Conn, roomName: string, reason: string): void {
    const room = normalizeRoom(roomName);
    const members = this.live.get(room);
    if (!members || !members.has(conn.id)) return;
    members.delete(conn.id);
    conn.rooms.delete(room);
    this.leaveVideo(conn.id, room);
    this.send(conn, { t: 'left', room });
    // Still in this room in another window? Then they have not left it.
    if (!this.connsOf(conn.account ?? '').some((c) => c.id !== conn.id && c.rooms.has(room))) {
      this.broadcast(room, { t: 'leaveNotice', room, nick: conn.nick, reason });
    }
    this.broadcastPresence(room);
  }

  private disconnect(conn: Conn): void {
    if (!this.conns.has(conn.id)) return;
    this.conns.delete(conn.id);
    for (const set of this.wgWatchers.values()) set.delete(conn.id);
    for (const room of [...this.videoRooms.keys()]) this.leaveVideo(conn.id, room);
    for (const room of conn.rooms) {
      this.live.get(room)?.delete(conn.id);
      this.broadcastPresence(room);
      const account = conn.account;
      if (!account) continue;
      if (this.connsOf(account).some((c) => c.rooms.has(room))) continue; // still here in another window
      // Tell the room they left chat, after a moment, so that a reload is not announced.
      const key = `${room}|${account.toLowerCase()}`;
      const nick = conn.nick;
      clearTimeout(this.pendingLeaves.get(key));
      const announce = () => {
        this.pendingLeaves.delete(key);
        if (this.connsOf(account).some((c) => c.rooms.has(room))) return;
        this.broadcast(room, { t: 'leaveNotice', room, nick, reason: 'disconnected' });
      };
      if (LEAVE_GRACE_MS <= 0) {
        announce();
      } else {
        const timer = setTimeout(announce, LEAVE_GRACE_MS);
        timer.unref?.();
        this.pendingLeaves.set(key, timer);
      }
    }
    if (conn.account && this.connsOf(conn.account).length === 0) this.pushToFriends(conn.account); // went offline
  }

  private inRoom(conn: Conn, room: string): boolean {
    return this.live.get(room)?.has(conn.id) ?? false;
  }

  // --- Messages ---------------------------------------------------------------

  private onSay(conn: Conn, roomName: string, text: string, replyTo?: string, image?: string): void {
    const room = normalizeRoom(roomName);
    if (!this.inRoom(conn, room)) return this.send(conn, { t: 'error', text: 'You are not in that room.' });
    const extra = {
      replyTo: typeof replyTo === 'string' && replyTo ? replyTo : undefined,
      image: typeof image === 'string' && image ? image : undefined,
    };
    // "/something" is a command; "//something" is a message that starts with a slash.
    // (A picture's caption is always plain text.)
    if (!extra.image && !extra.replyTo && text.startsWith('/') && !text.startsWith('//')) {
      return this.runCommand(conn, room, text);
    }
    this.postMessage(conn, room, text.startsWith('//') ? text.slice(1) : text, undefined, extra);
  }

  private postMessage(
    conn: Conn,
    room: string,
    text: string,
    kind: 'action' | undefined,
    extra: { replyTo?: string; image?: string } = {},
  ): void {
    if (this.isMuted(conn, room)) return;
    if (extra.image) {
      // Only a picture you uploaded yourself can be attached.
      const mine = UPLOAD_NAME_RE.test(extra.image) && store.uploadOwner(extra.image) === conn.account!.toLowerCase();
      if (!mine) return this.send(conn, { t: 'error', text: 'That picture could not be found. Try uploading it again.' });
    }
    if (extra.replyTo) {
      const orig = store.getMessage(room, extra.replyTo);
      if (!orig || orig.deleted) {
        return this.send(conn, { t: 'error', text: 'The message you are replying to no longer exists.' });
      }
    }
    if (this.tooFast(conn)) return;
    const clean = sanitize(text);
    if (!clean && !extra.image) return;
    if (this.screened(conn, clean)) return;
    if (this.spamMuted(conn, room, clean)) return;
    const line = store.addMessage(room, conn.nick, kind, clean, {
      replyTo: extra.replyTo,
      image: extra.image ? `/uploads/${extra.image}` : undefined,
    });
    store.touchRoom(room);
    stats.bump('messages');
    const sender = conn.nick.toLowerCase();
    for (const id of this.live.get(room) ?? []) {
      const c = this.conns.get(id);
      if (!c || !c.account) continue;
      if (this.blocksFor(c.account.toLowerCase()).has(sender)) continue; // they blocked the sender
      this.send(c, { t: 'message', room, line });
    }
    if (!kind && !extra.image && !extra.replyTo && clean.startsWith('!')) this.qbotHears(conn, room, clean, line.id);
    if (!kind && !extra.image) this.triviaHears(conn, room, clean, line.id);
    if (!kind && !extra.image && !extra.replyTo && clean.startsWith('!')) this.weatherHears(conn, room, clean, line.id);
  }

  // --- Live video ---------------------------------------------------------------------------
  // The video itself goes straight between the people in the call. The server only checks who may join,
  // keeps the list of who is there, and passes the set-up messages along.

  /** room -> connection id -> who it is. */
  private videoRooms = new Map<string, Map<string, { nick: string; account: string; cam: boolean }>>();
  private rtcRate = new Map<string, { n: number; at: number }>();

  private iceServers(): IceServer[] {
    try {
      const custom = process.env.QCHAT_ICE_SERVERS ? (JSON.parse(process.env.QCHAT_ICE_SERVERS) as IceServer[]) : null;
      if (Array.isArray(custom) && custom.length > 0) return custom;
    } catch {
      /* fall back to the default */
    }
    return [{ urls: 'stun:stun.cloudflare.com:3478' }];
  }

  private videoState(room: string): ServerMsg {
    return {
      t: 'video',
      room,
      enabled: getSettings().webcamsEnabled,
      on: !!store.getRoom(room)?.videoOn,
      participants: [...(this.videoRooms.get(room)?.values() ?? [])].map((p) => ({ nick: p.nick, cam: p.cam })),
      ice: this.iceServers(),
    };
  }

  private onVideoJoin(conn: Conn, roomName: string, cam: boolean): void {
    const room = normalizeRoom(roomName);
    if (!this.inRoom(conn, room)) return this.send(conn, { t: 'error', text: 'You are not in that room.' });
    const fail = (text: string) => this.send(conn, { t: 'error', text });
    if (!getSettings().webcamsEnabled) return fail('Live video is switched off on this site.');
    if (!store.getRoom(room)?.videoOn) return fail('Live video is not switched on in this room.');
    const account = conn.account!.toLowerCase();
    for (const [r, session] of this.videoRooms) {
      for (const [id, p] of session) {
        if (p.account === account && !(id === conn.id && r === room)) return fail('You are already in a video call (maybe in another window).');
      }
    }
    const session = this.videoRooms.get(room) ?? new Map();
    const already = session.get(conn.id);
    if (cam) {
      if (this.isMuted(conn, room)) return fail('You are muted in this room, so you cannot use your camera.');
      const minHours = Number(process.env.QCHAT_CAM_MIN_AGE_HOURS ?? 24);
      const age = Date.now() - (this.policy.lookup(conn.account!)?.createdAt ?? 0);
      if (!this.policy.isAdmin(conn.account!) && age < minHours * 3600_000) {
        return fail(`New accounts can watch, but need to be ${minHours} hours old before using a camera.`);
      }
      const cams = [...session.values()].filter((p) => p.cam && !(already && p === already)).length;
      if (cams >= MAX_VIDEO_CAMS) return fail(`There are already ${MAX_VIDEO_CAMS} cameras on. You can watch instead.`);
    }
    if (!already && session.size >= MAX_VIDEO_PEOPLE) return fail('The video call is full.');
    // Who the newcomer should connect to: everyone if they send a camera, otherwise just the cameras.
    const peers = [...session.entries()].filter(([id, p]) => id !== conn.id && (cam || p.cam)).map(([, p]) => p.nick);
    session.set(conn.id, { nick: conn.nick, account, cam });
    this.videoRooms.set(room, session);
    this.send(conn, { t: 'videoPeers', room, peers: already ? [] : peers });
    this.broadcast(room, this.videoState(room));
  }

  /** Take a connection out of a room's call. The people who were in it are told. */
  private leaveVideo(connId: string, room: string, reason?: string): void {
    const session = this.videoRooms.get(room);
    if (!session || !session.has(connId)) return;
    session.delete(connId);
    if (session.size === 0) this.videoRooms.delete(room);
    const conn = this.conns.get(connId);
    if (conn && reason) this.send(conn, { t: 'videoEnded', room, reason });
    this.broadcast(room, this.videoState(room));
  }

  /** Everyone out of a room's call. */
  private endVideo(room: string, reason: string): void {
    for (const id of [...(this.videoRooms.get(room)?.keys() ?? [])]) {
      const conn = this.conns.get(id);
      if (conn) this.send(conn, { t: 'videoEnded', room, reason });
    }
    this.videoRooms.delete(room);
    this.broadcast(room, this.videoState(room));
  }

  /** Every call on the site ends (an administrator switched video off). */
  endAllVideo(reason: string): void {
    for (const room of [...this.videoRooms.keys()]) this.endVideo(room, reason);
    for (const room of this.live.keys()) this.broadcast(room, this.videoState(room));
  }

  private onRtc(conn: Conn, roomName: string, to: string, kind: string, data: unknown): void {
    const room = normalizeRoom(roomName);
    const session = this.videoRooms.get(room);
    const me = session?.get(conn.id);
    if (!session || !me) return this.send(conn, { t: 'error', text: 'You are not in that video call.' });
    if (kind !== 'offer' && kind !== 'answer' && kind !== 'ice') return;
    // A call needs a few dozen set-up messages; a flood of them is not a call.
    const now = Date.now();
    const rate = this.rtcRate.get(conn.id);
    const fresh = !rate || now - rate.at > 60_000 ? { n: 0, at: now } : rate;
    if (++fresh.n > 400) return;
    this.rtcRate.set(conn.id, fresh);
    if (JSON.stringify(data ?? null).length > 24_000) return this.send(conn, { t: 'error', text: 'That video set-up message was too big.' });
    const target = [...session.entries()].find(([, p]) => p.nick.toLowerCase() === to.toLowerCase());
    if (!target || target[0] === conn.id) return this.send(conn, { t: 'error', text: 'They are not in the video call.' });
    const c = this.conns.get(target[0]);
    if (c) this.send(c, { t: 'rtc', room, from: me.nick, kind, data });
  }

  private onVideoReport(conn: Conn, roomName: string, nick: string): void {
    const room = normalizeRoom(roomName);
    const session = this.videoRooms.get(room);
    if (!this.inRoom(conn, room) || !session) return;
    const target = [...session.values()].find((p) => p.nick.toLowerCase() === nick.toLowerCase() && p.cam);
    if (!target) return this.send(conn, { t: 'error', text: 'They are not on camera.' });
    if (target.account === conn.account!.toLowerCase()) return this.send(conn, { t: 'error', text: 'You cannot report yourself.' });
    if (this.tooFast(conn)) return;
    const added = store.addReport(conn.account!, { id: `video-${room}-${target.account}`, room, fromName: target.nick, text: '(live video)', image: null }, 'Reported from the live video');
    if (!added) return this.send(conn, { t: 'error', text: 'You have already reported them.' });
    this.send(conn, { t: 'info', text: 'Thanks. An admin will take a look, and room moderators have been told.' });
    this.notifyAdmins(`New report: ${conn.nick} reported ${target.nick}'s live video in ${label(room)}.`);
    for (const c of this.conns.values()) {
      if (c.account && c.rooms.has(room) && this.rank(room, c.account) >= 2 && !this.policy.isAdmin(c.account)) {
        this.send(c, { t: 'info', text: `${conn.nick} reported ${target.nick}'s live video. Use /video kick ${target.nick} to remove them.` });
      }
    }
  }

  // --- QWords, the word game ---------------------------------------------------------------

  /** Who is watching each game: game id -> connection ids. */
  private wgWatchers = new Map<string, Set<string>>();

  private wgListFor(room: string): ServerMsg {
    return { t: 'wgList', room, games: wg.roomGames(room).map(wg.summary) };
  }

  /** Tell everyone in a room how its list of games looks now. */
  private wgBroadcastList(room: string): void {
    this.broadcast(room, this.wgListFor(room));
  }

  /** Send the game to each player (with their own tiles) and to anyone watching it. */
  private wgPush(g: wg.GameState): void {
    for (const p of g.players) {
      for (const c of this.connsOf(p.name)) this.send(c, { t: 'wg', id: g.id, game: wg.viewFor(g, p.key) });
    }
    for (const id of this.wgWatchers.get(g.id) ?? []) {
      const c = this.conns.get(id);
      if (!c?.account || g.players.some((p) => p.key === c.account!.toLowerCase())) continue;
      this.send(c, { t: 'wg', id: g.id, game: wg.viewFor(g, c.account.toLowerCase()) });
    }
    for (const p of g.players) this.sendWgTurns(p.key);
  }

  /** The games where it is this member's turn (a badge on the Games button). */
  private sendWgTurns(accountLower: string): void {
    const mine = wg
      .activeGamesOf(accountLower)
      .filter((g) => g.status === 'playing' && g.players[g.turn]?.key === accountLower)
      .map((g) => ({ id: g.id, room: g.room }));
    for (const c of this.connsOf(accountLower)) this.send(c, { t: 'wgTurns', games: mine });
  }

  private onWgList(conn: Conn, roomName: string): void {
    const room = normalizeRoom(roomName);
    if (!this.inRoom(conn, room)) return;
    this.send(conn, this.wgListFor(room));
  }

  private onWgCreate(conn: Conn, roomName: string, maxPlayers: number): void {
    const room = normalizeRoom(roomName);
    if (!this.inRoom(conn, room)) return this.send(conn, { t: 'error', text: 'You are not in that room.' });
    if (this.isMuted(conn, room) || this.tooFast(conn)) return;
    const me = conn.account!.toLowerCase();
    if (wg.activeGamesOf(me).length >= MAX_GAMES_PER_MEMBER) {
      return this.send(conn, { t: 'error', text: `You are already in ${MAX_GAMES_PER_MEMBER} word games. Finish one first.` });
    }
    if (wg.roomGames(room).filter((g) => g.status === 'waiting').length >= 10) {
      return this.send(conn, { t: 'error', text: 'This room already has plenty of word games waiting for players.' });
    }
    const made = wg.createGame(room, conn.nick, maxPlayers);
    if (!made.ok) return this.send(conn, { t: 'error', text: made.error });
    this.wgWatchers.set(made.value.id, new Set([conn.id]));
    this.broadcast(room, { t: 'system', room, text: `${conn.nick} started a word game for up to ${made.value.maxPlayers}. Open Word game to join in.` });
    this.wgPush(made.value);
    this.wgBroadcastList(room);
  }

  private onWgJoin(conn: Conn, id: string): void {
    const g = wg.loadGame(id);
    if (!g) return this.send(conn, { t: 'error', text: 'That game is not there any more.' });
    if (!this.inRoom(conn, g.room)) return this.send(conn, { t: 'error', text: 'Join that room first, then you can join its game.' });
    if (this.tooFast(conn)) return;
    const me = conn.account!.toLowerCase();
    if (wg.activeGamesOf(me).length >= MAX_GAMES_PER_MEMBER) {
      return this.send(conn, { t: 'error', text: `You are already in ${MAX_GAMES_PER_MEMBER} word games. Finish one first.` });
    }
    const r = wg.joinGame(g, conn.nick);
    if (!r.ok) return this.send(conn, { t: 'error', text: r.error });
    this.broadcast(g.room, { t: 'system', room: g.room, text: `${conn.nick} joined the word game (${g.players.length} of ${g.maxPlayers})` });
    this.wgPush(g);
    this.wgBroadcastList(g.room);
  }

  private onWgLeave(conn: Conn, id: string): void {
    const g = wg.loadGame(id);
    if (!g) return;
    const me = conn.account!.toLowerCase();
    if (!g.players.some((p) => p.key === me)) return;
    if (g.status === 'waiting') {
      const gone = wg.leaveWaiting(g, me);
      this.wgWatchers.get(id)?.delete(conn.id);
      this.send(conn, { t: 'wg', id, game: null });
      if (gone) {
        for (const cid of this.wgWatchers.get(id) ?? []) {
          const c = this.conns.get(cid);
          if (c) this.send(c, { t: 'wg', id, game: null });
        }
        this.wgWatchers.delete(id);
      } else {
        this.wgPush(g);
      }
      this.wgBroadcastList(g.room);
    } else if (g.status === 'playing') {
      this.onWgMove(conn, id, (game, who) => wg.resign(game, who));
    }
  }

  private onWgStart(conn: Conn, id: string): void {
    const g = wg.loadGame(id);
    if (!g) return this.send(conn, { t: 'error', text: 'That game is not there any more.' });
    const r = wg.startGame(g, conn.account!);
    if (!r.ok) return this.send(conn, { t: 'error', text: r.error });
    this.broadcast(g.room, { t: 'system', room: g.room, text: `The word game has started: ${g.players.map((p) => p.name).join(', ')}. ${g.players[g.turn].name} goes first.` });
    this.wgPush(g);
    this.wgBroadcastList(g.room);
  }

  private onWgOpen(conn: Conn, id: string): void {
    const g = wg.loadGame(id);
    if (!g) return this.send(conn, { t: 'wg', id, game: null });
    const me = conn.account!.toLowerCase();
    if (!g.players.some((p) => p.key === me) && !this.inRoom(conn, g.room)) return;
    const set = this.wgWatchers.get(id) ?? new Set<string>();
    set.add(conn.id);
    this.wgWatchers.set(id, set);
    this.send(conn, { t: 'wg', id, game: wg.viewFor(g, me) });
  }

  /** A move by a player: run it, then tell everyone what happened. */
  private onWgMove(conn: Conn, id: string, run: (g: wg.GameState, me: string) => wg.Result<unknown>): void {
    const g = wg.loadGame(id);
    if (!g) return this.send(conn, { t: 'error', text: 'That game is not there any more.' });
    const before = g.status;
    const r = run(g, conn.account!.toLowerCase());
    if (!r.ok) return this.send(conn, { t: 'error', text: r.error });
    this.wgPush(g);
    if (before !== 'finished' && g.status === 'finished') {
      const scores = g.players.map((p) => `${p.name} ${p.score}`).join(', ');
      this.broadcast(g.room, { t: 'system', room: g.room, text: `The word game is over (${g.endedBy}). ${g.winner ? `${g.winner} won. ` : ''}Scores: ${scores}.` });
      this.wgBroadcastList(g.room);
    } else {
      this.wgBroadcastList(g.room);
    }
  }

  /** Waiting games nobody started, abandoned ones, old finished ones. */
  private wgSweep(): void {
    const { removed, ended } = wg.sweepGames();
    for (const g of [...removed, ...ended]) {
      this.wgWatchers.delete(g.id);
      if (removed.includes(g)) for (const p of g.players) for (const c of this.connsOf(p.name)) this.send(c, { t: 'wg', id: g.id, game: null });
      else this.wgPush(g);
      this.wgBroadcastList(g.room);
    }
  }

  /** A member is leaving for good: they resign from their games (so nobody is left waiting for them). */
  forgetWordGames(account: string): void {
    const lower = account.toLowerCase();
    const mine = wg.activeGamesOf(lower).map((g) => g.id);
    wg.forgetAccount(lower);
    for (const id of mine) {
      const g = wg.loadGame(id);
      if (g) {
        this.wgPush(g);
        this.wgBroadcastList(g.room);
      }
    }
  }

  /** The morning post in the lobby: a fact or quote, and anyone's birthday. Once a day, after 8 in the morning UK time. */
  private dailyPost(): void {
    if (process.env.QCHAT_DAILY === 'off' || !getSettings().dailyPost) return;
    const now = process.env.QCHAT_FAKE_NOW ? new Date(process.env.QCHAT_FAKE_NOW) : new Date();
    const lines = takeDailyPost(now);
    if (!lines) return;
    for (const line of lines) this.botSay(QBOT, '#lobby', line);
  }

  private weatherCooldown = new Map<string, number>();

  /** WeatherBot: !weather and !forecast. Only answers where it lives, and not more than once every ten seconds per member. */
  private weatherHears(conn: Conn, room: string, text: string, messageId: string): void {
    if (!botInRoom(WEATHER_BOT, room)) return;
    const m = text.match(/^!(weather|forecast|weatherhelp)(?:\s+([\s\S]*))?$/i);
    if (!m) return;
    const cmd = m[1].toLowerCase();
    const say = (t: string) => this.botSay(WEATHER_BOT, room, t, messageId);
    if (cmd === 'weatherhelp') return void say(WEATHER_HELP);
    const lower = conn.account!.toLowerCase();
    const last = this.weatherCooldown.get(lower) ?? 0;
    if (Date.now() - last < 10_000) return void this.toast(conn.account!, 'WeatherBot needs a few seconds between questions.');
    this.weatherCooldown.set(lower, Date.now());
    let place = (m[2] ?? '').trim();
    if (!place) place = getProfileOf(conn.account!)?.location ?? '';
    if (!place) return void say('Tell me a place, like !weather London, or add a location to your profile.');
    void weatherReply(cmd === 'forecast' ? 'forecast' : 'now', place).then((reply) => {
      if (botInRoom(WEATHER_BOT, room)) say(reply);
    });
  }

  private qbotCooldown = new Map<string, number>(); // account -> last command time
  private qbotRoomStamps = new Map<string, number[]>(); // room -> recent reply times
  private polls = new PollBoard();
  private trivia = new Map<string, TriviaGame>(); // room -> the game being played there
  private triviaEnded = new Map<string, number>(); // room -> when its last game ended

  /** A private note that only this member sees (it appears as a small pop-up). */
  private toast(account: string, text: string): void {
    for (const c of this.connsOf(account)) this.send(c, { t: 'info', text });
  }

  /**
   * QBot's second job: answer "!" commands. Public answers are limited per member and per room so they
   * cannot be used to flood. A few things (voting, listing reminders) are answered privately instead.
   */
  private qbotHears(conn: Conn, room: string, text: string, messageId: string): void {
    if (!this.policy.qbot().commands) return;
    const m = text.match(/^!([A-Za-z0-9]+)(?:\s+([\s\S]*))?$/);
    if (!m) return;
    const cmd = m[1].toLowerCase();
    const arg = (m[2] ?? '').trim();
    const account = conn.account!;
    const lower = account.toLowerCase();
    const now = Date.now();

    // Private answers: nothing is said in the room, so no limit is needed.
    if (cmd === 'vote') return this.toast(account, this.polls.vote(room, account, arg));
    if (cmd === 'reminders') {
      if (arg.toLowerCase() === 'clear') {
        const n = clearReminders(account);
        return this.toast(account, n ? `Cleared ${n} reminder${n === 1 ? '' : 's'}.` : 'You had no reminders.');
      }
      const list = listReminders(account);
      return this.toast(
        account,
        list.length
          ? `Your reminders: ${list.map((r) => `in ${formatDuration(Math.max(0, r.dueAt - now))}: ${r.text}`).join('; ')}`
          : 'You have no reminders. Set one with !remind 10m <what>.',
      );
    }

    if (now - (this.qbotCooldown.get(lower) ?? 0) < 3000) return;
    const recent = (this.qbotRoomStamps.get(room) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= 8) return;

    let reply: string | null;
    switch (cmd) {
      case 'poll':
        reply = this.polls.start(room, account, conn.nick, arg, now);
        break;
      case 'results':
        reply = this.polls.results(room);
        break;
      case 'endpoll':
        reply = this.polls.end(room, account, this.rank(room, account) >= 2);
        break;
      case 'remind':
        reply = this.qbotRemind(conn, room, arg, now);
        break;
      default: {
        const rooms = this.roomInfos()
          .map((r) => ({ name: r.name, online: r.members }))
          .sort((a, b) => b.online - a.online);
        reply = qbotReply(text, {
          nick: conn.nick,
          room,
          topic: store.getRoom(room)?.topic ?? null,
          rules: store.getRoom(room)?.rules ?? null,
          rooms,
          stats: { members: store.countMembers(), online: this.onlineAccounts().size, rooms: store.roomCount() },
        });
      }
    }
    if (!reply) return; // not a command QBot knows: stay quiet
    this.qbotCooldown.set(lower, now);
    recent.push(now);
    this.qbotRoomStamps.set(room, recent);
    setTimeout(() => this.botSay(QBOT, room, reply!, messageId), 400);
  }

  private qbotRemind(conn: Conn, room: string, arg: string, now: number): string {
    const m = arg.match(/^(\S+)\s+([\s\S]+)$/);
    if (!m) return 'Try !remind 10m take the pizza out (a time, then what to remind you about).';
    const ms = parseDuration(m[1]);
    if (ms === null) return 'I did not understand that time. Try 10m, 2h or 1h30m.';
    if (ms < MIN_REMIND_S * 1000) return `The shortest reminder is ${MIN_REMIND_S} seconds.`;
    if (ms > MAX_REMIND_MS) return 'The longest reminder is 7 days.';
    const text = sanitize(m[2]).slice(0, MAX_REMIND_TEXT);
    if (!text) return 'Tell me what to remind you about.';
    const added = addReminder(conn.account!, conn.nick, room, now + ms, text);
    return added.ok ? `OK ${conn.nick}, I will remind you in ${formatDuration(ms)}: ${text}` : added.error;
  }

  /** Every few seconds: close polls that have run out of time, and deliver reminders that are due. */
  private qbotSweep(): void {
    for (const p of this.polls.expired()) this.botSay(QBOT, p.room, p.text);
    this.deliverReminders();
  }

  private deliverReminders(only?: string): void {
    const now = Date.now();
    for (const r of dueReminders(now)) {
      if (only && r.account !== only.toLowerCase()) continue;
      const conns = this.connsOf(r.account);
      if (conns.length === 0) {
        if (now - r.dueAt > STALE_MS) deleteReminder(r.id); // they never came back
        continue;
      }
      if (conns.some((c) => c.rooms.has(r.room))) this.botSay(QBOT, r.room, `@${r.nick} reminder: ${r.text}`);
      else for (const c of conns) this.send(c, { t: 'info', text: `Reminder: ${r.text}` });
      deleteReminder(r.id);
    }
  }

  /** TriviaBot: run the game in any room it is in, and listen for answers. */
  private triviaHears(conn: Conn, room: string, text: string, messageId: string): void {
    if (!botInRoom(TRIVIA_BOT, room)) return;
    const account = conn.account!;
    const lower = account.toLowerCase();
    const say = (t: string) => this.botSay(TRIVIA_BOT, room, t, messageId);
    const game = this.trivia.get(room);

    const m = text.match(/^!([A-Za-z0-9]+)(?:\s+([\s\S]*))?$/);
    if (!m) {
      if (game) game.hear(lower, conn.nick, text); // an ordinary message might be an answer
      return;
    }
    const cmd = m[1].toLowerCase();
    const arg = (m[2] ?? '').trim();
    const mayControl = !!game && (lower === game.starter || this.rank(room, account) >= 2);

    const help =
      'TriviaBot: !trivia starts a game of 10 questions, !trivia 5 starts 5 (3 to 20), !trivia sport picks a category (!trivia categories lists them). Type your answer in the chat. The first right answer scores 10 points plus up to 5 for speed. !trivia skip and !trivia stop are for whoever started the game and moderators. !score shows your points and !top shows the best players.';

    if (cmd === 'triviahelp') return void say(help);
    if (cmd === 'top') {
      const rows = topScores(5);
      return void say(
        rows.length
          ? `Top players: ${rows.map((r, i) => `${i + 1}. ${r.account} ${r.points} pts${r.wins ? ` (${r.wins} win${r.wins === 1 ? '' : 's'})` : ''}`).join(', ')}`
          : 'Nobody has scored yet. Type !trivia to start the first game.',
      );
    }
    if (cmd === 'score') {
      const who = arg ? (this.policy.lookup(arg)?.account ?? null) : conn.nick;
      if (!who) return void say(`There is no member called "${arg.slice(0, 30)}".`);
      const s = scoreFor(who);
      return void say(
        s
          ? `${s.account} has ${s.points} points (${s.correct} right answers, ${s.wins} win${s.wins === 1 ? '' : 's'} from ${s.played} game${s.played === 1 ? '' : 's'}), rank ${s.rank}.`
          : `${who} has not scored yet. Type !trivia to play.`,
      );
    }
    if (cmd !== 'trivia') return;

    const sub = arg.toLowerCase();
    if (sub === 'help') return void say(help);
    if (sub === 'categories' || sub === 'category') {
      return void say(`Categories: ${CATEGORIES.join(', ')}. Use !trivia <number> <category>, like !trivia 5 sport.`);
    }
    if (sub === 'stop' || sub === 'skip') {
      if (!game) return void say('No game is running. Type !trivia to start one.');
      if (!mayControl) return void say('Only the person who started the game, or a moderator, can do that.');
      if (sub === 'stop') return game.stop(conn.nick);
      if (!game.skip(conn.nick)) say('There is nothing to skip right now.');
      return;
    }

    // Start a game
    if (game) return void say('A game is already running here. Type !trivia stop to end it, or just answer the question.');
    const cooldown = Math.min(15_000, GAP_MS * 2);
    if (Date.now() - (this.triviaEnded.get(room) ?? 0) < cooldown) return void say('Give me a moment to catch my breath, then try again.');
    const tokens = arg.split(/\s+/).filter(Boolean);
    let count = DEFAULT_QUESTIONS;
    if (tokens.length && /^\d+$/.test(tokens[0])) count = Number(tokens.shift());
    if (count < MIN_QUESTIONS || count > MAX_QUESTIONS) return void say(`Choose between ${MIN_QUESTIONS} and ${MAX_QUESTIONS} questions.`);
    let category: string | null = null;
    if (tokens.length) {
      category = findCategory(tokens.join(' '));
      if (!category) return void say(`I do not know that category. Try: ${CATEGORIES.join(', ')}.`);
    }
    const g = new TriviaGame(
      {
        say: (t) => void this.botSay(TRIVIA_BOT, room, t),
        alive: () => (this.live.get(room)?.size ?? 0) > 0 && !!botInRoom(TRIVIA_BOT, room),
        award: (acct, name, points) => recordPoints(acct, name, points),
        finish: (players, winner) => {
          recordGame(players, winner);
          this.trivia.delete(room);
          this.triviaEnded.set(room, Date.now());
        },
      },
      lower,
      pickQuestions(count, category),
    );
    this.trivia.set(room, g);
    g.start();
  }

  private onHistory(conn: Conn, roomName: string, before: number): void {
    const room = normalizeRoom(roomName);
    if (!this.inRoom(conn, room) || !Number.isFinite(before) || before <= 0) return;
    const page = store.getMessages(room, before, HISTORY_PAGE);
    this.send(conn, { t: 'history', room, lines: this.unblocked(page.lines, conn.account!), more: page.more });
  }

  private onTyping(conn: Conn, roomName: string): void {
    const room = normalizeRoom(roomName);
    const now = Date.now();
    if (!this.inRoom(conn, room) || now - conn.lastTyping < 1500) return;
    if (store.activeMute(room, conn.account!.toLowerCase())) return;
    conn.lastTyping = now;
    this.broadcast(room, { t: 'typing', room, nick: conn.nick }, conn.id);
  }

  private onEdit(conn: Conn, roomName: string, id: string, text: string): void {
    const room = normalizeRoom(roomName);
    if (!this.inRoom(conn, room)) return;
    const msg = store.getMessage(room, id);
    if (!msg || msg.deleted) return this.send(conn, { t: 'error', text: 'That message no longer exists.' });
    if (msg.fromLower !== conn.account!.toLowerCase() || msg.kind === 'action') {
      return this.send(conn, { t: 'error', text: 'You can only edit your own messages.' });
    }
    if (this.isMuted(conn, room) || this.tooFast(conn)) return;
    const clean = sanitize(text);
    if (!clean && !msg.image) return; // a picture can have its caption removed; text cannot be emptied
    if (this.screened(conn, clean)) return;
    const edited = store.editMessage(id, clean);
    this.broadcast(room, { t: 'edited', room, id, text: clean, edited });
    if (store.isPinned(room, id)) this.broadcast(room, { t: 'pins', room, pins: store.pinsOf(room) });
  }

  private onDelete(conn: Conn, roomName: string, id: string): void {
    const room = normalizeRoom(roomName);
    if (!this.inRoom(conn, room)) return;
    const msg = store.getMessage(room, id);
    if (!msg || msg.deleted) return;
    const mine = msg.fromLower === conn.account!.toLowerCase();
    if (!mine && this.rank(room, conn.account!) < 2) {
      return this.send(conn, { t: 'error', text: 'You can only delete your own messages.' });
    }
    store.deleteMessage(id, conn.nick);
    this.broadcast(room, { t: 'deleted', room, id });
    this.dropPin(room, id);
  }

  // --- Private messages ---------------------------------------------------------

  // --- Reactions, reports, search, room settings -----------------------------------

  /** A deleted message cannot stay pinned. */
  private dropPin(room: string, id: string): void {
    if (!store.isPinned(room, id)) return;
    store.unpinMessage(room, id);
    this.broadcast(room, { t: 'pins', room, pins: store.pinsOf(room) });
  }

  private onPin(conn: Conn, roomName: string, id: string, pin: boolean): void {
    const room = normalizeRoom(roomName);
    if (!this.inRoom(conn, room)) return;
    if (this.rank(room, conn.account!) < 2) {
      return this.send(conn, { t: 'error', text: 'Only moderators can pin messages.' });
    }
    const msg = store.getMessage(room, id);
    if (!msg || msg.deleted) return this.send(conn, { t: 'error', text: 'That message no longer exists.' });
    if (pin) {
      if (store.isPinned(room, id)) return;
      if (store.pinsOf(room).length >= MAX_PINS) {
        return this.send(conn, { t: 'error', text: `A room can have ${MAX_PINS} pinned messages. Unpin one first.` });
      }
      store.pinMessage(room, id, conn.nick);
      this.broadcast(room, { t: 'pins', room, pins: store.pinsOf(room) });
      this.broadcast(room, { t: 'system', room, text: `${conn.nick} pinned a message from ${msg.fromName}` });
    } else {
      if (!store.isPinned(room, id)) return;
      store.unpinMessage(room, id);
      this.broadcast(room, { t: 'pins', room, pins: store.pinsOf(room) });
      this.broadcast(room, { t: 'system', room, text: `${conn.nick} unpinned a message` });
    }
  }

  private onReact(conn: Conn, roomName: string, id: string, emoji: string): void {
    const room = normalizeRoom(roomName);
    if (!this.inRoom(conn, room)) return;
    if (!(REACTION_EMOJI as readonly string[]).includes(emoji)) {
      return this.send(conn, { t: 'error', text: 'That reaction is not available.' });
    }
    const msg = store.getMessage(room, id);
    if (!msg || msg.deleted) return this.send(conn, { t: 'error', text: 'That message no longer exists.' });
    if (this.isMuted(conn, room) || this.tooFast(conn)) return;
    // A message can carry at most 12 different reactions.
    const current = store.reactionsFor([id]).get(id) ?? {};
    if (!(emoji in current) && Object.keys(current).length >= 12) {
      return this.send(conn, { t: 'error', text: 'That message already has as many different reactions as it can hold.' });
    }
    const reactions = store.toggleReaction(id, conn.account!, emoji);
    this.broadcast(room, { t: 'reactions', room, id, reactions });
  }

  private onReport(conn: Conn, roomName: string, id: string, reason?: string): void {
    const room = normalizeRoom(roomName);
    if (!this.inRoom(conn, room)) return;
    const msg = store.getMessage(room, id);
    if (!msg || msg.deleted) return this.send(conn, { t: 'error', text: 'That message no longer exists.' });
    if (msg.fromLower === conn.account!.toLowerCase()) {
      return this.send(conn, { t: 'error', text: 'You cannot report your own message.' });
    }
    if (this.tooFast(conn)) return;
    const why = sanitize(String(reason ?? '')).slice(0, 200) || null;
    if (!store.addReport(conn.account!, msg, why)) {
      return this.send(conn, { t: 'error', text: 'You have already reported that message.' });
    }
    this.send(conn, { t: 'info', text: 'Thanks. An admin will take a look.' });
    this.notifyAdmins(`New report: ${conn.nick} reported a message by ${msg.fromName} in ${label(room)}.`);
  }

  private onSearch(conn: Conn, roomName: string, q: string): void {
    const room = normalizeRoom(roomName);
    if (!this.inRoom(conn, room)) return;
    const query = sanitize(q).slice(0, 100);
    if (query.length < 2) return this.send(conn, { t: 'error', text: 'Type at least 2 characters to search.' });
    if (this.tooFast(conn)) return;
    const lines = this.unblocked(store.searchMessages(room, query, 50), conn.account!);
    this.send(conn, { t: 'searchResults', room, q: query, lines });
  }

  /** The room's moderator list, bans and mutes, for the room settings panel. */
  private onRoomAdmin(conn: Conn, roomName: string): void {
    const room = normalizeRoom(roomName);
    if (!this.inRoom(conn, room)) return;
    if (this.rank(room, conn.account!) < 2) {
      return this.send(conn, { t: 'error', text: 'Only moderators can see the room settings.' });
    }
    const proper = (lower: string) => this.policy.lookup(lower)?.account ?? lower;
    this.send(conn, {
      t: 'roomAdmin',
      room,
      owner: store.getRoom(room)?.owner ?? null,
      bans: store.listBans(room),
      mods: store.listMods(room).map(proper),
      mutes: store.listMutes(room).map((m) => ({ name: proper(m.accountLower), until: m.until })),
    });
  }

  // --- Friends ----------------------------------------------------------------------

  private friendList(account: string): { friends: FriendInfo[]; incoming: string[]; outgoing: string[] } {
    const l = account.toLowerCase();
    const friends = store
      .friendsOf(l)
      .map((fl) => {
        const name = this.policy.lookup(fl)?.account ?? fl;
        return { name, online: this.connsOf(name).length > 0 };
      })
      .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
    return { friends, incoming: store.incomingRequests(l), outgoing: store.outgoingRequests(l) };
  }

  private sendFriends(account: string): void {
    const msg: ServerMsg = { t: 'friends', ...this.friendList(account) };
    for (const c of this.connsOf(account)) this.send(c, msg);
  }

  /** Tell everyone who has this person as a friend that they came online or went offline. */
  private pushToFriends(account: string): void {
    for (const fl of store.friendsOf(account.toLowerCase())) {
      const name = this.policy.lookup(fl)?.account;
      if (name) this.sendFriends(name);
    }
  }

  private tellAccount(account: string, text: string): void {
    for (const c of this.connsOf(account)) this.send(c, { t: 'info', text });
  }

  private onFriendRequest(conn: Conn, toRaw: string): void {
    const me = conn.account!;
    const bot = getBot(toRaw);
    if (bot) return this.send(conn, { t: 'error', text: `${bot.name} is a bot, so it cannot be a friend.` });
    const target = this.policy.lookup(toRaw.trim());
    if (!target) return this.send(conn, { t: 'error', text: `There is no member called "${toRaw.trim()}".` });
    const ml = me.toLowerCase();
    const tl = target.account.toLowerCase();
    if (ml === tl) return this.send(conn, { t: 'error', text: 'You cannot add yourself as a friend.' });
    if (this.blocksFor(ml).has(tl) || this.blocksFor(tl).has(ml)) {
      return this.send(conn, { t: 'error', text: `You cannot send ${target.account} a friend request.` });
    }
    if (store.areFriends(ml, tl)) return this.send(conn, { t: 'error', text: `You are already friends with ${target.account}.` });
    if (store.hasRequest(ml, tl)) return this.send(conn, { t: 'error', text: 'You have already sent them a request.' });
    if (this.tooFast(conn)) return;

    if (store.hasRequest(tl, ml)) {
      // They had already asked you: this makes you friends.
      store.removeRequest(tl, ml);
      store.addFriendship(ml, tl);
      this.tellAccount(me, `You and ${target.account} are now friends.`);
      this.tellAccount(target.account, `You and ${me} are now friends.`);
    } else {
      store.addRequest(me, target.account);
      this.tellAccount(me, `Friend request sent to ${target.account}.`);
      this.tellAccount(target.account, `${me} sent you a friend request.`);
    }
    this.sendFriends(me);
    this.sendFriends(target.account);
  }

  private onFriendRespond(conn: Conn, fromRaw: string, accept: boolean): void {
    const me = conn.account!;
    const from = this.policy.lookup(fromRaw.trim());
    const ml = me.toLowerCase();
    if (!from || !store.removeRequest(from.account.toLowerCase(), ml)) {
      return this.send(conn, { t: 'error', text: 'That friend request is no longer there.' });
    }
    if (accept) {
      store.addFriendship(ml, from.account.toLowerCase());
      this.tellAccount(me, `You and ${from.account} are now friends.`);
      this.tellAccount(from.account, `${me} accepted your friend request.`);
    }
    this.sendFriends(me);
    this.sendFriends(from.account);
  }

  /** Unfriend someone, cancel a request you sent, or decline one you received. */
  private onFriendRemove(conn: Conn, whoRaw: string): void {
    const me = conn.account!;
    const ml = me.toLowerCase();
    const who = this.policy.lookup(whoRaw.trim());
    const wl = (who?.account ?? whoRaw.trim()).toLowerCase();
    const changed = store.removeFriendship(ml, wl) || store.removeRequest(ml, wl) || store.removeRequest(wl, ml);
    if (!changed) return this.send(conn, { t: 'error', text: 'You are not friends with them.' });
    this.sendFriends(me);
    if (who) this.sendFriends(who.account);
  }

  private onDm(conn: Conn, toRaw: string, text: string, kind?: 'action'): void {
    const me = conn.account!;
    const bot = getBot(toRaw);
    if (bot) return this.send(conn, { t: 'error', text: `${bot.name} is a bot and cannot chat privately yet.` });
    const target = this.policy.lookup(toRaw.trim());
    if (!target) return this.send(conn, { t: 'error', text: `There is no member called "${toRaw.trim()}".` });
    if (target.account.toLowerCase() === me.toLowerCase()) {
      return this.send(conn, { t: 'error', text: 'You cannot message yourself.' });
    }
    if (this.blocksFor(me.toLowerCase()).has(target.account.toLowerCase())) {
      return this.send(conn, { t: 'error', text: `You have blocked ${target.account}. Use /unblock ${target.account} first.` });
    }
    if (this.blocksFor(target.account.toLowerCase()).has(me.toLowerCase())) {
      return this.send(conn, { t: 'error', text: `${target.account} is not accepting messages from you.` });
    }
    if (!this.policy.allowsPm(target.account)) {
      return this.send(conn, { t: 'error', text: `${target.account} is not accepting private messages.` });
    }
    // In a private chat only /me works; "//" sends a leading slash.
    let body = text.trim();
    if (!kind && /^\/me(\s|$)/i.test(body)) {
      kind = 'action';
      body = body.slice(3).trim();
    } else if (body.startsWith('//')) {
      body = body.slice(1);
    } else if (body.startsWith('/')) {
      return this.send(conn, { t: 'error', text: 'Commands only work inside a room. Only /me works in private messages.' });
    }
    if (this.tooFast(conn)) return;
    const clean = sanitize(body);
    if (!clean) return;
    if (this.screened(conn, clean)) return;

    const msg = store.addDm(me, target.account, kind, clean);
    stats.bump('dms');
    for (const c of [...this.connsOf(me), ...this.connsOf(target.account)]) this.send(c, { t: 'dm', msg });

    const theirs = this.connsOf(target.account);
    if (theirs.length > 0 && theirs.every((c) => c.away !== null)) {
      const why = theirs[0].away ? `: ${theirs[0].away}` : '';
      this.send(conn, { t: 'dmNotice', with: target.account, text: `${target.account} is away${why}` });
    }
  }

  private onDmHistory(conn: Conn, withRaw: string, before?: number): void {
    const partner = this.policy.lookup(withRaw.trim());
    if (!partner) return;
    const page = store.getDms(conn.account!, partner.account, before, HISTORY_PAGE);
    this.send(conn, { t: 'dmHistory', with: partner.account, lines: page.lines, more: page.more });
  }

  private onDmRead(conn: Conn, withRaw: string): void {
    const partner = this.policy.lookup(withRaw.trim());
    if (!partner) return;
    store.markDmsRead(conn.account!, partner.account);
    this.sendThreads(conn.account!);
  }

  private onDmTyping(conn: Conn, toRaw: string): void {
    const now = Date.now();
    if (now - conn.lastTyping < 1500) return;
    const target = this.policy.lookup(toRaw.trim());
    if (!target || this.blocksFor(target.account.toLowerCase()).has(conn.account!.toLowerCase())) return;
    conn.lastTyping = now;
    for (const c of this.connsOf(target.account)) this.send(c, { t: 'dmTyping', from: conn.nick });
  }

  /** Send an account's conversation list to one connection, or all of its connections. */
  private sendThreads(account: string, only?: Conn): void {
    const msg: ServerMsg = { t: 'dms', threads: store.dmThreads(account) };
    if (only) this.send(only, msg);
    else for (const c of this.connsOf(account)) this.send(c, msg);
  }

  // --- Slash commands --------------------------------------------------------------

  private runCommand(conn: Conn, room: string, raw: string): void {
    const m = raw.slice(1).match(/^(\S*)\s*([\s\S]*)$/);
    const cmd = (m?.[1] ?? '').toLowerCase();
    const args = (m?.[2] ?? '').trim();
    const me = conn.account!;
    const note = (text: string) => this.send(conn, { t: 'system', room, text });
    const fail = (text: string) => this.send(conn, { t: 'error', text });

    switch (cmd) {
      case 'help':
      case '?': {
        const rank = this.rank(room, me);
        note('You can use these commands:');
        for (const c of COMMANDS) {
          if (c.level === 'owner' && rank < 3) continue;
          if (c.level === 'mod' && rank < 2) continue;
          note(`${c.usage}  ·  ${c.desc}`);
        }
        return;
      }

      case 'clear':
        return; // handled on your screen only

      case 'me': {
        if (!args) return fail('Say what you are doing, like "/me waves".');
        return this.postMessage(conn, room, args, 'action');
      }

      case 'msg':
      case 'w':
      case 'dm':
      case 'pm': {
        const sp = args.match(/^(\S+)\s+([\s\S]+)$/);
        if (!sp) return fail('Use /msg <member> <text>.');
        return this.onDm(conn, sp[1], sp[2]);
      }

      case 'video': {
        const [sub, ...restWords] = args.split(/\s+/);
        const row = store.getRoom(room);
        if (!sub) {
          const enabled = getSettings().webcamsEnabled;
          return note(
            !enabled
              ? 'Live video is switched off on this site.'
              : `Video in this room is ${row?.videoOn ? 'on' : 'off'}${row?.videoOn ? ` (${this.videoRooms.get(room)?.size ?? 0} in the call)` : ''}. The room owner can change it with /video on or /video off.`,
          );
        }
        if (sub.toLowerCase() === 'kick') {
          if (this.rank(room, me) < 2) return fail('Only moderators can do that.');
          const t = this.policy.lookup(restWords.join(' '));
          const session = this.videoRooms.get(room);
          const target = t && [...(session?.entries() ?? [])].find(([, p]) => p.nick.toLowerCase() === t.account.toLowerCase());
          if (!target) return fail('They are not in the video.');
          if (this.rank(room, t!.account) >= this.rank(room, me)) return fail('You cannot remove someone of equal or higher rank.');
          this.leaveVideo(target[0], room, `${conn.nick} removed you from the video.`);
          return void this.broadcast(room, { t: 'system', room, text: `${t!.account} was removed from the video by ${conn.nick}` });
        }
        if (this.rank(room, me) < 3) return fail('Only the room owner can switch video on or off.');
        if (sub.toLowerCase() === 'on') {
          if (!getSettings().webcamsEnabled) return fail('An administrator has switched live video off for the whole site.');
          store.setVideo(room, true);
          this.broadcast(room, this.videoState(room));
          return void this.broadcast(room, { t: 'system', room, text: `${conn.nick} switched on live video. Use the video button to join. Everyone in the call can see who is there.` });
        }
        if (sub.toLowerCase() === 'off') {
          store.setVideo(room, false);
          this.endVideo(room, `${conn.nick} switched off the video.`);
          return void this.broadcast(room, { t: 'system', room, text: `${conn.nick} switched off live video` });
        }
        return fail('Use /video on, /video off or /video kick <member>.');
      }

      case 'skip':
        return this.onMediaSkip(conn, room);

      case 'queue': {
        const q = this.queues.get(room) ?? [];
        if (q.length === 0) return note('The queue is empty. Paste a link and press Queue to add something.');
        note(`Waiting to play (${q.length}):`);
        q.forEach((item, i) => note(`${i + 1}. ${item.title || mediaLink(item)} (added by ${item.by})`));
        return;
      }

      case 'radio': {
        const row = store.getRoom(room);
        const tracks = store.radioTracks(room);
        const [sub, ...restWords] = args.split(/\s+/);
        const rest = restWords.join(' ').trim();
        if (!sub) {
          note(`The radio is ${row?.radioOn ? 'on' : 'off'} with ${tracks.length} track${tracks.length === 1 ? '' : 's'}.`);
          tracks.forEach((t, i) => note(`${i + 1}. ${t.title || mediaLink(t)}`));
          return;
        }
        if (this.rank(room, me) < 3) return fail('Only the room owner can change the radio.');
        const refresh = () => this.broadcast(room, this.radioState(room));
        switch (sub.toLowerCase()) {
          case 'on':
            if (tracks.length === 0) return fail('Add a track first: /radio add <link>');
            store.setRadio(room, true);
            this.radioHold.delete(room);
            refresh();
            this.broadcast(room, { t: 'system', room, text: `${conn.nick} turned the room radio on` });
            return this.maybeStartRadio(room);
          case 'off': {
            store.setRadio(room, false);
            refresh();
            if (this.media.get(room)?.radio) this.advanceMedia(room);
            return void this.broadcast(room, { t: 'system', room, text: `${conn.nick} turned the room radio off` });
          }
          case 'add': {
            const m = parseMediaUrl(rest);
            if (!m) return fail('Use /radio add <link>, with a YouTube, Vimeo or SoundCloud link.');
            if (isLive(m.provider)) return fail('A live stream never ends, so it cannot go on the radio.');
            if (tracks.length >= MAX_RADIO_TRACKS) return fail(`The radio can hold ${MAX_RADIO_TRACKS} tracks.`);
            void lookupTitle(m.provider, m.ref).then((title) => {
              if (store.radioTracks(room).length >= MAX_RADIO_TRACKS || !store.getRoom(room)) return;
              store.addRadioTrack(room, m.provider, m.ref, title ?? '');
              refresh();
              this.send(conn, { t: 'info', text: `Added ${title ?? 'the track'} to the radio.` });
              if (store.getRoom(room)?.radioOn) this.maybeStartRadio(room);
            });
            return;
          }
          case 'remove': {
            const n = Number(rest);
            const t = Number.isInteger(n) ? tracks[n - 1] : undefined;
            if (!t) return fail('Use /radio remove <number>, as numbered by /radio.');
            store.removeRadioTrack(room, t.id);
            return refresh();
          }
          case 'clear':
            store.clearRadioTracks(room);
            store.setRadio(room, false);
            refresh();
            if (this.media.get(room)?.radio) this.advanceMedia(room);
            return;
          default:
            return fail('Use /radio on, off, add <link>, remove <number> or clear.');
        }
      }

      case 'rules': {
        const row = store.getRoom(room);
        if (!args) {
          const r = store.rulesOf(row);
          return note(r ? `Rules of ${label(room)}: ${r.text}` : 'This room has no rules posted.');
        }
        if (this.rank(room, me) < 3) return fail('Only the room owner can change the rules.');
        const clear = args.toLowerCase() === 'clear' || args === '-';
        const text = clear ? null : sanitize(args).slice(0, MAX_RULES);
        store.setRules(room, text, conn.nick);
        this.broadcast(room, { t: 'rules', room, rules: store.rulesOf(store.getRoom(room)) });
        this.broadcast(room, { t: 'system', room, text: text ? `${conn.nick} updated the room rules` : `${conn.nick} removed the room rules` });
        return;
      }

      case 'topic': {
        const row = store.getRoom(room);
        if (!args) {
          const t = store.topicOf(row);
          return note(t ? `Topic: ${t.text}  (set by ${t.by})` : 'There is no topic set.');
        }
        if (this.rank(room, me) < 2) return fail('Only moderators can change the topic.');
        const clear = args.toLowerCase() === 'clear' || args === '-';
        const text = clear ? null : sanitize(args).slice(0, MAX_TOPIC);
        store.setTopic(room, text, conn.nick);
        this.broadcast(room, { t: 'topic', room, topic: store.topicOf(store.getRoom(room)) });
        this.broadcast(room, {
          t: 'system',
          room,
          text: text ? `${conn.nick} set the topic: ${text}` : `${conn.nick} cleared the topic`,
        });
        return;
      }

      case 'whois': {
        const t = this.policy.lookup(args.split(/\s+/)[0] ?? '');
        if (!args || !t) return fail(args ? `There is no member called "${args}".` : 'Use /whois <member>.');
        const theirs = this.connsOf(t.account);
        const rooms = new Set<string>();
        for (const c of theirs) for (const r of c.rooms) rooms.add(label(r));
        const away = theirs.length > 0 && theirs.every((c) => c.away !== null) ? theirs[0].away || 'away' : null;
        note(`${t.account} is ${theirs.length ? (away !== null ? `away (${away})` : 'online') : 'offline'}`);
        note(`Member since ${new Date(t.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`);
        if (rooms.size) note(`In: ${[...rooms].join(', ')}`);
        const role = this.roleOf(room, t.account);
        if (role) note(`Role in ${label(room)}: ${role}`);
        return;
      }

      case 'away': {
        const msg = sanitize(args).slice(0, 100);
        for (const c of this.connsOf(me)) c.away = msg || 'away';
        this.refreshPresenceFor(me);
        return note(msg ? `You are away: ${msg}` : 'You are marked as away. Use /back when you return.');
      }
      case 'back': {
        for (const c of this.connsOf(me)) c.away = null;
        this.refreshPresenceFor(me);
        return note('Welcome back.');
      }

      case 'block': {
        const t = this.policy.lookup(args.split(/\s+/)[0] ?? '');
        if (!t) return fail(args ? `There is no member called "${args}".` : 'Use /block <member>.');
        if (t.account.toLowerCase() === me.toLowerCase()) return fail('You cannot block yourself.');
        if (this.policy.isAdmin(t.account)) return fail('You cannot block an administrator.');
        store.addBlock(me.toLowerCase(), t.account.toLowerCase());
        this.blocksFor(me.toLowerCase()).add(t.account.toLowerCase());
        // Blocking someone ends any friendship or pending request between you.
        const ml = me.toLowerCase();
        const tl = t.account.toLowerCase();
        store.removeFriendship(ml, tl);
        store.removeRequest(ml, tl);
        store.removeRequest(tl, ml);
        this.sendFriends(me);
        this.sendFriends(t.account);
        return note(`You blocked ${t.account}. You will not see their messages and they cannot message you.`);
      }
      case 'unblock': {
        const name = args.split(/\s+/)[0] ?? '';
        const t = this.policy.lookup(name);
        const lower = (t?.account ?? name).toLowerCase();
        if (!name || !store.removeBlock(me.toLowerCase(), lower)) return fail('You have not blocked them.');
        this.blocksFor(me.toLowerCase()).delete(lower);
        return note(`You unblocked ${t?.account ?? name}.`);
      }
      case 'blocks': {
        const list = [...this.blocksFor(me.toLowerCase())];
        return note(list.length ? `You have blocked: ${list.join(', ')}` : 'You have not blocked anyone.');
      }

      // --- Moderation ---
      case 'kick': {
        const [name, ...why] = args.split(/\s+/);
        const t = this.moderationTarget(conn, room, name);
        if (!t) return;
        const reason = why.join(' ').slice(0, 150);
        const nick = this.ejectFromRoom(room, t.account.toLowerCase(), `You were kicked from ${label(room)} by ${conn.nick}${reason ? `: ${reason}` : ''}.`);
        if (!nick) return fail(`${t.account} is not in this room.`);
        return void this.broadcast(room, { t: 'system', room, text: `${nick} was kicked by ${conn.nick}${reason ? `: ${reason}` : ''}` });
      }

      case 'ban': {
        const [name, ...why] = args.split(/\s+/);
        const t = this.moderationTarget(conn, room, name);
        if (!t) return;
        const reason = why.join(' ').slice(0, 150);
        store.addBan(room, t.account, conn.nick, reason || null);
        this.ejectFromRoom(room, t.account.toLowerCase(), `You were banned from ${label(room)} by ${conn.nick}${reason ? `: ${reason}` : ''}.`);
        return void this.broadcast(room, { t: 'system', room, text: `${t.account} was banned by ${conn.nick}${reason ? `: ${reason}` : ''}` });
      }
      case 'unban': {
        if (this.rank(room, me) < 2) return fail('Only moderators can do that.');
        const t = this.policy.lookup(args.split(/\s+/)[0] ?? '');
        const lower = (t?.account ?? args).toLowerCase();
        if (!args || !store.removeBan(room, lower)) return fail('They are not banned from this room.');
        return void this.broadcast(room, { t: 'system', room, text: `${t?.account ?? args} was unbanned by ${conn.nick}` });
      }
      case 'bans': {
        if (this.rank(room, me) < 2) return fail('Only moderators can do that.');
        const list = store.listBans(room);
        return note(list.length ? `Banned from ${label(room)}: ${list.join(', ')}` : 'Nobody is banned from this room.');
      }

      case 'mute': {
        const parts = args.split(/\s+/);
        const t = this.moderationTarget(conn, room, parts[0]);
        if (!t) return;
        let minutes = 10;
        let rest = parts.slice(1);
        if (rest[0] !== undefined && /^\d+$/.test(rest[0])) {
          minutes = Math.min(10080, Number(rest[0]));
          rest = rest.slice(1);
        }
        const reason = rest.join(' ').slice(0, 150);
        store.addMute(room, t.account.toLowerCase(), minutes > 0 ? Date.now() + minutes * 60000 : null, conn.nick, reason || null);
        const span = minutes > 0 ? `for ${minutes} minute${minutes === 1 ? '' : 's'}` : 'until unmuted';
        return void this.broadcast(room, {
          t: 'system',
          room,
          text: `${t.account} was muted ${span} by ${conn.nick}${reason ? `: ${reason}` : ''}`,
        });
      }
      case 'unmute': {
        if (this.rank(room, me) < 2) return fail('Only moderators can do that.');
        const t = this.policy.lookup(args.split(/\s+/)[0] ?? '');
        if (!t || !store.removeMute(room, t.account.toLowerCase())) return fail('They are not muted.');
        return void this.broadcast(room, { t: 'system', room, text: `${t.account} was unmuted by ${conn.nick}` });
      }

      case 'mod':
      case 'unmod': {
        if (this.rank(room, me) < 3) return fail('Only the room owner can do that.');
        const t = this.policy.lookup(args.split(/\s+/)[0] ?? '');
        if (!t) return fail(args ? `There is no member called "${args}".` : `Use /${cmd} <member>.`);
        if (cmd === 'mod') {
          store.addMod(room, t.account.toLowerCase());
        } else {
          store.removeMod(room, t.account.toLowerCase());
        }
        this.broadcastPresence(room);
        return void this.broadcast(room, {
          t: 'system',
          room,
          text: cmd === 'mod' ? `${t.account} is now a moderator (by ${conn.nick})` : `${t.account} is no longer a moderator`,
        });
      }

      case 'deleteroom': {
        const row = store.getRoom(room);
        if (!row) return;
        if (row.permanent) return fail('Built-in rooms cannot be deleted.');
        if (this.rank(room, me) < 3) return fail('Only the room owner can delete it.');
        this.log(`room deleted: ${room} by ${conn.nick}`);
        this.destroyRoom(room, `${label(room)} was deleted by ${conn.nick}.`);
        return;
      }

      default:
        return fail(`Unknown command "/${cmd}". Type /help to see what you can do.`);
    }
  }

  /** Resolve the target of a moderation command and check the actor may act on them. */
  private moderationTarget(conn: Conn, room: string, name: string | undefined): { account: string } | null {
    const me = conn.account!;
    const fail = (text: string) => this.send(conn, { t: 'error', text });
    const mine = this.rank(room, me);
    if (mine < 2) {
      fail('Only moderators can do that.');
      return null;
    }
    if (!name) {
      fail('Say who, like "/kick Jen".');
      return null;
    }
    const t = this.policy.lookup(name);
    if (!t) {
      fail(`There is no member called "${name}".`);
      return null;
    }
    if (t.account.toLowerCase() === me.toLowerCase()) {
      fail('You cannot do that to yourself.');
      return null;
    }
    if (this.rank(room, t.account) >= mine) {
      fail(`You cannot do that to ${t.account}.`);
      return null;
    }
    return t;
  }

  // --- Roles and permissions -------------------------------------------------------

  /** 4 admin, 3 room owner, 2 room moderator, 0 everyone else. */
  private spam = new SpamWatch();

  /** The same message again and again: mute them in this room (longer each time) and say so. */
  private spamMuted(conn: Conn, room: string, text: string): boolean {
    const account = conn.account!;
    if (!getSettings().autoMuteSpam || this.rank(room, account) >= 2) return false;
    const minutes = this.spam.check(account.toLowerCase(), text);
    if (!minutes) return false;
    const span = minutes >= 1440 ? 'a day' : minutes >= 60 ? 'an hour' : `${minutes} minutes`;
    store.addMute(room, account.toLowerCase(), Date.now() + minutes * 60000, 'QChat', 'repeating the same message (automatic)');
    store.logAudit('automute', account, `${room}, ${minutes} minutes`);
    this.log(`auto-muted ${account} in ${room} for ${minutes} minutes for repeating a message`);
    this.send(conn, { t: 'error', text: `You have been muted for ${span} for repeating the same message.` });
    this.broadcast(room, { t: 'system', room, text: `${conn.nick} was muted for ${span} for repeating the same message (automatic)` });
    return true;
  }

  /**
   * Apply the administrators' blocked words and the new-member link rule. Tells the sender why and returns
   * true when the message must not be sent.
   */
  private screened(conn: Conn, text: string): boolean {
    const account = conn.account!;
    const joined = this.policy.lookup(account)?.createdAt ?? 0;
    const why = screenText(text, Date.now() - joined, this.policy.isAdmin(account));
    if (!why) return false;
    this.send(conn, { t: 'error', text: why });
    this.log(`blocked a message from ${account}`);
    return true;
  }

  private rank(room: string, account: string): number {
    if (this.policy.isAdmin(account)) return 4;
    const lower = account.toLowerCase();
    const row = store.getRoom(room);
    if (row?.owner && row.owner.toLowerCase() === lower) return 3;
    return store.isMod(room, lower) ? 2 : 0;
  }

  private roleOf(room: string, account: string): RoomRole | null {
    const r = this.rank(room, account);
    return r >= 4 ? 'admin' : r === 3 ? 'owner' : r === 2 ? 'mod' : null;
  }

  private roleMap(room: string): Record<string, RoomRole> {
    const row = store.getRoom(room);
    const mods = new Set(store.listMods(room));
    const out: Record<string, RoomRole> = {};
    for (const nick of this.memberNicks(room)) {
      const l = nick.toLowerCase();
      if (this.policy.isAdmin(nick)) out[nick] = 'admin';
      else if (row?.owner && row.owner.toLowerCase() === l) out[nick] = 'owner';
      else if (mods.has(l)) out[nick] = 'mod';
    }
    return out;
  }

  private isMuted(conn: Conn, room: string): boolean {
    if (this.policy.isAdmin(conn.account!)) return false;
    const m = store.activeMute(room, conn.account!.toLowerCase());
    if (!m) return false;
    const left = m.until ? ` for another ${Math.max(1, Math.ceil((m.until - Date.now()) / 60000))} minute(s)` : '';
    this.send(conn, { t: 'error', text: `You are muted in ${label(room)}${left}.` });
    return true;
  }

  private tooFast(conn: Conn): boolean {
    if (this.policy.isAdmin(conn.account!)) return false;
    const now = Date.now();
    conn.stamps = conn.stamps.filter((t) => now - t < FLOOD_WINDOW);
    if (conn.stamps.length >= FLOOD_COUNT) {
      this.send(conn, { t: 'error', text: 'You are sending messages too quickly. Please slow down.' });
      return true;
    }
    conn.stamps.push(now);
    return false;
  }

  private blocksFor(accountLower: string): Set<string> {
    let s = this.blocks.get(accountLower);
    if (!s) {
      s = store.blocksOf(accountLower);
      this.blocks.set(accountLower, s);
    }
    return s;
  }

  private unblocked(lines: ChatLine[], account: string): ChatLine[] {
    const blocked = this.blocksFor(account.toLowerCase());
    return blocked.size ? lines.filter((l) => !blocked.has(l.from.toLowerCase())) : lines;
  }

  // --- Media ----------------------------------------------------------------------

  /** Things waiting to play in each room, and who has voted to skip what is playing. */
  private queues = new Map<string, QueueItem[]>();
  private skipVotes = new Map<string, Set<string>>();
  /** Rooms where someone stopped the radio: it stays quiet until the room empties or the radio is switched on again. */
  private radioHold = new Set<string>();

  private noun(p: MediaProvider): string {
    return p === 'soundcloud' ? 'a track' : p === 'twitch' ? 'a live stream' : 'a video';
  }

  private queueState(room: string): ServerMsg {
    return {
      t: 'queue',
      room,
      items: this.queues.get(room) ?? [],
      skipVotes: this.skipVotes.get(room)?.size ?? 0,
      skipNeeded: Math.floor(this.memberNicks(room).length / 2) + 1,
    };
  }

  private broadcastQueue(room: string): void {
    this.broadcast(room, this.queueState(room));
  }

  private radioState(room: string): ServerMsg {
    return { t: 'radio', room, on: store.getRoom(room)?.radioOn ?? false, tracks: store.radioTracks(room) };
  }

  /** Forget everything about a room's media (it was closed or cleared). */
  private forgetMedia(room: string): void {
    this.media.delete(room);
    this.queues.delete(room);
    this.skipVotes.delete(room);
    this.radioHold.delete(room);
  }

  private onPlayMedia(conn: Conn, roomName: string, url: string, title?: string): void {
    const room = normalizeRoom(roomName);
    if (!this.inRoom(conn, room) || this.isMuted(conn, room)) return;
    const m = parseMediaUrl(url);
    if (!m) return this.send(conn, { t: 'error', text: 'That is not a link I can play. Try YouTube, Vimeo, SoundCloud or Twitch.' });
    this.startMedia(room, { ...m, by: conn.nick }, title);
  }

  /** Start something now, replacing whatever is playing. */
  private startMedia(room: string, item: { provider: MediaProvider; ref: string; by: string; radio?: boolean }, knownTitle?: string): void {
    const state: MediaState = {
      kind: item.provider,
      ref: item.ref,
      title: knownTitle ? cleanTitle(knownTitle) || undefined : undefined,
      by: item.by,
      paused: false,
      startedAt: Date.now(),
      pausedPos: 0,
      ...(item.radio ? { radio: true as const } : {}),
    };
    this.media.set(room, state);
    this.skipVotes.delete(room);
    this.broadcast(room, { t: 'media', room, state });
    this.broadcastQueue(room);
    // The name comes from the service itself, a moment later; the picture and sound do not wait for it.
    void (async () => {
      const title = state.title ?? (await lookupTitle(item.provider, item.ref)) ?? undefined;
      if (this.media.get(room) !== state) return; // something else started in the meantime
      if (title && !state.title) {
        state.title = title;
        this.broadcast(room, { t: 'media', room, state });
      }
      if (!item.radio) {
        this.broadcast(room, { t: 'system', room, text: `${item.by} started ${this.noun(item.provider)}${title ? `: ${title}` : ''}` });
      }
    })();
  }

  /** What the radio would play next in this room, or null. Moves the radio on. */
  private radioNext(room: string): { provider: MediaProvider; ref: string; title: string } | null {
    const row = store.getRoom(room);
    if (!row?.radioOn) return null;
    const tracks = store.radioTracks(room);
    if (tracks.length === 0) return null;
    const i = row.radioPos % tracks.length;
    store.setRadioPos(room, (i + 1) % tracks.length);
    return tracks[i];
  }

  /** Start the radio if the room is on it, has listeners, and nothing else is going on. */
  private maybeStartRadio(room: string): void {
    if (this.media.has(room) || this.radioHold.has(room) || (this.queues.get(room)?.length ?? 0) > 0) return;
    if (this.memberNicks(room).length === 0) return;
    const next = this.radioNext(room);
    if (next) this.startMedia(room, { provider: next.provider, ref: next.ref, by: 'Radio', radio: true }, next.title);
  }

  /** The current thing is over: play the next in the queue, else the radio, else leave the room quiet. */
  private advanceMedia(room: string, endedLine?: string): void {
    const next = this.queues.get(room)?.shift();
    if (next) {
      this.startMedia(room, { provider: next.provider, ref: next.ref, by: next.by }, next.title || undefined);
      return;
    }
    const radio = this.radioNext(room);
    if (radio && !this.radioHold.has(room)) {
      this.startMedia(room, { provider: radio.provider, ref: radio.ref, by: 'Radio', radio: true }, radio.title);
      return;
    }
    this.media.delete(room);
    this.skipVotes.delete(room);
    this.broadcast(room, { t: 'media', room, state: null });
    this.broadcastQueue(room);
    if (endedLine) this.broadcast(room, { t: 'system', room, text: endedLine });
  }

  private onQueueAdd(conn: Conn, roomName: string, url: string): void {
    const room = normalizeRoom(roomName);
    if (!this.inRoom(conn, room) || this.isMuted(conn, room)) return;
    const m = parseMediaUrl(url);
    if (!m) return this.send(conn, { t: 'error', text: 'That is not a link I can play. Try YouTube, Vimeo, SoundCloud or Twitch.' });
    if (isLive(m.provider)) {
      return this.send(conn, { t: 'error', text: 'A live stream never ends, so it cannot be queued. Play it for the room instead.' });
    }
    if (!this.media.has(room)) return this.startMedia(room, { ...m, by: conn.nick });
    const queue = this.queues.get(room) ?? [];
    if (queue.length >= MAX_QUEUE) return this.send(conn, { t: 'error', text: `The queue is full (${MAX_QUEUE}).` });
    if (queue.filter((q) => q.by.toLowerCase() === conn.nick.toLowerCase()).length >= MAX_QUEUE_PER_MEMBER) {
      return this.send(conn, { t: 'error', text: `You already have ${MAX_QUEUE_PER_MEMBER} things in the queue. Wait for one to play.` });
    }
    const item: QueueItem = { id: randomUUID().slice(0, 8), provider: m.provider, ref: m.ref, title: '', by: conn.nick };
    queue.push(item);
    this.queues.set(room, queue);
    this.broadcastQueue(room);
    void lookupTitle(m.provider, m.ref).then((title) => {
      if (!(this.queues.get(room) ?? []).includes(item)) return; // already played or removed
      if (title) item.title = title;
      this.broadcastQueue(room);
      this.broadcast(room, { t: 'system', room, text: `${conn.nick} queued ${title ?? this.noun(m.provider)}` });
    });
  }

  private onQueueRemove(conn: Conn, roomName: string, id: string): void {
    const room = normalizeRoom(roomName);
    if (!this.inRoom(conn, room)) return;
    const queue = this.queues.get(room) ?? [];
    const rank = this.rank(room, conn.account!);
    if (id === 'all') {
      if (rank < 2) return this.send(conn, { t: 'error', text: 'Only moderators can clear the queue.' });
      this.queues.delete(room);
      this.broadcastQueue(room);
      this.broadcast(room, { t: 'system', room, text: `${conn.nick} cleared the queue` });
      return;
    }
    const item = queue.find((q) => q.id === id);
    if (!item) return;
    if (item.by.toLowerCase() !== conn.nick.toLowerCase() && rank < 2) {
      return this.send(conn, { t: 'error', text: 'You can only remove your own things from the queue.' });
    }
    this.queues.set(room, queue.filter((q) => q !== item));
    this.broadcastQueue(room);
  }

  private onMediaSkip(conn: Conn, roomName: string): void {
    const room = normalizeRoom(roomName);
    if (!this.inRoom(conn, room) || this.isMuted(conn, room)) return;
    const state = this.media.get(room);
    if (!state) {
      // Nothing is playing: "skip" starts whatever is waiting.
      if ((this.queues.get(room)?.length ?? 0) === 0 && !store.getRoom(room)?.radioOn) {
        return this.send(conn, { t: 'error', text: 'Nothing is playing and nothing is waiting.' });
      }
      this.radioHold.delete(room);
      this.advanceMedia(room);
      return;
    }
    const lower = conn.account!.toLowerCase();
    const mine = state.by.toLowerCase() === conn.nick.toLowerCase();
    const votes = this.skipVotes.get(room) ?? new Set<string>();
    votes.add(lower);
    this.skipVotes.set(room, votes);
    const needed = Math.floor(this.memberNicks(room).length / 2) + 1;
    if (mine || this.rank(room, conn.account!) >= 2) {
      this.broadcast(room, { t: 'system', room, text: `${conn.nick} skipped it` });
      this.advanceMedia(room, 'Nothing else is waiting');
    } else if (votes.size >= needed) {
      this.broadcast(room, { t: 'system', room, text: 'The room voted to skip it' });
      this.advanceMedia(room, 'Nothing else is waiting');
    } else {
      this.broadcast(room, { t: 'system', room, text: `${conn.nick} voted to skip (${votes.size} of ${needed})` });
      this.broadcastQueue(room);
    }
  }

  private onMediaControl(
    conn: Conn,
    roomName: string,
    op: 'pause' | 'resume' | 'seek' | 'stop' | 'ended',
    pos?: number,
    ref?: string,
  ): void {
    const room = normalizeRoom(roomName);
    if (!this.inRoom(conn, room)) return;
    const state = this.media.get(room);
    if (!state) return; // already cleared (several watchers report the end at the same moment)
    const now = Date.now();
    if (op === 'ended') {
      // It ran to its end. Only about what is playing, and never within the first seconds.
      if (ref !== state.ref || state.paused || now - state.startedAt < 3000) return;
      this.advanceMedia(room, state.kind === 'soundcloud' ? 'The track has finished' : 'The video has finished');
      return;
    }
    if (op === 'stop') {
      this.media.delete(room);
      this.skipVotes.delete(room);
      if (store.getRoom(room)?.radioOn) this.radioHold.add(room);
      this.broadcast(room, { t: 'media', room, state: null });
      this.broadcastQueue(room);
      this.broadcast(room, { t: 'system', room, text: `${conn.nick} stopped the ${state.kind === 'soundcloud' ? 'track' : 'video'}` });
      return;
    }
    if (op === 'pause' && !state.paused) {
      state.pausedPos = (now - state.startedAt) / 1000;
      state.paused = true;
    } else if (op === 'resume' && state.paused) {
      state.startedAt = now - state.pausedPos * 1000;
      state.paused = false;
    } else if (op === 'seek' && typeof pos === 'number' && pos >= 0) {
      if (state.paused) state.pausedPos = pos;
      else state.startedAt = now - pos * 1000;
    } else {
      return;
    }
    this.broadcast(room, { t: 'media', room, state });
  }

  private onPlaySound(conn: Conn, roomName: string, sound: string): void {
    const room = normalizeRoom(roomName);
    if (!this.inRoom(conn, room) || !/^[a-z0-9_-]{1,24}$/.test(sound)) return;
    if (this.isMuted(conn, room) || this.tooFast(conn)) return;
    // A member's own clip only plays once an administrator has approved it.
    if (/^c\d+$/.test(sound) && !isApprovedSound(sound)) {
      return this.send(conn, { t: 'error', text: 'That sound is not available.' });
    }
    this.broadcast(room, { t: 'sound', room, sound, from: conn.nick });
  }

  // --- Helpers -----------------------------------------------------------------------

  private connsOf(account: string): Conn[] {
    const lower = account.toLowerCase();
    return [...this.conns.values()].filter((c) => c.account && c.account.toLowerCase() === lower);
  }

  private send(conn: Conn, msg: ServerMsg): void {
    if (conn.ws.readyState === conn.ws.OPEN) conn.ws.send(encodeMsg(msg));
  }

  private broadcast(room: string, msg: ServerMsg, exceptId?: string): void {
    const members = this.live.get(room);
    if (!members) return;
    const payload = encodeMsg(msg);
    for (const id of members) {
      if (id === exceptId) continue;
      const conn = this.conns.get(id);
      if (conn && conn.ws.readyState === conn.ws.OPEN) conn.ws.send(payload);
    }
  }

  private broadcastPresence(room: string): void {
    this.broadcast(room, {
      t: 'presence',
      room,
      members: this.memberNicks(room),
      roles: this.roleMap(room),
      away: this.awayNicks(room),
      bots: botsInRoom(room),
    });
  }

  private refreshPresenceFor(account: string): void {
    const rooms = new Set<string>();
    for (const c of this.connsOf(account)) for (const r of c.rooms) rooms.add(r);
    for (const r of rooms) this.broadcastPresence(r);
  }

  private memberNicks(room: string): string[] {
    // A unique list: the same account in two tabs is one member.
    const nicks = new Set<string>();
    for (const id of this.live.get(room) ?? []) {
      const conn = this.conns.get(id);
      if (conn) nicks.add(conn.nick);
    }
    return [...nicks].sort((a, b) => a.localeCompare(b));
  }

  /** Members whose every open window in the room is marked away. */
  private awayNicks(room: string): string[] {
    const present = new Map<string, boolean>();
    for (const id of this.live.get(room) ?? []) {
      const c = this.conns.get(id);
      if (!c) continue;
      present.set(c.nick, (present.get(c.nick) ?? true) && c.away !== null);
    }
    return [...present].filter(([, away]) => away).map(([n]) => n);
  }

  private roomInfos(): RoomInfo[] {
    return store.allRooms().map((r) => ({
      name: r.name,
      members: this.memberNicks(r.name).length,
      media: this.media.has(r.name),
      permanent: r.permanent,
      ...(r.topic ? { topic: r.topic } : {}),
      ...(r.owner ? { owner: r.owner } : {}),
    }));
  }

  /** Pull one account out of a room. Returns their nick, or null if they were not in it. */
  private ejectFromRoom(room: string, accountLower: string, toast: string): string | null {
    const members = this.live.get(room);
    if (!members) return null;
    let nick: string | null = null;
    for (const id of [...members]) {
      const c = this.conns.get(id);
      if (!c || c.account?.toLowerCase() !== accountLower) continue;
      nick = c.nick;
      members.delete(id);
      c.rooms.delete(room);
      this.send(c, { t: 'left', room });
      this.send(c, { t: 'error', text: toast });
    }
    if (nick) this.broadcastPresence(room);
    return nick;
  }

  /** Remove everybody and delete the room with everything in it. */
  private destroyRoom(room: string, toast: string): void {
    for (const id of [...(this.live.get(room) ?? [])]) {
      const c = this.conns.get(id);
      if (!c) continue;
      c.rooms.delete(room);
      this.send(c, { t: 'left', room });
      this.send(c, { t: 'error', text: toast });
    }
    this.live.delete(room);
    this.forgetMedia(room);
    this.videoRooms.delete(room);
    store.deleteRoom(room);
  }

  /** Tell a connection why it is refused, then hang up. */
  private reject(conn: Conn, text: string): void {
    this.send(conn, { t: 'error', text });
    conn.ws.close();
  }

  // --- Admin controls (called by the admin API, which checks permissions) ----

  stats(): { online: number; rooms: number; videos: number } {
    return {
      online: new Set([...this.conns.values()].filter((c) => c.account).map((c) => c.account!.toLowerCase())).size,
      rooms: store.roomCount(),
      videos: this.media.size,
    };
  }

  onlineAccounts(): Set<string> {
    return new Set([...this.conns.values()].filter((c) => c.account).map((c) => c.account!.toLowerCase()));
  }

  adminRooms(): AdminRoom[] {
    return store.allRooms().map((r) => ({
      name: r.name,
      permanent: r.permanent,
      builtin: DEFAULT_ROOMS.includes(r.name),
      members: this.memberNicks(r.name),
      media: this.media.get(r.name) ?? null,
      lines: store.countMessages(r.name),
      owner: r.owner,
      topic: r.topic,
    }));
  }

  /** Disconnect every connection of an account. Returns how many were closed. */
  kickAccount(account: string, reason: string): number {
    let n = 0;
    for (const c of this.connsOf(account)) {
      this.send(c, { t: 'error', text: reason });
      c.ws.close();
      n++;
    }
    return n;
  }

  /** Disconnect everyone who is not an administrator (maintenance mode). */
  kickNonAdmins(reason: string): number {
    let n = 0;
    for (const c of [...this.conns.values()]) {
      if (c.account && !this.policy.isAdmin(c.account)) {
        this.send(c, { t: 'error', text: reason });
        c.ws.close();
        n++;
      }
    }
    return n;
  }

  /** Remove everyone from a room. User rooms are deleted; built-in rooms lose their saved messages. */
  closeRoom(roomName: string): boolean {
    const room = normalizeRoom(roomName);
    const row = store.getRoom(room);
    if (!row) return false;
    if (row.permanent) {
      for (const id of [...(this.live.get(room) ?? [])]) {
        const c = this.conns.get(id);
        if (!c) continue;
        c.rooms.delete(room);
        this.send(c, { t: 'left', room });
        this.send(c, { t: 'error', text: `${label(room)} was closed by an administrator.` });
      }
      this.live.delete(room);
      this.forgetMedia(room);
      this.videoRooms.delete(room);
      store.clearRoom(room);
    } else {
      this.destroyRoom(room, `${label(room)} was closed by an administrator.`);
    }
    return true;
  }

  /** Tell every administrator who is online. */
  notifyAdmins(text: string): void {
    for (const c of this.conns.values()) {
      if (c.account && this.policy.isAdmin(c.account)) this.send(c, { t: 'info', text });
    }
  }

  /** Delete a message on an admin's behalf (from the report queue). */
  deleteMessageAdmin(roomName: string, id: string, by: string): boolean {
    const room = normalizeRoom(roomName);
    const msg = store.getMessage(room, id);
    if (!msg || msg.deleted) return false;
    store.deleteMessage(id, `${by} (admin)`);
    this.broadcast(room, { t: 'deleted', room, id });
    this.dropPin(room, id);
    return true;
  }

  stopMedia(roomName: string, by: string): boolean {
    const room = normalizeRoom(roomName);
    if (!this.media.has(room)) return false;
    this.media.delete(room);
    this.broadcast(room, { t: 'media', room, state: null });
    this.broadcast(room, { t: 'system', room, text: `${by} (admin) stopped the video` });
    return true;
  }

  /** Remove one person from one room. Returns false if they were not there. */
  kickFromRoom(roomName: string, nick: string): boolean {
    const room = normalizeRoom(roomName);
    const out = this.ejectFromRoom(room, nick.toLowerCase(), `You were removed from ${label(room)} by an administrator.`);
    if (!out) return false;
    this.broadcast(room, { t: 'leaveNotice', room, nick: out, reason: 'removed by an admin' });
    return true;
  }

  /** Create a server owned room (kept for good, run by the administrators). Returns an error message, or null. */
  createServerRoom(roomName: string, topic: string, by: string): string | null {
    const room = normalizeRoom(roomName);
    if (!validRoom(room)) return 'Room names can use letters, numbers, - and _ (up to 30 characters).';
    if (store.getRoom(room)) return 'There is already a room with that name.';
    if (store.roomCount() >= MAX_ROOMS) return 'There are too many rooms already.';
    store.createServerRoom(room, sanitize(topic).slice(0, MAX_TOPIC) || null, by);
    this.log(`server room created: ${room} by ${by}`);
    return null;
  }

  /** Delete a server owned room. The built in rooms and ordinary user rooms are refused. */
  deleteServerRoom(roomName: string): string | null {
    const room = normalizeRoom(roomName);
    const row = store.getRoom(room);
    if (!row) return 'No such room.';
    if (DEFAULT_ROOMS.includes(room)) return 'The built in rooms cannot be deleted. You can close one to clear it.';
    if (!row.permanent) return 'That is a user room. Use Close room to remove it.';
    this.destroyRoom(room, `${label(room)} was deleted by an administrator.`);
    return null;
  }

  /** Make an existing room server owned: it is kept for good and has no owner. */
  makeServerOwned(roomName: string): string | null {
    const room = normalizeRoom(roomName);
    const row = store.getRoom(room);
    if (!row) return 'No such room.';
    if (row.permanent && !row.owner) return 'That room is already server owned.';
    store.setServerOwned(room);
    this.broadcastPresence(room);
    return null;
  }

  /** Set or clear a room's topic on an administrator's behalf. */
  setRoomTopic(roomName: string, text: string, by: string): string | null {
    const room = normalizeRoom(roomName);
    if (!store.getRoom(room)) return 'No such room.';
    const clean = sanitize(text).slice(0, MAX_TOPIC) || null;
    store.setTopic(room, clean, by);
    this.broadcast(room, { t: 'topic', room, topic: store.topicOf(store.getRoom(room)) });
    this.broadcast(room, { t: 'system', room, text: clean ? `${by} set the topic: ${clean}` : `${by} cleared the topic` });
    return null;
  }

  /** Tell every room that has people in it that its bots may have changed. */
  refreshAllPresence(): void {
    for (const [room, members] of this.live) if (members.size > 0) this.broadcastPresence(room);
  }

  /**
   * Make a bot say something in a room it is in. Returns an error message, or null when sent.
   * This is also how bots will act later: everything a bot does goes through here.
   */
  botSay(botName: string, roomName: string, text: string, replyTo?: string): string | null {
    const room = normalizeRoom(roomName);
    const bot = botInRoom(botName, room);
    if (!bot) return `${botName} is not in ${label(room)}.`;
    if (!store.getRoom(room)) return 'There is no such room.';
    const clean = sanitize(text);
    if (!clean) return 'Write something for the bot to say.';
    const line = store.addMessage(room, bot.name, 'bot', clean, replyTo ? { replyTo } : {});
    store.touchRoom(room);
    this.broadcast(room, { t: 'message', room, line });
    return null;
  }

  /** Send an announcement to one room, or to everyone connected. */
  announce(text: string, by: string, roomName?: string): number {
    const msg: ServerMsg = { t: 'announce', text, by };
    if (roomName) {
      const room = normalizeRoom(roomName);
      const members = this.live.get(room);
      if (!members) return 0;
      this.broadcast(room, { ...msg, room });
      return members.size;
    }
    let n = 0;
    for (const c of this.conns.values()) {
      if (c.account) {
        this.send(c, msg);
        n++;
      }
    }
    return n;
  }
}
