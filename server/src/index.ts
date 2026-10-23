import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { basename, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { accountForToken, ensureAdmins, isAdmin, lookupAccount, pruneSessions } from './accounts.js';
import { avatarsDir } from './avatars.js';
import { handleApi } from './api.js';
import { ChatServer } from './chat/server.js';
import { getPrefs } from './profiles.js';
import { MAX_WS_PER_IP, clientIp, originAllowed, securityHeaders, wsOpensByIp } from './security.js';
import { getSettings } from './settings.js';
import { UPLOAD_MIME, UPLOAD_NAME_RE, uploadsDir } from './uploads.js';

const HTTP_PORT = Number(process.env.HTTP_PORT ?? 8080);
// In production the app sits behind a reverse proxy, so it listens on this machine only. Otherwise
// visitors could reach it directly and skip the proxy (and forge the address the limits rely on).
const HOST = process.env.HOST ?? (process.env.NODE_ENV === 'production' ? '127.0.0.1' : undefined);
const log = (msg: string) => console.log(`[qchat] ${new Date().toISOString()} ${msg}`);

for (const name of ensureAdmins()) log(`promoted ${name} to administrator (ADMIN_ACCOUNTS)`);

const chat = new ChatServer(log, {
  resolve: (token) => accountForToken(token),
  welcome: () => getSettings().welcomeMessage,
  maintenance: () => getSettings().maintenance,
  isAdmin: (account) => isAdmin(account),
  lookup: (name) => lookupAccount(name),
  allowsPm: (account) => getPrefs(account).allowPm,
  qbot: () => ({ welcome: getSettings().qbotWelcome, commands: getSettings().qbotCommands }),
});

// --- Static client --------------------------------------------------------
const serverRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const clientDir = resolve(serverRoot, '../client/dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

async function handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Every response, including errors, carries the browser security headers. A route that
  // sets one of these itself (the uploads, which need a stricter policy) simply overrides it.
  for (const [name, value] of Object.entries(securityHeaders(req))) res.setHeader(name, value);
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    return;
  }
  if (await handleApi(req, res, chat)) return;
  const reqPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
  if (reqPath.startsWith('/avatars/')) {
    serveAvatar(res, reqPath);
    return;
  }
  if (reqPath.startsWith('/uploads/')) {
    serveUpload(res, reqPath);
    return;
  }
  if (!existsSync(clientDir)) {
    res
      .writeHead(200, { 'content-type': 'text/html' })
      .end('<h1>QChat server running</h1><p>Client not built yet. Run <code>npm run dev</code>.</p>');
    return;
  }
  const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let filePath = normalize(join(clientDir, urlPath));
  if (filePath !== clientDir && !filePath.startsWith(clientDir + sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(clientDir, 'index.html'); // SPA fallback
  }
  res.writeHead(200, {
    'content-type': MIME[extname(filePath)] ?? 'application/octet-stream',
    // Built files have a fingerprint in their name, so they can be kept for good; the page itself must be re-checked.
    'cache-control': filePath.startsWith(join(clientDir, 'assets') + sep) ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(filePath).pipe(res);
}

function serveAvatar(res: ServerResponse, urlPath: string): void {
  const file = normalize(join(avatarsDir, basename(urlPath)));
  if (!file.startsWith(avatarsDir + sep) || !existsSync(file)) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'cache-control': 'public, max-age=3600',
  });
  createReadStream(file).pipe(res);
}

/** Shared pictures. Only names we generated are served, and only as the image type they really are. */
function serveUpload(res: ServerResponse, urlPath: string): void {
  const name = urlPath.slice('/uploads/'.length);
  const file = join(uploadsDir, name);
  if (!UPLOAD_NAME_RE.test(name) || !existsSync(file)) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, {
    'content-type': UPLOAD_MIME[extname(name).slice(1)] ?? 'application/octet-stream',
    'cache-control': 'public, max-age=31536000, immutable',
    // Never let a browser guess a different type, and never run anything from here.
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
  });
  createReadStream(file).pipe(res);
}

// --- HTTP + WebSocket -----------------------------------------------------
const http = createServer((req, res) => {
  handleHttp(req, res).catch((err) => {
    log(`http error: ${String(err)}`);
    if (!res.headersSent) res.writeHead(500).end('error');
  });
});
// A chat message is at most 2000 characters; 16 KB leaves plenty of room for the
// envelope and refuses anything absurd before it is parsed.
const wss = new WebSocketServer({
  server: http,
  path: '/ws',
  maxPayload: 16 * 1024,
  // Only our own pages may open a socket from a browser.
  verifyClient: (info, done) => {
    const ok = originAllowed(info.origin, info.req);
    if (!ok) log(`ws refused: origin ${info.origin ?? '(none)'} not allowed`);
    done(ok, 403, 'Forbidden');
  },
});

const openByIp = new Map<string, number>();

wss.on('connection', (ws, req) => {
  const ip = clientIp(req);
  // One address cannot open sockets without end.
  const open = openByIp.get(ip) ?? 0;
  if (open >= MAX_WS_PER_IP || wsOpensByIp.hit(ip) > 0) {
    log(`ws refused: too many connections from ${ip}`);
    ws.close(1013, 'Too many connections');
    return;
  }
  openByIp.set(ip, open + 1);
  ws.on('close', () => {
    const left = (openByIp.get(ip) ?? 1) - 1;
    if (left > 0) openByIp.set(ip, left);
    else openByIp.delete(ip);
  });
  chat.accept(ws);
});

// Logins that nobody has used for a long time lapse.
const prune = () => {
  const n = pruneSessions();
  if (n > 0) log(`removed ${n} lapsed login(s)`);
};
prune();
setInterval(prune, 3600 * 1000).unref();

const onListening = () => log(`listening on ${HOST ?? 'all interfaces'}:${HTTP_PORT} (ws path /ws)`);
if (HOST) http.listen(HTTP_PORT, HOST, onListening);
else http.listen(HTTP_PORT, onListening);

function shutdown(): void {
  log('shutting down');
  wss.close();
  http.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
