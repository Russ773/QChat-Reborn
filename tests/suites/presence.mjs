// Started by tests/run.mjs (see the suite list there for the server settings this file expects).
const B = 'http://localhost:8199', WS = 'ws://localhost:8199/ws';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  -> ' + extra : '')); };
const api = async (method, path, token, body) => {
  const r = await fetch(B + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = {}; try { j = await r.json(); } catch {}
  return { s: r.status, j };
};
async function tokenFor(name) {
  const pw = name.toLowerCase() + '-pass-9';
  let r = await api('POST', '/api/register', null, { account: name, password: pw });
  if (!r.j.token) r = await api('POST', '/api/login', null, { account: name, password: pw });
  return r.j.token;
}
async function client(token) {
  const ws = new WebSocket(WS); const got = [];
  ws.onmessage = (e) => got.push(JSON.parse(e.data));
  await new Promise((r) => (ws.onopen = r));
  const c = {
    ws, got, send: (m) => ws.send(JSON.stringify(m)), clear: () => (got.length = 0), close: () => ws.close(),
    notices: (room, nick) => got.filter((x) => (x.t === 'leaveNotice' || x.t === 'joinNotice') && x.room === room && x.nick === nick),
    lastPresence: (room) => got.filter((x) => x.t === 'presence' && x.room === room).at(-1),
  };
  c.send({ t: 'hello', token }); await wait(250);
  return c;
}
const join = async (c, room, restore = false) => { c.send({ t: 'join', room, ...(restore ? { restore: true } : {}) }); await wait(250); };

const tokA = await tokenFor('Alice'), tokB = await tokenFor('Bella');

// ---- closing the window says "left chat" (after a short grace period)
{
  const A = await client(tokA); await join(A, 'leaveroom1');
  const B = await client(tokB); await join(B, 'leaveroom1');
  check('a member joining is announced', A.notices('#leaveroom1', 'Bella').some((n) => n.t === 'joinNotice'));
  A.clear(); B.close(); await wait(400);
  check('the member list updates straight away when the window closes', !A.lastPresence('#leaveroom1')?.members.includes('Bella'));
  check('but "left chat" waits a moment first', A.notices('#leaveroom1', 'Bella').length === 0);
  await wait(1400);
  const n = A.notices('#leaveroom1', 'Bella');
  check('then the room is told they left chat', n.length === 1 && n[0].t === 'leaveNotice' && n[0].reason === 'disconnected', JSON.stringify(n));
}

// ---- a reload (straight back) is not announced at all
{
  const A = await client(tokA); await join(A, 'leaveroom2');
  const B = await client(tokB); await join(B, 'leaveroom2');
  A.clear(); B.close(); await wait(300);
  const B2 = await client(tokB); await join(B2, 'leaveroom2', true);
  await wait(2200);
  check('a page reload is not announced as a leave and a join', A.notices('#leaveroom2', 'Bella').length === 0, JSON.stringify(A.notices('#leaveroom2', 'Bella')));
  check('and they are back in the member list', A.lastPresence('#leaveroom2')?.members.includes('Bella'));
}

// ---- two windows: only the last one closing counts
{
  const A = await client(tokA); await join(A, 'leaveroom3');
  A.clear();
  const B1 = await client(tokB); await join(B1, 'leaveroom3');
  const B2 = await client(tokB); await join(B2, 'leaveroom3');
  check('opening a second window is not announced again', A.notices('#leaveroom3', 'Bella').filter((n) => n.t === 'joinNotice').length === 1);
  A.clear(); B1.close(); await wait(2200);
  check('closing one of two windows does not say they left', A.notices('#leaveroom3', 'Bella').length === 0);
  check('they are still in the member list', A.lastPresence('#leaveroom3') === undefined || A.lastPresence('#leaveroom3').members.includes('Bella'));
  B2.close(); await wait(2200);
  check('closing the last window says they left chat', A.notices('#leaveroom3', 'Bella').filter((n) => n.t === 'leaveNotice' && n.reason === 'disconnected').length === 1);
}

// ---- leaving a room on purpose is immediate and says so
{
  const A = await client(tokA); await join(A, 'leaveroom4');
  const B = await client(tokB); await join(B, 'leaveroom4');
  A.clear(); B.send({ t: 'leave', room: '#leaveroom4' }); await wait(300);
  const n = A.notices('#leaveroom4', 'Bella');
  check('leaving a room is announced straight away, as leaving the room', n.length === 1 && n[0].reason === 'left', JSON.stringify(n));
  // with a second window still in the room, it is not a leave
  const B1 = await client(tokB); await join(B1, 'leaveroom4');
  const B2 = await client(tokB); await join(B2, 'leaveroom4');
  A.clear(); B1.send({ t: 'leave', room: '#leaveroom4' }); await wait(300);
  check('leaving in one window while another is still there is not announced', A.notices('#leaveroom4', 'Bella').length === 0);
}

// ---- several rooms, and coming back to a different one
{
  const A = await client(tokA); await join(A, 'leaveroom5'); await join(A, 'leaveroom6');
  const B = await client(tokB); await join(B, 'leaveroom5'); await join(B, 'leaveroom6');
  A.clear(); B.close(); await wait(2000);
  check('every room they were in is told they left chat', A.notices('#leaveroom5', 'Bella').length === 1 && A.notices('#leaveroom6', 'Bella').length === 1);
  const A2 = await client(tokA); await join(A2, 'leaveroom5'); await join(A2, 'leaveroom6');
  const B1 = await client(tokB); await join(B1, 'leaveroom5');
  B1.close(); await wait(300);
  const B2 = await client(tokB); await join(B2, 'leaveroom6', true); // comes back, but only to one of the two
  A2.clear(); await wait(2200);
  check('a room they did not come back to hears they left chat', A2.notices('#leaveroom5', 'Bella').filter((n) => n.t === 'leaveNotice').length === 1);
  check('a room they came back to hears nothing', A2.notices('#leaveroom6', 'Bella').length === 0);
}

console.log(`\nWAVE 6: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
