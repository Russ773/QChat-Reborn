import type { Profile, ProfilePrefs } from '@qchat/shared';

const TOKEN_KEY = 'qchat_token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export async function jreq(url: string, opts?: RequestInit): Promise<any> {
  const r = await fetch(url, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

export const authHeaders = (token: string) => ({ authorization: `Bearer ${token}` });
export const jsonAuth = (token: string) => ({ 'content-type': 'application/json', ...authHeaders(token) });

export type Role = 'admin' | 'user';

export interface AuthResult {
  token: string;
  account: string;
  role: Role;
  profile: Profile | null;
}

/** What the login screen needs to know before anyone is logged in. */
export interface SiteStatus {
  registrationOpen: boolean;
  maintenance: boolean;
}

export function siteStatus(): Promise<SiteStatus> {
  return jreq('/api/site');
}

export function register(account: string, email: string, password: string): Promise<AuthResult> {
  return jreq('/api/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ account, email, password }),
  });
}

export function login(account: string, password: string): Promise<AuthResult> {
  return jreq('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ account, password }),
  });
}

export function me(
  token: string,
): Promise<{ account: string; role: Role; profile: Profile | null; prefs: ProfilePrefs }> {
  return jreq('/api/me', { headers: authHeaders(token) });
}

export function savePreferences(token: string, patch: Partial<ProfilePrefs>): Promise<ProfilePrefs> {
  return jreq('/api/preferences', {
    method: 'PUT',
    headers: jsonAuth(token),
    body: JSON.stringify(patch),
  }).then((d) => d.prefs);
}

export function uploadAvatar(token: string, file: File): Promise<string> {
  return jreq('/api/avatar', {
    method: 'POST',
    headers: { 'content-type': file.type, ...authHeaders(token) },
    body: file,
  }).then((d) => d.avatar);
}

/** Upload a picture to share in a room. Returns the stored file name. */
export function uploadImage(token: string, file: Blob): Promise<{ name: string; url: string }> {
  return jreq('/api/upload', {
    method: 'POST',
    headers: { 'content-type': file.type || 'application/octet-stream', ...authHeaders(token) },
    body: file,
  });
}

/** Change your own password. Resolves when it worked, rejects with a readable message when not. */
export async function changePassword(token: string, current: string, next: string): Promise<void> {
  await jreq('/api/password', { method: 'POST', headers: jsonAuth(token), body: JSON.stringify({ current, next }) });
}

export function logout(token: string): void {
  fetch('/api/logout', { method: 'POST', headers: authHeaders(token) }).catch(() => {});
}

/** A member's public profile (null if there is no such member) and whether they take private messages. */
export function getProfile(account: string): Promise<{ profile: Profile | null; allowPm: boolean }> {
  return jreq(`/api/profile?a=${encodeURIComponent(account)}`).then((d) => ({
    profile: d.profile ?? null,
    allowPm: d.allowPm !== false,
  }));
}

export function saveProfile(token: string, patch: Partial<Profile>): Promise<Profile> {
  return jreq('/api/profile', {
    method: 'PUT',
    headers: jsonAuth(token),
    body: JSON.stringify(patch),
  }).then((d) => d.profile);
}
