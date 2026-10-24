const B = 'http://localhost:8199', WS = 'ws://localhost:8199/ws';
const mode = process.argv[2];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const login = async (a, p) => (await (await fetch(B + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account: a, password: p }) })).json()).token;
const ws = new WebSocket(WS); const got = [];
ws.onmessage = (e) => got.push(JSON.parse(e.data));
await new Promise((r) => (ws.onopen = r));
ws.send(JSON.stringify({ t: 'hello', token: await login('Bob', 'bobpass1') })); await wait(300);
ws.send(JSON.stringify({ t: 'join', room: '#w2' })); await wait(300);
const joined = got.find((m) => m.t === 'joined');
const target = joined.history.find((l) => l.text === 'a harmless message');
if (mode === 'react') {
  ws.send(JSON.stringify({ t: 'react', room: '#w2', id: target.id, emoji: '🔥' })); await wait(300);
  ws.send(JSON.stringify({ t: 'react', room: '#w2', id: target.id, emoji: '🎉' })); await wait(300);
  console.log('reacted:', JSON.stringify(got.filter((m) => m.t === 'reactions').at(-1).reactions));
} else {
  const rx = target?.reactions;
  const ok = rx && JSON.stringify(rx['🔥']) === '["Bob"]' && JSON.stringify(rx['🎉']) === '["Bob"]';
  console.log((ok ? 'PASS' : 'FAIL') + ' reactions survived the restart -> ' + JSON.stringify(rx));
  process.exit(ok ? 0 : 1);
}
process.exit(0);
