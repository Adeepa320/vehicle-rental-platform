import { Inject, Injectable } from '@nestjs/common';
import {
  USER_DATA_EXPORT_LIST_LIMIT,
  USER_DATA_EXPORT_SCHEMA_VERSION,
  type UserDataExport,
} from '@vrp/contracts';
import {
  bookingDrivers,
  bookings,
  disputeMessages,
  disputes,
  notifications,
  payments,
  places,
  privacyRequests,
  providerLocations,
  providerProfiles,
  refreshTokens,
  reviews,
  userMfa,
  users,
  vehicles,
  verificationDocuments,
  type Database,
  type DatabaseExecutor,
} from '@vrp/database';
import { and, asc, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';

import { ApiException } from '../../common/errors/api.exception';
import { DATABASE } from '../../database/database.module';

const LIMIT = USER_DATA_EXPORT_LIST_LIMIT;
const iso = (value: Date | null | undefined): string | null => value?.toISOString() ?? null;

/** "Nimal P." — the same public display form reviews use for the other party. */
function displayName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? 'Customer';
  const initial = parts.length > 1 ? ` ${(parts.at(-1) as string).charAt(0).toUpperCase()}.` : '';
  return `${first}${initial}`;
}

/**
 * The personal-data export (Phase 10, PRD FR-A7, TECH_DECISIONS D69): an
 * allow-listed JSON document built from explicit field selections, never from
 * whole rows. It excludes password hashes, session and token material,
 * internal notes, the other party's private data beyond what this user
 * legitimately received through a booking, payment gateway identifiers,
 * storage keys and audit metadata. Each list is capped at
 * `USER_DATA_EXPORT_LIST_LIMIT`; the file lists which caps applied.
 */
@Injectable()
export class PrivacyExportService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async build(userId: string, now = new Date()): Promise<UserDataExport> {
    const db: DatabaseExecutor = this.db;
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new ApiException('NOT_FOUND', 'User not found', 404);
    const truncated: string[] = [];
    const capped = <T>(name: string, rows: T[]): T[] => {
      if (rows.length > LIMIT) {
        truncated.push(name);
        return rows.slice(0, LIMIT);
      }
      return rows;
    };

    const [sessionRow] = await db
      .select({ active: sql<number>`count(*)::int` })
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.userId, userId),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, now),
        ),
      );
    const [mfaRow] = await db
      .select({ confirmedAt: userMfa.confirmedAt })
      .from(userMfa)
      .where(eq(userMfa.userId, userId))
      .limit(1);

    const [provider] = await db
      .select()
      .from(providerProfiles)
      .where(and(eq(providerProfiles.userId, userId), isNull(providerProfiles.deletedAt)))
      .limit(1);

    // ---- bookings (as customer, and as the owning provider)
    const bookingWhere = provider
      ? or(eq(bookings.customerUserId, userId), eq(bookings.providerId, provider.id))
      : eq(bookings.customerUserId, userId);
    const bookingRows = capped(
      'bookings',
      await db
        .select({
          id: bookings.id,
          reference: bookings.reference,
          customerUserId: bookings.customerUserId,
          providerId: bookings.providerId,
          status: bookings.status,
          startsAt: bookings.startsAt,
          endsAt: bookings.endsAt,
          subtotalAmount: bookings.subtotalAmount,
          advanceAmount: bookings.advanceAmount,
          customerNote: bookings.customerNote,
          createdAt: bookings.createdAt,
          vehicleTitle: vehicles.title,
          vehicleMake: vehicles.make,
          vehicleModel: vehicles.model,
          vehicleYear: vehicles.modelYear,
          providerName: providerProfiles.displayName,
          customerName: users.fullName,
        })
        .from(bookings)
        .innerJoin(vehicles, eq(vehicles.id, bookings.vehicleId))
        .innerJoin(providerProfiles, eq(providerProfiles.id, bookings.providerId))
        .innerJoin(users, eq(users.id, bookings.customerUserId))
        .where(bookingWhere)
        .orderBy(desc(bookings.createdAt), desc(bookings.id))
        .limit(LIMIT + 1),
    );
    const customerBookingIds = bookingRows
      .filter((b) => b.customerUserId === userId)
      .map((b) => b.id);
    const drivers = new Map(
      customerBookingIds.length === 0
        ? []
        : (
            await db
              .select()
              .from(bookingDrivers)
              .where(inArray(bookingDrivers.bookingId, customerBookingIds))
          ).map((d) => [d.bookingId, d]),
    );
    const referenceById = new Map(bookingRows.map((b) => [b.id, b.reference]));

    const paymentRows =
      customerBookingIds.length === 0
        ? []
        : capped(
            'payments',
            await db
              .select({
                bookingId: payments.bookingId,
                amount: payments.amount,
                status: payments.status,
                paidAt: payments.paidAt,
                refundedAmount: payments.refundedAmount,
                refundedAt: payments.refundedAt,
                createdAt: payments.createdAt,
              })
              .from(payments)
              .where(inArray(payments.bookingId, customerBookingIds))
              .orderBy(desc(payments.createdAt))
              .limit(LIMIT + 1),
          );

    const reviewRows = capped(
      'reviews',
      await db
        .select({
          bookingReference: bookings.reference,
          overallRating: reviews.overallRating,
          comment: reviews.comment,
          status: reviews.status,
          createdAt: reviews.createdAt,
          providerReply: reviews.providerReply,
        })
        .from(reviews)
        .innerJoin(bookings, eq(bookings.id, reviews.bookingId))
        .where(eq(reviews.customerUserId, userId))
        .orderBy(desc(reviews.createdAt))
        .limit(LIMIT + 1),
    );

    const disputeRows = capped(
      'disputes',
      await db
        .select({
          id: disputes.id,
          bookingReference: bookings.reference,
          openedByUserId: disputes.openedByUserId,
          reasonCode: disputes.reasonCode,
          description: disputes.description,
          status: disputes.status,
          createdAt: disputes.createdAt,
        })
        .from(disputes)
        .innerJoin(bookings, eq(bookings.id, disputes.bookingId))
        .where(
          provider
            ? or(eq(bookings.customerUserId, userId), eq(bookings.providerId, provider.id))
            : eq(bookings.customerUserId, userId),
        )
        .orderBy(desc(disputes.createdAt))
        .limit(LIMIT + 1),
    );
    const myMessages =
      disputeRows.length === 0
        ? []
        : await db
            .select({
              disputeId: disputeMessages.disputeId,
              body: disputeMessages.body,
              createdAt: disputeMessages.createdAt,
            })
            .from(disputeMessages)
            .where(
              and(
                inArray(
                  disputeMessages.disputeId,
                  disputeRows.map((d) => d.id),
                ),
                eq(disputeMessages.authorUserId, userId),
              ),
            )
            .orderBy(asc(disputeMessages.createdAt));

    const notificationRows = capped(
      'notifications',
      await db
        .select({
          type: notifications.type,
          title: notifications.title,
          body: notifications.body,
          createdAt: notifications.createdAt,
        })
        .from(notifications)
        .where(eq(notifications.userId, userId))
        .orderBy(desc(notifications.createdAt))
        .limit(LIMIT + 1),
    );

    const requestRows = await db
      .select({
        type: privacyRequests.type,
        status: privacyRequests.status,
        requestedAt: privacyRequests.requestedAt,
        completedAt: privacyRequests.completedAt,
      })
      .from(privacyRequests)
      .where(eq(privacyRequests.userId, userId))
      .orderBy(desc(privacyRequests.requestedAt))
      .limit(LIMIT);

    const providerSection = provider ? await this.providerSection(db, provider.id, capped) : null;

    return {
      schemaVersion: USER_DATA_EXPORT_SCHEMA_VERSION,
      generatedAt: now.toISOString(),
      subject: { userId },
      truncated: truncated.sort(),
      account: {
        email: user.email,
        emailVerifiedAt: iso(user.emailVerifiedAt),
        fullName: user.fullName,
        phone: user.phoneE164,
        roles: user.roles,
        status: user.status,
        countryCode: user.countryCode,
        termsVersion: user.termsVersion,
        termsAcceptedAt: iso(user.termsAcceptedAt),
        privacyVersion: user.privacyVersion,
        createdAt: user.createdAt.toISOString(),
        lastLoginAt: iso(user.lastLoginAt),
      },
      preferences: { language: user.preferredLanguage, currency: user.preferredCurrency },
      sessions: { active: sessionRow?.active ?? 0, mfaEnrolled: Boolean(mfaRow?.confirmedAt) },
      provider: provider
        ? {
            displayName: provider.displayName,
            legalType: provider.providerType,
            status: provider.status,
            contactName: provider.contactName,
            contactPhone: provider.phoneE164,
            whatsappNumber: provider.whatsappE164,
            website: provider.websiteUrl,
            description: provider.description,
            createdAt: provider.createdAt.toISOString(),
            ...(providerSection as NonNullable<typeof providerSection>),
          }
        : null,
      bookings: bookingRows.map((b) => {
        const asCustomer = b.customerUserId === userId;
        const driver = asCustomer ? drivers.get(b.id) : undefined;
        return {
          reference: b.reference,
          role: asCustomer ? ('customer' as const) : ('provider' as const),
          status: b.status,
          startsAt: b.startsAt.toISOString(),
          endsAt: b.endsAt.toISOString(),
          vehicleTitle:
            b.vehicleTitle ??
            [b.vehicleMake, b.vehicleModel, b.vehicleYear].filter(Boolean).join(' '),
          counterparty: asCustomer ? b.providerName : displayName(b.customerName),
          rentalSubtotal: b.subtotalAmount,
          advanceAmount: b.advanceAmount,
          createdAt: b.createdAt.toISOString(),
          driver: driver
            ? {
                fullName: driver.fullName,
                licenceCountry: driver.licenceCountry,
                licenceExpiresOn: driver.licenceExpiresOn,
              }
            : null,
          customerNote: asCustomer ? b.customerNote : null,
        };
      }),
      payments: paymentRows.map((p) => ({
        bookingReference: referenceById.get(p.bookingId) ?? '',
        amount: p.amount,
        status: p.status,
        paidAt: iso(p.paidAt),
        refundedAmount: p.refundedAmount,
        refundedAt: iso(p.refundedAt),
      })),
      reviews: reviewRows.map((r) => ({
        bookingReference: r.bookingReference,
        overallRating: r.overallRating,
        comment: r.comment,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        providerReply: r.providerReply,
      })),
      disputes: disputeRows.map((d) => ({
        bookingReference: d.bookingReference,
        openedByMe: d.openedByUserId === userId,
        reasonCode: d.reasonCode,
        description: d.openedByUserId === userId ? d.description : null,
        status: d.status,
        createdAt: d.createdAt.toISOString(),
        myMessages: myMessages
          .filter((m) => m.disputeId === d.id)
          .map((m) => ({ body: m.body, createdAt: m.createdAt.toISOString() })),
      })),
      notifications: notificationRows.map((n) => ({
        type: n.type,
        title: n.title,
        body: n.body,
        createdAt: n.createdAt.toISOString(),
      })),
      privacyRequests: requestRows.map((r) => ({
        type: r.type,
        status: r.status,
        requestedAt: r.requestedAt.toISOString(),
        completedAt: iso(r.completedAt),
      })),
    };
  }

  private async providerSection(
    db: DatabaseExecutor,
    providerId: string,
    capped: <T>(name: string, rows: T[]) => T[],
  ): Promise<
    Pick<NonNullable<UserDataExport['provider']>, 'locations' | 'vehicles' | 'documents'>
  > {
    const locationRows = capped(
      'provider.locations',
      await db
        .select({
          name: providerLocations.name,
          addressLine: providerLocations.addressText,
          placeName: places.name,
          districtId: providerLocations.districtId,
          isActive: providerLocations.isActive,
        })
        .from(providerLocations)
        .leftJoin(places, eq(places.id, providerLocations.placeId))
        .where(eq(providerLocations.providerId, providerId))
        .orderBy(asc(providerLocations.name))
        .limit(LIMIT + 1),
    );
    const vehicleRows = capped(
      'provider.vehicles',
      await db
        .select({
          title: vehicles.title,
          make: vehicles.make,
          model: vehicles.model,
          modelYear: vehicles.modelYear,
          registrationNumber: vehicles.registrationNumber,
          status: vehicles.status,
          dailyRate: vehicles.dailyRate,
          createdAt: vehicles.createdAt,
        })
        .from(vehicles)
        .where(and(eq(vehicles.providerId, providerId), isNull(vehicles.deletedAt)))
        .orderBy(desc(vehicles.createdAt))
        .limit(LIMIT + 1),
    );
    const documentRows = capped(
      'provider.documents',
      await db
        .select({
          scope: verificationDocuments.scope,
          type: verificationDocuments.type,
          status: verificationDocuments.status,
          documentNumber: verificationDocuments.documentNumber,
          issuedOn: verificationDocuments.issuedOn,
          expiresOn: verificationDocuments.expiresOn,
          uploadedAt: verificationDocuments.createdAt,
        })
        .from(verificationDocuments)
        .where(eq(verificationDocuments.providerId, providerId))
        .orderBy(desc(verificationDocuments.createdAt))
        .limit(LIMIT + 1),
    );
    return {
      locations: locationRows.map((l) => ({
        name: l.name,
        addressLine: l.addressLine,
        placeName: l.placeName,
        districtId: l.districtId,
        isActive: l.isActive,
      })),
      vehicles: vehicleRows.map((v) => ({
        title: v.title ?? [v.make, v.model, v.modelYear].filter(Boolean).join(' '),
        registrationNumber: v.registrationNumber ?? '',
        status: v.status,
        dailyRate: v.dailyRate ?? '0.00',
        createdAt: v.createdAt.toISOString(),
      })),
      documents: documentRows.map((d) => ({
        scope: d.scope,
        type: d.type,
        status: d.status,
        documentNumber: d.documentNumber,
        issuedOn: d.issuedOn,
        expiresOn: d.expiresOn,
        uploadedAt: d.uploadedAt.toISOString(),
      })),
    };
  }
}
