import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Started by tests/run.mjs: terms and privacy pages, data export, deleting your own account, the emergency
// password reset tool, and the housekeeping that keeps the disk from growing (old DMs, unused pictures, quota).
const B = 'http://localhost:8199', WS = 'ws://localhost:8199/ws';
const phase = process.argv[2] || 'a';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  -> ' + extra : '')); };
const api = async (method, path, token, body) => {
  const r = await fetch(B + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch {}
  return { s: r.status, j, text, h: r.headers };
};
const upload = async (token, body) => {
  const r = await fetch(B + '/api/upload', { method: 'POST', headers: { 'content-type': 'image/png', authorization: 'Bearer ' + token }, body });
  let j = {}; try { j = await r.json(); } catch {}
  return { s: r.status, j };
};
async function signup(name, pw, agree) {
  const r = await api('POST', '/api/register', null, { account: name, password: pw, ...(agree ? { agree: true } : {}) });
  return r.j.token;
}
const loginTok = async (name, pw) => (await api('POST', '/api/login', null, { account: name, password: pw })).j.token;
async function client(token) {
  const ws = new WebSocket(WS); const got = []; let closed = false;
  ws.onmessage = (e) => got.push(JSON.parse(e.data)); ws.onclose = () => (closed = true);
  await new Promise((r) => (ws.onopen = r));
  const c = {
    ws, got, isClosed: () => closed, close: () => ws.close(),
    send: (m) => ws.send(JSON.stringify(m)), last: (t) => got.filter((x) => x.t === t).at(-1),
  };
  c.send({ t: 'hello', token }); await wait(250);
  return c;
}
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const exportOf = async (token) => (await api('GET', '/api/account/export', token)).j;
const PW = { Russ: 'secret123', Ann: 'annpass-1', Bob: 'bobpass-1', Cat: 'catpass-1', Upl: 'uplpass-1', Gone: 'gonepass-1', Quota: 'quotapass-1' };

if (phase === 'a') {
  // ---------------- terms, privacy, agreement ----------------
  for (const p of ['/terms', '/privacy']) {
    const r = await fetch(B + p);
    check(`${p} is a public page`, r.status === 200 && /text\/html/.test(r.headers.get('content-type') ?? ''), String(r.status));
  }
  const russ = await signup('Russ', PW.Russ, true);
  const ann = await signup('Ann', PW.Ann, true);
  const eve = await signup('Eve', 'evepass-1', false);
  check('accounts are created', !!russ && !!ann && !!eve);
  const annData = await exportOf(ann), eveData = await exportOf(eve);
  check('agreeing to the terms is recorded with the account', typeof annData.account?.termsAcceptedAt === 'number' && annData.account.termsAcceptedAt > 0);
  check('not agreeing is recorded as not agreed', eveData.account?.termsAcceptedAt == null);

  // ---------------- contact email setting ----------------
  let r = await api('GET', '/api/site');
  check('the contact email is empty until it is set', r.j.contactEmail === '', JSON.stringify(r.j));
  r = await api('PUT', '/api/admin/settings', russ, { contactEmail: 'not an email' });
  check('a contact email that is not an email is refused', r.s === 422, `${r.s} ${r.j.error}`);
  r = await api('PUT', '/api/admin/settings', russ, { contactEmail: 'help@example.com' });
  check('an administrator can set the contact email', r.s === 200 && r.j.settings?.contactEmail === 'help@example.com', `${r.s}`);
  r = await api('GET', '/api/site');
  check('it is shown to everyone, signed in or not', r.j.contactEmail === 'help@example.com');
  r = await api('PUT', '/api/admin/settings', ann, { contactEmail: 'ann@example.com' });
  check('an ordinary member cannot change it', r.s === 403, String(r.s));

  // ---------------- data export ----------------
  r = await api('GET', '/api/account/export');
  check('the data export needs a login', r.s === 401, String(r.s));
  const bob = await signup('Bob', PW.Bob, true), cat = await signup('Cat', PW.Cat, true);
  const A = await client(ann), Bo = await client(bob);
  A.send({ t: 'join', room: '#exportroom' }); await wait(300);
  A.send({ t: 'say', room: '#exportroom', text: 'a message for the export' }); await wait(700);
  A.send({ t: 'dm', to: 'Bob', text: 'a private note for the export' }); await wait(500);
  A.send({ t: 'dm', to: 'Cat', text: 'dm that must survive trimming' }); await wait(500);
  A.send({ t: 'friendRequest', to: 'Bob' }); await wait(400);
  const exp = await api('GET', '/api/account/export', ann);
  check('the export is sent as a downloadable file', /attachment/.test(exp.h.get('content-disposition') ?? '') && /json/.test(exp.h.get('content-type') ?? ''));
  const d = exp.j;
  check('the export has their room messages', d.roomMessages?.some((m) => m.text === 'a message for the export'));
  check('the export has their private messages', d.privateMessages?.some((m) => m.text === 'a private note for the export' && m.to === 'Bob'));
  check('the export has their friend requests', d.friendRequestsSent?.some((f) => f.name === 'Bob'));
  check('the export never contains the password hash', !/passHash|scrypt/i.test(exp.text) && !exp.text.includes(PW.Ann));

  // ---------------- deleting your own account ----------------
  const gone = await signup('Gone', PW.Gone, true);
  const G = await client(gone);
  G.send({ t: 'join', room: '#exportroom' }); await wait(300);
  G.send({ t: 'say', room: '#exportroom', text: 'words from a member about to leave' }); await wait(700);
  G.send({ t: 'dm', to: 'Ann', text: 'a dm from the leaver' }); await wait(500);
  const pic = await upload(gone, PNG);
  check('the leaver can upload a picture', pic.s === 200 && !!pic.j.name, JSON.stringify(pic.j));
  G.send({ t: 'say', room: '#exportroom', text: 'with a picture', image: pic.j.name }); await wait(500);
  check('the picture is being served', (await fetch(B + pic.j.url)).status === 200);

  r = await api('DELETE', '/api/account', null, { password: PW.Gone });
  check('deleting an account needs a login', r.s === 401, String(r.s));
  r = await api('DELETE', '/api/account', gone, { password: 'wrong-pass-1' });
  check('the wrong password does not delete anything', r.s === 403, String(r.s));
  r = await api('DELETE', '/api/account', gone, {});
  check('no password does not delete anything', r.s === 403, String(r.s));
  check('the account is still there', !!(await loginTok('Gone', PW.Gone)));
  r = await api('DELETE', '/api/account', russ, { password: PW.Russ });
  check('an administrator cannot delete themselves', r.s === 409, `${r.s} ${r.j.error}`);
  check('and is still an administrator', (await api('GET', '/api/admin/stats', russ)).s === 200);

  r = await api('DELETE', '/api/account', gone, { password: PW.Gone });
  check('the right password deletes the account', r.s === 200 && r.j.ok === true, `${r.s} ${r.text}`);
  await wait(300);
  check('they are disconnected', G.isClosed());
  check('their login no longer works', (await api('POST', '/api/login', null, { account: 'Gone', password: PW.Gone })).s === 401);
  check('their old session no longer works', (await api('GET', '/api/me', gone)).s === 401);
  check('their picture file is gone', (await fetch(B + pic.j.url)).status === 404);
  const A2 = await client(ann);
  A2.send({ t: 'join', room: '#exportroom' }); await wait(400);
  const hist = A2.last('joined')?.history ?? [];
  check('their messages are gone from the room', !hist.some((l) => /leave|picture/.test(l.text)) && hist.some((l) => l.text === 'a message for the export'));
  A2.send({ t: 'dmHistory', with: 'Gone' }); await wait(300);
  check('their private messages are gone', (A2.last('dmHistory')?.lines ?? []).length === 0);
  const again = await signup('Gone', 'gonepass-2', true);
  check('the name can be used again', !!again);
  const g2 = await exportOf(again);
  check('and the new member starts with a clean slate', g2.roomMessages?.length === 0 && g2.privateMessages?.length === 0 && g2.pictures?.length === 0);

  // ---------------- things for the housekeeping phase ----------------
  const upl = await signup('Upl', PW.Upl, true);
  await signup('Quota', PW.Quota, true);
  const U = await client(upl);
  U.send({ t: 'join', room: '#picroom' }); await wait(300);
  const used = await upload(upl, PNG), unused = await upload(upl, PNG);
  check('two pictures are uploaded', used.s === 200 && unused.s === 200 && used.j.name !== unused.j.name);
  U.send({ t: 'say', room: '#picroom', text: 'this one is used', image: used.j.name }); await wait(500);

  for (const c of [A, A2, Bo, U]) c.close();
}

if (phase === 'b') {
  // The server was restarted after the database was prepared (old pictures, 2100 private messages, a full quota).
  const ann = await loginTok('Ann', PW.Ann), upl = await loginTok('Upl', PW.Upl), quota = await loginTok('Quota', PW.Quota);

  // ---------------- housekeeping ----------------
  const d = await exportOf(ann);
  const withBob = (d.privateMessages ?? []).filter((m) => m.from === 'Bob' || m.to === 'Bob');
  check('a conversation is trimmed to its newest 2000 private messages', withBob.length === 2000, String(withBob.length));
  check('the newest ones are kept', withBob.some((m) => m.text === 'filler 2100'));
  check('the oldest ones are dropped', !withBob.some((m) => m.text === 'filler 1'));
  check('other conversations are left alone', d.privateMessages?.some((m) => m.text === 'dm that must survive trimming'));

  const u = await exportOf(upl);
  check('a picture nobody used is removed once it is old', u.pictures?.length === 1, JSON.stringify(u.pictures));
  const usedLine = u.roomMessages?.find((m) => m.text === 'this one is used');
  check('a picture in a message is kept', !!usedLine && !!u.pictures?.[0] && usedLine.image === '/uploads/' + u.pictures[0].name);
  check('and its file is still served', (await fetch(B + usedLine.image)).status === 200);

  const q = await upload(quota, PNG);
  check('a member who has used all their picture space is refused', q.s === 413, `${q.s} ${JSON.stringify(q.j)}`);
  check('while others can still upload', (await upload(upl, PNG)).s === 200);

  // ---------------- emergency password reset ----------------
  const tool = join(ROOT, 'server', 'dist', 'tools', 'reset-password.js');
  const run = (...args) => spawnSync(process.execPath, [tool, ...args], { env: { ...process.env, QCHAT_DATA_DIR: process.env.QCHAT_DATA_DIR }, encoding: 'utf8' });
  let r = run('Nobody');
  check('the reset tool refuses a member that does not exist', r.status === 1 && /no member/i.test(r.stderr), r.stderr);
  r = run('Ann', 'abc');
  check('and refuses a weak password', r.status === 1 && r.stderr.length > 0 && (await api('POST', '/api/login', null, { account: 'Ann', password: PW.Ann })).s === 200, r.stderr);
  r = run('Ann');
  const m = /New password[^:]*: (\S+)/.exec(r.stdout);
  check('it makes a new password and prints it once', r.status === 0 && !!m && m[1].length >= 16, r.stdout + r.stderr);
  check('the old password stops working', (await api('POST', '/api/login', null, { account: 'Ann', password: PW.Ann })).s === 401);
  check('the old login is ended', (await api('GET', '/api/me', ann)).s === 401);
  check('the new password works', !!m && (await api('POST', '/api/login', null, { account: 'Ann', password: m[1] })).s === 200);
  r = run('Bob', 'a-chosen-pass-77');
  check('a password can be chosen instead', r.status === 0 && (await api('POST', '/api/login', null, { account: 'Bob', password: 'a-chosen-pass-77' })).s === 200, r.stderr);
  const russ = await loginTok('Russ', PW.Russ);
  const audit = await api('GET', '/api/admin/audit', russ);
  check('the reset is recorded in the audit log', /reset-password/.test(audit.text), String(audit.s));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
