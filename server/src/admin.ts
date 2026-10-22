import type { IncomingMessage, ServerResponse } from 'node:http';
import { validAccount, type AdminStats, type AdminUser, type AuditEntry } from '@qchat/shared';
import {
  accountExists,
  accountForToken,
  countAdmins,
  deleteAccount,
  endSessions,
  getRole,
  setPassword,
  setRole,
  setSuspended,
} from './accounts.js';
import { removeAvatars } from './avatars.js';
import type { ChatServer } from './chat/server.js';
import { getReport, listReports, openReportCount, purgeAccount, resolveReport } from './chat/store.js';
import { db } from './db.js';
import { bearer, readBody, send } from './httpUtil.js';
import { getSettings, saveSettings } from './settings.js';
import { removeUploadFiles } from './uploads.js';

// --- Audit log ---------------------------------------------------------------

function audit(admin: string, action: string, target: string | null = null, detail: string | null = null): void {
  db.prepare('INSERT INTO audit (ts, admin, action, target, detail) VALUES (?,?,?,?,?)')
    .run(Date.now(), admin, action, target, detail);
}

function listAudit(limit: number): AuditEntry[] {
  return db.prepare('SELECT id, ts, admin, action, target, detail FROM audit ORDER BY id DESC LIMIT ?')
    .all(limit) as unknown as AuditEntry[];
}

// --- Queries -----------------------------------------------------------------

function stats(chat: ChatServer): AdminStats {
  const n = (sql: string, ...args: (string | number)[]) =>
    (db.prepare(sql).get(...args) as { n: number }).n;
  const live = chat.stats();
  return {
    members: n('SELECT COUNT(*) AS n FROM accounts'),
    online: live.online,
    rooms: live.rooms,
    videos: live.videos,
    suspended: n('SELECT COUNT(*) AS n FROM accounts WHERE suspended = 1'),
    admins: n("SELECT COUNT(*) AS n FROM accounts WHERE role = 'admin'"),
    newThisWeek: n('SELECT COUNT(*) AS n FROM accounts WHERE createdAt > ?', Date.now() - 7 * 24 * 3600 * 1000),
    openReports: openReportCount(),
  };
}

function listUsers(chat: ChatServer, q: string, limit: number): AdminUser[] {
  const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const rows = db
    .prepare(
      `SELECT a.account, a.email, a.role, a.suspended, a.suspendedReason, a.createdAt, a.lastLogin,
              p.displayName, p.avatar
         FROM accounts a LEFT JOIN profiles p ON p.accountLower = a.accountLower
        WHERE a.account LIKE ? ESCAPE '\\' OR IFNULL(a.email, '') LIKE ? ESCAPE '\\'
        ORDER BY a.createdAt DESC LIMIT ?`,
    )
    .all(like, like, limit) as {
    account: string;
    email: string | null;
    role: 'admin' | 'user';
    suspended: number;
    suspendedReason: string | null;
    createdAt: number;
    lastLogin: number | null;
    displayName: string | null;
    avatar: string | null;
  }[];
  const online = chat.onlineAccounts();
  return rows.map((r) => ({
    account: r.account,
    email: r.email,
    role: r.role,
    suspended: !!r.suspended,
    suspendedReason: r.suspendedReason,
    createdAt: r.createdAt,
    lastLogin: r.lastLogin,
    online: online.has(r.account.toLowerCase()),
    displayName: r.displayName ?? undefined,
    avatar: r.avatar ?? undefined,
  }));
}

// --- Router ------------------------------------------------------------------

/** Handle /api/admin/*. Every route needs an administrator's session token. */
export async function handleAdmin(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  query: string,
  chat: ChatServer,
): Promise<boolean> {
  const method = req.method ?? 'GET';
  const me = accountForToken(bearer(req));
  if (!me) {
    send(res, 401, { error: 'Not logged in.' });
    return true;
  }
  // Re-checked against the database on every request, so a demoted admin loses
  // access immediately.
  if (getRole(me) !== 'admin') {
    send(res, 403, { error: 'Administrators only.' });
    return true;
  }

  const seg = path.split('/').filter(Boolean).slice(2); // after /api/admin
  const params = new URLSearchParams(query);

  if (seg[0] === 'stats' && method === 'GET') {
    send(res, 200, { stats: stats(chat) });
    return true;
  }

  if (seg[0] === 'audit' && method === 'GET') {
    send(res, 200, { entries: listAudit(200) });
    return true;
  }

  if (seg[0] === 'settings') {
    if (method === 'GET') {
      send(res, 200, { settings: getSettings() });
    } else if (method === 'PUT') {
      const before = getSettings();
      const after = saveSettings(await readBody(req));
      const changed = (Object.keys(after) as (keyof typeof after)[]).filter((k) => after[k] !== before[k]);
      if (changed.length) audit(me, 'settings', null, changed.map((k) => `${k}=${String(after[k]).slice(0, 60)}`).join(', '));
      // Turning maintenance on also sends everyone who is not an admin home.
      if (after.maintenance && !before.maintenance) {
        chat.kickNonAdmins('QChat is now down for maintenance. Please try again soon.');
      }
      send(res, 200, { settings: after });
    } else {
      send(res, 405, { error: 'Method not allowed.' });
    }
    return true;
  }

  // --- Reported messages ---
  if (seg[0] === 'reports') {
    if (seg.length === 1 && method === 'GET') {
      const status = params.get('status') === 'all' ? 'all' : 'open';
      send(res, 200, { reports: listReports(status, 200) });
      return true;
    }
    const id = Number(seg[1]);
    if (method === 'POST' && seg[2] === 'resolve' && Number.isInteger(id)) {
      const report = getReport(id);
      if (!report) return deny(res, 'No such report.', 404);
      if (report.status !== 'open') return deny(res, 'That report has already been dealt with.');
      const action = String((await readBody(req)).action ?? '');
      if (action !== 'delete' && action !== 'dismiss' && action !== 'handled') {
        return deny(res, 'Choose delete, dismiss or handled.', 422);
      }
      const resolution = action === 'delete' ? 'deleted' : action === 'dismiss' ? 'dismissed' : 'handled';
      if (action === 'delete') chat.deleteMessageAdmin(report.room, report.messageId, me);
      // Everyone who reported the same message is dealt with together.
      for (const r of listReports('open', 500)) {
        if (r.id === id || r.messageId === report.messageId) resolveReport(r.id, me, resolution);
      }
      audit(me, 'resolve-report', report.author, `${resolution} (report #${id})`);
      send(res, 200, { ok: true });
      return true;
    }
  }

  if (seg[0] === 'announce' && method === 'POST') {
    const b = await readBody(req);
    const text = String(b.text ?? '').trim().slice(0, 500);
    const room = typeof b.room === 'string' && b.room ? b.room : undefined;
    if (!text) {
      send(res, 422, { error: 'Write an announcement first.' });
      return true;
    }
    const reached = chat.announce(text, me, room);
    audit(me, 'announce', room ?? 'everyone', text.slice(0, 120));
    send(res, 200, { ok: true, reached });
    return true;
  }

  // --- Members ---
  if (seg[0] === 'users') {
    if (seg.length === 1 && method === 'GET') {
      const limit = Math.min(200, Math.max(1, Number(params.get('limit')) || 100));
      send(res, 200, { users: listUsers(chat, (params.get('q') ?? '').trim(), limit) });
      return true;
    }

    const target = decodeURIComponent(seg[1] ?? '');
    const action = seg[2];
    if (!validAccount(target) || !accountExists(target)) {
      send(res, 404, { error: 'No such member.' });
      return true;
    }
    const isSelf = target.toLowerCase() === me.toLowerCase();
    const targetRole = getRole(target);

    if (method === 'DELETE' && seg.length === 2) {
      if (isSelf) return deny(res, 'You cannot delete your own account here.');
      if (targetRole === 'admin') return deny(res, 'Remove their admin role before deleting the account.');
      chat.kickAccount(target, 'Your account has been deleted.');
      removeAvatars(target);
      removeUploadFiles(purgeAccount(target));
      deleteAccount(target);
      audit(me, 'delete-member', target);
      send(res, 200, { ok: true });
      return true;
    }

    if (method === 'POST' && action === 'role') {
      const role = (await readBody(req)).role;
      if (role !== 'admin' && role !== 'user') return deny(res, 'Role must be admin or user.', 422);
      if (isSelf) return deny(res, 'You cannot change your own role.');
      if (role === 'user' && targetRole === 'admin' && countAdmins() <= 1) {
        return deny(res, 'There must always be at least one administrator.');
      }
      setRole(target, role);
      audit(me, role === 'admin' ? 'make-admin' : 'remove-admin', target);
      send(res, 200, { ok: true });
      return true;
    }

    if (method === 'POST' && action === 'suspend') {
      const b = await readBody(req);
      const suspended = b.suspended === true;
      const reason = String(b.reason ?? '').trim().slice(0, 200) || null;
      if (isSelf) return deny(res, 'You cannot suspend yourself.');
      if (suspended && targetRole === 'admin') return deny(res, 'Remove their admin role before suspending them.');
      setSuspended(target, suspended, reason);
      if (suspended) {
        chat.kickAccount(target, `This account has been suspended.${reason ? ` Reason: ${reason}` : ''}`);
      }
      audit(me, suspended ? 'suspend' : 'unsuspend', target, suspended ? reason : null);
      send(res, 200, { ok: true });
      return true;
    }

    if (method === 'POST' && action === 'password') {
      const password = String((await readBody(req)).password ?? '');
      if (password.length < 6) return deny(res, 'Password must be at least 6 characters.', 422);
      setPassword(target, password);
      chat.kickAccount(target, 'Your password was changed. Please log in again.');
      audit(me, 'reset-password', target);
      send(res, 200, { ok: true });
      return true;
    }

    if (method === 'POST' && action === 'disconnect') {
      if (isSelf) return deny(res, 'That would disconnect you.');
      const n = chat.kickAccount(target, 'You were disconnected by an administrator.');
      audit(me, 'disconnect', target, `${n} connection(s)`);
      send(res, 200, { ok: true, closed: n });
      return true;
    }

    // Logging someone out everywhere without suspending them.
    if (method === 'POST' && action === 'logout') {
      endSessions(target);
      chat.kickAccount(target, 'You were logged out by an administrator.');
      audit(me, 'force-logout', target);
      send(res, 200, { ok: true });
      return true;
    }
  }

  // --- Rooms ---
  if (seg[0] === 'rooms') {
    if (seg.length === 1 && method === 'GET') {
      send(res, 200, { rooms: chat.adminRooms() });
      return true;
    }
    const room = decodeURIComponent(seg[1] ?? '');
    const action = seg[2];

    if (method === 'POST' && action === 'close') {
      if (!chat.closeRoom(room)) return deny(res, 'No such room.', 404);
      audit(me, 'close-room', room);
      send(res, 200, { ok: true });
      return true;
    }
    if (method === 'POST' && action === 'stopmedia') {
      if (!chat.stopMedia(room, me)) return deny(res, 'Nothing is playing in that room.', 404);
      audit(me, 'stop-video', room);
      send(res, 200, { ok: true });
      return true;
    }
    if (method === 'POST' && action === 'kick') {
      const nick = String((await readBody(req)).nick ?? '');
      if (nick.toLowerCase() === me.toLowerCase()) return deny(res, 'You cannot remove yourself.');
      if (!chat.kickFromRoom(room, nick)) return deny(res, 'They are not in that room.', 404);
      audit(me, 'kick-from-room', nick, room);
      send(res, 200, { ok: true });
      return true;
    }
  }

  send(res, 404, { error: 'Not found.' });
  return true;
}

function deny(res: ServerResponse, error: string, status = 409): true {
  send(res, status, { error });
  return true;
}
