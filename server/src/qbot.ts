/**
 * QBot's brain for the commands that need no memory. (Polls and reminders, which do, live in
 * qbot-polls.ts and reminders.ts.)
 *
 * This file only decides WHAT to say. Saying it, and all the limits on how often, live in the
 * chat server (ChatServer.botSay is the one way a bot speaks).
 */

export interface QBotContext {
  /** Who asked. */
  nick: string;
  /** The room it was asked in, and that room's topic. */
  room: string;
  topic: string | null;
  /** Rooms with people in them, busiest first. */
  rooms: { name: string; online: number }[];
  /** Site wide numbers for !stats. */
  stats: { members: number; online: number; rooms: number };
  /** Injected so tests are predictable. */
  now?: Date;
  random?: () => number;
}

/** Every command QBot knows, for !help. */
export const QBOT_COMMANDS = [
  'help', 'ping', 'time', 'roll', 'flip', '8ball', 'choose', 'joke', 'poll', 'vote', 'results', 'endpoll',
  'remind', 'reminders', 'topic', 'stats', 'rooms', 'about',
] as const;

const HELP_ALL =
  'Fun: !roll 2d6, !flip, !8ball <question>, !choose a, b, c, !joke. Useful: !poll, !remind 10m <text>, !time, !topic, !stats, !rooms, !about, !ping. Type !help <command> for details.';

const HELP_ONE: Record<string, string> = {
  help: '!help shows everything I can do. !help <command> explains one command.',
  ping: '!ping checks that I am awake. I answer "pong".',
  time: '!time tells you the time in the UK.',
  roll: '!roll rolls a die. !roll 2d6 rolls two six sided dice, !roll d20 one twenty sided die, !roll 20 the same. Up to 10 dice, 2 to 1000 sides.',
  flip: '!flip flips a coin.',
  '8ball': '!8ball <question> asks the magic 8 ball a yes or no question.',
  choose: '!choose pizza, curry, burger picks one for you. Separate the choices with commas or the word "or".',
  joke: '!joke tells a joke.',
  poll: '!poll Best colour? | Red | Blue | Green starts a poll (2 to 6 options, one poll per room, closes after 10 minutes).',
  vote: '!vote 2 votes for option 2 in the poll. You can change your vote. Your vote is confirmed privately.',
  results: '!results shows how the poll is going.',
  endpoll: '!endpoll closes the poll now and shows the result. Only the person who started it, or a moderator, can do this.',
  remind: '!remind 10m take the pizza out reminds you after 10 minutes. You can use s, m, h and d, for example 1h30m. Up to 7 days, 5 reminders at once.',
  reminders: '!reminders lists your reminders (only you see it). !reminders clear deletes them all.',
  topic: '!topic tells you what this room is about.',
  stats: '!stats shows how many members and rooms QChat has.',
  rooms: '!rooms lists the busiest rooms.',
  about: '!about tells you who I am.',
};

/** What QBot says to a member the first time they ever join a room. */
export function welcomeText(nick: string): string {
  return `Welcome to QChat Reborn, @${nick}! I'm QBot, the helper in every room. Say hello, and type !help to see what I can do.`;
}

const label = (room: string) => room.replace(/^#/, '');

const EIGHT_BALL = [
  'It is certain.', 'It is decidedly so.', 'Without a doubt.', 'Yes, definitely.', 'You may rely on it.',
  'As I see it, yes.', 'Most likely.', 'Outlook good.', 'Yes.', 'Signs point to yes.',
  'Reply hazy, try again.', 'Ask again later.', 'Better not tell you now.', 'Cannot predict now.', 'Concentrate and ask again.',
  "Don't count on it.", 'My reply is no.', 'My sources say no.', 'Outlook not so good.', 'Very doubtful.',
];

const JOKES = [
  'Why did the scarecrow win an award? Because he was outstanding in his field.',
  'I told my computer I needed a break. Now it will not stop sending me KitKat ads.',
  'Why do programmers prefer dark mode? Because light attracts bugs.',
  'What do you call a fake noodle? An impasta.',
  'Why did the bicycle fall over? It was two tired.',
  'What do you call cheese that is not yours? Nacho cheese.',
  'I used to hate facial hair, but then it grew on me.',
  'Why can you never trust an atom? They make up everything.',
  'What did the ocean say to the beach? Nothing, it just waved.',
  'Why did the tomato turn red? Because it saw the salad dressing.',
  'What do you call a bear with no teeth? A gummy bear.',
  'Why was the math book sad? It had too many problems.',
  'How does a penguin build its house? Igloos it together.',
  'What do you call a sleeping dinosaur? A dino-snore.',
  'Why did the golfer bring two pairs of trousers? In case he got a hole in one.',
  'What do you get when you cross a snowman with a vampire? Frostbite.',
  'Why do bees have sticky hair? Because they use honeycombs.',
  'What did one wall say to the other? I will meet you at the corner.',
  'Why did the coffee file a police report? It got mugged.',
  'What is a ghost\'s favourite pudding? I scream.',
  'How do you organise a space party? You planet.',
  'Why are ducks good at email? They always quack the subject line.',
  'What do you call a pile of kittens? A meowntain.',
  'Why did the picture go to jail? It was framed.',
  'What do you call a factory that makes okay products? A satisfactory.',
  'Why did the chat room go quiet? Everyone was typing.',
  'I would tell you a UDP joke, but you might not get it.',
  'There are 10 kinds of people: those who understand binary and those who do not.',
];

function pick<T>(list: T[], random: () => number): T {
  return list[Math.floor(random() * list.length)];
}

function rollDice(arg: string, nick: string, random: () => number): string {
  const hint = 'Try !roll 2d6 (up to 10 dice, with 2 to 1000 sides). Plain !roll is one six sided die.';
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
    return hint;
  }
  if (count < 1 || count > 10 || sides < 2 || sides > 1000) return hint;
  const rolls = Array.from({ length: count }, () => 1 + Math.floor(random() * sides));
  const total = rolls.reduce((a, b) => a + b, 0);
  const what = `${count === 1 ? '' : count}d${sides}`;
  return count === 1 ? `${nick} rolled a ${what}: ${total}` : `${nick} rolled ${what}: ${rolls.join(' + ')} = ${total}`;
}

/** Split "a, b or c" into choices. */
export function splitChoices(arg: string): string[] {
  const parts = arg.includes(',') ? arg.split(',') : arg.split(/\s+or\s+/i);
  return parts.map((p) => p.trim().replace(/^or\s+/i, '')).filter(Boolean);
}

/** A reply for a message that starts with "!", or null when it is not a command QBot answers here. */
export function qbotReply(text: string, ctx: QBotContext): string | null {
  const m = text.match(/^!([A-Za-z0-9]+)(?:\s+([\s\S]*))?$/);
  if (!m) return null;
  const cmd = m[1].toLowerCase();
  const arg = (m[2] ?? '').trim();
  const random = ctx.random ?? Math.random;

  switch (cmd) {
    case 'help': {
      if (!arg) return `Hi ${ctx.nick}! ${HELP_ALL}`;
      const key = arg.toLowerCase().replace(/^!/, '');
      return HELP_ONE[key] ?? `I do not know a command called "${arg.slice(0, 30)}". Type !help to see them all.`;
    }
    case 'ping':
      return 'pong';
    case 'about':
      return "QChat Reborn: Media Webchat, Reborn. I'm QBot, the helper in every room. Type !help to see my tricks.";
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
    case '8ball':
      if (!arg) return 'Ask me a question first, like !8ball will it rain?';
      return `The 8 ball says: ${pick(EIGHT_BALL, random)}`;
    case 'choose': {
      const options = splitChoices(arg);
      if (options.length < 2) return 'Give me at least two choices, like !choose pizza, curry, burger.';
      return `I choose: ${pick(options, random).slice(0, 80)}`;
    }
    case 'joke':
      return pick(JOKES, random);
    case 'topic':
      return ctx.topic ? `The topic of ${label(ctx.room)} is: ${ctx.topic}` : `${label(ctx.room)} has no topic set.`;
    case 'stats':
      return `QChat has ${ctx.stats.members} member${ctx.stats.members === 1 ? '' : 's'}, ${ctx.stats.online} online right now, and ${ctx.stats.rooms} room${ctx.stats.rooms === 1 ? '' : 's'}.`;
    case 'rooms': {
      const busy = ctx.rooms.filter((r) => r.online > 0).slice(0, 5);
      if (busy.length === 0) return 'Every room is quiet right now.';
      return `Busiest rooms: ${busy.map((r) => `${label(r.name)} (${r.online})`).join(', ')}. Open the Browse rooms button to join one.`;
    }
    default:
      return null;
  }
}
