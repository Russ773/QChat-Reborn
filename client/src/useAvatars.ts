import { useCallback, useRef, useState } from 'react';
import { getProfile } from './api.js';

/**
 * Profile photos for names that appear in the chat, fetched once each as they
 * are first seen. Call avatarFor() while rendering; the photo appears when it loads.
 */
export function useAvatars() {
  const [, bump] = useState(0);
  const known = useRef(new Map<string, string | null>());
  const pending = useRef(new Set<string>());

  const avatarFor = useCallback((name: string): string | undefined => {
    const key = name.toLowerCase();
    if (known.current.has(key)) return known.current.get(key) ?? undefined;
    if (!pending.current.has(key)) {
      pending.current.add(key);
      getProfile(name)
        .then((r) => known.current.set(key, r.profile?.avatar ?? null))
        .catch(() => known.current.set(key, null))
        .finally(() => bump((n) => n + 1));
    }
    return undefined;
  }, []);

  /** Update a name's photo straight away (after you change your own). */
  const setAvatar = useCallback((name: string, url: string | undefined) => {
    known.current.set(name.toLowerCase(), url ?? null);
    bump((n) => n + 1);
  }, []);

  return { avatarFor, setAvatar };
}
