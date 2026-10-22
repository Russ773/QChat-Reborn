import {
  PROFILE_FIELDS,
  defaultPrefs,
  fieldVisible,
  type Profile,
  type ProfileField,
  type ProfilePrefs,
} from '@qchat/shared';
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

export function setAvatar(account: string, url: string): void {
  db.prepare('UPDATE profiles SET avatar = ?, updatedAt = ? WHERE accountLower = ?')
    .run(url, Date.now(), account.toLowerCase());
}

// --- Preferences (visibility + PM + autoplay) -----------------------------

export function getPrefs(account: string): ProfilePrefs {
  const row = db.prepare('SELECT prefs FROM profiles WHERE accountLower = ?').get(account.toLowerCase()) as
    | { prefs?: string }
    | undefined;
  const base = defaultPrefs();
  if (!row?.prefs) return base;
  try {
    const d = JSON.parse(row.prefs) as Partial<ProfilePrefs>;
    return {
      visible: d.visible && typeof d.visible === 'object' ? d.visible : {},
      allowPm: d.allowPm !== false,
      autoplay: d.autoplay !== false,
    };
  } catch {
    return base;
  }
}

export function savePrefs(account: string, patch: Record<string, unknown>): ProfilePrefs {
  const cur = getPrefs(account);
  const visible: Record<string, boolean> = {};
  if (patch.visible && typeof patch.visible === 'object') {
    for (const f of PROFILE_FIELDS) {
      if (f.key === 'displayName') continue;
      visible[f.key as string] = (patch.visible as Record<string, unknown>)[f.key as string] !== false;
    }
  }
  const next: ProfilePrefs = {
    visible: patch.visible && typeof patch.visible === 'object' ? visible : cur.visible,
    allowPm: typeof patch.allowPm === 'boolean' ? patch.allowPm : cur.allowPm,
    autoplay: typeof patch.autoplay === 'boolean' ? patch.autoplay : cur.autoplay,
  };
  db.prepare('UPDATE profiles SET prefs = ?, updatedAt = ? WHERE accountLower = ?')
    .run(JSON.stringify(next), Date.now(), account.toLowerCase());
  return next;
}

/** A profile with the owner's hidden fields stripped, for showing to others. */
export function publicProfile(account: string): Profile | null {
  const p = getProfile(account);
  if (!p) return null;
  const prefs = getPrefs(account);
  const out: Profile = { account: p.account, updatedAt: p.updatedAt };
  if (p.avatar) out.avatar = p.avatar;
  if (p.accent) out.accent = p.accent;
  if (p.displayName) out.displayName = p.displayName;
  for (const f of PROFILE_FIELDS) {
    if (f.key === 'displayName') continue;
    const v = (p as unknown as Record<string, unknown>)[f.key];
    if (v !== undefined && v !== null && fieldVisible(prefs, f.key as string)) {
      (out as unknown as Record<string, unknown>)[f.key] = v;
    }
  }
  return out;
}
