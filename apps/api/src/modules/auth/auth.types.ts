import type { UserRole } from '@vrp/contracts';
import type { Request } from 'express';

/** What the auth guard attaches to the request after verifying an access token. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  roles: UserRole[];
  /** Refresh-token family id carried in the access token (`sid`). */
  sessionId: string;
  /** The account has a confirmed authenticator-app factor (Phase 10). */
  mfaEnrolled: boolean;
  /** This session completed the second factor (claim `mfa` on the access token, set only by the server). */
  mfaVerified: boolean;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

/** Request metadata recorded with sessions and tokens. */
export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

export function requestMeta(request: Request): RequestMeta {
  const userAgent = request.headers['user-agent'];
  return {
    ...(request.ip ? { ip: request.ip } : {}),
    ...(typeof userAgent === 'string' ? { userAgent: userAgent.slice(0, 512) } : {}),
  };
}
