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
    got, send: (m) => ws.send(JSON.stringify(m)), clear: () => (got.length = 0),
    media: (room) => got.filter((x) => x.t === 'media' && x.room === room),
    systems: (room) => got.filter((x) => x.t === 'system' && x.room === room).map((x) => x.text),
  };
  c.send({ t: 'hello', token }); await wait(250);
  return c;
}
const join = async (c, room) => { c.send({ t: 'join', room }); await wait(250); };
const VIDEO = 'dQw4w9WgXcQ', OTHER = 'jNQXAC9IVRw';

const A = await client(await tokenFor('Vera')), Bo = await client(await tokenFor('Vic'));
const room = '#videoroom';
await join(A, 'videoroom'); await join(Bo, 'videoroom');

A.send({ t: 'playYouTube', room, ref: VIDEO }); await wait(400);
check('a video starts for the room', Bo.media(room).at(-1)?.state?.ref === VIDEO);

// a report right at the start cannot be the real end
Bo.clear(); A.clear();
Bo.send({ t: 'mediaControl', room, op: 'ended', ref: VIDEO }); await wait(300);
check('an "ended" report in the first seconds is ignored', A.media(room).length === 0);

await wait(3000);
// the wrong video
A.send({ t: 'mediaControl', room, op: 'ended', ref: OTHER }); await wait(300);
check('an "ended" report about a different video is ignored', A.media(room).length === 0);
A.send({ t: 'mediaControl', room, op: 'ended' }); await wait(300);
check('an "ended" report that names no video is ignored', A.media(room).length === 0);

// paused: a paused video has not ended
A.send({ t: 'mediaControl', room, op: 'pause' }); await wait(300);
Bo.send({ t: 'mediaControl', room, op: 'ended', ref: VIDEO }); await wait(300);
check('a paused video cannot have ended', A.media(room).at(-1)?.state?.paused === true && A.media(room).at(-1)?.state !== null);
A.send({ t: 'mediaControl', room, op: 'resume' }); await wait(300);

// the real end: cleared for everyone, announced once, even if two watchers report at once
A.clear(); Bo.clear();
A.send({ t: 'mediaControl', room, op: 'ended', ref: VIDEO });
Bo.send({ t: 'mediaControl', room, op: 'ended', ref: VIDEO });
await wait(500);
check('when the video ends it is cleared for the whole room', A.media(room).at(-1)?.state === null && Bo.media(room).at(-1)?.state === null);
check('and the room is told once that it finished', A.systems(room).filter((t) => t === 'The video has finished').length === 1, JSON.stringify(A.systems(room)));
check('two watchers reporting at the same moment clear it only once', A.media(room).filter((m) => m.state === null).length === 1);

// afterwards nothing restarts it, and a late report cannot end a newer video
A.send({ t: 'mediaControl', room, op: 'resume' }); await wait(300);
check('nothing brings the finished video back', A.media(room).at(-1)?.state === null);
A.send({ t: 'playYouTube', room, ref: OTHER }); await wait(3300);
A.clear();
Bo.send({ t: 'mediaControl', room, op: 'ended', ref: VIDEO }); await wait(300);
check('a late "ended" about the old video does not end the new one', A.media(room).length === 0);
Bo.send({ t: 'mediaControl', room, op: 'seek', pos: 99999 }); await wait(300);
check('a seek far past the end is still just a seek (the players then report the end)', A.media(room).at(-1)?.state?.ref === OTHER);
Bo.send({ t: 'mediaControl', room, op: 'ended', ref: OTHER }); await wait(300);
check('and the new video can end normally', A.media(room).at(-1)?.state === null);

// someone not in the room cannot end it
const Out = await client(await tokenFor('Vout'));
A.send({ t: 'playYouTube', room, ref: VIDEO }); await wait(3300); A.clear();
Out.send({ t: 'mediaControl', room, op: 'ended', ref: VIDEO }); await wait(300);
check('someone who is not in the room cannot end its video', A.media(room).length === 0);

console.log(`\nWAVE 7: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
