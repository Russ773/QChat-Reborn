import { randomUUID } from 'node:crypto';
import type { AdminReport, ChatLine, Dm, DmThread, ReplyRef, RoomTopic } from '@qchat/shared';
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

export function countMembers(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }).n;
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

/** A server owned room: kept for good, no owner (administrators run it), optionally with a topic. */
export function createServerRoom(name: string, topic: string | null, by: string): RoomRow {
  db.prepare('INSERT INTO rooms (name, owner, permanent, createdAt, lastActive) VALUES (?, NULL, 1, ?, ?)').run(name, now(), now());
  if (topic) setTopic(name, topic, by);
  return getRoom(name)!;
}

/** Turn an existing room into a server owned one. */
export function setServerOwned(name: string): void {
  db.prepare('UPDATE rooms SET owner = NULL, permanent = 1 WHERE name = ?').run(name);
}

/** Give the built in rooms their starting topics, once (so a topic an admin later clears stays cleared). */
export function seedDefaultTopics(topics: Record<string, string>): void {
  if (db.prepare("SELECT 1 FROM settings WHERE key = 'defaultTopicsSeeded'").get()) return;
  for (const [name, text] of Object.entries(topics)) {
    db.prepare('UPDATE rooms SET topic = ?, topicBy = ?, topicAt = ? WHERE name = ? AND topic IS NULL').run(text, 'QChat', now(), name);
  }
  db.prepare("INSERT INTO settings (key, value) VALUES ('defaultTopicsSeeded', 'true')").run();
}

/** Delete a room and everything attached to it. */
export function deleteRoom(name: string): void {
  db.prepare('DELETE FROM reactions WHERE messageId IN (SELECT id FROM messages WHERE room = ?)').run(name);
  for (const t of ['messages', 'room_mods', 'room_bans', 'room_mutes']) {
    db.prepare(`DELETE FROM ${t} WHERE room = ?`).run(name);
  }
  db.prepare('DELETE FROM rooms WHERE name = ?').run(name);
}

/** Keep the room but throw away its messages. */
export function clearRoom(name: string): void {
  db.prepare('DELETE FROM reactions WHERE messageId IN (SELECT id FROM messages WHERE room = ?)').run(name);
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
export function listMutes(room: string): { accountLower: string; until: number | null }[] {
  db.prepare('DELETE FROM room_mutes WHERE room = ? AND until IS NOT NULL AND until <= ?').run(room, now());
  return db.prepare('SELECT accountLower, until FROM room_mutes WHERE room = ?').all(room) as unknown as {
    accountLower: string;
    until: number | null;
  }[];
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
  room: string;
  fromName: string;
  kind: string | null;
  text: string;
  ts: number;
  editedAt: number | null;
  image: string | null;
  replyTo: string | null;
  // The message being replied to (joined in).
  rId: string | null;
  rFrom: string | null;
  rText: string | null;
  rDeleted: number | null;
}

const MSG_SELECT = `SELECT m.seq, m.id, m.room, m.fromName, m.kind, m.text, m.ts, m.editedAt, m.image, m.replyTo,
    r.id AS rId, r.fromName AS rFrom, r.text AS rText, r.deleted AS rDeleted
  FROM messages m LEFT JOIN messages r ON r.id = m.replyTo`;

const SNIPPET = 100;

function replyRef(r: MsgRow): ReplyRef | undefined {
  if (!r.replyTo) return undefined;
  // The original may be deleted, or trimmed away entirely.
  if (!r.rId || r.rDeleted) return { id: r.replyTo, from: r.rFrom ?? '', text: '', deleted: true };
  return { id: r.rId, from: r.rFrom ?? '', text: (r.rText ?? '').slice(0, SNIPPET) };
}

function toLines(rows: MsgRow[]): ChatLine[] {
  const reacts = reactionsFor(rows.map((r) => r.id));
  return rows.map((r) => {
    const reply = replyRef(r);
    const rx = reacts.get(r.id);
    return {
      id: r.id,
      seq: r.seq,
      from: r.fromName,
      text: r.text,
      ts: r.ts,
      ...(r.kind === 'action' ? { kind: 'action' as const } : {}),
      ...(r.kind === 'bot' ? { bot: true as const } : {}),
      ...(r.editedAt ? { edited: r.editedAt } : {}),
      ...(reply ? { replyTo: reply } : {}),
      ...(r.image ? { image: r.image } : {}),
      ...(rx ? { reactions: rx } : {}),
    };
  });
}

export interface NewMessage {
  replyTo?: string;
  image?: string;
}

export function addMessage(room: string, from: string, kind: 'action' | 'bot' | undefined, text: string, extra: NewMessage = {}): ChatLine {
  const id = randomUUID();
  const ts = now();
  const r = db
    .prepare('INSERT INTO messages (id, room, fromName, fromLower, kind, text, ts, replyTo, image) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, room, from, from.toLowerCase(), kind ?? null, text, ts, extra.replyTo ?? null, extra.image ?? null);
  const row = db.prepare(`${MSG_SELECT} WHERE m.seq = ?`).get(Number(r.lastInsertRowid)) as unknown as MsgRow;
  return toLines([row])[0];
}

/** A page of saved messages, oldest first, ending just before `before`. */
export function getMessages(room: string, before: number | undefined, limit: number): { lines: ChatLine[]; more: boolean } {
  const rows = (
    before
      ? db.prepare(`${MSG_SELECT} WHERE m.room = ? AND m.deleted = 0 AND m.seq < ? ORDER BY m.seq DESC LIMIT ?`).all(room, before, limit + 1)
      : db.prepare(`${MSG_SELECT} WHERE m.room = ? AND m.deleted = 0 ORDER BY m.seq DESC LIMIT ?`).all(room, limit + 1)
  ) as unknown as MsgRow[];
  const more = rows.length > limit;
  return { lines: toLines(rows.slice(0, limit).reverse()), more };
}

/** Find text in a room's saved messages (newest first). */
export function searchMessages(room: string, query: string, limit: number): ChatLine[] {
  const like = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = db
    .prepare(`${MSG_SELECT} WHERE m.room = ? AND m.deleted = 0 AND m.text LIKE ? ESCAPE '\\' ORDER BY m.seq DESC LIMIT ?`)
    .all(room, like, limit) as unknown as MsgRow[];
  return toLines(rows);
}

export interface MessageInfo {
  id: string;
  seq: number;
  room: string;
  fromName: string;
  fromLower: string;
  kind: string | null;
  text: string;
  image: string | null;
  deleted: boolean;
}

export function getMessage(room: string, id: string): MessageInfo | undefined {
  const r = db
    .prepare('SELECT id, seq, room, fromName, fromLower, kind, text, image, deleted FROM messages WHERE room = ? AND id = ?')
    .get(room, id) as (Omit<MessageInfo, 'deleted'> & { deleted: number }) | undefined;
  return r ? { ...r, deleted: !!r.deleted } : undefined;
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
  db.prepare('DELETE FROM reactions WHERE messageId NOT IN (SELECT id FROM messages)').run();
}

// --- Reactions ---------------------------------------------------------------------

/** Who reacted with what, for a set of messages. */
export function reactionsFor(ids: string[]): Map<string, Record<string, string[]>> {
  const out = new Map<string, Record<string, string[]>>();
  if (ids.length === 0) return out;
  const rows = db
    .prepare(`SELECT messageId, emoji, account FROM reactions WHERE messageId IN (${ids.map(() => '?').join(',')}) ORDER BY rowid`)
    .all(...ids) as { messageId: string; emoji: string; account: string }[];
  for (const r of rows) {
    const m = out.get(r.messageId) ?? {};
    (m[r.emoji] ??= []).push(r.account);
    out.set(r.messageId, m);
  }
  return out;
}

/** Add the reaction, or remove it if this person already made it. Returns the message's reactions. */
export function toggleReaction(messageId: string, account: string, emoji: string): Record<string, string[]> {
  const l = account.toLowerCase();
  const had = db.prepare('DELETE FROM reactions WHERE messageId = ? AND accountLower = ? AND emoji = ?').run(messageId, l, emoji);
  if (Number(had.changes) === 0) {
    db.prepare('INSERT INTO reactions (messageId, accountLower, account, emoji) VALUES (?, ?, ?, ?)').run(messageId, l, account, emoji);
  }
  return reactionsFor([messageId]).get(messageId) ?? {};
}

export function countReactionKinds(messageId: string): number {
  return (db.prepare('SELECT COUNT(DISTINCT emoji) AS n FROM reactions WHERE messageId = ?').get(messageId) as { n: number }).n;
}

// --- Reports ----------------------------------------------------------------------------

type RawReport = Omit<AdminReport, 'status'> & { status: string };

/** File a report. Returns false if this person already reported this message. */
export function addReport(
  reporter: string,
  msg: { id: string; room: string; fromName: string; text: string; image: string | null },
  reason: string | null,
): boolean {
  try {
    db.prepare(
      `INSERT INTO reports (ts, reporter, reporterLower, room, messageId, author, text, image, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(now(), reporter, reporter.toLowerCase(), msg.room, msg.id, msg.fromName, msg.text, msg.image, reason);
    return true;
  } catch {
    return false; // UNIQUE (reporter, message)
  }
}

export function listReports(status: 'open' | 'all', limit: number): AdminReport[] {
  const rows = (
    status === 'open'
      ? db.prepare("SELECT * FROM reports WHERE status = 'open' ORDER BY id DESC LIMIT ?").all(limit)
      : db.prepare('SELECT * FROM reports ORDER BY id DESC LIMIT ?').all(limit)
  ) as unknown as RawReport[];
  return rows.map((r) => ({ ...r, status: r.status === 'open' ? 'open' : 'resolved' }));
}

export function getReport(id: number): AdminReport | undefined {
  const r = db.prepare('SELECT * FROM reports WHERE id = ?').get(id) as unknown as RawReport | undefined;
  return r ? { ...r, status: r.status === 'open' ? 'open' : 'resolved' } : undefined;
}

export function resolveReport(id: number, by: string, resolution: string): void {
  db.prepare("UPDATE reports SET status = 'resolved', resolvedBy = ?, resolvedAt = ?, resolution = ? WHERE id = ?")
    .run(by, now(), resolution, id);
}

export function openReportCount(): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'").get() as { n: number }).n;
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

// --- Friends ----------------------------------------------------------------------------

export function areFriends(a: string, b: string): boolean {
  return !!db.prepare('SELECT 1 FROM friends WHERE accountLower = ? AND friendLower = ?').get(a, b);
}
export function friendsOf(accountLower: string): string[] {
  return (db.prepare('SELECT friendLower FROM friends WHERE accountLower = ?').all(accountLower) as { friendLower: string }[]).map(
    (r) => r.friendLower,
  );
}
export function addFriendship(a: string, b: string): void {
  const ins = db.prepare('INSERT OR IGNORE INTO friends (accountLower, friendLower) VALUES (?, ?)');
  ins.run(a, b);
  ins.run(b, a);
}
export function removeFriendship(a: string, b: string): boolean {
  const d = db.prepare('DELETE FROM friends WHERE accountLower = ? AND friendLower = ?');
  const n = Number(d.run(a, b).changes) + Number(d.run(b, a).changes);
  return n > 0;
}

export function hasRequest(fromLower: string, toLower: string): boolean {
  return !!db.prepare('SELECT 1 FROM friend_requests WHERE fromLower = ? AND toLower = ?').get(fromLower, toLower);
}
export function addRequest(from: string, to: string): void {
  db.prepare('INSERT OR IGNORE INTO friend_requests (fromLower, fromName, toLower, toName, ts) VALUES (?, ?, ?, ?, ?)')
    .run(from.toLowerCase(), from, to.toLowerCase(), to, now());
}
export function removeRequest(fromLower: string, toLower: string): boolean {
  return Number(db.prepare('DELETE FROM friend_requests WHERE fromLower = ? AND toLower = ?').run(fromLower, toLower).changes) > 0;
}
export function incomingRequests(toLower: string): string[] {
  return (db.prepare('SELECT fromName FROM friend_requests WHERE toLower = ? ORDER BY ts').all(toLower) as { fromName: string }[]).map(
    (r) => r.fromName,
  );
}
export function outgoingRequests(fromLower: string): string[] {
  return (db.prepare('SELECT toName FROM friend_requests WHERE fromLower = ? ORDER BY ts').all(fromLower) as { toName: string }[]).map(
    (r) => r.toName,
  );
}

// --- Uploads --------------------------------------------------------------------------------

export function addUpload(name: string, ownerLower: string, size: number): void {
  db.prepare('INSERT INTO uploads (name, ownerLower, ts, size) VALUES (?, ?, ?, ?)').run(name, ownerLower, now(), size);
}
export function uploadOwner(name: string): string | null {
  const r = db.prepare('SELECT ownerLower FROM uploads WHERE name = ?').get(name) as { ownerLower: string } | undefined;
  return r ? r.ownerLower : null;
}
export function countUploadsSince(ownerLower: string, since: number): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM uploads WHERE ownerLower = ? AND ts > ?').get(ownerLower, since) as { n: number }).n;
}

// --- Cleanup when an account is deleted -------------------------------------------------

/** Remove everything tied to an account. Returns the upload file names, so the caller can delete the files. */
export function purgeAccount(account: string): string[] {
  const l = account.toLowerCase();
  db.prepare('DELETE FROM dms WHERE fromLower = ? OR toLower = ?').run(l, l);
  db.prepare('DELETE FROM dm_state WHERE accountLower = ? OR partnerLower = ?').run(l, l);
  db.prepare('DELETE FROM blocks WHERE accountLower = ? OR blockedLower = ?').run(l, l);
  db.prepare('DELETE FROM room_mods WHERE accountLower = ?').run(l);
  db.prepare('DELETE FROM room_bans WHERE accountLower = ?').run(l);
  db.prepare('DELETE FROM room_mutes WHERE accountLower = ?').run(l);
  db.prepare('DELETE FROM friends WHERE accountLower = ? OR friendLower = ?').run(l, l);
  db.prepare('DELETE FROM friend_requests WHERE fromLower = ? OR toLower = ?').run(l, l);
  db.prepare('DELETE FROM reactions WHERE accountLower = ?').run(l);
  db.prepare('UPDATE rooms SET owner = NULL WHERE lower(owner) = ?').run(l);
  const files = (db.prepare('SELECT name FROM uploads WHERE ownerLower = ?').all(l) as { name: string }[]).map((r) => r.name);
  db.prepare('DELETE FROM uploads WHERE ownerLower = ?').run(l);
  return files;
}
