/**
 * The daily post in the lobby (a fact or a quote, and any birthdays), and the birthday lists.
 * Birthdays are only ever shown for members who ticked "Birthday" under "Show on my profile".
 */
import { db } from './db.js';
import { FACTS, QUOTES, dayNumber } from './daily-content.js';

const LONDON = 'Europe/London';

/** Today's date and hour in the UK, which is when members expect it to be morning. */
export function londonNow(at = new Date()): { date: string; md: string; hour: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: LONDON, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, md: `${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const prettyBirthday = (md: string): string => {
  const [m, d] = md.split('-').map(Number);
  return `${d} ${MONTHS[m - 1] ?? ''}`.trim();
};

interface BirthdayRow {
  account: string;
  birthday: string;
}

/** Members whose birthday is public, for the given MM-DD values. */
function publicBirthdays(mds: string[]): BirthdayRow[] {
  if (mds.length === 0) return [];
  const rows = db
    .prepare(`SELECT account, birthday, prefs FROM profiles WHERE birthday IN (${mds.map(() => '?').join(',')})`)
    .all(...mds) as unknown as { account: string; birthday: string; prefs: string | null }[];
  return rows
    .filter((r) => {
      try {
        return (JSON.parse(r.prefs ?? '{}') as { visible?: Record<string, boolean> }).visible?.birthday === true;
      } catch {
        return false;
      }
    })
    .map((r) => ({ account: r.account, birthday: r.birthday }));
}

export const birthdaysOn = (md: string): string[] => publicBirthdays([md]).map((r) => r.account);

/** A line for !birthdays: today's and the next few days' birthdays. */
export function birthdayReport(now = new Date()): string {
  const upcoming: { who: string; on: string; days: number }[] = [];
  for (let i = 0; i < 14; i++) {
    const md = londonNow(new Date(now.getTime() + i * 86_400_000)).md;
    for (const r of publicBirthdays([md])) upcoming.push({ who: r.account, on: md, days: i });
  }
  if (upcoming.length === 0) return 'No birthdays in the next two weeks. Add yours in your profile and tick it under Show on my profile!';
  return `Birthdays coming up: ${upcoming
    .map((u) => `${u.who} (${u.days === 0 ? 'today' : u.days === 1 ? 'tomorrow' : prettyBirthday(u.on)})`)
    .join(', ')}.`;
}

/** The fact of the day on even days and the quote of the day on odd days, the same for everyone. */
export function dailyLine(now = new Date()): string {
  const day = dayNumber(now);
  if (day % 2 === 0) return `Did you know? ${FACTS[(day / 2) % FACTS.length | 0]}`;
  const q = QUOTES[((day - 1) / 2) % QUOTES.length | 0];
  return `Quote of the day: "${q.text}"${q.by ? ` (${q.by})` : ''}`;
}

export const randomFact = (random = Math.random): string => `Did you know? ${FACTS[Math.floor(random() * FACTS.length)]}`;
export const randomQuote = (random = Math.random): string => {
  const q = QUOTES[Math.floor(random() * QUOTES.length)];
  return `"${q.text}"${q.by ? ` (${q.by})` : ''}`;
};

/**
 * What to say in the lobby today, if it has not been said yet and it is morning in the UK. Returns the lines (or
 * null) and remembers that today is done. Call it once an hour.
 */
export function takeDailyPost(now = new Date()): string[] | null {
  const { date, md, hour } = londonNow(now);
  if (hour < 8) return null;
  const done = db.prepare("SELECT value FROM settings WHERE key = 'lastDailyPost'").get() as { value: string } | undefined;
  if (done && JSON.parse(done.value) === date) return null;
  db.prepare("INSERT INTO settings (key, value) VALUES ('lastDailyPost', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(date));
  const lines: string[] = [];
  const bdays = birthdaysOn(md);
  if (bdays.length > 0) lines.push(`Happy birthday to ${bdays.join(', ')}! 🎂🎉`);
  lines.push(dailyLine(now));
  return lines;
}
