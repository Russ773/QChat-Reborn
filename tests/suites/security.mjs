import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

// Started by tests/run.mjs (see the suite list there for the server settings this file expects).
const B = 'http://localhost:8199', WSURL = 'ws://localhost:8199/ws';
const phase = process.argv[2] || 'a';
const DATA = process.env.QCHAT_DATA_DIR;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  -> ' + extra : '')); };
const sha = (s) => createHash('sha256').update(s).digest('hex');
const require = createRequire(import.meta.url);
const WS = require('ws');

async function raw(method, path, { token, body, ip, headers = {} } = {}) {
  const h = { ...(body ? { 'content-type': 'application/json' } : {}), ...headers };
  if (token) h.authorization = 'Bearer ' + token;
  if (ip) h['x-forwarded-for'] = ip;
  const r = await fetch(B + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  return r;
}
async function api(method, path, token, body, ip) {
  const r = await raw(method, path, { token, body, ip });
  let j = {}; try { j = await r.json(); } catch {}
  return { s: r.status, j, h: r.headers };
}
const login = (account, password, ip) => api('POST', '/api/login', null, { account, password }, ip);
const register = (account, password, ip) => api('POST', '/api/register', null, { account, password }, ip);

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

if (phase === 'a') {
  // ---------------- security headers ----------------
  let r = await raw('GET', '/');
  const hd = (n) => r.headers.get(n) ?? '';
  const csp = hd('content-security-policy');
  check('the page has a Content-Security-Policy', /default-src 'self'/.test(csp) && /frame-ancestors 'none'/.test(csp) && /object-src 'none'/.test(csp));
  check('scripts are limited to our own and YouTube (no inline)', /script-src 'self' https:\/\/www\.youtube\.com/.test(csp) && !/script-src[^;]*unsafe-inline/.test(csp));
  check('nosniff, no framing, referrer and permissions policies', hd('x-content-type-options') === 'nosniff' && hd('x-frame-options') === 'DENY' && /strict-origin/.test(hd('referrer-policy')) && /camera=\(\)/.test(hd('permissions-policy')));
  check('no HSTS over plain http', hd('strict-transport-security') === '');
  r = await raw('GET', '/', { headers: { 'x-forwarded-proto': 'https' } });
  check('HSTS is sent when the visitor is on https', /max-age=31536000/.test(r.headers.get('strict-transport-security') ?? ''));
  r = await raw('GET', '/');
  const html = await r.text();
  check('the page itself is never cached for long', r.headers.get('cache-control') === 'no-cache');
  const asset = html.match(/\/assets\/[^"']+\.js/)?.[0];
  r = await raw('GET', asset);
  check('built files are cached for good', /immutable/.test(r.headers.get('cache-control') ?? '') && (r.headers.get('content-security-policy') ?? '') !== '');
  r = await raw('GET', '/api/site');
  check('API replies are never cached and carry the headers', r.headers.get('cache-control') === 'no-store' && !!r.headers.get('content-security-policy'));
  r = await raw('GET', '/api/nothing-here');
  check('even an API 404 carries the headers', r.status === 404 && r.headers.get('x-frame-options') === 'DENY');

  // ---------------- file serving ----------------
  for (const p of ['/..%2f..%2fpackage.json', '/%2e%2e/%2e%2e/package.json', '/..%5c..%5cpackage.json', '/assets/..%2f..%2f..%2fserver%2fpackage.json']) {
    r = await raw('GET', p); const t = await r.text();
    check('path trick ' + p + ' leaks nothing', !/"workspaces"|"@qchat\/server"/.test(t));
  }
  r = await raw('GET', '/avatars/..%2f..%2fqchat.db'); let b = Buffer.from(await r.arrayBuffer());
  check('avatar path trick cannot fetch the database', r.status === 404 && !b.subarray(0, 15).toString().startsWith('SQLite format'));
  r = await raw('GET', '/uploads/..%2fqchat.db'); b = Buffer.from(await r.arrayBuffer());
  check('upload path trick cannot fetch the database', r.status === 404 && !b.subarray(0, 15).toString().startsWith('SQLite format'));

  // ---------------- passwords ----------------
  const ip = (n) => `10.1.0.${n}`;
  for (const [label, pw, name] of [['too short (7)', 'abc1234', 'Pw1'], ['a common password', 'password123', 'Pw2'], ['all one character', 'zzzzzzzzzz', 'Pw3'], ['the same as the username', 'Alexander1', 'Alexander1'], ['too long', 'x'.repeat(200) + '1', 'Pw5']]) {
    r = await register(name, pw, ip(1));
    check('refuses a password that is ' + label, r.s === 422 && !r.j.token, r.j.error);
  }
  r = await register('GoodPw', 'tr1cky-horse-staple', ip(1));
  check('accepts a sensible password', r.s === 200 && !!r.j.token);
  const goodTok = r.j.token;
  r = await register('Russ', 'secret123', ip(2));
  const russ = r.j.token;
  r = await api('POST', '/api/admin/users/GoodPw/password', russ, { password: 'password1' }, ip(2));
  check('an admin cannot set a weak password either', r.s === 422, r.j.error);

  // ---------------- sessions ----------------
  const db = new DatabaseSync(DATA + '/qchat.db', { readOnly: true });
  const stored = db.prepare('SELECT tokenHash, lastUsed FROM sessions').all().map((x) => x.tokenHash);
  const allText = JSON.stringify(db.prepare('SELECT * FROM sessions').all());
  check('only a hash of the login token is stored', stored.includes(sha(goodTok)) && !allText.includes(goodTok));
  r = await api('GET', '/api/me', goodTok, null, ip(1));
  check('the token works', r.s === 200 && r.j.account === 'GoodPw');
  await api('POST', '/api/logout', goodTok, null, ip(1));
  r = await api('GET', '/api/me', goodTok, null, ip(1));
  check('logging out ends the login', r.s === 401);
  check('and removes it from the database', !db.prepare('SELECT 1 FROM sessions WHERE tokenHash = ?').get(sha(goodTok)));
  r = await api('GET', '/api/me', 'not-a-token', null, ip(1));
  check('a made-up token is refused', r.s === 401);
  db.close();

  // ---------------- login throttling ----------------
  await register('Victim', 'victim-pass-1', ip(3));
  await register('Bystander', 'bystander-pass-1', ip(3));
  const A = ip(10), Bq = ip(11);
  const codes = [];
  for (let i = 0; i < 6; i++) codes.push((await login('Victim', 'wrong-' + i, A)).s);
  check('six wrong passwords are just refused', codes.every((c) => c === 401), codes.join());
  r = await login('Victim', 'victim-pass-1', A);
  check('then even the right password is blocked from that address', r.s === 429 && /wait/i.test(r.j.error) && !!r.h.get('retry-after'), `${r.s} ${r.j.error} retry-after=${r.h.get('retry-after')}`);
  r = await login('Victim', 'victim-pass-1', Bq);
  check('the real owner on another address is not locked out', r.s === 200);
  r = await login('Bystander', 'bystander-pass-1', A);
  check('other accounts from the blocked address still work', r.s === 200);

  const C = ip(12);
  for (let i = 0; i < 3; i++) await login('Victim', 'nope' + i, C);
  r = await login('Victim', 'victim-pass-1', C);
  check('a successful login clears the count', r.s === 200);
  for (let i = 0; i < 3; i++) await login('Victim', 'nope' + i, C);
  r = await login('Victim', 'victim-pass-1', C);
  check('...so earlier failures do not add up', r.s === 200);

  const D = ip(13);
  for (let i = 0; i < 30; i++) await login('nobody-' + i, 'whatever-' + i, D);
  r = await login('Bystander', 'bystander-pass-1', D);
  check('one address guessing across many accounts gets blocked entirely', r.s === 429);
  r = await login('Bystander', 'bystander-pass-1', ip(14));
  check('...but other addresses are fine', r.s === 200);

  await register('Target', 'target-pass-1', ip(3));
  for (let i = 0; i < 40; i++) await login('Target', 'guess-' + i, `10.9.${Math.floor(i / 200)}.${i + 1}`);
  r = await login('Target', 'target-pass-1', ip(15));
  check('a spread-out attack on one account is stopped too', r.s === 429);

  // ---------------- change-password throttling ----------------
  const pg = await register('Pwguess', 'guess-pass-9', ip(16));
  const pc = [];
  for (let i = 0; i < 5; i++) pc.push((await api('POST', '/api/password', pg.j.token, { current: 'nope-' + i, next: 'another-pass-9' }, ip(16))).s);
  check('five wrong current passwords on the change screen are refused', pc.every((c) => c === 403), pc.join());
  r = await api('POST', '/api/password', pg.j.token, { current: 'guess-pass-9', next: 'another-pass-9' }, ip(16));
  check('then even the right one is blocked, so a stolen login cannot guess it', r.s === 429, String(r.s));
  r = await login('Pwguess', 'another-pass-9', ip(17));
  check('and the password was not changed', r.s === 401);

  // ---------------- delete-account throttling ----------------
  const dg = await register('Delguess', 'delete-pass-9', ip(18));
  const dc = [];
  for (let i = 0; i < 5; i++) dc.push((await api('DELETE', '/api/account', dg.j.token, { password: 'nope-' + i }, ip(18))).s);
  check('five wrong passwords on the delete screen are refused', dc.every((c) => c === 403), dc.join());
  r = await api('DELETE', '/api/account', dg.j.token, { password: 'delete-pass-9' }, ip(18));
  check('then even the right one is blocked, so a stolen login cannot delete the account', r.s === 429, String(r.s));
  r = await login('Delguess', 'delete-pass-9', ip(19));
  check('and the account is still there', r.s === 200);

  // ---------------- sign-up throttling ----------------
  const E = ip(20);
  const sc = [];
  for (let i = 0; i < 5; i++) sc.push((await register('Newbie' + i, 'newbie-pass-' + i, E)).s);
  check('five accounts from one address are fine', sc.every((c) => c === 200), sc.join());
  r = await register('Newbie9', 'newbie-pass-9', E);
  check('the sixth is refused', r.s === 429 && !!r.h.get('retry-after'), r.j.error);
  r = await register('Newbie10', 'newbie-pass-10', ip(21));
  check('a different address can still sign up', r.s === 200);
  const F = ip(22);
  for (let i = 0; i < 8; i++) await register('Newbie0', 'newbie-pass-x' + i, F); // all "taken"
  r = await register('FreshOne', 'fresh-pass-1', F);
  check('failed sign-ups (name taken) do not use up the allowance', r.s === 200);

  // ---------------- general API flood ----------------
  const G = ip(30);
  let blocked = 0, ok = 0;
  const results = await Promise.all(Array.from({ length: 650 }, () => raw('GET', '/api/site', { ip: G }).then((x) => x.status)));
  for (const s of results) s === 429 ? blocked++ : ok++;
  check('an address sending hundreds of requests a minute is slowed', blocked > 0 && ok >= 500, `${ok} ok, ${blocked} refused`);
  r = await api('GET', '/api/site', null, null, ip(31));
  check('other addresses are unaffected', r.s === 200);

  // ---------------- WebSocket ----------------
  const tryWs = (origin, ip2) => new Promise((resolve) => {
    const ws = new WS(WSURL, { origin, headers: ip2 ? { 'x-forwarded-for': ip2 } : {} });
    ws.on('open', () => resolve({ opened: true, ws }));
    ws.on('unexpected-response', (_q, res) => resolve({ opened: false, status: res.statusCode }));
    ws.on('error', () => resolve({ opened: false, status: 0 }));
  });
  let w = await tryWs('https://evil.example', ip(40));
  check('a socket from another website is refused', !w.opened && w.status === 403, String(w.status));
  w = await tryWs('http://localhost:8199', ip(40));
  check('a socket from our own site is accepted', w.opened === true);
  if (w.ws) {
    const tok = (await login('Bystander', 'bystander-pass-1', ip(41))).j.token;
    const got = []; w.ws.on('message', (d) => got.push(JSON.parse(d.toString())));
    w.ws.send(JSON.stringify({ t: 'hello', token: tok })); await wait(400);
    check('and can log in as normal', got.some((m) => m.t === 'welcome'));
    w.ws.close();
  }
  w = await tryWs(undefined, ip(42));
  check('tools with no Origin (like our test scripts) still connect', w.opened === true);
  w.ws?.close();

  const socks = []; let refused = 0;
  await Promise.all(Array.from({ length: 48 }, async () => {
    const x = await new Promise((resolve) => {
      const ws = new WS(WSURL, { headers: { 'x-forwarded-for': ip(50) } });
      ws.on('open', () => resolve({ ws }));
      ws.on('close', (code) => resolve({ code }));
      ws.on('error', () => resolve({ code: -1 }));
    });
    if (x.ws) { socks.push(x.ws); x.ws.on('close', (c) => c === 1013 && refused++); }
  }));
  await wait(600);
  check('one address cannot open endless sockets', refused >= 5 && refused <= 12, `${refused} of 48 were turned away`);
  socks.forEach((s) => s.close());

  // a socket that never logs in is dropped (takes about 16 seconds)
  const idle = await tryWs(undefined, ip(60));
  const closedWith = await new Promise((resolve) => {
    const t = setTimeout(() => resolve('still open'), 18000);
    idle.ws.on('close', (code) => { clearTimeout(t); resolve(code); });
  });
  check('a connection that never logs in is closed', closedWith === 4001, String(closedWith));
}

if (phase === 'b') {
  // Server started with a very short idle limit (SESSION_IDLE_DAYS=0.0001, about 9 seconds).
  await register('Idler', 'idler-pass-1', '10.2.0.1');
  let tok = (await login('Idler', 'idler-pass-1', '10.2.0.1')).j.token;
  let r = await api('GET', '/api/me', tok);
  check('a fresh login works', r.s === 200);
  for (let i = 0; i < 5; i++) { await wait(3000); r = await api('GET', '/api/me', tok); }
  check('a login in regular use stays alive past the idle limit (15s of use)', r.s === 200, String(r.s));
  await wait(11000);
  r = await api('GET', '/api/me', tok);
  check('a login left unused lapses', r.s === 401, String(r.s));
  const ws = new WS(WSURL); const got = [];
  ws.on('message', (d) => got.push(JSON.parse(d.toString())));
  await new Promise((res) => ws.on('open', res));
  ws.send(JSON.stringify({ t: 'hello', token: tok })); await wait(400);
  check('and a lapsed login cannot open the chat', !got.some((m) => m.t === 'welcome'));
  ws.close();
  r = await login('Idler', 'idler-pass-1', '10.2.0.1');
  check('logging in again works', r.s === 200);
}

if (phase === 'c') {
  // The database was rewritten to the OLD format (raw tokens) while the server was stopped.
  const OLD = process.argv[3];
  let r = await api('GET', '/api/me', OLD);
  check('a login from before the upgrade still works', r.s === 200 && r.j.account === 'Russ', JSON.stringify(r.j));
  const db = new DatabaseSync(DATA + '/qchat.db', { readOnly: true });
  const cols = db.prepare('PRAGMA table_info(sessions)').all().map((c) => c.name);
  check('the table now stores hashes, not tokens', cols.includes('tokenHash') && !cols.includes('token'), cols.join());
  check('the old raw token is no longer anywhere in it', !JSON.stringify(db.prepare('SELECT * FROM sessions').all()).includes(OLD));
  check('its hash is', !!db.prepare('SELECT 1 FROM sessions WHERE tokenHash = ?').get(sha(OLD)));
  db.close();
}

console.log(`\nSECURITY, PHASE ${phase.toUpperCase()}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
