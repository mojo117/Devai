import { useState, useEffect, useCallback } from 'react';
import {
  login,
  verifyAuth,
  refreshAuth,
  setAuthToken,
  clearAuthToken,
  setUnauthorizedHandler,
} from '../api';

export interface UseAuthReturn {
  isAuthed: boolean;
  authChecked: boolean;
  authLoading: boolean;
  authError: string | null;
  username: string;
  password: string;
  setUsername: (value: string) => void;
  setPassword: (value: string) => void;
  handleLogin: (e: React.FormEvent) => Promise<void>;
}

function parseTokenExpiryMs(token: string): number | null {
  try {
    const [, payload] = token.split('.');
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const data = JSON.parse(atob(padded)) as { exp?: number };
    if (typeof data.exp !== 'number') return null;
    return data.exp * 1000;
  } catch {
    return null;
  }
}

const SESSION_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const SESSION_REFRESH_BUFFER_MS = 10 * 60 * 1000;

const AUTH_CACHE_KEY = 'devai_auth_cached';

/** Read cached auth state so we can skip the "Checking credentials..." screen
 *  when the mobile browser kills and restores the tab. */
function readCachedAuth(): { authed: boolean; expiryAt: number | null } {
  try {
    const raw = localStorage.getItem(AUTH_CACHE_KEY);
    if (!raw) return { authed: false, expiryAt: null };
    const cached = JSON.parse(raw) as { authed?: boolean; expiryAt?: number };
    if (!cached.authed) return { authed: false, expiryAt: null };
    // Treat as expired if the cached expiry is in the past
    if (cached.expiryAt && cached.expiryAt < Date.now()) return { authed: false, expiryAt: null };
    return { authed: true, expiryAt: cached.expiryAt ?? null };
  } catch {
    return { authed: false, expiryAt: null };
  }
}

function writeCachedAuth(authed: boolean, expiryAt: number | null): void {
  try {
    if (authed) {
      localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify({ authed: true, expiryAt }));
    } else {
      localStorage.removeItem(AUTH_CACHE_KEY);
    }
  } catch {
    // ignore
  }
}

export function useAuth(): UseAuthReturn {
  const cached = readCachedAuth();
  const [authChecked, setAuthChecked] = useState(cached.authed);
  const [isAuthed, setIsAuthed] = useState(cached.authed);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [tokenExpiryAt, setTokenExpiryAt] = useState<number | null>(cached.expiryAt);

  const handleSessionExpired = useCallback((message = 'Session abgelaufen. Bitte erneut anmelden.') => {
    clearAuthToken();
    setTokenExpiryAt(null);
    setIsAuthed(false);
    setAuthLoading(false);
    setAuthError(message);
    writeCachedAuth(false, null);
  }, []);

  const applyAuthenticatedToken = useCallback((token: string) => {
    setAuthToken(token);
    const expiry = parseTokenExpiryMs(token);
    setTokenExpiryAt(expiry);
    setAuthError(null);
    setIsAuthed(true);
    writeCachedAuth(true, expiry);
  }, []);

  // Verify auth on mount — restore in-memory token from cookie session.
  // If we have a cached auth state (from a previous session / tab restore),
  // we already set isAuthed=true + authChecked=true so the app renders
  // immediately. The verify call runs in the background and kicks to login
  // only if the server says the session is actually invalid.
  useEffect(() => {
    verifyAuth()
      .then((result) => {
        if (result.valid && result.token) {
          applyAuthenticatedToken(result.token);
        } else {
          setIsAuthed(false);
          clearAuthToken();
          setTokenExpiryAt(null);
          writeCachedAuth(false, null);
        }
      })
      .catch(() => {
        // Network error on verify — keep cached auth state if we have one,
        // the httpOnly cookie is still valid and will work on subsequent API calls.
        if (!isAuthed) {
          setIsAuthed(false);
          clearAuthToken();
          setTokenExpiryAt(null);
        }
      })
      .finally(() => setAuthChecked(true));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyAuthenticatedToken]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      handleSessionExpired();
    });
    return () => setUnauthorizedHandler(null);
  }, [handleSessionExpired]);

  useEffect(() => {
    if (!isAuthed || !tokenExpiryAt) return;
    const msUntilExpiry = tokenExpiryAt - Date.now();
    if (msUntilExpiry <= 0) {
      handleSessionExpired();
      return;
    }
    const timer = window.setTimeout(() => {
      handleSessionExpired();
    }, msUntilExpiry);
    return () => window.clearTimeout(timer);
  }, [isAuthed, tokenExpiryAt, handleSessionExpired]);

  useEffect(() => {
    if (!isAuthed || !tokenExpiryAt) return;
    let cancelled = false;

    const tryRefresh = async (force = false) => {
      if (!force) {
        const msRemaining = tokenExpiryAt - Date.now();
        if (msRemaining > SESSION_REFRESH_BUFFER_MS) return;
      }
      try {
        const result = await refreshAuth();
        if (cancelled) return;
        if (result.valid && result.token) {
          applyAuthenticatedToken(result.token);
        } else {
          handleSessionExpired();
        }
      } catch {
        // Network hiccup: keep current session and retry on next interval/visibility change.
      }
    };

    const intervalId = window.setInterval(() => {
      void tryRefresh(false);
    }, SESSION_REFRESH_INTERVAL_MS);

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void tryRefresh(true);
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    void tryRefresh(false);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [isAuthed, tokenExpiryAt, applyAuthenticatedToken, handleSessionExpired]);

  const handleLogin = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthLoading(true);

    try {
      const result = await login(username, password);
      applyAuthenticatedToken(result.token);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Login failed');
      clearAuthToken();
      setTokenExpiryAt(null);
    } finally {
      setAuthLoading(false);
    }
  }, [username, password, applyAuthenticatedToken]);

  return {
    isAuthed,
    authChecked,
    authLoading,
    authError,
    username,
    password,
    setUsername,
    setPassword,
    handleLogin,
  };
}
