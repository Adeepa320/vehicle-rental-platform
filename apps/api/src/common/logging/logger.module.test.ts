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

  it('leaves requests without a query string untouched apart from the dropped objects', () => {
    expect(redactRequestForLog({ method: 'POST', url: '/api/v1/bookings', query: {} })).toEqual({
      method: 'POST',
      url: '/api/v1/bookings',
    });
  });
});
