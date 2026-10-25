/**
 * Keeping an eye on the server: a list of recent errors for the admin Health page, and the numbers
 * (memory, disk space, database size) an administrator wants to see before something runs out.
 */
import { readdirSync, statSync, statfsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { HealthInfo } from '@qchat/shared';
import { dataDir, db } from './db.js';

const startedAt = Date.now();
const MAX_KEPT = 200;

export function recordError(kind: string, err: unknown): void {
  const message = (err instanceof Error ? `${err.message}${err.stack ? ` | ${err.stack.split('\n')[1]?.trim() ?? ''}` : ''}` : String(err)).slice(0, 500);
  try {
    db.prepare('INSERT INTO error_log (ts, kind, message) VALUES (?, ?, ?)').run(Date.now(), kind, message);
    db.prepare('DELETE FROM error_log WHERE id <= (SELECT id FROM error_log ORDER BY id DESC LIMIT 1 OFFSET ?)').run(MAX_KEPT);
  } catch {
    /* never let the error log cause another error */
  }
}

/** Write unexpected errors down instead of only losing them in the log. */
export function installErrorHandlers(log: (msg: string) => void): void {
  process.on('uncaughtException', (err) => {
    log(`UNCAUGHT ${String(err)}`);
    recordError('crash', err);
    // The process is in an unknown state; the service manager starts a fresh one in a few seconds.
    process.exit(1);
  });
  process.on('unhandledRejection', (err) => {
    log(`unhandled rejection ${String(err)}`);
    recordError('rejection', err);
  });
}

export function recentErrors(limit = 30): HealthInfo['errors'] {
  return db.prepare('SELECT id, ts, kind, message FROM error_log ORDER BY id DESC LIMIT ?').all(limit) as unknown as HealthInfo['errors'];
}

/** The database answers a simple question. Used by /healthz so an outside monitor catches a broken database. */
export function databaseOk(): boolean {
  try {
    return (db.prepare('SELECT 1 AS ok').get() as { ok: number }).ok === 1;
  } catch {
    return false;
  }
}

const mb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;

const version = (() => {
  try {
    return (createRequire(import.meta.url)('../package.json') as { version?: string }).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
})();

function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

export function healthSnapshot(online: number): HealthInfo {
  let diskFreeMb: number | null = null;
  let diskTotalMb: number | null = null;
  try {
    const s = statfsSync(dataDir);
    diskFreeMb = mb(Number(s.bavail) * Number(s.bsize));
    diskTotalMb = mb(Number(s.blocks) * Number(s.bsize));
  } catch {
    /* not available on this platform */
  }
  let uploadsMb = 0;
  try {
    uploadsMb = mb((db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM uploads').get() as { n: number }).n);
  } catch {
    /* ignore */
  }
  let avatarsMb = 0;
  try {
    const dir = join(dataDir, 'avatars');
    avatarsMb = mb(readdirSync(dir).reduce((sum, f) => sum + fileSize(join(dir, f)), 0));
  } catch {
    /* no avatars yet */
  }
  const dbBytes = ['qchat.db', 'qchat.db-wal'].reduce((sum, f) => sum + fileSize(join(dataDir, f)), 0);
  const hourAgo = Date.now() - 3600_000;
  return {
    startedAt,
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    version,
    node: process.version,
    memoryMb: mb(process.memoryUsage().rss),
    dbMb: mb(dbBytes),
    picturesMb: uploadsMb + avatarsMb,
    diskFreeMb,
    diskTotalMb,
    online,
    errors: recentErrors(30),
    errorsLastHour: (db.prepare('SELECT COUNT(*) AS n FROM error_log WHERE ts > ?').get(hourAgo) as { n: number }).n,
  };
}
