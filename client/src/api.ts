import type { Announcement, MeResponse, Profile, ProfileUpdate } from '@qchat/shared';

async function jsonOrThrow(res: Response): Promise<any> {
  if (!res.ok) {
    let message = res.statusText;
    try {
      message = (await res.json()).error ?? message;
    } catch {
      /* keep statusText */
    }
    throw new Error(message);
  }
  return res.json();
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export async function fetchMe(token: string): Promise<MeResponse> {
  return jsonOrThrow(await fetch('/api/me', { headers: bearer(token) }));
}

export async function fetchProfiles(accounts: string[]): Promise<Profile[]> {
  if (accounts.length === 0) return [];
  const q = encodeURIComponent(accounts.join(','));
  return (await jsonOrThrow(await fetch(`/api/profiles?accounts=${q}`))).profiles;
}

export async function fetchProfile(account: string): Promise<Profile | null> {
  const res = await fetch(`/api/profile/${encodeURIComponent(account)}`);
  if (res.status === 404) return null;
  return (await jsonOrThrow(res)).profile;
}

export async function saveProfile(token: string, patch: ProfileUpdate): Promise<Profile> {
  return (
    await jsonOrThrow(
      await fetch('/api/profile', {
        method: 'PUT',
        headers: { ...bearer(token), 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      }),
    )
  ).profile;
}

export async function uploadAvatar(token: string, file: File): Promise<Profile> {
  return (
    await jsonOrThrow(
      await fetch('/api/avatar', {
        method: 'POST',
        headers: { ...bearer(token), 'content-type': file.type },
        body: file,
      }),
    )
  ).profile;
}

export async function postAnnouncement(token: string, text: string): Promise<Announcement> {
  return (
    await jsonOrThrow(
      await fetch('/api/admin/announce', {
        method: 'POST',
        headers: { ...bearer(token), 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      }),
    )
  ).announcement;
}
