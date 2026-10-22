import type { IncomingMessage, ServerResponse } from 'node:http';

export function send(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

export function bearer(req: IncomingMessage): string | undefined {
  const h = req.headers['authorization'];
  return typeof h === 'string' && h.startsWith('Bearer ') ? h.slice(7) : undefined;
}

export function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
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

/**
 * Read a raw request body. Returns null if it is bigger than `maxBytes`. The
 * excess is read and thrown away (up to a hard cap) so the caller can still send
 * a proper "too big" reply instead of the connection just dropping.
 */
export function readRawBody(req: IncomingMessage, maxBytes: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
        over = true;
        chunks.length = 0;
        if (size > maxBytes * 8) {
          req.destroy(); // someone is just flooding us
          resolve(null);
        }
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(over ? null : Buffer.concat(chunks)));
    req.on('error', () => resolve(null));
  });
}
