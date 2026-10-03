import type { BookingActorType, BookingStatus } from '@vrp/contracts';
import {
  bookingDrivers,
  bookingEvents,
  bookings,
  districts,
  places,
  providerLocations,
  providerProfiles,
  users,
  vehicleHolds,
  vehicles,
  type Booking,
  type BookingDriver,
  type DatabaseExecutor,
  type ProviderLocation,
  type ProviderProfile,
  type Vehicle,
  type VehicleHold,
} from '@vrp/database';
import { and, asc, eq, gt, lt, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { vehicleLabel } from '../catalogue/catalogue.helpers';
import type { BookingEmailBase } from '../notifications/email/booking-templates';

/**
 * Shared read/write helpers for the booking services. Every function takes the
 * caller's executor so it can run inside the caller's transaction.
 */

export interface BookingCustomer {
  id: string;
  fullName: string;
  email: string;
  phoneE164: string | null;
  emailVerifiedAt: Date | null;
  createdAt: Date;
}

export interface BookingOwner {
  id: string;
  fullName: string;
  email: string;
}

/** A booking with everything the views and e-mails need. */
export interface BookingContext {
  booking: Booking;
  vehicle: Vehicle;
  provider: ProviderProfile;
  location: ProviderLocation;
  placeName: string;
  districtName: string;
  customer: BookingCustomer;
  owner: BookingOwner;
  driver: BookingDriver | null;
}

const customerUser = alias(users, 'customer_user');
const ownerUser = alias(users, 'owner_user');

function contextQuery(executor: DatabaseExecutor) {
  return executor
    .select({
      booking: bookings,
      vehicle: vehicles,
      provider: providerProfiles,
      location: providerLocations,
      placeName: places.name,
      districtName: districts.name,
      customer: {
        id: customerUser.id,
        fullName: customerUser.fullName,
        email: customerUser.email,
        phoneE164: customerUser.phoneE164,
        emailVerifiedAt: customerUser.emailVerifiedAt,
        createdAt: customerUser.createdAt,
      },
      owner: { id: ownerUser.id, fullName: ownerUser.fullName, email: ownerUser.email },
      driver: bookingDrivers,
    })
    .from(bookings)
    .innerJoin(vehicles, eq(vehicles.id, bookings.vehicleId))
    .innerJoin(providerProfiles, eq(providerProfiles.id, bookings.providerId))
    .innerJoin(providerLocations, eq(providerLocations.id, bookings.locationId))
    .innerJoin(places, eq(places.id, providerLocations.placeId))
    .innerJoin(districts, eq(districts.id, places.districtId))
    .innerJoin(customerUser, eq(customerUser.id, bookings.customerUserId))
    .innerJoin(ownerUser, eq(ownerUser.id, providerProfiles.userId))
    .leftJoin(bookingDrivers, eq(bookingDrivers.bookingId, bookings.id))
    .$dynamic();
}

export async function loadBookingContext(
  executor: DatabaseExecutor,
  where: SQL | undefined,
): Promise<BookingContext | undefined> {
  const [row] = await contextQuery(executor).where(where).limit(1);
  return row;
}

export async function loadBookingContexts(
  executor: DatabaseExecutor,
  where: SQL | undefined,
  orderBy: SQL[],
  limit: number,
): Promise<BookingContext[]> {
  return contextQuery(executor)
    .where(where)
    .orderBy(...orderBy)
    .limit(limit);
}

/** Row lock for a transition; `scope` narrows to the caller's own bookings (others are 404). */
export async function lockBooking(
  executor: DatabaseExecutor,
  id: string,
  scope: { customerUserId?: string; providerId?: string } = {},
): Promise<Booking | undefined> {
  const [row] = await executor
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.id, id),
        scope.customerUserId ? eq(bookings.customerUserId, scope.customerUserId) : undefined,
        scope.providerId ? eq(bookings.providerId, scope.providerId) : undefined,
      ),
    )
    .for('update');
  return row;
}

export interface BookingEventInput {
  bookingId: string;
  actorType: BookingActorType;
  actorUserId?: string | null;
  action: string;
  fromStatus?: BookingStatus | null;
  toStatus?: BookingStatus | null;
  metadata?: Record<string, unknown>;
}

/** Appends to the booking timeline; call inside the transaction of the change. */
export async function recordBookingEvent(
  executor: DatabaseExecutor,
  input: BookingEventInput,
): Promise<void> {
  await executor.insert(bookingEvents).values({
    bookingId: input.bookingId,
    actorType: input.actorType,
    actorUserId: input.actorUserId ?? null,
    action: input.action,
    fromStatus: input.fromStatus ?? null,
    toStatus: input.toStatus ?? null,
    metadata: input.metadata ?? null,
  });
}

export async function listBookingEvents(executor: DatabaseExecutor, bookingId: string) {
  return executor
    .select()
    .from(bookingEvents)
    .where(eq(bookingEvents.bookingId, bookingId))
    .orderBy(asc(bookingEvents.createdAt), asc(bookingEvents.id));
}

/** Deletes the booking's exclusive hold (if any); returns the deleted hold. */
export async function releaseBookingHold(
  executor: DatabaseExecutor,
  bookingId: string,
): Promise<VehicleHold | undefined> {
  const [deleted] = await executor
    .delete(vehicleHolds)
    .where(and(eq(vehicleHolds.bookingId, bookingId), eq(vehicleHolds.kind, 'booking')))
    .returning();
  return deleted;
}

export async function holdOfBooking(
  executor: DatabaseExecutor,
  bookingId: string,
): Promise<VehicleHold | undefined> {
  const [hold] = await executor
    .select()
    .from(vehicleHolds)
    .where(and(eq(vehicleHolds.bookingId, bookingId), eq(vehicleHolds.kind, 'booking')))
    .limit(1);
  return hold;
}

/** Holds whose half-open period intersects `[from, to)`. */
export async function overlappingHolds(
  executor: DatabaseExecutor,
  vehicleId: string,
  from: Date,
  to: Date,
): Promise<VehicleHold[]> {
  return executor
    .select()
    .from(vehicleHolds)
    .where(
      and(
        eq(vehicleHolds.vehicleId, vehicleId),
        lt(vehicleHolds.startsAt, to),
        gt(vehicleHolds.endsAt, from),
      ),
    )
    .orderBy(asc(vehicleHolds.startsAt));
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

export function vehicleTitleOf(vehicle: Vehicle): string {
  return vehicleLabel(vehicle);
}

/** The facts every booking e-mail repeats, for one recipient. */
export function bookingEmailBase(
  ctx: BookingContext,
  recipient: { email: string; fullName: string },
  link: string,
): BookingEmailBase {
  return {
    to: recipient.email,
    fullName: recipient.fullName,
    reference: ctx.booking.reference,
    vehicleTitle: vehicleTitleOf(ctx.vehicle),
    startsAt: ctx.booking.startsAt,
    endsAt: ctx.booking.endsAt,
    rentalDays: ctx.booking.rentalDays,
    subtotal: ctx.booking.subtotalAmount,
    link,
  };
}
