import type { Profile } from '@qchat/shared';

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

async function jreq(url: string, opts?: RequestInit): Promise<any> {
  const r = await fetch(url, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

const authHeaders = (token: string) => ({ authorization: `Bearer ${token}` });
const jsonAuth = (token: string) => ({ 'content-type': 'application/json', ...authHeaders(token) });

export interface AuthResult {
  token: string;
  account: string;
  profile: Profile | null;
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

export function me(token: string): Promise<{ account: string; profile: Profile | null }> {
  return jreq('/api/me', { headers: authHeaders(token) });
}

export function logout(token: string): void {
  fetch('/api/logout', { method: 'POST', headers: authHeaders(token) }).catch(() => {});
}

export function getProfile(account: string): Promise<Profile | null> {
  return jreq(`/api/profile?a=${encodeURIComponent(account)}`).then((d) => d.profile);
}

export function saveProfile(token: string, patch: Partial<Profile>): Promise<Profile> {
  return jreq('/api/profile', {
    method: 'PUT',
    headers: jsonAuth(token),
    body: JSON.stringify(patch),
  }).then((d) => d.profile);
}
