/**
 * QWords on the server: the dictionary, the bag of tiles, whose turn it is, and saving each game so it carries on
 * across days and restarts. The rules of a single move (is it laid out properly, and what does it score) are in the
 * shared package; this file adds the dictionary, the tiles and the turns.
 */
import { randomBytes, randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  RACK_SIZE,
  TILE_COUNTS,
  emptyBoard,
  evaluatePlay,
  rackValue,
  type Board,
  type Placement,
  type WordGameMove,
  type WordGameStatus,
  type WordGameSummary,
  type WordGameView,
} from '@qchat/shared';
import { db } from './db.js';

// --- The dictionary --------------------------------------------------------------------

/** A few everyday words the old public domain list does not have. */
const EXTRA_WORDS = ['qi', 'za', 'ze', 'ew', 'zen', 'emoji', 'selfie', 'podcast', 'blog', 'email', 'online', 'website', 'wifi', 'texting', 'hashtag'];

let dictionary: Set<string> | null = null;
function words(): Set<string> {
  if (!dictionary) {
    const text = gunzipSync(readFileSync(new URL('../words/enable1.txt.gz', import.meta.url))).toString('latin1');
    dictionary = new Set(text.split(/\r?\n/).filter(Boolean));
    for (const w of EXTRA_WORDS) dictionary.add(w);
  }
  return dictionary;
}
export const isWord = (w: string): boolean => words().has(w.toLowerCase());

// --- Game state -----------------------------------------------------------------------------

interface Player {
  name: string;
  /** Lower case account name. */
  key: string;
  rack: string[];
  score: number;
  out?: boolean;
}

export interface GameState {
  id: string;
  room: string;
  status: WordGameStatus;
  creator: string;
  maxPlayers: number;
  players: Player[];
  board: Board;
  bag: string[];
  turn: number;
  moves: WordGameMove[];
  /** Turns in a row with no tiles played (an end after everyone has passed twice). */
  scoreless: number;
  lastPlay: [number, number][];
  winner?: string;
  endedBy?: string;
  createdAt: number;
  updatedAt: number;
}

const MAX_MOVES_KEPT = 60;

function freshBag(): string[] {
  const tiles: string[] = [];
  for (const [letter, n] of Object.entries(TILE_COUNTS)) for (let i = 0; i < n; i++) tiles.push(letter);
  return shuffle(tiles);
}

function shuffle<T>(list: T[]): T[] {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// --- Saving ---------------------------------------------------------------------------------

export function saveGame(g: GameState): void {
  g.updatedAt = Date.now();
  db.prepare(
    `INSERT INTO word_games (id, room, status, creator, updatedAt, state) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET status = excluded.status, creator = excluded.creator, updatedAt = excluded.updatedAt, state = excluded.state`,
  ).run(g.id, g.room, g.status, g.creator, g.updatedAt, JSON.stringify(g));
}

export function loadGame(id: string): GameState | null {
  const row = db.prepare('SELECT state FROM word_games WHERE id = ?').get(id) as { state: string } | undefined;
  return row ? (JSON.parse(row.state) as GameState) : null;
}

export function deleteGame(id: string): void {
  db.prepare('DELETE FROM word_games WHERE id = ?').run(id);
}

function gamesWhere(sql: string, ...args: (string | number)[]): GameState[] {
  return (db.prepare(`SELECT state FROM word_games ${sql}`).all(...args) as { state: string }[]).map((r) => JSON.parse(r.state) as GameState);
}

/** Games a member is in that are not over. */
export function activeGamesOf(accountLower: string): GameState[] {
  return gamesWhere("WHERE status != 'finished'").filter((g) => g.players.some((p) => p.key === accountLower && !p.out));
}

export const roomGames = (room: string): GameState[] => gamesWhere('WHERE room = ? ORDER BY updatedAt DESC LIMIT 30', room);

export function summary(g: GameState): WordGameSummary {
  return {
    id: g.id,
    room: g.room,
    status: g.status,
    creator: g.creator,
    maxPlayers: g.maxPlayers,
    players: g.players.map((p) => ({ name: p.name, score: p.score })),
    turn: g.status === 'playing' ? (g.players[g.turn]?.name ?? null) : null,
    updatedAt: g.updatedAt,
  };
}

/** The game as one member sees it: everything except other players' tiles and the contents of the bag. */
export function viewFor(g: GameState, accountLower: string): WordGameView {
  const me = g.players.find((p) => p.key === accountLower);
  return {
    id: g.id,
    room: g.room,
    status: g.status,
    creator: g.creator,
    maxPlayers: g.maxPlayers,
    players: g.players.map((p) => ({ name: p.name, score: p.score, tiles: p.rack.length, ...(p.out ? { out: true as const } : {}) })),
    board: g.board,
    turn: g.turn,
    bag: g.bag.length,
    rack: me ? me.rack : [],
    lastPlay: g.lastPlay,
    moves: g.moves,
    ...(g.winner ? { winner: g.winner } : {}),
    ...(g.endedBy ? { endedBy: g.endedBy } : {}),
    updatedAt: g.updatedAt,
  };
}

// --- Before the game starts ------------------------------------------------------------------

export type Result<T = void> = { ok: true; value: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export function createGame(room: string, creator: string, maxPlayers: number): Result<GameState> {
  const n = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, Math.floor(maxPlayers) || MIN_PLAYERS));
  const g: GameState = {
    id: randomBytes(5).toString('hex'),
    room,
    status: 'waiting',
    creator,
    maxPlayers: n,
    players: [{ name: creator, key: creator.toLowerCase(), rack: [], score: 0 }],
    board: emptyBoard(),
    bag: [],
    turn: 0,
    moves: [],
    scoreless: 0,
    lastPlay: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  saveGame(g);
  return { ok: true, value: g };
}

export function joinGame(g: GameState, name: string): Result {
  if (g.status !== 'waiting') return fail('That game has already started.');
  if (g.players.some((p) => p.key === name.toLowerCase())) return fail('You are already in that game.');
  if (g.players.length >= g.maxPlayers) return fail('That game is full.');
  g.players.push({ name, key: name.toLowerCase(), rack: [], score: 0 });
  saveGame(g);
  return { ok: true, value: undefined };
}

/** Leave a game that has not started. Returns true when the game is gone (nobody left). */
export function leaveWaiting(g: GameState, accountLower: string): boolean {
  g.players = g.players.filter((p) => p.key !== accountLower);
  if (g.players.length === 0) {
    deleteGame(g.id);
    return true;
  }
  if (g.creator.toLowerCase() === accountLower) g.creator = g.players[0].name;
  saveGame(g);
  return false;
}

export function startGame(g: GameState, by: string): Result {
  if (g.status !== 'waiting') return fail('That game has already started.');
  if (g.creator.toLowerCase() !== by.toLowerCase()) return fail('Only the person who made the game can start it.');
  if (g.players.length < MIN_PLAYERS) return fail('You need at least two players.');
  g.bag = freshBag();
  for (const p of g.players) p.rack = g.bag.splice(0, RACK_SIZE);
  g.players = shuffle(g.players); // random order
  g.turn = 0;
  g.status = 'playing';
  g.scoreless = 0;
  saveGame(g);
  return { ok: true, value: undefined };
}

// --- Taking turns ---------------------------------------------------------------------------

const live = (g: GameState): Player[] => g.players.filter((p) => !p.out);

function nextTurn(g: GameState): void {
  for (let i = 1; i <= g.players.length; i++) {
    const idx = (g.turn + i) % g.players.length;
    if (!g.players[idx].out) {
      g.turn = idx;
      return;
    }
  }
}

function record(g: GameState, move: Omit<WordGameMove, 'at'>): void {
  g.moves.push({ ...move, at: Date.now() });
  if (g.moves.length > MAX_MOVES_KEPT) g.moves.splice(0, g.moves.length - MAX_MOVES_KEPT);
}

function finish(g: GameState, endedBy: string, emptied?: Player): void {
  // Tiles left in a rack count against that player. Whoever used up their tiles gets the total.
  let bonus = 0;
  for (const p of g.players) {
    const left = rackValue(p.rack);
    if (p === emptied) continue;
    p.score -= left;
    bonus += left;
  }
  if (emptied) emptied.score += bonus;
  const still = g.players.filter((p) => !p.out);
  const best = Math.max(...still.map((p) => p.score));
  const winners = still.filter((p) => p.score === best);
  g.winner = winners.length === 1 ? winners[0].name : winners.map((p) => p.name).join(' and ');
  g.status = 'finished';
  g.endedBy = endedBy;
}

function mustBeTheirTurn(g: GameState, accountLower: string): Result<Player> {
  if (g.status !== 'playing') return fail('That game is not being played.');
  const p = g.players[g.turn];
  if (!p || p.key !== accountLower) return fail('It is not your turn.');
  return { ok: true, value: p };
}

/** Take the letters a move uses out of a rack (a blank for each blank tile). Null if the rack lacks them. */
function takeFromRack(rack: string[], placements: Placement[]): string[] | null {
  const left = rack.slice();
  for (const p of placements) {
    const want = p.blank ? '?' : p.letter;
    const i = left.indexOf(want);
    if (i < 0) return null;
    left.splice(i, 1);
  }
  return left;
}

export function playTiles(g: GameState, accountLower: string, placements: Placement[]): Result<{ score: number; words: string[] }> {
  const turn = mustBeTheirTurn(g, accountLower);
  if (!turn.ok) return turn;
  const me = turn.value;
  const clean: Placement[] = placements.map((p) => ({ r: Number(p.r), c: Number(p.c), letter: String(p.letter).toUpperCase(), ...(p.blank ? { blank: true } : {}) }));
  const rest = takeFromRack(me.rack, clean);
  if (!rest) return fail('You do not have those tiles.');
  const result = evaluatePlay(g.board, clean);
  if (!result.ok) return fail(result.error);
  for (const w of result.words) {
    if (!isWord(w.word)) return fail(`"${w.word}" is not in the word list.`);
  }
  for (const p of clean) g.board[p.r][p.c] = p.blank ? { letter: p.letter, blank: true } : { letter: p.letter };
  me.rack = rest;
  me.score += result.total;
  // Draw back up to seven.
  const draw = Math.min(g.bag.length, RACK_SIZE - me.rack.length);
  me.rack.push(...g.bag.splice(0, draw));
  g.lastPlay = clean.map((p) => [p.r, p.c]);
  g.scoreless = 0;
  record(g, { by: me.name, kind: 'play', words: result.words, score: result.total, ...(result.bingo ? { bingo: true } : {}) });
  if (me.rack.length === 0 && g.bag.length === 0) finish(g, `${me.name} used all their tiles`, me);
  else nextTurn(g);
  saveGame(g);
  return { ok: true, value: { score: result.total, words: result.words.map((w) => w.word) } };
}

export function passTurn(g: GameState, accountLower: string): Result {
  const turn = mustBeTheirTurn(g, accountLower);
  if (!turn.ok) return turn;
  record(g, { by: turn.value.name, kind: 'pass' });
  g.lastPlay = [];
  g.scoreless++;
  if (g.scoreless >= live(g).length * 2) finish(g, 'everyone passed twice');
  else nextTurn(g);
  saveGame(g);
  return { ok: true, value: undefined };
}

export function exchangeTiles(g: GameState, accountLower: string, letters: string[]): Result {
  const turn = mustBeTheirTurn(g, accountLower);
  if (!turn.ok) return turn;
  const me = turn.value;
  if (g.bag.length < RACK_SIZE) return fail('There are fewer than 7 tiles left in the bag, so you cannot swap.');
  const give = letters.map((l) => String(l).toUpperCase());
  if (give.length === 0) return fail('Choose the tiles to swap.');
  const left = me.rack.slice();
  for (const l of give) {
    const i = left.indexOf(l);
    if (i < 0) return fail('You do not have those tiles.');
    left.splice(i, 1);
  }
  const drawn = g.bag.splice(0, give.length);
  me.rack = [...left, ...drawn];
  g.bag = shuffle([...g.bag, ...give]);
  record(g, { by: me.name, kind: 'exchange', swapped: give.length });
  g.lastPlay = [];
  g.scoreless++;
  if (g.scoreless >= live(g).length * 2) finish(g, 'everyone passed twice');
  else nextTurn(g);
  saveGame(g);
  return { ok: true, value: undefined };
}

export function resign(g: GameState, accountLower: string): Result {
  if (g.status !== 'playing') return fail('That game is not being played.');
  const idx = g.players.findIndex((p) => p.key === accountLower && !p.out);
  if (idx < 0) return fail('You are not in that game.');
  const p = g.players[idx];
  p.out = true;
  g.bag = shuffle([...g.bag, ...p.rack]);
  p.rack = [];
  record(g, { by: p.name, kind: 'resign' });
  g.lastPlay = [];
  const remaining = live(g);
  if (remaining.length <= 1) {
    g.winner = remaining[0]?.name;
    g.status = 'finished';
    g.endedBy = `${p.name} resigned`;
  } else if (idx === g.turn) {
    g.turn = (idx - 1 + g.players.length) % g.players.length;
    nextTurn(g);
  }
  saveGame(g);
  return { ok: true, value: undefined };
}

// --- Housekeeping ---------------------------------------------------------------------------

const DAY = 24 * 3600 * 1000;

/** Waiting games nobody started, abandoned games, and old finished ones. Returns the games it ended or removed. */
export function sweepGames(now = Date.now()): { removed: GameState[]; ended: GameState[] } {
  const removed: GameState[] = [];
  const ended: GameState[] = [];
  for (const g of gamesWhere('')) {
    const idle = now - g.updatedAt;
    if (g.status === 'waiting' && idle > 2 * DAY) {
      deleteGame(g.id);
      removed.push(g);
    } else if (g.status === 'finished' && idle > 2 * DAY) {
      deleteGame(g.id);
      removed.push(g);
    } else if (g.status === 'playing' && idle > 14 * DAY) {
      finish(g, 'nobody moved for two weeks');
      saveGame(g);
      ended.push(g);
    }
  }
  return { removed, ended };
}

/** A member is leaving for good: they resign from every game, and games not started lose them. */
export function forgetAccount(accountLower: string): void {
  for (const g of gamesWhere('')) {
    if (!g.players.some((p) => p.key === accountLower)) continue;
    if (g.status === 'waiting') leaveWaiting(g, accountLower);
    else if (g.status === 'playing') resign(g, accountLower);
  }
}

/** Everything about a member's games, for their data export. */
export function exportGames(accountLower: string): { room: string; status: string; score: number; opponents: string[]; updatedAt: number }[] {
  return gamesWhere('')
    .filter((g) => g.players.some((p) => p.key === accountLower))
    .map((g) => ({
      room: g.room,
      status: g.status,
      score: g.players.find((p) => p.key === accountLower)?.score ?? 0,
      opponents: g.players.filter((p) => p.key !== accountLower).map((p) => p.name),
      updatedAt: g.updatedAt,
    }));
}

