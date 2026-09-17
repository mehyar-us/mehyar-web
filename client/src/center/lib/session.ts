import { useCallback, useState } from "react";

const TOKEN_KEY = "mehyarsoft_admin_token";
const TS_KEY = "mehyarsoft_admin_token_ts";
// 30-day TTL on the stored admin token.
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — session simply won't persist */
  }
}

function removeLocal(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Read the stored admin token, honoring the 30-day TTL. Returns null if missing/expired. */
export function readStoredToken(): string | null {
  const token = readLocal(TOKEN_KEY);
  if (!token) return null;
  const ts = readLocal(TS_KEY);
  const tsNum = ts ? Number(ts) : 0;
  if (!ts || Number.isNaN(tsNum) || Date.now() - tsNum > TOKEN_TTL_MS) {
    removeLocal(TOKEN_KEY);
    removeLocal(TS_KEY);
    return null;
  }
  return token;
}

export interface AdminSession {
  token: string | null;
  isLoggedIn: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

/** Admin session hook: localStorage-backed bearer token for /api/admin/* calls. */
export function useAdminSession(): AdminSession {
  const [token, setToken] = useState<string | null>(() => readStoredToken());

  const login = useCallback(async (username: string, password: string) => {
    const res = await fetch("/api/admin/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    let body: { token?: string; ok?: boolean; error?: string } | null = null;
    try {
      body = (await res.json()) as { token?: string; ok?: boolean; error?: string };
    } catch {
      body = null;
    }
    if (!res.ok || !body || !body.token) {
      throw new Error(body?.error || `Login failed (${res.status})`);
    }
    writeLocal(TOKEN_KEY, body.token);
    writeLocal(TS_KEY, String(Date.now()));
    setToken(body.token);
  }, []);

  const logout = useCallback(() => {
    removeLocal(TOKEN_KEY);
    removeLocal(TS_KEY);
    setToken(null);
  }, []);

  return { token, isLoggedIn: token !== null, login, logout };
}
