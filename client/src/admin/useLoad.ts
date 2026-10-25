import { useCallback, useEffect, useState } from 'react';

/** Load data once, and again whenever reload() is called. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let dead = false;
    fn()
      .then((d) => {
        if (!dead) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: Error) => {
        if (!dead) setError(e.message);
      });
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, reload };
}
