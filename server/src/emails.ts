/**
 * Confirming an email address, and resetting a forgotten password with it. Links last a limited time, work once,
 * and are stored only as a hash. Asking to reset a password always gets the same answer, so nobody can use it to
 * find out which usernames or email addresses are registered.
 */
import { createHash, randomBytes } from 'node:crypto';
import { db } from './db.js';
import { passwordProblem } from './security.js';
import { setPassword } from './accounts.js';
import { mailEnabled, publicUrl, sendMail } from './mail.js';

export const validEmail = (s: string): boolean => s.length <= 120 && /^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$/.test(s);

const VERIFY_MS = 24 * 3600_000;
const RESET_MS = 3600_000;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

type Kind = 'verify' | 'reset';

function makeToken(accountLower: string, kind: Kind, email: string): string {
  const token = randomBytes(24).toString('hex');
  const now = Date.now();
  // A newer link replaces older ones of the same kind.
  db.prepare('DELETE FROM email_tokens WHERE accountLower = ? AND kind = ?').run(accountLower, kind);
  db.prepare('INSERT INTO email_tokens (tokenHash, accountLower, kind, email, createdAt, expiresAt) VALUES (?,?,?,?,?,?)')
    .run(hash(token), accountLower, kind, email, now, now + (kind === 'verify' ? VERIFY_MS : RESET_MS));
  return token;
}

/** Remove links that have run out. */
export function pruneEmailTokens(): void {
  db.prepare('DELETE FROM email_tokens WHERE expiresAt < ?').run(Date.now());
}

export function emailOf(accountLower: string): { email: string | null; verified: boolean } {
  const r = db.prepare('SELECT email, emailVerifiedAt FROM accounts WHERE accountLower = ?').get(accountLower) as
    | { email: string | null; emailVerifiedAt: number | null }
    | undefined;
  return { email: r?.email ?? null, verified: !!r?.emailVerifiedAt };
}

const takenByAnother = (accountLower: string, email: string): boolean =>
  !!db
    .prepare('SELECT 1 FROM accounts WHERE lower(email) = ? AND emailVerifiedAt IS NOT NULL AND accountLower != ?')
    .get(email.toLowerCase(), accountLower);

/** Email a link that confirms this address belongs to the account. */
export async function startVerification(account: string, email: string): Promise<{ ok: boolean; error?: string }> {
  if (!mailEnabled()) return { ok: false, error: 'Email is not set up on this site yet.' };
  if (!validEmail(email)) return { ok: false, error: 'That does not look like an email address.' };
  const lower = account.toLowerCase();
  if (takenByAnother(lower, email)) return { ok: false, error: 'Another account already uses that email address.' };
  const token = makeToken(lower, 'verify', email);
  const r = await sendMail({
    to: email,
    subject: 'Confirm your email address for QChat',
    text:
      `Hello ${account},\n\nSomeone (hopefully you) added this email address to the QChat account "${account}".\n\n` +
      `To confirm it, open this link within 24 hours:\n\n${publicUrl()}/verify-email?token=${token}\n\n` +
      `Once it is confirmed you can use it to reset your password if you ever forget it.\n\n` +
      `If this was not you, ignore this message and nothing will change.\n\nQChat`,
  });
  return r.ok ? { ok: true } : { ok: false, error: 'We could not send the email just now. Please try again later.' };
}

/** Use a confirmation link. */
export async function confirmVerification(token: string): Promise<{ ok: boolean; error?: string; email?: string }> {
  const row = db.prepare("SELECT accountLower, email, expiresAt FROM email_tokens WHERE tokenHash = ? AND kind = 'verify'").get(hash(token)) as
    | { accountLower: string; email: string; expiresAt: number }
    | undefined;
  if (!row || row.expiresAt < Date.now()) return { ok: false, error: 'That link has expired or has already been used. Ask for a new one in your preferences.' };
  if (takenByAnother(row.accountLower, row.email)) return { ok: false, error: 'Another account already uses that email address.' };
  const before = emailOf(row.accountLower);
  db.prepare('UPDATE accounts SET email = ?, emailVerifiedAt = ? WHERE accountLower = ?').run(row.email, Date.now(), row.accountLower);
  db.prepare('DELETE FROM email_tokens WHERE accountLower = ? AND kind = ?').run(row.accountLower, 'verify');
  // The old address hears about the change, in case it was not them.
  if (before.verified && before.email && before.email.toLowerCase() !== row.email.toLowerCase()) {
    void sendMail({
      to: before.email,
      subject: 'The email address on your QChat account was changed',
      text: `The email address on your QChat account was changed to ${row.email}.\n\nIf this was not you, please contact the site administrators straight away.\n\nQChat`,
    });
  }
  return { ok: true, email: row.email };
}

/** Take the email off an account. */
export function removeEmail(account: string): void {
  db.prepare('UPDATE accounts SET email = NULL, emailVerifiedAt = NULL WHERE accountLower = ?').run(account.toLowerCase());
  db.prepare('DELETE FROM email_tokens WHERE accountLower = ?').run(account.toLowerCase());
}

/**
 * Someone says they forgot their password. If the username or address belongs to an account with a confirmed email,
 * it gets a reset link. Either way the caller says the same thing back.
 */
export async function startPasswordReset(identifier: string): Promise<void> {
  if (!mailEnabled()) return;
  const id = identifier.trim().toLowerCase().slice(0, 130);
  if (!id) return;
  const row = (id.includes('@')
    ? db.prepare('SELECT account, accountLower, email FROM accounts WHERE lower(email) = ? AND emailVerifiedAt IS NOT NULL').get(id)
    : db.prepare('SELECT account, accountLower, email FROM accounts WHERE accountLower = ? AND emailVerifiedAt IS NOT NULL').get(id)) as
    | { account: string; accountLower: string; email: string }
    | undefined;
  if (!row) return;
  const token = makeToken(row.accountLower, 'reset', row.email);
  await sendMail({
    to: row.email,
    subject: 'Reset your QChat password',
    text:
      `Hello ${row.account},\n\nSomeone asked to reset the password for the QChat account "${row.account}".\n\n` +
      `To choose a new password, open this link within one hour:\n\n${publicUrl()}/reset-password?token=${token}\n\n` +
      `If you did not ask for this, ignore this message. Your password stays as it is.\n\nQChat`,
  });
}

/** Choose a new password with a reset link. Everyone signed in as that member is signed out. */
export async function finishPasswordReset(token: string, password: string): Promise<{ ok: boolean; error?: string; account?: string }> {
  const row = db.prepare("SELECT accountLower, email, expiresAt FROM email_tokens WHERE tokenHash = ? AND kind = 'reset'").get(hash(token)) as
    | { accountLower: string; email: string; expiresAt: number }
    | undefined;
  if (!row || row.expiresAt < Date.now()) return { ok: false, error: 'That link has expired or has already been used. Ask for a new one.' };
  const acct = db.prepare('SELECT account FROM accounts WHERE accountLower = ?').get(row.accountLower) as { account: string } | undefined;
  if (!acct) return { ok: false, error: 'That account no longer exists.' };
  const weak = passwordProblem(password, acct.account);
  if (weak) return { ok: false, error: weak };
  setPassword(acct.account, password);
  db.prepare('DELETE FROM email_tokens WHERE accountLower = ? AND kind = ?').run(row.accountLower, 'reset');
  void sendMail({
    to: row.email,
    subject: 'Your QChat password was changed',
    text: `The password for the QChat account "${acct.account}" was just changed using a reset link, and everyone signed in was signed out.\n\nIf this was not you, please contact the site administrators straight away.\n\nQChat`,
  });
  return { ok: true, account: acct.account };
}
