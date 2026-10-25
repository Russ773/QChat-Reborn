// Started by tests/run.mjs: pinned messages, room rules, and the automatic mute for repeating a message.
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
    ws, got, close: () => ws.close(), send: (m) => ws.send(JSON.stringify(m)),
    errors: () => got.filter((x) => x.t === 'error').map((x) => x.text), clear: () => (got.length = 0),
    of: (t) => got.filter((x) => x.t === t), last: (t) => got.filter((x) => x.t === t).at(-1),
    say: (room, text) => ws.send(JSON.stringify({ t: 'say', room, text })),
    texts: (room) => got.filter((x) => x.t === 'message' && x.room === room && !x.line.bot).map((x) => x.line.text),
    systems: () => got.filter((x) => x.t === 'system').map((x) => x.text),
    botTexts: () => got.filter((x) => x.t === 'message' && x.line.bot).map((x) => x.line.text),
  };
  c.send({ t: 'hello', token }); await wait(250);
  return c;
}
const PW = { Russ: 'secret123', Olive: 'olivepass-1', Mo: 'mopass-123', Pat: 'patpass-123', Spam: 'spampass-1', Spam2: 'spam2pass-1' };
const ROOM = '#pinroom';
const join = async (c, room) => { c.send({ t: 'join', room }); await wait(300); return c.last('joined'); };

if (phase === 'a') {
  const russ = await tokenFor('Russ', PW.Russ);
  const [olive, mo, pat, spam, spam2] = await Promise.all(['Olive', 'Mo', 'Pat', 'Spam', 'Spam2'].map((n) => tokenFor(n, PW[n])));
  const O = await client(olive), M = await client(mo), P = await client(pat);
  await join(O, ROOM); // creates the room, so Olive owns it
  await join(M, ROOM); await join(P, ROOM);
  O.say(ROOM, '/mod Mo'); await wait(400);

  // ---------------- rules ----------------
  P.clear(); P.say(ROOM, '/rules be kind'); await wait(400);
  check('only the owner can set the rules', P.errors().some((e) => /owner/i.test(e)), JSON.stringify(P.errors()));
  M.clear(); M.say(ROOM, '/rules moderators cannot either'); await wait(400);
  check('a moderator cannot either', M.errors().some((e) => /owner/i.test(e)));
  P.clear(); O.say(ROOM, '/rules 1. Be kind. 2. No spam.'); await wait(500);
  check('the owner can set the rules and everyone is told', P.last('rules')?.rules?.text === '1. Be kind. 2. No spam.' && P.last('rules')?.rules?.by === 'Olive', JSON.stringify(P.last('rules')));
  P.clear(); P.say(ROOM, '/rules'); await wait(400);
  check('anyone can read them with /rules', P.systems().concat(P.got.filter((x) => x.t === 'info').map((x) => x.text)).some((s) => /Be kind/.test(s)) || JSON.stringify(P.got).includes('Be kind'));
  P.clear(); await wait(3200); P.say(ROOM, '!rules'); await wait(1500);
  check('QBot answers !rules', P.botTexts().some((t) => /Be kind/.test(t)), JSON.stringify(P.botTexts()));

  // ---------------- pins ----------------
  P.say(ROOM, 'a message worth pinning'); await wait(500);
  const target = O.of('message').find((m) => m.line.text === 'a message worth pinning')?.line;
  P.clear(); P.send({ t: 'pin', room: ROOM, id: target.id, pin: true }); await wait(400);
  check('an ordinary member cannot pin', P.errors().some((e) => /moderators/i.test(e)));
  M.clear(); M.send({ t: 'pin', room: ROOM, id: 'no-such-id', pin: true }); await wait(400);
  check('pinning a message that is not there is refused', M.errors().some((e) => /no longer exists/.test(e)));
  P.clear(); M.send({ t: 'pin', room: ROOM, id: target.id, pin: true }); await wait(500);
  const pins1 = P.last('pins')?.pins ?? [];
  check('a moderator can pin and everyone sees it', pins1.length === 1 && pins1[0].id === target.id && pins1[0].pinnedBy === 'Mo' && pins1[0].from === 'Pat', JSON.stringify(pins1));
  check('and the room is told', P.systems().some((s) => /Mo pinned a message from Pat/.test(s)));

  // the author editing the pinned message updates the pin
  P.clear(); P.send({ t: 'edit', room: ROOM, id: target.id, text: 'a message worth pinning (edited)' }); await wait(500);
  check('editing a pinned message updates the pin', P.last('pins')?.pins?.[0]?.text === 'a message worth pinning (edited)');

  // fill to the limit
  const ids = [];
  for (let i = 1; i <= 5; i++) { O.say(ROOM, 'pin candidate ' + i); await wait(1500); ids.push(P.of('message').find((m) => m.line.text === 'pin candidate ' + i)?.line.id); }
  M.clear();
  for (const id of ids) { M.send({ t: 'pin', room: ROOM, id, pin: true }); await wait(300); }
  check('a room holds five pins at most', M.errors().some((e) => /5 pinned/.test(e)), JSON.stringify(M.errors()));
  const full = (await join(await client(pat), ROOM)).pins;
  check('joining sends the pins and the rules', full.length === 5);

  // unpin and delete
  P.clear(); M.send({ t: 'pin', room: ROOM, id: ids[0], pin: false }); await wait(500);
  check('a moderator can unpin', P.last('pins')?.pins?.length === 4 && !P.last('pins').pins.some((p) => p.id === ids[0]));
  P.clear(); O.send({ t: 'delete', room: ROOM, id: ids[1] }); await wait(500);
  check('deleting a pinned message removes the pin', P.last('pins')?.pins?.length === 3);

  // ---------------- automatic mute ----------------
  const S = await client(spam), S2 = await client(spam2), watcher = await client(pat);
  await join(S, ROOM); await join(S2, ROOM); await join(watcher, ROOM);
  watcher.clear();
  for (let i = 0; i < 3; i++) { S.say(ROOM, 'BUY CHEAP WATCHES at my shop'); await wait(1400); }
  check('the first two repeats get through', watcher.texts(ROOM).filter((t) => /WATCHES/.test(t)).length === 2, JSON.stringify(watcher.texts(ROOM)));
  check('the third is stopped and the room is told', watcher.systems().some((s) => /Spam was muted for 10 minutes for repeating/.test(s)), JSON.stringify(watcher.systems()));
  check('the sender is told too', S.errors().some((e) => /muted for 10 minutes/.test(e)));
  watcher.clear(); S.say(ROOM, 'a different message'); await wait(800);
  check('they stay muted', watcher.texts(ROOM).length === 0);
  const audit = await api('GET', '/api/admin/audit', russ);
  check('it is in the audit log', /automute/.test(audit.text) && /Spam/.test(audit.text));

  // things that must NOT trigger it
  watcher.clear();
  for (let i = 0; i < 4; i++) { S2.say(ROOM, 'lol'); await wait(1300); }
  check('short replies like "lol" can be repeated', S2.errors().length === 0 && watcher.texts(ROOM).filter((t) => t === 'lol').length === 4);
  S2.clear(); await wait(4000);
  for (let i = 0; i < 4; i++) { S2.say(ROOM, '!flip'); await wait(1300); }
  check('and so can commands', !S2.got.some((x) => x.t === 'system' && /muted/.test(x.text)));
  M.clear(); watcher.clear();
  for (let i = 0; i < 4; i++) { M.say(ROOM, 'moderators are exempt from this'); await wait(1300); }
  check('room moderators are exempt', watcher.texts(ROOM).filter((t) => /exempt/.test(t)).length === 4);

  // the switch
  await api('PUT', '/api/admin/settings', russ, { autoMuteSpam: false });
  S2.clear(); await wait(4000); watcher.clear();
  for (let i = 0; i < 4; i++) { S2.say(ROOM, 'now nothing mutes me'); await wait(1300); }
  check('with the switch off, repeating is allowed', watcher.texts(ROOM).filter((t) => /nothing mutes/.test(t)).length === 4, JSON.stringify(watcher.texts(ROOM)));
  await api('PUT', '/api/admin/settings', russ, { autoMuteSpam: true });

  for (const c of [O, M, P, S, S2, watcher]) c.close();
}

if (phase === 'b') {
  // after a restart: rules, pins and the automatic mute are all still there
  const pat = await tokenFor('Pat', PW.Pat), spam = await tokenFor('Spam', PW.Spam);
  const P = await client(pat);
  const j = await join(P, ROOM);
  check('the rules survive a restart', j.rules?.text === '1. Be kind. 2. No spam.');
  check('and so do the pins', (j.pins?.length ?? 0) === 3, String(j.pins?.length));
  const S = await client(spam); await join(S, ROOM);
  S.clear(); S.say(ROOM, 'am I still muted'); await wait(800);
  check('the mute survives a restart too', !P.texts(ROOM).includes('am I still muted'));
  P.close(); S.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
