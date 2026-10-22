import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import {
  COMMANDS,
  HISTORY_PAGE,
  MAX_MESSAGE,
  MAX_TOPIC,
  REACTION_EMOJI,
  decodeMsg,
  encodeMsg,
  normalizeRoom,
  validRoom,
  youTubeId,
  type AdminRoom,
  type ChatLine,
  type ClientMsg,
  type FriendInfo,
  type MediaState,
  type RoomInfo,
  type RoomRole,
  type ServerMsg,
} from '@qchat/shared';
import { UPLOAD_NAME_RE } from '../uploads.js';
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
}

const DEFAULT_ROOMS = ['#lobby', '#general', '#help'];
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
  /** Live membership: room -> connection ids. Rooms themselves live in the database. */
  private live = new Map<string, Set<string>>();
  private media = new Map<string, MediaState>(); // room -> current synced media
  private blocks = new Map<string, Set<string>>(); // account (lower) -> blocked (lower)

  constructor(
    private log: (msg: string) => void,
    private policy: ChatPolicy,
  ) {
    store.ensureBuiltInRooms(DEFAULT_ROOMS);

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
    };
    tidy();
    setInterval(tidy, 3600 * 1000).unref();
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
      const msg = decodeMsg<ClientMsg>(typeof data === 'string' ? data : data.toString());
      if (msg) this.handle(conn, msg);
    });
    ws.on('pong', () => (conn.alive = true));
    ws.on('close', () => this.disconnect(conn));
    ws.on('error', () => this.disconnect(conn));
  }

  // --- Dispatch -------------------------------------------------------------

  private handle(conn: Conn, msg: ClientMsg): void {
    if (msg.t === 'ping') return this.send(conn, { t: 'pong' });
    if (msg.t === 'hello') return this.onHello(conn, msg.token);
    if (!conn.account) return this.send(conn, { t: 'error', text: 'Please log in to chat.' });

    switch (msg.t) {
      case 'join':
        return this.onJoin(conn, msg.room, msg.restore === true);
      case 'leave':
        return this.onLeave(conn, msg.room, 'left');
      case 'say':
        return this.onSay(conn, msg.room, String(msg.text ?? ''), msg.replyTo, msg.image);
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
        return this.onPlayYouTube(conn, msg.room, msg.ref, msg.title);
      case 'mediaControl':
        return this.onMediaControl(conn, msg.room, msg.op, msg.pos);
      case 'playSound':
        return this.onPlaySound(conn, msg.room, msg.sound);
      case 'listRooms':
        return this.send(conn, { t: 'rooms', rooms: this.roomInfos() });
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
    this.send(conn, { t: 'welcome', you: { id: conn.id, nick: conn.nick, account } });
    this.sendThreads(account, conn);
    this.send(conn, { t: 'friends', ...this.friendList(account) });
    if (this.connsOf(account).length === 1) this.pushToFriends(account); // just came online
  }

  // --- Rooms ------------------------------------------------------------------

  private onJoin(conn: Conn, roomName: string, restore = false): void {
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
      this.broadcast(room, { t: 'joinNotice', room, nick: conn.nick }, conn.id);
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
      roles: this.roleMap(room),
      away: this.awayNicks(room),
    });
    this.broadcastPresence(room);
    const media = this.media.get(room);
    if (media) this.send(conn, { t: 'media', room, state: media });
    const welcome = this.policy.welcome();
    if (welcome && joinedNow) this.send(conn, { t: 'system', room, text: welcome });
  }

  private onLeave(conn: Conn, roomName: string, reason: string): void {
    const room = normalizeRoom(roomName);
    const members = this.live.get(room);
    if (!members || !members.has(conn.id)) return;
    members.delete(conn.id);
    conn.rooms.delete(room);
    this.send(conn, { t: 'left', room });
    this.broadcast(room, { t: 'leaveNotice', room, nick: conn.nick, reason });
    this.broadcastPresence(room);
  }

  private disconnect(conn: Conn): void {
    if (!this.conns.has(conn.id)) return;
    this.conns.delete(conn.id);
    for (const room of conn.rooms) {
      this.live.get(room)?.delete(conn.id);
      this.broadcast(room, { t: 'leaveNotice', room, nick: conn.nick, reason: 'disconnected' });
      this.broadcastPresence(room);
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
    const line = store.addMessage(room, conn.nick, kind, clean, {
      replyTo: extra.replyTo,
      image: extra.image ? `/uploads/${extra.image}` : undefined,
    });
    store.touchRoom(room);
    const sender = conn.nick.toLowerCase();
    for (const id of this.live.get(room) ?? []) {
      const c = this.conns.get(id);
      if (!c || !c.account) continue;
      if (this.blocksFor(c.account.toLowerCase()).has(sender)) continue; // they blocked the sender
      this.send(c, { t: 'message', room, line });
    }
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
    const edited = store.editMessage(id, clean);
    this.broadcast(room, { t: 'edited', room, id, text: clean, edited });
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
  }

  // --- Private messages ---------------------------------------------------------

  // --- Reactions, reports, search, room settings -----------------------------------

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

    const msg = store.addDm(me, target.account, kind, clean);
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

  private onPlayYouTube(conn: Conn, roomName: string, ref: string, title?: string): void {
    const room = normalizeRoom(roomName);
    if (!this.inRoom(conn, room) || this.isMuted(conn, room)) return;
    const id = youTubeId(ref);
    if (!id) return this.send(conn, { t: 'error', text: 'That is not a valid YouTube link.' });
    const cleanTitle = title ? title.slice(0, 120) : undefined;
    const state: MediaState = {
      kind: 'youtube',
      ref: id,
      title: cleanTitle,
      by: conn.nick,
      paused: false,
      startedAt: Date.now(),
      pausedPos: 0,
    };
    this.media.set(room, state);
    this.broadcast(room, { t: 'media', room, state });
    this.broadcast(room, { t: 'system', room, text: `${conn.nick} started a video${cleanTitle ? `: ${cleanTitle}` : ''}` });
  }

  private onMediaControl(
    conn: Conn,
    roomName: string,
    op: 'pause' | 'resume' | 'seek' | 'stop',
    pos?: number,
  ): void {
    const room = normalizeRoom(roomName);
    if (!this.inRoom(conn, room)) return;
    const state = this.media.get(room);
    if (!state) return;
    const now = Date.now();
    if (op === 'stop') {
      this.media.delete(room);
      this.broadcast(room, { t: 'media', room, state: null });
      this.broadcast(room, { t: 'system', room, text: `${conn.nick} stopped the video` });
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
    this.media.delete(room);
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
      this.media.delete(room);
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
