import { useState, useEffect, useCallback } from 'react';
import { login, verifyAuth, setAuthToken, clearAuthToken } from '../api';

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

export function useAuth(): UseAuthReturn {
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  // Verify auth on mount — restore in-memory token from cookie session
  useEffect(() => {
    verifyAuth()
      .then((result) => {
        if (result.valid && result.token) {
          setAuthToken(result.token);
          setIsAuthed(true);
        } else {
          setIsAuthed(false);
          clearAuthToken();
        }
      })
      .catch(() => setIsAuthed(false))
      .finally(() => setAuthChecked(true));
  }, []);

  const handleLogin = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthLoading(true);

    try {
      const result = await login(username, password);
      setAuthToken(result.token);
      setIsAuthed(true);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Login failed');
      clearAuthToken();
    } finally {
      setAuthLoading(false);
    }
  }, [username, password]);

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
