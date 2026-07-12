import { mkdirSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import {
  ALLOWED_AVATAR_TYPES,
  PROFILE_LIMITS,
  type ProfileUpdate,
} from '@qchat/shared';
import type { AuthRegistry, AuthSession } from './auth.js';
import type { Store } from './store/store.js';

export interface ApiContext {
  store: Store;
  auth: AuthRegistry;
  /** Directory where avatar files are written (served at /avatars/*). */
  avatarsDir: string;
  /** Broadcast a live announcement to connected clients (gateway mode only). */
  onAnnounce?: (text: string, by: string) => void;
}

const JSON_LIMIT = 16 * 1024;

/**
 * Handle an /api/* request. Returns true if it consumed the request. Identity
 * comes from the `Authorization: Bearer <token>` header, which the gateway
 * minted after SASL — so the API trusts the NickServ-verified account.
 */
export function handleApi(req: IncomingMessage, res: ServerResponse, ctx: ApiContext): boolean {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;
  if (!path.startsWith('/api/')) return false;

  const method = req.method ?? 'GET';
  const session = ctx.auth.resolveHeader(req.headers.authorization);

  route(req, res, ctx, method, path, url, session).catch((err) => {
    sendJson(res, 500, { error: (err as Error).message });
  });
  return true;
}

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ApiContext,
  method: string,
  path: string,
  url: URL,
  session: AuthSession | null,
): Promise<void> {
  // GET /api/me
  if (path === '/api/me' && method === 'GET') {
    if (!session) return sendJson(res, 401, { error: 'not authenticated' });
    return sendJson(res, 200, { account: session.account, roles: session.roles });
  }

  // GET /api/profiles?accounts=a,b,c  (public)
  if (path === '/api/profiles' && method === 'GET') {
    const accounts = (url.searchParams.get('accounts') ?? '').split(',').filter(Boolean).slice(0, 200);
    return sendJson(res, 200, { profiles: ctx.store.getProfiles(accounts) });
  }

  // GET /api/profile/:account  (public)
  if (path.startsWith('/api/profile/') && method === 'GET') {
    const account = decodeURIComponent(path.slice('/api/profile/'.length));
    const profile = ctx.store.getProfile(account);
    return profile
      ? sendJson(res, 200, { profile })
      : sendJson(res, 404, { error: 'no profile' });
  }

  // PUT /api/profile  (own profile)
  if (path === '/api/profile' && method === 'PUT') {
    if (!session) return sendJson(res, 401, { error: 'not authenticated' });
    const body = await readJson(req);
    const patch = sanitizeUpdate(body);
    const profile = ctx.store.updateProfile(session.account, patch);
    return sendJson(res, 200, { profile });
  }

  // POST /api/avatar  (raw image body)
  if (path === '/api/avatar' && method === 'POST') {
    if (!session) return sendJson(res, 401, { error: 'not authenticated' });
    const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    const ext = ALLOWED_AVATAR_TYPES[type];
    if (!ext) return sendJson(res, 415, { error: 'unsupported image type' });
    const data = await readBody(req, PROFILE_LIMITS.avatarBytes);
    if (!data) return sendJson(res, 413, { error: 'avatar too large (max 1 MiB)' });

    const safe = session.account.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    mkdirSync(ctx.avatarsDir, { recursive: true });
    writeFileSync(join(ctx.avatarsDir, safe + ext), data);
    const avatarUrl = `/avatars/${safe}${ext}?v=${Date.now()}`;
    const profile = ctx.store.setAvatar(session.account, avatarUrl);
    return sendJson(res, 200, { profile });
  }

  // GET /api/announcements  (public)
  if (path === '/api/announcements' && method === 'GET') {
    return sendJson(res, 200, { announcements: ctx.store.listAnnouncements() });
  }

  // POST /api/admin/announce  (admin)
  if (path === '/api/admin/announce' && method === 'POST') {
    if (!requireAdmin(res, session)) return;
    const body = await readJson(req);
    const text = String(body?.text ?? '').trim().slice(0, 500);
    if (!text) return sendJson(res, 400, { error: 'empty announcement' });
    const announcement = ctx.store.addAnnouncement(text, session!.account);
    ctx.onAnnounce?.(text, session!.account);
    return sendJson(res, 200, { announcement });
  }

  // POST /api/admin/roles  (admin): { account, roles: string[] }
  if (path === '/api/admin/roles' && method === 'POST') {
    if (!requireAdmin(res, session)) return;
    const body = await readJson(req);
    const account = String(body?.account ?? '').trim();
    const roles = Array.isArray(body?.roles) ? body.roles.map(String).slice(0, 10) : [];
    if (!account) return sendJson(res, 400, { error: 'account required' });
    ctx.store.setRoles(account, roles);
    return sendJson(res, 200, { account, roles });
  }

  sendJson(res, 404, { error: 'unknown endpoint' });
}

function requireAdmin(res: ServerResponse, session: AuthSession | null): session is AuthSession {
  if (!session) {
    sendJson(res, 401, { error: 'not authenticated' });
    return false;
  }
  if (!session.roles.includes('admin')) {
    sendJson(res, 403, { error: 'admin only' });
    return false;
  }
  return true;
}

// --- Validation ------------------------------------------------------------

function clampString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function sanitizeUpdate(body: any): ProfileUpdate {
  const update: ProfileUpdate = {
    displayName: clampString(body?.displayName, PROFILE_LIMITS.displayName),
    bio: clampString(body?.bio, PROFILE_LIMITS.bio),
    pronouns: clampString(body?.pronouns, PROFILE_LIMITS.pronouns),
    status: clampString(body?.status, PROFILE_LIMITS.status),
  };
  if (Array.isArray(body?.links)) {
    update.links = body.links
      .map((l: unknown) => clampString(l, PROFILE_LIMITS.link))
      .filter((l: string | undefined): l is string => Boolean(l))
      .slice(0, PROFILE_LIMITS.links);
  }
  return update;
}

// --- HTTP helpers ----------------------------------------------------------

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(text);
}

/** Read the raw body up to `limit` bytes; returns null if it exceeds the limit. */
function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req: IncomingMessage): Promise<any> {
  const data = await readBody(req, JSON_LIMIT);
  if (!data || data.length === 0) return {};
  try {
    return JSON.parse(data.toString('utf8'));
  } catch {
    return {};
  }
}
