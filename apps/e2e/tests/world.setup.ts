import { test as setup } from '@playwright/test';

import { RUN_ID, createAdmin } from '../fixtures/accounts';
import { createApprovedProvider, mirissaPlace } from '../fixtures/provider';
import { saveWorld } from '../fixtures/world';

/**
 * Runs once before the spec files: a super admin with a verified authenticator
 * (its token approves everything the fixtures create) and one approved provider
 * with a Mirissa location. Spec files create their own vehicles, customers and
 * extra admins so they never share booking windows or authenticator codes.
 */
setup('create the shared admin and provider', async () => {
  const admin = await createAdmin('ops', { role: 'super_admin', enrol: true, fullName: 'E2E Ops' });
  const provider = await createApprovedProvider(
    admin.accessToken,
    'provider',
    `E2E Motors ${RUN_ID}`,
  );
  const mirissa = await mirissaPlace();
  saveWorld({
    runId: RUN_ID,
    createdAt: new Date().toISOString(),
    admin,
    provider,
    places: { mirissaId: mirissa.id },
  });
});
