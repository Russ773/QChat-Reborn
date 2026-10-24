const B = 'http://localhost:8199', WS = 'ws://localhost:8199/ws';
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
function ws(token, nick = 'x') {
  const w = new WebSocket(WS);
  const got = [];
  let closed = false;
  w.onmessage = (e) => got.push(JSON.parse(e.data));
  w.onclose = () => (closed = true);
  return new Promise((r) => (w.onopen = () => {
    w.send(JSON.stringify({ t: 'hello', nick, token }));
    r({ w, got, isClosed: () => closed });
  }));
}
const send = (c, m) => c.w.send(JSON.stringify(m));

// 1. guests are rejected
const g = await ws(undefined, 'Guesty'); await wait(300);
check('guest hello rejected and closed', g.got.some((m) => m.t === 'error') && g.isClosed() && !g.got.some((m) => m.t === 'welcome'));
const g2 = await ws('not-a-real-token'); await wait(300);
check('bad token rejected', g2.got.some((m) => m.t === 'error') && !g2.got.some((m) => m.t === 'welcome'));
const g3 = await ws(undefined, 'Sneaky'); await wait(150);
send(g3, { t: 'join', room: '#lobby' }); send(g3, { t: 'say', room: '#lobby', text: 'let me in' }); send(g3, { t: 'nick', nick: 'Admin' }); await wait(250);
check('unauthenticated socket cannot join or speak', !g3.got.some((m) => m.t === 'joined' || m.t === 'message'));

// 2. accounts
let r = await api('POST', '/api/login', null, { account: 'Russ', password: 'secret123' });
const russ = r.j.token;
check('Russ logs in as admin', r.s === 200 && r.j.role === 'admin', 'role=' + r.j.role);
r = await api('POST', '/api/register', null, { account: 'Pat', password: 'patpass1', email: 'pat@x.com' });
const pat = r.j.token;
check('Pat registers as a normal user', r.s === 200 && r.j.role === 'user', 'role=' + r.j.role);

// 3. permissions
r = await api('GET', '/api/admin/stats'); check('admin API without token -> 401', r.s === 401);
r = await api('GET', '/api/admin/stats', pat); check('normal user on admin API -> 403', r.s === 403);
r = await api('GET', '/api/admin/users', pat); check('normal user cannot list members -> 403', r.s === 403);
r = await api('POST', '/api/admin/announce', pat, { text: 'hax' }); check('normal user cannot announce -> 403', r.s === 403);
r = await api('PUT', '/api/admin/settings', pat, { maintenance: true }); check('normal user cannot change settings -> 403', r.s === 403);
r = await api('GET', '/api/admin/stats', russ);
check('admin stats ok', r.s === 200 && r.j.stats.members >= 2, JSON.stringify(r.j.stats));
r = await api('GET', '/api/admin/users?q=pat', russ);
check('member search finds Pat and leaks no password hash', r.j.users?.length === 1 && r.j.users[0].account === 'Pat' && !JSON.stringify(r.j).includes('passHash'), 'fields=' + Object.keys(r.j.users?.[0] || {}).join(','));

// 4. self-protection
r = await api('POST', '/api/admin/users/Russ/role', russ, { role: 'user' }); check('cannot demote yourself', r.s === 409, r.j.error);
r = await api('POST', '/api/admin/users/Russ/suspend', russ, { suspended: true }); check('cannot suspend yourself', r.s === 409, r.j.error);
r = await api('DELETE', '/api/admin/users/Russ', russ); check('cannot delete yourself', r.s === 409, r.j.error);
r = await api('POST', '/api/admin/users/Nobody/suspend', russ, { suspended: true }); check('unknown member -> 404', r.s === 404);

// 5. suspend kicks live connection and blocks login
const patWs = await ws(pat); await wait(250); send(patWs, { t: 'join', room: '#lobby' }); await wait(200);
check('Pat connected and joined', patWs.got.some((m) => m.t === 'welcome') && patWs.got.some((m) => m.t === 'joined'));
r = await api('POST', '/api/admin/users/Pat/suspend', russ, { suspended: true, reason: 'spamming' }); await wait(300);
check('suspend ok', r.s === 200);
check('suspended Pat was disconnected', patWs.isClosed() && patWs.got.some((m) => m.t === 'error' && /suspended/.test(m.text)));
r = await api('POST', '/api/login', null, { account: 'Pat', password: 'patpass1' });
check('suspended login -> 403 with reason', r.s === 403 && /spamming/.test(r.j.error), r.j.error);
const patWs2 = await ws(pat); await wait(300);
check('suspended token cannot connect', !patWs2.got.some((m) => m.t === 'welcome'));
r = await api('POST', '/api/admin/users/Pat/suspend', russ, { suspended: false }); check('unsuspend ok', r.s === 200);
r = await api('POST', '/api/login', null, { account: 'Pat', password: 'patpass1' });
const pat2 = r.j.token; check('Pat can log in again', r.s === 200);

// 6. role changes
r = await api('POST', '/api/admin/users/Pat/role', russ, { role: 'admin' }); check('promote Pat', r.s === 200);
r = await api('GET', '/api/admin/stats', pat2); check('Pat is now admin (admin API ok)', r.s === 200);
r = await api('POST', '/api/admin/users/Pat/suspend', russ, { suspended: true }); check('cannot suspend an admin', r.s === 409, r.j.error);
r = await api('POST', '/api/admin/users/Pat/role', russ, { role: 'user' }); check('demote Pat', r.s === 200);
r = await api('GET', '/api/admin/stats', pat2); check('demoted Pat loses admin API immediately', r.s === 403);

// 7. password reset
const patWs3 = await ws(pat2); await wait(250);
r = await api('POST', '/api/admin/users/Pat/password', russ, { password: 'abc' }); check('short password rejected', r.s === 422);
r = await api('POST', '/api/admin/users/Pat/password', russ, { password: 'newpass99' }); await wait(300);
check('password reset ok and live session kicked', r.s === 200 && patWs3.isClosed());
r = await api('POST', '/api/login', null, { account: 'Pat', password: 'patpass1' }); check('old password fails', r.s === 401);
r = await api('POST', '/api/login', null, { account: 'Pat', password: 'newpass99' });
const pat3 = r.j.token; check('new password works', r.s === 200);

// 8. settings
r = await api('PUT', '/api/admin/settings', russ, { welcomeMessage: 'Be kind. Have fun.', registrationOpen: false });
check('settings saved', r.s === 200 && r.j.settings.registrationOpen === false);
r = await api('GET', '/api/site'); check('/api/site reports registration closed', r.j.registrationOpen === false);
r = await api('POST', '/api/register', null, { account: 'Quinn', password: 'quinnpw1' }); check('registration closed -> 403', r.s === 403, r.j.error);
const c1 = await ws(pat3); await wait(250); send(c1, { t: 'join', room: '#general' }); await wait(250);
check('welcome message shown on join', c1.got.some((m) => m.t === 'system' && m.text === 'Be kind. Have fun.'));
await api('PUT', '/api/admin/settings', russ, { registrationOpen: true, maintenance: true }); await wait(300);
check('turning maintenance on disconnects people already chatting', c1.isClosed() && c1.got.some((m) => m.t === 'error' && /maintenance/.test(m.text)));
r = await api('POST', '/api/login', null, { account: 'Pat', password: 'newpass99' }); check('maintenance blocks normal login -> 503', r.s === 503, r.j.error);
r = await api('POST', '/api/login', null, { account: 'Russ', password: 'secret123' }); check('admin can still log in during maintenance', r.s === 200);
const cm = await ws(pat3); await wait(300); check('maintenance blocks normal chat connect', !cm.got.some((m) => m.t === 'welcome'));
await api('PUT', '/api/admin/settings', russ, { maintenance: false, welcomeMessage: '' });

// 9. announce, rooms, kick, close
const a1 = await ws(pat3); await wait(250);
send(a1, { t: 'join', room: '#lobby' }); send(a1, { t: 'join', room: '#movie-club' }); await wait(250);
r = await api('POST', '/api/admin/announce', russ, { text: 'Server update at 10pm' }); await wait(200);
check('announce reaches everyone', r.s === 200 && r.j.reached >= 1 && a1.got.some((m) => m.t === 'announce' && m.text === 'Server update at 10pm'));
r = await api('POST', '/api/admin/announce', russ, { text: '   ' }); check('empty announcement rejected', r.s === 422);
r = await api('GET', '/api/admin/rooms', russ);
const mc = r.j.rooms.find((x) => x.name === '#movie-club');
check('admin rooms lists the user room with members', !!mc && mc.members.includes('Pat') && !mc.permanent);
send(a1, { t: 'playYouTube', room: '#movie-club', ref: 'dQw4w9WgXcQ' }); await wait(200);
r = await api('POST', '/api/admin/rooms/%23movie-club/stopmedia', russ); check('stop video', r.s === 200);
r = await api('POST', '/api/admin/rooms/%23movie-club/kick', russ, { nick: 'Pat' }); await wait(200);
check('kick from room', r.s === 200 && a1.got.some((m) => m.t === 'left' && m.room === '#movie-club'));
r = await api('GET', '/api/admin/rooms', russ); const emptied = r.j.rooms.find((x) => x.name === '#movie-club');
check('rooms persist when emptied (they are saved, owned rooms now)', !!emptied && emptied.members.length === 0 && emptied.owner === 'Pat', JSON.stringify({ members: emptied?.members, owner: emptied?.owner }));
r = await api('POST', '/api/admin/rooms/%23movie-club/close', russ); check('admin closing a user room deletes it', r.s === 200);
r = await api('GET', '/api/admin/rooms', russ); check('and it is gone from the list', !r.j.rooms.some((x) => x.name === '#movie-club'));
r = await api('POST', '/api/admin/rooms/%23lobby/close', russ); await wait(200);
check('close #lobby clears members', r.s === 200 && a1.got.some((m) => m.t === 'left' && m.room === '#lobby'));
r = await api('GET', '/api/admin/rooms', russ); check('#lobby (permanent) still exists', r.j.rooms.some((x) => x.name === '#lobby' && x.permanent));

// 10. delete + audit
await api('POST', '/api/admin/users/Pat/role', russ, { role: 'admin' });
r = await api('DELETE', '/api/admin/users/Pat', russ); check('cannot delete an admin', r.s === 409, r.j.error);
await api('POST', '/api/admin/users/Pat/role', russ, { role: 'user' });
r = await api('DELETE', '/api/admin/users/Pat', russ); check('delete member', r.s === 200);
r = await api('POST', '/api/login', null, { account: 'Pat', password: 'newpass99' }); check('deleted member cannot log in', r.s === 401);
r = await api('GET', '/api/admin/audit', russ);
const acts = r.j.entries.map((e) => e.action);
const want = ['suspend', 'unsuspend', 'make-admin', 'remove-admin', 'reset-password', 'settings', 'announce', 'stop-video', 'kick-from-room', 'close-room', 'delete-member'];
check('audit log recorded every kind of action', want.every((a) => acts.includes(a)), 'missing=' + want.filter((a) => !acts.includes(a)).join(',') + ' total=' + acts.length);
check('audit shows who did it', r.j.entries.every((e) => e.admin === 'Russ'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
