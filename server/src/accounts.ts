import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { validAccount } from '@qchat/shared';
import { botNameTaken } from './bots.js';
import { db, hashToken } from './db.js';
import { SESSION_IDLE_MS, SESSION_MAX_MS, passwordProblem } from './security.js';
import { getSettings } from './settings.js';

function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 32);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(pw: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(pw, Buffer.from(saltHex, 'hex'), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// --- Admin bootstrap ---------------------------------------------------------

/** Accounts named in ADMIN_ACCOUNTS (comma separated) are always administrators. */
function envAdmins(): string[] {
  return (process.env.ADMIN_ACCOUNTS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function adminCount(): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE role = 'admin'").get() as { n: number }).n;
}

/** Promote any existing ADMIN_ACCOUNTS members. Call once at startup. */
export function ensureAdmins(): string[] {
  const promoted: string[] = [];
  for (const lower of envAdmins()) {
    const r = db.prepare("UPDATE accounts SET role = 'admin' WHERE accountLower = ? AND role != 'admin'").run(lower);
    if (Number(r.changes) > 0) promoted.push(lower);
  }
  return promoted;
}

// --- Registration + login ------------------------------------------------------

export interface RegisterResult {
  ok: boolean;
  account?: string;
  role?: 'admin' | 'user';
  error?: string;
  status?: number;
}

export function register(account: string, email: string, password: string, agreed = false): RegisterResult {
  account = account.trim();
  if (!validAccount(account)) {
    return { ok: false, status: 422, error: 'Username must be 2 to 24 letters, numbers, _ or -.' };
  }
  const weak = passwordProblem(password, account);
  if (weak) return { ok: false, status: 422, error: weak };
  const lower = account.toLowerCase();
  const listedAdmin = envAdmins().includes(lower);
  // Closing registration never locks out accounts the owner listed as admins.
  if (!getSettings().registrationOpen && !listedAdmin) {
    return { ok: false, status: 403, error: 'Sign ups are closed right now.' };
  }
  if (botNameTaken(lower) || db.prepare('SELECT 1 FROM accounts WHERE accountLower = ?').get(lower)) {
    return { ok: false, status: 422, error: 'That username is already taken.' };
  }

  // The owner is an admin from the start. With no ADMIN_ACCOUNTS configured,
  // the very first account on a fresh install becomes the admin instead.
  const firstEver = envAdmins().length === 0 && adminCount() === 0;
  const role = listedAdmin || firstEver ? 'admin' : 'user';
  if (role === 'admin') console.log(`[qchat] ${account} registered as an administrator`);

  const now = Date.now();
  db.prepare('INSERT INTO accounts (accountLower, account, email, passHash, createdAt, role, lastLogin) VALUES (?,?,?,?,?,?,?)')
    .run(lower, account, email || null, hashPassword(password), now, role, now);
  db.prepare('INSERT OR IGNORE INTO profiles (accountLower, account, updatedAt) VALUES (?,?,?)')
    .run(lower, account, now);
  // Note when they agreed to the terms and privacy notice (the sign-up form will not send the form without it).
  if (agreed) db.prepare('UPDATE accounts SET termsAcceptedAt = ? WHERE accountLower = ?').run(now, lower);
  return { ok: true, account, role };
}

export interface LoginResult {
  ok: boolean;
  account?: string;
  role?: 'admin' | 'user';
  error?: string;
  status?: number;
}

// A real-looking hash to check against when the account does not exist.
const DUMMY_HASH = hashPassword('qchat-timing-equaliser');

export function login(account: string, password: string): LoginResult {
  const row = db
    .prepare('SELECT account, passHash, role, suspended, suspendedReason FROM accounts WHERE accountLower = ?')
    .get(account.trim().toLowerCase()) as
    | { account: string; passHash: string; role: 'admin' | 'user'; suspended: number; suspendedReason: string | null }
    | undefined;
  if (!row) verifyPassword(password, DUMMY_HASH);
  if (!row || !verifyPassword(password, row.passHash)) {
    return { ok: false, status: 401, error: 'Wrong username or password.' };
  }
  if (row.suspended) {
    const why = row.suspendedReason ? ` Reason: ${row.suspendedReason}` : '';
    return { ok: false, status: 403, error: `This account has been suspended.${why}` };
  }
  if (getSettings().maintenance && row.role !== 'admin') {
    return { ok: false, status: 503, error: 'QChat is down for maintenance. Please try again soon.' };
  }
  db.prepare('UPDATE accounts SET lastLogin = ? WHERE accountLower = ?').run(Date.now(), row.account.toLowerCase());
  return { ok: true, account: row.account, role: row.role };
}

// --- Sessions ----------------------------------------------------------------

export function createSession(account: string): string {
  const token = randomBytes(32).toString('hex');
  const now = Date.now();
  // Only the hash is stored; the token itself goes to the browser and nowhere else.
  db.prepare('INSERT INTO sessions (tokenHash, accountLower, createdAt, lastUsed) VALUES (?,?,?,?)')
    .run(hashToken(token), account.toLowerCase(), now, now);
  return token;
}

/** Remove logins that have lapsed (unused for too long, or older than the absolute limit). */
export function pruneSessions(): number {
  const now = Date.now();
  const r = db.prepare('DELETE FROM sessions WHERE lastUsed < ? OR createdAt < ?').run(now - SESSION_IDLE_MS, now - SESSION_MAX_MS);
  return Number(r.changes);
}

/** The account for a session token, or null (suspended accounts never resolve). */
export function accountForToken(token: string | undefined): string | null {
  if (!token) return null;
  const hash = hashToken(token);
  const now = Date.now();
  const row = db
    .prepare(
      `SELECT a.account AS account, s.lastUsed AS lastUsed FROM sessions s
       JOIN accounts a ON a.accountLower = s.accountLower
       WHERE s.tokenHash = ? AND a.suspended = 0 AND s.lastUsed >= ? AND s.createdAt >= ?`,
    )
    .get(hash, now - SESSION_IDLE_MS, now - SESSION_MAX_MS) as { account: string; lastUsed: number } | undefined;
  if (!row) return null;
  // Using a login keeps it alive, but write to the database only now and then.
  if (now - row.lastUsed > Math.min(3600_000, SESSION_IDLE_MS / 4)) {
    db.prepare('UPDATE sessions SET lastUsed = ? WHERE tokenHash = ?').run(now, hash);
  }
  return row.account;
}

export function logout(token: string | undefined): void {
  if (token) db.prepare('DELETE FROM sessions WHERE tokenHash = ?').run(hashToken(token));
}

export function endSessions(account: string): void {
  db.prepare('DELETE FROM sessions WHERE accountLower = ?').run(account.toLowerCase());
}

/** Is this the right password for the account? (Used before something that cannot be undone.) */
export function verifyAccountPassword(account: string, password: string): boolean {
  const row = db.prepare('SELECT passHash FROM accounts WHERE accountLower = ?').get(account.toLowerCase()) as { passHash: string } | undefined;
  if (!row) {
    verifyPassword(password, DUMMY_HASH);
    return false;
  }
  return verifyPassword(password, row.passHash);
}

export type PasswordChange = { ok: true } | { ok: false; status: number; error: string };

/**
 * Change your own password. You must give the current one. Every other device is logged out
 * (only the login in `keepToken` stays), so a stolen login stops working.
 */
export function changePassword(account: string, current: string, next: string, keepToken?: string): PasswordChange {
  const lower = account.toLowerCase();
  const row = db.prepare('SELECT account, passHash FROM accounts WHERE accountLower = ?').get(lower) as
    | { account: string; passHash: string }
    | undefined;
  if (!row || !verifyPassword(current, row.passHash)) {
    return { ok: false, status: 403, error: 'Your current password is not right.' };
  }
  if (next === current) return { ok: false, status: 422, error: 'Your new password must be different from your current one.' };
  const weak = passwordProblem(next, row.account);
  if (weak) return { ok: false, status: 422, error: weak };
  db.prepare('UPDATE accounts SET passHash = ? WHERE accountLower = ?').run(hashPassword(next), lower);
  db.prepare('DELETE FROM sessions WHERE accountLower = ? AND tokenHash != ?').run(lower, keepToken ? hashToken(keepToken) : '');
  return { ok: true };
}

// --- Roles + admin account management ------------------------------------------

export function getRole(account: string): 'admin' | 'user' | null {
  const row = db.prepare('SELECT role FROM accounts WHERE accountLower = ?').get(account.toLowerCase()) as
    | { role: 'admin' | 'user' }
    | undefined;
  return row ? row.role : null;
}

export function isAdmin(account: string | null | undefined): boolean {
  return !!account && getRole(account) === 'admin';
}

export function countAdmins(): number {
  return adminCount();
}

export function setRole(account: string, role: 'admin' | 'user'): void {
  db.prepare('UPDATE accounts SET role = ? WHERE accountLower = ?').run(role, account.toLowerCase());
}

export function setSuspended(account: string, suspended: boolean, reason: string | null): void {
  db.prepare('UPDATE accounts SET suspended = ?, suspendedReason = ? WHERE accountLower = ?')
    .run(suspended ? 1 : 0, suspended ? reason : null, account.toLowerCase());
  if (suspended) endSessions(account);
}

export function setPassword(account: string, password: string): void {
  db.prepare('UPDATE accounts SET passHash = ? WHERE accountLower = ?').run(hashPassword(password), account.toLowerCase());
  endSessions(account);
}

export function deleteAccount(account: string): void {
  const lower = account.toLowerCase();
  db.prepare('DELETE FROM sessions WHERE accountLower = ?').run(lower);
  db.prepare('DELETE FROM profiles WHERE accountLower = ?').run(lower);
  db.prepare('DELETE FROM bot_greeted WHERE accountLower = ?').run(lower);
  db.prepare('DELETE FROM accounts WHERE accountLower = ?').run(lower);
}

/** Find a member by name (any case): their proper spelling and when they joined. */
export function lookupAccount(name: string): { account: string; createdAt: number } | null {
  const n = name.trim();
  if (!validAccount(n)) return null;
  const row = db.prepare('SELECT account, createdAt FROM accounts WHERE accountLower = ?').get(n.toLowerCase()) as
    | { account: string; createdAt: number }
    | undefined;
  return row ?? null;
}

export function accountExists(account: string): boolean {
  return !!db.prepare('SELECT 1 FROM accounts WHERE accountLower = ?').get(account.toLowerCase());
}
