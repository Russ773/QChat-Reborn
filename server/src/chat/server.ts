import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import {
  decodeMsg,
  encodeMsg,
  normalizeRoom,
  validNick,
  type ChatLine,
  type ClientMsg,
  type ServerMsg,
} from '@qchat/shared';

interface Conn {
  id: string;
  ws: WebSocket;
  nick: string;
  account: string | null;
  rooms: Set<string>;
}

/** Resolves a session token to an account name, or null. */
export type AuthResolver = (token: string) => string | null;

const DEFAULT_ROOMS = ['#lobby', '#general', '#help'];
const HISTORY_LIMIT = 50;
const MAX_TEXT = 2000;

/**
 * The native real-time chat engine. Holds live connections, room membership
 * and a short in-memory history per room (durable DB history is a later phase).
 * No IRC: the browser speaks the JSON protocol in @qchat/shared directly.
 */
export class ChatServer {
  private conns = new Map<string, Conn>();
  private rooms = new Map<string, Set<string>>(); // room -> connection ids
  private history = new Map<string, ChatLine[]>(); // room -> recent lines

  constructor(
    private log: (msg: string) => void = () => {},
    private auth?: AuthResolver,
  ) {
    for (const r of DEFAULT_ROOMS) {
      this.rooms.set(r, new Set());
    }
  }

  accept(ws: WebSocket): void {
    const conn: Conn = { id: randomUUID(), ws, nick: '', account: null, rooms: new Set() };
    this.conns.set(conn.id, conn);

    ws.on('message', (data) => {
      const msg = decodeMsg<ClientMsg>(typeof data === 'string' ? data : data.toString());
      if (msg) this.handle(conn, msg);
    });
    ws.on('close', () => this.disconnect(conn));
    ws.on('error', () => this.disconnect(conn));
  }

  // --- Dispatch -------------------------------------------------------------

  private handle(conn: Conn, msg: ClientMsg): void {
    switch (msg.t) {
      case 'hello':
        return this.onHello(conn, msg.nick, msg.token);
      case 'join':
        return this.onJoin(conn, msg.room);
      case 'leave':
        return this.onLeave(conn, msg.room, 'left');
      case 'say':
        return this.onSay(conn, msg.room, msg.text);
      case 'nick':
        return this.onNick(conn, msg.nick);
      case 'ping':
        return this.send(conn, { t: 'pong' });
    }
  }

  private onHello(conn: Conn, desired: string, token?: string): void {
    // A valid token logs the connection in and locks the nick to the account.
    const account = token && this.auth ? this.auth(token) : null;
    conn.account = account;
    conn.nick = account ?? this.uniqueNick(desired);
    this.send(conn, {
      t: 'welcome',
      you: { id: conn.id, nick: conn.nick, account: conn.account },
      rooms: [...this.rooms.keys()],
    });
  }

  private onJoin(conn: Conn, roomName: string): void {
    if (!conn.nick) return this.send(conn, { t: 'error', text: 'Say hello first.' });
    const room = normalizeRoom(roomName);
    if (!room) return this.send(conn, { t: 'error', text: 'That is not a valid room name.' });

    let members = this.rooms.get(room);
    if (!members) {
      members = new Set();
      this.rooms.set(room, members);
    }
    if (!members.has(conn.id)) {
      members.add(conn.id);
      conn.rooms.add(room);
      this.broadcast(room, { t: 'joinNotice', room, nick: conn.nick }, conn.id);
    }

    this.send(conn, {
      t: 'joined',
      room,
      members: this.memberNicks(room),
      history: this.history.get(room) ?? [],
    });
    this.broadcast(room, { t: 'presence', room, members: this.memberNicks(room) });
  }

  private onLeave(conn: Conn, roomName: string, reason: string): void {
    const room = normalizeRoom(roomName);
    const members = this.rooms.get(room);
    if (!members || !members.has(conn.id)) return;
    members.delete(conn.id);
    conn.rooms.delete(room);
    this.send(conn, { t: 'left', room });
    this.broadcast(room, { t: 'leaveNotice', room, nick: conn.nick, reason });
    this.broadcast(room, { t: 'presence', room, members: this.memberNicks(room) });
  }

  private onSay(conn: Conn, roomName: string, text: string): void {
    const room = normalizeRoom(roomName);
    const members = this.rooms.get(room);
    if (!members || !members.has(conn.id)) {
      return this.send(conn, { t: 'error', text: 'You are not in that room.' });
    }
    const clean = text.trim().slice(0, MAX_TEXT);
    if (!clean) return;

    const line: ChatLine = { id: randomUUID(), from: conn.nick, text: clean, ts: Date.now() };
    this.pushHistory(room, line);
    this.broadcast(room, { t: 'message', room, line });
  }

  private onNick(conn: Conn, desired: string): void {
    const next = this.uniqueNick(desired);
    if (next === conn.nick) return;
    const from = conn.nick;
    conn.nick = next;
    this.send(conn, { t: 'nickChanged', nick: next });
    for (const room of conn.rooms) {
      this.broadcast(room, { t: 'nickNotice', room, from, to: next });
      this.broadcast(room, { t: 'presence', room, members: this.memberNicks(room) });
    }
  }

  private disconnect(conn: Conn): void {
    if (!this.conns.has(conn.id)) return;
    this.conns.delete(conn.id);
    for (const room of conn.rooms) {
      const members = this.rooms.get(room);
      if (!members) continue;
      members.delete(conn.id);
      this.broadcast(room, { t: 'leaveNotice', room, nick: conn.nick, reason: 'disconnected' });
      this.broadcast(room, { t: 'presence', room, members: this.memberNicks(room) });
    }
  }

  // --- Helpers --------------------------------------------------------------

  private send(conn: Conn, msg: ServerMsg): void {
    if (conn.ws.readyState === conn.ws.OPEN) {
      conn.ws.send(encodeMsg(msg));
    }
  }

  private broadcast(room: string, msg: ServerMsg, exceptId?: string): void {
    const members = this.rooms.get(room);
    if (!members) return;
    const payload = encodeMsg(msg);
    for (const id of members) {
      if (id === exceptId) continue;
      const conn = this.conns.get(id);
      if (conn && conn.ws.readyState === conn.ws.OPEN) conn.ws.send(payload);
    }
  }

  private memberNicks(room: string): string[] {
    const members = this.rooms.get(room);
    if (!members) return [];
    const nicks: string[] = [];
    for (const id of members) {
      const conn = this.conns.get(id);
      if (conn) nicks.push(conn.nick);
    }
    return nicks.sort((a, b) => a.localeCompare(b));
  }

  private pushHistory(room: string, line: ChatLine): void {
    const lines = this.history.get(room) ?? [];
    lines.push(line);
    if (lines.length > HISTORY_LIMIT) lines.splice(0, lines.length - HISTORY_LIMIT);
    this.history.set(room, lines);
  }

  /** Ensure a nick is valid and not already taken (case-insensitive). */
  private uniqueNick(desired: string): string {
    let base = (desired || 'guest').trim();
    if (!validNick(base)) base = 'guest' + Math.floor(Math.random() * 1000);
    const taken = new Set(
      [...this.conns.values()].map((c) => c.nick.toLowerCase()).filter(Boolean),
    );
    if (!taken.has(base.toLowerCase())) return base;
    for (let i = 1; i < 1000; i++) {
      const candidate = `${base}${i}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return `${base}${randomUUID().slice(0, 4)}`;
  }
}
