import { PROFILE_FIELDS, type Profile, type ProfileField } from '@qchat/shared';
import { db } from './db.js';

type DbVal = string | number | null;

function validAccent(v: unknown): string | null {
  const s = String(v ?? '').trim();
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s) ? s : null;
}

function cleanField(f: ProfileField, raw: unknown): DbVal {
  if (f.type === 'number') {
    const n = parseInt(String(raw ?? ''), 10);
    return Number.isFinite(n) && n >= 13 && n <= 120 ? n : null;
  }
  let s = String(raw ?? '').trim();
  if (f.type === 'select') {
    return f.options && s !== '' && f.options.includes(s) ? s : null;
  }
  if (f.max) s = s.slice(0, f.max);
  return s === '' ? null : s;
}

export function getProfile(account: string): Profile | null {
  const row = db.prepare('SELECT * FROM profiles WHERE accountLower = ?').get(account.toLowerCase()) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  const p: Profile = { account: String(row.account), updatedAt: Number(row.updatedAt) || undefined };
  for (const f of PROFILE_FIELDS) {
    const v = row[f.key as string];
    if (v !== null && v !== undefined && v !== '') (p as unknown as Record<string, unknown>)[f.key] = v;
  }
  if (row.avatar) p.avatar = String(row.avatar);
  if (row.accent) p.accent = String(row.accent);
  return p;
}

export function saveProfile(account: string, patch: Record<string, unknown>): Profile | null {
  const sets: string[] = [];
  const vals: DbVal[] = [];
  for (const f of PROFILE_FIELDS) {
    if (!(f.key in patch)) continue;
    sets.push(`${f.key} = ?`);
    vals.push(cleanField(f, patch[f.key as string]));
  }
  if ('accent' in patch) {
    sets.push('accent = ?');
    vals.push(validAccent(patch.accent));
  }
  if (sets.length === 0) return getProfile(account);
  sets.push('updatedAt = ?');
  vals.push(Date.now());
  vals.push(account.toLowerCase());
  db.prepare(`UPDATE profiles SET ${sets.join(', ')} WHERE accountLower = ?`).run(...vals);
  return getProfile(account);
}
