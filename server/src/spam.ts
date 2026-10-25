/**
 * Spotting someone who repeats the same message over and over. When the same text turns up too many times in a
 * short while, the caller mutes them in that room. Repeat offenders get longer mutes (10 minutes, an hour, a day).
 */

/** Minutes of mute for the first, second and later offence. */
const STEPS = [10, 60, 1440];

const DAY = 24 * 60 * 60 * 1000;

const normalise = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

export class SpamWatch {
  private recent = new Map<string, { norm: string; ts: number }[]>();
  private strikes = new Map<string, { n: number; at: number }>();

  constructor(
    /** How many identical messages, inside the window, count as spam. */
    private repeats = 3,
    private windowMs = 60_000,
  ) {}

  /** Record a message. Returns the minutes to mute for if this one tips them over the line, else 0. */
  check(account: string, text: string, at = Date.now()): number {
    // Commands and very short replies ("lol", "ok") are fine to repeat.
    if (text.startsWith('!') || text.startsWith('/')) return 0;
    const norm = normalise(text);
    if (norm.length < 4) return 0;

    const list = (this.recent.get(account) ?? []).filter((m) => at - m.ts < this.windowMs);
    list.push({ norm, ts: at });
    this.recent.set(account, list);
    if (list.filter((m) => m.norm === norm).length < this.repeats) return 0;

    // They crossed the line: start counting again, and look up how many times it has happened lately.
    this.recent.delete(account);
    const prev = this.strikes.get(account);
    const n = prev && at - prev.at < DAY ? prev.n + 1 : 1;
    this.strikes.set(account, { n, at });
    return STEPS[Math.min(n, STEPS.length) - 1];
  }

  /** Forget members who have not misbehaved for a day (called now and then). */
  sweep(at = Date.now()): void {
    for (const [a, s] of this.strikes) if (at - s.at >= DAY) this.strikes.delete(a);
    for (const [a, l] of this.recent) if (l.every((m) => at - m.ts >= this.windowMs)) this.recent.delete(a);
  }
}
