import { db } from './db.js';
import { BANK, CATEGORIES, findCategory, type Question } from './trivia-questions.js';

export { BANK, CATEGORIES, findCategory };

/** The bot that runs the game. */
export const TRIVIA_BOT = 'TriviaBot';

const seconds = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n * 1000 : fallback;
};
/** How long each question stays open, and the pause between questions. Settable so tests can run fast. */
export const QUESTION_MS = seconds('TRIVIA_QUESTION_SECONDS', 30_000);
export const GAP_MS = seconds('TRIVIA_GAP_SECONDS', 6_000);

export const MIN_QUESTIONS = 3;
export const MAX_QUESTIONS = 20;
export const DEFAULT_QUESTIONS = 10;

// --- Matching answers -----------------------------------------------------------

/** Lower case, no accents, no punctuation, no leading "the", single spaces. */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^(the|a|an) /, '');
}

function distance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}

/** Is this chat message the answer? Exact, inside a short sentence, or one small typo away. */
export function isCorrect(input: string, answers: string[]): boolean {
  const n = normalize(input);
  if (!n) return false;
  const words = n.split(' ');
  for (const a of answers) {
    const na = normalize(a);
    if (!na) continue;
    if (n === na) return true;
    if (words.length <= 6 && ` ${n} `.includes(` ${na} `)) return true; // "I think it is Canberra"
    // A small typo is forgiven for longer text answers, never for numbers.
    if (na.length >= 5 && !/\d/.test(na) && Math.abs(n.length - na.length) <= 2) {
      if (distance(n, na) <= (na.length >= 9 ? 2 : 1)) return true;
    }
  }
  return false;
}

/** "C _ n b _ r r _" style hint: first letters of each word plus about a third of the rest. */
export function hintFor(answer: string): string {
  const chars = [...answer];
  const isChar = (c: string) => /[a-z0-9]/i.test(c);
  const reveal = new Set<number>();
  chars.forEach((c, i) => {
    if (isChar(c) && (i === 0 || !isChar(chars[i - 1]))) reveal.add(i);
  });
  const rest = chars.map((c, i) => (isChar(c) && !reveal.has(i) ? i : -1)).filter((i) => i >= 0);
  for (let k = rest.length - 1; k > 0; k--) {
    const j = Math.floor(Math.random() * (k + 1));
    [rest[k], rest[j]] = [rest[j], rest[k]];
  }
  for (const i of rest.slice(0, Math.floor(rest.length / 3))) reveal.add(i);
  return chars.map((c, i) => (!isChar(c) ? (c === ' ' ? '/' : c) : reveal.has(i) ? c : '_')).join(' ');
}

const letterCount = (answer: string) => [...answer].filter((c) => /[a-z0-9]/i.test(c)).length;

// --- The game -------------------------------------------------------------------

export interface GameIO {
  say(text: string): void;
  /** False once the room is empty, so the game stops by itself. */
  alive(): boolean;
  /** Somebody scored. */
  award(account: string, name: string, points: number): void;
  /** The game is over (finished or stopped). */
  finish(players: { account: string; name: string }[], winner: string | null): void;
}

interface Tally {
  name: string;
  points: number;
  correct: number;
}

export class TriviaGame {
  stopped = false;
  readonly scores = new Map<string, Tally>();
  private index = -1;
  private current: Question | null = null;
  private open = false;
  private openedAt = 0;
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(
    private io: GameIO,
    /** The account (lower case) that started it. */
    readonly starter: string,
    private questions: Question[],
    private opts = { questionMs: QUESTION_MS, gapMs: GAP_MS },
  ) {}

  get total(): number {
    return this.questions.length;
  }

  start(): void {
    const secs = Math.round(this.opts.questionMs / 1000);
    this.io.say(
      `Trivia time! ${this.total} questions, ${secs} seconds each. Type your answer in the chat. The first right answer scores 10 points, with a bonus for being quick. Here we go...`,
    );
    this.later(this.opts.gapMs, () => this.next());
  }

  private later(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      if (!this.stopped) fn();
    }, ms);
    t.unref?.();
    this.timers.push(t);
  }

  private next(): void {
    if (!this.io.alive()) return this.halt('nobody is here any more');
    this.index++;
    if (this.index >= this.questions.length) return this.finish();
    const q = (this.current = this.questions[this.index]);
    const mine = this.index;
    this.open = true;
    this.openedAt = Date.now();
    this.io.say(`Question ${mine + 1} of ${this.total} (${q.category}): ${q.question}`);
    this.later(this.opts.questionMs / 2, () => {
      if (this.open && this.index === mine) this.io.say(`Hint: ${hintFor(q.display)}  (${letterCount(q.display)} characters)`);
    });
    this.later(this.opts.questionMs, () => {
      if (!this.open || this.index !== mine) return;
      this.open = false;
      this.io.say(`Time's up! The answer was: ${q.display}.`);
      this.later(this.opts.gapMs, () => this.next());
    });
  }

  /** A chat message arrived. Returns true when it was the right answer. */
  hear(account: string, name: string, text: string): boolean {
    if (this.stopped || !this.open || !this.current) return false;
    if (!isCorrect(text, this.current.answers)) return false;
    this.open = false;
    const fraction = (Date.now() - this.openedAt) / this.opts.questionMs;
    const bonus = fraction < 1 / 3 ? 5 : fraction < 2 / 3 ? 2 : 0;
    const points = 10 + bonus;
    const t = this.scores.get(account) ?? { name, points: 0, correct: 0 };
    t.name = name;
    t.points += points;
    t.correct += 1;
    this.scores.set(account, t);
    this.io.award(account, name, points);
    this.io.say(`Correct, ${name}! The answer was ${this.current.display}. +${points} points (${t.points} this game).`);
    this.later(this.opts.gapMs, () => this.next());
    return true;
  }

  /** Give up on the current question. */
  skip(by: string): boolean {
    if (this.stopped || !this.open || !this.current) return false;
    this.open = false;
    this.io.say(`${by} skipped it. The answer was: ${this.current.display}.`);
    this.later(this.opts.gapMs, () => this.next());
    return true;
  }

  /** End the game early. */
  stop(by: string): void {
    if (this.stopped) return;
    this.halt(`stopped by ${by}`);
  }

  private standings(): string {
    const rows = [...this.scores.values()].sort((a, b) => b.points - a.points || b.correct - a.correct);
    return rows.map((r, i) => `${i + 1}. ${r.name} ${r.points} pts (${r.correct} right)`).join(', ');
  }

  private halt(why: string): void {
    this.stopped = true;
    this.open = false;
    this.timers.forEach(clearTimeout);
    const table = this.standings();
    this.io.say(table ? `Game over, ${why}. Scores: ${table}.` : `Game over, ${why}.`);
    this.io.finish(this.players(), null);
  }

  private players() {
    return [...this.scores.entries()].map(([account, t]) => ({ account, name: t.name }));
  }

  private finish(): void {
    this.stopped = true;
    this.timers.forEach(clearTimeout);
    const rows = [...this.scores.entries()].sort((a, b) => b[1].points - a[1].points || b[1].correct - a[1].correct);
    if (rows.length === 0) {
      this.io.say('That is the end of the game, and nobody scored. Type !trivia to try again.');
      this.io.finish([], null);
      return;
    }
    const winner = rows[0];
    const tied = rows.length > 1 && rows[1][1].points === winner[1].points;
    this.io.say(
      `That is the end of the game! Final scores: ${this.standings()}. ${tied ? 'It is a tie at the top!' : `${winner[1].name} wins!`}`,
    );
    this.io.finish(this.players(), tied ? null : winner[0]);
  }
}

// --- Choosing questions ---------------------------------------------------------

const recent: number[] = [];

export function pickQuestions(count: number, category: string | null): Question[] {
  const pool = category ? BANK.filter((q) => q.category === category) : BANK.slice();
  const fresh = pool.filter((q) => !recent.includes(q.id));
  const source = fresh.length >= count ? fresh : pool;
  for (let k = source.length - 1; k > 0; k--) {
    const j = Math.floor(Math.random() * (k + 1));
    [source[k], source[j]] = [source[j], source[k]];
  }
  const chosen = source.slice(0, Math.min(count, source.length));
  recent.push(...chosen.map((q) => q.id));
  while (recent.length > 60) recent.shift();
  return chosen;
}

// --- Scores that last -----------------------------------------------------------

export function recordPoints(account: string, name: string, points: number): void {
  db.prepare(
    `INSERT INTO trivia_scores (accountLower, account, points, correct, wins, played) VALUES (?, ?, ?, 1, 0, 0)
     ON CONFLICT(accountLower) DO UPDATE SET account = excluded.account, points = points + excluded.points, correct = correct + 1`,
  ).run(account, name, points);
}

export function recordGame(players: { account: string; name: string }[], winner: string | null): void {
  for (const p of players) {
    db.prepare(
      `INSERT INTO trivia_scores (accountLower, account, points, correct, wins, played) VALUES (?, ?, 0, 0, ?, 1)
       ON CONFLICT(accountLower) DO UPDATE SET account = excluded.account, played = played + 1, wins = wins + excluded.wins`,
    ).run(p.account, p.name, p.account === winner ? 1 : 0);
  }
}

export interface ScoreRow {
  account: string;
  points: number;
  correct: number;
  wins: number;
  played: number;
}

export function topScores(n: number): ScoreRow[] {
  return db
    .prepare('SELECT account, points, correct, wins, played FROM trivia_scores WHERE points > 0 ORDER BY points DESC, correct DESC, account LIMIT ?')
    .all(n) as unknown as ScoreRow[];
}

export function scoreFor(account: string): (ScoreRow & { rank: number }) | null {
  const row = db
    .prepare('SELECT account, points, correct, wins, played FROM trivia_scores WHERE accountLower = ?')
    .get(account.toLowerCase()) as ScoreRow | undefined;
  if (!row || row.points <= 0) return null;
  const ahead = db.prepare('SELECT COUNT(*) AS n FROM trivia_scores WHERE points > ?').get(row.points) as { n: number };
  return { ...row, rank: ahead.n + 1 };
}
