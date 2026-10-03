import {
  HELD_BOOKING_STATUSES,
  TERMINAL_BOOKING_STATUSES,
  type BookingAction,
  type BookingActorType,
  type BookingStatus,
  type BookingViewer,
} from '@vrp/contracts';

/**
 * Booking state machine (USER_FLOWS §0, TECH_DECISIONS D12), table-driven so
 * every transition is checked the same way: the service runs a
 * status-conditioned `UPDATE … WHERE status IN (from) AND version = $v`.
 *
 *   requested ──accept (provider, creates hold)──▶ accepted ──confirm_for_testing (admin)──▶ confirmed ──pickup──▶ active ──return──▶ completed
 *       │  ├── decline / auto_decline ──▶ declined          │  └── expire_acceptance (releases hold)   ├── no_show (after grace, releases hold)
 *       │  ├── expire_request ─────────▶ expired            │                                          └── cancel_by_* (releases hold)
 *       │  └── cancel_by_customer ────▶ cancelled_by_customer
 *       └── (accepted | confirmed) ── cancel_by_customer / cancel_by_provider (release hold)
 *
 * Payment (Phase 7) replaces `confirm_for_testing` with the PayHere webhook.
 */
export type BookingTransitionAction =
  | 'accept'
  | 'decline'
  | 'auto_decline'
  | 'expire_request'
  | 'expire_acceptance'
  | 'confirm_for_testing'
  | 'cancel_by_customer'
  | 'cancel_by_provider'
  | 'pickup'
  | 'return'
  | 'no_show';

export interface BookingTransition {
  from: readonly BookingStatus[];
  to: BookingStatus;
  actor: BookingActorType;
  /** The transition inserts the exclusive `vehicle_holds` row. */
  createsHold: boolean;
  /** The transition deletes the booking's hold (completed bookings keep theirs as history). */
  releasesHold: boolean;
}

export const BOOKING_TRANSITIONS: Readonly<Record<BookingTransitionAction, BookingTransition>> = {
  accept: {
    from: ['requested'],
    to: 'accepted',
    actor: 'provider',
    createsHold: true,
    releasesHold: false,
  },
  decline: {
    from: ['requested'],
    to: 'declined',
    actor: 'provider',
    createsHold: false,
    releasesHold: false,
  },
  auto_decline: {
    from: ['requested'],
    to: 'declined',
    actor: 'system',
    createsHold: false,
    releasesHold: false,
  },
  expire_request: {
    from: ['requested'],
    to: 'expired',
    actor: 'system',
    createsHold: false,
    releasesHold: false,
  },
  expire_acceptance: {
    from: ['accepted'],
    to: 'expired',
    actor: 'system',
    createsHold: false,
    releasesHold: true,
  },
  confirm_for_testing: {
    from: ['accepted'],
    to: 'confirmed',
    actor: 'admin',
    createsHold: false,
    releasesHold: false,
  },
  cancel_by_customer: {
    from: ['requested', 'accepted', 'confirmed'],
    to: 'cancelled_by_customer',
    actor: 'customer',
    createsHold: false,
    releasesHold: true,
  },
  cancel_by_provider: {
    from: ['accepted', 'confirmed'],
    to: 'cancelled_by_provider',
    actor: 'provider',
    createsHold: false,
    releasesHold: true,
  },
  pickup: {
    from: ['confirmed'],
    to: 'active',
    actor: 'provider',
    createsHold: false,
    releasesHold: false,
  },
  return: {
    from: ['active'],
    to: 'completed',
    actor: 'provider',
    createsHold: false,
    releasesHold: false,
  },
  no_show: {
    from: ['confirmed'],
    to: 'no_show',
    actor: 'provider',
    createsHold: false,
    releasesHold: true,
  },
};

export function canTransition(action: BookingTransitionAction, from: BookingStatus): boolean {
  return BOOKING_TRANSITIONS[action].from.includes(from);
}

export function isTerminal(status: BookingStatus): boolean {
  return TERMINAL_BOOKING_STATUSES.includes(status);
}

/** Whether a booking in this status owns a `vehicle_holds` row. */
export function holdsVehicle(status: BookingStatus): boolean {
  return HELD_BOOKING_STATUSES.includes(status);
}

/** Statuses at or beyond the configured reveal stage (`accepted` or `confirmed`). */
export function contactAvailable(status: BookingStatus, revealStage: BookingStatus): boolean {
  const revealed: BookingStatus[] =
    revealStage === 'accepted'
      ? ['accepted', 'confirmed', 'active', 'completed']
      : ['confirmed', 'active', 'completed'];
  return revealed.includes(status);
}

export interface AllowedActionsContext {
  viewer: BookingViewer;
  status: BookingStatus;
  startsAt: Date;
  now: Date;
  noShowGraceHours: number;
  revealStage: BookingStatus;
  /** `POST /admin/bookings/{id}/confirm-for-testing` is enabled (never in production). */
  testingConfirmationEnabled: boolean;
}

/** The actions a client may offer this viewer right now (API_DESIGN §10.3 `allowedActions`). */
export function allowedActions(ctx: AllowedActionsContext): BookingAction[] {
  const actions: BookingAction[] = [];
  if (ctx.viewer === 'customer') {
    if (canTransition('cancel_by_customer', ctx.status)) actions.push('cancel');
  }
  if (ctx.viewer === 'provider') {
    if (canTransition('accept', ctx.status)) actions.push('accept');
    if (canTransition('decline', ctx.status)) actions.push('decline');
    if (canTransition('pickup', ctx.status)) actions.push('pickup');
    if (canTransition('return', ctx.status)) actions.push('return');
    if (canTransition('cancel_by_provider', ctx.status)) actions.push('cancel');
    if (
      canTransition('no_show', ctx.status) &&
      noShowAllowedAt(ctx.startsAt, ctx.noShowGraceHours) <= ctx.now
    ) {
      actions.push('no_show');
    }
  }
  if (ctx.viewer === 'admin') {
    if (ctx.testingConfirmationEnabled && canTransition('confirm_for_testing', ctx.status)) {
      actions.push('confirm_for_testing');
    }
  }
  if (ctx.viewer !== 'admin' && contactAvailable(ctx.status, ctx.revealStage)) {
    actions.push('reveal_contact');
  }
  return actions;
}

/** Earliest instant a provider may record a no-show. */
export function noShowAllowedAt(startsAt: Date, graceHours: number): Date {
  return new Date(startsAt.getTime() + graceHours * 3_600_000);
}
