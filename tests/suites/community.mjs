// Started by tests/run.mjs: birthdays, the daily post, QBot's !fact and !quote, WeatherBot, and the look (theme and skin) preference.
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
    bot: (name) => got.filter((x) => x.t === 'message' && x.line.bot && x.line.from === name).map((x) => x.line.text),
    infos: () => got.filter((x) => x.t === 'info').map((x) => x.text),
    last: (t) => got.filter((x) => x.t === t).at(-1),
  };
  c.send({ t: 'hello', token }); await wait(250);
  return c;
}
const join = async (c, room) => { c.send({ t: 'join', room }); await wait(350); return c.last('joined'); };
const PW = { Russ: 'secret123', Bday: 'bdaypass-1', Ann: 'annpass-123', Bob: 'bobpass-123' };
const londonMd = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.month}-${p.day}`;
};

if (phase === 'a') {
  const russ = await tokenFor('Russ', PW.Russ);
  const [bday, ann, bob] = await Promise.all(['Bday', 'Ann', 'Bob'].map((n) => tokenFor(n, PW[n])));

  // ---------------- birthdays on the profile ----------------
  const put = async (token, birthday) => (await api('PUT', '/api/profile', token, { birthday })).j.profile?.birthday;
  check('a birthday is stored as month and day', (await put(bday, '06-15')) === '06-15');
  check('a day without a leading zero is tidied', (await put(ann, '2-9')) === '02-09');
  check('29 February is allowed', (await put(ann, '02-29')) === '02-29');
  check('an impossible date is refused', (await put(ann, '02-30')) === undefined && (await put(ann, '13-01')) === undefined && (await put(ann, 'tomorrow')) === undefined);
  check('and the birthday can be cleared', (await put(ann, '')) === undefined);
  let r = await api('GET', '/api/profile?a=Bday');
  check('a birthday stays private until the member shows it', r.j.profile && r.j.profile.birthday === undefined, JSON.stringify(r.j.profile));
  r = await api('PUT', '/api/preferences', bday, { visible: { bio: true } });
  check('saving other preferences does not reveal it', (await api('GET', '/api/profile?a=Bday')).j.profile.birthday === undefined && r.j.prefs.visible.birthday === false, JSON.stringify(r.j.prefs?.visible));
  r = await api('PUT', '/api/preferences', bday, { visible: { birthday: true } });
  check('the member can choose to show it', (await api('GET', '/api/profile?a=Bday')).j.profile.birthday === '06-15');
  await api('PUT', '/api/preferences', bday, { visible: { birthday: true } });

  // ---------------- the look ----------------
  r = await api('GET', '/api/me', ann);
  check('the default look is dark and classic', r.j.prefs.theme === 'dark' && r.j.prefs.skin === 'default', JSON.stringify(r.j.prefs));
  r = await api('PUT', '/api/preferences', ann, { theme: 'light', skin: 'ocean' });
  check('a member can choose a theme and skin', r.j.prefs.theme === 'light' && r.j.prefs.skin === 'ocean');
  r = await api('PUT', '/api/preferences', ann, { theme: 'neon', skin: '<script>' });
  check('anything else is ignored', r.j.prefs.theme === 'light' && r.j.prefs.skin === 'ocean');
  r = await api('PUT', '/api/preferences', ann, { allowPm: false });
  check('and other preferences leave it alone', r.j.prefs.theme === 'light' && r.j.prefs.skin === 'ocean');
  check('it follows them to another device', (await api('GET', '/api/me', ann)).j.prefs.skin === 'ocean');

  // ---------------- QBot: facts, quotes, birthdays ----------------
  const A = await client(ann), Bo = await client(bob);
  const lobbyJoin = await join(A, '#lobby'); await join(Bo, '#lobby');
  const ask = async (c, text, who = 'QBot') => { c.clear(); c.say('#lobby', text); await wait(1300); return c.bot(who).filter((t) => !/^Welcome to QChat/.test(t)).at(-1) ?? ''; };
  let said = await ask(A, '!fact');
  check('!fact tells you something', /^Did you know\? .{15,}/.test(said), said);
  await wait(3000);
  said = await ask(Bo, '!quote');
  check('!quote shares a saying', /^".{5,}"/.test(said), said);
  await wait(3200);
  said = await ask(A, '!birthdays');
  check('!birthdays only lists members who chose to show theirs, and today counts', /Bday \(today\)|Bday \(/.test(said) || /No birthdays/.test(said), said);
  // put Bday's birthday on today to be sure it is listed as today
  await api('PUT', '/api/profile', bday, { birthday: londonMd() });
  await wait(3200);
  said = await ask(Bo, '!birthdays');
  check('a birthday today is listed as today', /Bday \(today\)/.test(said), said);
  await api('PUT', '/api/profile', bday, { birthday: '06-15' });
  await wait(3200);
  said = await ask(A, '!help birthdays');
  check('!help knows the new commands', /birthdays/.test(said), said);

  // ---------------- WeatherBot ----------------
  check('WeatherBot is in the lobby', lobbyJoin.bots.some((b) => b.name === 'WeatherBot'));
  const wx = async (c, text) => { c.clear(); c.say('#lobby', text); await wait(1500); return c.bot('WeatherBot').at(-1) ?? ''; };
  said = await wx(A, '!weather London');
  check('!weather gives the weather for a place', /London.*14°C.*feels like 12°C.*partly cloudy.*11 mph.*Open-Meteo/.test(said), said);
  await wait(10500);
  said = await wx(A, '!forecast Paris');
  check('!forecast gives three days', /Paris.*Today:.*rain.*, .*% rain.*Open-Meteo/.test(said) && (said.match(/% rain/g) ?? []).length === 3, said);
  A.clear(); A.say('#lobby', '!weather Leeds'); await wait(700);
  check('asking again straight away is politely refused', A.infos().some((t) => /few seconds/.test(t)) && A.bot('WeatherBot').length === 0, JSON.stringify(A.infos()));
  await wait(10500);
  said = await wx(A, '!weather');
  check('with no place and no profile location it asks for one', /Tell me a place/.test(said), said);
  await api('PUT', '/api/profile', ann, { location: 'Manchester' });
  await wait(10500);
  said = await wx(A, '!weather');
  check('with no place it uses the location on your profile', /Manchester.*14°C/.test(said), said);
  await wait(10500);
  said = await wx(A, '!weather <script>alert(1)</script>');
  check('a place name with odd characters is refused', /Tell me a place/.test(said), said);
  await wait(10500);
  said = await wx(A, '!weather Nowhereville');
  check('an unknown place says so', /could not find a place called "Nowhereville"/.test(said), said);
  await wait(10500);
  said = await wx(A, '!weatherhelp');
  check('!weatherhelp explains it and credits the data', /!weather London.*Open-Meteo/.test(said), said);
  const elsewhere = await join(A, '#elsewhere');
  A.clear(); A.say('#elsewhere', '!weather London'); await wait(1500);
  check('WeatherBot only answers in rooms it is in', !elsewhere.bots.some((b) => b.name === 'WeatherBot') && A.bot('WeatherBot').length === 0);

  // ---------------- the setting ----------------
  r = await api('GET', '/api/admin/settings', russ);
  check('the daily post is on by default', r.j.settings.dailyPost === true);
  A.close(); Bo.close();
}

const lobbyLines = async () => {
  const t = await tokenFor('Ann', PW.Ann);
  const c = await client(t);
  const j = await join(c, '#lobby');
  c.close();
  // Only what the bot said by itself (the morning post), not its answers to someone's command.
  return j.history.filter((l) => l.bot && !l.replyTo).map((l) => l.text);
};

if (phase === 'b') {
  // The server started pretending it is 10:30 UK time on 15 June.
  const lines = await lobbyLines();
  check('the morning post wishes the birthday member a happy birthday', lines.some((t) => /^Happy birthday to Bday!/.test(t)), JSON.stringify(lines.slice(-4)));
  check('and adds the fact or quote of the day', lines.some((t) => /^(Did you know\? |Quote of the day: ")/.test(t)));
  check('a birthday that is not public is not mentioned', !lines.some((t) => /Happy birthday to .*Ann/.test(t)));
}

if (phase === 'c') {
  // Restarted again on the same day: it must not post a second time.
  const lines = await lobbyLines();
  check('it does not post twice on the same day', lines.filter((t) => /^Happy birthday/.test(t)).length === 1 && lines.filter((t) => /^(Did you know\? |Quote of the day)/.test(t)).length === 1, JSON.stringify(lines.slice(-6)));
}

if (phase === 'd') {
  // Next day, but only 6 in the morning UK time: too early.
  const lines = await lobbyLines();
  check('nothing is posted before 8 in the morning', lines.filter((t) => /^(Did you know\? |Quote of the day)/.test(t)).length === 1, JSON.stringify(lines.slice(-6)));
  const russ = await tokenFor('Russ', PW.Russ);
  await api('PUT', '/api/admin/settings', russ, { dailyPost: false });
}

if (phase === 'e') {
  // Later that day, but the administrator switched the daily post off.
  const lines = await lobbyLines();
  check('with the switch off, nothing is posted', lines.filter((t) => /^(Did you know\? |Quote of the day)/.test(t)).length === 1, JSON.stringify(lines.slice(-6)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
