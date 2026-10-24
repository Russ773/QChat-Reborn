const B = 'http://localhost:8199', WS = 'ws://localhost:8199/ws';
const phase = process.argv[2] || 'a';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  -> ' + extra : ''));
};
const api = async (method, path, token, body) => {
  const r = await fetch(B + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = {};
  try { j = await r.json(); } catch {}
  return { s: r.status, j };
};
async function tokenFor(name, pw) {
  let r = await api('POST', '/api/register', null, { account: name, password: pw });
  if (!r.j.token) r = await api('POST', '/api/login', null, { account: name, password: pw });
  return r.j.token;
}
async function client(token) {
  const ws = new WebSocket(WS);
  const got = [];
  let closed = false;
  ws.onmessage = (e) => got.push(JSON.parse(e.data));
  ws.onclose = () => (closed = true);
  await new Promise((r) => (ws.onopen = r));
  const c = {
    ws, got,
    isClosed: () => closed,
    send: (m) => ws.send(JSON.stringify(m)),
    of: (t) => got.filter((x) => x.t === t),
    last: (t) => got.filter((x) => x.t === t).at(-1),
    clear: () => (got.length = 0),
    errors: () => got.filter((x) => x.t === 'error').map((x) => x.text),
    systems: () => got.filter((x) => x.t === 'system').map((x) => x.text),
    say: (room, text) => ws.send(JSON.stringify({ t: 'say', room, text })),
  };
  c.send({ t: 'hello', token });
  await wait(250);
  return c;
}
const join = async (c, room) => { c.send({ t: 'join', room }); await wait(200); return c.last('joined'); };
const hasErr = (c, re) => c.errors().some((e) => re.test(e));

const PW = { Russ: 'secret123', Ann: 'annpass1', Bob: 'bobpass1', Cat: 'catpass1', Dan: 'danpass1', Flo: 'flopass1' };

if (phase === 'a') {
  const tok = {};
  for (const n of Object.keys(PW)) tok[n] = await tokenFor(n, PW[n]);
  check('Russ is the admin', (await api('GET', '/api/me', tok.Russ)).j.role === 'admin');

  const R = await client(tok.Russ), A = await client(tok.Ann), Bo = await client(tok.Bob), C = await client(tok.Cat), D = await client(tok.Dan);

  // --- rooms, ownership, history ---
  let j = await join(A, 'cats');
  check('creator of a new room becomes its owner', j?.roles?.Ann === 'owner', JSON.stringify(j?.roles));
  await join(R, 'cats');
  for (const t of ['hello 1', 'hello 2', 'hello 3']) { A.say('#cats', t); await wait(80); }
  j = await join(Bo, 'cats');
  check('joiner receives saved history with sequence numbers', j.history.length === 3 && j.history[0].seq < j.history[2].seq && !j.more, `n=${j.history.length}`);
  Bo.clear();
  A.say('#cats', '/me waves');
  await wait(150);
  check('/me sends an action line', Bo.last('message')?.line.kind === 'action' && Bo.last('message')?.line.text === 'waves');
  A.say('#cats', '//not a command');
  await wait(150);
  check('"//" sends a message starting with a slash', Bo.last('message')?.line.text === '/not a command');
  A.clear(); A.say('#cats', '/frobnicate'); await wait(150);
  check('unknown command is refused politely', hasErr(A, /Unknown command/));

  await join(C, 'cats');
  C.clear(); A.clear();
  C.say('#cats', '/help'); A.say('#cats', '/help'); await wait(250);
  check('/help lists more commands to an owner than to a member', A.systems().length > C.systems().length && C.systems().length >= 8, `owner=${A.systems().length} member=${C.systems().length}`);

  // --- topic + moderators ---
  Bo.clear(); Bo.say('#cats', '/topic nope'); await wait(150);
  check('a plain member cannot set the topic', hasErr(Bo, /Only moderators/));
  Bo.clear(); A.say('#cats', '/topic Welcome to cats'); await wait(200);
  check('owner sets topic and everyone is told', Bo.last('topic')?.topic?.text === 'Welcome to cats' && Bo.systems().some((s) => /set the topic/.test(s)));
  Bo.clear(); Bo.say('#cats', '/topic'); await wait(150);
  check('/topic shows the current topic', Bo.systems().some((s) => /Welcome to cats/.test(s)));
  Bo.clear(); Bo.say('#cats', '/mod Cat'); await wait(150);
  check('only the owner can appoint moderators', hasErr(Bo, /Only the room owner/));
  A.say('#cats', '/mod Bob'); await wait(200);
  check('owner appoints a moderator (shown in presence)', Bo.last('presence')?.roles?.Bob === 'mod', JSON.stringify(Bo.last('presence')?.roles));
  Bo.say('#cats', '/topic Cats rule'); await wait(200);
  check('moderator can now set the topic', Bo.last('topic')?.topic?.text === 'Cats rule');

  // --- kick / ban / mute with rank rules ---
  C.clear(); C.say('#cats', '/kick Bob'); await wait(150);
  check('member cannot kick', hasErr(C, /Only moderators/));
  Bo.clear(); Bo.say('#cats', '/kick Ann'); await wait(150);
  check('moderator cannot kick the room owner', hasErr(Bo, /cannot do that to Ann/));
  Bo.clear(); Bo.say('#cats', '/kick Russ'); await wait(150);
  check('moderator cannot kick an admin', hasErr(Bo, /cannot do that to Russ/));
  Bo.clear(); Bo.say('#cats', '/kick Bob'); await wait(150);
  check('you cannot act on yourself', hasErr(Bo, /yourself/));
  C.clear(); Bo.say('#cats', '/kick Cat being silly'); await wait(250);
  check('kicked member is removed and told why', C.of('left').some((m) => m.room === '#cats') && C.errors().some((e) => /kicked.*being silly/.test(e)));
  check('kick is announced to the room', Bo.systems().some((s) => /Cat was kicked by Bob: being silly/.test(s)));
  C.clear(); await join(C, 'cats');
  check('a kick is not a ban (they can come back)', !!C.last('joined'));

  D.clear(); await join(D, 'cats');
  A.say('#cats', '/ban Dan spam'); await wait(250);
  check('banned member is removed', D.of('left').some((m) => m.room === '#cats'));
  D.clear(); D.send({ t: 'join', room: 'cats' }); await wait(200);
  check('banned member cannot rejoin', hasErr(D, /banned from cats/) && !D.last('joined'));
  A.clear(); A.say('#cats', '/bans'); await wait(150);
  check('/bans lists them', A.systems().some((s) => /Dan/.test(s)));
  A.say('#cats', '/unban Dan'); await wait(150);
  D.clear(); await join(D, 'cats');
  check('unbanned member can rejoin', !!D.last('joined'));

  A.say('#cats', '/mute Cat 5 noisy'); await wait(200);
  C.clear(); Bo.clear(); C.say('#cats', 'can you hear me'); await wait(200);
  check('muted member cannot speak', hasErr(C, /muted in cats/) && !Bo.of('message').filter((m) => !m.line.bot).length);
  A.say('#cats', '/unmute Cat'); await wait(150);
  C.clear(); C.say('#cats', 'back again'); await wait(200);
  check('unmuted member can speak again', !!Bo.of('message').find((m) => m.line.text === 'back again'));

  R.clear(); R.say('#cats', '/kick Ann bad day'); await wait(250);
  check('an admin outranks a room owner', A.of('left').some((m) => m.room === '#cats'));
  await join(A, 'cats');

  // --- edit / delete ---
  await wait(8200); // let Ann's flood window clear
  A.clear(); Bo.clear(); C.clear();
  A.say('#cats', 'a typpo here'); await wait(200);
  const typo = Bo.of('message').find((m) => m.line.text === 'a typpo here')?.line;
  A.send({ t: 'edit', room: '#cats', id: typo.id, text: 'a typo here' }); await wait(200);
  check('author can edit their message', Bo.last('edited')?.text === 'a typo here' && Bo.last('edited')?.id === typo.id);
  Bo.clear(); Bo.send({ t: 'edit', room: '#cats', id: typo.id, text: 'hacked' }); await wait(150);
  check('nobody else can edit it (even a moderator)', hasErr(Bo, /only edit your own/) && !A.of('edited').some((m) => m.text === 'hacked'));
  C.clear(); C.send({ t: 'delete', room: '#cats', id: typo.id }); await wait(150);
  check('a plain member cannot delete someone else\'s message', hasErr(C, /only delete your own/));
  Bo.send({ t: 'delete', room: '#cats', id: typo.id }); await wait(200);
  check('a moderator can delete it', A.of('deleted').some((m) => m.id === typo.id));
  C.say('#cats', 'my own line'); await wait(200);
  const mine = A.of('message').find((m) => m.line.text === 'my own line')?.line;
  C.send({ t: 'delete', room: '#cats', id: mine.id }); await wait(200);
  check('authors can delete their own', A.of('deleted').some((m) => m.id === mine.id));

  // --- typing, away, whois ---
  A.clear(); Bo.send({ t: 'typing', room: '#cats' }); Bo.send({ t: 'typing', room: '#cats' }); await wait(200);
  check('typing is relayed once (throttled)', A.of('typing').length === 1 && A.last('typing').nick === 'Bob', `n=${A.of('typing').length}`);
  Bo.clear(); A.say('#cats', '/away brb'); await wait(200);
  check('away shows in presence', Bo.last('presence')?.away?.includes('Ann'));
  Bo.clear(); Bo.say('#cats', '/whois Ann'); await wait(200);
  check('/whois reports status, rooms and role', Bo.systems().some((s) => /Ann is away \(brb\)/.test(s)) && Bo.systems().some((s) => /In: .*cats/.test(s)) && Bo.systems().some((s) => /Role in cats: owner/.test(s)), Bo.systems().join(' | '));
  A.say('#cats', '/back'); await wait(150);

  // --- blocks ---
  Bo.say('#cats', '/block Cat'); await wait(150);
  Bo.clear(); A.clear(); C.say('#cats', 'blocked hi'); await wait(250);
  check('a blocked member\'s messages are hidden from the blocker only', !Bo.of('message').length && A.of('message').some((m) => m.line.text === 'blocked hi'));
  C.clear(); C.send({ t: 'dm', to: 'Bob', text: 'hello?' }); await wait(150);
  check('a blocked member cannot message the blocker', hasErr(C, /not accepting messages from you/));
  Bo.clear(); Bo.send({ t: 'dm', to: 'Cat', text: 'hi' }); await wait(150);
  check('the blocker must unblock before messaging them', hasErr(Bo, /You have blocked Cat/));
  Bo.clear(); Bo.say('#cats', '/blocks'); await wait(150);
  check('/blocks lists them', Bo.systems().some((s) => /cat/i.test(s)));
  Bo.clear(); Bo.say('#cats', '/block Russ'); await wait(150);
  check('admins cannot be blocked', hasErr(Bo, /cannot block an administrator/));

  // --- private messages ---
  const A2 = await client(tok.Ann);
  A.clear(); A2.clear(); Bo.clear();
  A.send({ t: 'dm', to: 'bob', text: 'hey bob' }); await wait(250);
  check('DM reaches the recipient', Bo.last('dm')?.msg.text === 'hey bob' && Bo.last('dm')?.msg.from === 'Ann' && Bo.last('dm')?.msg.to === 'Bob');
  check('DM echoes to ALL of the sender\'s windows', A.of('dm').length === 1 && A2.of('dm').length === 1);
  const B2 = await client(tok.Bob);
  check('unread count is waiting when you log in elsewhere', B2.last('dms')?.threads?.[0]?.with === 'Ann' && B2.last('dms')?.threads?.[0]?.unread === 1, JSON.stringify(B2.last('dms')?.threads));
  Bo.clear(); B2.clear(); B2.send({ t: 'dmRead', with: 'Ann' }); await wait(250);
  check('marking read clears the badge in every window', Bo.last('dms')?.threads?.[0]?.unread === 0 && B2.last('dms')?.threads?.[0]?.unread === 0);
  B2.send({ t: 'dmHistory', with: 'Ann' }); await wait(200);
  check('DM history is saved and returned', B2.last('dmHistory')?.lines?.length === 1 && B2.last('dmHistory').lines[0].text === 'hey bob');
  A.clear(); A.send({ t: 'dm', to: 'Nobody', text: 'x' }); A.send({ t: 'dm', to: 'Ann', text: 'x' }); A.send({ t: 'dm', to: 'Bob', text: '/help' }); await wait(250);
  check('DM errors: unknown member, yourself, slash commands', hasErr(A, /no member called "Nobody"/) && hasErr(A, /cannot message yourself/) && hasErr(A, /Commands only work inside a room/), A.errors().join(' | '));
  Bo.clear(); A.send({ t: 'dm', to: 'Bob', text: '/me nods' }); await wait(200);
  check('/me works in a DM', Bo.last('dm')?.msg.kind === 'action' && Bo.last('dm')?.msg.text === 'nods');
  Bo.say('#cats', '/away lunch'); await wait(150);
  A.clear(); A.send({ t: 'dm', to: 'Bob', text: 'around?' }); await wait(200);
  check('messaging an away member tells you so', A.of('dmNotice').some((m) => /Bob is away: lunch/.test(m.text)));
  Bo.say('#cats', '/back'); await wait(100);
  await api('PUT', '/api/preferences', tok.Cat, { allowPm: false });
  A.clear(); A.send({ t: 'dm', to: 'Cat', text: 'psst' }); await wait(200);
  check('"allow private messages" off is enforced by the server', hasErr(A, /not accepting private messages/));
  C.clear(); C.send({ t: 'dmHistory', with: 'Ann' }); await wait(200);
  check('you cannot read other people\'s conversations', C.last('dmHistory')?.lines?.length === 0);

  // --- delete a room ---
  const T = await client(tok.Bob); await join(T, 'temp');
  const C2 = await client(tok.Cat); await join(C2, 'temp');
  T.say('#temp', 'remember me'); await wait(150);
  C2.clear(); C2.say('#temp', '/deleteroom'); await wait(150);
  check('only the owner can delete a room', hasErr(C2, /Only the room owner/));
  C2.clear(); T.say('#temp', '/deleteroom'); await wait(250);
  check('owner deletes the room and everyone is removed', C2.of('left').some((m) => m.room === '#temp'));
  T.send({ t: 'listRooms' }); await wait(150);
  check('deleted room is gone from the list', !T.last('rooms').rooms.some((r) => r.name === '#temp'));
  const j2 = await join(T, 'temp');
  check('a recreated room starts empty', j2.history.length === 0 && j2.roles.Bob === 'owner');
  R.clear(); await join(R, 'lobby'); R.say('#lobby', '/deleteroom'); await wait(150);
  check('built-in rooms cannot be deleted, even by an admin', hasErr(R, /Built-in rooms cannot be deleted/));

  // --- paging ---
  await join(R, 'bulk');
  for (let i = 1; i <= 120; i++) R.say('#bulk', `bulk ${i}`);
  await wait(900);
  const P = await client(tok.Ann); j = await join(P, 'bulk');
  check('join shows the latest 50 and says there is more', j.history.length === 50 && j.more === true && j.history.at(-1).text === 'bulk 120', `n=${j.history.length}`);
  P.send({ t: 'history', room: '#bulk', before: j.history[0].seq }); await wait(200);
  let h = P.last('history');
  check('"load earlier" returns the previous 50', h.lines.length === 50 && h.more === true && h.lines.at(-1).text === 'bulk 70' && h.lines[0].text === 'bulk 21');
  P.send({ t: 'history', room: '#bulk', before: h.lines[0].seq }); await wait(200);
  h = P.last('history');
  check('and the last page says no more', h.lines.length === 20 && h.more === false && h.lines[0].text === 'bulk 1');

  // --- flood control ---
  const F = await client(tok.Flo); await join(F, 'flood'); await join(R, 'flood'); R.clear(); F.clear();
  for (let i = 0; i < 10; i++) F.say('#flood', `spam ${i}`);
  await wait(400);
  check('flood control stops a burst of messages', R.of('message').length === 6 && F.errors().filter((e) => /too quickly/.test(e)).length === 4, `delivered=${R.of('message').length} refused=${F.errors().filter((e) => /too quickly/.test(e)).length}`);
  R.clear(); R.say('#flood', 'admin 1'); R.say('#flood', 'admin 2'); R.say('#flood', 'admin 3'); R.say('#flood', 'admin 4'); R.say('#flood', 'admin 5'); R.say('#flood', 'admin 6'); R.say('#flood', 'admin 7'); await wait(300);
  check('admins are exempt from flood control', R.errors().length === 0);

  // --- hardening ---
  const capTok = await tokenFor('Cap', 'cappass1');
  const caps = [];
  for (let i = 0; i < 9; i++) caps.push(await client(capTok));
  check('too many open windows for one account are refused', caps.slice(0, 8).every((c) => !c.isClosed()) && caps[8].isClosed() && caps[8].errors().some((e) => /too many/.test(e)));
  const big = await client(tok.Ann); big.send({ t: 'say', room: '#cats', text: 'x'.repeat(20000) }); await wait(300);
  check('an oversized frame closes the connection', big.isClosed());
  const long = await client(tok.Ann); await join(long, 'cats'); Bo.clear(); await wait(8500);
  long.say('#cats', 'y'.repeat(5000)); await wait(250);
  check('long messages are cut to 2000 characters', Bo.last('message')?.line.text.length === 2000, 'len=' + Bo.last('message')?.line.text.length);
  A.clear(); const ctl = await client(tok.Ann); await join(ctl, 'cats'); Bo.clear(); ctl.say('#cats', 'tab\u0000bell\u0007 end'); await wait(250);
  check('control characters are stripped', Bo.last('message')?.line.text === 'tabbell end', JSON.stringify(Bo.last('message')?.line.text));
  Bo.clear(); await wait(8500); ctl.say('#cats', 'line one\nline two\tend'); await wait(250);
  check('newlines and tabs become spaces', Bo.last('message')?.line.text === 'line one line two end', JSON.stringify(Bo.last('message')?.line.text));

  // --- set up state that must survive a restart ---
  A.say('#cats', '/ban Dan again'); Bo.say('#cats', '/mute Cat 0'); await wait(300);

  console.log(`\nPHASE A: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

if (phase === 'b') {
  const tok = {};
  for (const n of Object.keys(PW)) tok[n] = await tokenFor(n, PW[n]);
  const A = await client(tok.Ann), Bo = await client(tok.Bob), C = await client(tok.Cat), D = await client(tok.Dan), R = await client(tok.Russ);

  let j = await join(A, 'cats');
  const texts = j.history.map((m) => m.text);
  check('messages survived the restart', ['hello 1', 'hello 2', 'hello 3'].every((t) => texts.includes(t)), `n=${texts.length}`);
  check('actions survived', j.history.some((m) => m.kind === 'action' && m.text === 'waves'));
  check('edits survived (with the edited flag)', j.history.some((m) => m.text === 'a typo here') === false /* it was deleted */ && !texts.includes('a typpo here'));
  check('deleted messages stay deleted', !texts.includes('a typo here') && !texts.includes('my own line'));
  check('topic survived', j.topic?.text === 'Cats rule' && j.topic?.by === 'Bob');
  check('owner survived', j.roles.Ann === 'owner');
  const jb = await join(Bo, 'cats');
  check('moderator survived', jb.roles.Bob === 'mod');
  check('blocked member\'s old messages stay hidden from the blocker', !jb.history.some((m) => m.from === 'Cat') && j.history.some((m) => m.from === 'Cat'));
  D.clear(); D.send({ t: 'join', room: 'cats' }); await wait(200);
  check('ban survived', /banned from cats/.test(D.errors().join(' ')) && !D.last('joined'));
  await join(C, 'cats'); C.clear(); C.say('#cats', 'am I still muted'); await wait(200);
  check('indefinite mute survived', hasErr(C, /muted in cats/));
  Bo.clear(); await wait(100);
  const Bw = await client(tok.Bob);
  const th = Bw.last('dms')?.threads ?? [];
  check('private conversations survived', th.some((t) => t.with === 'Ann'), JSON.stringify(th));
  Bw.send({ t: 'dmHistory', with: 'Ann' }); await wait(200);
  const dl = Bw.last('dmHistory')?.lines ?? [];
  check('private message history survived (incl. action)', dl.some((m) => m.text === 'hey bob') && dl.some((m) => m.kind === 'action' && m.text === 'nods'), `n=${dl.length}`);
  check('read state survived', th.find((t) => t.with === 'Ann')?.unread === 2 || th.find((t) => t.with === 'Ann')?.unread === 0, 'unread=' + th.find((t) => t.with === 'Ann')?.unread);
  A.send({ t: 'listRooms' }); await wait(200);
  const cats = A.last('rooms').rooms.find((r) => r.name === '#cats');
  check('room list shows topic and owner after restart', cats?.topic === 'Cats rule' && cats?.owner === 'Ann', JSON.stringify(cats));
  check('big room survived with paging', (await join(await client(tok.Ann), 'bulk')).more === true);
  check('built-in rooms still exist and are permanent', A.last('rooms').rooms.filter((r) => r.permanent).map((r) => r.name).sort().join() === '#general,#help,#lobby,#trivia');
  console.log(`\nPHASE B: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
