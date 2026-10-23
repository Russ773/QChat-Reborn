import type { IncomingMessage, ServerResponse } from 'node:http';
import { validAccount } from '@qchat/shared';
import { handleAdmin } from './admin.js';
import { accountForToken, changePassword, createSession, getRole, login, logout, register } from './accounts.js';
import { AVATAR_TYPES, MAX_AVATAR_BYTES, saveAvatar } from './avatars.js';
import type { ChatServer } from './chat/server.js';
import * as store from './chat/store.js';
import { bearer, readBody, readRawBody, send } from './httpUtil.js';
import { MAX_UPLOAD_BYTES, UPLOAD_LIMIT, UPLOAD_WINDOW, saveUploadFile, sniffImage } from './uploads.js';
import { getPrefs, getProfile, publicProfile, saveProfile, savePrefs, setAvatar } from './profiles.js';
import { getSettings } from './settings.js';
import {
  apiByIp,
  clientIp,
  forLog,
  loginFailsByAccount,
  loginFailsByIp,
  loginFailsByPair,
  passwordChangeFails,
  signupsByIp,
  signupsGlobal,
  waitMessage,
} from './security.js';

/** Refuse a request politely when someone has tried too often. */
function tooMany(res: ServerResponse, waitMs: number): true {
  res.setHeader('retry-after', String(Math.max(1, Math.ceil(waitMs / 1000))));
  send(res, 429, { error: waitMessage(waitMs) });
  return true;
}

/** Handle /api/* routes. Returns true if the request was handled. */
export async function handleApi(req: IncomingMessage, res: ServerResponse, chat: ChatServer): Promise<boolean> {
  const [path, query = ''] = (req.url ?? '').split('?');
  if (!path.startsWith('/api/')) return false;
  const method = req.method ?? 'GET';
  const ip = clientIp(req);

  // One address cannot hammer the API, and nothing here should ever be cached by a browser or proxy.
  const apiWait = apiByIp.hit(ip);
  if (apiWait > 0) return tooMany(res, apiWait);
  res.setHeader('cache-control', 'no-store');

  if (path.startsWith('/api/admin/')) return handleAdmin(req, res, path, query, chat);

  // What the login screen needs to know before anyone is logged in.
  if (path === '/api/site' && method === 'GET') {
    const s = getSettings();
    send(res, 200, { registrationOpen: s.registrationOpen, maintenance: s.maintenance });
    return true;
  }

  if (path === '/api/register' && method === 'POST') {
    const wait = Math.max(signupsByIp.wait(ip), signupsGlobal.wait('site'));
    if (wait > 0) return tooMany(res, wait);
    const b = await readBody(req);
    const r = register(String(b.account ?? ''), String(b.email ?? ''), String(b.password ?? ''));
    if (!r.ok) {
      send(res, r.status ?? 422, { error: r.error });
    } else {
      signupsByIp.hit(ip);
      signupsGlobal.hit('site');
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
    const name = String(b.account ?? '').trim().toLowerCase().slice(0, 40);
    const pair = `${ip}|${name}`;
    // Guessing passwords is slowed down per person at one address, per address, and per account.
    const wait = Math.max(loginFailsByPair.wait(pair), loginFailsByIp.wait(ip), loginFailsByAccount.wait(name));
    if (wait > 0) {
      console.log(`[qchat] login blocked (too many failures) for "${forLog(name)}" from ${forLog(ip)}`);
      return tooMany(res, wait);
    }
    const r = login(String(b.account ?? ''), String(b.password ?? ''));
    if (!r.ok && r.status === 401) {
      loginFailsByPair.hit(pair);
      loginFailsByIp.hit(ip);
      loginFailsByAccount.hit(name);
      console.log(`[qchat] failed login for "${forLog(name)}" from ${forLog(ip)}`);
    }
    if (r.ok) loginFailsByPair.reset(pair);
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

  if (path === '/api/password' && method === 'POST') {
    const token = bearer(req);
    const acct = accountForToken(token);
    if (!acct) {
      send(res, 401, { error: 'Not logged in.' });
      return true;
    }
    const key = acct.toLowerCase();
    const wait = passwordChangeFails.wait(key);
    if (wait > 0) return tooMany(res, wait);
    const b = await readBody(req);
    const r = changePassword(acct, String(b.current ?? ''), String(b.next ?? ''), token);
    if (!r.ok) {
      if (r.status === 403) {
        passwordChangeFails.hit(key);
        console.log(`[qchat] wrong current password on a password change for "${forLog(acct)}" from ${forLog(ip)}`);
      }
      send(res, r.status, { error: r.error });
    } else {
      passwordChangeFails.reset(key);
      console.log(`[qchat] ${forLog(acct)} changed their password`);
      send(res, 200, { ok: true });
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
    else send(res, 200, { profile: publicProfile(a), allowPm: getPrefs(a).allowPm });
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

  if (path === '/api/upload' && method === 'POST') {
    const acct = accountForToken(bearer(req));
    if (!acct) {
      send(res, 401, { error: 'Not logged in.' });
      return true;
    }
    if (store.countUploadsSince(acct.toLowerCase(), Date.now() - UPLOAD_WINDOW) >= UPLOAD_LIMIT) {
      send(res, 429, { error: 'You are uploading too quickly. Wait a few minutes and try again.' });
      return true;
    }
    const buf = await readRawBody(req, MAX_UPLOAD_BYTES);
    if (!buf) {
      send(res, 413, { error: 'That picture is too big (the limit is 3 MB).' });
      return true;
    }
    const ext = sniffImage(buf);
    if (!ext) {
      send(res, 415, { error: 'Only PNG, JPG, GIF and WebP pictures can be shared.' });
      return true;
    }
    const name = saveUploadFile(buf, ext);
    store.addUpload(name, acct.toLowerCase(), buf.length);
    send(res, 200, { name, url: `/uploads/${name}` });
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
