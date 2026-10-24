// Checks the deployment kit the way a real server would use it: build the release package, unpack it
// somewhere clean, install the production packages, run it in production mode, check the proxy related
// behaviour, and take and open a backup. Needs bash, tar and internet access (it installs packages).
//
//   node tests/kit.mjs

import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8299;
const fwd = (p) => p.replace(/\\/g, '/');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  -> ' + extra : '')); };
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' && cmd === 'npm', ...opts });

const work = mkdtempSync(join(tmpdir(), 'qchat-kit-'));
const rel = join(work, 'release');
const data = join(work, 'data');
const backups = join(work, 'backups');
mkdirSync(rel);
mkdirSync(data);
let server = null;

try {
  for (const f of ['pack.sh', 'install.sh', 'backup.sh']) {
    const r = run('bash', ['-n', `deploy/${f}`]);
    check(`deploy/${f} has no syntax errors`, r.status === 0, r.stderr);
  }

  const pack = run('bash', ['deploy/pack.sh']);
  const tarball = join(ROOT, 'qchat-release.tar.gz');
  check('the release package builds from scratch', pack.status === 0 && existsSync(tarball), (pack.stderr || '').slice(-300));
  // tar reads "C:" as a machine name, so give it paths without a drive letter.
  const listing = run('tar', ['tzf', 'qchat-release.tar.gz']).stdout ?? '';
  check('it holds the built server and client, and no leftovers from old versions', /server\/dist\/index\.js/.test(listing) && /client\/dist\/index\.html/.test(listing) && !/ircd|gateway/.test(listing));
  check('it is small', listing.split('\n').length < 400);

  copyFileSync(tarball, join(rel, 'package.tar.gz')); // a plain file name, so tar never sees a drive letter
  const un = run('tar', ['xzf', 'package.tar.gz'], { cwd: rel });
  check('it unpacks', un.status === 0 && existsSync(join(rel, 'server', 'dist', 'index.js')), (un.stderr || '').slice(-200));
  if (!existsSync(join(rel, 'server', 'dist', 'index.js'))) throw new Error('The package did not unpack, so the rest cannot run.');
  const ci = run('npm', ['ci', '--omit=dev', '--workspace', 'server', '--workspace', 'shared', '--no-audit', '--no-fund'], { cwd: rel });
  check('only the production packages install', ci.status === 0, (ci.stderr || '').slice(-300));

  // production mode, as a server would run it
  server = spawn(process.execPath, ['dist/index.js'], {
    cwd: join(rel, 'server'),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HTTP_PORT: String(PORT),
      TRUST_PROXY: '1',
      ADMIN_ACCOUNTS: 'Russ',
      ALLOWED_ORIGINS: 'https://qchat.co.uk',
      QCHAT_DATA_DIR: data,
    },
    stdio: 'ignore',
  });
  server.on('error', () => {});
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try { up = (await fetch(`http://127.0.0.1:${PORT}/healthz`)).ok; } catch { await wait(250); }
  }
  check('the release runs in production mode', up);
  const page = await (await fetch(`http://127.0.0.1:${PORT}/`)).text();
  check('and serves the website', /<title>QChat Reborn<\/title>/.test(page));

  const lan = Object.values(networkInterfaces()).flat().find((n) => n && n.family === 'IPv4' && !n.internal);
  if (lan) {
    let reachable = true;
    try { await fetch(`http://${lan.address}:${PORT}/healthz`, { signal: AbortSignal.timeout(3000) }); } catch { reachable = false; }
    check('it listens on this machine only, not on the network', !reachable);
  }

  const kit = spawnSync(process.execPath, [join(ROOT, 'tests', 'suites', 'kit-checks.mjs'), rel], { encoding: 'utf8' });
  for (const line of kit.stdout.split('\n').filter((l) => /^(PASS|FAIL) /.test(l))) {
    console.log(line);
    line.startsWith('PASS') ? pass++ : fail++;
  }

  const bk = run('bash', ['deploy/backup.sh'], { env: { ...process.env, QCHAT_DATA_DIR: fwd(data), BACKUP_DIR: fwd(backups) } });
  const archive = existsSync(backups) ? readdirSync(backups).find((f) => f.endsWith('.tar.gz')) : null;
  check('the backup script takes a backup', bk.status === 0 && !!archive, (bk.stderr || '').slice(-200));
  if (archive) {
    const out = join(work, 'restored');
    mkdirSync(out);
    copyFileSync(join(backups, archive), join(out, 'backup.tar.gz'));
    run('tar', ['xzf', 'backup.tar.gz'], { cwd: out });
    const db = new DatabaseSync(join(out, 'qchat.db'), { readOnly: true });
    check('the backup opens and is intact', db.prepare('PRAGMA integrity_check').get().integrity_check === 'ok');
    check('and contains the accounts', db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n >= 1);
    db.close();
  }
} finally {
  if (server) {
    server.kill();
    await wait(500);
  }
  try { rmSync(work, { recursive: true, force: true }); } catch { /* ignore */ }
  try { rmSync(join(ROOT, 'qchat-release.tar.gz'), { force: true }); } catch { /* ignore */ }
}

console.log(`\nDEPLOYMENT KIT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
