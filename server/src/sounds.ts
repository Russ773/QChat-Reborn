/**
 * Soundboard clips that members upload. A clip waits for an administrator to approve it, then everyone's
 * soundboard shows it. Files get random names, are identified by their first bytes (never by what the browser
 * says), and are served only as audio.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir, db } from './db.js';

export const soundsDir = join(dataDir, 'sounds');
mkdirSync(soundsDir, { recursive: true });

/** A short clip: about eight seconds of ordinary quality audio. */
export const MAX_SOUND_BYTES = 160 * 1024;
/** Waiting and approved clips together, per member. */
export const MAX_SOUNDS_PER_MEMBER = 5;
export const SOUND_NAME_RE = /^[a-f0-9]{24}\.(mp3|ogg|wav|m4a|webm)$/;
export const SOUND_MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  webm: 'audio/webm',
};

export type SoundExt = 'mp3' | 'ogg' | 'wav' | 'm4a' | 'webm';

/** What kind of audio a file really is, from its first bytes. Anything else (including video) is refused. */
export function sniffAudio(buf: Buffer): SoundExt | null {
  if (buf.length < 16) return null;
  const head4 = buf.subarray(0, 4).toString('latin1');
  if (head4 === 'OggS') return 'ogg';
  if (head4 === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WAVE') return 'wav';
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp') return 'm4a';
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'webm';
  if (buf.subarray(0, 3).toString('latin1') === 'ID3') return 'mp3';
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return 'mp3';
  return null;
}

export const validSoundName = (s: string): boolean => /^[A-Za-z0-9][A-Za-z0-9 _!'.-]{0,19}$/.test(s);
export const validSoundEmoji = (s: string): boolean =>
  s.length <= 16 && /^\p{Extended_Pictographic}(️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*$/u.test(s);

export interface CustomSound {
  /** What the soundboard calls it: "c" and a number. */
  id: string;
  name: string;
  emoji: string;
  by: string;
  status: 'pending' | 'approved';
  url: string;
  size: number;
  ts: number;
}

interface Row {
  id: number;
  owner: string;
  name: string;
  emoji: string;
  file: string;
  size: number;
  status: 'pending' | 'approved';
  ts: number;
}

const toSound = (r: Row): CustomSound => ({
  id: `c${r.id}`,
  name: r.name,
  emoji: r.emoji,
  by: r.owner,
  status: r.status,
  url: `/sounds/${r.file}`,
  size: r.size,
  ts: r.ts,
});

const SELECT = 'SELECT id, owner, name, emoji, file, size, status, ts FROM custom_sounds';

export const approvedSounds = (): CustomSound[] =>
  (db.prepare(`${SELECT} WHERE status = 'approved' ORDER BY id`).all() as unknown as Row[]).map(toSound);

export const soundsOf = (ownerLower: string): CustomSound[] =>
  (db.prepare(`${SELECT} WHERE ownerLower = ? ORDER BY id`).all(ownerLower) as unknown as Row[]).map(toSound);

export const allSounds = (): CustomSound[] =>
  (db.prepare(`${SELECT} ORDER BY status DESC, id DESC`).all() as unknown as Row[]).map(toSound);

export function getSound(id: number): CustomSound | null {
  const r = db.prepare(`${SELECT} WHERE id = ?`).get(id) as Row | undefined;
  return r ? toSound(r) : null;
}

/** Is this soundboard id one that everyone may play? */
export function isApprovedSound(id: string): boolean {
  const m = /^c(\d{1,9})$/.exec(id);
  return !!m && !!db.prepare("SELECT 1 FROM custom_sounds WHERE id = ? AND status = 'approved'").get(Number(m[1]));
}

export function addSound(owner: string, name: string, emoji: string, buf: Buffer, ext: SoundExt): CustomSound {
  const file = `${randomBytes(12).toString('hex')}.${ext}`;
  writeFileSync(join(soundsDir, file), buf);
  const r = db
    .prepare('INSERT INTO custom_sounds (owner, ownerLower, name, emoji, file, size, status, ts) VALUES (?,?,?,?,?,?,?,?)')
    .run(owner, owner.toLowerCase(), name, emoji, file, buf.length, 'pending', Date.now());
  return getSound(Number(r.lastInsertRowid))!;
}

export function approveSound(id: number): boolean {
  return Number(db.prepare("UPDATE custom_sounds SET status = 'approved' WHERE id = ?").run(id).changes) > 0;
}

function removeFile(url: string): void {
  const name = url.slice('/sounds/'.length);
  if (SOUND_NAME_RE.test(name)) rmSync(join(soundsDir, name), { force: true });
}

export function deleteSound(id: number): boolean {
  const s = getSound(id);
  if (!s) return false;
  db.prepare('DELETE FROM custom_sounds WHERE id = ?').run(id);
  removeFile(s.url);
  return true;
}

/** Remove everything a member uploaded (their account is going). */
export function deleteSoundsOf(ownerLower: string): number {
  const mine = soundsOf(ownerLower);
  for (const s of mine) deleteSound(Number(s.id.slice(1)));
  return mine.length;
}
