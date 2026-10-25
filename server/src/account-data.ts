import { db } from './db.js';
import { purgeAccount } from './chat/store.js';
import { exportGames } from './wordgame.js';

/** Everything QChat holds about one member, for "Download my data". Never includes the password hash. */
export function exportAccount(account: string): Record<string, unknown> {
  const l = account.toLowerCase();
  const all = (sql: string, ...args: (string | number)[]) => db.prepare(sql).all(...args) as Record<string, unknown>[];
  const one = (sql: string, ...args: (string | number)[]) => db.prepare(sql).get(...args) as Record<string, unknown> | undefined;

  const profile = one('SELECT * FROM profiles WHERE accountLower = ?', l);
  if (profile && typeof profile.prefs === 'string') {
    try {
      profile.prefs = JSON.parse(profile.prefs);
    } catch {
      /* leave it as text */
    }
  }
  if (profile) delete profile.accountLower;

  return {
    about: 'This is the personal information QChat holds about you, taken at the time you asked for it.',
    exportedAt: new Date().toISOString(),
    account: one('SELECT account, email, emailVerifiedAt, role, createdAt, lastLogin, termsAcceptedAt FROM accounts WHERE accountLower = ?', l),
    profile: profile ?? null,
    friends: all('SELECT friendLower AS name FROM friends WHERE accountLower = ?', l).map((r) => r.name),
    friendRequestsSent: all('SELECT toName AS name, ts FROM friend_requests WHERE fromLower = ?', l),
    friendRequestsReceived: all('SELECT fromName AS name, ts FROM friend_requests WHERE toLower = ?', l),
    blockedMembers: all('SELECT blockedLower AS name FROM blocks WHERE accountLower = ?', l).map((r) => r.name),
    roomMessages: all(
      'SELECT room, text, kind, ts, editedAt, image, deleted FROM messages WHERE fromLower = ? ORDER BY seq',
      l,
    ),
    privateMessages: all(
      'SELECT fromName AS "from", toName AS "to", text, kind, ts FROM dms WHERE fromLower = ? OR toLower = ? ORDER BY seq',
      l,
      l,
    ),
    reactions: all('SELECT emoji, messageId FROM reactions WHERE accountLower = ?', l),
    reportsYouMade: all('SELECT ts, room, text AS reportedText, reason, status FROM reports WHERE reporterLower = ?', l),
    wordGames: exportGames(l),
    soundboardClips: all('SELECT name, emoji, status, size, ts FROM custom_sounds WHERE ownerLower = ?', l),
    pictures: all('SELECT name, ts, size FROM uploads WHERE ownerLower = ?', l),
    triviaScores: one('SELECT points, correct, wins, played FROM trivia_scores WHERE accountLower = ?', l) ?? null,
    reminders: all('SELECT room, dueAt, text FROM reminders WHERE accountLower = ?', l),
  };
}

/**
 * Erase a member's data for good: what they said in rooms, private messages, friends, pictures, reports,
 * reminders, trivia scores. The caller then removes the account itself and its profile photo.
 * Returns the picture files to delete from disk.
 */
export function eraseAccountData(account: string): string[] {
  const l = account.toLowerCase();
  db.prepare('DELETE FROM reactions WHERE messageId IN (SELECT id FROM messages WHERE fromLower = ?)').run(l);
  db.prepare('DELETE FROM messages WHERE fromLower = ?').run(l);
  db.prepare('DELETE FROM reports WHERE reporterLower = ? OR lower(author) = ?').run(l, l);
  return purgeAccount(account);
}
