import { ProviderApplicationDraftSchema, type ProviderApplication } from '@vrp/contracts';
import { describe, expect, it } from 'vitest';

import { EMPTY_FORM, fromApplication, toDraft } from '../provider-form';

const MIRISSA = '0192f0a0-0000-7000-8000-000000000001';
const WELIGAMA = '0192f0a0-0000-7000-8000-000000000002';

const application = {
  displayName: 'Sunil Rentals',
  providerType: 'individual',
  contactName: 'Sunil Perera',
  phone: '+94771234567',
  whatsapp: null,
  addressText: '12 Beach Road, Mirissa',
  districtId: 'matara',
  primaryPlaceId: MIRISSA,
  serviceAreaPlaceIds: [WELIGAMA],
  description: 'Family-run car and scooter rental on the Mirissa beach road.',
  yearsOperating: 6,
  vehicleCategoryIds: ['car'],
  fleetSizeEstimate: null,
  offersDelivery: true,
  offersAirportTransfer: false,
  websiteUrl: 'https://sunil-rentals.example',
  applicantNotes: null,
} as unknown as ProviderApplication;

describe('provider application form conversion', () => {
  it('produces a valid, empty draft from the blank form', () => {
    const draft = toDraft(EMPTY_FORM);
    const parsed = ProviderApplicationDraftSchema.safeParse(draft);
    expect(parsed.success).toBe(true);
    expect(draft.displayName).toBeUndefined();
    expect(draft.providerType).toBeUndefined();
    expect(draft).toMatchObject({
      whatsapp: null,
      websiteUrl: null,
      applicantNotes: null,
      yearsOperating: null,
      fleetSizeEstimate: null,
      serviceAreaPlaceIds: [],
      vehicleCategoryIds: [],
      offersDelivery: false,
    });
  });

  it('round-trips an application through the form without losing fields', () => {
    const form = fromApplication(application);
    expect(form.yearsOperating).toBe('6');
    expect(form.fleetSizeEstimate).toBe('');
    expect(form.whatsapp).toBe('');

    const draft = ProviderApplicationDraftSchema.parse(toDraft(form));
    expect(draft).toEqual({
      displayName: 'Sunil Rentals',
      providerType: 'individual',
      contactName: 'Sunil Perera',
      phone: '+94771234567',
      whatsapp: null,
      addressText: '12 Beach Road, Mirissa',
      districtId: 'matara',
      primaryPlaceId: MIRISSA,
      serviceAreaPlaceIds: [WELIGAMA],
      description: 'Family-run car and scooter rental on the Mirissa beach road.',
      yearsOperating: 6,
      vehicleCategoryIds: ['car'],
      fleetSizeEstimate: null,
      offersDelivery: true,
      offersAirportTransfer: false,
      websiteUrl: 'https://sunil-rentals.example',
      applicantNotes: null,
    });
  });

  it('trims text and parses numbers', () => {
    const draft = toDraft({
      ...EMPTY_FORM,
      displayName: '  Sunil Rentals  ',
      fleetSizeEstimate: '12 ',
    });
    expect(draft.displayName).toBe('Sunil Rentals');
    expect(draft.fleetSizeEstimate).toBe(12);
  });

  it('never emits status, role or review fields (mass-assignment guard)', () => {
    const keys = Object.keys(toDraft(fromApplication(application)));
    for (const forbidden of [
      'status',
      'roles',
      'reviewReason',
      'adminNotes',
      'canEdit',
      'id',
      'userId',
    ]) {
      expect(keys).not.toContain(forbidden);
    }
    // And the shared contract itself is strict, so an injected key is rejected server-side too.
    expect(
      ProviderApplicationDraftSchema.safeParse({ ...toDraft(EMPTY_FORM), status: 'approved' })
        .success,
    ).toBe(false);
  });

  it('maps a missing application to the blank form', () => {
    expect(fromApplication(null)).toEqual(EMPTY_FORM);
  });
});
