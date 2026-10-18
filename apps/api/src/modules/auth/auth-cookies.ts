import type { ConfigService } from '@nestjs/config';
import { API_BASE_PATH } from '@vrp/contracts';
import type { CookieOptions, Request, Response } from 'express';

import type { Env } from '../../config/env.schema';

/** Base name of the HttpOnly refresh-token cookie used by web clients. */
export const REFRESH_COOKIE = 'vrp_refresh';
/** With the `Secure` attribute the cookie also carries the `__Secure-` prefix (ASVS 5.0 V3.3.1). */
export const SECURE_REFRESH_COOKIE = `__Secure-${REFRESH_COOKIE}`;

export function cookieSecure(config: ConfigService<Env, true>): boolean {
  return (
    config.get('COOKIE_SECURE', { infer: true }) ??
    config.get('NODE_ENV', { infer: true }) === 'production'
  );
}

export function refreshCookieName(config: ConfigService<Env, true>): string {
  return cookieSecure(config) ? SECURE_REFRESH_COOKIE : REFRESH_COOKIE;
}

/** Reads the refresh cookie under either name (the browser only ever holds the one we set). */
export function readRefreshCookie(request: Request): string | undefined {
  const cookies = (request as Request & { cookies?: Record<string, unknown> }).cookies;
  const value = cookies?.[SECURE_REFRESH_COOKIE] ?? cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** The cookie is only ever sent to the auth endpoints. */
export const REFRESH_COOKIE_PATH = `${API_BASE_PATH}/auth`;

export function refreshCookieOptions(config: ConfigService<Env, true>): CookieOptions {
  const domain = config.get('COOKIE_DOMAIN', { infer: true });
  return {
    httpOnly: true,
    secure: cookieSecure(config),
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
    ...(domain ? { domain } : {}),
  };
}

export function setRefreshCookie(
  response: Response,
  config: ConfigService<Env, true>,
  rawToken: string,
  expiresAt: Date,
): void {
  response.cookie(refreshCookieName(config), rawToken, {
    ...refreshCookieOptions(config),
    expires: expiresAt,
  });
}

export function clearRefreshCookie(response: Response, config: ConfigService<Env, true>): void {
  response.clearCookie(refreshCookieName(config), refreshCookieOptions(config));
}
