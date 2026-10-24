const B = 'http://localhost:8199', WS = 'ws://localhost:8199/ws';
const phase = process.argv[2] || 'a';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
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
  const ws = new WebSocket(WS); const got = [];
  ws.onmessage = (e) => got.push(JSON.parse(e.data));
  await new Promise((r) => (ws.onopen = r));
  const c = {
    ws, got, send: (m) => ws.send(JSON.stringify(m)), of: (t) => got.filter((x) => x.t === t), last: (t) => got.filter((x) => x.t === t).at(-1),
    clear: () => (got.length = 0), errors: () => got.filter((x) => x.t === 'error').map((x) => x.text),
    say: (room, text) => ws.send(JSON.stringify({ t: 'say', room, text })),
  };
  c.send({ t: 'hello', token }); await wait(250);
  return c;
}
const join = async (c, room) => { c.send({ t: 'join', room }); await wait(250); return c.last('joined'); };
const presBots = (c, room) => c.of('presence').filter((p) => p.room === room).at(-1)?.bots;
const names = (bots) => (bots ?? []).map((b) => b.name);
const PW = { Russ: 'secret123', Ann: 'annpass1', Bob: 'bobpass1' };

const tok = {}; for (const n of Object.keys(PW)) tok[n] = await tokenFor(n, PW[n]);

if (phase === 'a') {
  // ---------- QBot is in every room ----------
  const A = await client(tok.Ann), R = await client(tok.Russ);
  let j = await join(A, 'bots1');
  check('QBot is in a brand new room', names(j.bots).includes('QBot'), JSON.stringify(j.bots));
  check('QBot is not counted as a member', !j.members.includes('QBot') && j.members.length === 1, JSON.stringify(j.members));
  j = await join(A, 'lobby');
  check('QBot is in the built-in rooms too', names(j.bots).includes('QBot'));
  const rooms = await api('GET', '/api/admin/rooms', tok.Russ);
  check('admin room list does not count bots as members', rooms.j.rooms.every((r) => !r.members.includes('QBot')));
  check('presence updates carry the bots', names(presBots(A, '#bots1')).includes('QBot'));

  // ---------- names are reserved ----------
  let r = await api('POST', '/api/register', null, { account: 'QBot', password: 'whatever1' });
  check('nobody can register the name QBot', r.s >= 400 && !r.j.token, r.j.error);
  r = await api('POST', '/api/register', null, { account: 'qbot', password: 'whatever1' });
  check('...in any letter case', r.s >= 400 && !r.j.token);

  // ---------- admin API ----------
  r = await api('GET', '/api/admin/bots', tok.Ann);
  check('bots admin is admin only', r.s === 403);
  r = await api('GET', '/api/admin/bots');
  check('bots admin needs a login', r.s === 401);
  r = await api('GET', '/api/admin/bots', tok.Russ);
  const qbot = r.j.bots?.find((b) => b.name === 'QBot');
  check('admin sees QBot as built in, on, in every room', qbot?.builtin && qbot.enabled && qbot.allRooms, JSON.stringify(qbot));

  r = await api('POST', '/api/admin/bots', tok.Russ, { name: 'QuizBot', description: 'Runs the quiz', emoji: '🎲', allRooms: false, rooms: ['#bots1'] });
  check('admin can create a bot', r.s === 200 && r.j.bot?.name === 'QuizBot' && r.j.bot.rooms.join() === '#bots1', JSON.stringify(r.j));
  await wait(300);
  check('members in that room see it appear', names(presBots(A, '#bots1')).join() === 'QBot,QuizBot', JSON.stringify(names(presBots(A, '#bots1'))));
  const lobbyBots = (await join(A, 'lobby')).bots;
  check('...but it is not in other rooms', !names(lobbyBots).includes('QuizBot'));
  check('its picture and description come through', (await join(A, 'bots1')).bots.find((b) => b.name === 'QuizBot')?.emoji === '🎲');

  for (const [label, body] of [['an empty name', { name: '' }], ['spaces in a name', { name: 'Quiz Bot' }], ['a name starting with a digit', { name: '9bot' }], ['a one letter name', { name: 'Q' }], ['a very long name', { name: 'A'.repeat(30) }]]) {
    r = await api('POST', '/api/admin/bots', tok.Russ, body);
    check('refuses ' + label, r.s === 422, r.j.error);
  }
  r = await api('POST', '/api/admin/bots', tok.Russ, { name: 'quizbot' });
  check('refuses a duplicate name (any case)', r.s === 409, r.j.error);
  r = await api('POST', '/api/admin/bots', tok.Russ, { name: 'Ann' });
  check('refuses a name a member already has', r.s === 409, r.j.error);
  r = await api('POST', '/api/register', null, { account: 'QuizBot', password: 'whatever1' });
  check('and members cannot take a custom bot name', r.s >= 400 && !r.j.token);

  // ---------- speaking ----------
  A.clear(); R.send({ t: 'join', room: 'bots1' }); await wait(250);
  r = await api('POST', '/api/admin/bots/QuizBot/say', tok.Russ, { room: '#bots1', text: 'Question one: what is 2+2?' });
  await wait(250);
  const said = A.of('message').find((m) => m.line.text === 'Question one: what is 2+2?')?.line;
  check('a bot can speak in its room', r.s === 200 && said?.from === 'QuizBot' && said.bot === true, JSON.stringify(said));
  r = await api('POST', '/api/admin/bots/QuizBot/say', tok.Russ, { room: '#lobby', text: 'wrong room' });
  check('a bot cannot speak where it is not', r.s === 422, r.j.error);
  r = await api('POST', '/api/admin/bots/QuizBot/say', tok.Russ, { room: '#bots1', text: '   ' });
  check('an empty message is refused', r.s === 422, r.j.error);
  r = await api('POST', '/api/admin/bots/QuizBot/say', tok.Ann, { room: '#bots1', text: 'hi' });
  check('members cannot make bots speak', r.s === 403);
  r = await api('POST', '/api/admin/bots/QBot/say', tok.Russ, { room: '#lobby', text: 'Welcome to QChat!' });
  check('QBot can speak anywhere', r.s === 200);
  const hist = (await join(await client(tok.Bob), 'bots1')).history;
  const line = hist.find((l) => l.text === 'Question one: what is 2+2?');
  check('bot messages are saved in history and still marked as a bot', line?.bot === true && line.from === 'QuizBot');

  // ---------- bots cannot be messaged or befriended ----------
  A.clear(); A.send({ t: 'dm', to: 'QBot', text: 'hello?' }); await wait(250);
  check('a private message to a bot is refused politely', A.errors().some((e) => /QBot is a bot/.test(e)), JSON.stringify(A.errors()));
  A.clear(); A.send({ t: 'friendRequest', to: 'QBot' }); await wait(250);
  check('a bot cannot be added as a friend', A.errors().some((e) => /bot/.test(e)));
  A.clear(); A.say('#bots1', '/kick QBot'); await wait(250);
  check('a bot cannot be kicked like a member', A.errors().length > 0 && names((await join(A, 'bots1')).bots).includes('QBot'), JSON.stringify(A.errors()));

  // ---------- switching off / removing ----------
  r = await api('PUT', '/api/admin/bots/QuizBot', tok.Russ, { enabled: false });
  await wait(300);
  check('switching a bot off removes it from rooms', r.s === 200 && !names(presBots(A, '#bots1')).includes('QuizBot'));
  r = await api('POST', '/api/admin/bots/QuizBot/say', tok.Russ, { room: '#bots1', text: 'still here?' });
  check('a switched off bot cannot speak', r.s === 422);
  r = await api('PUT', '/api/admin/bots/QuizBot', tok.Russ, { enabled: true, allRooms: true });
  await wait(300);
  check('switching it on (every room) brings it back', r.s === 200 && names((await join(A, 'lobby')).bots).includes('QuizBot'));
  r = await api('PUT', '/api/admin/bots/QBot', tok.Russ, { enabled: false, allRooms: false, rooms: [], description: 'The friendly QChat helper.' });
  const q2 = (await api('GET', '/api/admin/bots', tok.Russ)).j.bots.find((b) => b.name === 'QBot');
  check('QBot cannot be switched off or taken out of rooms', q2.enabled && q2.allRooms, JSON.stringify(q2));
  check('...but its description can change', q2.description === 'The friendly QChat helper.');
  r = await api('DELETE', '/api/admin/bots/QBot', tok.Russ);
  check('QBot cannot be deleted', r.s === 409, r.j.error);
  r = await api('PUT', '/api/admin/bots/Nobody', tok.Russ, { enabled: false });
  check('editing a bot that does not exist is a 404', r.s === 404);

  // keep one custom bot around to check it survives a restart
  r = await api('POST', '/api/admin/bots', tok.Russ, { name: 'Keeper', description: 'Survives restarts', emoji: '🦊', allRooms: false, rooms: ['#bots1'] });
  check('a bot to keep for the restart test', r.s === 200);

  r = await api('DELETE', '/api/admin/bots/QuizBot', tok.Russ);
  await wait(300);
  check('a bot can be deleted', r.s === 200 && !names((await join(A, 'lobby')).bots).includes('QuizBot'));
  const hist2 = (await join(await client(tok.Bob), 'bots1')).history;
  check('what a deleted bot said stays in the history', hist2.some((l) => l.from === 'QuizBot' && l.bot === true));
  r = await api('DELETE', '/api/admin/bots/QuizBot', tok.Russ);
  check('deleting it twice is a 404', r.s === 404);
  r = await api('POST', '/api/register', null, { account: 'QuizBot', password: 'whatever1' });
  check('a deleted bot name is free again', r.s === 200 || !!r.j.token, r.j.error);

  const audit = (await api('GET', '/api/admin/audit', tok.Russ)).j.entries.map((e) => e.action);
  check('bot actions are audited', ['create-bot', 'edit-bot', 'delete-bot', 'bot-say'].every((a) => audit.includes(a)), audit.slice(0, 8).join());
} else {
  const B2 = await client(tok.Bob);
  const j = await join(B2, 'bots1');
  check('QBot is still in rooms after a restart', names(j.bots).includes('QBot'));
  check('a custom bot survives a restart', names(j.bots).includes('Keeper'), JSON.stringify(names(j.bots)));
  check('its settings survive too', j.bots.find((b) => b.name === 'Keeper')?.emoji === '🦊');
  check('bot messages survive a restart', j.history.some((l) => l.bot === true));
  const lobby = await join(B2, 'lobby');
  check('a bot in one room is not in another after a restart', !names(lobby.bots).includes('Keeper'));
}
console.log(`\nWAVE 3, PHASE ${phase.toUpperCase()}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
