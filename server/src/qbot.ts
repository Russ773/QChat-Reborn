/**
 * QBot's first job: greet people who are new, and answer a few "!" commands.
 *
 * This file only decides WHAT to say. Saying it, and all the limits on how often,
 * live in the chat server (ChatServer.botSay is the one way a bot speaks).
 */

export interface QBotContext {
  /** Who asked. */
  nick: string;
  /** Rooms with people in them, busiest first. */
  rooms: { name: string; online: number }[];
  /** Injected so tests are predictable. */
  now?: Date;
  random?: () => number;
}

export const QBOT_COMMANDS = ['help', 'ping', 'time', 'roll', 'flip', 'rooms', 'about'] as const;

const HELP = 'Try !time, !roll 2d6, !flip, !rooms, !about or !ping.';

/** What QBot says to a member the first time they ever join a room. */
export function welcomeText(nick: string): string {
  return `Welcome to QChat Reborn, @${nick}! I'm QBot, the helper in every room. Say hello, and type !help to see what I can do.`;
}

const label = (room: string) => room.replace(/^#/, '');

function rollDice(arg: string, nick: string, random: () => number): string {
  const m = arg.trim().toLowerCase().match(/^(\d{1,2})?d(\d{1,4})$/);
  const plain = arg.trim().match(/^\d{1,4}$/);
  let count = 1;
  let sides = 6;
  if (m) {
    count = m[1] ? Number(m[1]) : 1;
    sides = Number(m[2]);
  } else if (plain) {
    sides = Number(plain[0]);
  } else if (arg.trim() !== '') {
    return 'Try !roll 2d6 (up to 10 dice, with 2 to 1000 sides). Plain !roll is one six sided die.';
  }
  if (count < 1 || count > 10 || sides < 2 || sides > 1000) {
    return 'Try !roll 2d6 (up to 10 dice, with 2 to 1000 sides). Plain !roll is one six sided die.';
  }
  const rolls = Array.from({ length: count }, () => 1 + Math.floor(random() * sides));
  const total = rolls.reduce((a, b) => a + b, 0);
  const what = `${count === 1 ? '' : count}d${sides}`;
  return count === 1
    ? `${nick} rolled a ${what}: ${total}`
    : `${nick} rolled ${what}: ${rolls.join(' + ')} = ${total}`;
}

/** A reply for a message that starts with "!", or null when it is not a command QBot knows. */
export function qbotReply(text: string, ctx: QBotContext): string | null {
  const m = text.match(/^!([A-Za-z0-9]+)(?:\s+([\s\S]*))?$/);
  if (!m) return null;
  const cmd = m[1].toLowerCase();
  const arg = (m[2] ?? '').trim();
  const random = ctx.random ?? Math.random;

  switch (cmd) {
    case 'help':
      return `Hi ${ctx.nick}! ${HELP}`;
    case 'ping':
      return 'pong';
    case 'about':
      return "QChat Reborn: Media Webchat, Reborn. I'm QBot, the helper in every room, and there are more tricks to come.";
    case 'time': {
      const now = ctx.now ?? new Date();
      const day = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long' }).format(now);
      const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
      return `It is ${clock} on ${day}, UK time.`;
    }
    case 'flip':
      return `${ctx.nick} flipped a coin: ${random() < 0.5 ? 'Heads' : 'Tails'}`;
    case 'roll':
      return rollDice(arg, ctx.nick, random);
    case 'rooms': {
      const busy = ctx.rooms.filter((r) => r.online > 0).slice(0, 5);
      if (busy.length === 0) return 'Every room is quiet right now.';
      return `Busiest rooms: ${busy.map((r) => `${label(r.name)} (${r.online})`).join(', ')}. Open the Browse rooms button to join one.`;
    }
    default:
      return null;
  }
}
