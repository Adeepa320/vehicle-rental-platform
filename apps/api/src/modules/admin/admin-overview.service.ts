import { Inject, Injectable } from '@nestjs/common';
import type { AdminOverview, AdminOverviewItem } from '@vrp/contracts';
import {
  bookings,
  disputes,
  payments,
  providerApplications,
  providerProfiles,
  reviews,
  users,
  vehicles,
  verificationDocuments,
  type Database,
} from '@vrp/database';
import { eq, inArray, isNull, sql } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module';
import { BookingSettingsService } from '../bookings/booking-settings.service';
import { addDays, colomboDay } from '../documents/document.verification';

/** Operations home (Phase 9): counts of work waiting for a human, with the queue each one opens. */
@Injectable()
export class AdminOverviewService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly settings: BookingSettingsService,
  ) {}

  async overview(now = new Date()): Promise<AdminOverview> {
    const settings = await this.settings.get();
    const today = colomboDay(now);
    const dayStart = new Date(`${today}T00:00:00+05:30`);
    const dayEnd = new Date(`${addDays(today, 1)}T00:00:00+05:30`);
    const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
    const graceCutoff = new Date(now.getTime() - settings.noShowGraceHours * 3_600_000);

    const [apps] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(providerApplications)
      .where(inArray(providerApplications.status, ['submitted', 'under_review']));
    const [vehicleRows] = await this.db
      .select({
        awaiting: sql<number>`count(*) filter (where ${vehicles.status} in ('submitted', 'under_review'))::int`,
        suspended: sql<number>`count(*) filter (where ${vehicles.status} = 'suspended')::int`,
      })
      .from(vehicles)
      .where(isNull(vehicles.deletedAt));
    const [docs] = await this.db
      .select({
        pending: sql<number>`count(*) filter (where ${verificationDocuments.status} = 'pending')::int`,
        expiringSoon: sql<number>`count(*) filter (where ${verificationDocuments.status} = 'approved' and ${verificationDocuments.expiresOn} > ${today}::date and ${verificationDocuments.expiresOn} <= ${addDays(today, 30)}::date)::int`,
        expired: sql<number>`count(*) filter (where ${verificationDocuments.status} = 'approved' and ${verificationDocuments.expiresOn} <= ${today}::date)::int`,
      })
      .from(verificationDocuments)
      .where(isNull(verificationDocuments.supersededAt));
    const [disputeRow] = await this.db
      .select({
        open: sql<number>`count(*) filter (where ${disputes.status} = 'open')::int`,
        inReview: sql<number>`count(*) filter (where ${disputes.status} = 'in_review')::int`,
      })
      .from(disputes);
    const [pay] = await this.db
      .select({
        attention: sql<number>`count(*) filter (where ${payments.requiresManualResolution} = true)::int`,
        refundDue: sql<number>`count(*) filter (where ${payments.status} = 'paid' and ${payments.refundDueAmount} > 0)::int`,
        lateSuccess: sql<number>`count(*) filter (where ${payments.requiresManualResolution} = true and ${payments.anomaly} in ('late_success', 'duplicate_payment'))::int`,
      })
      .from(payments);
    const [book] = await this.db
      .select({
        awaitingPayment: sql<number>`count(*) filter (where ${bookings.status} = 'accepted')::int`,
        pickupsToday: sql<number>`count(*) filter (where ${bookings.status} = 'confirmed' and ${bookings.startsAt} >= ${dayStart.toISOString()}::timestamptz and ${bookings.startsAt} < ${dayEnd.toISOString()}::timestamptz)::int`,
        noShowCandidates: sql<number>`count(*) filter (where ${bookings.status} = 'confirmed' and ${bookings.startsAt} <= ${graceCutoff.toISOString()}::timestamptz)::int`,
        recentCancellations: sql<number>`count(*) filter (where ${bookings.status} in ('cancelled_by_customer', 'cancelled_by_provider', 'cancelled_by_platform') and ${bookings.cancelledAt} >= ${weekAgo.toISOString()}::timestamptz)::int`,
      })
      .from(bookings);
    const [hiddenReviews] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(reviews)
      .where(eq(reviews.status, 'hidden'));
    const [standing] = await this.db
      .select({
        suspendedUsers: sql<number>`(select count(*)::int from ${users} u where u.status = 'suspended')`,
        suspendedProviders: sql<number>`count(*) filter (where ${providerProfiles.status} = 'suspended')::int`,
      })
      .from(providerProfiles);

    const items: AdminOverviewItem[] = [
      item(
        'provider_applications',
        'Provider applications awaiting review',
        apps?.count ?? 0,
        '/admin/providers',
        'attention',
      ),
      item(
        'vehicles_awaiting_review',
        'Listings awaiting review',
        vehicleRows?.awaiting ?? 0,
        '/admin/vehicles?status=submitted',
        'attention',
      ),
      item(
        'documents_pending',
        'Documents awaiting verification',
        docs?.pending ?? 0,
        '/admin/documents?status=pending',
        'attention',
      ),
      item(
        'documents_expiring',
        'Documents expiring within 30 days',
        docs?.expiringSoon ?? 0,
        '/admin/documents?expiringWithinDays=30',
        'info',
      ),
      item(
        'documents_expired',
        'Approved documents already expired',
        docs?.expired ?? 0,
        '/admin/documents?status=expired',
        'attention',
      ),
      item(
        'disputes_open',
        'Open disputes',
        disputeRow?.open ?? 0,
        '/admin/disputes?status=open',
        'attention',
      ),
      item(
        'disputes_in_review',
        'Disputes in review',
        disputeRow?.inReview ?? 0,
        '/admin/disputes?status=in_review',
        'info',
      ),
      item(
        'payments_attention',
        'Payments needing manual resolution',
        pay?.attention ?? 0,
        '/admin/payments',
        'attention',
      ),
      item('refunds_due', 'Refunds due', pay?.refundDue ?? 0, '/admin/payments', 'attention'),
      item(
        'late_successes',
        'Late / duplicate payment successes',
        pay?.lateSuccess ?? 0,
        '/admin/payments',
        'attention',
      ),
      item(
        'accepted_awaiting_payment',
        'Accepted bookings awaiting payment',
        book?.awaitingPayment ?? 0,
        '/admin/bookings?status=accepted',
        'info',
      ),
      item(
        'pickups_today',
        'Confirmed pickups today',
        book?.pickupsToday ?? 0,
        '/admin/bookings?status=confirmed',
        'info',
      ),
      item(
        'no_show_candidates',
        'Confirmed bookings past pickup + grace (no-show candidates)',
        book?.noShowCandidates ?? 0,
        '/admin/bookings?status=confirmed',
        'attention',
      ),
      item(
        'recent_cancellations',
        'Cancellations in the last 7 days',
        book?.recentCancellations ?? 0,
        '/admin/bookings',
        'info',
      ),
      item(
        'hidden_reviews',
        'Hidden reviews',
        hiddenReviews?.count ?? 0,
        '/admin/reviews?status=hidden',
        'info',
      ),
      item(
        'suspended_users',
        'Suspended user accounts',
        standing?.suspendedUsers ?? 0,
        '/admin/users?status=suspended',
        'info',
      ),
      item(
        'suspended_providers',
        'Suspended providers',
        standing?.suspendedProviders ?? 0,
        '/admin/providers',
        'info',
      ),
      item(
        'suspended_vehicles',
        'Paused / suspended listings',
        vehicleRows?.suspended ?? 0,
        '/admin/vehicles?status=suspended',
        'info',
      ),
    ];
    return { items, generatedAt: now.toISOString() };
  }
}

function item(
  key: string,
  label: string,
  count: number,
  linkPath: string,
  tone: AdminOverviewItem['tone'],
): AdminOverviewItem {
  return { key, label, count, linkPath, tone };
}
