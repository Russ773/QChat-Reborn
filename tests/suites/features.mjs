// Started by tests/run.mjs (see the suite list there for the server settings this file expects).
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

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
const pwOf = (name) => name.toLowerCase() + '-pass-9';
async function tokenFor(name, pw = pwOf(name)) {
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
    lines: (room) => got.filter((x) => x.t === 'message' && x.room === room).map((x) => x.line),
    botLines: (room, from) => got.filter((x) => x.t === 'message' && x.room === room && x.line.bot && (!from || x.line.from === from)).map((x) => x.line),
    infos: () => got.filter((x) => x.t === 'info').map((x) => x.text),
    errors: () => got.filter((x) => x.t === 'error').map((x) => x.text),
  };
  c.send({ t: 'hello', token }); await wait(250);
  return c;
}
const join = async (c, room, topic) => { c.send({ t: 'join', room, ...(topic !== undefined ? { topic } : {}) }); await wait(300); return c.got.filter((x) => x.t === 'joined' && x.room === '#' + room.replace(/^#/, '')).at(-1); };
const until = async (fn, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await wait(100); } return fn(); };
const COOL = () => wait(3300); // QBot's 3 second cooldown per member

const { BANK } = await import(pathToFileURL(resolve(HERE, '../../server/dist/trivia-questions.js')).href);
const answerFor = (questionText) => BANK.find((q) => q.question === questionText)?.answers[0];

if (phase === 'a') {
  const russ = await tokenFor('Russ', 'russ-admin-pass-9');

  // ======================= 1. change password =======================
  {
    const t1 = await tokenFor('Pwuser', 'first-pass-9');
    const t2 = (await api('POST', '/api/login', null, { account: 'Pwuser', password: 'first-pass-9' })).j.token;
    let r = await api('POST', '/api/password', null, { current: 'x', next: 'y' });
    check('changing a password needs a login', r.s === 401);
    r = await api('POST', '/api/password', t1, { current: 'wrong-pass-0', next: 'second-pass-9' });
    check('a wrong current password is refused', r.s === 403 && /not right/.test(r.j.error), r.j.error);
    for (const [label, next] of [['too short', 'abc123'], ['a common password', 'password123'], ['the same as the username', 'pwuser'], ['the same as the current one', 'first-pass-9']]) {
      r = await api('POST', '/api/password', t1, { current: 'first-pass-9', next });
      check(`a new password that is ${label} is refused`, r.s === 422 && !!r.j.error, r.j.error);
    }
    r = await api('POST', '/api/password', t1, { current: 'first-pass-9', next: 'second-pass-9' });
    check('the right current password changes it', r.s === 200 && r.j.ok === true);
    check('the device you changed it on stays logged in', (await api('GET', '/api/me', t1)).s === 200);
    check('every other device is logged out', (await api('GET', '/api/me', t2)).s === 401);
    check('the old password no longer works', (await api('POST', '/api/login', null, { account: 'Pwuser', password: 'first-pass-9' })).s === 401);
    check('the new password works', (await api('POST', '/api/login', null, { account: 'Pwuser', password: 'second-pass-9' })).s === 200);

  }

  // ======================= 2. server owned rooms =======================
  const Ann = await client(await tokenFor('Ann'));
  const Bob = await client(await tokenFor('Bob'));
  {
    let r = await api('POST', '/api/admin/rooms', await tokenFor('Ann'), { name: 'musicroom' });
    check('only admins can create server rooms', r.s === 403);
    r = await api('POST', '/api/admin/rooms', russ, { name: 'music', topic: 'Share the tunes you love' });
    check('an admin can create a server room', r.s === 200, JSON.stringify(r.j));
    const rooms = (await api('GET', '/api/admin/rooms', russ)).j.rooms;
    const m = rooms.find((x) => x.name === '#music');
    check('it is permanent, has no owner and is not one of the built in rooms', m && m.permanent && !m.builtin && !m.owner, JSON.stringify(m));
    check('and starts with its topic', m?.topic === 'Share the tunes you love');
    const j = await join(Ann, 'music');
    check('members who join see the topic', j?.topic?.text === 'Share the tunes you love' && j.topic.by === 'Russ', JSON.stringify(j?.topic));
    for (const [label, body] of [['an empty name', { name: '' }], ['a name with odd characters', { name: 'bad!name' }], ['a name that is too long', { name: 'x'.repeat(40) }], ['a name that already exists', { name: 'music' }], ['an existing built in room', { name: 'lobby' }]]) {
      r = await api('POST', '/api/admin/rooms', russ, body);
      check(`creating a room with ${label} is refused`, r.s === 422, r.j.error);
    }
    check('the built in rooms are marked built in, and include #trivia', ['#lobby', '#general', '#help', '#trivia'].every((n) => rooms.find((x) => x.name === n)?.builtin === true));
    check('#trivia starts with a topic about trivia', /Trivia/.test(rooms.find((x) => x.name === '#trivia')?.topic ?? ''));
    check('#lobby starts with a welcome topic', /Welcome/.test(rooms.find((x) => x.name === '#lobby')?.topic ?? ''));

    r = await api('DELETE', '/api/admin/rooms/%23lobby', russ);
    check('a built in room cannot be deleted', r.s === 409, r.j.error);
    await join(Bob, 'userroom1');
    r = await api('DELETE', '/api/admin/rooms/%23userroom1', russ);
    check('an ordinary user room cannot be deleted this way (use Close)', r.s === 409 && /user room/.test(r.j.error), r.j.error);
    r = await api('POST', '/api/admin/rooms/%23userroom1/server', russ);
    check('an admin can turn a user room into a server room', r.s === 200);
    const conv = (await api('GET', '/api/admin/rooms', russ)).j.rooms.find((x) => x.name === '#userroom1');
    check('it becomes permanent with no owner', conv.permanent && !conv.owner && !conv.builtin, JSON.stringify(conv));
    r = await api('POST', '/api/admin/rooms/%23userroom1/server', russ);
    check('converting it twice is refused', r.s === 409);
    Bob.clear();
    r = await api('POST', '/api/admin/rooms', russ, { name: 'tempserver' });
    await join(Bob, 'tempserver'); Bob.clear();
    r = await api('DELETE', '/api/admin/rooms/%23tempserver', russ);
    await wait(300);
    check('a server room can be deleted', r.s === 200 && !(await api('GET', '/api/admin/rooms', russ)).j.rooms.some((x) => x.name === '#tempserver'));
    check('and people inside are told', Bob.errors().some((e) => /deleted by an administrator/.test(e)) && Bob.of('left').length === 1);
    r = await api('DELETE', '/api/admin/rooms/%23nothere', russ);
    check('deleting a room that does not exist is refused', r.s === 409 || r.s === 404, String(r.s));
    r = await api('DELETE', '/api/admin/rooms/%23music', await tokenFor('Ann'));
    check('members cannot delete server rooms', r.s === 403);
  }

  // ======================= 3. room topics =======================
  {
    const Cat = await client(await tokenFor('Cat'));
    let j = await join(Cat, 'topicroom', 'Football chat and banter');
    check('a member can give a brand new room its topic when creating it', j?.topic?.text === 'Football chat and banter' && j.topic.by === 'Cat', JSON.stringify(j?.topic));
    const Dan = await client(await tokenFor('Dan'));
    j = await join(Dan, 'topicroom', 'A topic Dan tried to sneak in');
    check('joining an existing room cannot change its topic', j?.topic?.text === 'Football chat and banter');
    j = await join(Cat, 'longtopic', 'x'.repeat(300));
    check('a very long topic is cut to 200 characters', j?.topic?.text.length === 200, String(j?.topic?.text.length));
    j = await join(Cat, 'plain');
    check('a room made without a topic has none', j?.topic === null);
    Dan.clear(); Dan.say('#topicroom', '/topic Dan wants to change it'); await wait(300);
    check('a member who is not a moderator cannot change it', Dan.of('error').length > 0 || Dan.of('system').some((m) => /Only moderators/.test(m.text)));
    Cat.clear(); Cat.say('#topicroom', '/topic Now it is about rugby'); await wait(300);
    check('the room owner can change it (the room settings screen uses this)', Cat.last('topic')?.topic?.text === 'Now it is about rugby');
    Cat.say('#topicroom', '/topic clear'); await wait(300);
    check('and clear it', Cat.last('topic')?.topic === null);
    const r = await api('PUT', '/api/admin/rooms/%23topicroom/topic', russ, { topic: 'Set by an admin' });
    await wait(300);
    check('an admin can set any room topic from the admin screen', r.s === 200 && Cat.last('topic')?.topic?.text === 'Set by an admin' && Cat.last('topic').topic.by === 'Russ');
    const r2 = await api('PUT', '/api/admin/rooms/%23topicroom/topic', await tokenFor('Dan'), { topic: 'nope' });
    check('members cannot use the admin topic route', r2.s === 403);
    const r3 = await api('PUT', '/api/admin/rooms/%23topicroom/topic', russ, { topic: '' });
    await wait(300);
    check('an empty topic clears it', r3.s === 200 && Cat.last('topic')?.topic === null);
    const r4 = await api('PUT', '/api/admin/rooms/%23nosuch/topic', russ, { topic: 'x' });
    check('a topic for a room that does not exist is refused', r4.s === 404);
  }

  // ======================= 4. QBot's new powers =======================
  {
    const Q = await client(await tokenFor('Quin'));
    await join(Q, 'qbotroom1', 'This is the QBot test room'); await wait(2000); Q.clear();
    let used = 0, roomNo = 1;
    const ask = async (text, ms = 1100) => {
      if (used >= 5) { roomNo++; used = 0; await join(Q, 'qbotroom' + roomNo); await wait(2000); }
      used++;
      const room = '#qbotroom' + roomNo;
      Q.clear(); Q.say(room, text); await wait(ms);
      const mine = Q.lines(room).find((l) => l.text === text);
      const reply = Q.botLines(room, 'QBot').find((l) => l.replyTo?.id === mine?.id);
      await COOL();
      return { reply: reply?.text, room };
    };
    let r = await ask('!8ball will it rain?');
    check('!8ball answers a question', /^The 8 ball says: .+/.test(r.reply ?? ''), r.reply);
    r = await ask('!8ball');
    check('!8ball without a question explains itself', /Ask me a question/.test(r.reply ?? ''), r.reply);
    r = await ask('!choose pizza, curry, burger');
    check('!choose picks one of the choices', /^I choose: (pizza|curry|burger)$/.test(r.reply ?? ''), r.reply);
    r = await ask('!choose tea or coffee');
    check('!choose works with the word "or"', /^I choose: (tea|coffee)$/.test(r.reply ?? ''), r.reply);
    r = await ask('!choose lonely');
    check('!choose needs at least two choices', /at least two/.test(r.reply ?? ''), r.reply);
    r = await ask('!joke');
    check('!joke tells a joke', (r.reply ?? '').length > 15, r.reply);
    r = await ask('!stats');
    check('!stats shows site numbers', /^QChat has \d+ members?, \d+ online right now, and \d+ rooms?\.$/.test(r.reply ?? ''), r.reply);
    r = await ask('!help');
    check('!help lists the new commands', /!poll/.test(r.reply ?? '') && /!remind/.test(r.reply) && /!8ball/.test(r.reply), r.reply?.slice(0, 80));
    r = await ask('!help roll');
    check('!help <command> explains one command', /2d6/.test(r.reply ?? ''), r.reply?.slice(0, 80));
    r = await ask('!help nonsense');
    check('!help for an unknown command says so', /do not know a command/.test(r.reply ?? ''), r.reply);
    await join(Q, 'qbotroom1'); // back to the room that has a topic
    Q.clear(); Q.say('#qbotroom1', '!topic'); await wait(1100);
    const t = Q.botLines('#qbotroom1', 'QBot').at(-1)?.text;
    check('!topic tells you the room topic', /The topic of qbotroom1 is: This is the QBot test room/.test(t ?? ''), t);
    await COOL();
    await join(Q, 'notopicroom'); await wait(2000); Q.clear();
    Q.say('#notopicroom', '!topic'); await wait(1100);
    check('!topic says when there is none', /has no topic set/.test(Q.botLines('#notopicroom', 'QBot').at(-1)?.text ?? ''));
  }

  // ---- polls
  {
    const mk = async (name) => client(await tokenFor(name));
    const [P, V1, V2] = [await mk('Pollster'), await mk('Voter1'), await mk('Voter2')];
    for (const c of [P, V1, V2]) { await join(c, 'pollroom1'); }
    await wait(2200);
    const room = '#pollroom1';
    P.clear(); V1.clear(); V2.clear();
    P.say(room, '!poll Best colour? | Red | Blue | Green'); await wait(1100);
    let b = P.botLines(room, 'QBot').at(-1)?.text ?? '';
    check('!poll starts a poll and shows the options', /^Pollster started a poll: Best colour\?  1\) Red  2\) Blue  3\) Green  Vote with !vote/.test(b), b);
    await COOL(); P.clear();
    P.say(room, '!poll Another? | A | B'); await wait(1100);
    check('only one poll can run in a room', /already running/.test(P.botLines(room, 'QBot').at(-1)?.text ?? ''));
    V1.clear(); V2.clear(); V1.say(room, '!vote 2'); await wait(800);
    check('a vote is confirmed privately to the voter', V1.infos().some((t) => /Your vote for 2\) Blue is counted/.test(t)));
    check('and nothing about it is said in the room', V2.botLines(room, 'QBot').filter((l) => /counted/i.test(l.text)).length === 0 && V2.of('message').filter((m) => m.line.bot).length === 0);
    V1.clear(); V1.say(room, '!vote 9'); await wait(800);
    check('a vote for an option that does not exist is explained', V1.infos().some((t) => /number from 1 to 3/.test(t)));
    V2.say(room, '!vote 2'); await wait(500);
    P.say(room, '!vote 1'); await wait(600);
    await COOL(); P.clear();
    P.say(room, '!results'); await wait(1100);
    b = P.botLines(room, 'QBot').at(-1)?.text ?? '';
    check('!results shows the tally and total', /Red: 1 \(33%\)  Blue: 2 \(67%\)  Green: 0 \(0%\)  Total votes: 3\./.test(b), b);
    V1.say(room, '!vote 3'); await wait(500); // changes the vote
    await COOL(); P.clear();
    V2.clear(); V2.say(room, '!endpoll'); await wait(1100);
    check('someone who did not start the poll cannot close it', /Only Pollster or a moderator/.test(V2.botLines(room, 'QBot').at(-1)?.text ?? ''));
    await COOL(); P.clear();
    P.say(room, '!endpoll'); await wait(1100);
    b = P.botLines(room, 'QBot').at(-1)?.text ?? '';
    check('the starter can close it, and a changed vote counts once', /^Poll closed\. .*Red: 1 \(33%\)  Blue: 1 \(33%\)  Green: 1 \(33%\)  Total votes: 3\./.test(b), b);
    await COOL(); P.clear();
    P.say(room, '!results'); await wait(1100);
    check('afterwards there is no poll', /no poll running/.test(P.botLines(room, 'QBot').at(-1)?.text ?? ''));
    const P3 = await mk('Pollrefuse');
    await join(P3, 'pollroom3'); await wait(2200);
    for (const [label, text] of [['no options', '!poll hello'], ['one option', '!poll Q? | only'], ['seven options', '!poll Q? | 1 | 2 | 3 | 4 | 5 | 6 | 7'], ['repeated options', '!poll Q? | same | Same']]) {
      P3.clear(); P3.say('#pollroom3', text); await wait(1100);
      const t = P3.botLines('#pollroom3', 'QBot').at(-1)?.text ?? '';
      check(`a poll with ${label} is refused`, /Try !poll|up to 6|must be different/.test(t), t);
      await COOL();
    }
    // a moderator can close someone else's poll; a poll closes itself
    const A2 = await mk('Pollmod'); const R = await client(russ);
    for (const c of [A2, R]) await join(c, 'pollroom2');
    await wait(2200);
    A2.say('#pollroom2', '!poll Auto close? | Yes | No'); await wait(1100);
    R.clear(); R.say('#pollroom2', '!endpoll'); await wait(1100);
    check('an admin or moderator can close anyone\'s poll', /^Poll closed\./.test(R.botLines('#pollroom2', 'QBot').at(-1)?.text ?? ''));
    await COOL(); await COOL();
    A2.clear(); A2.say('#pollroom2', '!poll Closes itself? | Yes | No'); await wait(1100);
    A2.say('#pollroom2', '!vote 1'); // too soon after the poll (cooldown), but votes are exempt
    const closed = await until(() => A2.botLines('#pollroom2', 'QBot').find((l) => /^The poll has closed\./.test(l.text)), 40000);
    check('an unattended poll closes itself with the result', !!closed && /Total votes: 1\./.test(closed.text), closed?.text);
  }

  // ---- reminders
  {
    const mk = async (name) => client(await tokenFor(name));
    const Rm = await mk('Remy');
    await join(Rm, 'remindroom'); await wait(2200); Rm.clear();
    const say = async (text, ms = 1100) => { Rm.clear(); Rm.say('#remindroom', text); await wait(ms); const t = Rm.botLines('#remindroom', 'QBot').at(-1)?.text; await COOL(); return t; };
    let t = await say('!remind soon buy milk');
    check('a time QBot cannot read is explained', /did not understand that time/.test(t ?? ''), t);
    t = await say('!remind 10m');
    check('a reminder needs some text', /Try !remind 10m/.test(t ?? ''), t);
    t = await say('!remind 30d too far');
    check('a reminder cannot be more than 7 days away', /longest reminder is 7 days/.test(t ?? ''), t);
    t = await say('!remind 2s buy milk');
    check('!remind confirms the reminder', /^OK Remy, I will remind you in 2 seconds: buy milk$/.test(t ?? ''), t);
    const due = await until(() => Rm.botLines('#remindroom', 'QBot').find((l) => /reminder: buy milk/.test(l.text)), 9000);
    check('and QBot reminds them in the room, with an @ mention', !!due && /^@Remy reminder: buy milk$/.test(due.text), due?.text);

    // while they are somewhere else, they get a private pop-up instead
    await join(Rm, 'otherroom'); await wait(300);
    Rm.clear(); Rm.say('#remindroom', '!remind 3s tea'); await wait(1000);
    Rm.send({ t: 'leave', room: '#remindroom' }); await wait(300);
    const note = await until(() => Rm.infos().find((x) => /Reminder: tea/.test(x)), 9000);
    check('if they have left that room, the reminder arrives as a private pop-up', !!note, note);
    await COOL();

    // limits, listing and clearing
    const Lim = await mk('Limmy'); await join(Lim, 'limroom'); await wait(2200);
    const lsay = async (text) => { Lim.clear(); Lim.say('#limroom', text); await wait(1100); const t = Lim.botLines('#limroom', 'QBot').at(-1)?.text; await COOL(); return t; };
    for (let i = 1; i <= 5; i++) await lsay(`!remind 1h thing ${i}`);
    t = await lsay('!remind 1h one too many');
    check('at most 5 reminders can wait at once', /already have 5 reminders/.test(t ?? ''), t);
    Lim.clear(); Lim.say('#limroom', '!reminders'); await wait(800);
    const list = Lim.infos().find((x) => /^Your reminders:/.test(x));
    check('!reminders lists them privately', !!list && /thing 1/.test(list) && /thing 5/.test(list), list?.slice(0, 80));
    check('and says nothing in the room', Lim.botLines('#limroom', 'QBot').length === 0);
    Lim.clear(); Lim.say('#limroom', '!reminders clear'); await wait(800);
    check('!reminders clear deletes them', Lim.infos().some((x) => /Cleared 5 reminders/.test(x)));

    // one to survive a restart
    const Zed = await mk('Zed'); await join(Zed, 'zedroom'); await wait(2200);
    Zed.say('#zedroom', '!remind 1h persist-me'); await wait(1100);
  }

  // ======================= 5. TriviaBot =======================
  {
    const mk = async (name) => client(await tokenFor(name));
    const [Ann2, Bob2, Cat2] = [await mk('Tann'), await mk('Tbob'), await mk('Tcat')];
    let j;
    for (const c of [Ann2, Bob2, Cat2]) j = await join(c, 'trivia');
    check('TriviaBot is in the trivia room, alongside QBot', ['QBot', 'TriviaBot'].every((n) => j.bots.some((b) => b.name === n)), JSON.stringify(j.bots.map((b) => b.name)));
    await wait(2200);
    const room = '#trivia';
    const bot = (c) => c.botLines(room, 'TriviaBot');
    const cmd = async (c, text, ms = 700) => { c.clear(); c.say(room, text); await wait(ms); return bot(c)[0]?.text; };

    let t = await cmd(Ann2, '!triviahelp');
    check('!triviahelp explains the game', /!trivia/.test(t ?? '') && /!score/.test(t) && /!top/.test(t), t?.slice(0, 60));
    t = await cmd(Bob2, '!trivia categories');
    check('!trivia categories lists them', /Geography/.test(t ?? '') && /Sport/.test(t), t?.slice(0, 80));
    t = await cmd(Bob2, '!trivia 2');
    check('too few questions is refused', /between 3 and 20/.test(t ?? ''), t);
    t = await cmd(Bob2, '!trivia 50');
    check('too many questions is refused', /between 3 and 20/.test(t ?? ''), t);
    t = await cmd(Bob2, '!trivia 5 nonsensecat');
    check('an unknown category is explained', /do not know that category/.test(t ?? ''), t);
    t = await cmd(Bob2, '!score');
    check('!score for someone who has not played', /has not scored yet/.test(t ?? ''), t);
    t = await cmd(Bob2, '!trivia stop');
    check('stopping when no game is running is explained', /No game is running/.test(t ?? ''), t);

    // a game of 3 geography questions
    Ann2.clear(); Bob2.clear(); Cat2.clear();
    Ann2.say(room, '!trivia 3 geography');
    const intro = await until(() => bot(Bob2).find((l) => /^Trivia time! 3 questions, 3 seconds each/.test(l.text)), 3000);
    check('a game starts with an introduction', !!intro, bot(Bob2).at(-1)?.text);

    const nextQ = async (n) => {
      const line = await until(() => bot(Bob2).find((l) => new RegExp(`^Question ${n} of 3 \\(Geography\\): `).test(l.text)), 5000);
      return line ? line.text.replace(/^Question \d of 3 \(Geography\): /, '') : null;
    };
    // question 1: a wrong answer is ignored, the right one scores with the speed bonus
    const q1 = await nextQ(1);
    check('question 1 is asked', !!q1 && !!answerFor(q1), q1);
    Bob2.say(room, 'definitely not it zzzz'); await wait(100);
    check('a wrong answer gets no reaction', !bot(Ann2).some((l) => /^Correct/.test(l.text)));
    Ann2.say(room, answerFor(q1));
    const c1 = await until(() => bot(Bob2).find((l) => /^Correct, Tann!/.test(l.text)), 3000);
    check('the first right answer scores 15 points when it is quick', !!c1 && /\+15 points \(15 this game\)/.test(c1.text), c1?.text);
    // question 2: nobody answers, so there is a hint and then the answer
    const q2 = await nextQ(2);
    check('question 2 is asked after a short pause', !!q2);
    Cat2.clear(); Cat2.say(room, '!trivia'); await wait(400);
    check('a second game cannot start while one is running', bot(Cat2).some((l) => /already running/.test(l.text)), bot(Cat2).at(-1)?.text);
    Cat2.say(room, '!trivia stop'); await wait(400);
    check('someone who did not start the game cannot stop it', bot(Cat2).some((l) => /Only the person who started the game/.test(l.text)));
    const hint = await until(() => bot(Bob2).find((l) => /^Hint: /.test(l.text)), 4000);
    check('a hint appears halfway through', !!hint && /_/.test(hint.text) && /characters\)/.test(hint.text), hint?.text);
    const timeup = await until(() => bot(Bob2).find((l) => /^Time's up! The answer was: /.test(l.text)), 4000);
    check('when time runs out the answer is revealed', !!timeup);
    // question 3: an answer inside a sentence, given late, so it scores the plain 10
    const q3 = await nextQ(3);
    await wait(2400);
    Bob2.say(room, 'I think it is ' + answerFor(q3));
    const c3 = await until(() => bot(Ann2).find((l) => /^Correct, Tbob!/.test(l.text)), 3000);
    check('an answer inside a short sentence is accepted (10 points when late)', !!c3 && /\+10 points/.test(c3.text), c3?.text);
    const end = await until(() => bot(Cat2).find((l) => /^That is the end of the game!/.test(l.text)), 4000);
    check('the game ends with the final scores and a winner', !!end && /1\. Tann 15 pts \(1 right\), 2\. Tbob 10 pts \(1 right\)/.test(end.text) && /Tann wins!/.test(end.text), end?.text);
    Bob2.clear(); Bob2.say(room, '!trivia 3'); await wait(400);
    check('a new game straight away is held back for a moment', bot(Bob2).some((l) => /catch my breath/.test(l.text)), bot(Bob2).at(-1)?.text);

    t = await cmd(Ann2, '!score');
    check('scores are kept: !score shows points, wins and rank', /^Tann has 15 points \(1 right answers?, 1 win from 1 game\), rank 1\./.test(t ?? ''), t);
    t = await cmd(Cat2, '!score Tbob');
    check('!score <name> shows someone else', /^Tbob has 10 points/.test(t ?? ''), t);
    t = await cmd(Cat2, '!top');
    check('!top shows the best players', /^Top players: 1\. Tann 15 pts \(1 win\), 2\. Tbob 10 pts/.test(t ?? ''), t);

    // starter or a moderator can stop, and skip works
    await wait(1600);
    Bob2.clear(); Bob2.say(room, '!trivia 4 sport');
    await until(() => bot(Cat2).find((l) => /^Question 1 of 4 \(Sport\)/.test(l.text)), 4000);
    Cat2.clear(); Cat2.say(room, '!trivia skip'); await wait(500);
    check('only the starter or a moderator can skip', bot(Cat2).some((l) => /Only the person who started the game/.test(l.text)));
    Bob2.clear(); Bob2.say(room, '!trivia skip'); await wait(500);
    check('the starter can skip a question', bot(Bob2).some((l) => /Tbob skipped it\. The answer was: /.test(l.text)), bot(Bob2).at(-1)?.text);
    await until(() => bot(Bob2).find((l) => /^Question 2 of 4/.test(l.text)), 3000);
    const R = await client(russ); await join(R, 'trivia'); await wait(300);
    R.clear(); R.say(room, '!trivia stop'); await wait(700);
    check('an admin can stop anyone\'s game', bot(R).some((l) => /^Game over, stopped by Russ\./.test(l.text)), bot(R).at(-1)?.text);

    // the bot only works where it is
    const L = await mk('Tlobby'); await join(L, 'lobby'); await wait(2200); L.clear();
    L.say('#lobby', '!trivia'); await wait(900);
    check('TriviaBot says nothing in rooms it is not in', L.botLines('#lobby', 'TriviaBot').length === 0);
    const set = await api('PUT', '/api/admin/bots/TriviaBot', russ, { rooms: ['#trivia', '#lobby'] });
    await wait(1700);
    L.clear(); L.say('#lobby', '!triviahelp'); await wait(900);
    check('an admin can add TriviaBot to another room, and it works there', set.s === 200 && L.botLines('#lobby', 'TriviaBot').length === 1);
    await api('PUT', '/api/admin/bots/TriviaBot', russ, { rooms: ['#trivia'] });
    await api('PUT', '/api/admin/bots/TriviaBot', russ, { enabled: false }); await wait(300);
    Ann2.clear(); Ann2.say(room, '!triviahelp'); await wait(900);
    check('switched off, TriviaBot is silent', bot(Ann2).length === 0);
    await api('PUT', '/api/admin/bots/TriviaBot', russ, { enabled: true });
    const list = (await api('GET', '/api/admin/bots', russ)).j.bots.find((b) => b.name === 'TriviaBot');
    check('it is an ordinary bot in the admin list, in the trivia room', list && !list.builtin && list.enabled && list.rooms.join() === '#trivia', JSON.stringify(list));
    // an empty room stops the game by itself
    Ann2.clear(); await wait(1700);
    Ann2.say(room, '!trivia 3 science');
    await until(() => bot(Ann2).find((l) => /^Question 1 of 3/.test(l.text)), 4000);
    for (const c of [Ann2, Bob2, Cat2, R]) c.send({ t: 'leave', room });
    await wait(5500);
    const hist = (await join(await client(await tokenFor('Tlate')), 'trivia')).history;
    const asked = hist.filter((l) => l.bot && /^Question \d of 3 \(Science and Nature\)/.test(l.text)).length;
    check('when everyone leaves, the game stops asking questions', asked <= 2, `${asked} questions asked`);
  }
}

if (phase === 'b') {
  const russ = await tokenFor('Russ', 'russ-admin-pass-9');
  const rooms = (await api('GET', '/api/admin/rooms', russ)).j.rooms;
  const music = rooms.find((x) => x.name === '#music');
  check('a server room survives a restart', music?.permanent && !music.owner && music.topic === 'Share the tunes you love', JSON.stringify(music));
  const conv = rooms.find((x) => x.name === '#userroom1');
  check('a room turned into a server room stays one', conv?.permanent && !conv.owner);
  check('the built in rooms are not given their topics again', rooms.find((x) => x.name === '#lobby')?.topic !== undefined);
  const Z = await client(await tokenFor('Zed'));
  await join(Z, 'zedroom'); await wait(2200);
  Z.clear(); Z.say('#zedroom', '!reminders'); await wait(900);
  check('a reminder survives a restart', Z.infos().some((t) => /Your reminders: .*persist-me/.test(t)), Z.infos().join(' | '));
  const sc = await client(await tokenFor('Tann')); await join(sc, 'trivia'); await wait(300);
  sc.clear(); sc.say('#trivia', '!score'); await wait(900);
  check('trivia scores survive a restart', /^Tann has 15 points/.test(sc.botLines('#trivia', 'TriviaBot').at(-1)?.text ?? ''), sc.botLines('#trivia', 'TriviaBot').at(-1)?.text);
  const bots = (await api('GET', '/api/admin/bots', russ)).j.bots;
  check('TriviaBot is still assigned to the trivia room', bots.find((b) => b.name === 'TriviaBot')?.rooms.join() === '#trivia');
  // deleting it must stick
  const del = await api('DELETE', '/api/admin/bots/TriviaBot', russ);
  check('TriviaBot can be deleted', del.s === 200);
  const pw = await api('POST', '/api/login', null, { account: 'Pwuser', password: 'second-pass-9' });
  check('a changed password still works after a restart', pw.s === 200);
}

if (phase === 'c') {
  const russ = await tokenFor('Russ', 'russ-admin-pass-9');
  const bots = (await api('GET', '/api/admin/bots', russ)).j.bots;
  check('a deleted TriviaBot is not put back by a restart', !bots.some((b) => b.name === 'TriviaBot'), bots.map((b) => b.name).join());
  const rooms = (await api('GET', '/api/admin/rooms', russ)).j.rooms;
  check('the trivia room itself is still there', rooms.some((x) => x.name === '#trivia' && x.builtin));
}

console.log(`\nWAVE 5, PHASE ${phase.toUpperCase()}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
