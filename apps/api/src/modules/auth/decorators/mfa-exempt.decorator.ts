import { SetMetadata } from '@nestjs/common';

export const MFA_EXEMPT_KEY = 'mfaExempt';

/**
 * Marks the few routes a privileged account may use *before* completing its
 * second factor: the auth endpoints, MFA enrolment itself and the minimal own
 * profile. Everything else answers `403 MFA_REQUIRED` for an admin whose
 * session has not proven the factor (Phase 10, `MfaGuard`).
 */
export const MfaExempt = () => SetMetadata(MFA_EXEMPT_KEY, true);
