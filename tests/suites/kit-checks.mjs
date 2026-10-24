// Production-mode checks against the unpacked release running on port 8299.
import { createRequire } from 'node:module';
const rel = process.argv[2];
const WS = createRequire(rel + '/server/package.json')('ws');
const B = 'http://127.0.0.1:8299';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  -> ' + extra : '')); };

const reg = await fetch(B + '/api/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account: 'Russ', password: 'a-long-admin-pass-1' }) });
const j = await reg.json();
check('the admin account can register on the release build', !!j.token && j.role === 'admin', j.role);

const open = (origin, host) => new Promise((resolve) => {
  const ws = new WS('ws://127.0.0.1:8299/ws', { origin, headers: host ? { host } : {} });
  ws.on('open', () => resolve({ ws, opened: true }));
  ws.on('unexpected-response', (_q, res) => resolve({ opened: false, status: res.statusCode }));
  ws.on('error', () => resolve({ opened: false, status: 0 }));
});

let r = await open('https://qchat.co.uk', 'qchat.co.uk');
check('behind a proxy that keeps the Host, the live site origin connects', r.opened);
if (r.ws) {
  const got = []; r.ws.on('message', (d) => got.push(JSON.parse(d.toString())));
  r.ws.send(JSON.stringify({ t: 'hello', token: j.token })); await wait(400);
  check('...and logs in', got.some((m) => m.t === 'welcome'));
  r.ws.close();
}
r = await open('https://qchat.co.uk');
check('even if the proxy changes the Host, ALLOWED_ORIGINS lets the live site in', r.opened);
r.ws?.close();
r = await open('https://evil.example', 'qchat.co.uk');
check('another website is refused', !r.opened && r.status === 403, String(r.status));
r = await open('http://localhost:5173');
check('in production a localhost origin is NOT trusted', !r.opened && r.status === 403, String(r.status));

const h = await fetch(B + '/', { headers: { 'x-forwarded-proto': 'https' } });
check('HSTS is sent when the proxy says https', /max-age/.test(h.headers.get('strict-transport-security') ?? ''));
check('the content security policy is on', /default-src 'self'/.test(h.headers.get('content-security-policy') ?? ''));

console.log(`\nRELEASE BUILD: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
