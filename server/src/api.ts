import type { IncomingMessage, ServerResponse } from 'node:http';
import { validAccount } from '@qchat/shared';
import { accountForToken, createSession, login, logout, register } from './accounts.js';
import { getProfile, saveProfile } from './profiles.js';

function send(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function bearer(req: IncomingMessage): string | undefined {
  const h = req.headers['authorization'];
  return typeof h === 'string' && h.startsWith('Bearer ') ? h.slice(7) : undefined;
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let data = '';
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 100_000) {
        req.destroy();
        resolve({});
        return;
      }
      data += c;
    });
    req.on('end', () => {
      try {
        const parsed = data ? JSON.parse(data) : {};
        resolve(parsed && typeof parsed === 'object' ? parsed : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

/** Handle /api/* routes. Returns true if the request was handled. */
export async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const [path, query = ''] = (req.url ?? '').split('?');
  if (!path.startsWith('/api/')) return false;
  const method = req.method ?? 'GET';

  if (path === '/api/register' && method === 'POST') {
    const b = await readBody(req);
    const r = register(String(b.account ?? ''), String(b.email ?? ''), String(b.password ?? ''));
    if (!r.ok) {
      send(res, 422, { error: r.error });
    } else {
      send(res, 200, { token: createSession(r.account!), account: r.account, profile: getProfile(r.account!) });
    }
    return true;
  }

  if (path === '/api/login' && method === 'POST') {
    const b = await readBody(req);
    const acct = login(String(b.account ?? ''), String(b.password ?? ''));
    if (!acct) send(res, 401, { error: 'Wrong username or password.' });
    else send(res, 200, { token: createSession(acct), account: acct, profile: getProfile(acct) });
    return true;
  }

  if (path === '/api/logout' && method === 'POST') {
    logout(bearer(req));
    send(res, 200, { ok: true });
    return true;
  }

  if (path === '/api/me' && method === 'GET') {
    const acct = accountForToken(bearer(req));
    if (!acct) send(res, 401, { error: 'Not logged in.' });
    else send(res, 200, { account: acct, profile: getProfile(acct) });
    return true;
  }

  if (path === '/api/profile' && method === 'GET') {
    const a = (new URLSearchParams(query).get('a') ?? '').trim();
    if (!validAccount(a)) send(res, 404, { error: 'No such user.' });
    else send(res, 200, { profile: getProfile(a) });
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
