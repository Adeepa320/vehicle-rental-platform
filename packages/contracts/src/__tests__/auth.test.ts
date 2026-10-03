import { describe, expect, it } from 'vitest';

import {
  EmailSchema,
  LoginRequestSchema,
  RegisterRequestSchema,
  UpdateProfileRequestSchema,
} from '../index';

describe('EmailSchema', () => {
  it('normalises case and whitespace', () => {
    expect(EmailSchema.parse('  Nimal.Perera@Example.COM ')).toBe('nimal.perera@example.com');
  });

  it('rejects malformed addresses', () => {
    expect(EmailSchema.safeParse('not-an-email').success).toBe(false);
    expect(EmailSchema.safeParse('a@b').success).toBe(false);
  });
});

describe('RegisterRequestSchema', () => {
  const valid = {
    fullName: 'Nimal Perera',
    email: 'nimal@example.com',
    password: 'correct horse battery',
    acceptTerms: true,
  };

  it('accepts a valid registration', () => {
    expect(RegisterRequestSchema.safeParse(valid).success).toBe(true);
  });

  it('requires accepted terms and a 10+ character password', () => {
    expect(RegisterRequestSchema.safeParse({ ...valid, acceptTerms: false }).success).toBe(false);
    expect(RegisterRequestSchema.safeParse({ ...valid, password: 'short' }).success).toBe(false);
  });

  it('rejects unknown keys such as roles (no self-assigned privileges)', () => {
    const result = RegisterRequestSchema.safeParse({ ...valid, roles: ['admin'] });
    expect(result.success).toBe(false);
  });
});

describe('LoginRequestSchema', () => {
  it('defaults the client to web', () => {
    const parsed = LoginRequestSchema.parse({ email: 'a@example.com', password: 'x' });
    expect(parsed.client).toBe('web');
  });
});

describe('UpdateProfileRequestSchema', () => {
  it('rejects role changes and validates phone numbers', () => {
    expect(UpdateProfileRequestSchema.safeParse({ roles: ['admin'] }).success).toBe(false);
    expect(UpdateProfileRequestSchema.safeParse({ phone: '0771234567' }).success).toBe(false);
    expect(UpdateProfileRequestSchema.safeParse({ phone: '+94771234567' }).success).toBe(true);
    expect(UpdateProfileRequestSchema.safeParse({ phone: null }).success).toBe(true);
  });
});
