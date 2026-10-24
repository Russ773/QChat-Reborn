import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './db.js';

export const uploadsDir = join(dataDir, 'uploads');
mkdirSync(uploadsDir, { recursive: true });

/** How much picture space one member may use in total. */
export const MAX_UPLOAD_TOTAL = 100 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024; // 3 MiB
/** At most this many uploads per account in this many milliseconds. */
export const UPLOAD_LIMIT = 20;
export const UPLOAD_WINDOW = 10 * 60 * 1000;

/** The shape every stored file name has: 24 random hex characters and a known extension. */
export const UPLOAD_NAME_RE = /^[a-f0-9]{24}\.(png|jpg|gif|webp)$/;

export const UPLOAD_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

/**
 * Work out what a file really is from its first bytes. The browser's claimed
 * type is never trusted, and anything that is not one of these four image
 * formats (so no SVG, no HTML, no scripts) is refused.
 */
export function sniffImage(buf: Buffer): 'png' | 'jpg' | 'gif' | 'webp' | null {
  if (buf.length < 12) return null;
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  const head = buf.subarray(0, 6).toString('latin1');
  if (head === 'GIF87a' || head === 'GIF89a') return 'gif';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

/** Store an image under a random name and return the name. */
export function saveUploadFile(buf: Buffer, ext: string): string {
  const name = `${randomBytes(12).toString('hex')}.${ext}`;
  writeFileSync(join(uploadsDir, name), buf);
  return name;
}

export function removeUploadFiles(names: string[]): void {
  for (const n of names) {
    if (UPLOAD_NAME_RE.test(n)) rmSync(join(uploadsDir, n), { force: true });
  }
}
