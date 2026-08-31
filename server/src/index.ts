import { createReadStream, existsSync, statSync } from 'node:fs';
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { basename, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { handleApi, type ApiContext } from './api.js';
import { AuthRegistry } from './auth.js';
import { IrcGateway } from './gateway/gateway.js';
import { BotPresence } from './identity/bot.js';
import { handleInternalApi } from './identity/api.js';
import { IdentityService } from './identity/identity.js';
import { TcpConnection, WsConnection } from './ircd/connection.js';
import { IrcServer } from './ircd/server.js';
import { Store } from './store/store.js';

const HTTP_PORT = Number(process.env.HTTP_PORT ?? 8080);
const TCP_PORT = Number(process.env.IRC_TCP_PORT ?? 6667);
const SERVER_NAME = process.env.IRC_SERVER_NAME ?? 'qchat.local';

// Gateway mode is enabled by pointing at an upstream IRCd.
const UPSTREAM_HOST = process.env.IRC_UPSTREAM_HOST;
const gatewayMode = Boolean(UPSTREAM_HOST);

const log = (msg: string) => console.log(`[qchat] ${new Date().toISOString()} ${msg}`);

// --- Persistence + auth (both modes) ----------------------------------------
const serverRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const dataDir = process.env.QCHAT_DATA_DIR ?? join(serverRoot, 'data');
const avatarsDir = join(dataDir, 'avatars');
const adminAccounts = (process.env.ADMIN_ACCOUNTS ?? 'Russ')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const store = new Store(join(dataDir, 'qchat.json'), adminAccounts);
const auth = new AuthRegistry();

// Dev-only test hook: pre-mint a token (admin) so the API can be exercised
// without a real SASL login. Never set QCHAT_DEV_TOKEN in production.
if (process.env.QCHAT_DEV_TOKEN) {
  const devAccount = process.env.QCHAT_DEV_ACCOUNT ?? 'devadmin';
  store.setRoles(devAccount, ['admin']);
  auth.put(process.env.QCHAT_DEV_TOKEN, { account: devAccount, roles: ['admin'] });
  log(`DEV token active for account "${devAccount}" (admin) — do not use in production`);
}

// Shared secret guarding the internal identity API (PHP -> gateway).
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET ?? '';

// --- Choose backend: bundled ircd (dev) or gateway to a real IRCd (prod) ----
let acceptWs: (ws: import('ws').WebSocket, req: IncomingMessage) => void;
let gatewayRef: IrcGateway | null = null;
let identityRef: IdentityService | null = null;

if (gatewayMode) {
  const upstreamOpts = {
    host: UPSTREAM_HOST!,
    port: Number(process.env.IRC_UPSTREAM_PORT ?? 6667),
    tls: process.env.IRC_UPSTREAM_TLS === '1',
    rejectUnauthorized: process.env.IRC_UPSTREAM_TLS_REJECT_UNAUTHORIZED !== '0',
  };
  const gateway = new IrcGateway(
    {
      ...upstreamOpts,
      serverName: SERVER_NAME,
      webircPassword: process.env.WEBIRC_PASSWORD || undefined,
      webircName: process.env.WEBIRC_NAME ?? 'qchat',
    },
    store,
    auth,
    log,
  );
  gatewayRef = gateway;

  // Identity bridge for the PHP site (register / verify / reset via NickServ),
  // plus a persistent bot presence that stays in the userlist.
  if (process.env.BOT_ACCOUNT && process.env.BOT_PASSWORD) {
    const botAccount = process.env.BOT_ACCOUNT;
    const botPassword = process.env.BOT_PASSWORD;
    identityRef = new IdentityService({ ...upstreamOpts, botAccount, botPassword }, log);
    log('identity bridge: enabled');

    const botChannels = (process.env.BOT_CHANNELS ?? '#General')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const bot = new BotPresence(
      {
        ...upstreamOpts,
        account: botAccount,
        password: botPassword,
        nick: process.env.BOT_NICK ?? botAccount,
        channels: botChannels,
        own: process.env.BOT_OWN_CHANNELS === '1',
        coowners: (process.env.BOT_COOWNERS ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      },
      log,
    );
    bot.start();
    log(`bot presence: ${botAccount} joining ${botChannels.join(', ')}`);
  } else {
    log('identity bridge: disabled (set BOT_ACCOUNT / BOT_PASSWORD to enable)');
  }

  acceptWs = (ws, req) => gateway.accept(new WsConnection(ws, clientIp(req)), clientIp(req));
  log(
    `mode: GATEWAY -> ${UPSTREAM_HOST}:${process.env.IRC_UPSTREAM_PORT ?? 6667}` +
      (process.env.IRC_UPSTREAM_TLS === '1' ? ' (TLS)' : ''),
  );
} else {
  const ircServer = new IrcServer(SERVER_NAME, log);
  acceptWs = (ws, req) => ircServer.accept(new WsConnection(ws, clientIp(req)));

  const tcp = createTcpServer((socket) => {
    log(`tcp connection from ${socket.remoteAddress}`);
    ircServer.accept(new TcpConnection(socket));
  });
  tcp.listen(TCP_PORT, () => log(`IRC (TCP) listening on :${TCP_PORT}`));
  log('mode: BUNDLED ircd');
}

const apiCtx: ApiContext = {
  store,
  auth,
  avatarsDir,
  onAnnounce: (text, by) => gatewayRef?.broadcastAnnouncement(text, by),
};

/** Best-effort real client IP, honoring a reverse proxy's X-Forwarded-For. */
function clientIp(req: IncomingMessage): string {
  const xff = req.headers['x-forwarded-for'];
  const raw =
    (typeof xff === 'string' && xff.split(',')[0].trim()) ||
    req.socket.remoteAddress ||
    '0.0.0.0';
  return raw.replace(/^::ffff:/, ''); // unwrap IPv4-mapped IPv6
}

// --- HTTP: /api, /avatars, then static client -------------------------------
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

function handleHttp(req: IncomingMessage, res: ServerResponse): void {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    return;
  }
  if (handleInternalApi(req, res, identityRef, INTERNAL_API_SECRET)) return;
  if (handleApi(req, res, apiCtx)) return;

  const urlPath = (req.url ?? '/').split('?')[0];
  if (urlPath.startsWith('/avatars/')) {
    serveAvatar(res, urlPath);
    return;
  }
  serveStatic(req, res);
}

function serveAvatar(res: ServerResponse, urlPath: string): void {
  const name = basename(decodeURIComponent(urlPath));
  const file = normalize(join(avatarsDir, name));
  if (!file.startsWith(avatarsDir) || !existsSync(file)) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'cache-control': 'public, max-age=3600',
  });
  createReadStream(file).pipe(res);
}

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  if (!existsSync(clientDir)) {
    res.writeHead(200, { 'content-type': 'text/html' }).end(
      '<h1>QChat server running</h1><p>Client not built yet. Run <code>npm run dev</code> and open the Vite dev server.</p>',
    );
    return;
  }
  const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let filePath = normalize(join(clientDir, urlPath));
  if (!filePath.startsWith(clientDir)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(clientDir, 'index.html'); // SPA fallback
  }
  res.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream' });
  createReadStream(filePath).pipe(res);
}

const http = createHttpServer(handleHttp);

const wss = new WebSocketServer({ server: http, path: '/irc' });
wss.on('connection', (ws, req) => {
  log(`ws connection from ${clientIp(req)}`);
  acceptWs(ws, req);
});

http.listen(HTTP_PORT, () => {
  log(`HTTP + WebSocket listening on :${HTTP_PORT} (ws path /irc)`);
});

// --- Graceful shutdown ------------------------------------------------------
function shutdown(): void {
  log('shutting down');
  wss.close();
  http.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
