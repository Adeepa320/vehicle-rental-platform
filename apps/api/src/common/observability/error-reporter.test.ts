import { describe, expect, it } from 'vitest';

import { buildEnvelope, buildEvent, parseDsn, parseStack } from './error-reporter';

describe('error reporter (Sentry-compatible envelope client)', () => {
  it('parses a DSN into the envelope endpoint and the public key', () => {
    expect(parseDsn('https://abc123@o4509.ingest.de.sentry.io/4509000')).toEqual({
      endpoint: 'https://o4509.ingest.de.sentry.io/api/4509000/envelope/',
      publicKey: 'abc123',
      projectId: '4509000',
    });
    expect(() => parseDsn('https://sentry.example/4509000')).toThrow(/SENTRY_DSN/);
  });

  it('turns a Node stack into frames with node_modules and node: internals marked out of app', () => {
    const stack = [
      'Error: boom',
      '    at BookingsService.accept (D:\\repo\\apps\\api\\dist\\modules\\bookings\\bookings.service.js:120:11)',
      '    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)',
      '    at D:\\repo\\node_modules\\.pnpm\\@nestjs+core\\router.js:42:7',
    ].join('\n');
    const frames = parseStack(stack)?.frames ?? [];
    expect(frames).toHaveLength(3);
    // innermost last
    expect(frames.at(-1)).toMatchObject({
      function: 'BookingsService.accept',
      lineno: 120,
      colno: 11,
      in_app: true,
    });
    expect(frames[0]?.in_app).toBe(false);
    expect(frames[1]).toMatchObject({
      filename: 'node:internal/process/task_queues',
      in_app: false,
    });
    expect(parseStack(undefined)).toBeUndefined();
  });

  it('builds an event from the error and context only — never from the request', () => {
    const error = new TypeError('Cannot read properties of undefined');
    const event = buildEvent({
      error,
      context: {
        requestId: 'req-1',
        route: '/api/v1/bookings/:id',
        method: 'POST',
        userId: '0192f0a0-0000-7000-8000-000000000123',
      },
      environment: 'production',
      release: 'abc1234',
      serverName: 'api',
      now: new Date('2026-10-17T10:00:00Z'),
    });
    expect(event).toMatchObject({
      platform: 'node',
      level: 'error',
      environment: 'production',
      release: 'abc1234',
      server_name: 'api',
      timestamp: 1792231200,
      tags: { service: 'api', requestId: 'req-1', route: '/api/v1/bookings/:id', method: 'POST' },
      user: { id: '0192f0a0-0000-7000-8000-000000000123' },
    });
    expect(event.event_id).toMatch(/^[0-9a-f]{32}$/);
    expect(event.exception.values[0]).toMatchObject({
      type: 'TypeError',
      value: 'Cannot read properties of undefined',
    });
    expect(Object.keys(event).sort()).toEqual([
      'environment',
      'event_id',
      'exception',
      'level',
      'logger',
      'platform',
      'release',
      'server_name',
      'tags',
      'timestamp',
      'user',
    ]);
    expect(JSON.stringify(event)).not.toMatch(
      /headers|cookie|authorization|ip_address|email|query/,
    );
  });

  it('handles non-Error values and long messages, and emits a three-line envelope', () => {
    const event = buildEvent({
      error: 'x'.repeat(5000),
      context: { job: 'email.send' },
      environment: 'test',
      serverName: 'worker',
    });
    expect(event.exception.values[0]?.type).toBe('Error');
    expect(event.exception.values[0]?.value).toHaveLength(1000);
    expect(event.tags).toEqual({ service: 'worker', job: 'email.send' });
    expect(event.user).toBeUndefined();
    const envelope = buildEnvelope(event, 'https://k@h/1');
    const lines = envelope.split('\n');
    expect(lines).toHaveLength(4);
    expect(JSON.parse(lines[0] as string)).toMatchObject({
      event_id: event.event_id,
      dsn: 'https://k@h/1',
    });
    expect(JSON.parse(lines[1] as string)).toEqual({
      type: 'event',
      content_type: 'application/json',
    });
    expect(JSON.parse(lines[2] as string).event_id).toBe(event.event_id);
  });
});
