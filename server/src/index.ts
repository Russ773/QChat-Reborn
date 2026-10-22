import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { basename, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { accountForToken, ensureAdmins, isAdmin } from './accounts.js';
import { avatarsDir } from './avatars.js';
import { handleApi } from './api.js';
import { ChatServer } from './chat/server.js';
import { getSettings } from './settings.js';

const HTTP_PORT = Number(process.env.HTTP_PORT ?? 8080);
const log = (msg: string) => console.log(`[qchat] ${new Date().toISOString()} ${msg}`);

for (const name of ensureAdmins()) log(`promoted ${name} to administrator (ADMIN_ACCOUNTS)`);

const chat = new ChatServer(log, {
  resolve: (token) => accountForToken(token),
  welcome: () => getSettings().welcomeMessage,
  maintenance: () => getSettings().maintenance,
  isAdmin: (account) => isAdmin(account),
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
  if (!existsSync(clientDir)) {
    res
      .writeHead(200, { 'content-type': 'text/html' })
      .end('<h1>QChat server running</h1><p>Client not built yet. Run <code>npm run dev</code>.</p>');
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

function serveAvatar(res: ServerResponse, urlPath: string): void {
  const file = normalize(join(avatarsDir, basename(urlPath)));
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

// --- HTTP + WebSocket -----------------------------------------------------
const http = createServer((req, res) => {
  handleHttp(req, res).catch((err) => {
    log(`http error: ${String(err)}`);
    if (!res.headersSent) res.writeHead(500).end('error');
  });
});
const wss = new WebSocketServer({ server: http, path: '/ws' });

wss.on('connection', (ws) => {
  log('ws connection');
  chat.accept(ws);
});

http.listen(HTTP_PORT, () => log(`listening on :${HTTP_PORT} (ws path /ws)`));

function shutdown(): void {
  log('shutting down');
  wss.close();
  http.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
