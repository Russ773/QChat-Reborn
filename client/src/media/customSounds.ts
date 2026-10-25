import { useEffect, useState } from 'react';
import { authHeaders, jreq } from '../api.js';

/** A clip a member uploaded. Approved ones are on everyone's soundboard. */
export interface CustomSound {
  id: string;
  name: string;
  emoji: string;
  by: string;
  status: 'pending' | 'approved';
  url: string;
}

let approved: CustomSound[] = [];
let mine: CustomSound[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Fetch the soundboard's extra sounds (and your own, waiting or approved). */
export async function loadCustomSounds(token: string): Promise<void> {
  try {
    const d = await jreq('/api/sounds', { headers: authHeaders(token) });
    approved = d.sounds ?? [];
    mine = d.mine ?? [];
    emit();
  } catch {
    /* the built in sounds still work */
  }
}

export function useCustomSounds(token: string | null): { approved: CustomSound[]; mine: CustomSound[]; reload: () => void } {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  useEffect(() => {
    if (token) void loadCustomSounds(token);
  }, [token]);
  return { approved, mine, reload: () => token && void loadCustomSounds(token) };
}

export async function uploadCustomSound(token: string, file: File, name: string, emoji: string): Promise<CustomSound> {
  const q = new URLSearchParams({ name, emoji });
  const d = await jreq(`/api/sounds?${q.toString()}`, {
    method: 'POST',
    headers: { 'content-type': file.type || 'application/octet-stream', ...authHeaders(token) },
    body: file,
  });
  await loadCustomSounds(token);
  return d.sound;
}

export async function deleteCustomSound(token: string, id: string): Promise<void> {
  await jreq(`/api/sounds/${id}`, { method: 'DELETE', headers: authHeaders(token) });
  await loadCustomSounds(token);
}

const cache = new Map<string, HTMLAudioElement>();

/** Play a member's clip, if it is known. Returns false when we do not have it (yet). */
export function playCustom(id: string): boolean {
  const s = approved.find((a) => a.id === id) ?? mine.find((a) => a.id === id);
  if (!s) return false;
  try {
    let a = cache.get(id);
    if (!a) {
      a = new Audio(s.url);
      a.preload = 'auto';
      cache.set(id, a);
    }
    a.currentTime = 0;
    a.volume = 0.8;
    void a.play().catch(() => undefined);
  } catch {
    /* ignore */
  }
  return true;
}
