import { describe, expect, it } from 'vitest';

import {
  HttpUrlSchema,
  ProviderApplicationDraftSchema,
  ProviderApplicationRequiredSchema,
  ReviewReasonRequestSchema,
  SubmitProviderApplicationRequestSchema,
  UpdateProviderProfileRequestSchema,
} from '../index';

describe('provider application contracts', () => {
  it('accepts a partial draft and rejects review/role fields (mass assignment)', () => {
    expect(ProviderApplicationDraftSchema.safeParse({ displayName: 'Sunil Rentals' }).success).toBe(
      true,
    );
    for (const forbidden of [
      { status: 'approved' },
      { reviewReason: 'x' },
      { roles: ['provider'] },
      { approvedAt: new Date().toISOString() },
    ]) {
      expect(ProviderApplicationDraftSchema.safeParse(forbidden).success).toBe(false);
    }
  });

  it('requires the core fields at submission and lists each missing one', () => {
    const result = ProviderApplicationRequiredSchema.safeParse({ displayName: 'Sunil Rentals' });
    expect(result.success).toBe(false);
    const fields = result.success ? [] : result.error.issues.map((i) => String(i.path[0])).sort();
    expect(fields).toEqual(
      [
        'addressText',
        'contactName',
        'description',
        'districtId',
        'phone',
        'primaryPlaceId',
        'providerType',
        'vehicleCategoryIds',
      ].sort(),
    );
  });

  it('requires the agreement to be accepted explicitly', () => {
    expect(
      SubmitProviderApplicationRequestSchema.safeParse({ acceptProviderAgreement: true }).success,
    ).toBe(true);
    expect(
      SubmitProviderApplicationRequestSchema.safeParse({ acceptProviderAgreement: false }).success,
    ).toBe(false);
    expect(SubmitProviderApplicationRequestSchema.safeParse({}).success).toBe(false);
  });

  it('only accepts http(s) website URLs', () => {
    expect(HttpUrlSchema.safeParse('https://sunil-rentals.lk').success).toBe(true);
    expect(HttpUrlSchema.safeParse('http://facebook.com/sunilrentals').success).toBe(true);
    expect(HttpUrlSchema.safeParse('javascript:alert(1)').success).toBe(false);
    expect(HttpUrlSchema.safeParse('ftp://example.com').success).toBe(false);
    expect(HttpUrlSchema.safeParse('not a url').success).toBe(false);
  });

  it('bounds reasons and notes', () => {
    expect(ReviewReasonRequestSchema.safeParse({ reason: 'tiny' }).success).toBe(false);
    expect(ReviewReasonRequestSchema.safeParse({ reason: 'x'.repeat(1001) }).success).toBe(false);
    expect(
      ReviewReasonRequestSchema.safeParse({ reason: 'Please add your operating address.' }).success,
    ).toBe(true);
  });

  it('profile updates cannot touch status or identity fields', () => {
    expect(UpdateProviderProfileRequestSchema.safeParse({ status: 'active' }).success).toBe(false);
    expect(UpdateProviderProfileRequestSchema.safeParse({ displayName: 'New' }).success).toBe(
      false,
    );
    expect(UpdateProviderProfileRequestSchema.safeParse({ phone: '+94771234567' }).success).toBe(
      true,
    );
  });
});
