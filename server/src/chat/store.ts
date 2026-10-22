import { randomUUID } from 'node:crypto';
import type { ChatLine, Dm, DmThread, RoomTopic } from '@qchat/shared';
import { db } from '../db.js';

const now = () => Date.now();

// --- Rooms ------------------------------------------------------------------

export interface RoomRow {
  name: string;
  owner: string | null;
  topic: string | null;
  topicBy: string | null;
  topicAt: number | null;
  permanent: boolean;
  createdAt: number;
  lastActive: number;
}

type RawRoom = Omit<RoomRow, 'permanent'> & { permanent: number };
const toRoom = (r: RawRoom): RoomRow => ({ ...r, permanent: !!r.permanent });

export function ensureBuiltInRooms(names: string[]): void {
  const ins = db.prepare(
    'INSERT OR IGNORE INTO rooms (name, owner, permanent, createdAt, lastActive) VALUES (?, NULL, 1, ?, ?)',
  );
  for (const n of names) ins.run(n, now(), now());
  // Make sure built-in rooms stay marked permanent even in an older database.
  const mark = db.prepare('UPDATE rooms SET permanent = 1 WHERE name = ?');
  for (const n of names) mark.run(n);
}

export function getRoom(name: string): RoomRow | undefined {
  const r = db.prepare('SELECT * FROM rooms WHERE name = ?').get(name) as RawRoom | undefined;
  return r ? toRoom(r) : undefined;
}

export function allRooms(): RoomRow[] {
  return (db.prepare('SELECT * FROM rooms ORDER BY name').all() as unknown as RawRoom[]).map(toRoom);
}

export function roomCount(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM rooms').get() as { n: number }).n;
}

export function createRoom(name: string, owner: string | null): RoomRow {
  db.prepare('INSERT INTO rooms (name, owner, permanent, createdAt, lastActive) VALUES (?, ?, 0, ?, ?)')
    .run(name, owner, now(), now());
  return getRoom(name)!;
}

export function touchRoom(name: string): void {
  db.prepare('UPDATE rooms SET lastActive = ? WHERE name = ?').run(now(), name);
}

export function topicOf(room: RoomRow | undefined): RoomTopic | null {
  return room && room.topic ? { text: room.topic, by: room.topicBy ?? '', at: room.topicAt ?? 0 } : null;
}

export function setTopic(name: string, text: string | null, by: string): void {
  db.prepare('UPDATE rooms SET topic = ?, topicBy = ?, topicAt = ? WHERE name = ?')
    .run(text, text ? by : null, text ? now() : null, name);
}

/** Delete a room and everything attached to it. */
export function deleteRoom(name: string): void {
  for (const t of ['messages', 'room_mods', 'room_bans', 'room_mutes']) {
    db.prepare(`DELETE FROM ${t} WHERE room = ?`).run(name);
  }
  db.prepare('DELETE FROM rooms WHERE name = ?').run(name);
}

/** Keep the room but throw away its messages. */
export function clearRoom(name: string): void {
  db.prepare('DELETE FROM messages WHERE room = ?').run(name);
}

/** Delete user rooms nobody has used since `cutoff`. Returns their names. */
export function expireRooms(cutoff: number, isLive: (name: string) => boolean): string[] {
  const rows = db
    .prepare('SELECT name FROM rooms WHERE permanent = 0 AND lastActive < ?')
    .all(cutoff) as { name: string }[];
  const gone: string[] = [];
  for (const { name } of rows) {
    if (isLive(name)) continue;
    deleteRoom(name);
    gone.push(name);
  }
  return gone;
}

// --- Moderators, bans, mutes ----------------------------------------------------

export function isMod(room: string, accountLower: string): boolean {
  return !!db.prepare('SELECT 1 FROM room_mods WHERE room = ? AND accountLower = ?').get(room, accountLower);
}
export function listMods(room: string): string[] {
  return (db.prepare('SELECT accountLower FROM room_mods WHERE room = ?').all(room) as { accountLower: string }[]).map(
    (r) => r.accountLower,
  );
}
export function addMod(room: string, accountLower: string): void {
  db.prepare('INSERT OR IGNORE INTO room_mods (room, accountLower) VALUES (?, ?)').run(room, accountLower);
}
export function removeMod(room: string, accountLower: string): void {
  db.prepare('DELETE FROM room_mods WHERE room = ? AND accountLower = ?').run(room, accountLower);
}

export function isBanned(room: string, accountLower: string): boolean {
  return !!db.prepare('SELECT 1 FROM room_bans WHERE room = ? AND accountLower = ?').get(room, accountLower);
}
export function listBans(room: string): string[] {
  return (db.prepare('SELECT account FROM room_bans WHERE room = ? ORDER BY ts').all(room) as { account: string }[]).map(
    (r) => r.account,
  );
}
export function addBan(room: string, account: string, by: string, reason: string | null): void {
  db.prepare(
    'INSERT OR REPLACE INTO room_bans (room, accountLower, account, bannedBy, reason, ts) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(room, account.toLowerCase(), account, by, reason, now());
}
export function removeBan(room: string, accountLower: string): boolean {
  return Number(db.prepare('DELETE FROM room_bans WHERE room = ? AND accountLower = ?').run(room, accountLower).changes) > 0;
}

/** The active mute for someone in a room, or null (expired mutes are cleared). */
export function activeMute(room: string, accountLower: string): { until: number | null } | null {
  const r = db.prepare('SELECT until FROM room_mutes WHERE room = ? AND accountLower = ?').get(room, accountLower) as
    | { until: number | null }
    | undefined;
  if (!r) return null;
  if (r.until !== null && r.until <= now()) {
    db.prepare('DELETE FROM room_mutes WHERE room = ? AND accountLower = ?').run(room, accountLower);
    return null;
  }
  return { until: r.until };
}
export function addMute(room: string, accountLower: string, until: number | null, by: string, reason: string | null): void {
  db.prepare('INSERT OR REPLACE INTO room_mutes (room, accountLower, until, mutedBy, reason) VALUES (?, ?, ?, ?, ?)')
    .run(room, accountLower, until, by, reason);
}
export function removeMute(room: string, accountLower: string): boolean {
  return Number(db.prepare('DELETE FROM room_mutes WHERE room = ? AND accountLower = ?').run(room, accountLower).changes) > 0;
}

// --- Room messages ------------------------------------------------------------------

interface MsgRow {
  seq: number;
  id: string;
  fromName: string;
  kind: string | null;
  text: string;
  ts: number;
  editedAt: number | null;
}

const toLine = (r: MsgRow): ChatLine => ({
  id: r.id,
  seq: r.seq,
  from: r.fromName,
  text: r.text,
  ts: r.ts,
  ...(r.kind === 'action' ? { kind: 'action' as const } : {}),
  ...(r.editedAt ? { edited: r.editedAt } : {}),
});

export function addMessage(room: string, from: string, kind: 'action' | undefined, text: string): ChatLine {
  const id = randomUUID();
  const ts = now();
  const r = db
    .prepare('INSERT INTO messages (id, room, fromName, fromLower, kind, text, ts) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, room, from, from.toLowerCase(), kind ?? null, text, ts);
  return { id, seq: Number(r.lastInsertRowid), from, text, ts, ...(kind ? { kind } : {}) };
}

/** A page of saved messages, oldest first, ending just before `before`. */
export function getMessages(room: string, before: number | undefined, limit: number): { lines: ChatLine[]; more: boolean } {
  const rows = (
    before
      ? db
          .prepare('SELECT * FROM messages WHERE room = ? AND deleted = 0 AND seq < ? ORDER BY seq DESC LIMIT ?')
          .all(room, before, limit + 1)
      : db.prepare('SELECT * FROM messages WHERE room = ? AND deleted = 0 ORDER BY seq DESC LIMIT ?').all(room, limit + 1)
  ) as unknown as MsgRow[];
  const more = rows.length > limit;
  return { lines: rows.slice(0, limit).reverse().map(toLine), more };
}

export function getMessage(room: string, id: string): { seq: number; fromLower: string; kind: string | null; deleted: boolean } | undefined {
  const r = db.prepare('SELECT seq, fromLower, kind, deleted FROM messages WHERE room = ? AND id = ?').get(room, id) as
    | { seq: number; fromLower: string; kind: string | null; deleted: number }
    | undefined;
  return r ? { seq: r.seq, fromLower: r.fromLower, kind: r.kind, deleted: !!r.deleted } : undefined;
}

export function editMessage(id: string, text: string): number {
  const at = now();
  db.prepare('UPDATE messages SET text = ?, editedAt = ? WHERE id = ?').run(text, at, id);
  return at;
}

export function deleteMessage(id: string, by: string): void {
  db.prepare('UPDATE messages SET deleted = 1, deletedBy = ? WHERE id = ?').run(by, id);
}

export function countMessages(room: string): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM messages WHERE room = ? AND deleted = 0').get(room) as { n: number }).n;
}

/** Keep only the newest `keep` messages in each room. */
export function trimMessages(keep: number): void {
  const rooms = db.prepare('SELECT DISTINCT room FROM messages').all() as { room: string }[];
  const cut = db.prepare('SELECT seq FROM messages WHERE room = ? ORDER BY seq DESC LIMIT 1 OFFSET ?');
  const del = db.prepare('DELETE FROM messages WHERE room = ? AND seq <= ?');
  for (const { room } of rooms) {
    const c = cut.get(room, keep) as { seq: number } | undefined;
    if (c) del.run(room, c.seq);
  }
}

// --- Private messages --------------------------------------------------------------

interface DmRow {
  seq: number;
  id: string;
  fromName: string;
  fromLower: string;
  toName: string;
  kind: string | null;
  text: string;
  ts: number;
}

const toDm = (r: DmRow): Dm => ({
  id: r.id,
  seq: r.seq,
  from: r.fromName,
  to: r.toName,
  text: r.text,
  ts: r.ts,
  ...(r.kind === 'action' ? { kind: 'action' as const } : {}),
});

export function addDm(from: string, to: string, kind: 'action' | undefined, text: string): Dm {
  const id = randomUUID();
  const ts = now();
  const r = db
    .prepare('INSERT INTO dms (id, fromName, fromLower, toName, toLower, kind, text, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, from, from.toLowerCase(), to, to.toLowerCase(), kind ?? null, text, ts);
  return { id, seq: Number(r.lastInsertRowid), from, to, text, ts, ...(kind ? { kind } : {}) };
}

export function getDms(a: string, b: string, before: number | undefined, limit: number): { lines: Dm[]; more: boolean } {
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  const base = `SELECT * FROM dms WHERE ((fromLower = ? AND toLower = ?) OR (fromLower = ? AND toLower = ?))`;
  const rows = (
    before
      ? db.prepare(`${base} AND seq < ? ORDER BY seq DESC LIMIT ?`).all(al, bl, bl, al, before, limit + 1)
      : db.prepare(`${base} ORDER BY seq DESC LIMIT ?`).all(al, bl, bl, al, limit + 1)
  ) as unknown as DmRow[];
  return { lines: rows.slice(0, limit).reverse().map(toDm), more: rows.length > limit };
}

/** Mark everything from `partner` as read. */
export function markDmsRead(account: string, partner: string): void {
  const last = (db
    .prepare('SELECT MAX(seq) AS s FROM dms WHERE (fromLower = ? AND toLower = ?) OR (fromLower = ? AND toLower = ?)')
    .get(account.toLowerCase(), partner.toLowerCase(), partner.toLowerCase(), account.toLowerCase()) as { s: number | null }).s;
  db.prepare(
    `INSERT INTO dm_state (accountLower, partnerLower, lastRead) VALUES (?, ?, ?)
     ON CONFLICT(accountLower, partnerLower) DO UPDATE SET lastRead = excluded.lastRead`,
  ).run(account.toLowerCase(), partner.toLowerCase(), last ?? 0);
}

/** Every conversation an account is part of, newest first, with unread counts. */
export function dmThreads(account: string): DmThread[] {
  const al = account.toLowerCase();
  const partners = db
    .prepare(
      `SELECT partnerLower, MAX(seq) AS lastSeq FROM (
         SELECT toLower AS partnerLower, seq FROM dms WHERE fromLower = ?
         UNION ALL
         SELECT fromLower AS partnerLower, seq FROM dms WHERE toLower = ?
       ) GROUP BY partnerLower ORDER BY lastSeq DESC LIMIT 100`,
    )
    .all(al, al) as { partnerLower: string; lastSeq: number }[];

  const lastMsg = db.prepare('SELECT * FROM dms WHERE seq = ?');
  const readOf = db.prepare('SELECT lastRead FROM dm_state WHERE accountLower = ? AND partnerLower = ?');
  const unreadOf = db.prepare('SELECT COUNT(*) AS n FROM dms WHERE fromLower = ? AND toLower = ? AND seq > ?');

  return partners.map(({ partnerLower, lastSeq }) => {
    const m = lastMsg.get(lastSeq) as unknown as DmRow;
    const read = (readOf.get(al, partnerLower) as { lastRead: number } | undefined)?.lastRead ?? 0;
    const unread = (unreadOf.get(partnerLower, al, read) as { n: number }).n;
    const partnerName = m.fromLower === al ? m.toName : m.fromName;
    return { with: partnerName, last: m.kind === 'action' ? `* ${m.text}` : m.text, ts: m.ts, unread };
  });
}

// --- Blocks -----------------------------------------------------------------------------

export function blocksOf(accountLower: string): Set<string> {
  const rows = db.prepare('SELECT blockedLower FROM blocks WHERE accountLower = ?').all(accountLower) as {
    blockedLower: string;
  }[];
  return new Set(rows.map((r) => r.blockedLower));
}
export function addBlock(accountLower: string, blockedLower: string): void {
  db.prepare('INSERT OR IGNORE INTO blocks (accountLower, blockedLower) VALUES (?, ?)').run(accountLower, blockedLower);
}
export function removeBlock(accountLower: string, blockedLower: string): boolean {
  return Number(db.prepare('DELETE FROM blocks WHERE accountLower = ? AND blockedLower = ?').run(accountLower, blockedLower).changes) > 0;
}

// --- Cleanup when an account is deleted -------------------------------------------------

export function purgeAccount(account: string): void {
  const l = account.toLowerCase();
  db.prepare('DELETE FROM dms WHERE fromLower = ? OR toLower = ?').run(l, l);
  db.prepare('DELETE FROM dm_state WHERE accountLower = ? OR partnerLower = ?').run(l, l);
  db.prepare('DELETE FROM blocks WHERE accountLower = ? OR blockedLower = ?').run(l, l);
  db.prepare('DELETE FROM room_mods WHERE accountLower = ?').run(l);
  db.prepare('DELETE FROM room_bans WHERE accountLower = ?').run(l);
  db.prepare('DELETE FROM room_mutes WHERE accountLower = ?').run(l);
  db.prepare('UPDATE rooms SET owner = NULL WHERE lower(owner) = ?').run(l);
}
