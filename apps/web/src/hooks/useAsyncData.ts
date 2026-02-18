import { useState, useEffect, useCallback } from 'react';

interface UseAsyncDataOptions {
  enabled?: boolean;
}

interface UseAsyncDataReturn<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Generic hook for async data fetching with loading/error state,
 * isMounted cleanup guard, and manual refresh support.
 *
 * @param fn - Async function that returns the data
 * @param deps - Dependency array (re-fetches when deps change)
 * @param options - Optional config (e.g. `enabled` to conditionally skip fetch)
 */
export function useAsyncData<T>(
  fn: () => Promise<T>,
  deps: readonly unknown[],
  options?: UseAsyncDataOptions,
): UseAsyncDataReturn<T> {
  const { enabled = true } = options ?? {};
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let isMounted = true;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await fn();
        if (!isMounted) return;
        setData(result);
      } catch (err) {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, refreshCount, ...deps]);

  const refresh = useCallback(() => {
    setRefreshCount((c) => c + 1);
  }, []);

  return { data, loading, error, refresh };
}
