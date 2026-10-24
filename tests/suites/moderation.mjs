// Started by tests/run.mjs: the blocked words list, the new-member link rule, and the admin settings that control them.
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
    texts: (room) => got.filter((x) => x.t === 'message' && x.room === room && !x.line.bot).map((x) => x.line.text),
  };
  c.send({ t: 'hello', token }); await wait(250);
  return c;
}
const PW = { Russ: 'secret123', Newbie: 'newbie-pass-1', Oldie: 'oldie-pass-1', Rcv: 'rcvpass-123' };
const ROOM = '#modroom';

if (phase === 'a') {
  const russ = await tokenFor('Russ', PW.Russ);
  const newbie = await tokenFor('Newbie', PW.Newbie);
  await tokenFor('Oldie', PW.Oldie);
  const rcv = await tokenFor('Rcv', PW.Rcv);

  // ---------------- settings ----------------
  let r = await api('GET', '/api/admin/settings', russ);
  check('by default new members cannot post links for 10 minutes', r.j.settings?.newMemberLinkMinutes === 10 && r.j.settings?.blockedWords === '', JSON.stringify(r.j.settings));
  r = await api('PUT', '/api/admin/settings', russ, { newMemberLinkMinutes: -1 });
  check('a negative number of minutes is refused', r.s === 422, String(r.s));
  r = await api('PUT', '/api/admin/settings', russ, { newMemberLinkMinutes: 5000 });
  check('so is a number that is too big', r.s === 422, String(r.s));
  r = await api('PUT', '/api/admin/settings', russ, { blockedWords: 'x'.repeat(2001) });
  check('and a list that is too long', r.s === 422, String(r.s));
  r = await api('PUT', '/api/admin/settings', newbie, { blockedWords: 'anything' });
  check('an ordinary member cannot change them', r.s === 403, String(r.s));

  const N = await client(newbie), R = await client(rcv), A = await client(russ);
  for (const c of [N, R, A]) { c.send({ t: 'join', room: ROOM }); await wait(300); }

  // ---------------- blocked words ----------------
  r = await api('PUT', '/api/admin/settings', russ, { blockedWords: 'badword\r\nNasty Phrase\n  \nass' });
  check('an administrator can set the list', r.s === 200 && r.j.settings.blockedWords === 'badword\nNasty Phrase\n  \nass', JSON.stringify(r.j.settings?.blockedWords));
  const tryRoom = async (text) => { N.clear(); R.clear(); N.send({ t: 'say', room: ROOM, text }); await wait(1700); return { err: N.errors(), seen: R.texts(ROOM) }; };
  let t = await tryRoom('this has a badword in it');
  check('a message with a blocked word is not sent', t.err.some((e) => /not allowed/.test(e)) && t.seen.length === 0, JSON.stringify(t));
  t = await tryRoom('BADWORD shouted');
  check('capital letters do not get round it', t.err.length === 1 && t.seen.length === 0);
  t = await tryRoom('b4dw0rd with numbers');
  check('look-alike characters do not either', t.err.length === 1 && t.seen.length === 0);
  t = await tryRoom('a nasty   phrase here');
  check('a blocked phrase is caught', t.err.length === 1 && t.seen.length === 0);
  t = await tryRoom('that was badword!');
  check('and so is a word next to punctuation', t.err.length === 1 && t.seen.length === 0);
  t = await tryRoom('what a lovely class of badwords');
  check('whole words only: "badwords" and "class" are fine', t.err.length === 0 && t.seen.length === 1, JSON.stringify(t));
  t = await tryRoom('an ordinary message');
  check('ordinary messages are fine', t.err.length === 0 && t.seen.length === 1);

  N.clear(); N.send({ t: 'say', room: ROOM, text: 'edit me' }); await wait(1300);
  const mine = N.got.find((x) => x.t === 'message' && x.line.text === 'edit me')?.line;
  N.clear(); N.send({ t: 'edit', room: ROOM, id: mine.id, text: 'now with badword' }); await wait(1300);
  const hist = (await (async () => { R.clear(); R.send({ t: 'history', room: ROOM }); await wait(300); return R.got.find((x) => x.t === 'history'); })());
  check('editing a message cannot slip a blocked word in', N.errors().length === 1 && !JSON.stringify(hist ?? {}).includes('now with badword'), JSON.stringify(N.errors()));

  N.clear(); R.clear(); N.send({ t: 'dm', to: 'Rcv', text: 'a private badword' }); await wait(1300);
  check('private messages are screened too', N.errors().length === 1 && !R.got.some((x) => x.t === 'dm'), JSON.stringify(N.errors()));

  A.clear(); R.clear(); A.send({ t: 'say', room: ROOM, text: 'admins may say badword when they must' }); await wait(1300);
  check('administrators are exempt', A.errors().length === 0 && R.texts(ROOM).length === 1);

  // ---------------- new member links ----------------
  t = await tryRoom('look at https://example.com/page');
  check('a new member cannot post a link', t.err.some((e) => /cannot post links/.test(e)) && t.seen.length === 0, JSON.stringify(t));
  t = await tryRoom('see www.example.org');
  check('nor a www address', t.err.length === 1);
  t = await tryRoom('visit example.com now');
  check('nor a bare domain', t.err.length === 1);
  t = await tryRoom('the file is called notes.txt and it is v1.2 of the thing, e.g. fine');
  check('ordinary dots are not mistaken for links', t.err.length === 0 && t.seen.length === 1, JSON.stringify(t));
  A.clear(); R.clear(); A.send({ t: 'say', room: ROOM, text: 'admin link https://example.com' }); await wait(1300);
  check('administrators can post links', A.errors().length === 0 && R.texts(ROOM).length === 1);

  r = await api('PUT', '/api/admin/settings', russ, { newMemberLinkMinutes: 0 });
  t = await tryRoom('now allowed https://example.com');
  check('with the rule off, a new member can post a link', r.s === 200 && t.err.length === 0 && t.seen.length === 1, JSON.stringify(t));
  await api('PUT', '/api/admin/settings', russ, { newMemberLinkMinutes: 10 });

  const audit = await api('GET', '/api/admin/audit', russ);
  check('the settings changes are in the audit log', /blockedWords/.test(audit.text) && /newMemberLinkMinutes/.test(audit.text));
  for (const c of [N, R, A]) c.close();
}

if (phase === 'b') {
  // "Oldie" was made to look like a member from long ago, and the server was restarted.
  const oldie = await tokenFor('Oldie', PW.Oldie), rcv = await tokenFor('Rcv', PW.Rcv);
  const r = await api('GET', '/api/admin/settings', await tokenFor('Russ', PW.Russ));
  check('the settings survived the restart', r.j.settings?.blockedWords?.includes('badword') && r.j.settings?.newMemberLinkMinutes === 10, JSON.stringify(r.j.settings));
  const O = await client(oldie), R = await client(rcv);
  for (const c of [O, R]) { c.send({ t: 'join', room: ROOM }); await wait(300); }
  O.clear(); R.clear(); O.send({ t: 'say', room: ROOM, text: 'an established member posts https://example.com' }); await wait(1300);
  check('an established member can post links', O.errors().length === 0 && R.texts(ROOM).length === 1, JSON.stringify(O.errors()));
  O.clear(); R.clear(); O.send({ t: 'say', room: ROOM, text: 'but not the badword' }); await wait(1300);
  check('the word list still applies to them', O.errors().length === 1 && R.texts(ROOM).length === 0);
  for (const c of [O, R]) c.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
