// Started by tests/run.mjs: live video. The picture itself goes directly between browsers, so these tests cover
// everything the server does: the switches, who may join, who is told to connect to whom, passing set-up messages.
const B = 'http://localhost:8199', WS = 'ws://localhost:8199/ws';
const phase = process.argv[2] || 'a';
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
  const c = {
    ws, got, close: () => ws.close(), send: (m) => ws.send(JSON.stringify(m)), clear: () => (got.length = 0),
    say: (room, text) => ws.send(JSON.stringify({ t: 'say', room, text })),
    errors: () => got.filter((x) => x.t === 'error').map((x) => x.text),
    infos: () => got.filter((x) => x.t === 'info').map((x) => x.text),
    last: (t) => got.filter((x) => x.t === t).at(-1),
    of: (t) => got.filter((x) => x.t === t),
    video: () => got.filter((x) => x.t === 'video').at(-1),
    people: () => (got.filter((x) => x.t === 'video').at(-1)?.participants ?? []).map((p) => p.nick + (p.cam ? '*' : '')).join(),
  };
  c.send({ t: 'hello', token }); await wait(250);
  return c;
}
const join = async (c, room) => { c.send({ t: 'join', room }); await wait(300); return c.last('joined'); };
const PW = { Russ: 'secret123', Ann: 'annpass-123', Bob: 'bobpass-123', Cat: 'catpass-123', Dan: 'danpass-123', Eve: 'evepass-123', Fay: 'faypass-123' };
const ROOM = '#cams';

if (phase === 'a') {
  // Default: the minimum age for a camera is 24 hours, and video is switched off for the site.
  const russ = await tokenFor('Russ', PW.Russ);
  const [ann, bob] = await Promise.all(['Ann', 'Bob'].map((n) => tokenFor(n, PW[n])));
  const A = await client(ann), Bo = await client(bob);
  await join(A, ROOM); await join(Bo, ROOM); // Ann creates the room, so she owns it

  let r = await api('GET', '/api/admin/settings', russ);
  check('live video is off for the site by default', r.j.settings.webcamsEnabled === false);
  check('the room shows video as off', Bo.video()?.enabled === false && Bo.video()?.on === false, JSON.stringify(Bo.video()));
  A.clear(); A.say(ROOM, '/video on'); await wait(400);
  check('the owner cannot switch it on while the site has it off', A.errors().some((e) => /switched live video off for the whole site/.test(e)), JSON.stringify(A.errors()));
  A.clear(); A.send({ t: 'videoJoin', room: ROOM, cam: false }); await wait(300);
  check('and nobody can join', A.errors().some((e) => /switched off on this site/.test(e)));

  r = await api('PUT', '/api/admin/settings', russ, { webcamsEnabled: true });
  check('an administrator can switch it on', r.s === 200 && r.j.settings.webcamsEnabled === true);
  check('an ordinary member cannot', (await api('PUT', '/api/admin/settings', bob, { webcamsEnabled: false })).s === 403);
  Bo.clear(); Bo.say(ROOM, '/video on'); await wait(400);
  check('only the room owner can switch it on for a room', Bo.errors().some((e) => /room owner/.test(e)));
  A.clear(); Bo.clear(); A.send({ t: 'videoJoin', room: ROOM, cam: false }); await wait(300);
  check('nobody can join until the room has it on', A.errors().some((e) => /not switched on in this room/.test(e)));
  A.say(ROOM, '/video on'); await wait(500);
  check('the owner switches it on and the room is told', Bo.video()?.on === true && Bo.video()?.enabled === true && Bo.systems?.length !== -1 && JSON.stringify(Bo.got).includes('switched on live video'));
  check('the room gets the connection servers to use', Array.isArray(Bo.video()?.ice) && Bo.video().ice.length > 0 && /^stun:/.test([].concat(Bo.video().ice[0].urls)[0]), JSON.stringify(Bo.video()?.ice));

  // new accounts can watch but not use a camera
  Bo.clear(); Bo.send({ t: 'videoJoin', room: ROOM, cam: true }); await wait(300);
  check('a brand new account cannot use a camera yet', Bo.errors().some((e) => /need to be 24 hours old/.test(e)), JSON.stringify(Bo.errors()));
  Bo.clear(); Bo.send({ t: 'videoJoin', room: ROOM, cam: false }); await wait(300);
  check('but can watch', Bo.last('videoPeers')?.peers.length === 0 && Bo.people() === 'Bob', Bo.people());
  Bo.send({ t: 'videoLeave', room: ROOM }); await wait(300);
  check('and leave', Bo.people() === '');
  for (const c of [A, Bo]) c.close();
}

if (phase === 'b') {
  // Restarted with no minimum age, so cameras can be tested.
  const russ = await tokenFor('Russ', PW.Russ);
  const toks = {};
  for (const n of ['Ann', 'Bob', 'Cat', 'Dan', 'Eve', 'Fay']) toks[n] = await tokenFor(n, PW[n]);
  const C = {};
  for (const n of Object.keys(toks)) { C[n] = await client(toks[n]); await join(C[n], ROOM); }
  check('the room switch survived the restart', C.Ann.video()?.on === true && C.Ann.video()?.enabled === true);

  const vj = async (n, cam) => { C[n].clear(); C[n].send({ t: 'videoJoin', room: ROOM, cam }); await wait(300); };
  await vj('Ann', true);
  check('the first person on camera has nobody to connect to', C.Ann.last('videoPeers')?.peers.length === 0 && C.Ann.people() === 'Ann*', C.Ann.people());
  await vj('Bob', true);
  check('a second camera is told to connect to the first', C.Bob.last('videoPeers')?.peers.join() === 'Ann');
  check('the first is not told to start (no clash)', C.Ann.of('videoPeers').length === 1 && C.Ann.last('videoPeers').peers.length === 0);
  await vj('Cat', false);
  check('a watcher is told to connect to each camera', C.Cat.last('videoPeers')?.peers.sort().join() === 'Ann,Bob', JSON.stringify(C.Cat.last('videoPeers')));
  await vj('Dan', false);
  check('everyone in the room sees who is in the call', C.Eve.people() === 'Ann*,Bob*,Cat,Dan', C.Eve.people());

  // passing set-up messages
  C.Bob.clear(); C.Ann.clear(); C.Cat.clear();
  C.Bob.send({ t: 'rtc', room: ROOM, to: 'Ann', kind: 'offer', data: { sdp: 'v=0...' } }); await wait(300);
  const got = C.Ann.last('rtc');
  check('a set-up message reaches only the person it is for', got?.from === 'Bob' && got.kind === 'offer' && got.data.sdp === 'v=0...' && C.Cat.of('rtc').length === 0);
  C.Ann.send({ t: 'rtc', room: ROOM, to: 'Bob', kind: 'answer', data: { sdp: 'v=0 answer' } }); await wait(300);
  check('and the answer goes back', C.Bob.last('rtc')?.kind === 'answer' && C.Bob.last('rtc').from === 'Ann');
  C.Eve.clear(); C.Eve.send({ t: 'rtc', room: ROOM, to: 'Ann', kind: 'offer', data: {} }); await wait(300);
  check('someone who is not in the call cannot send one', C.Eve.errors().some((e) => /not in that video call/.test(e)) && C.Ann.of('rtc').length === 1);
  C.Bob.clear(); C.Bob.send({ t: 'rtc', room: ROOM, to: 'Eve', kind: 'offer', data: {} }); await wait(300);
  check('nor to someone who is not in it', C.Bob.errors().some((e) => /not in the video call/.test(e)));
  C.Bob.clear(); C.Bob.send({ t: 'rtc', room: ROOM, to: 'Ann', kind: 'offer', data: { x: 'y'.repeat(26000) } }); await wait(300);
  check('a huge message is refused', C.Bob.errors().some((e) => /too big/.test(e)));
  C.Bob.send({ t: 'rtc', room: ROOM, to: 'Ann', kind: 'script', data: {} }); await wait(200);
  check('an unknown kind is ignored', C.Ann.of('rtc').length === 1);

  // limits
  await vj('Eve', true); await vj('Fay', true);
  check('four cameras are allowed', C.Fay.people() === 'Ann*,Bob*,Cat,Dan,Eve*,Fay*', C.Fay.people());
  C.Cat.clear(); C.Cat.send({ t: 'videoLeave', room: ROOM }); await wait(300);
  await vj('Cat', true);
  check('a fifth camera is refused', C.Cat.errors().some((e) => /already 4 cameras/.test(e)), JSON.stringify(C.Cat.errors()));
  C.Cat.clear(); C.Cat.send({ t: 'videoJoin', room: ROOM, cam: false }); await wait(300);
  check('but they can still watch', C.Cat.people().includes('Cat'));
  // one call at a time
  const A2 = await client(toks.Ann); await join(A2, ROOM);
  A2.send({ t: 'videoJoin', room: ROOM, cam: false }); await wait(300);
  check('the same member cannot join again from another window', A2.errors().some((e) => /already in a video call/.test(e)));
  A2.close();

  // moderation
  C.Dan.clear(); C.Dan.say(ROOM, '/video kick Eve'); await wait(300);
  check('only moderators can remove someone from the call', C.Dan.errors().some((e) => /Only moderators/.test(e)));
  C.Eve.clear(); C.Ann.say(ROOM, '/video kick Eve'); await wait(400);
  check('the owner can remove someone', C.Eve.last('videoEnded')?.reason.includes('Ann removed you') && !C.Fay.people().includes('Eve'), C.Fay.people());
  C.Cat.clear(); C.Cat.send({ t: 'videoReport', room: ROOM, nick: 'Ann' }); await wait(400);
  check('someone on camera can be reported', C.Cat.infos().some((t) => /admin will take a look/.test(t)));
  const reports = await api('GET', '/api/admin/reports?status=open', russ);
  check('the report reaches the admin list', reports.j.reports?.some((x) => x.author === 'Ann' && x.text === '(live video)' && x.reporter === 'Cat'), JSON.stringify(reports.j.reports));
  C.Cat.clear(); C.Cat.send({ t: 'videoReport', room: ROOM, nick: 'Ann' }); await wait(300);
  check('and only once', C.Cat.errors().some((e) => /already reported/.test(e)));
  C.Cat.clear(); C.Cat.send({ t: 'videoReport', room: ROOM, nick: 'Dan' }); await wait(300);
  check('a watcher cannot be reported (nothing to see)', C.Cat.errors().some((e) => /not on camera/.test(e)));

  // someone muted cannot start a camera
  C.Ann.say(ROOM, '/mute Eve 5'); await wait(300);
  C.Eve.clear(); C.Eve.send({ t: 'videoJoin', room: ROOM, cam: true }); await wait(300);
  check('a muted member cannot use a camera', C.Eve.errors().some((e) => /muted/.test(e)));

  // leaving the room or closing the window leaves the call
  C.Fay.send({ t: 'leave', room: ROOM }); await wait(300);
  check('leaving the room leaves the call', !C.Ann.people().includes('Fay'), C.Ann.people());
  C.Bob.close(); await wait(500);
  check('closing the window does too', !C.Ann.people().includes('Bob'), C.Ann.people());

  // the owner switches it off for the room
  C.Dan.clear(); C.Ann.say(ROOM, '/video off'); await wait(500);
  check('switching it off ends the call for everyone', C.Dan.last('videoEnded') && C.Dan.video()?.on === false && C.Dan.people() === '', C.Dan.people());

  // and an administrator switching it off for the site ends everything, everywhere
  C.Ann.say(ROOM, '/video on'); await wait(300);
  await vj('Ann', true); await vj('Dan', false);
  C.Dan.clear();
  await api('PUT', '/api/admin/settings', russ, { webcamsEnabled: false }); await wait(500);
  check('an administrator can end every call by switching video off', C.Dan.last('videoEnded')?.reason.includes('administrator') && C.Dan.video()?.enabled === false && C.Dan.people() === '', JSON.stringify(C.Dan.last('videoEnded')));
  for (const c of Object.values(C)) c.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
