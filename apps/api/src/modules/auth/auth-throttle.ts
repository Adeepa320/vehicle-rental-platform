import { Throttle, minutes, seconds } from '@nestjs/throttler';

/**
 * Route-level limits for the authentication endpoints, layered on top of the
 * global per-IP limit. Values are read from the environment when the
 * controller class is loaded (decorators evaluate at import time), which is
 * after `AppConfigModule` has loaded `.env`; tests override them before
 * importing the application.
 */
function envInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export const AUTH_LIMITS = {
  /** Password attempts per IP. */
  login: { limit: envInt('AUTH_LOGIN_LIMIT_PER_MINUTE', 10), ttl: seconds(60) },
  /** Register, forgot-password, resend-verification per IP. */
  sensitive: { limit: envInt('AUTH_SENSITIVE_LIMIT_PER_15MIN', 5), ttl: minutes(15) },
  /** Token redemption (verify e-mail, reset password) per IP. */
  tokenUse: { limit: 20, ttl: minutes(15) },
  /** Refresh / logout per IP. */
  refresh: { limit: 60, ttl: minutes(1) },
} as const;

export type AuthLimitKind = keyof typeof AUTH_LIMITS;

export const AuthThrottle = (kind: AuthLimitKind) => Throttle({ global: AUTH_LIMITS[kind] });
