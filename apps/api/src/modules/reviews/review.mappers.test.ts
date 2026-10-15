import type { ReviewRow, Vehicle } from '@vrp/database';
import { describe, expect, it } from 'vitest';

import {
  toAdminReview,
  toProviderReview,
  toPublicReview,
  type ReviewRowSet,
} from './review.mappers';

const REVIEW_ID = '01a11193-0000-7000-8000-000000000001';
const BOOKING_ID = '01a11193-0000-7000-8000-000000000002';
const CUSTOMER_ID = '01a11193-0000-7000-8000-000000000003';
const ADMIN_ID = '01a11193-0000-7000-8000-000000000004';

function rowSet(overrides: Partial<ReviewRow> = {}): ReviewRowSet {
  const review: ReviewRow = {
    id: REVIEW_ID,
    bookingId: BOOKING_ID,
    customerUserId: CUSTOMER_ID,
    providerId: '01a11193-0000-7000-8000-000000000005',
    vehicleId: '01a11193-0000-7000-8000-000000000006',
    overallRating: 4,
    vehicleRating: 5,
    serviceRating: null,
    communicationRating: 3,
    comment: 'Clean car, <script>alert(1)</script> friendly handover',
    providerReply: 'Thank you!',
    providerRepliedAt: new Date('2026-10-12T10:00:00Z'),
    status: 'hidden',
    hiddenAt: new Date('2026-10-13T10:00:00Z'),
    hiddenBy: ADMIN_ID,
    hiddenReason: 'Contains a phone number',
    createdAt: new Date('2026-10-11T10:00:00Z'),
    updatedAt: new Date('2026-10-11T10:00:00Z'),
    ...overrides,
  };
  return {
    review,
    customer: {
      id: CUSTOMER_ID,
      fullName: 'Nimal Perera',
      email: 'nimal@example.com',
      status: 'active',
    },
    vehicle: {
      id: review.vehicleId,
      slug: 'toyota-aqua-2018-mirissa-ab12',
      title: 'Toyota Aqua 2018',
      make: 'Toyota',
      model: 'Aqua',
      modelYear: 2018,
    } as Vehicle,
    booking: {
      id: BOOKING_ID,
      reference: 'SLR-7F3K2Q',
      completedAt: new Date('2026-10-10T10:00:00Z'),
    },
    provider: { id: review.providerId, displayName: 'Sunil Rentals' },
  };
}

describe('review mappers', () => {
  it('public view carries ratings, comment, reply and a display name only', () => {
    const view = toPublicReview(rowSet());
    expect(view).toEqual({
      id: REVIEW_ID,
      overallRating: 4,
      vehicleRating: 5,
      serviceRating: null,
      communicationRating: 3,
      comment: 'Clean car, <script>alert(1)</script> friendly handover',
      reviewer: { displayName: 'Nimal P.' },
      providerReply: 'Thank you!',
      providerRepliedAt: '2026-10-12T10:00:00.000Z',
      createdAt: '2026-10-11T10:00:00.000Z',
      updatedAt: '2026-10-11T10:00:00.000Z',
    });
    const json = JSON.stringify(view);
    for (const forbidden of [
      BOOKING_ID,
      CUSTOMER_ID,
      ADMIN_ID,
      'nimal@example.com',
      'Perera',
      'SLR-7F3K2Q',
      'hidden',
      'Contains a phone number',
    ]) {
      expect(json, forbidden).not.toContain(forbidden);
    }
  });

  it('provider view adds the booking reference and vehicle, never the customer identity', () => {
    const view = toProviderReview(rowSet());
    expect(view.booking).toEqual({ id: BOOKING_ID, reference: 'SLR-7F3K2Q' });
    expect(view.vehicle.slug).toBe('toyota-aqua-2018-mirissa-ab12');
    expect(view.status).toBe('hidden');
    const json = JSON.stringify(view);
    for (const forbidden of [
      CUSTOMER_ID,
      'nimal@example.com',
      'Perera',
      'Contains a phone number',
      ADMIN_ID,
    ]) {
      expect(json, forbidden).not.toContain(forbidden);
    }
  });

  it('admin view keeps the moderation fields and the customer identity', () => {
    const view = toAdminReview(rowSet());
    expect(view.customer).toEqual({
      id: CUSTOMER_ID,
      name: 'Nimal Perera',
      email: 'nimal@example.com',
    });
    expect(view.hiddenReason).toBe('Contains a phone number');
    expect(view.hiddenBy).toBe(ADMIN_ID);
    expect(view.hiddenAt).toBe('2026-10-13T10:00:00.000Z');
  });
});
