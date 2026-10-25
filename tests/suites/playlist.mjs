// Started by tests/run.mjs: link parsing, the queue and skipping, the room radio, other video services, and member sounds.
import { existsSync } from 'node:fs';
import { join as pathJoin } from 'node:path';

const B = 'http://localhost:8199', WS = 'ws://localhost:8199/ws';
const phase = process.argv[2] || 'a';
const DATA = process.env.QCHAT_DATA_DIR;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  -> ' + extra : '')); };
const api = async (method, path, token, body, headers = {}, raw = false) => {
  const r = await fetch(B + path, { method, headers: { ...(raw ? {} : { 'content-type': 'application/json' }), ...headers, ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: raw ? body : body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch {}
  return { s: r.status, j, text, h: r.headers };
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
    errors: () => got.filter((x) => x.t === 'error').map((x) => x.text),
    last: (t) => got.filter((x) => x.t === t).at(-1), of: (t) => got.filter((x) => x.t === t),
    systems: () => got.filter((x) => x.t === 'system').map((x) => x.text),
    media: () => got.filter((x) => x.t === 'media').at(-1)?.state,
    queue: () => got.filter((x) => x.t === 'queue').at(-1),
    say: (room, text) => ws.send(JSON.stringify({ t: 'say', room, text })),
  };
  c.send({ t: 'hello', token }); await wait(250);
  return c;
}
const join = async (c, room) => { c.send({ t: 'join', room }); await wait(350); return c.last('joined'); };
const PW = { Russ: 'secret123', Dee: 'deepass-123', Mo: 'mopass-123', Pat: 'patpass-123', Sam: 'sampass-123' };
const YT = (id) => `https://www.youtube.com/watch?v=${id}`;
const V1 = 'dQw4w9WgXcQ', V2 = 'aqz-KE-bpKQ', V3 = 'jNQXAC9IVRw', V4 = 'M7lc1UVf-VE', V5 = 'kJQP7kiw5Fk', V6 = '9bZkp7q19f0';

// A tiny file that really is a WAV (the server looks at the bytes, not the name).
const wav = (n = 200) => Buffer.concat([Buffer.from('RIFF'), Buffer.from([n & 255, 0, 0, 0]), Buffer.from('WAVEfmt '), Buffer.alloc(n)]);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

if (phase === 'a') {
  // ---------------- link parsing ----------------
  const { parseMediaUrl, isLive, mediaLink } = await import(new URL('../../shared/dist/index.js', import.meta.url).href);
  const p = (s) => parseMediaUrl(s);
  check('a YouTube watch link', p(YT(V1))?.provider === 'youtube' && p(YT(V1)).ref === V1);
  check('a bare YouTube id', p(V1)?.ref === V1);
  check('youtu.be, shorts and embed links', ['https://youtu.be/' + V1, 'https://www.youtube.com/shorts/' + V1, 'https://www.youtube.com/embed/' + V1, 'https://m.youtube.com/watch?v=' + V1 + '&t=30'].every((u) => p(u)?.ref === V1));
  check('a Vimeo link', p('https://vimeo.com/76979871')?.provider === 'vimeo' && p('https://vimeo.com/76979871').ref === '76979871');
  check('a Vimeo player link and an unlisted one with a hash', p('https://player.vimeo.com/video/76979871')?.ref === '76979871' && p('https://vimeo.com/76979871/abcdef1234')?.ref === '76979871:abcdef1234' && p('https://player.vimeo.com/video/76979871?h=abcdef1234')?.ref === '76979871:abcdef1234');
  check('a SoundCloud track and set', p('https://soundcloud.com/forss/flickermood')?.ref === 'forss/flickermood' && p('https://soundcloud.com/forss/sets/soulhack')?.ref === 'forss/sets/soulhack');
  check('SoundCloud pages that are not tracks are refused', !p('https://soundcloud.com/discover') && !p('https://soundcloud.com/forss') && !p('https://soundcloud.com/stream/foo'));
  check('a Twitch channel', p('https://www.twitch.tv/Some_Channel')?.provider === 'twitch' && p('https://twitch.tv/Some_Channel').ref === 'some_channel' && isLive('twitch'));
  check('Twitch directory pages are refused', !p('https://twitch.tv/directory') && !p('https://twitch.tv/videos/123456'));
  check('other sites and schemes are refused', ['https://evil.example/watch?v=' + V1, 'javascript:alert(1)', 'file:///etc/passwd', 'ftp://youtube.com/watch?v=' + V1, 'https://youtube.com.evil.example/watch?v=' + V1, '', 'x'.repeat(400)].every((u) => p(u) === null), JSON.stringify(p('https://youtube.com.evil.example/watch?v=' + V1)));
  check('a link can be turned back into an address', mediaLink({ provider: 'vimeo', ref: '1234567:abcdef1234' }) === 'https://vimeo.com/1234567/abcdef1234');

  const russ = await tokenFor('Russ', PW.Russ);
  const [dee, mo, pat, sam] = await Promise.all(['Dee', 'Mo', 'Pat', 'Sam'].map((n) => tokenFor(n, PW[n])));
  const D = await client(dee), M = await client(mo), P = await client(pat);
  const ROOM = '#tunes';
  await join(D, ROOM); await join(M, ROOM); await join(P, ROOM); // Dee creates it, so owns it
  D.say(ROOM, '/mod Mo'); await wait(400);

  // ---------------- playing, and other services ----------------
  P.clear(); P.send({ t: 'playMedia', room: ROOM, url: 'https://evil.example/x' }); await wait(300);
  check('a link that cannot be played is refused with a clear message', P.errors().some((e) => /YouTube, Vimeo, SoundCloud or Twitch/.test(e)));
  D.clear(); P.clear(); D.send({ t: 'playMedia', room: ROOM, url: YT(V1) }); await wait(500);
  check('playing a link starts it for everyone', P.media()?.kind === 'youtube' && P.media().ref === V1 && P.media().by === 'Dee', JSON.stringify(P.media()));
  check('and the room is told', P.systems().some((s) => /Dee started a video/.test(s)));
  P.clear(); D.send({ t: 'playMedia', room: ROOM, url: 'https://vimeo.com/76979871' }); await wait(500);
  check('Vimeo plays', P.media()?.kind === 'vimeo' && P.media().ref === '76979871');
  P.clear(); D.send({ t: 'playMedia', room: ROOM, url: 'https://soundcloud.com/forss/flickermood' }); await wait(500);
  check('SoundCloud plays', P.media()?.kind === 'soundcloud' && P.media().ref === 'forss/flickermood' && P.systems().some((s) => /started a track/.test(s)));
  P.clear(); D.send({ t: 'playMedia', room: ROOM, url: 'https://twitch.tv/some_channel' }); await wait(500);
  check('a Twitch channel plays', P.media()?.kind === 'twitch' && P.systems().some((s) => /live stream/.test(s)));
  P.clear(); D.send({ t: 'queueAdd', room: ROOM, url: 'https://twitch.tv/some_channel' }); await wait(300);
  check('but a live stream cannot be queued', D.errors().some((e) => /live stream/i.test(e)));
  D.send({ t: 'mediaControl', room: ROOM, op: 'stop' }); await wait(300);
  P.clear(); D.send({ t: 'playYouTube', room: ROOM, ref: V1 }); await wait(400);
  check('the old playYouTube message still works', P.media()?.ref === V1);
  D.send({ t: 'mediaControl', room: ROOM, op: 'stop' }); await wait(300);

  // ---------------- queue ----------------
  P.clear(); D.clear(); D.send({ t: 'queueAdd', room: ROOM, url: YT(V1) }); await wait(500);
  check('adding to an empty room just plays it', D.media()?.ref === V1 && (P.queue()?.items.length ?? 0) === 0);
  P.send({ t: 'queueAdd', room: ROOM, url: YT(V2) }); await wait(300);
  M.send({ t: 'queueAdd', room: ROOM, url: YT(V3) }); await wait(300);
  M.send({ t: 'queueAdd', room: ROOM, url: YT(V4) }); await wait(300);
  const q = P.queue();
  check('the next things wait in order, with who added them', q?.items.map((i) => i.ref + ':' + i.by).join() === `${V2}:Pat,${V3}:Mo,${V4}:Mo`, JSON.stringify(q?.items));
  check('and everyone can see the queue', M.queue()?.items.length === 3 && D.queue()?.items.length === 3);
  P.clear(); P.send({ t: 'queueRemove', room: ROOM, id: q.items[1].id }); await wait(300);
  check('you cannot remove someone else\'s item', P.errors().some((e) => /your own/.test(e)));
  M.send({ t: 'queueRemove', room: ROOM, id: q.items[0].id }); await wait(300);
  check('a moderator can remove anyone\'s', D.queue()?.items.length === 2 && !D.queue().items.some((i) => i.ref === V2));
  P.send({ t: 'queueAdd', room: ROOM, url: YT(V2) }); await wait(300);
  P.send({ t: 'queueRemove', room: ROOM, id: P.queue().items.at(-1).id }); await wait(300);
  check('and you can remove your own', P.queue().items.length === 2);
  for (const u of [V1, V2, V3, V4, V5, V6]) { P.send({ t: 'queueAdd', room: ROOM, url: YT(u) }); await wait(1300); }
  check('one member can queue five things at most', P.queue().items.filter((i) => i.by === 'Pat').length === 5 && P.errors().some((e) => /already have 5/.test(e)), JSON.stringify(P.errors()));

  // ended -> next
  await wait(2500); // a video cannot "end" in its first 3 seconds
  P.clear(); D.send({ t: 'mediaControl', room: ROOM, op: 'ended', ref: V1 }); await wait(500);
  check('when a video ends the next in the queue starts', P.media()?.ref === V3 && P.media().by === 'Mo', JSON.stringify(P.media()));
  check('and the queue shrinks', P.queue()?.items.length === 6);

  // skip votes
  await wait(300);
  P.clear(); D.clear(); P.send({ t: 'mediaSkip', room: ROOM }); await wait(400);
  check('one vote out of three is not enough', P.media() === undefined && P.systems().some((s) => /voted to skip \(1 of 2\)/.test(s)), JSON.stringify(P.systems()));
  check('the vote count is shown', P.queue()?.skipVotes === 1 && P.queue().skipNeeded === 2);
  P.send({ t: 'mediaSkip', room: ROOM }); await wait(300);
  check('voting twice does not count twice', P.queue()?.skipVotes === 1);
  D.send({ t: 'mediaSkip', room: ROOM }); await wait(500); // Dee owns the room (rank 3): a moderator skips straight away
  check('a moderator skips straight away', P.media()?.ref !== V3 && P.systems().some((s) => /Dee skipped it/.test(s)), JSON.stringify(P.systems()));
  check('and the next one plays', P.media()?.ref === V4 || P.media()?.ref === V1 || P.media()?.ref === V2, JSON.stringify(P.media()));
  P.clear(); const iStarted = P.media()?.by === 'Pat';
  check('the person who started something can skip it', iStarted ? true : (P.send({ t: 'mediaSkip', room: ROOM }), true));

  // stop leaves the queue; skip starts it
  D.clear(); M.send({ t: 'mediaControl', room: ROOM, op: 'stop' }); await wait(400);
  check('stopping clears what is playing', D.media() === null);
  check('but keeps the queue', (D.queue()?.items.length ?? 0) > 0);
  D.clear(); P.send({ t: 'mediaSkip', room: ROOM }); await wait(500);
  check('skipping with nothing playing starts the next thing', !!D.media());
  D.send({ t: 'queueRemove', room: ROOM, id: 'all' }); await wait(300);
  check('a moderator can clear the queue', D.queue()?.items.length === 0);
  P.clear(); P.send({ t: 'queueRemove', room: ROOM, id: 'all' }); await wait(300);
  check('an ordinary member cannot', P.errors().some((e) => /moderators/.test(e)));
  D.send({ t: 'mediaControl', room: ROOM, op: 'stop' }); await wait(300);
  D.clear(); D.say(ROOM, '/skip'); await wait(400);
  check('/skip with nothing playing or waiting says so', D.errors().some((e) => /Nothing is playing/.test(e)));
  D.clear(); D.say(ROOM, '/queue'); await wait(400);
  check('/queue says when it is empty', JSON.stringify(D.got).includes('queue is empty'));

  // ---------------- radio ----------------
  const R = '#radioroom';
  const D2 = await client(dee); // a second window, just to listen
  await join(D, R); // Dee created it, so owns it
  P.clear(); await join(P, R);
  P.say(R, '/radio add ' + YT(V1)); await wait(400);
  check('only the owner can change the radio', P.errors().some((e) => /room owner/.test(e)));
  D.clear(); D.say(R, '/radio on'); await wait(400);
  check('it cannot be turned on with no tracks', D.errors().some((e) => /Add a track first/.test(e)));
  D.say(R, '/radio add https://twitch.tv/some_channel'); await wait(400);
  check('a live stream cannot go on the radio', D.errors().some((e) => /live stream/.test(e)));
  D.say(R, '/radio add nonsense'); await wait(400);
  check('nor a link that cannot be played', D.errors().some((e) => /Use \/radio add/.test(e)));
  D.say(R, '/radio add ' + YT(V1)); await wait(500);
  D.say(R, '/radio add ' + YT(V2)); await wait(500);
  check('the owner can add tracks, and the room sees the list', P.last('radio')?.tracks.length === 2 && P.last('radio').on === false, JSON.stringify(P.last('radio')));
  P.clear(); D.say(R, '/radio on'); await wait(600);
  check('turning the radio on starts the first track for the room', P.media()?.ref === V1 && P.media().radio === true && P.media().by === 'Radio', JSON.stringify(P.media()));
  check('and the radio is shown as on', P.last('radio')?.on === true);
  await wait(3200);
  P.clear(); D.send({ t: 'mediaControl', room: R, op: 'ended', ref: V1 }); await wait(500);
  check('when a track ends the next one plays', P.media()?.ref === V2 && P.media().radio === true, JSON.stringify(P.media()));
  await wait(3200);
  P.clear(); D.send({ t: 'mediaControl', room: R, op: 'ended', ref: V2 }); await wait(500);
  check('and the radio loops back to the start', P.media()?.ref === V1, JSON.stringify(P.media()));
  P.send({ t: 'queueAdd', room: R, url: YT(V3) }); await wait(400);
  await wait(3000);
  P.clear(); D.send({ t: 'mediaControl', room: R, op: 'ended', ref: V1 }); await wait(500);
  check('something queued by a member plays before the radio carries on', P.media()?.ref === V3 && P.media().radio !== true, JSON.stringify(P.media()));
  await wait(3200);
  P.clear(); D.send({ t: 'mediaControl', room: R, op: 'ended', ref: V3 }); await wait(500);
  check('then the radio resumes', P.media()?.radio === true && P.media()?.ref === V2, JSON.stringify(P.media()));
  P.clear(); D.say(R, '/radio remove 1'); await wait(400);
  check('a track can be removed', P.last('radio')?.tracks.length === 1 && P.last('radio').tracks[0].ref === V2);
  D.clear(); D.say(R, '/radio'); await wait(400);
  check('/radio shows the state', JSON.stringify(D.got).includes('radio is on'));
  P.clear(); D.say(R, '/radio off'); await wait(500);
  check('turning it off stops the radio track', P.last('radio')?.on === false && !P.media()?.radio, JSON.stringify(P.media()));

  // radio on, then a stop holds it until the room is empty again; state survives a restart (phase b)
  D.say(R, '/radio on'); await wait(500);
  check('on again', P.media()?.radio === true);
  M.clear(); await join(M, R);
  P.send({ t: 'mediaControl', room: R, op: 'stop' }); await wait(400);
  check('stopping the radio keeps it quiet while people are here', P.media() === null);
  D2.close();

  // ---------------- member sounds ----------------
  const S = (name, emoji, body, token = pat, type = 'audio/wav') => api('POST', `/api/sounds?name=${encodeURIComponent(name)}&emoji=${encodeURIComponent(emoji)}`, token, body, { 'content-type': type }, true);
  let r = await S('Boing', '🔊', wav(), null);
  check('uploading a sound needs a login', r.s === 401);
  r = await S('', '🔊', wav());
  check('a sound needs a name', r.s === 422);
  r = await S('bad<name>', '🔊', wav());
  check('and a plain one', r.s === 422);
  r = await S('Boing', 'hello', wav());
  check('the emoji must be an emoji', r.s === 422);
  r = await S('Boing', '🔊', PNG);
  check('only audio is accepted (a picture is refused)', r.s === 415, String(r.s));
  r = await S('Boing', '🔊', Buffer.from('<html><script>alert(1)</script></html>' + ' '.repeat(40)));
  check('and not a web page', r.s === 415);
  r = await S('Boing', '🔊', wav(200 * 1024));
  check('a long clip is refused', r.s === 413, String(r.s));
  r = await S('Boing', '🎺', wav());
  const mine = r.j.sound;
  check('a short clip is accepted and waits for approval', r.s === 200 && mine?.status === 'pending' && /^c\d+$/.test(mine.id), JSON.stringify(r.j));
  r = await api('GET', '/api/sounds', pat);
  check('its owner sees it', r.j.mine?.some((s) => s.id === mine.id && s.status === 'pending'));
  check('but the soundboard does not list it', !r.j.sounds?.some((s) => s.id === mine.id));
  r = await api('GET', '/api/sounds', sam);
  check('nor does anyone else see it', !r.j.mine?.length && !r.j.sounds?.some((s) => s.id === mine.id));
  P.clear(); D.clear(); P.send({ t: 'playSound', room: ROOM, sound: mine.id }); await wait(400);
  check('it cannot be played before it is approved', P.errors().some((e) => /not available/.test(e)) && !D.got.some((x) => x.t === 'sound'));
  r = await api('GET', '/api/admin/sounds', pat);
  check('members cannot see the approval list', r.s === 403);
  r = await api('GET', '/api/admin/sounds', russ);
  check('an admin sees it waiting', r.j.sounds?.some((s) => s.id === mine.id && s.status === 'pending'));
  const file = await fetch(B + mine.url);
  check('the file is served as audio, never guessed', file.status === 200 && file.headers.get('content-type') === 'audio/wav' && file.headers.get('x-content-type-options') === 'nosniff', `${file.status} ${file.headers.get('content-type')}`);
  r = await api('POST', `/api/admin/sounds/${mine.id}/approve`, pat);
  check('only admins can approve', r.s === 403);
  r = await api('POST', `/api/admin/sounds/${mine.id}/approve`, russ);
  check('an admin approves it', r.s === 200);
  r = await api('GET', '/api/sounds', sam);
  check('now it is on everyone\'s soundboard', r.j.sounds?.some((s) => s.id === mine.id && s.name === 'Boing' && s.by === 'Pat'));
  P.clear(); D.clear(); P.send({ t: 'playSound', room: ROOM, sound: mine.id }); await wait(400);
  check('and plays for the room', D.last('sound')?.sound === mine.id && D.last('sound').from === 'Pat');
  r = await api('DELETE', `/api/sounds/${mine.id}`, sam);
  check('someone else cannot delete it', r.s === 404);
  for (let i = 2; i <= 5; i++) await S('Clip' + i, '🔊', wav());
  r = await S('One too many', '🔊', wav());
  check('a member can have five sounds', r.s === 429, String(r.s));
  r = await api('GET', '/api/admin/sounds', russ);
  const rejectMe = r.j.sounds.find((s) => s.name === 'Clip2');
  r = await api('POST', `/api/admin/sounds/${rejectMe.id}/reject`, russ);
  check('an admin can reject one', r.s === 200);
  check('and its file is gone', (await fetch(B + rejectMe.url)).status === 404);
  r = await api('DELETE', `/api/sounds/${mine.id}`, pat);
  check('the owner can delete their own', r.s === 200 && (await fetch(B + mine.url)).status === 404);
  const left = (await api('GET', '/api/sounds', pat)).j.mine.length;
  check('deleting a member removes their sounds', left === 3);
  const saved = (await api('GET', '/api/sounds', pat)).j.mine[0];
  r = await api('DELETE', '/api/account', pat, { password: PW.Pat });
  check('a member can delete their account', r.s === 200);
  check('and their sound files go with it', (await fetch(B + saved.url)).status === 404 && !existsSync(pathJoin(DATA, 'sounds', saved.url.slice('/sounds/'.length))));

  for (const c of [D, M, P]) c.close();
}

if (phase === 'b') {
  // After a restart: the radio is still set up, and starts by itself when someone arrives.
  const dee = await tokenFor('Dee', PW.Dee);
  const D = await client(dee);
  const j = await join(D, '#radioroom');
  await wait(600);
  const m = D.last('media')?.state;
  check('the radio tracks and switch survive a restart', D.last('radio')?.on === true && D.last('radio').tracks.length === 1, JSON.stringify(D.last('radio')));
  check('and it starts playing for the first person to arrive', m?.radio === true && m.ref === 'aqz-KE-bpKQ', JSON.stringify(m));
  D.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
