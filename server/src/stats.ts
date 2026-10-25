/**
 * Daily numbers for the admin charts. Messages, private messages and the busiest moment are counted as they
 * happen; "active members" is who connected that day; new members are read straight from the accounts table.
 * Days are UTC days.
 */
import type { DayStat } from '@qchat/shared';
import { db } from './db.js';

const DAY_MS = 24 * 3600 * 1000;
const dayOf = (t = Date.now()): string => new Date(t).toISOString().slice(0, 10);

export function bump(column: 'messages' | 'dms'): void {
  db.prepare(
    `INSERT INTO stats_daily (day, ${column}) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET ${column} = ${column} + 1`,
  ).run(dayOf());
}

/** Remember the most people online at once today. */
export function notePeak(online: number): void {
  db.prepare(
    'INSERT INTO stats_daily (day, peakOnline) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET peakOnline = MAX(peakOnline, excluded.peakOnline)',
  ).run(dayOf(), online);
}

export function noteActive(accountLower: string): void {
  db.prepare('INSERT OR IGNORE INTO activity (day, accountLower) VALUES (?, ?)').run(dayOf(), accountLower);
}

/** One entry per day for the last `days` days, oldest first, with zeros where nothing happened. */
export function chart(days: number): DayStat[] {
  const n = Math.max(1, Math.min(365, Math.floor(days)));
  const first = dayOf(Date.now() - (n - 1) * DAY_MS);
  const rows = new Map<string, DayStat>();
  for (let i = n - 1; i >= 0; i--) {
    const day = dayOf(Date.now() - i * DAY_MS);
    rows.set(day, { day, messages: 0, dms: 0, signups: 0, active: 0, peakOnline: 0 });
  }
  const daily = db.prepare('SELECT day, messages, dms, peakOnline FROM stats_daily WHERE day >= ?').all(first) as unknown as DayStat[];
  for (const r of daily) {
    const row = rows.get(r.day);
    if (row) Object.assign(row, { messages: r.messages, dms: r.dms, peakOnline: r.peakOnline });
  }
  const active = db.prepare('SELECT day, COUNT(*) AS n FROM activity WHERE day >= ? GROUP BY day').all(first) as unknown as { day: string; n: number }[];
  for (const r of active) {
    const row = rows.get(r.day);
    if (row) row.active = r.n;
  }
  const signups = db
    .prepare("SELECT strftime('%Y-%m-%d', createdAt / 1000, 'unixepoch') AS day, COUNT(*) AS n FROM accounts WHERE createdAt >= ? GROUP BY day")
    .all(Date.parse(first + 'T00:00:00Z')) as unknown as { day: string; n: number }[];
  for (const r of signups) {
    const row = rows.get(r.day);
    if (row) row.signups = r.n;
  }
  return [...rows.values()];
}

/** Drop old detail so these tables stay small. */
export function prune(): void {
  db.prepare('DELETE FROM activity WHERE day < ?').run(dayOf(Date.now() - 120 * DAY_MS));
  db.prepare('DELETE FROM stats_daily WHERE day < ?').run(dayOf(Date.now() - 800 * DAY_MS));
}
