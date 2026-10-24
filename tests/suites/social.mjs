const B = 'http://localhost:8199', WS = 'ws://localhost:8199/ws';
const phase = process.argv[2] || 'a';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const cool = () => wait(8400); // let the flood window clear
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  -> ' + extra : '')); };
const api = async (method, path, token, body) => {
  const r = await fetch(B + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = {}; try { j = await r.json(); } catch {}
  return { s: r.status, j };
};
async function tokenFor(name, pw) {
  let r = await api('POST', '/api/register', null, { account: name, password: pw });
  if (!r.j.token) r = await api('POST', '/api/login', null, { account: name, password: pw });
  return r.j.token;
}
async function client(token) {
  const ws = new WebSocket(WS); const got = []; let closed = false;
  ws.onmessage = (e) => got.push(JSON.parse(e.data)); ws.onclose = () => (closed = true);
  await new Promise((r) => (ws.onopen = r));
  const c = {
    ws, got, isClosed: () => closed, close: () => ws.close(),
    send: (m) => ws.send(JSON.stringify(m)), of: (t) => got.filter((x) => x.t === t), last: (t) => got.filter((x) => x.t === t).at(-1),
    clear: () => (got.length = 0), errors: () => got.filter((x) => x.t === 'error').map((x) => x.text), infos: () => got.filter((x) => x.t === 'info').map((x) => x.text),
    say: (room, text, extra = {}) => ws.send(JSON.stringify({ t: 'say', room, text, ...extra })),
  };
  c.send({ t: 'hello', token }); await wait(250);
  return c;
}
const join = async (c, room) => { c.send({ t: 'join', room }); await wait(200); return c.last('joined'); };
const hasErr = (c, re) => c.errors().some((e) => re.test(e));
const upload = async (token, body, type = 'image/png') => {
  const r = await fetch(B + '/api/upload', { method: 'POST', headers: { 'content-type': type, ...(token ? { authorization: 'Bearer ' + token } : {}) }, body });
  let j = {}; try { j = await r.json(); } catch {}
  return { s: r.status, j };
};
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')]);
const GIF = Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;;;;', 'latin1');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([4, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const PW = { Russ: 'secret123', Ann: 'annpass1', Bob: 'bobpass1', Cat: 'catpass1', Dan: 'danpass1', Upl: 'uplpass1' };

if (phase === 'a') {
  const tok = {}; for (const n of Object.keys(PW)) tok[n] = await tokenFor(n, PW[n]);
  const R = await client(tok.Russ), A = await client(tok.Ann), Bo = await client(tok.Bob), C = await client(tok.Cat), D = await client(tok.Dan);
  for (const c of [A, Bo, C, R]) await join(c, 'w2');

  // ---------------- replies ----------------
  A.say('#w2', 'the original message'); await wait(250);
  const orig = Bo.of('message').find((m) => m.line.text === 'the original message').line;
  Bo.clear(); Bo.say('#w2', 'I agree', { replyTo: orig.id }); await wait(250);
  const reply = A.of('message').find((m) => m.line.text === 'I agree')?.line;
  check('a reply carries a snapshot of the original', reply?.replyTo?.id === orig.id && reply.replyTo.from === 'Ann' && reply.replyTo.text === 'the original message', JSON.stringify(reply?.replyTo));
  Bo.clear(); Bo.say('#w2', 'orphan reply', { replyTo: 'no-such-id' }); await wait(200);
  check('replying to a message that is not there is refused', hasErr(Bo, /no longer exists/));
  const j = await join(await client(tok.Dan), 'w2');
  check('replies come back in saved history', j.history.find((l) => l.text === 'I agree')?.replyTo?.text === 'the original message');
  await cool();

  // ---------------- reactions ----------------
  Bo.clear(); A.clear(); Bo.send({ t: 'react', room: '#w2', id: orig.id, emoji: '👍' }); await wait(250);
  check('a reaction is shown to everyone in the room', JSON.stringify(A.last('reactions')?.reactions) === JSON.stringify({ '👍': ['Bob'] }), JSON.stringify(A.last('reactions')?.reactions));
  A.send({ t: 'react', room: '#w2', id: orig.id, emoji: '👍' }); await wait(200);
  check('reactions add up', A.last('reactions')?.reactions['👍'].length === 2);
  Bo.send({ t: 'react', room: '#w2', id: orig.id, emoji: '👍' }); await wait(200);
  check('reacting again removes your reaction', JSON.stringify(A.last('reactions')?.reactions['👍']) === JSON.stringify(['Ann']));
  Bo.clear(); Bo.send({ t: 'react', room: '#w2', id: orig.id, emoji: '💩' }); await wait(150);
  check('only the offered emoji are allowed', hasErr(Bo, /not available/));
  const outsider = await client(tok.Dan); outsider.clear(); // Dan is in w2 via the join above; use a non-member instead
  const nm = await client(tok.Upl); nm.send({ t: 'react', room: '#w2', id: orig.id, emoji: '❤️' }); await wait(200);
  check('you cannot react in a room you are not in', !A.of('reactions').some((m) => m.reactions['❤️']));
  const j2 = await join(await client(tok.Cat), 'w2');
  check('reactions come back in saved history', JSON.stringify(j2.history.find((l) => l.id === orig.id)?.reactions) === JSON.stringify({ '👍': ['Ann'] }));
  await cool();

  // ---------------- reports ----------------
  Bo.clear(); R.clear();
  Bo.send({ t: 'report', room: '#w2', id: orig.id, reason: 'seems rude' }); await wait(300);
  check('reporter is thanked', Bo.infos().some((t) => /an admin will take a look/i.test(t)));
  check('online admins are told straight away', R.infos().some((t) => /New report: Bob reported a message by Ann/.test(t)), R.infos().join(' | '));
  Bo.clear(); Bo.send({ t: 'report', room: '#w2', id: orig.id }); await wait(200);
  check('the same message cannot be reported twice by one person', hasErr(Bo, /already reported/));
  A.clear(); A.send({ t: 'report', room: '#w2', id: orig.id }); await wait(200);
  check('you cannot report your own message', hasErr(A, /your own message/));
  const rtoken = tok.Russ;
  let r = await api('GET', '/api/admin/reports', tok.Bob); check('reports are admin only', r.s === 403);
  r = await api('GET', '/api/admin/reports', rtoken);
  const rep = r.j.reports?.[0];
  check('admin sees the report with a snapshot of the message', r.j.reports?.length === 1 && rep.author === 'Ann' && rep.reporter === 'Bob' && rep.text === 'the original message' && rep.reason === 'seems rude' && rep.status === 'open', JSON.stringify(rep));
  check('dashboard counts open reports', (await api('GET', '/api/admin/stats', rtoken)).j.stats.openReports === 1);
  C.send({ t: 'report', room: '#w2', id: orig.id, reason: 'agree with Bob' }); await wait(250);
  r = await api('GET', '/api/admin/reports', rtoken); check('a second person can report the same message', r.j.reports.length === 2);
  A.clear(); r = await api('POST', `/api/admin/reports/${rep.id}/resolve`, rtoken, { action: 'delete' }); await wait(250);
  check('deleting from a report removes the message for everyone', r.s === 200 && A.of('deleted').some((m) => m.id === orig.id));
  r = await api('GET', '/api/admin/reports', rtoken); check('and settles every report on that message', r.j.reports.length === 0);
  r = await api('POST', `/api/admin/reports/${rep.id}/resolve`, rtoken, { action: 'dismiss' }); check('a settled report cannot be settled again', r.s === 409);
  r = await api('GET', '/api/admin/reports?status=all', rtoken); check('settled reports keep a record of what was done', r.j.reports.every((x) => x.status === 'resolved' && x.resolution === 'deleted' && x.resolvedBy === 'Russ'));
  check('open report count is back to zero', (await api('GET', '/api/admin/stats', rtoken)).j.stats.openReports === 0);
  r = await api('POST', `/api/admin/reports/999/resolve`, rtoken, { action: 'dismiss' }); check('unknown report is a 404', r.s === 404);
  await cool();
  A.say('#w2', 'a harmless message'); await wait(250);
  const harmless = Bo.of('message').find((m) => m.line.text === 'a harmless message').line;
  Bo.send({ t: 'report', room: '#w2', id: harmless.id }); await wait(250);
  r = await api('GET', '/api/admin/reports', rtoken);
  r = await api('POST', `/api/admin/reports/${r.j.reports[0].id}/resolve`, rtoken, { action: 'dismiss' });
  Bo.clear(); await wait(100);
  check('dismissing a report leaves the message alone', r.s === 200 && !!(await join(await client(tok.Dan), 'w2')).history.find((l) => l.id === harmless.id));
  check('admin actions on reports are audited', (await api('GET', '/api/admin/audit', rtoken)).j.entries.some((e) => e.action === 'resolve-report'));

  // ---------------- search ----------------
  await cool();
  for (const t of ['the purple elephant', 'a green elephant', 'only a tiger', 'axb', 'a_b', 'score of 100% today']) { A.say('#w2', t); await wait(120); }
  await wait(200);
  Bo.clear(); Bo.send({ t: 'search', room: '#w2', q: 'elephant' }); await wait(250);
  let sr = Bo.last('searchResults');
  check('search finds matching messages, newest first', sr?.lines.length === 2 && sr.lines[0].text === 'a green elephant', JSON.stringify(sr?.lines.map((l) => l.text)));
  Bo.send({ t: 'search', room: '#w2', q: 'a_b' }); await wait(250);
  check('"_" is searched for literally (not a wildcard)', JSON.stringify(Bo.last('searchResults').lines.map((l) => l.text)) === JSON.stringify(['a_b']));
  Bo.send({ t: 'search', room: '#w2', q: '100%' }); await wait(250);
  check('"%" is searched for literally too', Bo.last('searchResults').lines.length === 1);
  Bo.clear(); Bo.send({ t: 'search', room: '#w2', q: 'e' }); await wait(150);
  check('very short searches are refused', hasErr(Bo, /at least 2 characters/));
  nm.clear(); nm.send({ t: 'search', room: '#w2', q: 'elephant' }); await wait(200);
  check('you can only search rooms you are in', !nm.last('searchResults'));
  Bo.say('#w2', '/block Ann'); await wait(150);
  Bo.send({ t: 'search', room: '#w2', q: 'elephant' }); await wait(250);
  check('blocked members are left out of your search results', Bo.last('searchResults').lines.length === 0);
  Bo.say('#w2', '/unblock Ann'); await wait(150);

  // ---------------- uploads ----------------
  let u = await upload(tok.Ann, PNG);
  check('a real PNG uploads', u.s === 200 && /^[a-f0-9]{24}\.png$/.test(u.j.name), JSON.stringify(u.j));
  const png = u.j;
  const got = await fetch(B + png.url);
  check('and is served as an image with sniffing disabled', got.status === 200 && got.headers.get('content-type') === 'image/png' && got.headers.get('x-content-type-options') === 'nosniff' && /sandbox/.test(got.headers.get('content-security-policy') || ''));
  check('JPG, GIF and WebP are accepted too', (await upload(tok.Ann, JPG, 'image/jpeg')).s === 200 && (await upload(tok.Ann, GIF, 'image/gif')).s === 200 && (await upload(tok.Ann, WEBP, 'image/webp')).s === 200);
  check('HTML pretending to be a PNG is refused', (await upload(tok.Ann, Buffer.from('<html><script>alert(1)</script></html>......'), 'image/png')).s === 415);
  check('SVG is refused', (await upload(tok.Ann, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>'), 'image/svg+xml')).s === 415);
  check('an executable is refused', (await upload(tok.Ann, Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff'), 'image/png')).s === 415);
  check('uploading needs a login', (await upload(undefined, PNG)).s === 401);
  check('oversize pictures are refused', (await upload(tok.Ann, Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024)]))).s === 413);
  check('path tricks in the file name get nothing', (await fetch(B + '/uploads/..%2f..%2fqchat.db')).status === 404 && (await fetch(B + '/uploads/nothere.png')).status === 404 && (await fetch(B + '/uploads/')).status === 404);
  // Rate limit: a fresh account.
  let last = 0; for (let i = 0; i < 22; i++) last = (await upload(tok.Upl, PNG)).s;
  check('uploads are rate limited per account', last === 429, 'status of #22 = ' + last);

  await cool();
  Bo.clear(); A.clear();
  A.say('#w2', 'look at this', { image: png.name }); await wait(250);
  const imgMsg = Bo.of('message').find((m) => m.line.image)?.line;
  check('a picture posts with its caption', imgMsg?.image === png.url && imgMsg.text === 'look at this');
  A.say('#w2', '', { image: png.name }); await wait(200);
  check('a picture needs no caption', Bo.of('message').some((m) => m.line.image && m.line.text === ''));
  Bo.clear(); Bo.say('#w2', 'stolen', { image: png.name }); await wait(200);
  check('you cannot post someone else\'s upload', hasErr(Bo, /could not be found/));
  Bo.clear(); Bo.say('#w2', 'x', { image: '../../etc/passwd' }); Bo.say('#w2', 'x', { image: 'ffffffffffffffffffffffff.png' }); await wait(250);
  check('made-up or traversal names are refused', Bo.errors().filter((e) => /could not be found/.test(e)).length === 2);
  A.send({ t: 'edit', room: '#w2', id: imgMsg.id, text: '' }); await wait(200);
  check('a picture\'s caption can be removed', Bo.last('edited')?.id === imgMsg.id && Bo.last('edited').text === '');
  A.say('#w2', 'plain text'); await wait(200);
  const plain = Bo.of('message').find((m) => m.line.text === 'plain text').line;
  A.clear(); A.send({ t: 'edit', room: '#w2', id: plain.id, text: '   ' }); await wait(200);
  check('but a text message cannot be emptied', !Bo.of('edited').some((m) => m.id === plain.id));

  // ---------------- friends ----------------
  await cool();
  A.clear(); Bo.clear();
  A.send({ t: 'friendRequest', to: 'bob' }); await wait(300);
  check('a friend request reaches the other person', Bo.last('friends')?.incoming?.includes('Ann') && A.last('friends')?.outgoing?.includes('Bob') && Bo.infos().some((t) => /Ann sent you a friend request/.test(t)));
  A.clear(); A.send({ t: 'friendRequest', to: 'Bob' }); A.send({ t: 'friendRequest', to: 'Ann' }); A.send({ t: 'friendRequest', to: 'Nobody' }); await wait(250);
  check('duplicates, yourself and strangers are refused', hasErr(A, /already sent/) && hasErr(A, /yourself/) && hasErr(A, /no member called "Nobody"/));
  Bo.clear(); A.clear(); Bo.send({ t: 'friendRespond', from: 'Ann', accept: true }); await wait(300);
  check('accepting makes you friends, in both lists', A.last('friends')?.friends?.some((f) => f.name === 'Bob') && Bo.last('friends')?.friends?.some((f) => f.name === 'Ann') && Bo.last('friends').incoming.length === 0);
  check('friends show as online', A.last('friends').friends.find((f) => f.name === 'Bob').online === true);
  A.clear(); Bo.clear(); Bo.close(); await wait(400);
  check('friends see you go offline', A.last('friends')?.friends?.find((f) => f.name === 'Bob')?.online === false);
  const Bo2 = await client(tok.Bob); await wait(300);
  check('and come back online', A.last('friends')?.friends?.find((f) => f.name === 'Bob')?.online === true);
  C.clear(); D.clear();
  C.send({ t: 'friendRequest', to: 'Dan' }); await wait(250); D.send({ t: 'friendRequest', to: 'Cat' }); await wait(300);
  check('if you both ask each other you become friends at once', C.last('friends')?.friends?.some((f) => f.name === 'Dan') && D.last('friends')?.friends?.some((f) => f.name === 'Cat'));
  C.clear(); C.send({ t: 'friendRemove', who: 'Dan' }); await wait(300);
  check('unfriending updates both sides', !C.last('friends').friends.length && !D.last('friends').friends.length);
  R.send({ t: 'friendRequest', to: 'Cat' }); await wait(250); C.clear(); C.send({ t: 'friendRespond', from: 'Russ', accept: false }); await wait(250);
  check('declining a request makes no friendship', !C.last('friends').friends.length && C.last('friends').incoming.length === 0);
  await cool();
  await join(Bo2, 'w2');
  A.clear(); Bo2.clear();
  Bo2.say('#w2', '/block Ann'); await wait(300);
  const afterBlock = A.last('friends');
  check('blocking someone ends the friendship (and tells them)', !!afterBlock && !afterBlock.friends.some((f) => f.name === 'Bob'), JSON.stringify(afterBlock));
  A.send({ t: 'friendRequest', to: 'Bob' }); await wait(200);
  check('and you cannot ask each other again', hasErr(A, /cannot send Bob a friend request/));
  Bo2.say('#w2', '/unblock Ann'); await wait(200);
  // Leave one lasting friendship + request for phase B.
  A.send({ t: 'friendRequest', to: 'Bob' }); await wait(250); Bo2.send({ t: 'friendRespond', from: 'Ann', accept: true }); await wait(250);

  // ---------------- room settings ----------------
  await join(A, 'w2s'); await join(Bo2, 'w2s'); await join(C, 'w2s'); await join(D, 'w2s');
  A.say('#w2s', '/mod Bob'); A.say('#w2s', '/ban Dan spam'); A.say('#w2s', '/mute Cat 30 noise'); await wait(400);
  A.clear(); A.send({ t: 'roomAdmin', room: '#w2s' }); await wait(250);
  const ra = A.last('roomAdmin');
  check('room settings list moderators, bans and mutes', ra?.owner === 'Ann' && ra.mods.includes('Bob') && ra.bans.includes('Dan') && ra.mutes.some((m) => m.name === 'Cat' && m.until > Date.now()), JSON.stringify(ra));
  C.clear(); C.send({ t: 'roomAdmin', room: '#w2s' }); await wait(200);
  check('ordinary members cannot open room settings', hasErr(C, /Only moderators/) && !C.last('roomAdmin'));

  console.log(`\nWAVE 2, PHASE A: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

if (phase === 'b') {
  const tok = {}; for (const n of Object.keys(PW)) tok[n] = await tokenFor(n, PW[n]);
  const A = await client(tok.Ann), Bo = await client(tok.Bob);
  const j = await join(Bo, 'w2');
  check('picture messages survived the restart', j.history.some((l) => l.image && l.image.startsWith('/uploads/')));
  const imgLine = j.history.find((l) => l.image);
  check('and the picture file is still served', (await fetch(B + imgLine.image)).status === 200);
  check('reactions survived the restart', j.history.some((l) => l.reactions && Object.keys(l.reactions).length));
  check('replies survived the restart', j.history.some((l) => l.replyTo));
  check('friendships survived the restart', A.last('friends')?.friends?.some((f) => f.name === 'Bob') && Bo.last('friends')?.friends?.some((f) => f.name === 'Ann'));
  const r = await api('GET', '/api/admin/reports?status=all', tok.Russ);
  check('the report history survived the restart', r.j.reports.length === 3, 'n=' + r.j.reports.length);
  // Deleting a member removes their pictures.
  const up = await upload(tok.Dan, PNG);
  check('(setup) Dan uploaded a picture', up.s === 200);
  const dr = await api('GET', '/api/admin/users?q=Dan', tok.Russ);
  await api('POST', '/api/admin/users/Dan/role', tok.Russ, { role: 'user' });
  const del = await api('DELETE', '/api/admin/users/Dan', tok.Russ);
  check('admin deletes the member', del.s === 200);
  check('their pictures are deleted with them', (await fetch(B + up.j.url)).status === 404);
  console.log(`\nWAVE 2, PHASE B: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
