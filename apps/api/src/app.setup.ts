import type { IncomingMessage } from 'node:http';

import { VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { API_GLOBAL_PREFIX, API_VERSION } from '@vrp/contracts';
import cookieParser from 'cookie-parser';
import helmet, { type HelmetOptions } from 'helmet';
import { Logger } from 'nestjs-pino';

import { REQUEST_ID_HEADER } from './common/logging/logger.module';
import { derived, type Env } from './config/env.schema';
import { setupOpenApi } from './openapi/openapi';

export interface SecurityHeaderOptions {
  /** Swagger UI and the fake gateway page are the only HTML this API serves; both are development-only. */
  servesHtml: boolean;
  hsts: boolean;
  /**
   * Origin of the web app (`WEB_APP_URL`). The fake gateway's checkout form posts to the API and is
   * then redirected (303) back to the web app; browsers enforce `form-action` on that redirect too,
   * so the web origin must be allowed whenever the HTML pages are served.
   */
  webAppOrigin?: string;
}

/**
 * Helmet configuration (SECURITY_AND_PRIVACY §4). The API answers JSON, so in
 * production nothing may load, frame or submit to it; HSTS is sent whenever
 * TLS terminates in front of the API (the header has to reach browsers even
 * though the process itself speaks plain HTTP to its proxy).
 */
export function securityHeaders(options: SecurityHeaderOptions): HelmetOptions {
  return {
    contentSecurityPolicy: options.servesHtml
      ? {
          // helmet's defaults keep Swagger UI and the fake checkout page working locally; the
          // web origin is added to form-action so the gateway's redirect back is not refused.
          useDefaults: true,
          directives: {
            'form-action': ["'self'", ...(options.webAppOrigin ? [options.webAppOrigin] : [])],
          },
        }
      : {
          useDefaults: false,
          directives: {
            'default-src': ["'none'"],
            'frame-ancestors': ["'none'"],
            'base-uri': ["'none'"],
            'form-action': ["'none'"],
          },
        },
    strictTransportSecurity: options.hsts
      ? { maxAge: 31_536_000, includeSubDomains: true, preload: false }
      : false,
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    xFrameOptions: { action: 'deny' },
  };
}

/**
 * Applies the HTTP baseline shared by `main.ts` and the e2e tests so both run
 * the exact same middleware, prefix, versioning and body limits.
 */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const env = snapshot(config);

  app.useLogger(app.get(Logger));
  // Client addresses for rate limiting, audit and session records come from
  // X-Forwarded-For only up to the configured number of trusted proxies; with
  // 0 hops the socket address is used and the header is ignored entirely.
  const hops = config.get('TRUST_PROXY_HOPS', { infer: true });
  app.set('trust proxy', hops > 0 ? hops : false);
  if (hops > 0) {
    // Some edges (Railway) set only X-Real-IP. Express evaluates X-Forwarded-For, so copy the
    // proxy-supplied value across when the client did not send a forwarded chain of its own;
    // the trust-proxy hop count still decides whether it is believed.
    app.use((req: IncomingMessage, _res: unknown, next: () => void) => {
      const realIp = req.headers['x-real-ip'];
      if (!req.headers['x-forwarded-for'] && typeof realIp === 'string' && realIp.length > 0) {
        req.headers['x-forwarded-for'] = realIp;
      }
      next();
    });
  }

  const openApiEnabled = derived.openApiEnabled(env);
  const fakeGateway = config.get('PAYMENT_GATEWAY', { infer: true }) === 'fake';
  app.use(
    helmet(
      securityHeaders({
        servesHtml: openApiEnabled || fakeGateway,
        hsts: derived.hstsEnabled(env),
        webAppOrigin: new URL(config.get('WEB_APP_URL', { infer: true })).origin,
      }),
    ),
  );
  // Only the refresh-token cookie is read; it is HttpOnly and path-scoped (auth-cookies.ts).
  app.use(cookieParser());
  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }),
    credentials: true,
    exposedHeaders: [REQUEST_ID_HEADER],
    maxAge: 600,
  });
  app.setGlobalPrefix(API_GLOBAL_PREFIX);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: API_VERSION });
  // JSON bodies are small by design; files are multipart uploads with their own per-route limits.
  app.useBodyParser('json', { limit: '256kb' });
  // PayHere posts its payment notification as a classic form (Phase 7).
  app.useBodyParser('urlencoded', { extended: false, limit: '64kb' });
  app.enableShutdownHooks();

  if (openApiEnabled) {
    setupOpenApi(app);
  }
}

/** The few values the HTTP baseline needs, read through the validated config. */
function snapshot(config: ConfigService<Env, true>): Env {
  return {
    NODE_ENV: config.get('NODE_ENV', { infer: true }),
    OPENAPI_ENABLED: config.get('OPENAPI_ENABLED', { infer: true }),
    HSTS_ENABLED: config.get('HSTS_ENABLED', { infer: true }),
  } as Env;
}
