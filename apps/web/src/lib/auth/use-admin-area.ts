'use client';

import { useAuth, type AuthContextValue } from './auth-context';
import { useRequireAuth, type RequireAuthState } from './use-require-auth';

export interface AdminAreaState {
  /** `loading` until the session is known; `ready` once signed in. */
  gate: RequireAuthState;
  /** Signed in and holding `admin` or `super_admin`. */
  isAdmin: boolean;
  /** Signed in and holding `super_admin` (settings and reference-data writes). */
  isSuperAdmin: boolean;
  /** True once the session is known and the user may use the console. */
  ready: boolean;
  user: AuthContextValue['user'];
  api: AuthContextValue['api'];
  withAccessToken: AuthContextValue['withAccessToken'];
}

/**
 * Gate for admin console pages. The API enforces the real roles on every
 * request; this only shapes the UI (hides writes a plain admin cannot make).
 */
export function useAdminArea(): AdminAreaState {
  const gate = useRequireAuth();
  const { user, api, withAccessToken } = useAuth();
  const isSuperAdmin = user?.roles.includes('super_admin') ?? false;
  const isAdmin = (user?.roles.includes('admin') ?? false) || isSuperAdmin;
  return {
    gate,
    isAdmin,
    isSuperAdmin,
    ready: gate === 'ready' && isAdmin,
    user,
    api,
    withAccessToken,
  };
}
