import { DatabaseSync } from 'node:sqlite';

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
async function tokenFor(name, pw = name.toLowerCase() + '-pass-9') {
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
    clear: () => (got.length = 0), say: (room, text) => ws.send(JSON.stringify({ t: 'say', room, text })),
    botLines: (room) => got.filter((x) => x.t === 'message' && x.room === room && x.line.bot).map((x) => x.line),
  };
  c.send({ t: 'hello', token }); await wait(250);
  return c;
}
const join = async (c, room, restore = false) => { c.send({ t: 'join', room, ...(restore ? { restore: true } : {}) }); await wait(250); return c.last('joined'); };
const settings = (tok, patch) => api('PUT', '/api/admin/settings', tok, patch);

if (phase === 'a') {
  const russ = await tokenFor('Russ', 'russ-admin-pass-9');

  // ---------------- welcome ----------------
  const Nt = await tokenFor('Newcomer');
  const N = await client(Nt);
  await join(N, 'lobby'); await wait(2300);
  const w = N.botLines('#lobby').find((l) => /Welcome to QChat Reborn/.test(l.text));
  check('a brand new member is welcomed by QBot', !!w && w.from === 'QBot' && w.bot === true, w?.text);
  check('the welcome names them with an @ so they notice it', !!w && w.text.includes('@Newcomer'));
  check('and points them at !help', !!w && /!help/.test(w.text));
  const hist = (await join(await client(await tokenFor('Watcher')), 'lobby')).history;
  check('the welcome is saved in the room history', hist.some((l) => l.bot && /@Newcomer/.test(l.text)));
  N.clear(); await join(N, 'general'); await wait(2300);
  check('they are only welcomed once, not in every room', N.botLines('#general').length === 0);
  N.send({ t: 'leave', room: '#general' }); await wait(200);
  N.clear(); await join(N, 'general'); await wait(2300);
  check('...and not when they come back', N.botLines('#general').length === 0);

  const Qt = await tokenFor('Quiet');
  const Q = await client(Qt);
  await join(Q, 'lobby', true); await wait(2300);
  check('a quiet rejoin (after a reconnect) does not welcome anyone', Q.botLines('#lobby').length === 0);
  Q.send({ t: 'leave', room: '#lobby' }); await wait(200);
  await join(Q, 'lobby'); await wait(2300);
  check('...they are still welcomed on their first real join', Q.botLines('#lobby').some((l) => /@Quiet/.test(l.text)));

  const Lt = await tokenFor('Leaver');
  const L = await client(Lt);
  await join(L, 'lobby'); L.send({ t: 'leave', room: '#lobby' }); await wait(2300);
  await join(L, 'lobby'); await wait(2300);
  check('leaving before the welcome arrives loses nothing', L.botLines('#lobby').some((l) => /@Leaver/.test(l.text)));

  // ---------------- commands ----------------
  const Bt = await tokenFor('Bob');
  const Bo = await client(Bt);
  await join(Bo, 'lobby'); await wait(2300); Bo.clear();
  // QBot answers at most 8 commands a minute per room, so move to a fresh room every few questions.
  let roomNo = 0, used = 0;
  await join(Bo, 'cmdroom0');
  const ask = async (text, ms = 1200) => {
    if (used >= 5) { roomNo++; used = 0; await join(Bo, 'cmdroom' + roomNo); }
    used++;
    const room = '#cmdroom' + roomNo;
    Bo.clear(); Bo.say(room, text); await wait(ms);
    const mine = Bo.of('message').find((m) => m.line.text === text)?.line;
    const reply = Bo.botLines(room).find((l) => l.replyTo?.id === mine?.id);
    await wait(3000); // keep clear of the per member cooldown
    return { mine, reply };
  };
  let r = await ask('!ping');
  check('!ping gets a pong, as a reply to the command', r.reply?.text === 'pong' && r.reply.from === 'QBot' && r.reply.replyTo.id === r.mine.id, JSON.stringify(r.reply?.text));
  r = await ask('!help');
  check('!help lists what QBot can do', /!time/.test(r.reply?.text ?? '') && /!roll/.test(r.reply.text) && /!poll/.test(r.reply.text) && r.reply.text.includes('Bob'));
  r = await ask('!roll 2d6');
  const m2 = r.reply?.text.match(/rolled 2d6: (\d+) \+ (\d+) = (\d+)/);
  check('!roll 2d6 rolls two dice and adds them up', !!m2 && +m2[1] >= 1 && +m2[1] <= 6 && +m2[2] >= 1 && +m2[2] <= 6 && +m2[1] + +m2[2] === +m2[3], r.reply?.text);
  r = await ask('!roll');
  check('plain !roll is one six sided die', /rolled a d6: [1-6]$/.test(r.reply?.text ?? ''), r.reply?.text);
  r = await ask('!roll 20');
  check('!roll 20 is a twenty sided die', /rolled a d20: (\d+)$/.test(r.reply?.text ?? '') && +r.reply.text.match(/(\d+)$/)[1] <= 20, r.reply?.text);
  for (const bad of ['!roll 99d6', '!roll d1', '!roll 2d5000', '!roll banana', '!roll 0d6']) {
    r = await ask(bad);
    check(`${bad} is refused with a hint`, /^Try !roll 2d6/.test(r.reply?.text ?? ''), r.reply?.text);
  }
  r = await ask('!flip');
  check('!flip gives heads or tails', /flipped a coin: (Heads|Tails)$/.test(r.reply?.text ?? ''), r.reply?.text);
  r = await ask('!time');
  check('!time gives the UK time', /^It is \d\d:\d\d on \w+day \d+ \w+, UK time\.$/.test(r.reply?.text ?? ''), r.reply?.text);
  r = await ask('!rooms');
  check('!rooms names the busiest rooms', /^Busiest rooms: .*lobby \(\d+\)/.test(r.reply?.text ?? ''), r.reply?.text);
  r = await ask('!about');
  check('!about introduces QBot', /QBot/.test(r.reply?.text ?? '') && /Media Webchat/.test(r.reply.text));
  r = await ask('!PING');
  check('commands are not case sensitive', r.reply?.text === 'pong');
  r = await ask('!zzz');
  check('an unknown ! command gets no reply', !r.reply);
  r = await ask('ping');
  check('ordinary chat gets no reply', !r.reply);
  r = await ask('hello !ping');
  check('a command must start the message', !r.reply);
  Bo.clear(); Bo.say('#lobby', '/me waves !ping'); await wait(1500);
  check('an action (/me) is not a command', Bo.botLines('#lobby').length === 0);
  await wait(3000);

  // cooldown: two quick commands, one answer
  Bo.clear(); Bo.say('#lobby', '!ping'); await wait(300); Bo.say('#lobby', '!ping'); await wait(1500);
  check('commands in quick succession are answered once (3 second cooldown)', Bo.botLines('#lobby').filter((l) => l.text === 'pong').length === 1);
  await wait(3200);

  // QBot never answers itself
  const lobbyListener = await client(await tokenFor('Listener')); await join(lobbyListener, 'lobby'); await wait(2300); lobbyListener.clear();
  let s = await api('POST', '/api/admin/bots/QBot/say', russ, { room: '#lobby', text: '!ping' });
  await wait(1500);
  const echoes = lobbyListener.botLines('#lobby');
  check('QBot does not answer a command spoken by a bot', s.s === 200 && echoes.length === 1 && echoes[0].text === '!ping', JSON.stringify(echoes.map((l) => l.text)));

  // per room cap
  const sock = [];
  for (let i = 0; i < 10; i++) { const c = await client(await tokenFor('Cap' + i)); await join(c, 'caproom'); sock.push(c); }
  await wait(2200); sock.forEach((c) => c.clear());
  for (const c of sock) c.say('#caproom', '!ping');
  await wait(2500);
  const pongs = sock[0].botLines('#caproom').filter((l) => l.text === 'pong').length;
  check('QBot will not answer more than 8 commands a minute in one room', pongs === 8, `${pongs} pongs for 10 commands`);

  // muted members cannot use it
  const At = await tokenFor('Ann'); const A = await client(At);
  const Dt = await tokenFor('Dan'); const D = await client(Dt);
  await join(A, 'annroom'); await join(D, 'annroom'); await wait(2300);
  A.say('#annroom', '/mute Dan 5'); await wait(500); D.clear(); D.say('#annroom', '!ping'); await wait(1500);
  check('a muted member cannot use QBot either', D.botLines('#annroom').filter((l) => l.text === 'pong').length === 0);

  // ---------------- admin switches ----------------
  s = await api('GET', '/api/admin/settings', russ);
  check('both jobs are on by default', s.j.settings.qbotWelcome === true && s.j.settings.qbotCommands === true, JSON.stringify(s.j.settings));
  s = await settings(russ, { qbotWelcome: 'nope', qbotCommands: 1 });
  check('settings of the wrong type are ignored', s.j.settings.qbotWelcome === true && s.j.settings.qbotCommands === true);
  s = await api('PUT', '/api/admin/settings', Bt, { qbotWelcome: false });
  check('only admins can change them', s.s === 403);

  await settings(russ, { qbotCommands: false });
  Bo.clear(); Bo.say('#lobby', '!ping'); await wait(1500);
  check('with commands switched off QBot stays quiet', Bo.botLines('#lobby').length === 0);
  await settings(russ, { qbotCommands: true }); await wait(3200);
  Bo.clear(); Bo.say('#lobby', '!ping'); await wait(1500);
  check('and answers again when switched back on', Bo.botLines('#lobby').some((l) => l.text === 'pong'));

  await settings(russ, { qbotWelcome: false });
  const Gt = await tokenFor('NoGreet'); const G = await client(Gt);
  await join(G, 'lobby'); await wait(2300);
  check('with the welcome switched off new members are not greeted', G.botLines('#lobby').length === 0);
  await settings(russ, { qbotWelcome: true });
  G.send({ t: 'leave', room: '#lobby' }); await wait(200);
  await join(G, 'lobby'); await wait(2300);
  check('...and still get their welcome later, once it is back on', G.botLines('#lobby').some((l) => /@NoGreet/.test(l.text)));
}

if (phase === 'b') {
  const N = await client(await tokenFor('Newcomer'));
  await join(N, 'brandnewroom'); await wait(2300);
  check('being welcomed is remembered across a restart', N.botLines('#brandnewroom').length === 0);
  const hist = (await join(N, 'lobby')).history;
  check('the old welcome is still in the history', hist.some((l) => l.bot && /@Newcomer/.test(l.text)));
  const set = (await api('GET', '/api/admin/settings', await tokenFor('Russ', 'russ-admin-pass-9'))).j.settings;
  check('the switches survive a restart', set.qbotWelcome === true && set.qbotCommands === true);
}

if (phase === 'c') {
  // The greeted list was wiped and the seed flag removed while stopped, as when this feature is first installed on an existing site.
  const Bo = await client(await tokenFor('Bob'));
  await join(Bo, 'upgraderoom'); await wait(2300);
  check('members who existed before QBot got this job are NOT welcomed', Bo.botLines('#upgraderoom').length === 0);
  const F = await client(await tokenFor('Fresh2'));
  await join(F, 'upgraderoom'); await wait(2300);
  check('but people who sign up afterwards are', F.botLines('#upgraderoom').some((l) => /@Fresh2/.test(l.text)));
}

console.log(`\nQBOT, PHASE ${phase.toUpperCase()}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
