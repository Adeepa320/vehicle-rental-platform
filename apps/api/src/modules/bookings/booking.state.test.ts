import { BookingStatusSchema, type BookingStatus } from '@vrp/contracts';
import { describe, expect, it } from 'vitest';

import {
  BOOKING_TRANSITIONS,
  allowedActions,
  canPay,
  canTransition,
  contactAvailable,
  holdsVehicle,
  isTerminal,
  noShowAllowedAt,
  type BookingTransitionAction,
} from './booking.state';

const ALL = BookingStatusSchema.options;
const ACTIONS = Object.keys(BOOKING_TRANSITIONS) as BookingTransitionAction[];
const start = new Date('2026-11-12T03:30:00.000Z');
const base = {
  startsAt: start,
  now: new Date('2026-11-01T00:00:00.000Z'),
  noShowGraceHours: 3,
  revealStage: 'confirmed' as const,
  confirmBy: new Date('2026-11-02T00:00:00.000Z'),
  paymentState: 'not_started' as const,
};

describe('booking state machine', () => {
  it('matches the lifecycle table exactly (every action × every status)', () => {
    const expected: Record<BookingTransitionAction, BookingStatus[]> = {
      accept: ['requested'],
      decline: ['requested'],
      auto_decline: ['requested'],
      expire_request: ['requested'],
      expire_acceptance: ['accepted'],
      confirm: ['accepted'],
      cancel_by_customer: ['requested', 'accepted', 'confirmed'],
      cancel_by_provider: ['accepted', 'confirmed'],
      pickup: ['confirmed'],
      return: ['active'],
      no_show: ['confirmed'],
    };
    for (const action of ACTIONS) {
      for (const status of ALL) {
        expect(canTransition(action, status), `${action} from ${status}`).toBe(
          expected[action].includes(status),
        );
      }
    }
  });

  it('reaches confirmed only through the system (payment) action', () => {
    expect(BOOKING_TRANSITIONS.confirm.actor).toBe('system');
    expect(ACTIONS.filter((a) => BOOKING_TRANSITIONS[a].to === 'confirmed')).toEqual(['confirm']);
  });

  it('never leaves a terminal status', () => {
    for (const status of ALL) {
      const outgoing = ACTIONS.filter((a) => canTransition(a, status));
      if (isTerminal(status)) expect(outgoing, status).toEqual([]);
      else expect(outgoing.length, status).toBeGreaterThan(0);
    }
  });

  it('creates the hold only on accept and releases it on expiry, cancellation and no-show', () => {
    expect(ACTIONS.filter((a) => BOOKING_TRANSITIONS[a].createsHold)).toEqual(['accept']);
    expect(ACTIONS.filter((a) => BOOKING_TRANSITIONS[a].releasesHold).sort()).toEqual(
      ['cancel_by_customer', 'cancel_by_provider', 'expire_acceptance', 'no_show'].sort(),
    );
    expect(holdsVehicle('requested')).toBe(false);
    expect(holdsVehicle('accepted')).toBe(true);
    expect(holdsVehicle('completed')).toBe(true);
    expect(holdsVehicle('cancelled_by_customer')).toBe(false);
  });

  it('reveals contact details from the configured stage onwards, not after cancellation', () => {
    expect(contactAvailable('requested', 'confirmed')).toBe(false);
    expect(contactAvailable('accepted', 'confirmed')).toBe(false);
    expect(contactAvailable('accepted', 'accepted')).toBe(true);
    for (const status of ['confirmed', 'active', 'completed'] as const) {
      expect(contactAvailable(status, 'confirmed')).toBe(true);
    }
    expect(contactAvailable('cancelled_by_provider', 'confirmed')).toBe(false);
    expect(contactAvailable('no_show', 'accepted')).toBe(false);
  });

  it('lets the customer pay only while accepted, before the deadline and until paid', () => {
    expect(canPay({ ...base, status: 'accepted' })).toBe(true);
    expect(canPay({ ...base, status: 'accepted', paymentState: 'pending' })).toBe(true);
    expect(canPay({ ...base, status: 'accepted', paymentState: 'failed' })).toBe(true);
    expect(canPay({ ...base, status: 'accepted', paymentState: 'cancelled' })).toBe(true);
    expect(canPay({ ...base, status: 'accepted', paymentState: 'paid' })).toBe(false);
    expect(canPay({ ...base, status: 'accepted', now: new Date('2026-11-03T00:00:00.000Z') })).toBe(
      false,
    );
    expect(canPay({ ...base, status: 'accepted', confirmBy: null })).toBe(true);
    for (const status of ALL.filter((s) => s !== 'accepted')) {
      expect(canPay({ ...base, status }), status).toBe(false);
    }
  });

  it('offers the customer pay / cancel / contact per state', () => {
    expect(allowedActions({ ...base, viewer: 'customer', status: 'requested' })).toEqual([
      'cancel',
    ]);
    expect(allowedActions({ ...base, viewer: 'customer', status: 'accepted' })).toEqual([
      'pay',
      'cancel',
    ]);
    expect(
      allowedActions({ ...base, viewer: 'customer', status: 'accepted', paymentState: 'paid' }),
    ).toEqual(['cancel']);
    expect(allowedActions({ ...base, viewer: 'customer', status: 'confirmed' })).toEqual([
      'cancel',
      'reveal_contact',
    ]);
    expect(allowedActions({ ...base, viewer: 'customer', status: 'active' })).toEqual([
      'reveal_contact',
    ]);
    expect(allowedActions({ ...base, viewer: 'customer', status: 'declined' })).toEqual([]);
  });

  it('offers the provider the right actions per state', () => {
    expect(allowedActions({ ...base, viewer: 'provider', status: 'requested' })).toEqual([
      'accept',
      'decline',
    ]);
    expect(allowedActions({ ...base, viewer: 'provider', status: 'accepted' })).toEqual(['cancel']);
    expect(allowedActions({ ...base, viewer: 'provider', status: 'confirmed' })).toEqual([
      'pickup',
      'cancel',
      'reveal_contact',
    ]);
    expect(allowedActions({ ...base, viewer: 'provider', status: 'active' })).toEqual([
      'return',
      'reveal_contact',
    ]);
    expect(allowedActions({ ...base, viewer: 'provider', status: 'completed' })).toEqual([
      'reveal_contact',
    ]);
  });

  it('offers no-show only after the grace period has elapsed', () => {
    const before = new Date(start.getTime() + 2 * 3_600_000);
    const after = new Date(start.getTime() + 3 * 3_600_000);
    expect(noShowAllowedAt(start, 3)).toEqual(after);
    expect(
      allowedActions({ ...base, viewer: 'provider', status: 'confirmed', now: before }),
    ).not.toContain('no_show');
    expect(
      allowedActions({ ...base, viewer: 'provider', status: 'confirmed', now: after }),
    ).toContain('no_show');
  });

  it('offers admins no booking actions (confirmation comes from payment)', () => {
    for (const status of ALL) {
      expect(allowedActions({ ...base, viewer: 'admin', status }), status).toEqual([]);
    }
  });
});
