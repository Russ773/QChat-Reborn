/** QBot's polls: one per room, held in memory, closed by their starter, a moderator, or the clock. */

const seconds = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n * 1000 : fallback;
};
/** How long a poll stays open. Settable so tests can run fast. */
export const POLL_MS = seconds('QBOT_POLL_SECONDS', 10 * 60 * 1000);

export const MAX_QUESTION = 120;
export const MAX_OPTION = 50;

interface Poll {
  question: string;
  options: string[];
  /** account (lower case) -> chosen option index */
  votes: Map<string, number>;
  starter: string;
  starterNick: string;
  endsAt: number;
}

const HINT = 'Try !poll Best colour? | Red | Blue | Green (a question, then 2 to 6 options separated by |).';

export class PollBoard {
  private polls = new Map<string, Poll>();

  has(room: string): boolean {
    return this.polls.has(room);
  }

  /** Start a poll. Returns what QBot should say. */
  start(room: string, account: string, nick: string, text: string, now = Date.now()): string {
    if (this.polls.has(room)) return 'A poll is already running here. Use !results to see it, or !endpoll to close it.';
    const parts = text.split('|').map((p) => p.trim()).filter(Boolean);
    if (parts.length < 3) return HINT;
    const [question, ...options] = parts;
    if (options.length > 6) return 'A poll can have up to 6 options.';
    if (question.length > MAX_QUESTION) return `Keep the question under ${MAX_QUESTION} characters.`;
    if (options.some((o) => o.length > MAX_OPTION)) return `Keep each option under ${MAX_OPTION} characters.`;
    if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) return 'Each option must be different.';
    this.polls.set(room, { question, options, votes: new Map(), starter: account.toLowerCase(), starterNick: nick, endsAt: now + POLL_MS });
    const mins = Math.max(1, Math.round(POLL_MS / 60000));
    const secs = Math.round(POLL_MS / 1000);
    const closes = POLL_MS >= 60000 ? `${mins} minute${mins === 1 ? '' : 's'}` : `${secs} seconds`;
    return `${nick} started a poll: ${question}  ${options.map((o, i) => `${i + 1}) ${o}`).join('  ')}  Vote with !vote <number>. It closes in ${closes}.`;
  }

  /** Record a vote. Returns a private note for the voter. */
  vote(room: string, account: string, arg: string): string {
    const poll = this.polls.get(room);
    if (!poll) return 'There is no poll running here. Start one with !poll.';
    const n = Number(arg.trim());
    if (!Number.isInteger(n) || n < 1 || n > poll.options.length) return `Vote with a number from 1 to ${poll.options.length}, like !vote 1.`;
    poll.votes.set(account.toLowerCase(), n - 1);
    return `Your vote for ${n}) ${poll.options[n - 1]} is counted. You can change it any time.`;
  }

  private tally(poll: Poll): string {
    const counts = poll.options.map(() => 0);
    for (const v of poll.votes.values()) counts[v]++;
    const total = poll.votes.size;
    const rows = poll.options.map((o, i) => `${o}: ${counts[i]} (${total ? Math.round((counts[i] / total) * 100) : 0}%)`);
    return `${poll.question}  ${rows.join('  ')}  Total votes: ${total}.`;
  }

  results(room: string): string {
    const poll = this.polls.get(room);
    return poll ? `Poll so far: ${this.tally(poll)}` : 'There is no poll running here.';
  }

  /** Close a poll early. */
  end(room: string, account: string, isMod: boolean): string {
    const poll = this.polls.get(room);
    if (!poll) return 'There is no poll running here.';
    if (poll.starter !== account.toLowerCase() && !isMod) return `Only ${poll.starterNick} or a moderator can close this poll.`;
    this.polls.delete(room);
    return `Poll closed. ${this.tally(poll)}`;
  }

  /** Polls whose time is up (removed, with the announcement to make). */
  expired(now = Date.now()): { room: string; text: string }[] {
    const out: { room: string; text: string }[] = [];
    for (const [room, poll] of this.polls) {
      if (poll.endsAt <= now) {
        this.polls.delete(room);
        out.push({ room, text: `The poll has closed. ${this.tally(poll)}` });
      }
    }
    return out;
  }
}
