'use client';

import type {
  AuthSessionResponse,
  RegisterRequest,
  RegisterResponse,
  UpdateProfileRequest,
  User,
} from '@vrp/contracts';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { ApiClientError, createApiClient, type ApiClient } from '@/lib/api-client';
import { publicEnv } from '@/lib/env';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

export interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  api: ApiClient;
  register(input: RegisterRequest): Promise<RegisterResponse>;
  login(email: string, password: string): Promise<AuthSessionResponse>;
  logout(): Promise<void>;
  logoutAll(): Promise<void>;
  /** Silent refresh via the HttpOnly cookie; resolves null when there is no session. */
  refresh(): Promise<AuthSessionResponse | null>;
  updateProfile(patch: UpdateProfileRequest): Promise<User>;
  /** Runs `fn` with a valid access token, refreshing once on expiry or 401. */
  withAccessToken<T>(fn: (accessToken: string) => Promise<T>): Promise<T>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface SessionState {
  status: AuthStatus;
  user: User | null;
}

/**
 * Holds the access token in memory only (never storage) and keeps the session
 * alive through the refresh cookie. Server components cannot see the session;
 * pages that need it are client components (ARCHITECTURE §4).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const api = useMemo(() => createApiClient({ baseUrl: publicEnv.NEXT_PUBLIC_API_URL }), []);
  const [session, setSession] = useState<SessionState>({ status: 'loading', user: null });

  // Token material lives in refs: it must never trigger renders or reach storage.
  const tokenRef = useRef<string | null>(null);
  const expiresAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSession = useCallback(() => {
    tokenRef.current = null;
    expiresAtRef.current = 0;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setSession({ status: 'anonymous', user: null });
  }, []);

  /** Stores a session and schedules a silent refresh a minute before the access token expires. */
  const storeSession = useCallback((value: AuthSessionResponse, scheduleRefresh: () => void) => {
    tokenRef.current = value.accessToken;
    expiresAtRef.current = Date.now() + value.expiresIn * 1000;
    setSession({ status: 'authenticated', user: value.user });
    if (timerRef.current) clearTimeout(timerRef.current);
    const delay = Math.max((value.expiresIn - 60) * 1000, 10_000);
    timerRef.current = setTimeout(scheduleRefresh, delay);
  }, []);

  const refresh = useCallback(
    async function refreshSession(): Promise<AuthSessionResponse | null> {
      try {
        const next = await api.auth.refresh();
        storeSession(next, () => void refreshSession());
        return next;
      } catch {
        clearSession();
        return null;
      }
    },
    [api, clearSession, storeSession],
  );

  const applySession = useCallback(
    (value: AuthSessionResponse) => storeSession(value, () => void refresh()),
    [refresh, storeSession],
  );

  // Initial silent login, deferred to a timer callback so the effect body itself
  // performs no state updates.
  useEffect(() => {
    const kick = setTimeout(() => void refresh(), 0);
    return () => {
      clearTimeout(kick);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [refresh]);

  const withAccessToken = useCallback(
    async <T,>(fn: (accessToken: string) => Promise<T>): Promise<T> => {
      let token = tokenRef.current;
      if (!token || Date.now() > expiresAtRef.current - 5_000) {
        const next = await refresh();
        if (!next) throw new ApiClientError(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
        token = next.accessToken;
      }
      try {
        return await fn(token);
      } catch (error) {
        if (error instanceof ApiClientError && error.status === 401) {
          const next = await refresh();
          if (!next) throw error;
          return fn(next.accessToken);
        }
        throw error;
      }
    },
    [refresh],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status: session.status,
      user: session.user,
      api,
      refresh,
      withAccessToken,
      register: (input) => api.auth.register(input),
      login: async (email, password) => {
        const next = await api.auth.login({ email, password, client: 'web' });
        applySession(next);
        return next;
      },
      logout: async () => {
        try {
          await api.auth.logout();
        } finally {
          clearSession();
        }
      },
      logoutAll: async () => {
        try {
          await withAccessToken((token) => api.auth.logoutAll(token));
        } finally {
          clearSession();
        }
      },
      updateProfile: async (patch) => {
        const updated = await withAccessToken((token) => api.users.updateMe(token, patch));
        setSession((current) => ({ ...current, user: updated }));
        return updated;
      },
    }),
    [api, applySession, clearSession, refresh, session, withAccessToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within <AuthProvider>');
  return context;
}
