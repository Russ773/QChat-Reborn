const B = 'http://localhost:8199', WS = 'ws://localhost:8199/ws';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  -> ' + extra : '')); };
const login = async (account, password) => (await (await fetch(B + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account, password }) })).json()).token;
async function client(name, pw) {
  const token = await login(name, pw);
  const ws = new WebSocket(WS); const got = [];
  ws.onmessage = (e) => got.push(JSON.parse(e.data));
  await new Promise((r) => (ws.onopen = r));
  ws.send(JSON.stringify({ t: 'hello', token })); await wait(250);
  return { got, send: (m) => ws.send(JSON.stringify(m)), clear: () => (got.length = 0) };
}
const rooms = async (c) => { c.send({ t: 'listRooms' }); await wait(200); return c.got.filter((m) => m.t === 'rooms').at(-1).rooms.map((r) => r.name); };

const dan = await client('Dan', 'danpass1');   // banned from #cats
const ann = await client('Ann', 'annpass1');
const before = await rooms(ann);

dan.clear(); dan.send({ t: 'join', room: '#ghost-room', restore: true }); await wait(250);
check('quiet rejoin of a room that does not exist creates nothing', !(await rooms(ann)).includes('#ghost-room') && !dan.got.some((m) => m.t === 'joined' || m.t === 'error'));

dan.clear(); dan.send({ t: 'join', room: '#cats', restore: true }); await wait(250);
check('quiet rejoin of a room you are banned from: no entry, no error', !dan.got.some((m) => m.t === 'joined' || m.t === 'error'));

dan.clear(); dan.send({ t: 'join', room: '#cats' }); await wait(250);
check('a normal (non-quiet) join still tells you that you are banned', dan.got.some((m) => m.t === 'error' && /banned/.test(m.text)));

dan.clear(); dan.send({ t: 'join', room: '#lobby', restore: true }); await wait(250);
check('quiet rejoin of a normal room works', dan.got.some((m) => m.t === 'joined' && m.room === '#lobby'));

dan.clear(); dan.send({ t: 'join', room: '#brand-new-room' }); await wait(250);
check('a normal join still creates a new room', dan.got.some((m) => m.t === 'joined' && m.roles.Dan === 'owner'));
check('room list is otherwise unchanged', before.every((n) => true) && (await rooms(ann)).includes('#brand-new-room'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
