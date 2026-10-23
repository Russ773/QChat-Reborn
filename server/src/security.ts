import type { IncomingMessage } from 'node:http';

/**
 * Security helpers: who is really calling, how often they may try things, the
 * headers every response carries, and the password rules.
 *
 * Settings come from environment variables so they can be tuned (or relaxed for
 * automated tests) without code changes:
 *   TRUST_PROXY=1            trust X-Forwarded-For / X-Forwarded-Proto (set when behind nginx/Caddy)
 *   RATE_LIMITS=off          switch the rate limits off (tests only, never in production)
 *   ALLOWED_ORIGINS=a,b      extra browser origins allowed to open the WebSocket
 *   SESSION_IDLE_DAYS=30     a login lapses after this long unused
 */

const truthy = (v: string | undefined) => ['1', 'true', 'yes', 'on'].includes((v ?? '').toLowerCase());

export const TRUST_PROXY = truthy(process.env.TRUST_PROXY);
export const RATE_LIMITS_ON = (process.env.RATE_LIMITS ?? 'on').toLowerCase() !== 'off';
export const PRODUCTION = process.env.NODE_ENV === 'production';

// --- Who is calling ---------------------------------------------------------

/**
 * The caller's address. Behind a reverse proxy the socket address is the proxy's, so
 * with TRUST_PROXY we use the last X-Forwarded-For entry, which is the one our own
 * proxy added (earlier entries can be forged by the client).
 */
export function clientIp(req: IncomingMessage): string {
  if (TRUST_PROXY) {
    const xff = req.headers['x-forwarded-for'];
    const list = (Array.isArray(xff) ? xff.join(',') : xff ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (list.length > 0) return list[list.length - 1].slice(0, 64);
  }
  return (req.socket.remoteAddress ?? 'unknown').replace(/^::ffff:/, '');
}

/** True when the browser reached us over HTTPS (directly, or via a trusted proxy). */
export function isSecure(req: IncomingMessage): boolean {
  if ((req.socket as { encrypted?: boolean }).encrypted) return true;
  return TRUST_PROXY && String(req.headers['x-forwarded-proto'] ?? '').split(',').pop()?.trim() === 'https';
}

// --- Rate limits -------------------------------------------------------------

/** Allows `max` hits per `windowMs` for each key. */
export class Limiter {
  private hits = new Map<string, number[]>();

  constructor(
    readonly max: number,
    readonly windowMs: number,
  ) {}

  private fresh(key: string, now: number): number[] {
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length > 0) this.hits.set(key, list);
    else this.hits.delete(key);
    return list;
  }

  /** Milliseconds until another hit would be allowed (0 when it already is). Records nothing. */
  wait(key: string, now = Date.now()): number {
    if (!RATE_LIMITS_ON) return 0;
    const list = this.fresh(key, now);
    return list.length < this.max ? 0 : list[list.length - this.max] + this.windowMs - now;
  }

  /** Record a hit. Returns 0 if it was allowed, or how long to wait if the limit is already used up. */
  hit(key: string, now = Date.now()): number {
    if (!RATE_LIMITS_ON) return 0;
    const wait = this.wait(key, now);
    if (wait > 0) return wait;
    const list = this.fresh(key, now);
    list.push(now);
    this.hits.set(key, list);
    return 0;
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  /** Forget keys with nothing recent in them. */
  sweep(now = Date.now()): void {
    for (const key of [...this.hits.keys()]) this.fresh(key, now);
  }
}

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

/** Wrong passwords: per person at one address, per address overall, and per account overall. */
export const loginFailsByPair = new Limiter(6, 15 * MIN);
export const loginFailsByIp = new Limiter(30, 15 * MIN);
export const loginFailsByAccount = new Limiter(40, HOUR);
/** Wrong "current password" tries on the change-password screen (someone using a stolen login). */
export const passwordChangeFails = new Limiter(5, 15 * MIN);
/** New accounts: per address, and across the whole site. */
export const signupsByIp = new Limiter(5, HOUR);
export const signupsGlobal = new Limiter(200, HOUR);
/** Every API call, per address. */
export const apiByIp = new Limiter(600, MIN);
/** New WebSocket connections per address. */
export const wsOpensByIp = new Limiter(40, MIN);
/** How many WebSocket connections one address may hold open at once. */
export const MAX_WS_PER_IP = RATE_LIMITS_ON ? 60 : 100000;
/** A connection that has not logged in by then is dropped. */
export const WS_LOGIN_TIMEOUT_MS = 15_000;

setInterval(() => {
  for (const l of [loginFailsByPair, loginFailsByIp, loginFailsByAccount, passwordChangeFails, signupsByIp, signupsGlobal, apiByIp, wsOpensByIp]) l.sweep();
}, 5 * MIN).unref();

export function waitMessage(ms: number): string {
  const mins = Math.ceil(ms / MIN);
  return mins <= 1 ? 'Too many attempts. Please wait a minute and try again.' : `Too many attempts. Please wait ${mins} minutes and try again.`;
}

/** Make text safe to put in a log line (no line breaks or control characters, short). */
export const forLog = (s: string, max = 40) => s.replace(/[\u0000-\u001f\u007f]/g, '?').slice(0, max);

// --- Sessions ------------------------------------------------------------------

const idleDays = Number(process.env.SESSION_IDLE_DAYS);
/** A login lapses when it has not been used for this long. */
export const SESSION_IDLE_MS = (Number.isFinite(idleDays) && idleDays > 0 ? idleDays : 30) * 24 * HOUR;
/** ...and never lasts longer than this in total, however often it is used. */
export const SESSION_MAX_MS = Math.max(SESSION_IDLE_MS, 90 * 24 * HOUR);

// --- Browser security headers -----------------------------------------------------

/**
 * What the page may load. Everything is our own, except Google Fonts (the typeface) and
 * the YouTube player. No inline scripts are allowed, so an injected <script> would not run.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://www.youtube.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://i.ytimg.com",
  "media-src 'self' blob: data:",
  "connect-src 'self'",
  "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function securityHeaders(req: IncomingMessage): Record<string, string> {
  const h: Record<string, string> = {
    'content-security-policy': CSP,
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    // The YouTube player needs to know which site embeds it, so send the origin cross-site.
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
  };
  if (isSecure(req)) h['strict-transport-security'] = 'max-age=31536000; includeSubDomains';
  return h;
}

// --- WebSocket origin ----------------------------------------------------------------

const extraOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

/**
 * Browsers always send an Origin header on a WebSocket. Only accept our own site (or
 * ones listed in ALLOWED_ORIGINS), so another website cannot open a socket from a
 * visitor's browser. Tools with no Origin header are let through; they still need a login.
 */
export function originAllowed(origin: string | undefined, req: IncomingMessage): boolean {
  if (!origin) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (extraOrigins.includes(url.origin.toLowerCase())) return true;
  if (url.host.toLowerCase() === String(req.headers.host ?? '').toLowerCase()) return true;
  // Local development (the Vite dev server runs on its own port).
  if (!PRODUCTION && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return true;
  return false;
}

// --- Passwords -------------------------------------------------------------------------

export const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;

const COMMON = new Set(
  [
    'password', 'password1', 'password12', 'password123', '12345678', '123456789', '1234567890', 'qwertyui', 'qwerty123',
    'qwertyuiop', 'iloveyou', 'letmein1', 'welcome1', 'abc12345', 'abcd1234', '11111111', '00000000', 'admin123',
    'administrator', 'football', 'baseball', 'monkey123', 'dragon12', 'sunshine', 'princess', 'trustno1', 'whatever',
    'qchat123', 'qchatqchat', 'chatroom', 'changeme', 'passw0rd', 'p@ssw0rd', '1q2w3e4r', 'zaq12wsx', 'master12',
  ],
);

/** An error message if the password is not acceptable, otherwise null. */
export function passwordProblem(password: string, account = ''): string | null {
  if (password.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters.`;
  if (password.length > MAX_PASSWORD) return `Password must be no more than ${MAX_PASSWORD} characters.`;
  const lower = password.toLowerCase();
  if (account && lower === account.toLowerCase()) return 'Your password cannot be the same as your username.';
  if (COMMON.has(lower) || /^(.)\1+$/.test(password)) return 'That password is too easy to guess. Try something less common.';
  return null;
}
