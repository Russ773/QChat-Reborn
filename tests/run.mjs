// Runs QChat's whole test set: it starts a fresh server on a temporary database for each group of
// tests, runs the test files against it (restarting the server between phases where a test needs
// to prove things survive a restart), and prints a summary.
//
//   npm test                    every group
//   node tests/run.mjs core     only the groups you name
//   node tests/run.mjs --list   what the groups are
//   node tests/run.mjs --build  build first, then test
//
// The tests use port 8199 and throwaway data, so they never touch a real QChat database.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8199;
const SUITE_DIR = join(ROOT, 'tests', 'suites');

/** Steps: test(file, ...args) | restart | fresh(env) | sql(statements) | capture(file, name) | $name in args */
const test = (file, ...args) => ({ do: 'test', file, args });
const restart = { do: 'restart' };
const fresh = (env = {}) => ({ do: 'fresh', env });
const sql = (statements) => ({ do: 'sql', statements });
const capture = (file, name) => ({ do: 'capture', file, name });

const RELAXED = { RATE_LIMITS: 'off' }; // most tests make many accounts from one address

const GROUPS = {
  core: {
    about: 'sign in, rooms, messages, private messages, commands, moderation, restore after restart, admin area',
    env: RELAXED,
    steps: [test('chat.mjs', 'a'), restart, test('chat.mjs', 'b'), test('restore.mjs'), test('admin.mjs')],
  },
  social: {
    about: 'reactions, replies, reports, search, pictures, friends, room settings',
    env: RELAXED,
    steps: [test('social.mjs', 'a'), test('react-persist.mjs', 'react'), restart, test('social.mjs', 'b'), test('react-persist.mjs', 'verify')],
  },
  bots: {
    about: 'bots, the built-in QBot, the admin bot controls',
    env: RELAXED,
    steps: [test('bots.mjs', 'a'), restart, test('bots.mjs', 'b')],
  },
  qbot: {
    about: "QBot's welcome and first commands, and installing them on an existing site",
    env: RELAXED,
    steps: [
      test('qbot.mjs', 'a'),
      restart,
      test('qbot.mjs', 'b'),
      sql("DELETE FROM settings WHERE key='qbotGreetSeeded'; DELETE FROM bot_greeted;"),
      test('qbot.mjs', 'c'),
    ],
  },
  features: {
    about: 'change password, server rooms, topics, QBot polls and reminders, TriviaBot',
    env: {
      ...RELAXED,
      TRIVIA_QUESTION_SECONDS: '3',
      TRIVIA_GAP_SECONDS: '0.5',
      QBOT_POLL_SECONDS: '30',
      QBOT_REMIND_MIN_SECONDS: '1',
    },
    steps: [test('features.mjs', 'a'), restart, test('features.mjs', 'b'), restart, test('features.mjs', 'c')],
  },
  presence: {
    about: '"left chat" notices, reloads, several windows',
    env: { ...RELAXED, QCHAT_LEAVE_GRACE_MS: '1000' },
    steps: [test('presence.mjs')],
  },
  media: {
    about: 'finished videos clear for the room',
    env: RELAXED,
    steps: [test('media.mjs')],
  },
  account: {
    about: 'terms and privacy pages, data export, deleting your account, password reset tool, disk housekeeping',
    env: RELAXED,
    steps: [
      test('account.mjs', 'a'),
      // Make the database look like a site that has been running a while: old unused pictures, long
      // conversations, and one member who has used all of their picture space. The server restart that
      // follows runs the housekeeping straight away.
      sql(`
        UPDATE uploads SET ts = 1000 WHERE ownerLower = 'upl';
        INSERT INTO uploads (name, ownerLower, ts, size) VALUES ('quota-filler.png', 'quota', CAST(strftime('%s','now') AS INTEGER) * 1000, 104857600);
        WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 2100)
          INSERT INTO dms (id, fromName, fromLower, toName, toLower, kind, text, ts)
          SELECT 'trim' || i, CASE WHEN i % 2 = 0 THEN 'Ann' ELSE 'Bob' END, CASE WHEN i % 2 = 0 THEN 'ann' ELSE 'bob' END,
                 CASE WHEN i % 2 = 0 THEN 'Bob' ELSE 'Ann' END, CASE WHEN i % 2 = 0 THEN 'bob' ELSE 'ann' END,
                 NULL, 'filler ' || i, 5000 + i FROM n;
      `),
      test('account.mjs', 'b'),
    ],
  },
  security: {
    about: 'headers, passwords, rate limits, sessions, sockets, upgrade from the old session format',
    env: { TRUST_PROXY: '1' }, // rate limits stay ON here: that is what is being tested
    steps: [
      test('security.mjs', 'a'),
      capture('old-sessions-db.mjs', 'OLD'),
      test('security.mjs', 'c', '$OLD'),
      fresh({ SESSION_IDLE_DAYS: '0.0001' }),
      test('security.mjs', 'b'),
    ],
  },
};

// ---------------------------------------------------------------------------------------------

const args = process.argv.slice(2);
if (args.includes('--list')) {
  for (const [name, g] of Object.entries(GROUPS)) console.log(`${name.padEnd(10)} ${g.about}`);
  process.exit(0);
}
if (args.includes('--build')) {
  const r = spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
const wanted = args.filter((a) => !a.startsWith('--'));
const names = wanted.length ? wanted : Object.keys(GROUPS);
for (const n of names) {
  if (!GROUPS[n]) {
    console.error(`No test group called "${n}". Try: node tests/run.mjs --list`);
    process.exit(2);
  }
}
if (!existsSync(join(ROOT, 'server', 'dist', 'index.js'))) {
  console.error('The server is not built yet. Run: npm run build   (or: node tests/run.mjs --build)');
  process.exit(2);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

class TestServer {
  constructor(env) {
    this.env = env;
    this.child = null;
    this.dir = mkdtempSync(join(tmpdir(), 'qchat-test-'));
  }
  async start(extra = {}) {
    this.child = spawn(process.execPath, ['server/dist/index.js'], {
      cwd: ROOT,
      env: { ...process.env, ADMIN_ACCOUNTS: 'Russ', ...this.env, ...extra, QCHAT_DATA_DIR: this.dir, HTTP_PORT: String(PORT) },
      stdio: 'ignore',
    });
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(`http://127.0.0.1:${PORT}/healthz`)).ok) return;
      } catch {
        /* not up yet */
      }
      await wait(250);
    }
    throw new Error('The test server did not start');
  }
  async stop() {
    const c = this.child;
    this.child = null;
    if (!c) return;
    await new Promise((resolveStop) => {
      c.once('exit', resolveStop);
      c.kill();
      setTimeout(resolveStop, 3000);
    });
    await wait(300);
  }
  async restart(extra) {
    await this.stop();
    await this.start(extra);
  }
  /** Fresh empty database. */
  async fresh(extra) {
    await this.stop();
    rmSync(this.dir, { recursive: true, force: true });
    this.dir = mkdtempSync(join(tmpdir(), 'qchat-test-'));
    await this.start(extra);
  }
  cleanup() {
    try {
      rmSync(this.dir, { recursive: true, force: true });
    } catch {
      /* a locked file on Windows is not worth failing over */
    }
  }
}

function runNode(file, fileArgs, env, dir) {
  return new Promise((resolveRun) => {
    const out = [];
    const child = spawn(process.execPath, [join(SUITE_DIR, file), ...fileArgs], {
      cwd: ROOT,
      env: { ...process.env, ...env, QCHAT_DATA_DIR: dir },
    });
    child.stdout.on('data', (d) => out.push(d.toString()));
    child.stderr.on('data', (d) => out.push(d.toString()));
    child.on('close', (code) => resolveRun({ code, text: out.join('') }));
  });
}

const totals = { pass: 0, fail: 0 };
const failures = [];
const started = Date.now();

for (const name of names) {
  const group = GROUPS[name];
  const t0 = Date.now();
  const server = new TestServer(group.env);
  const vars = {};
  let pass = 0;
  let fail = 0;
  process.stdout.write(`\n## ${name}: ${group.about}\n`);
  try {
    await server.start();
    for (const step of group.steps) {
      if (step.do === 'restart') await server.restart();
      else if (step.do === 'fresh') await server.fresh(step.env);
      else if (step.do === 'sql') {
        await server.stop();
        const db = new DatabaseSync(join(server.dir, 'qchat.db'));
        db.exec(step.statements);
        db.close();
        await server.start();
      } else if (step.do === 'capture') {
        await server.stop();
        const r = await runNode(step.file, [server.dir], group.env, server.dir);
        vars[step.name] = r.text.trim().split('\n').pop();
        await server.start();
      } else if (step.do === 'test') {
        const a = step.args.map((x) => (x.startsWith('$') ? vars[x.slice(1)] : x));
        const r = await runNode(step.file, a, { ...group.env, ...(server.env ?? {}) }, server.dir);
        const lines = r.text.split('\n');
        const p = lines.filter((l) => /^PASS /.test(l)).length;
        const f = lines.filter((l) => /^FAIL /.test(l));
        pass += p;
        fail += f.length;
        const label = `${step.file} ${step.args.join(' ')}`.trim();
        console.log(`   ${f.length === 0 && r.code === 0 ? 'ok  ' : 'FAIL'} ${label}: ${p} passed${f.length ? `, ${f.length} failed` : ''}`);
        for (const line of f) {
          console.log(`        ${line}`);
          failures.push(`${name} / ${label}: ${line}`);
        }
        if (r.code !== 0 && f.length === 0) {
          fail += 1;
          console.log('        the test file stopped early:\n' + r.text.split('\n').slice(-8).map((l) => '          ' + l).join('\n'));
          failures.push(`${name} / ${label}: stopped early`);
        }
      }
    }
  } catch (e) {
    fail += 1;
    console.log(`   FAIL ${e.message}`);
    failures.push(`${name}: ${e.message}`);
  } finally {
    await server.stop();
    server.cleanup();
  }
  totals.pass += pass;
  totals.fail += fail;
  console.log(`   ${pass} passed, ${fail} failed (${Math.round((Date.now() - t0) / 1000)}s)`);
}

console.log(`\n==== ${totals.pass} passed, ${totals.fail} failed in ${Math.round((Date.now() - started) / 1000)}s ====`);
if (failures.length) {
  console.log('\nWhat failed:');
  for (const f of failures) console.log('  ' + f);
}
process.exit(totals.fail ? 1 : 0);
