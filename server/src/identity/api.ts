import type { IncomingMessage, ServerResponse } from 'node:http';
import type { IdentityService } from './identity.js';

/**
 * Internal identity endpoints, called ONLY by the co-located PHP site. Gated by
 * a shared secret header and intended to be reachable on localhost only.
 *   POST /internal/identity/register  { nick, password, email }
 *   POST /internal/identity/verify    { nick, password }        -> { ok }
 *   POST /internal/identity/reset     { nick, password }        (admin set)
 */
export function handleInternalApi(
  req: IncomingMessage,
  res: ServerResponse,
  identity: IdentityService | null,
  secret: string,
): boolean {
  const path = (req.url ?? '/').split('?')[0];
  if (!path.startsWith('/internal/')) return false;

  if (!secret || req.headers['x-internal-secret'] !== secret) {
    sendJson(res, 403, { error: 'forbidden' });
    return true;
  }
  if (!identity) {
    sendJson(res, 503, { error: 'identity bridge unavailable (gateway mode only)' });
    return true;
  }
  route(req, res, identity, path).catch((err) => sendJson(res, 500, { error: (err as Error).message }));
  return true;
}

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  identity: IdentityService,
  path: string,
): Promise<void> {
  if ((req.method ?? 'GET') !== 'POST') {
    return sendJson(res, 405, { error: 'POST only' });
  }
  const body = await readJson(req);
  const nick = String(body.nick ?? '');
  const password = String(body.password ?? '');

  if (path === '/internal/identity/register') {
    const result = await identity.register(nick, password, String(body.email ?? ''));
    return sendJson(res, result.ok ? 200 : 400, result);
  }
  if (path === '/internal/identity/verify') {
    const account = await identity.verify(nick, password);
    return sendJson(res, 200, { ok: account !== null, account });
  }
  if (path === '/internal/identity/reset') {
    const result = await identity.setPassword(nick, password);
    return sendJson(res, result.ok ? 200 : 400, result);
  }
  sendJson(res, 404, { error: 'unknown endpoint' });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readJson(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 64 * 1024) {
        req.destroy();
        resolve({});
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}
