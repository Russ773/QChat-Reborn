import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { validAccount } from '@qchat/shared';
import { db } from './db.js';

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

export interface RegisterResult {
  ok: boolean;
  account?: string;
  error?: string;
}

export function register(account: string, email: string, password: string): RegisterResult {
  account = account.trim();
  if (!validAccount(account)) {
    return { ok: false, error: 'Username must be 2 to 24 letters, numbers, _ or -.' };
  }
  if (password.length < 6) {
    return { ok: false, error: 'Password must be at least 6 characters.' };
  }
  const lower = account.toLowerCase();
  if (db.prepare('SELECT 1 FROM accounts WHERE accountLower = ?').get(lower)) {
    return { ok: false, error: 'That username is already taken.' };
  }
  const now = Date.now();
  db.prepare('INSERT INTO accounts (accountLower, account, email, passHash, createdAt) VALUES (?,?,?,?,?)')
    .run(lower, account, email || null, hashPassword(password), now);
  db.prepare('INSERT OR IGNORE INTO profiles (accountLower, account, updatedAt) VALUES (?,?,?)')
    .run(lower, account, now);
  return { ok: true, account };
}

export function login(account: string, password: string): string | null {
  const row = db
    .prepare('SELECT account, passHash FROM accounts WHERE accountLower = ?')
    .get(account.trim().toLowerCase()) as { account: string; passHash: string } | undefined;
  if (!row) return null;
  return verifyPassword(password, row.passHash) ? row.account : null;
}

export function createSession(account: string): string {
  const token = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, accountLower, createdAt) VALUES (?,?,?)')
    .run(token, account.toLowerCase(), Date.now());
  return token;
}

export function accountForToken(token: string | undefined): string | null {
  if (!token) return null;
  const row = db
    .prepare(
      'SELECT a.account AS account FROM sessions s JOIN accounts a ON a.accountLower = s.accountLower WHERE s.token = ?',
    )
    .get(token) as { account: string } | undefined;
  return row ? row.account : null;
}

export function logout(token: string | undefined): void {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}
