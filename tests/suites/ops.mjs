// Started by tests/run.mjs: health check, the admin health page and charts, and a server that survives bad messages.
const B = 'http://localhost:8199', WS = 'ws://localhost:8199/ws';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  -> ' + extra : '')); };
const api = async (method, path, token, body) => {
  const r = await fetch(B + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch {}
  return { s: r.status, j, text };
};
const tokenFor = async (name, pw) => {
  let r = await api('POST', '/api/register', null, { account: name, password: pw, agree: true });
  if (!r.j.token) r = await api('POST', '/api/login', null, { account: name, password: pw });
  return r.j.token;
};
async function client(token) {
  const ws = new WebSocket(WS); const got = [];
  ws.onmessage = (e) => got.push(JSON.parse(e.data));
  await new Promise((r) => (ws.onopen = r));
  const c = { ws, got, close: () => ws.close(), send: (m) => ws.send(JSON.stringify(m)), raw: (s) => ws.send(s), of: (t) => got.filter((x) => x.t === t), clear: () => (got.length = 0) };
  c.send({ t: 'hello', token }); await wait(250);
  return c;
}

const russ = await tokenFor('Russ', 'secret123'), ann = await tokenFor('Ann', 'annpass-123'), bob = await tokenFor('Bob', 'bobpass-123');

// ---------------- health check ----------------
let r = await fetch(B + '/healthz');
check('/healthz says ok while the database answers', r.status === 200 && (await r.text()) === 'ok');

// ---------------- bad messages cannot take the server down ----------------
const A = await client(ann);
A.send({ t: 'join', room: '#ops' }); await wait(300);
const bad = [
  { t: 'join' }, { t: 'join', room: 42 }, { t: 'join', room: { a: 1 } }, { t: 'leave' }, { t: 'say' }, { t: 'say', room: null, text: 5 },
  { t: 'say', room: '#ops', text: { x: 1 } }, { t: 'react' }, { t: 'pin' }, { t: 'pin', room: [] }, { t: 'report', room: 5 }, { t: 'search', room: '#ops', q: {} },
  { t: 'history', room: '#ops', before: 'x' }, { t: 'edit' }, { t: 'delete', room: 7 }, { t: 'dm' }, { t: 'dm', to: {}, text: [] }, { t: 'dmHistory' },
  { t: 'playYouTube' }, { t: 'mediaControl' }, { t: 'playSound', room: 3 }, { t: 'roomAdmin' }, { t: 'friendRequest' }, { t: 'friendRespond' },
];
for (const m of bad) A.send(m);
A.raw('not json at all'); A.raw('[]'); A.raw('null'); A.raw('{"t":5}'); A.raw('{"t":"say","room":"#ops","text":"' + 'x'.repeat(5000) + '"}');
await wait(800);
r = await fetch(B + '/healthz');
check('the server is still running after 29 bad messages', r.status === 200);
A.clear(); A.send({ t: 'ping' }); await wait(300);
check('and the same connection still works', A.of('pong').length === 1);
A.clear(); A.send({ t: 'say', room: '#ops', text: 'a normal message after the bad ones' }); await wait(500);
check('and chatting still works', A.of('message').some((m) => m.line.text === 'a normal message after the bad ones'));

// ---------------- admin health page ----------------
r = await api('GET', '/api/admin/health');
check('the health page needs a login', r.s === 401);
r = await api('GET', '/api/admin/health', ann);
check('and an administrator', r.s === 403);
r = await api('GET', '/api/admin/health', russ);
const h = r.j.health ?? {};
check('it reports uptime, memory, database size and version', r.s === 200 && h.uptimeSec >= 0 && h.memoryMb > 0 && h.dbMb > 0 && typeof h.version === 'string' && /^v\d/.test(h.node), JSON.stringify(h).slice(0, 300));
check('it reports free disk space', typeof h.diskFreeMb === 'number' && h.diskFreeMb > 0 && h.diskTotalMb >= h.diskFreeMb, `${h.diskFreeMb}/${h.diskTotalMb}`);
check('and who is online', h.online >= 1);
check('it lists errors as a list', Array.isArray(h.errors) && typeof h.errorsLastHour === 'number');

// ---------------- charts ----------------
await wait(8500); // let the flood window from the bad messages clear
const Bo = await client(bob);
Bo.send({ t: 'join', room: '#ops' }); await wait(300);
for (let i = 0; i < 3; i++) { A.send({ t: 'say', room: '#ops', text: 'counted message number ' + i }); await wait(1400); }
A.send({ t: 'dm', to: 'Bob', text: 'a counted private message' }); await wait(500);
r = await api('GET', '/api/admin/charts?days=7', russ);
const days = r.j.days ?? [];
const today = days.at(-1) ?? {};
check('the chart has one entry for each of the 7 days, ending today', days.length === 7 && today.day === new Date().toISOString().slice(0, 10), JSON.stringify(days.map((d) => d.day)));
check('messages are counted', today.messages >= 4, JSON.stringify(today));
check('private messages are counted', today.dms === 1, JSON.stringify(today));
check('active members and the busiest moment are counted', today.active >= 2 && today.peakOnline >= 2, JSON.stringify(today));
check('new members are counted', today.signups >= 3, JSON.stringify(today));
check('quiet days are zeros, not gaps', days.slice(0, 6).every((d) => d.messages === 0 && d.signups === 0));
r = await api('GET', '/api/admin/charts?days=5', russ);
check('an unsupported range falls back to 30 days', (r.j.days ?? []).length === 30);
r = await api('GET', '/api/admin/charts?days=90', russ);
check('90 days works', (r.j.days ?? []).length === 90);
r = await api('GET', '/api/admin/charts?days=30', ann);
check('members cannot see the charts', r.s === 403);

A.close(); Bo.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
