import { useCallback, useRef, useState } from 'react';
import type { Profile } from '@qchat/shared';
import { fetchProfiles } from './api.js';

/**
 * Shared, cached profile lookup keyed by name (account, or nick when the two
 * match — the common case since users log in with their account name).
 * Batch-fetches missing entries and never re-requests a name twice.
 */
export function useProfiles() {
  const [cache, setCache] = useState<Record<string, Profile | null>>({});
  const known = useRef<Set<string>>(new Set());

  const load = useCallback((names: string[]) => {
    const missing = names.map((n) => n.toLowerCase()).filter((n) => n && !known.current.has(n));
    if (missing.length === 0) return;
    missing.forEach((n) => known.current.add(n));
    fetchProfiles(missing)
      .then((profiles) => {
        setCache((prev) => {
          const next = { ...prev };
          for (const n of missing) if (!(n in next)) next[n] = null;
          for (const p of profiles) next[p.account.toLowerCase()] = p;
          return next;
        });
      })
      .catch(() => missing.forEach((n) => known.current.delete(n)));
  }, []);

  const get = (name: string): Profile | null => cache[name.toLowerCase()] ?? null;

  const set = useCallback((profile: Profile) => {
    known.current.add(profile.account.toLowerCase());
    setCache((prev) => ({ ...prev, [profile.account.toLowerCase()]: profile }));
  }, []);

  return { load, get, set };
}

export type Profiles = ReturnType<typeof useProfiles>;
