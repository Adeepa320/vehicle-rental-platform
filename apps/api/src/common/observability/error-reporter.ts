import { randomUUID } from 'node:crypto';

import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';

import type { Env } from '../../config/env.schema';

/**
 * Optional error tracking (Phase 10, TECH_DECISIONS D72). A minimal client for
 * Sentry's envelope ingestion built on `fetch`, instead of the SDK: the SDK
 * pulls OpenTelemetry peers that duplicate `drizzle-orm` across the workspace
 * and captures headers, cookies, bodies and addresses by default. Here the
 * event is constructed from scratch, so it can only ever contain what this
 * file puts in it: the error type and message, a stack trace, the release,
 * environment and service, and tags for the request id, route, method, job
 * and the stable user id. Without `SENTRY_DSN` every call is a no-op; sending
 * never blocks a request (fire-and-forget with a short timeout) and never
 * throws.
 */
export interface ErrorContext {
  requestId?: string;
  route?: string;
  method?: string;
  userId?: string;
  job?: string;
}

export interface SentryDsn {
  endpoint: string;
  publicKey: string;
  projectId: string;
}

export interface ErrorEvent {
  event_id: string;
  timestamp: number;
  platform: 'node';
  level: 'error';
  logger: string;
  server_name: string;
  environment: string;
  release?: string;
  tags: Record<string, string>;
  user?: { id: string };
  exception: {
    values: Array<{
      type: string;
      value: string;
      stacktrace?: {
        frames: Array<{
          filename: string;
          function: string;
          lineno?: number;
          colno?: number;
          in_app: boolean;
        }>;
      };
    }>;
  };
}

const CLIENT = 'vrp-envelope-client/1.0';
const SEND_TIMEOUT_MS = 3000;
const FRAME = /^\s*at\s+(?:(.*?)\s+\()?(.*?):(\d+):(\d+)\)?\s*$/;
const MAX_MESSAGE = 1000;

/** `https://<publicKey>@<host>/<projectId>` → envelope endpoint and auth parts. */
export function parseDsn(dsn: string): SentryDsn {
  const url = new URL(dsn);
  const projectId = url.pathname.replace(/^\/+/, '').split('/').at(-1) ?? '';
  if (!url.username || !projectId)
    throw new Error('SENTRY_DSN must look like https://<key>@<host>/<project>');
  return {
    endpoint: `${url.protocol}//${url.host}/api/${projectId}/envelope/`,
    publicKey: url.username,
    projectId,
  };
}

/** Node stack text → Sentry frames (innermost last, as Sentry expects). */
export function parseStack(
  stack: string | undefined,
): ErrorEvent['exception']['values'][number]['stacktrace'] | undefined {
  if (!stack) return undefined;
  const frames = stack
    .split('\n')
    .map((line) => FRAME.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({
      function: match[1] ?? '<anonymous>',
      filename: match[2] ?? '',
      lineno: Number(match[3]),
      colno: Number(match[4]),
      in_app: !(match[2] ?? '').includes('node_modules') && !(match[2] ?? '').startsWith('node:'),
    }))
    .reverse();
  return frames.length > 0 ? { frames } : undefined;
}

export interface BuildEventInput {
  error: unknown;
  context: ErrorContext;
  environment: string;
  release?: string;
  serverName: string;
  now?: Date;
}

/** The whole payload; nothing from the request object is ever read here. */
export function buildEvent(input: BuildEventInput): ErrorEvent {
  const err = input.error instanceof Error ? input.error : undefined;
  const type = err?.name ?? 'Error';
  const value = (err?.message ?? String(input.error)).slice(0, MAX_MESSAGE);
  const tags: Record<string, string> = { service: input.serverName };
  if (input.context.requestId) tags.requestId = input.context.requestId;
  if (input.context.route) tags.route = input.context.route;
  if (input.context.method) tags.method = input.context.method;
  if (input.context.job) tags.job = input.context.job;
  return {
    event_id: randomUUID().replaceAll('-', ''),
    timestamp: Math.floor((input.now ?? new Date()).getTime() / 1000),
    platform: 'node',
    level: 'error',
    logger: 'vrp',
    server_name: input.serverName,
    environment: input.environment,
    ...(input.release ? { release: input.release } : {}),
    tags,
    ...(input.context.userId ? { user: { id: input.context.userId } } : {}),
    exception: { values: [{ type, value, stacktrace: parseStack(err?.stack) }] },
  };
}

export function buildEnvelope(event: ErrorEvent, dsn: string): string {
  const header = JSON.stringify({
    event_id: event.event_id,
    sent_at: new Date().toISOString(),
    dsn,
  });
  const item = JSON.stringify({ type: 'event', content_type: 'application/json' });
  return `${header}\n${item}\n${JSON.stringify(event)}\n`;
}

@Injectable()
export class ErrorReporter implements OnApplicationShutdown {
  readonly enabled: boolean;
  private readonly dsn: string | undefined;
  private readonly target: SentryDsn | undefined;
  private readonly environment: string;
  private readonly release: string | undefined;
  private readonly serverName: string;
  private inflight = new Set<Promise<void>>();

  constructor(
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ErrorReporter.name);
    this.dsn = config.get('SENTRY_DSN', { infer: true });
    this.environment = config.get('NODE_ENV', { infer: true });
    this.release = config.get('APP_RELEASE', { infer: true });
    this.serverName = process.env.SERVICE_NAME ?? 'api';
    this.target = this.dsn ? parseDsn(this.dsn) : undefined;
    this.enabled = this.target !== undefined;
    if (this.enabled)
      this.logger.info({ environment: this.environment }, 'Error reporting enabled');
  }

  /** Builds and sends one event; never throws and never waits on the network. */
  capture(error: unknown, context: ErrorContext = {}): void {
    if (!this.target || !this.dsn) return;
    const event = buildEvent({
      error,
      context,
      environment: this.environment,
      release: this.release,
      serverName: this.serverName,
    });
    const sending = this.send(buildEnvelope(event, this.dsn)).finally(() => {
      this.inflight.delete(sending);
    });
    this.inflight.add(sending);
  }

  private async send(envelope: string): Promise<void> {
    const target = this.target as SentryDsn;
    try {
      const response = await fetch(target.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-sentry-envelope',
          'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=${CLIENT}, sentry_key=${target.publicKey}`,
        },
        body: envelope,
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      if (!response.ok) this.logger.warn({ status: response.status }, 'Error report rejected');
    } catch (error) {
      this.logger.warn({ err: error }, 'Error report not sent');
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([...this.inflight]);
  }
}
