import { describe, expect, it } from 'vitest';

import { redactRequestForLog } from './logger.module';

describe('request log projection', () => {
  it('keeps the path and the query parameter names, never the values', () => {
    const out = redactRequestForLog({
      id: 'r1',
      method: 'GET',
      url: '/api/v1/admin/users?role=provider&q=someone%40example.com&q=again',
      query: { role: 'provider', q: ['someone@example.com', 'again'] },
      params: { id: 'x' },
      headers: { host: 'localhost' },
      remoteAddress: '127.0.0.1',
    });
    expect(out).toEqual({
      id: 'r1',
      method: 'GET',
      url: '/api/v1/admin/users',
      queryKeys: ['q', 'role'],
      headers: { host: 'localhost' },
      remoteAddress: '127.0.0.1',
    });
    expect(JSON.stringify(out)).not.toContain('example.com');
  });

  it('logs only allow-listed request headers', () => {
    const out = redactRequestForLog({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: {
        host: 'api.example.lk',
        'user-agent': 'Mozilla/5.0',
        'content-type': 'application/json',
        origin: 'https://app.example.lk',
        authorization: 'Bearer secret-token',
        cookie: 'vrp_refresh=secret',
        referer: 'https://app.example.lk/reset-password?token=reset-secret',
        'x-forwarded-for': '203.0.113.7',
        'x-api-key': 'canary-value',
      },
    });
    expect(out.headers).toEqual({
      host: 'api.example.lk',
      'user-agent': 'Mozilla/5.0',
      'content-type': 'application/json',
      origin: 'https://app.example.lk',
    });
    for (const secret of ['secret-token', 'vrp_refresh', 'reset-secret', '203.0.113.7', 'canary']) {
      expect(JSON.stringify(out)).not.toContain(secret);
    }
  });

  it('leaves requests without a query string untouched apart from the dropped objects', () => {
    expect(redactRequestForLog({ method: 'POST', url: '/api/v1/bookings', query: {} })).toEqual({
      method: 'POST',
      url: '/api/v1/bookings',
    });
  });
});
