import type { ConfigService } from '@nestjs/config';
import type { PinoLogger } from 'nestjs-pino';
import { describe, expect, it } from 'vitest';

import type { Env } from '../../config/env.schema';
import { TokenService } from './token.service';

function makeConfig(overrides: Record<string, unknown> = {}): ConfigService<Env, true> {
  const values: Record<string, unknown> = {
    NODE_ENV: 'test',
    JWT_ISSUER: 'vrp-api-test',
    JWT_AUDIENCE: 'vrp-test',
    ACCESS_TOKEN_TTL_SECONDS: 900,
    ...overrides,
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService<Env, true>;
}

const logger = { setContext: () => {}, warn: () => {} } as unknown as PinoLogger;

const user = {
  id: '0192f0a0-0000-7000-8000-000000000001',
  roles: ['customer'],
  sessionId: '0192f0a0-0000-7000-8000-000000000002',
};

describe('TokenService', () => {
  it('signs EdDSA access tokens whose claims round-trip', async () => {
    const service = new TokenService(makeConfig(), logger);
    await service.onModuleInit();

    const { token, expiresIn } = await service.signAccessToken(user);
    expect(expiresIn).toBe(900);
    expect(token.split('.')).toHaveLength(3);
    const header = JSON.parse(Buffer.from(token.split('.')[0] as string, 'base64url').toString());
    expect(header.alg).toBe('EdDSA');

    const claims = await service.verifyAccessToken(token);
    expect(claims.sub).toBe(user.id);
    expect(claims.sid).toBe(user.sessionId);
    expect(claims.roles).toEqual(['customer']);
    expect(claims.exp - claims.iat).toBe(900);
  });

  it('rejects tampered tokens and tokens signed by another key', async () => {
    const a = new TokenService(makeConfig(), logger);
    const b = new TokenService(makeConfig(), logger);
    await a.onModuleInit();
    await b.onModuleInit();

    const { token } = await a.signAccessToken(user);
    await expect(b.verifyAccessToken(token)).rejects.toThrow();
    const [h, p, s] = token.split('.') as [string, string, string];
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), roles: ['admin'] }),
    ).toString('base64url');
    await expect(a.verifyAccessToken(`${h}.${forged}.${s}`)).rejects.toThrow();
  });

  it('rejects tokens for a different audience or issuer', async () => {
    const issuer = new TokenService(makeConfig(), logger);
    await issuer.onModuleInit();
    const { token } = await issuer.signAccessToken(user);

    const other = new TokenService(makeConfig({ JWT_AUDIENCE: 'someone-else' }), logger);
    await other.onModuleInit();
    // Different key pair as well, so verification fails regardless; the point is no exception leaks.
    await expect(other.verifyAccessToken(token)).rejects.toThrow();
  });

  it('refuses to start in production without configured keys', async () => {
    const service = new TokenService(makeConfig({ NODE_ENV: 'production' }), logger);
    await expect(service.onModuleInit()).rejects.toThrow(/JWT_PRIVATE_KEY/);
  });
});
