import type { IncomingMessage, ServerResponse } from 'node:http';
import { validAccount } from '@qchat/shared';
import { handleAdmin } from './admin.js';
import { accountForToken, createSession, getRole, login, logout, register } from './accounts.js';
import { AVATAR_TYPES, MAX_AVATAR_BYTES, saveAvatar } from './avatars.js';
import type { ChatServer } from './chat/server.js';
import { bearer, readBody, readRawBody, send } from './httpUtil.js';
import { getPrefs, getProfile, publicProfile, saveProfile, savePrefs, setAvatar } from './profiles.js';
import { getSettings } from './settings.js';

/** Handle /api/* routes. Returns true if the request was handled. */
export async function handleApi(req: IncomingMessage, res: ServerResponse, chat: ChatServer): Promise<boolean> {
  const [path, query = ''] = (req.url ?? '').split('?');
  if (!path.startsWith('/api/')) return false;
  const method = req.method ?? 'GET';

  if (path.startsWith('/api/admin/')) return handleAdmin(req, res, path, query, chat);

  // What the login screen needs to know before anyone is logged in.
  if (path === '/api/site' && method === 'GET') {
    const s = getSettings();
    send(res, 200, { registrationOpen: s.registrationOpen, maintenance: s.maintenance });
    return true;
  }

  if (path === '/api/register' && method === 'POST') {
    const b = await readBody(req);
    const r = register(String(b.account ?? ''), String(b.email ?? ''), String(b.password ?? ''));
    if (!r.ok) {
      send(res, r.status ?? 422, { error: r.error });
    } else {
      send(res, 200, {
        token: createSession(r.account!),
        account: r.account,
        role: r.role,
        profile: getProfile(r.account!),
      });
    }
    return true;
  }

  if (path === '/api/login' && method === 'POST') {
    const b = await readBody(req);
    const r = login(String(b.account ?? ''), String(b.password ?? ''));
    if (!r.ok) {
      send(res, r.status ?? 401, { error: r.error });
    } else {
      send(res, 200, {
        token: createSession(r.account!),
        account: r.account,
        role: r.role,
        profile: getProfile(r.account!),
      });
    }
    return true;
  }

  if (path === '/api/logout' && method === 'POST') {
    logout(bearer(req));
    send(res, 200, { ok: true });
    return true;
  }

  if (path === '/api/me' && method === 'GET') {
    const acct = accountForToken(bearer(req));
    if (!acct) {
      send(res, 401, { error: 'Not logged in.' });
    } else if (getSettings().maintenance && getRole(acct) !== 'admin') {
      send(res, 503, { error: 'QChat is down for maintenance. Please try again soon.' });
    } else {
      send(res, 200, { account: acct, role: getRole(acct), profile: getProfile(acct), prefs: getPrefs(acct) });
    }
    return true;
  }

  if (path === '/api/profile' && method === 'GET') {
    const a = (new URLSearchParams(query).get('a') ?? '').trim();
    if (!validAccount(a)) send(res, 404, { error: 'No such user.' });
    else send(res, 200, { profile: publicProfile(a) });
    return true;
  }

  if (path === '/api/preferences' && method === 'PUT') {
    const acct = accountForToken(bearer(req));
    if (!acct) {
      send(res, 401, { error: 'Not logged in.' });
    } else {
      const b = await readBody(req);
      send(res, 200, { ok: true, prefs: savePrefs(acct, b) });
    }
    return true;
  }

  if (path === '/api/avatar' && method === 'POST') {
    const acct = accountForToken(bearer(req));
    if (!acct) {
      send(res, 401, { error: 'Not logged in.' });
      return true;
    }
    const ext = AVATAR_TYPES[String(req.headers['content-type'] ?? '').split(';')[0].trim()];
    if (!ext) {
      send(res, 415, { error: 'Image must be PNG, JPG, WebP or GIF.' });
      return true;
    }
    const buf = await readRawBody(req, MAX_AVATAR_BYTES);
    if (!buf) {
      send(res, 413, { error: 'Image is too large (max 2 MB).' });
    } else if (buf.length === 0) {
      send(res, 422, { error: 'No image received.' });
    } else {
      const url = saveAvatar(acct, ext, buf);
      setAvatar(acct, url);
      send(res, 200, { avatar: url });
    }
    return true;
  }

  if (path === '/api/profile' && method === 'PUT') {
    const acct = accountForToken(bearer(req));
    if (!acct) {
      send(res, 401, { error: 'Not logged in.' });
    } else {
      const b = await readBody(req);
      send(res, 200, { ok: true, profile: saveProfile(acct, b) });
    }
    return true;
  }

  send(res, 404, { error: 'Not found.' });
  return true;
}
