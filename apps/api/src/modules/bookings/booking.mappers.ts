import {
  BookingActorTypeSchema,
  CURRENCY,
  PriceLineSchema,
  type AdminBooking,
  type Booking as BookingView,
  type BookingEvent as BookingEventView,
  type BookingPrice,
  type BookingSummary,
  type BookingViewer,
} from '@vrp/contracts';
import type { Booking, BookingEvent, VehicleHold } from '@vrp/database';
import { z } from 'zod';

import { toHold } from '../catalogue/vehicle.mappers';
import type { BookingSettings } from './booking-settings.service';
import { firstName, vehicleTitleOf, type BookingContext } from './booking.persistence';
import { allowedActions, contactAvailable } from './booking.state';

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);
const LinesSchema = z.array(PriceLineSchema);

/** What the response depends on besides the booking itself. */
export interface ViewContext {
  viewer: BookingViewer;
  settings: BookingSettings;
  now: Date;
  testingConfirmationEnabled: boolean;
  thumbnailUrl: string | null;
}

/** The immutable snapshot, as stored; never recomputed from the vehicle. */
export function priceOf(b: Booking): BookingPrice {
  const lines = LinesSchema.safeParse(b.priceBreakdown);
  return {
    currency: CURRENCY,
    rentalDays: b.rentalDays,
    basis: b.priceBasis === 'weekly' || b.priceBasis === 'monthly' ? b.priceBasis : 'daily',
    dailyRate: b.dailyRate,
    weeklyRate: b.weeklyRate,
    monthlyRate: b.monthlyRate,
    subtotal: b.subtotalAmount,
    securityDeposit: b.securityDepositAmount,
    includedKmPerDay: b.includedKmPerDay,
    includedKmTotal: b.includedKmPerDay === null ? null : b.includedKmPerDay * b.rentalDays,
    extraKmRate: b.extraKmRate,
    lines: lines.success ? lines.data : [],
  };
}

export function toBookingEvent(row: BookingEvent): BookingEventView {
  const actor = BookingActorTypeSchema.safeParse(row.actorType);
  return {
    id: row.id,
    action: row.action,
    actorType: actor.success ? actor.data : 'system',
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    metadata: row.metadata ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Role-aware allow-list projection (SECURITY_AND_PRIVACY §3.2). Exact pickup
 * details and the registration number reach the customer only from the reveal
 * stage; the provider sees the customer's first name until then. Contact
 * details are never embedded here: they come from `GET /bookings/{id}/contact`.
 */
export function toBookingView(
  ctx: BookingContext,
  view: ViewContext,
  events: BookingEvent[],
): BookingView {
  const b = ctx.booking;
  const revealed = contactAvailable(b.status, view.settings.contactRevealStage);
  const customerSide = view.viewer === 'customer';
  const seesExactPickup = !customerSide || revealed;
  return {
    id: b.id,
    reference: b.reference,
    status: b.status,
    version: b.version,
    viewer: view.viewer,
    vehicle: {
      id: ctx.vehicle.id,
      slug: ctx.vehicle.slug,
      title: vehicleTitleOf(ctx.vehicle),
      make: ctx.vehicle.make ?? '',
      model: ctx.vehicle.model ?? '',
      modelYear: ctx.vehicle.modelYear ?? 0,
      categoryId: ctx.vehicle.categoryId,
      thumbnailUrl: view.thumbnailUrl,
      registrationNumber: seesExactPickup ? ctx.vehicle.registrationNumber : null,
    },
    provider: {
      id: ctx.provider.id,
      slug: ctx.provider.slug,
      displayName: ctx.provider.displayName,
      platformApproved: true,
    },
    customer: {
      id: ctx.customer.id,
      name:
        view.viewer === 'provider' && !revealed
          ? firstName(ctx.customer.fullName)
          : ctx.customer.fullName,
      memberSince: ctx.customer.createdAt.toISOString().slice(0, 7),
      emailVerified: ctx.customer.emailVerifiedAt !== null,
    },
    driver: ctx.driver
      ? {
          fullName: ctx.driver.fullName,
          countryCode: ctx.driver.countryCode,
          licenceCountry: ctx.driver.licenceCountry,
          licenceExpiresOn: ctx.driver.licenceExpiresOn,
        }
      : null,
    pickup: {
      locationName: ctx.location.name,
      placeName: ctx.placeName,
      districtName: ctx.districtName,
      address: seesExactPickup ? ctx.location.addressText : null,
      instructions: seesExactPickup ? ctx.location.pickupInstructions : null,
      point:
        seesExactPickup && ctx.location.geom
          ? { lat: ctx.location.geom.lat, lng: ctx.location.geom.lng }
          : null,
    },
    startsAt: b.startsAt.toISOString(),
    endsAt: b.endsAt.toISOString(),
    rentalDays: b.rentalDays,
    price: priceOf(b),
    customerNote: b.customerNote,
    providerNote: b.providerNote,
    respondBy: b.respondBy.toISOString(),
    confirmBy: iso(b.confirmBy),
    acceptedAt: iso(b.acceptedAt),
    confirmedAt: iso(b.confirmedAt),
    pickedUpAt: iso(b.pickedUpAt),
    completedAt: iso(b.completedAt),
    declinedAt: iso(b.declinedAt),
    expiredAt: iso(b.expiredAt),
    cancelledAt: iso(b.cancelledAt),
    noShowAt: iso(b.noShowAt),
    declineReason: b.declineReason,
    declineNote: b.declineNote,
    cancellationNote: b.cancellationNote,
    noShowNote: b.noShowNote,
    confirmationSource: b.confirmationSource === 'admin_testing' ? 'admin_testing' : null,
    handover: {
      pickupOdometerKm: b.pickupOdometerKm,
      pickupFuelLevel: b.pickupFuelLevel,
      pickupNote: b.pickupNote,
      returnOdometerKm: b.returnOdometerKm,
      returnFuelLevel: b.returnFuelLevel,
      returnNote: b.returnNote,
    },
    contact: { available: revealed, revealStage: view.settings.contactRevealStage },
    allowedActions: allowedActions({
      viewer: view.viewer,
      status: b.status,
      startsAt: b.startsAt,
      now: view.now,
      noShowGraceHours: view.settings.noShowGraceHours,
      revealStage: view.settings.contactRevealStage,
      testingConfirmationEnabled: view.testingConfirmationEnabled,
    }),
    events: events.map(toBookingEvent),
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

export function toBookingSummary(ctx: BookingContext, view: ViewContext): BookingSummary {
  const {
    events: _events,
    handover: _handover,
    pickup: _pickup,
    driver: _driver,
    customerNote: _customerNote,
    providerNote: _providerNote,
    ...summary
  } = toBookingView(ctx, view, []);
  return summary;
}

export function toAdminBookingView(
  ctx: BookingContext,
  view: ViewContext,
  events: BookingEvent[],
  hold: VehicleHold | null,
): AdminBooking {
  return {
    ...toBookingView(ctx, { ...view, viewer: 'admin' }, events),
    customerEmail: ctx.customer.email,
    providerEmail: ctx.owner.email,
    hold: hold ? toHold(hold) : null,
    testingConfirmationEnabled: view.testingConfirmationEnabled,
  };
}
