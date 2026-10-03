import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import type { Env } from '../../config/env.schema';
import { PasswordService } from './password.service';

const config = {
  get: (key: string) => ({ ARGON2_MEMORY_KIB: 8192, ARGON2_TIME_COST: 1 })[key],
} as unknown as ConfigService<Env, true>;

describe('PasswordService', () => {
  const service = new PasswordService(config);

  it('hashes with Argon2id, salts every hash and verifies correctly', async () => {
    const first = await service.hash('correct horse battery staple');
    const second = await service.hash('correct horse battery staple');
    expect(first.startsWith('$argon2id$')).toBe(true);
    expect(first).not.toBe(second);
    expect(await service.verify(first, 'correct horse battery staple')).toBe(true);
    expect(await service.verify(first, 'Correct horse battery staple')).toBe(false);
  });

  it('treats malformed hashes as a mismatch instead of throwing', async () => {
    expect(await service.verify('not-a-hash', 'anything')).toBe(false);
    expect(await service.verifyDummy('anything')).toBe(false);
  });

  it('enforces the policy beyond length', () => {
    expect(service.checkPolicy('password1234')).toMatch(/common/);
    expect(service.checkPolicy('aaaaaaaaaaaa')).toMatch(/repeat/);
    expect(service.checkPolicy('nimal.perera!2026', { email: 'nimal.perera@example.com' })).toMatch(
      /email/,
    );
    expect(service.checkPolicy('Nimal Perera 2026', { fullName: 'Nimal Perera' })).toMatch(/name/);
    expect(service.checkPolicy('correct horse battery staple', { email: 'x@y.lk' })).toBeNull();
  });
});
