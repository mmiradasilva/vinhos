import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { api, setCsrfToken, setUnauthorizedHandler, type Me } from './api';

type AuthState = { status: 'loading' } | { status: 'signed-out' } | { status: 'signed-in'; me: Me };

interface AuthContextValue {
  state: AuthState;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setCsrfToken(null);
      setState({ status: 'signed-out' });
    });
    api<Me>('/me', { handle401: false })
      .then((me) => {
        setCsrfToken(me.csrf_token);
        setState({ status: 'signed-in', me });
      })
      .catch(() => setState({ status: 'signed-out' }));
    return () => setUnauthorizedHandler(null);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      setCsrfToken(null);
      setState({ status: 'signed-out' });
    }
  }, []);

  return <AuthContext.Provider value={{ state, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

/** Sends visitors to sign-in and back to this exact URL afterwards (US-3). */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const location = useLocation();
  if (state.status === 'loading') return <p className="page-status">Loading…</p>;
  if (state.status === 'signed-out') {
    const returnTo = location.pathname + location.search;
    return <Navigate to={`/signin?return_to=${encodeURIComponent(returnTo)}`} replace />;
  }
  return <>{children}</>;
}
