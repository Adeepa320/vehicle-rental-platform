import type { BookingEvent } from '@vrp/database';
import { describe, expect, it } from 'vitest';

import { VISIBLE_EVENT_METADATA, toBookingEvent, visibleEventMetadata } from './booking.mappers';

const PAYMENT_ID = '01a11193-3e95-7a05-a7eb-7a454bef4be1';
const HOLD_ID = '01a11193-59ba-7033-99b2-d4c793b71497';

function row(action: string, metadata: Record<string, unknown> | null): BookingEvent {
  return {
    id: '01a11193-0000-7000-8000-000000000001',
    bookingId: '01a11193-0000-7000-8000-000000000002',
    actorType: 'system',
    actorUserId: null,
    action,
    fromStatus: 'accepted',
    toStatus: 'confirmed',
    metadata,
    createdAt: new Date('2026-10-06T10:00:00Z'),
  };
}

const confirmed = row('booking.confirmed', {
  source: 'payment',
  gateway: 'payhere',
  amount: '2250.00',
  currency: 'LKR',
  paymentId: PAYMENT_ID,
  holdId: HOLD_ID,
});

describe('booking event metadata projection', () => {
  it('gives customers and providers only the allow-listed keys of a confirmation', () => {
    for (const viewer of ['customer', 'provider'] as const) {
      const event = toBookingEvent(confirmed, viewer);
      expect(event.metadata).toEqual({
        source: 'payment',
        gateway: 'payhere',
        amount: '2250.00',
        currency: 'LKR',
      });
      const serialized = JSON.stringify(event);
      expect(serialized).not.toContain(PAYMENT_ID);
      expect(serialized).not.toContain(HOLD_ID);
    }
  });

  it('keeps the stored metadata, ids included, for admins', () => {
    expect(toBookingEvent(confirmed, 'admin').metadata).toEqual(confirmed.metadata);
  });

  it('drops internal ids from other events too and hides unknown actions entirely', () => {
    expect(
      visibleEventMetadata(
        'booking.accepted',
        { holdId: HOLD_ID, confirmBy: '2026-10-07T10:00:00.000Z' },
        'customer',
      ),
    ).toEqual({ confirmBy: '2026-10-07T10:00:00.000Z' });
    expect(
      visibleEventMetadata(
        'booking.declined',
        { reason: 'vehicle_no_longer_available', automatic: true, acceptedBookingId: HOLD_ID },
        'provider',
      ),
    ).toEqual({ reason: 'vehicle_no_longer_available', automatic: true });
    expect(
      visibleEventMetadata('booking.something_new', { paymentId: PAYMENT_ID }, 'customer'),
    ).toBeNull();
    expect(visibleEventMetadata('booking.confirmed', null, 'customer')).toBeNull();
    expect(
      visibleEventMetadata('booking.confirmed', { paymentId: PAYMENT_ID }, 'provider'),
    ).toBeNull();
  });

  it('never allow-lists an identifier-looking key', () => {
    for (const keys of Object.values(VISIBLE_EVENT_METADATA)) {
      for (const key of keys) expect(key).not.toMatch(/id$/i);
    }
  });
});
