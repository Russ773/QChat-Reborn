import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './db.js';

export const avatarsDir = join(dataDir, 'avatars');
mkdirSync(avatarsDir, { recursive: true });

export const AVATAR_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2 MiB

/** Delete every stored avatar file for an account (used when it is deleted). */
export function removeAvatars(account: string): void {
  const safe = account.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  try {
    for (const f of readdirSync(avatarsDir)) {
      if (f.startsWith(`${safe}.`)) rmSync(join(avatarsDir, f), { force: true });
    }
  } catch {
    /* nothing to remove */
  }
}

/** Write an avatar image and return its public URL (cache-busted). */
export function saveAvatar(account: string, ext: string, data: Buffer): string {
  const safe = account.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  writeFileSync(join(avatarsDir, `${safe}.${ext}`), data);
  return `/avatars/${safe}.${ext}?v=${Date.now()}`;
}
