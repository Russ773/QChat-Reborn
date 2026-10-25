// Started by tests/run.mjs: the real SMTP conversation. This file runs a tiny mail server of its own, and QChat
// (set to MAIL_TRANSPORT=smtp, port 8225) hands it the emails.
import { createServer } from 'node:net';

const B = 'http://localhost:8199';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  -> ' + extra : '')); };

const received = [];
const attempts = []; // every RCPT TO the server saw
let mode = 'good'; // good | reject (refuses the message) | badrcpt (refuses one recipient)
function startMail() {
  const server = createServer((socket) => {
    const log = [];
    let data = null;
    let buf = '';
    socket.setEncoding('utf8');
    socket.write('220 test.example ESMTP ready\r\n');
    socket.on('data', (chunk) => {
      buf += chunk;
      for (;;) {
        if (data !== null) {
          const end = buf.indexOf('\r\n.\r\n');
          if (end < 0) return;
          data += buf.slice(0, end);
          buf = buf.slice(end + 5);
          received.push({ log: [...log], message: data });
          data = null;
          socket.write(mode === 'reject' ? '554 5.7.1 rejected\r\n' : '250 2.0.0 queued\r\n');
          continue;
        }
        const i = buf.indexOf('\r\n');
        if (i < 0) return;
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        log.push(line);
        if (/^EHLO/i.test(line)) socket.write('250-test.example\r\n250-SIZE 1000000\r\n250 8BITMIME\r\n');
        else if (/^MAIL FROM/i.test(line)) socket.write('250 ok\r\n');
        else if (/^RCPT TO/i.test(line)) {
          attempts.push(line);
          socket.write(mode === 'badrcpt' && /gone@/.test(line) ? '550 5.1.1 user unknown\r\n' : '250 ok\r\n');
        } else if (/^DATA/i.test(line)) { socket.write('354 go ahead\r\n'); data = ''; }
        else if (/^QUIT/i.test(line)) { socket.write('221 bye\r\n'); socket.end(); }
        else socket.write('500 what\r\n');
      }
    });
  });
  return new Promise((r) => server.listen(8225, '127.0.0.1', () => r(server)));
}
let mail = await startMail();

const api = async (method, path, token, body) => {
  const r = await fetch(B + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch {}
  return { s: r.status, j, text };
};
const PW = 'smtppass-123';

let r = await api('POST', '/api/register', null, { account: 'Smtp', password: PW, email: 'smtp@example.com', agree: true });
check('signing up works', r.s === 200);
await wait(1200);
check('the mail server got one message', received.length === 1);
const got = received[0];
check('the conversation is the right one', got && /^EHLO /.test(got.log[0]) && got.log[1] === 'MAIL FROM:<noreply@qchat.co.uk>' && got.log[2] === 'RCPT TO:<smtp@example.com>' && got.log[3] === 'DATA' && got.log.length === 4, JSON.stringify(got?.log));
const [head, body] = (got?.message ?? '').split('\r\n\r\n');
check('it has the usual headers', /^From: QChat <noreply@qchat\.co\.uk>$/m.test(head) && /^To: smtp@example\.com$/m.test(head) && /^Subject: Confirm your email address for QChat$/m.test(head) && /^Message-ID: <[a-f0-9]{24}@qchat\.co\.uk>$/m.test(head) && /^Date: .+\+0000$/m.test(head), head);
check('replies go to the contact mailbox', /^Reply-To: contact@qchat\.co\.uk$/m.test(head));
check('and it is marked as automatic, so replies like "out of office" are not sent back', /^Auto-Submitted: auto-generated$/m.test(head) && /^X-Auto-Response-Suppress: All$/m.test(head));
const text = Buffer.from((body ?? '').replace(/\r\n/g, ''), 'base64').toString('utf8');
check('the body reads properly and holds the link', /Hello Smtp/.test(text) && /https:\/\/example\.test\/verify-email\?token=[a-f0-9]{48}/.test(text), text.slice(0, 120));
check('no line in the message is too long for mail servers', (body ?? '').split('\r\n').every((l) => l.length <= 76));
const t = r.j.token;

// An address the mail server says does not exist is never tried again.
mode = 'badrcpt';
r = await api('POST', '/api/email', t, { email: 'gone@example.com', password: PW });
check('an address the mail server refuses is reported as a failure', r.s === 422 && /could not send/i.test(r.j.error), r.text);
const tries = attempts.filter((a) => /gone@/.test(a)).length;
r = await api('POST', '/api/email', t, { email: 'gone@example.com', password: PW });
check('and is not tried a second time', r.s === 422 && attempts.filter((a) => /gone@/.test(a)).length === tries && tries === 1, `${tries} then ${attempts.filter((a) => /gone@/.test(a)).length}`);
mode = 'good';
r = await api('POST', '/api/email', t, { email: 'fine@example.com', password: PW });
check('other addresses still work', r.s === 200 && attempts.some((a) => /fine@/.test(a)), r.text);

// A mail server that keeps saying no is left alone for a while.
mode = 'reject';
const before = received.length;
for (const e of ['one', 'two', 'three']) await api('POST', '/api/email', t, { email: `${e}@example.com`, password: PW });
await wait(300);
check('a mail server that refuses messages is tried, and the member is told', received.length === before + 3);
mode = 'good';
r = await api('POST', '/api/email', t, { email: 'four@example.com', password: PW });
check('after three failures in a row it stops sending for a while', r.s === 422 && received.length === before + 3, `${received.length} vs ${before + 3}`);
await wait(3500); // the test server pauses for 3 seconds
r = await api('POST', '/api/email', t, { email: 'five@example.com', password: PW });
check('and starts again afterwards', r.s === 200 && received.length === before + 4, r.text);

// Nobody listening at all.
mail.close();
await wait(200);
r = await api('POST', '/api/email', t, { email: 'later@example.com', password: PW });
check('with no mail server at all, it fails politely rather than hanging', r.s === 422 && /could not send/i.test(r.j.error), r.text);
r = await api('GET', '/healthz');
check('and the site is fine', r.s === 200);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
