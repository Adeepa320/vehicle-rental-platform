import type { ConfigService } from '@nestjs/config';
import { API_BASE_PATH } from '@vrp/contracts';
import type { CookieOptions, Response } from 'express';

import type { Env } from '../../config/env.schema';

/** Name of the HttpOnly refresh-token cookie used by web clients. */
export const REFRESH_COOKIE = 'vrp_refresh';

/** The cookie is only ever sent to the auth endpoints. */
export const REFRESH_COOKIE_PATH = `${API_BASE_PATH}/auth`;

export function refreshCookieOptions(config: ConfigService<Env, true>): CookieOptions {
  const secure =
    config.get('COOKIE_SECURE', { infer: true }) ??
    config.get('NODE_ENV', { infer: true }) === 'production';
  const domain = config.get('COOKIE_DOMAIN', { infer: true });
  return {
    httpOnly: true,
    secure,
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
  response.cookie(REFRESH_COOKIE, rawToken, {
    ...refreshCookieOptions(config),
    expires: expiresAt,
  });
}

export function clearRefreshCookie(response: Response, config: ConfigService<Env, true>): void {
  response.clearCookie(REFRESH_COOKIE, refreshCookieOptions(config));
}
