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

export function useAuth(): UseAuthReturn {
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [tokenExpiryAt, setTokenExpiryAt] = useState<number | null>(null);

  const handleSessionExpired = useCallback((message = 'Session abgelaufen. Bitte erneut anmelden.') => {
    clearAuthToken();
    setTokenExpiryAt(null);
    setIsAuthed(false);
    setAuthLoading(false);
    setAuthError(message);
  }, []);

  const applyAuthenticatedToken = useCallback((token: string) => {
    setAuthToken(token);
    setTokenExpiryAt(parseTokenExpiryMs(token));
    setAuthError(null);
    setIsAuthed(true);
  }, []);

  // Verify auth on mount — restore in-memory token from cookie session
  useEffect(() => {
    verifyAuth()
      .then((result) => {
        if (result.valid && result.token) {
          applyAuthenticatedToken(result.token);
        } else {
          setIsAuthed(false);
          clearAuthToken();
          setTokenExpiryAt(null);
        }
      })
      .catch(() => {
        setIsAuthed(false);
        clearAuthToken();
        setTokenExpiryAt(null);
      })
      .finally(() => setAuthChecked(true));
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
