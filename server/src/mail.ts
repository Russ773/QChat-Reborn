/**
 * Sending email. QChat only ever sends a few kinds of mail (confirm an address, reset a password, a security notice),
 * and only because someone asked. It hands each message to the mail server on this machine, so no outside service
 * sees anyone's address, and it limits how much it sends so a problem here can never harm the server's good name.
 *
 * Volume is kept deliberately low (5 a minute, 200 a day, 3 an hour and 10 a day to any one address), the server is
 * left alone for 15 minutes after repeated failures, and an address the mail server has refused is not tried again.
 *
 * MAIL_TRANSPORT: "smtp" (hand to SMTP_HOST:SMTP_PORT, default 127.0.0.1:25, no login), "file" (write each mail
 * to a file, for tests), or "off" (the default: nothing is sent and the email features are hidden).
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { dataDir, db } from './db.js';

export type MailMode = 'smtp' | 'file' | 'off';

export function mailMode(): MailMode {
  const m = (process.env.MAIL_TRANSPORT ?? '').toLowerCase();
  if (m === 'smtp' || m === 'file' || m === 'off') return m;
  return process.env.SMTP_HOST ? 'smtp' : 'off';
}
export const mailEnabled = (): boolean => mailMode() !== 'off';

export const mailFrom = (): string => process.env.MAIL_FROM || 'QChat <noreply@qchat.co.uk>';

/** The public address of the site, for links in emails. */
export const publicUrl = (): string => (process.env.QCHAT_PUBLIC_URL || (process.env.ALLOWED_ORIGINS ?? '').split(',')[0].trim() || 'http://localhost:8080').replace(/\/+$/, '');

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

// --- Limits: these protect the server's reputation, so they cannot be switched off by RATE_LIMITS=off ---------

const num = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const sent: number[] = [];
const byAddress = new Map<string, number[]>();
let failures = 0;
let pausedUntil = 0;

const isBad = (to: string): boolean => !!db.prepare('SELECT 1 FROM mail_bad WHERE address = ? AND ts > ?').get(to.toLowerCase(), Date.now() - 30 * 86_400_000);
const markBad = (to: string): void => void db.prepare('INSERT OR REPLACE INTO mail_bad (address, ts) VALUES (?, ?)').run(to.toLowerCase(), Date.now());

function allowed(to: string, now = Date.now()): string | null {
  if (now < pausedUntil) return 'the pause after repeated failures';
  while (sent.length > 0 && now - sent[0] > 86_400_000) sent.shift();
  if (sent.length >= num('MAIL_PER_DAY', 200)) return 'the daily limit';
  if (sent.filter((t) => now - t < 60_000).length >= num('MAIL_PER_MINUTE', 5)) return 'the per minute limit';
  const key = to.toLowerCase();
  const mine = (byAddress.get(key) ?? []).filter((t) => now - t < 86_400_000);
  if (mine.filter((t) => now - t < 3_600_000).length >= num('MAIL_PER_ADDRESS_HOUR', 3)) return 'the limit for one address';
  if (mine.length >= num('MAIL_PER_ADDRESS_DAY', 10)) return 'the daily limit for one address';
  mine.push(now);
  byAddress.set(key, mine);
  if (byAddress.size > 2000) byAddress.clear();
  sent.push(now);
  return null;
}

// --- Writing and handing over the message ----------------------------------------------------------------------

const address = (s: string): string => (/<([^>]+)>/.exec(s)?.[1] ?? s).trim();

function build(m: Mail): string {
  const from = mailFrom();
  const domain = address(from).split('@')[1] ?? 'localhost';
  const headers = [
    `From: ${from}`,
    `To: ${m.to}`,
    ...(process.env.MAIL_REPLY_TO ? [`Reply-To: ${process.env.MAIL_REPLY_TO}`] : []),
    `Subject: ${/^[\x20-\x7e]*$/.test(m.subject) ? m.subject : `=?UTF-8?B?${Buffer.from(m.subject).toString('base64')}?=`}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${randomBytes(12).toString('hex')}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    // Tells other mail systems not to answer this with out-of-office replies and the like.
    'Auto-Submitted: auto-generated',
    'X-Auto-Response-Suppress: All',
  ];
  const body = Buffer.from(m.text, 'utf8').toString('base64').replace(/.{1,76}/g, '$&\r\n');
  return `${headers.join('\r\n')}\r\n\r\n${body}`;
}

/** A very small SMTP client for a mail server on this machine. */
function smtpSend(host: string, port: number, to: string, message: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    socket.setEncoding('utf8');
    socket.setTimeout(20_000, () => finish(new Error('The mail server did not answer in time.')));
    let buffer = '';
    let step = 0;
    let done = false;
    const finish = (err?: Error & { permanent?: boolean }) => {
      if (done) return;
      done = true;
      socket.destroy();
      if (err) reject(err);
      else resolve();
    };
    const say = (line: string) => socket.write(`${line}\r\n`);
    const helo = process.env.MAIL_HELO || hostname() || 'localhost';
    const plan: { send?: () => void; expect: string }[] = [
      { expect: '2' }, // greeting
      { send: () => say(`EHLO ${helo}`), expect: '2' },
      { send: () => say(`MAIL FROM:<${address(mailFrom())}>`), expect: '2' },
      { send: () => say(`RCPT TO:<${address(to)}>`), expect: '2' },
      { send: () => say('DATA'), expect: '3' },
      { send: () => socket.write(`${message.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..')}\r\n.\r\n`), expect: '2' },
      { send: () => say('QUIT'), expect: '2' },
    ];
    socket.on('error', (e) => finish(e));
    socket.on('close', () => finish(step >= plan.length - 1 ? undefined : new Error('The mail server closed the connection.')));
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      // A reply is complete at a line like "250 text" (a dash after the code means more lines follow).
      for (;;) {
        const m = /^(\d{3})([ -])[^\r\n]*\r?\n/m.exec(buffer);
        if (!m) return;
        const lines = buffer.split(/\r?\n/);
        const last = lines.findIndex((l) => /^\d{3} /.test(l));
        if (last < 0) return;
        const code = lines[last].slice(0, 3);
        buffer = lines.slice(last + 1).join('\r\n');
        if (!code.startsWith(plan[step].expect)) {
          // A 5xx answer to the recipient means that address will never work.
          return finish(Object.assign(new Error(`The mail server said: ${lines[last].slice(0, 120)}`), { permanent: step === 3 && code.startsWith('5') }));
        }
        step++;
        if (step >= plan.length) return finish();
        plan[step].send?.();
      }
    });
  });
}

let outboxCount = 0;

/** Send one email. Never throws: the result says whether it went (or why not). */
export async function sendMail(m: Mail): Promise<{ ok: boolean; reason?: string }> {
  const mode = mailMode();
  if (mode === 'off') return { ok: false, reason: 'email is not set up' };
  if (!/^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$/.test(m.to) || /[\r\n]/.test(m.to)) return { ok: false, reason: 'not a valid address' };
  if (isBad(m.to)) return { ok: false, reason: 'that address was refused before' };
  const limit = allowed(m.to);
  if (limit) {
    console.log(`[qchat] email not sent: over ${limit}`);
    return { ok: false, reason: limit };
  }
  try {
    if (mode === 'file') {
      const dir = join(dataDir, 'outbox');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${String(Date.now())}-${String(++outboxCount).padStart(4, '0')}.json`), JSON.stringify({ ...m, from: mailFrom() }, null, 2));
      return { ok: true };
    }
    await smtpSend(process.env.SMTP_HOST || '127.0.0.1', num('SMTP_PORT', 25), m.to, build(m));
    failures = 0;
    return { ok: true };
  } catch (e) {
    console.log(`[qchat] email failed: ${String(e).slice(0, 160)}`);
    if ((e as { permanent?: boolean }).permanent) {
      markBad(m.to); // that address is wrong, not the server
    } else if (++failures >= 3) {
      failures = 0;
      pausedUntil = Date.now() + num('MAIL_PAUSE_SECONDS', 900) * 1000;
      console.log(`[qchat] email sending paused for ${num('MAIL_PAUSE_SECONDS', 900)} seconds after repeated failures`);
    }
    return { ok: false, reason: 'the mail server refused it' };
  }
}
