import { describe, expect, it } from 'vitest';

import {
  AdminBookingListQuerySchema,
  AdminCancelBookingRequestSchema,
  AnonymiseUserRequestSchema,
  COUPLED_MONEY_SETTING_KEYS,
  CreatePlaceRequestSchema,
  DISPUTABLE_BOOKING_STATUSES,
  OpenDisputeRequestSchema,
  PROTECTED_INACTIVE_CATEGORY_IDS,
  ReportQuerySchema,
  ReportsOverviewSchema,
  ResendNotificationRequestSchema,
  SETTING_DEFINITIONS,
  SETTING_KEYS,
  SignedLkrAmountSchema,
  TERMINAL_BOOKING_STATUSES,
  UpdateSettingsRequestSchema,
  UpdateVehicleCategoryRequestSchema,
  UploadDocumentFieldsSchema,
  anonymisedEmailFor,
  requiredProviderDocumentTypes,
} from '../index';

describe('Phase 9 admin contracts', () => {
  it('keeps every setting key defined with a schema and marks the money pair as coupled and high impact', () => {
    for (const key of SETTING_KEYS) {
      const definition = SETTING_DEFINITIONS[key];
      expect(definition.key).toBe(key);
      expect(definition.schema.safeParse(undefined).success).toBe(false);
    }
    expect(COUPLED_MONEY_SETTING_KEYS).toEqual(['default_commission_rate', 'advance_percentage']);
    expect(SETTING_DEFINITIONS.advance_percentage.highImpact).toBe(true);
    expect(SETTING_DEFINITIONS.default_commission_rate.highImpact).toBe(true);
    expect(SETTING_DEFINITIONS.advance_percentage.schema.safeParse(10).success).toBe(true);
    expect(SETTING_DEFINITIONS.advance_percentage.schema.safeParse(0).success).toBe(false);
    expect(SETTING_DEFINITIONS.advance_percentage.schema.safeParse(12.345).success).toBe(false);
    expect(SETTING_DEFINITIONS.contact_reveal_stage.schema.safeParse('paid').success).toBe(false);
    expect(SETTING_DEFINITIONS.auto_pause_on_document_expiry.schema.safeParse('true').success).toBe(
      false,
    );
  });

  it('refuses unknown setting keys and duplicate keys in one update', () => {
    const token = '2026-10-15T00:00:00.000Z';
    expect(
      UpdateSettingsRequestSchema.safeParse({
        changes: [{ key: 'payhere_merchant_secret', value: 'x', expectedUpdatedAt: token }],
      }).success,
    ).toBe(false);
    expect(
      UpdateSettingsRequestSchema.safeParse({
        changes: [
          { key: 'review_window_days', value: 10, expectedUpdatedAt: token },
          { key: 'review_window_days', value: 12, expectedUpdatedAt: token },
        ],
      }).success,
    ).toBe(false);
    expect(
      UpdateSettingsRequestSchema.safeParse({
        changes: [{ key: 'review_window_days', value: 10, expectedUpdatedAt: token }],
        reason: 'Shorter window',
      }).success,
    ).toBe(true);
  });

  it('validates document upload fields per scope', () => {
    const vehicleId = '0192f0a0-0000-7000-8000-000000000123';
    expect(UploadDocumentFieldsSchema.safeParse({ type: 'revenue_licence' }).success).toBe(false);
    expect(
      UploadDocumentFieldsSchema.safeParse({ type: 'identity_document', vehicleId }).success,
    ).toBe(false);
    expect(
      UploadDocumentFieldsSchema.safeParse({
        type: 'insurance_certificate',
        vehicleId,
        issuedOn: '2026-10-01',
        expiresOn: '2026-09-01',
      }).success,
    ).toBe(false);
    expect(
      UploadDocumentFieldsSchema.safeParse({
        type: 'insurance_certificate',
        vehicleId,
        issuedOn: '2026-10-01',
        expiresOn: '2027-10-01',
        documentNumber: 'POL-1',
      }).success,
    ).toBe(true);
    expect(UploadDocumentFieldsSchema.safeParse({ type: 'other', storageKey: 'x' }).success).toBe(
      false,
    );
    expect(requiredProviderDocumentTypes('individual')).toEqual(['identity_document']);
    expect(requiredProviderDocumentTypes('registered_business')).toEqual([
      'identity_document',
      'business_registration',
    ]);
  });

  it('keeps disputes to participants’ inputs and the documented statuses', () => {
    expect(
      OpenDisputeRequestSchema.safeParse({ reasonCode: 'vehicle_condition', description: 'short' })
        .success,
    ).toBe(false);
    expect(
      OpenDisputeRequestSchema.safeParse({
        reasonCode: 'vehicle_condition',
        description: 'The car had a deep scratch that was not shown in the listing photos.',
        status: 'resolved',
      }).success,
    ).toBe(false);
    expect(DISPUTABLE_BOOKING_STATUSES).toContain('cancelled_by_platform');
    expect(TERMINAL_BOOKING_STATUSES).toContain('cancelled_by_platform');
  });

  it('bounds the admin booking operations', () => {
    expect(
      AdminCancelBookingRequestSchema.safeParse({
        actor: 'referee',
        reason: 'long enough',
        version: 1,
      }).success,
    ).toBe(false);
    expect(
      AdminCancelBookingRequestSchema.safeParse({
        actor: 'platform',
        reason: 'Vehicle involved in an accident',
        version: 3,
      }).success,
    ).toBe(true);
    expect(ResendNotificationRequestSchema.safeParse({ template: 'marketing_blast' }).success).toBe(
      false,
    );
    expect(
      ResendNotificationRequestSchema.safeParse({ template: 'payment_reminder', to: 'x@y.z' })
        .success,
    ).toBe(false);
    expect(AdminBookingListQuerySchema.safeParse({ q: 'a' }).success).toBe(false);
    expect(
      AdminBookingListQuerySchema.safeParse({ from: '2026-10-01', to: '2026-10-31' }).success,
    ).toBe(true);
  });

  it('reports period refunds as non-negative sums and a signed revenue estimate', () => {
    const money = ReportsOverviewSchema.shape.money.shape;
    expect(money.refundedAmount.safeParse('-1.00').success).toBe(false);
    expect(money.estimatedPlatformRevenue.safeParse('-1000.00').success).toBe(true);
    expect(money.estimatedPlatformRevenue.safeParse('2250.00').success).toBe(true);
    expect(money.estimatedPlatformRevenue.safeParse('--1').success).toBe(false);
    expect(SignedLkrAmountSchema.safeParse('-0.5').success).toBe(true);
    expect(SignedLkrAmountSchema.safeParse('-1e3').success).toBe(false);
  });

  it('protects reference data and anonymisation inputs', () => {
    expect(PROTECTED_INACTIVE_CATEGORY_IDS).toEqual(['scooter', 'tuktuk']);
    expect(UpdateVehicleCategoryRequestSchema.safeParse({}).success).toBe(false);
    expect(
      CreatePlaceRequestSchema.safeParse({
        slug: 'ahangama',
        name: 'Ahangama',
        kind: 'town',
        districtId: 'galle',
        centre: { lat: 95, lng: 80.3 },
      }).success,
    ).toBe(false);
    expect(
      CreatePlaceRequestSchema.safeParse({
        slug: 'Ahangama Beach',
        name: 'Ahangama',
        kind: 'town',
        districtId: 'galle',
        centre: { lat: 5.97, lng: 80.3 },
      }).success,
    ).toBe(false);
    expect(ReportQuerySchema.safeParse({ from: '2026-10-15', to: '2026-10-01' }).success).toBe(
      false,
    );
    expect(ReportQuerySchema.safeParse({ from: '2020-01-01', to: '2026-10-01' }).success).toBe(
      false,
    );
    expect(AnonymiseUserRequestSchema.safeParse({ reason: 'Deletion request' }).success).toBe(
      false,
    );
    expect(anonymisedEmailFor('0192f0a0-0000-7000-8000-000000000123')).toBe(
      'deleted+0192f0a0-0000-7000-8000-000000000123@anonymised.invalid',
    );
  });
});
