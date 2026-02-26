import { useState, useEffect, useCallback, useRef, type DependencyList } from 'react';

/**
 * Hook that manages async data loading with a minimum delay to prevent flash.
 *
 * @param fn - Async function that performs the loading. Return `true` to skip
 *   the minimum delay (e.g. when data comes from cache).
 * @param deps - Re-runs whenever these change (similar to useEffect deps).
 * @param options.skip - When true, the loader won't fire (e.g. while auth is loading).
 * @param options.minDelay - Minimum ms before loading becomes false (default 300).
 * @returns `[loading, reload]` — boolean flag and manual re-trigger function.
 */
export function useLoader(
  fn: () => Promise<boolean | void>,
  deps: DependencyList,
  options: { skip?: boolean; minDelay?: number } = {},
): [boolean, () => Promise<void>] {
  const { skip = false, minDelay = 300 } = options;
  const [loading, setLoading] = useState(true);
  const loadStartRef = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async () => {
    setLoading(true);
    loadStartRef.current = Date.now();
    let instant = false;
    try {
      const result = await fnRef.current();
      if (result === true) instant = true;
    } finally {
      if (!instant) {
        const elapsed = Date.now() - loadStartRef.current;
        const remaining = minDelay - elapsed;
        if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
      }
      setLoading(false);
    }
  }, [minDelay]);

  useEffect(() => {
    if (skip) return;
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skip, run, ...deps]);

  return [loading, run];
}
