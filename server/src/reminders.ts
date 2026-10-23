import { db } from './db.js';

/** QBot's reminders. They are saved, so a restart does not lose them. */

const seconds = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
/** The shortest reminder, in seconds. Settable so tests can run fast. */
export const MIN_REMIND_S = seconds('QBOT_REMIND_MIN_SECONDS', 10);
export const MAX_REMIND_MS = 7 * 24 * 3600 * 1000;
export const MAX_PENDING = 5;
export const MAX_REMIND_TEXT = 120;
/** A reminder for someone who never comes back is dropped this long after it was due. */
export const STALE_MS = 24 * 3600 * 1000;

export interface Reminder {
  id: number;
  account: string;
  nick: string;
  room: string;
  dueAt: number;
  text: string;
}

/** "10m", "1h30m", "45s", "2d" to milliseconds, or null if it is not a duration. */
export function parseDuration(s: string): number | null {
  const m = s.trim().toLowerCase().match(/^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!m || !m[0]) return null;
  const [, d, h, mi, sec] = m;
  const ms = (Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(mi ?? 0) * 60 + Number(sec ?? 0)) * 1000;
  return ms > 0 ? ms : null;
}

export function formatDuration(ms: number): string {
  let s = Math.round(ms / 1000);
  const parts: string[] = [];
  for (const [unit, size] of [['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]] as const) {
    const n = Math.floor(s / size);
    if (n > 0) parts.push(`${n} ${unit}${n === 1 ? '' : 's'}`);
    s -= n * size;
  }
  return parts.slice(0, 2).join(' ') || '0 seconds';
}

export type Added = { ok: true; id: number } | { ok: false; error: string };

export function addReminder(account: string, nick: string, room: string, dueAt: number, text: string): Added {
  const lower = account.toLowerCase();
  const n = (db.prepare('SELECT COUNT(*) AS n FROM reminders WHERE accountLower = ?').get(lower) as { n: number }).n;
  if (n >= MAX_PENDING) return { ok: false, error: `You already have ${MAX_PENDING} reminders waiting. Use !reminders to see them, or !reminders clear.` };
  const r = db
    .prepare('INSERT INTO reminders (accountLower, nick, room, dueAt, text, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
    .run(lower, nick, room, dueAt, text, Date.now());
  return { ok: true, id: Number(r.lastInsertRowid) };
}

export function listReminders(account: string): Reminder[] {
  return db
    .prepare('SELECT id, accountLower AS account, nick, room, dueAt, text FROM reminders WHERE accountLower = ? ORDER BY dueAt')
    .all(account.toLowerCase()) as unknown as Reminder[];
}

export function clearReminders(account: string): number {
  return Number(db.prepare('DELETE FROM reminders WHERE accountLower = ?').run(account.toLowerCase()).changes);
}

export function dueReminders(now = Date.now(), limit = 25): Reminder[] {
  return db
    .prepare('SELECT id, accountLower AS account, nick, room, dueAt, text FROM reminders WHERE dueAt <= ? ORDER BY dueAt LIMIT ?')
    .all(now, limit) as unknown as Reminder[];
}

export function deleteReminder(id: number): void {
  db.prepare('DELETE FROM reminders WHERE id = ?').run(id);
}

export function dropStaleReminders(now = Date.now()): number {
  return Number(db.prepare('DELETE FROM reminders WHERE dueAt < ?').run(now - STALE_MS).changes);
}
