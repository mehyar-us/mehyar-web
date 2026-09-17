import { useEffect, useState } from "react";
import { api } from "./api";
import { useAdminSession } from "./session";

interface CenterData<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/**
 * Fetch a center API endpoint with the current session token.
 * Pass `path = null` to stay idle. Re-fetches when the path changes.
 */
export function useCenterData<T extends { ok: boolean }>(path: string | null): CenterData<T> {
  const { token } = useAdminSession();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(path !== null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (path === null || token === null) {
      if (path === null) {
        setData(null);
        setLoading(false);
        setError(null);
      }
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api<T>(path, token)
      .then((body) => {
        if (!cancelled) {
          setData(body);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Request failed");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [path, token]);

  return { data, loading, error };
}
