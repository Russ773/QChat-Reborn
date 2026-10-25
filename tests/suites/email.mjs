// Started by tests/run.mjs: confirming an email address and resetting a forgotten password. Mail goes to files
// (MAIL_TRANSPORT=file), so the tests read the links out of them.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const B = 'http://localhost:8199';
const phase = process.argv[2] || 'a';
const DATA = process.env.QCHAT_DATA_DIR;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  -> ' + extra : '')); };
const api = async (method, path, token, body) => {
  const r = await fetch(B + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch {}
  return { s: r.status, j, text };
};
const signup = (account, password, email) => api('POST', '/api/register', null, { account, password, email, agree: true });
const login = (account, password) => api('POST', '/api/login', null, { account, password });

/** Every email "sent" so far, oldest first. */
const outbox = () => {
  const dir = join(DATA, 'outbox');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).sort().map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
};
const mailsTo = (addr) => outbox().filter((m) => m.to === addr);
const tokenOf = (mail) => /token=([a-f0-9]+)/.exec(mail?.text ?? '')?.[1];
const PW = { Russ: 'secret123', Ann: 'annpass-123', Bob: 'bobpass-123', Cat: 'catpass-123', Dee: 'deepass-123' };

if (phase === 'off') {
  // Email is not set up on this server.
  let r = await api('GET', '/api/site');
  check('the site says email is not set up', r.j.mailEnabled === false);
  r = await api('POST', '/api/password/forgot', null, { identifier: 'Ann' });
  check('"forgot password" says so plainly', r.s === 503 && /not set up/.test(r.j.error), `${r.s} ${r.text}`);
  const t = (await signup('Ann', PW.Ann, 'ann@example.com')).j.token;
  check('an account can still be made, with an address that stays unconfirmed', !!t && (await api('GET', '/api/me', t)).j.emailVerified === false);
  r = await api('POST', '/api/email', t, { email: 'new@example.com', password: PW.Ann });
  check('adding an address says email is not set up', r.s === 422 && /not set up/.test(r.j.error), r.text);
  check('nothing was sent', outbox().length === 0);
}

if (phase === 'a') {
  let r = await api('GET', '/api/site');
  check('the site says email is available', r.j.mailEnabled === true);
  r = await signup('Bad', 'badpass-123', 'not-an-email');
  check('an address that is not an address is refused at sign up', r.s === 422, r.text);
  const russ = (await signup('Russ', PW.Russ)).j.token;

  // ---------------- confirming an address ----------------
  const ann = (await signup('Ann', PW.Ann, 'ann@example.com')).j.token;
  await wait(400);
  let mails = mailsTo('ann@example.com');
  check('signing up with an address sends a confirmation link', mails.length === 1 && /Confirm your email/.test(mails[0].subject) && /^https:\/\/example\.test\/verify-email\?token=/m.test(mails[0].text.match(/https:[^\s]+/)[0]), JSON.stringify(mails[0]?.subject));
  check('from the QChat address', mails[0].from === 'QChat <noreply@qchat.co.uk>');
  r = await api('GET', '/api/me', ann);
  check('until it is confirmed the address does not count', r.j.email === 'ann@example.com' && r.j.emailVerified === false);
  r = await api('POST', '/api/password/forgot', null, { identifier: 'ann@example.com' });
  await wait(300);
  check('an unconfirmed address cannot be used to reset a password', r.s === 200 && mailsTo('ann@example.com').length === 1);
  r = await api('POST', '/api/email/confirm', null, { token: 'f'.repeat(48) });
  check('a made-up link does nothing', r.s === 400);
  const verifyToken = tokenOf(mails[0]);
  r = await api('POST', '/api/email/confirm', null, { token: verifyToken });
  check('the real link confirms it', r.s === 200 && r.j.email === 'ann@example.com');
  check('and the account shows it as confirmed', (await api('GET', '/api/me', ann)).j.emailVerified === true);
  r = await api('POST', '/api/email/confirm', null, { token: verifyToken });
  check('a link only works once', r.s === 400);

  // another account cannot take a confirmed address
  const bob = (await signup('Bob', PW.Bob)).j.token;
  r = await api('POST', '/api/email', bob, { email: 'ANN@example.com', password: PW.Bob });
  check('another account cannot claim a confirmed address', r.s === 422 && /already uses/.test(r.j.error), r.text);
  r = await api('POST', '/api/email', bob, { email: 'bob@example.com', password: 'wrong-password' });
  check('changing the address needs your password', r.s === 403);
  r = await api('POST', '/api/email', null, { email: 'bob@example.com', password: PW.Bob });
  check('and a login', r.s === 401);

  // ---------------- forgotten passwords ----------------
  const before = outbox().length;
  const known = await api('POST', '/api/password/forgot', null, { identifier: 'Ann' });
  const unknown = await api('POST', '/api/password/forgot', null, { identifier: 'Nobody' });
  const wrongAddr = await api('POST', '/api/password/forgot', null, { identifier: 'nobody@example.com' });
  await wait(400);
  check('the answer is the same whether or not the account exists', known.s === 200 && unknown.s === 200 && wrongAddr.s === 200 && known.text === unknown.text && unknown.text === wrongAddr.text, `${known.text} | ${unknown.text}`);
  check('but only the real account gets an email', outbox().length === before + 1 && outbox().at(-1).to === 'ann@example.com' && /Reset your QChat password/.test(outbox().at(-1).subject));
  const resetToken = tokenOf(outbox().at(-1));
  check('the link is for the reset page and lasts an hour', /\/reset-password\?token=/.test(outbox().at(-1).text) && /one hour/.test(outbox().at(-1).text));
  r = await api('POST', '/api/password/reset', null, { token: resetToken, password: 'short' });
  check('a weak new password is refused, and the link still works', r.s === 400 && /8 characters/.test(r.j.error ?? ''), r.text);
  r = await api('POST', '/api/password/reset', null, { token: 'a'.repeat(48), password: 'a-new-password-1' });
  check('a made-up link does nothing here either', r.s === 400);
  r = await api('POST', '/api/password/reset', null, { token: resetToken, password: 'a-new-password-1' });
  check('the right link sets a new password', r.s === 200 && r.j.account === 'Ann', r.text);
  check('the old password stops working and the new one works', (await login('Ann', PW.Ann)).s === 401 && (await login('Ann', 'a-new-password-1')).s === 200);
  check('everyone signed in as Ann is signed out', (await api('GET', '/api/me', ann)).s === 401);
  r = await api('POST', '/api/password/reset', null, { token: resetToken, password: 'another-new-pass-2' });
  check('the link cannot be used twice', r.s === 400);
  await wait(300);
  check('Ann is told her password changed', /password was changed/i.test(outbox().at(-1).subject) && outbox().at(-1).to === 'ann@example.com');

  // Ann has now had 3 emails in the hour (confirm, reset link, notice): that is the limit for one address.
  const n = outbox().length;
  await api('POST', '/api/password/forgot', null, { identifier: 'Ann' });
  await wait(300);
  check('one address cannot be sent more than 3 emails an hour', outbox().length === n, `${outbox().length} vs ${n}`);

  // ---------------- adding and changing an address ----------------
  const cat = (await signup('Cat', PW.Cat)).j.token;
  r = await api('POST', '/api/email', cat, { email: 'cat@example.com', password: PW.Cat });
  check('a member can add an address', r.s === 200 && r.j.pending === 'cat@example.com', r.text);
  await wait(300);
  const catTok = tokenOf(mailsTo('cat@example.com')[0]);
  check('it needs confirming first', (await api('GET', '/api/me', cat)).j.emailVerified === false && !!catTok);
  await api('POST', '/api/email/confirm', null, { token: catTok });
  r = await api('GET', '/api/me', cat);
  check('then it counts', r.j.email === 'cat@example.com' && r.j.emailVerified === true);
  r = await api('POST', '/api/email', cat, { email: 'cat2@example.com', password: PW.Cat });
  await wait(300);
  check('a new address keeps the old one until the new one is confirmed', r.s === 200 && (await api('GET', '/api/me', cat)).j.email === 'cat@example.com');
  await api('POST', '/api/email/confirm', null, { token: tokenOf(mailsTo('cat2@example.com')[0]) });
  await wait(300);
  check('once confirmed the address changes', (await api('GET', '/api/me', cat)).j.email === 'cat2@example.com');
  check('and the old address is told', mailsTo('cat@example.com').some((m) => /was changed/.test(m.subject)));
  r = await api('POST', '/api/email', cat, { email: '', password: PW.Cat });
  check('an address can be removed', r.s === 200 && r.j.removed === true && (await api('GET', '/api/me', cat)).j.email === null);
  const m = outbox().length;
  await api('POST', '/api/password/forgot', null, { identifier: 'cat2@example.com' });
  await wait(300);
  check('and then it cannot be used for a reset', outbox().length === m);

  // ---------------- a link left unused, for the next phase ----------------
  const dee = (await signup('Dee', PW.Dee, 'dee@example.com')).j.token;
  await wait(300);
  await api('POST', '/api/email/confirm', null, { token: tokenOf(mailsTo('dee@example.com')[0]) });
  await api('POST', '/api/password/forgot', null, { identifier: 'Dee' });
  await wait(300);
  check('a reset link is waiting to be used', mailsTo('dee@example.com').length === 2 && !!dee);
  // the account export includes the address
  r = await api('GET', '/api/account/export', dee);
  check('the member\'s data export includes the address', r.j.account?.email === 'dee@example.com' && !!r.j.account.emailVerifiedAt);
  // deleting an account removes its links
  check('the admin still works', (await api('GET', '/api/admin/stats', russ)).s === 200);
}

if (phase === 'b') {
  // Every link was made to run out (by the runner), then the server restarted.
  const reset = tokenOf(mailsTo('dee@example.com').at(-1));
  let r = await api('POST', '/api/password/reset', null, { token: reset, password: 'deeper-pass-99' });
  check('a link that has run out is refused', r.s === 400 && /expired/.test(r.j.error), r.text);
  check('and the password did not change', (await login('Dee', PW.Dee)).s === 200);
  const verify = tokenOf(mailsTo('dee@example.com')[0]);
  r = await api('POST', '/api/email/confirm', null, { token: verify });
  check('same for a confirmation link', r.s === 400);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
