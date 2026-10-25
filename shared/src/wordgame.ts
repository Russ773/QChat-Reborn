/**
 * QWords: a word game for two to four players, in the style of the classic board game. This file holds the rules
 * (the board, the tiles, and how a move is checked and scored) so the server and the browser agree exactly.
 * Whether a word is in the dictionary is the server's job; it is the only thing not decided here.
 */

export const BOARD = 15;
export const CENTER = 7;
export const RACK_SIZE = 7;
export const BINGO_BONUS = 50;

/** What each letter is worth. "?" is a blank tile: it can stand for any letter and is worth nothing. */
export const LETTER_VALUES: Record<string, number> = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8, K: 5, L: 1, M: 3,
  N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1, U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10, '?': 0,
};

/** How many of each tile are in the bag at the start: 100 in all. */
export const TILE_COUNTS: Record<string, number> = {
  A: 9, B: 2, C: 2, D: 4, E: 12, F: 2, G: 3, H: 2, I: 9, J: 1, K: 1, L: 4, M: 2,
  N: 6, O: 8, P: 2, Q: 1, R: 6, S: 4, T: 6, U: 4, V: 2, W: 2, X: 1, Y: 2, Z: 1, '?': 2,
};

export type Premium = 'TW' | 'DW' | 'TL' | 'DL' | null;

const at = (list: [number, number][], kind: Premium, map: Map<string, Premium>) => {
  for (const [r, c] of list) map.set(`${r},${c}`, kind);
};
const PREMIUM = new Map<string, Premium>();
at([[0, 0], [0, 7], [0, 14], [7, 0], [7, 14], [14, 0], [14, 7], [14, 14]], 'TW', PREMIUM);
at(
  [
    [1, 1], [2, 2], [3, 3], [4, 4], [1, 13], [2, 12], [3, 11], [4, 10],
    [13, 1], [12, 2], [11, 3], [10, 4], [13, 13], [12, 12], [11, 11], [10, 10], [7, 7],
  ],
  'DW',
  PREMIUM,
);
at([[1, 5], [1, 9], [5, 1], [5, 5], [5, 9], [5, 13], [9, 1], [9, 5], [9, 9], [9, 13], [13, 5], [13, 9]], 'TL', PREMIUM);
at(
  [
    [0, 3], [0, 11], [2, 6], [2, 8], [3, 0], [3, 7], [3, 14], [6, 2], [6, 6], [6, 8], [6, 12],
    [7, 3], [7, 11], [8, 2], [8, 6], [8, 8], [8, 12], [11, 0], [11, 7], [11, 14], [12, 6], [12, 8], [14, 3], [14, 11],
  ],
  'DL',
  PREMIUM,
);

export const premiumAt = (r: number, c: number): Premium => PREMIUM.get(`${r},${c}`) ?? null;

/** A tile on the board. `blank` means it is a blank tile standing for `letter`. */
export interface Cell {
  letter: string;
  blank?: true;
}
export type Board = (Cell | null)[][];

/** A tile being put down: where, and which letter (for a blank, the letter it stands for). */
export interface Placement {
  r: number;
  c: number;
  letter: string;
  blank?: boolean;
}

export const emptyBoard = (): Board => Array.from({ length: BOARD }, () => Array<Cell | null>(BOARD).fill(null));

export interface ScoredWord {
  word: string;
  score: number;
}

export type PlayResult =
  | { ok: true; words: ScoredWord[]; total: number; bingo: boolean }
  | { ok: false; error: string };

const valueOf = (cell: Cell): number => (cell.blank ? 0 : (LETTER_VALUES[cell.letter] ?? 0));

/** Is the board empty (so the next move is the first)? */
export const boardIsEmpty = (board: Board): boolean => board.every((row) => row.every((cell) => cell === null));

/**
 * Check a move on this board and score it. It does not look at the dictionary. A move must: put one or more tiles
 * on empty squares in a single row or column with no gaps, make every new word at least two letters, touch tiles
 * already on the board (or, for the first move, cover the centre square), and a first move needs two tiles.
 */
export function evaluatePlay(board: Board, placements: Placement[]): PlayResult {
  if (placements.length === 0) return { ok: false, error: 'Put at least one tile on the board.' };
  if (placements.length > RACK_SIZE) return { ok: false, error: 'You can only play up to 7 tiles at a time.' };

  const seen = new Set<string>();
  for (const p of placements) {
    if (!Number.isInteger(p.r) || !Number.isInteger(p.c) || p.r < 0 || p.r >= BOARD || p.c < 0 || p.c >= BOARD) {
      return { ok: false, error: 'A tile is off the board.' };
    }
    if (!/^[A-Z]$/.test(p.letter)) return { ok: false, error: 'Tiles must be letters.' };
    if (board[p.r][p.c]) return { ok: false, error: 'A tile is on top of another tile.' };
    const key = `${p.r},${p.c}`;
    if (seen.has(key)) return { ok: false, error: 'Two tiles are on the same square.' };
    seen.add(key);
  }

  const rows = new Set(placements.map((p) => p.r));
  const cols = new Set(placements.map((p) => p.c));
  if (rows.size > 1 && cols.size > 1) return { ok: false, error: 'Tiles must all be in one row or one column.' };

  // Overlay the new tiles to look at the whole picture.
  const grid: Board = board.map((row) => row.slice());
  for (const p of placements) grid[p.r][p.c] = p.blank ? { letter: p.letter, blank: true } : { letter: p.letter };
  const fresh = (r: number, c: number) => seen.has(`${r},${c}`);

  const first = boardIsEmpty(board);
  if (first) {
    if (!seen.has(`${CENTER},${CENTER}`)) return { ok: false, error: 'The first word must cover the star in the middle.' };
    if (placements.length < 2) return { ok: false, error: 'The first word needs at least two letters.' };
  }

  // The direction of the move: along the row if the tiles share a row (and there are several), else along the column.
  const horizontal = placements.length > 1 ? rows.size === 1 : true;

  /** The whole run of tiles through (r, c), in the given direction. */
  const run = (r: number, c: number, horiz: boolean): { cells: [number, number][]; word: string } => {
    let r0 = r;
    let c0 = c;
    while (horiz ? c0 > 0 && grid[r0][c0 - 1] : r0 > 0 && grid[r0 - 1][c0]) horiz ? c0-- : r0--;
    const cells: [number, number][] = [];
    let word = '';
    let rr = r0;
    let cc = c0;
    while (rr < BOARD && cc < BOARD && grid[rr][cc]) {
      cells.push([rr, cc]);
      word += grid[rr][cc]!.letter;
      horiz ? cc++ : rr++;
    }
    return { cells, word };
  };

  const scoreRun = (cells: [number, number][]): number => {
    let sum = 0;
    let multiplier = 1;
    for (const [r, c] of cells) {
      const cell = grid[r][c]!;
      let v = valueOf(cell);
      if (fresh(r, c)) {
        const prem = premiumAt(r, c);
        if (prem === 'DL') v *= 2;
        else if (prem === 'TL') v *= 3;
        else if (prem === 'DW') multiplier *= 2;
        else if (prem === 'TW') multiplier *= 3;
      }
      sum += v;
    }
    return sum * multiplier;
  };

  // The main word. It must be unbroken: every square between the first and last new tile holds a tile.
  const anchor = placements[0];
  const main = run(anchor.r, anchor.c, horizontal);
  const coversAll = placements.every((p) => main.cells.some(([r, c]) => r === p.r && c === p.c));
  if (!coversAll) return { ok: false, error: 'There is a gap between your tiles.' };

  const words: ScoredWord[] = [];
  if (main.cells.length >= 2) words.push({ word: main.word, score: scoreRun(main.cells) });

  // Each new tile may also complete a word the other way.
  for (const p of placements) {
    const cross = run(p.r, p.c, !horizontal);
    if (cross.cells.length >= 2) words.push({ word: cross.word, score: scoreRun(cross.cells) });
  }

  if (words.length === 0) return { ok: false, error: 'That does not make a word of two or more letters.' };

  if (!first) {
    // Connected: at least one new tile touches an old tile, or the word runs through old tiles.
    const touches = placements.some(({ r, c }) =>
      [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].some(([rr, cc]) => rr >= 0 && rr < BOARD && cc >= 0 && cc < BOARD && board[rr][cc]),
    );
    if (!touches) return { ok: false, error: 'Your word must connect to the tiles already on the board.' };
  }

  const bingo = placements.length === RACK_SIZE;
  const total = words.reduce((s, w) => s + w.score, 0) + (bingo ? BINGO_BONUS : 0);
  return { ok: true, words, total, bingo };
}

/** What the tiles left in a rack are worth (counted against you at the end). */
export const rackValue = (rack: string[]): number => rack.reduce((s, t) => s + (LETTER_VALUES[t] ?? 0), 0);

// --- What the server sends to a player ----------------------------------------------------

export type WordGameStatus = 'waiting' | 'playing' | 'finished';

export interface WordGamePlayer {
  name: string;
  score: number;
  /** How many tiles they hold (their own tiles are in `rack`, and only for them). */
  tiles: number;
  /** Resigned: skipped from now on. */
  out?: boolean;
}

export interface WordGameMove {
  by: string;
  kind: 'play' | 'pass' | 'exchange' | 'resign';
  words?: ScoredWord[];
  score?: number;
  bingo?: boolean;
  /** How many tiles were swapped. */
  swapped?: number;
  at: number;
}

/** One game as one player (or onlooker) sees it. */
export interface WordGameView {
  id: string;
  room: string;
  status: WordGameStatus;
  creator: string;
  maxPlayers: number;
  players: WordGamePlayer[];
  board: Board;
  /** Whose turn it is (an index into `players`), while playing. */
  turn: number;
  bag: number;
  /** Your tiles. Empty if you are only watching. */
  rack: string[];
  /** The squares played in the latest move, to highlight. */
  lastPlay: [number, number][];
  moves: WordGameMove[];
  winner?: string;
  endedBy?: string;
  updatedAt: number;
}

/** One row of the games list. */
export interface WordGameSummary {
  id: string;
  room: string;
  status: WordGameStatus;
  creator: string;
  maxPlayers: number;
  players: { name: string; score: number }[];
  turn: string | null;
  updatedAt: number;
}

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
export const MAX_GAMES_PER_MEMBER = 5;
