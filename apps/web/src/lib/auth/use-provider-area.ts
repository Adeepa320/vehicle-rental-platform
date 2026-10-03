'use client';

import type { ProviderProfile } from '@vrp/contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { useAuth } from './auth-context';
import { useRequireAuth } from './use-require-auth';
import { submitErrorFrom } from '@/lib/forms';

export type ProviderAreaState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; profile: ProviderProfile };

/**
 * Gate for provider inventory pages: requires a session and an approved
 * provider profile (users without one are sent to the application page). The
 * API enforces active standing on every write; this only shapes the UI.
 */
export function useProviderArea(): ProviderAreaState {
  const gate = useRequireAuth();
  const { user, api, withAccessToken } = useAuth();
  const router = useRouter();
  const [state, setState] = useState<ProviderAreaState>({ status: 'loading' });

  useEffect(() => {
    if (gate !== 'ready' || !user) return;
    if (!user.roles.includes('provider')) {
      router.replace('/provider/application');
      return;
    }
    let cancelled = false;
    withAccessToken((token) => api.providers.myProfile(token))
      .then((profile) => {
        if (cancelled) return;
        if (!profile) router.replace('/provider/application');
        else setState({ status: 'ready', profile });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', message: submitErrorFrom(error).message });
      });
    return () => {
      cancelled = true;
    };
  }, [api, gate, router, user, withAccessToken]);

  return state;
}
