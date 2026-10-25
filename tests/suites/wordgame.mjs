// Started by tests/run.mjs: QWords. The rules (scoring), then whole games played over the real connection.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

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
  const ws = new WebSocket(WS); const got = []; const games = {};
  ws.onmessage = (e) => { const m = JSON.parse(e.data); got.push(m); if (m.t === 'wg') games[m.id] = m.game; };
  await new Promise((r) => (ws.onopen = r));
  const c = {
    ws, got, close: () => ws.close(), send: (m) => ws.send(JSON.stringify(m)), clear: () => (got.length = 0),
    errors: () => got.filter((x) => x.t === 'error').map((x) => x.text),
    last: (t) => got.filter((x) => x.t === t).at(-1),
    // The latest copy of a game, even after the message list has been cleared.
    game: (id) => games[id] ?? undefined,
    systems: () => got.filter((x) => x.t === 'system').map((x) => x.text),
  };
  c.send({ t: 'hello', token }); await wait(250);
  return c;
}
const join = async (c, room) => { c.send({ t: 'join', room }); await wait(300); return c.last('joined'); };
const PW = { Russ: 'secret123', Ann: 'annpass-123', Bob: 'bobpass-123', Cat: 'catpass-123' };
const ROOM = '#wordroom';

const { evaluatePlay, emptyBoard, premiumAt, TILE_COUNTS, LETTER_VALUES } = await import(new URL('../../shared/dist/index.js', import.meta.url).href);
const WORDS = new Set(gunzipSync(readFileSync(new URL('../../server/words/enable1.txt.gz', import.meta.url))).toString('latin1').split(/\r?\n/).filter(Boolean));
const place = (word, r, c, horizontal = true) => [...word].map((letter, i) => ({ r: horizontal ? r : r + i, c: horizontal ? c + i : c, letter }));

if (phase === 'a') {
  // ---------------- the rules ----------------
  check('there are 100 tiles in the bag', Object.values(TILE_COUNTS).reduce((a, b) => a + b, 0) === 100);
  check('the board has the usual premium squares', premiumAt(0, 0) === 'TW' && premiumAt(7, 7) === 'DW' && premiumAt(5, 5) === 'TL' && premiumAt(0, 3) === 'DL' && premiumAt(7, 8) === null);
  let b = emptyBoard();
  let r = evaluatePlay(b, place('HELLO', 7, 3));
  check('HELLO across the middle scores 24 (a double letter, then the double word star)', r.ok && r.total === 24 && r.words[0].word === 'HELLO', JSON.stringify(r));
  check('the first word must cover the star', !evaluatePlay(b, place('HELLO', 3, 3)).ok);
  check('the first word needs two letters', !evaluatePlay(b, place('A', 7, 7)).ok);
  check('tiles must be in a line', !evaluatePlay(b, [{ r: 7, c: 7, letter: 'A' }, { r: 8, c: 8, letter: 'B' }]).ok);
  check('and with no gaps', !evaluatePlay(b, [{ r: 7, c: 6, letter: 'A' }, { r: 7, c: 8, letter: 'B' }]).ok);
  check('a tile cannot go off the board or on another tile', !evaluatePlay(b, [{ r: 7, c: 15, letter: 'A' }]).ok);
  for (const p of place('HELLO', 7, 3)) b[p.r][p.c] = { letter: p.letter };
  r = evaluatePlay(b, [{ r: 7, c: 8, letter: 'S' }]);
  check('adding an S to HELLO scores the whole word, with no premium on old tiles', r.ok && r.total === 9 && r.words[0].word === 'HELLOS', JSON.stringify(r));
  check('a move that does not touch anything is refused', !evaluatePlay(b, place('CAT', 1, 1)).ok);
  r = evaluatePlay(b, place('JO', 6, 7, false).slice(0, 1).concat([]));
  r = evaluatePlay(b, [{ r: 8, c: 4, letter: 'N' }, { r: 8, c: 5, letter: 'O' }]);
  check('a word laid beside another also scores the new two-letter words it makes', r.ok && r.words.length === 3 && r.words.map((w) => w.word).sort().join() === 'EN,LO,NO', JSON.stringify(r));
  r = evaluatePlay(b, [{ r: 6, c: 7, letter: 'A', blank: true }, { r: 5, c: 7, letter: 'Z' }].reverse());
  check('a blank tile scores nothing', r.ok && r.words[0].word === 'ZAO' && r.total === 10 + 0 + 1 && r.words.length === 1, JSON.stringify(r));
  b = emptyBoard();
  r = evaluatePlay(b, place('QUIZZES', 7, 1));
  check('using all seven tiles earns the 50 point bonus', r.ok && r.bingo === true && r.total >= 50, JSON.stringify(r));

  // ---------------- a real game ----------------
  const russ = await tokenFor('Russ', PW.Russ);
  const [ann, bob, cat] = await Promise.all(['Ann', 'Bob', 'Cat'].map((n) => tokenFor(n, PW[n])));
  const A = await client(ann), Bo = await client(bob), C = await client(cat);
  for (const c of [A, Bo, C]) await join(c, ROOM);

  A.clear(); A.send({ t: 'wgCreate', room: ROOM, maxPlayers: 2 }); await wait(500);
  const gid = A.last('wgList')?.games[0]?.id;
  check('a member can start a game and it shows in the room\'s list', !!gid && A.last('wgList').games[0].status === 'waiting' && A.last('wgList').games[0].players.length === 1, JSON.stringify(A.last('wgList')));
  check('the room is told', Bo.systems().some((s) => /Ann started a word game/.test(s)));
  Bo.clear(); Bo.send({ t: 'wgStart', id: gid }); await wait(300);
  check('someone who is not the creator cannot start it', Bo.errors().some((e) => /who made the game/.test(e)));
  A.clear(); A.send({ t: 'wgStart', id: gid }); await wait(300);
  check('and it cannot start with one player', A.errors().some((e) => /at least two/.test(e)));
  Bo.clear(); Bo.send({ t: 'wgJoin', id: gid }); await wait(400);
  check('another member can join', Bo.game(gid)?.players.length === 2 && Bo.game(gid).status === 'waiting', JSON.stringify(Bo.game(gid)));
  C.clear(); C.send({ t: 'wgJoin', id: gid }); await wait(300);
  check('a third cannot join a game for two', C.errors().some((e) => /full/.test(e)));
  A.clear(); A.send({ t: 'wgStart', id: gid }); await wait(500);
  const ga = A.game(gid), gb = Bo.game(gid);
  check('the game starts with seven tiles each and a full board of 86 tiles in the bag', ga?.status === 'playing' && ga.rack.length === 7 && gb.rack.length === 7 && ga.bag === 86, JSON.stringify({ s: ga?.status, bag: ga?.bag }));
  check('you only ever see your own tiles', ga.players.every((p) => p.tiles === 7) && JSON.stringify(ga).includes('"rack":["') && !JSON.stringify(ga).includes(gb.rack.join('","')) || ga.rack.join() === gb.rack.join());
  C.clear(); C.send({ t: 'wgOpen', id: gid }); await wait(300);
  check('an onlooker can watch, without any tiles', C.game(gid)?.rack.length === 0 && C.game(gid).board.length === 15);

  const me = (c) => (c === A ? A : Bo);
  const names = { A: 'Ann', B: 'Bob' };
  const turnClient = () => (ga.players[A.game(gid).turn].name === 'Ann' ? A : Bo);
  const other = (c) => (c === A ? Bo : A);

  let mover = turnClient();
  other(mover).clear(); other(mover).send({ t: 'wgPass', id: gid }); await wait(300);
  check('you cannot move out of turn', other(mover).errors().some((e) => /not your turn/.test(e)));

  // a word that is not a word
  const rack = A.game(gid).players[A.game(gid).turn].name === 'Ann' ? A.game(gid).rack : Bo.game(gid).rack;
  const letters = rack.filter((x) => x !== '?');
  let junk = null;
  for (let i = 0; i < letters.length; i++) for (let j = 0; j < letters.length; j++) if (i !== j && !WORDS.has((letters[i] + letters[j]).toLowerCase())) junk = junk ?? letters[i] + letters[j];
  mover.clear();
  if (junk) { mover.send({ t: 'wgPlay', id: gid, tiles: place(junk, 7, 7) }); await wait(300); }
  check('a word that is not in the dictionary is refused', !junk || mover.errors().some((e) => /not in the word list/.test(e)), junk + ' ' + JSON.stringify(mover.errors()));
  mover.clear();
  const missing = [...'QZXJKVWY'].find((l) => !rack.includes(l) && !rack.includes('?')) ?? 'Q';
  mover.send({ t: 'wgPlay', id: gid, tiles: [{ r: 7, c: 7, letter: missing }, { r: 7, c: 8, letter: missing }] }); await wait(300);
  check('you cannot play tiles you do not have', mover.errors().some((e) => /do not have those tiles/.test(e)), JSON.stringify(mover.errors()));

  // find a real word in the player's rack and play it
  const solveFirst = (rackLetters) => {
    const count = (s) => { const m = {}; for (const ch of s) m[ch] = (m[ch] ?? 0) + 1; return m; };
    const have = count(rackLetters.filter((x) => x !== '?').join(''));
    let best = null;
    for (const w of WORDS) {
      if (w.length < 2 || w.length > 7) continue;
      const W = w.toUpperCase();
      const need = count(W);
      if (Object.entries(need).every(([ch, n]) => (have[ch] ?? 0) >= n) && (!best || W.length > best.length)) best = W;
    }
    return best;
  };
  const myRack = (c) => c.game(gid).rack;
  let word = solveFirst(myRack(mover));
  check('the player has a word to play (a rare unlucky rack would be passed)', !!word, myRack(mover).join(''));
  const before = mover.game(gid);
  mover.clear(); other(mover).clear();
  mover.send({ t: 'wgPlay', id: gid, tiles: place(word, 7, 7 - Math.floor(word.length / 2)) }); await wait(500);
  const after = mover.game(gid);
  check('a good word is played and scored', after.moves.at(-1)?.kind === 'play' && after.moves.at(-1).score > 0 && after.players.find((p) => p.name === before.players[before.turn].name).score === after.moves.at(-1).score, JSON.stringify(after.moves.at(-1)));
  check('the tiles are on the board', place(word, 7, 7 - Math.floor(word.length / 2)).every((p) => after.board[p.r][p.c]?.letter === p.letter));
  check('the player draws new tiles', after.rack.length === 7 && after.bag === 86 - word.length, `${after.rack.length} ${after.bag}`);
  check('and it is the other player\'s turn', after.players[after.turn].name !== before.players[before.turn].name);
  check('both players and the onlooker see it', other(mover).game(gid)?.moves.length === 1 && C.game(gid)?.moves.length === 1);
  check('the last move is highlighted', after.lastPlay.length === word.length);

  // second move: build through a letter already on the board
  mover = turnClient();
  const view = mover.game(gid);
  let placed = null;
  const rl = view.rack.filter((x) => x !== '?');
  const have2 = {}; for (const ch of rl) have2[ch] = (have2[ch] ?? 0) + 1;
  for (let c = 0; c < 15 && !placed; c++) {
    const L = view.board[7][c]?.letter;
    if (!L) continue;
    for (const w of WORDS) {
      if (w.length < 3 || w.length > 8) continue;
      const W = w.toUpperCase();
      for (let i = 0; i < W.length && !placed; i++) {
        if (W[i] !== L) continue;
        const need = {}; for (let k = 0; k < W.length; k++) if (k !== i) need[W[k]] = (need[W[k]] ?? 0) + 1;
        if (!Object.entries(need).every(([ch, n]) => (have2[ch] ?? 0) >= n)) continue;
        const top = 7 - i;
        if (top < 0 || top + W.length > 15) continue;
        placed = [...W].map((letter, k) => ({ r: top + k, c, letter })).filter((p) => !(p.r === 7));
      }
      if (placed) break;
    }
  }
  check('there is a second move to make through a letter on the board', !!placed);
  if (placed) {
    mover.clear();
    mover.send({ t: 'wgPlay', id: gid, tiles: placed }); await wait(500);
    const g2 = mover.game(gid);
    check('a word built through an existing letter is accepted', g2.moves.length === 2 && g2.moves[1].kind === 'play' && g2.moves[1].words.some((w) => w.word.length === placed.length + 1), JSON.stringify(mover.errors()) + JSON.stringify(g2.moves[1]));
  }

  // exchange
  mover = turnClient();
  const rackBefore = mover.game(gid).rack.join('');
  mover.clear(); mover.send({ t: 'wgExchange', id: gid, letters: [mover.game(gid).rack[0]] }); await wait(500);
  check('swapping a tile keeps seven tiles and passes the turn', mover.game(gid).rack.length === 7 && mover.game(gid).moves.at(-1).kind === 'exchange' && mover.game(gid).players[mover.game(gid).turn].name !== mover.game(gid).players.find((p) => p.name === (mover === A ? 'Ann' : 'Bob')).name, rackBefore + ' -> ' + mover.game(gid).rack.join(''));

  // four passes in a row (everyone twice) ends it
  for (let i = 0; i < 4; i++) { mover = turnClient(); mover.send({ t: 'wgPass', id: gid }); await wait(350); }
  const end = A.game(gid);
  check('when everyone has passed twice the game ends', end.status === 'finished' && /passed twice/.test(end.endedBy), JSON.stringify({ s: end.status, e: end.endedBy }));
  check('tiles left count against each player and there is a winner', !!end.winner, JSON.stringify(end.players) + end.winner);
  check('the room is told how it ended', Bo.systems().some((s) => /word game is over/.test(s)));
  A.clear(); A.send({ t: 'wgPass', id: gid }); await wait(300);
  check('nothing more can be played', A.errors().some((e) => /not being played/.test(e)));

  // ---------------- resigning, and leaving before the start ----------------
  A.clear(); Bo.clear();
  A.send({ t: 'wgCreate', room: ROOM, maxPlayers: 3 }); await wait(400);
  const g2id = A.last('wgList').games.find((g) => g.status === 'waiting').id;
  Bo.send({ t: 'wgJoin', id: g2id }); await wait(300);
  Bo.send({ t: 'wgLeave', id: g2id }); await wait(300);
  check('someone can leave a game that has not started', A.game(g2id)?.players.length === 1);
  Bo.send({ t: 'wgJoin', id: g2id }); await wait(300);
  A.send({ t: 'wgStart', id: g2id }); await wait(400);
  Bo.send({ t: 'wgResign', id: g2id }); await wait(400);
  check('resigning in a game for two ends it, and the other player wins', A.game(g2id).status === 'finished' && A.game(g2id).winner === 'Ann' && /Bob resigned/.test(A.game(g2id).endedBy), JSON.stringify(A.game(g2id)?.endedBy));

  // ---------------- limits ----------------
  const ids = [];
  for (let i = 0; i < 5; i++) { C.clear(); C.send({ t: 'wgCreate', room: ROOM, maxPlayers: 2 }); await wait(1300); }
  C.clear(); C.send({ t: 'wgCreate', room: ROOM, maxPlayers: 2 }); await wait(1300);
  check('a member can be in five games at most', C.errors().some((e) => /already in 5 word games/.test(e)), JSON.stringify(C.errors()));

  // a game left in progress for the restart, and one that is waiting
  A.clear(); Bo.clear();
  A.send({ t: 'wgCreate', room: '#wordroom2', maxPlayers: 2 }); await wait(300); // not in that room: refused
  check('you can only start a game in a room you are in', A.errors().length === 1);
  for (const c of [A, Bo, C]) c.close();
}

if (phase === 'b') {
  const ann = await tokenFor('Ann', PW.Ann);
  const A = await client(ann);
  await join(A, ROOM);
  A.clear(); A.send({ t: 'wgList', room: ROOM }); await wait(400);
  const games = A.last('wgList')?.games ?? [];
  check('games survive a restart', games.length >= 3, JSON.stringify(games.map((g) => g.status)));
  const finished = games.find((g) => g.status === 'finished' && g.players.length === 2 && g.turn === null);
  check('with their status and players', !!finished && finished.players.some((p) => p.name === 'Ann'), JSON.stringify(games[0]));
  let tiles = 0;
  for (const g of games.filter((x) => x.status === 'finished')) {
    A.send({ t: 'wgOpen', id: g.id }); await wait(300);
    tiles += A.game(g.id)?.board.flat().filter(Boolean).length ?? 0;
  }
  check('and can be opened again with the board as it was', tiles > 0, String(tiles));
  A.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
