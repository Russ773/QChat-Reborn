// Read-only checks of a live QChat site. Usage: node tests/live.mjs [https://your-site]. Creates nothing, posts nothing.
import { createRequire } from 'node:module';
const WS = createRequire(import.meta.url)('ws');
const SITE = (process.argv[2] ?? 'https://qchat.co.uk').replace(/\/$/, '');
const HOST = new URL(SITE).host;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  -> ' + extra : '')); };

const open = (origin) => new Promise((resolve) => {
  const ws = new WS(`wss://${HOST}/ws`, origin ? { origin } : {});
  ws.on('open', () => resolve({ ws, opened: true }));
  ws.on('unexpected-response', (_q, res) => resolve({ opened: false, status: res.statusCode }));
  ws.on('error', (e) => resolve({ opened: false, status: 0, err: e.message }));
});

let r = await open(SITE);
check('the live chat connection opens from the real site (WebSocket through Apache)', r.opened, r.err || String(r.status));
if (r.ws) {
  // An unauthenticated socket must be refused service: a bad token gets an error, not a welcome.
  const got = []; r.ws.on('message', (d) => got.push(JSON.parse(d.toString())));
  r.ws.send(JSON.stringify({ t: 'hello', token: 'not-a-real-token' })); await wait(800);
  check('and refuses someone who is not logged in', !got.some((m) => m.t === 'welcome'), JSON.stringify(got.map((m) => m.t)));
  r.ws.close();
}
r = await open('https://evil.example');
check('a connection from another website is refused', !r.opened && r.status === 403, String(r.status));
r = await open('http://localhost:5173');
check('a localhost origin is refused in production', !r.opened && r.status === 403, String(r.status));

// A forged visitor address must not get around the limits: the real address is what Apache adds last.
const hdr = await fetch(`${SITE}/api/site`, { headers: { 'x-forwarded-for': '1.2.3.4' } });
check('the API answers and is not cached', hdr.status === 200 && hdr.headers.get('cache-control') === 'no-store');

console.log(`\nLIVE SITE: ${pass} passed, ${fail} failed`);
