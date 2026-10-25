import { BOT_NAME_RE, MAX_BOT_DESCRIPTION, normalizeRoom, validRoom, type AdminBot, type BotInfo } from '@qchat/shared';
import { db } from './db.js';

/** The generic bot every room has. */
export const QBOT = 'QBot';

interface BotRow {
  nameLower: string;
  name: string;
  description: string;
  emoji: string;
  builtin: number;
  enabled: number;
  allRooms: number;
  createdBy: string | null;
  createdAt: number;
}

/** Make sure QBot exists. Call once at startup. */
export function ensureBuiltInBots(): void {
  // The first time this runs on a site that already has members, they all count as welcomed,
  // so only people who join after this are greeted.
  if (!db.prepare("SELECT 1 FROM settings WHERE key = 'qbotGreetSeeded'").get()) {
    db.prepare('INSERT OR IGNORE INTO bot_greeted (accountLower, ts) SELECT accountLower, ? FROM accounts').run(Date.now());
    db.prepare("INSERT INTO settings (key, value) VALUES ('qbotGreetSeeded', 'true')").run();
  }
  db.prepare(
    `INSERT OR IGNORE INTO bots (nameLower, name, description, emoji, builtin, enabled, allRooms, createdAt)
     VALUES (?, ?, ?, ?, 1, 1, 1, ?)`,
  ).run(QBOT.toLowerCase(), QBOT, 'The QChat helper. Every room has one.', '🤖', Date.now());
}

const roomsOf = (lower: string): string[] =>
  (db.prepare('SELECT room FROM bot_rooms WHERE botLower = ? ORDER BY room').all(lower) as { room: string }[]).map((r) => r.room);

const toAdmin = (r: BotRow): AdminBot => ({
  name: r.name,
  description: r.description,
  emoji: r.emoji,
  builtin: !!r.builtin,
  enabled: !!r.enabled,
  allRooms: !!r.allRooms,
  rooms: roomsOf(r.nameLower),
  createdBy: r.createdBy,
  createdAt: r.createdAt,
});

export function listBots(): AdminBot[] {
  const rows = db.prepare('SELECT * FROM bots ORDER BY builtin DESC, nameLower').all() as unknown as BotRow[];
  return rows.map(toAdmin);
}

export function getBot(name: string): AdminBot | null {
  const r = db.prepare('SELECT * FROM bots WHERE nameLower = ?').get(name.trim().toLowerCase()) as BotRow | undefined;
  return r ? toAdmin(r) : null;
}

/** True when a bot has this name (used to keep account names and bot names apart). */
export function botNameTaken(name: string): boolean {
  return !!db.prepare('SELECT 1 FROM bots WHERE nameLower = ?').get(name.trim().toLowerCase());
}

/**
 * TriviaBot, the second bot, lives in the trivia room. It is added once; after that it is an ordinary
 * bot an administrator can move to other rooms, switch off or delete, and it stays gone if deleted.
 */
export function ensureTriviaBot(): void {
  if (db.prepare("SELECT 1 FROM settings WHERE key = 'triviaBotSeeded'").get()) return;
  db.prepare(
    `INSERT OR IGNORE INTO bots (nameLower, name, description, emoji, builtin, enabled, allRooms, createdBy, createdAt)
     VALUES ('triviabot', 'TriviaBot', 'Runs trivia games. Type !trivia in a room it is in to play, or !triviahelp for the rules.', '🧠', 0, 1, 0, 'system', ?)`,
  ).run(Date.now());
  db.prepare("INSERT OR IGNORE INTO bot_rooms (botLower, room) VALUES ('triviabot', '#trivia')").run();
  db.prepare("INSERT INTO settings (key, value) VALUES ('triviaBotSeeded', 'true')").run();
}

/** WeatherBot answers !weather and !forecast. Added once, like TriviaBot; afterwards an administrator runs it. */
export const WEATHER_BOT = 'WeatherBot';
export function ensureWeatherBot(): void {
  if (db.prepare("SELECT 1 FROM settings WHERE key = 'weatherBotSeeded'").get()) return;
  db.prepare(
    `INSERT OR IGNORE INTO bots (nameLower, name, description, emoji, builtin, enabled, allRooms, createdBy, createdAt)
     VALUES ('weatherbot', 'WeatherBot', 'Tells you the weather. Try !weather London or !forecast Paris. Weather data by Open-Meteo.com.', '⛅', 0, 1, 0, 'system', ?)`,
  ).run(Date.now());
  for (const room of ['#lobby', '#general']) {
    db.prepare("INSERT OR IGNORE INTO bot_rooms (botLower, room) VALUES ('weatherbot', ?)").run(room);
  }
  db.prepare("INSERT INTO settings (key, value) VALUES ('weatherBotSeeded', 'true')").run();
}

/** True the first time it is called for a member (and never again): they have not been welcomed yet. */
export function claimGreeting(account: string): boolean {
  const r = db.prepare('INSERT OR IGNORE INTO bot_greeted (accountLower, ts) VALUES (?, ?)').run(account.toLowerCase(), Date.now());
  return Number(r.changes) > 0;
}

/** The bots that are in a room right now. */
export function botsInRoom(room: string): BotInfo[] {
  const rows = db
    .prepare(
      `SELECT b.* FROM bots b
       WHERE b.enabled = 1
         AND (b.allRooms = 1 OR EXISTS (SELECT 1 FROM bot_rooms r WHERE r.botLower = b.nameLower AND r.room = ?))
       ORDER BY b.builtin DESC, b.nameLower`,
    )
    .all(room) as unknown as BotRow[];
  return rows.map((r) => ({ name: r.name, description: r.description, emoji: r.emoji, builtin: !!r.builtin }));
}

export function botInRoom(name: string, room: string): BotInfo | null {
  return botsInRoom(room).find((b) => b.name.toLowerCase() === name.trim().toLowerCase()) ?? null;
}

export interface BotInput {
  name?: string;
  description?: string;
  emoji?: string;
  enabled?: boolean;
  allRooms?: boolean;
  rooms?: string[];
}

export type BotResult = { ok: true; bot: AdminBot } | { ok: false; error: string; status: number };

const cleanEmoji = (s: string) => Array.from(s.trim()).slice(0, 2).join('') || '🤖';

function cleanRooms(rooms: string[] | undefined): string[] | null {
  if (!rooms) return null;
  const out = new Set<string>();
  for (const r of rooms) {
    const n = normalizeRoom(String(r));
    if (validRoom(n)) out.add(n);
  }
  return [...out];
}

export function createBot(input: BotInput, by: string): BotResult {
  const name = (input.name ?? '').trim();
  if (!BOT_NAME_RE.test(name)) {
    return { ok: false, status: 422, error: 'A bot name starts with a letter and can use letters, numbers, _ and - (2 to 24 characters).' };
  }
  const lower = name.toLowerCase();
  if (botNameTaken(name)) return { ok: false, status: 409, error: 'There is already a bot with that name.' };
  if (db.prepare('SELECT 1 FROM accounts WHERE accountLower = ?').get(lower)) {
    return { ok: false, status: 409, error: 'A member already has that name.' };
  }
  const allRooms = input.allRooms !== false;
  db.prepare(
    `INSERT INTO bots (nameLower, name, description, emoji, builtin, enabled, allRooms, createdBy, createdAt)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`,
  ).run(
    lower,
    name,
    (input.description ?? '').trim().slice(0, MAX_BOT_DESCRIPTION),
    cleanEmoji(input.emoji ?? ''),
    input.enabled === false ? 0 : 1,
    allRooms ? 1 : 0,
    by,
    Date.now(),
  );
  setRooms(lower, cleanRooms(input.rooms) ?? []);
  return { ok: true, bot: getBot(name)! };
}

function setRooms(lower: string, rooms: string[]): void {
  db.prepare('DELETE FROM bot_rooms WHERE botLower = ?').run(lower);
  const ins = db.prepare('INSERT INTO bot_rooms (botLower, room) VALUES (?, ?)');
  for (const r of rooms) ins.run(lower, r);
}

export function updateBot(name: string, input: BotInput): BotResult {
  const cur = getBot(name);
  if (!cur) return { ok: false, status: 404, error: 'There is no such bot.' };
  const lower = cur.name.toLowerCase();
  // The built-in bot always stays on and in every room; only its look can change.
  const enabled = cur.builtin ? true : input.enabled ?? cur.enabled;
  const allRooms = cur.builtin ? true : input.allRooms ?? cur.allRooms;
  db.prepare('UPDATE bots SET description = ?, emoji = ?, enabled = ?, allRooms = ? WHERE nameLower = ?').run(
    input.description === undefined ? cur.description : input.description.trim().slice(0, MAX_BOT_DESCRIPTION),
    input.emoji === undefined ? cur.emoji : cleanEmoji(input.emoji),
    enabled ? 1 : 0,
    allRooms ? 1 : 0,
    lower,
  );
  const rooms = cleanRooms(input.rooms);
  if (rooms && !cur.builtin) setRooms(lower, rooms);
  return { ok: true, bot: getBot(cur.name)! };
}

export function deleteBot(name: string): BotResult {
  const cur = getBot(name);
  if (!cur) return { ok: false, status: 404, error: 'There is no such bot.' };
  if (cur.builtin) return { ok: false, status: 409, error: 'QBot is built in and cannot be deleted.' };
  const lower = cur.name.toLowerCase();
  db.prepare('DELETE FROM bot_rooms WHERE botLower = ?').run(lower);
  db.prepare('DELETE FROM bots WHERE nameLower = ?').run(lower);
  return { ok: true, bot: cur };
}
