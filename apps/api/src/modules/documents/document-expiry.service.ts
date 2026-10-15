import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DOCUMENT_EXPIRY_REMINDER_DAYS, DocumentTypeSchema } from '@vrp/contracts';
import {
  notifications,
  providerProfiles,
  users,
  vehicles,
  verificationDocuments,
  type Database,
  type DatabaseExecutor,
  type VerificationDocument,
} from '@vrp/database';
import { and, asc, eq, isNull, lte } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';

import type { Env } from '../../config/env.schema';
import { DATABASE } from '../../database/database.module';
import { BookingSettingsService } from '../bookings/booking-settings.service';
import { vehicleLabel } from '../catalogue/catalogue.helpers';
import { VehiclesService } from '../catalogue/vehicles.service';
import {
  documentExpiredEmail,
  documentExpiringEmail,
} from '../notifications/email/admin-templates';
import { EmailService } from '../notifications/email/email.service';
import { NotificationsService } from '../notifications/inapp/notifications.service';
import {
  DOCUMENT_TYPE_LABEL,
  addDays,
  colomboDay,
  daysBetween,
  isExpiringVehicleType,
} from './document.verification';

export interface DocumentExpirySweepResult {
  reminders: number;
  expired: number;
  autoPaused: number;
}

const SWEEP_BATCH = 500;

/**
 * Daily document expiry sweep (Phase 9, TECH_DECISIONS D61; PRD FR-V6).
 * For every current, approved document with an expiry date it sends at most
 * one reminder per threshold (30 / 14 / 7 / 0 days before expiry, Colombo
 * calendar days), deduplicated at the database like every other reminder,
 * and — only when `auto_pause_on_document_expiry` is on — pauses the listing
 * (approved | inactive → suspended, actor `system`) on the day a revenue
 * licence or insurance expires. Existing bookings are never touched.
 */
@Injectable()
export class DocumentExpiryService {
  private readonly webAppUrl: string;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly settings: BookingSettingsService,
    private readonly vehicles: VehiclesService,
    private readonly email: EmailService,
    private readonly notifications: NotificationsService,
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(DocumentExpiryService.name);
    this.webAppUrl = config.get('WEB_APP_URL', { infer: true }).replace(/\/+$/, '');
  }

  async sweep(now: Date = new Date()): Promise<DocumentExpirySweepResult> {
    const result: DocumentExpirySweepResult = { reminders: 0, expired: 0, autoPaused: 0 };
    const today = colomboDay(now);
    const horizon = addDays(today, Math.max(...DOCUMENT_EXPIRY_REMINDER_DAYS));
    const due = await this.db
      .select({ id: verificationDocuments.id })
      .from(verificationDocuments)
      .where(
        and(
          eq(verificationDocuments.status, 'approved'),
          isNull(verificationDocuments.supersededAt),
          lte(verificationDocuments.expiresOn, horizon),
        ),
      )
      .orderBy(asc(verificationDocuments.expiresOn))
      .limit(SWEEP_BATCH);
    for (const { id } of due) {
      const outcome = await this.process(id, today, now);
      if (outcome.reminded) result.reminders += 1;
      if (outcome.expired) result.expired += 1;
      if (outcome.autoPaused) result.autoPaused += 1;
    }
    if (result.reminders + result.autoPaused > 0) {
      this.logger.info(result, 'Document expiry sweep');
    }
    return result;
  }

  /** Handles one document; returns what happened. Idempotent through the dedupe key. */
  async process(
    id: string,
    today: string = colomboDay(),
    now: Date = new Date(),
  ): Promise<{ reminded: boolean; expired: boolean; autoPaused: boolean }> {
    const settings = await this.settings.get();
    return this.db.transaction(async (tx) => {
      const [doc] = await tx
        .select()
        .from(verificationDocuments)
        .where(eq(verificationDocuments.id, id))
        .for('update');
      if (!doc || doc.status !== 'approved' || doc.supersededAt || !doc.expiresOn) {
        return { reminded: false, expired: false, autoPaused: false };
      }
      const daysLeft = daysBetween(today, doc.expiresOn);
      const threshold = [...DOCUMENT_EXPIRY_REMINDER_DAYS]
        .sort((a, b) => a - b)
        .find((t) => daysLeft <= t);
      if (threshold === undefined) return { reminded: false, expired: false, autoPaused: false };
      const dedupeKey = `document:${doc.id}:expiry:${threshold}`;
      const [already] = await tx
        .select({ id: notifications.id })
        .from(notifications)
        .where(eq(notifications.dedupeKey, dedupeKey))
        .limit(1);
      if (already) return { reminded: false, expired: false, autoPaused: false };

      const expired = threshold === 0;
      let autoPaused = false;
      if (
        expired &&
        settings.autoPauseOnDocumentExpiry &&
        doc.vehicleId &&
        isExpiringVehicleType(doc.type)
      ) {
        const label = DOCUMENT_TYPE_LABEL[DocumentTypeSchema.parse(doc.type)];
        const paused = await this.vehicles.systemSuspend(
          tx,
          doc.vehicleId,
          `${label} expired on ${doc.expiresOn}; upload the renewed document to have the listing reactivated`,
          { documentId: doc.id, type: doc.type, expiresOn: doc.expiresOn },
          now,
        );
        autoPaused = paused !== undefined;
      }
      await this.notify(tx, doc, { threshold, daysLeft, dedupeKey, autoPaused, settings });
      return { reminded: true, expired, autoPaused };
    });
  }

  private async notify(
    tx: DatabaseExecutor,
    doc: VerificationDocument,
    input: {
      threshold: number;
      daysLeft: number;
      dedupeKey: string;
      autoPaused: boolean;
      settings: { autoPauseOnDocumentExpiry: boolean };
    },
  ): Promise<void> {
    const [owner] = await tx
      .select({ id: users.id, email: users.email, fullName: users.fullName })
      .from(providerProfiles)
      .innerJoin(users, eq(users.id, providerProfiles.userId))
      .where(eq(providerProfiles.id, doc.providerId))
      .limit(1);
    if (!owner) return;
    let documentLabel = DOCUMENT_TYPE_LABEL[DocumentTypeSchema.parse(doc.type)];
    if (doc.vehicleId) {
      const [vehicle] = await tx
        .select({
          title: vehicles.title,
          make: vehicles.make,
          model: vehicles.model,
          modelYear: vehicles.modelYear,
        })
        .from(vehicles)
        .where(eq(vehicles.id, doc.vehicleId))
        .limit(1);
      if (vehicle) documentLabel = `${documentLabel} of ${vehicleLabel(vehicle)}`;
    }
    const expiresOn = doc.expiresOn as string;
    const link = '/provider/documents';
    const expired = input.threshold === 0;
    const created = await this.notifications.create(tx, {
      userId: owner.id,
      type: expired ? 'document.expired' : 'document.expiring',
      title: expired
        ? `${documentLabel} expired on ${expiresOn}`
        : `${documentLabel} expires in ${input.daysLeft} day${input.daysLeft === 1 ? '' : 's'}`,
      body: expired
        ? input.autoPaused
          ? 'The listing has been paused until a renewed document is approved. Existing bookings are not affected.'
          : 'Upload the renewed document to keep the verification badge.'
        : `Upload the renewed document before ${expiresOn}${
            input.settings.autoPauseOnDocumentExpiry &&
            doc.vehicleId &&
            isExpiringVehicleType(doc.type)
              ? '; otherwise the listing is paused automatically on expiry'
              : ''
          }.`,
      linkPath: link,
      metadata: { documentId: doc.id, vehicleId: doc.vehicleId },
      dedupeKey: input.dedupeKey,
    });
    if (!created) return;
    const base = {
      to: owner.email,
      fullName: owner.fullName,
      documentLabel,
      link: `${this.webAppUrl}${link}`,
    };
    await this.email.enqueue(
      expired
        ? documentExpiredEmail({ ...base, expiresOn, listingPaused: input.autoPaused })
        : documentExpiringEmail({
            ...base,
            expiresOn,
            daysLeft: input.daysLeft,
            autoPause:
              input.settings.autoPauseOnDocumentExpiry &&
              doc.vehicleId !== null &&
              isExpiringVehicleType(doc.type),
          }),
      tx,
    );
  }
}
