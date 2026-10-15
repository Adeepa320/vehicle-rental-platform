import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DocumentTypeSchema,
  VehicleDocumentTypeSchema,
  type AdminDocument,
  type AdminDocumentList,
  type AdminDocumentListQuery,
  type ApproveDocumentRequest,
  type DocumentVerification,
  type ProviderDocument,
  type ProviderDocumentListQuery,
  type RejectDocumentRequest,
  type RequestDocumentReplacementRequest,
} from '@vrp/contracts';
import {
  providerProfiles,
  uuidv7,
  users,
  vehicles,
  verificationDocuments,
  type Database,
  type DatabaseExecutor,
  type ProviderProfile,
  type VerificationDocument,
} from '@vrp/database';
import { and, desc, eq, inArray, isNull, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';

import { ApiException } from '../../common/errors/api.exception';
import { decodeCursor, paginate } from '../../common/pagination';
import type { Env } from '../../config/env.schema';
import { DATABASE } from '../../database/database.module';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser, RequestMeta } from '../auth/auth.types';
import { vehicleLabel } from '../catalogue/catalogue.helpers';
import { VehiclesService } from '../catalogue/vehicles.service';
import {
  documentApprovedEmail,
  documentRejectedEmail,
  documentReplacementRequestedEmail,
} from '../notifications/email/admin-templates';
import { EmailService } from '../notifications/email/email.service';
import { NotificationsService } from '../notifications/inapp/notifications.service';
import { assertSafeKey } from '../storage/storage.provider';
import { StorageService } from '../storage/storage.service';
import { sniffDocument } from './document-sniff';
import {
  DOCUMENT_TYPE_LABEL,
  addDays,
  colomboDay,
  daysUntilExpiry,
  effectiveStatus,
  providerVerification,
  vehicleVerification,
} from './document.verification';

export interface UploadedDocument {
  buffer: Buffer;
  size: number;
}

export interface DocumentContent {
  buffer: Buffer;
  mimeType: string;
  /** Neutral download name (`revenue_licence.pdf`); never the uploader's file name. */
  fileName: string;
}

interface DocumentRowSet {
  document: VerificationDocument;
  provider: Pick<ProviderProfile, 'id' | 'displayName' | 'status' | 'providerType' | 'userId'>;
  vehicle: {
    id: string;
    title: string | null;
    make: string | null;
    model: string | null;
    modelYear: number | null;
    status: string;
  } | null;
}

/**
 * Private verification documents (Phase 9, TECH_DECISIONS D61). Uploads are
 * sniffed by content, stored in the private bucket under a server-generated
 * key and never exposed through a URL: the owner streams their own file, an
 * admin streams any file and every admin read is audited. Review decisions
 * are status-conditioned updates with an audit row and a provider
 * notification in one transaction. Nothing here is public; the public
 * "verified" booleans come from `document.verification.ts`.
 */
@Injectable()
export class DocumentsService {
  private readonly webAppUrl: string;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly vehicles: VehiclesService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    private readonly notifications: NotificationsService,
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(DocumentsService.name);
    this.webAppUrl = config.get('WEB_APP_URL', { infer: true }).replace(/\/+$/, '');
  }

  // ------------------------------------------------------------ provider

  async upload(
    provider: ProviderProfile,
    fields: {
      type: string;
      vehicleId?: string;
      documentNumber?: string;
      issuedOn?: string;
      expiresOn?: string;
    },
    file: UploadedDocument,
    meta: RequestMeta,
  ): Promise<VerificationDocument> {
    const type = DocumentTypeSchema.parse(fields.type);
    const scope = (VehicleDocumentTypeSchema.options as readonly string[]).includes(type)
      ? 'vehicle'
      : 'provider';
    if (scope === 'vehicle') {
      // Ownership: another provider's vehicle is 404 like everywhere else in the inventory.
      await this.vehicles.getOwned(provider.id, fields.vehicleId as string);
    }
    const sniffed = await sniffDocument(file.buffer);
    const id = uuidv7();
    const storageKey = `documents/${provider.id}/${id}.${sniffed.extension}`;
    assertSafeKey(storageKey);
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    await this.storage.put({
      bucket: 'private',
      key: storageKey,
      body: file.buffer,
      contentType: sniffed.mimeType,
    });

    return this.db.transaction(async (tx) => {
      const now = new Date();
      // A new upload of the same type supersedes the current one; history stays.
      await tx
        .update(verificationDocuments)
        .set({ supersededAt: now })
        .where(
          and(
            eq(verificationDocuments.providerId, provider.id),
            eq(verificationDocuments.type, type),
            scope === 'vehicle'
              ? eq(verificationDocuments.vehicleId, fields.vehicleId as string)
              : isNull(verificationDocuments.vehicleId),
            isNull(verificationDocuments.supersededAt),
          ),
        );
      const [row] = await tx
        .insert(verificationDocuments)
        .values({
          id,
          providerId: provider.id,
          vehicleId: scope === 'vehicle' ? (fields.vehicleId as string) : null,
          scope,
          type,
          storageKey,
          mimeType: sniffed.mimeType,
          sizeBytes: file.size,
          sha256,
          documentNumber: fields.documentNumber ?? null,
          issuedOn: fields.issuedOn ?? null,
          expiresOn: fields.expiresOn ?? null,
          uploadedBy: provider.userId,
        })
        .returning();
      if (!row) throw new Error('Failed to store document');
      await this.audit.record(
        {
          actorUserId: provider.userId,
          actorType: 'provider',
          action: 'document.uploaded',
          targetType: 'document',
          targetId: row.id,
          ip: meta.ip ?? null,
          metadata: {
            providerId: provider.id,
            vehicleId: row.vehicleId,
            scope,
            type,
            mimeType: sniffed.mimeType,
            bytes: file.size,
          },
        },
        tx,
      );
      return row;
    });
  }

  async listForProvider(
    providerId: string,
    query: ProviderDocumentListQuery,
  ): Promise<ProviderDocument[]> {
    const rows = await this.db
      .select()
      .from(verificationDocuments)
      .where(
        and(
          eq(verificationDocuments.providerId, providerId),
          query.vehicleId ? eq(verificationDocuments.vehicleId, query.vehicleId) : undefined,
          query.includeHistory ? undefined : isNull(verificationDocuments.supersededAt),
        ),
      )
      .orderBy(desc(verificationDocuments.createdAt), desc(verificationDocuments.id));
    const today = colomboDay();
    return rows.map((row) => this.toProviderView(row, today));
  }

  async contentForProvider(providerId: string, id: string): Promise<DocumentContent> {
    const [row] = await this.db
      .select()
      .from(verificationDocuments)
      .where(
        and(eq(verificationDocuments.id, id), eq(verificationDocuments.providerId, providerId)),
      )
      .limit(1);
    if (!row) throw new ApiException('NOT_FOUND', 'Document not found', 404);
    return this.content(row);
  }

  // --------------------------------------------------------------- admin

  async listForAdmin(query: AdminDocumentListQuery): Promise<AdminDocumentList> {
    const cursor = decodeCursor(query.cursor);
    const today = colomboDay();
    const conditions: (SQL | undefined)[] = [
      query.scope ? eq(verificationDocuments.scope, query.scope) : undefined,
      query.providerId ? eq(verificationDocuments.providerId, query.providerId) : undefined,
      query.vehicleId ? eq(verificationDocuments.vehicleId, query.vehicleId) : undefined,
      cursor
        ? or(
            lt(verificationDocuments.createdAt, cursor.createdAt),
            and(
              eq(verificationDocuments.createdAt, cursor.createdAt),
              lt(verificationDocuments.id, cursor.id),
            ),
          )
        : undefined,
    ];
    if (query.status === 'superseded') {
      conditions.push(sql`${verificationDocuments.supersededAt} is not null`);
    } else {
      conditions.push(isNull(verificationDocuments.supersededAt));
      if (query.status === 'expired') {
        conditions.push(eq(verificationDocuments.status, 'approved'));
        conditions.push(sql`${verificationDocuments.expiresOn} <= ${today}::date`);
      } else if (query.status === 'approved') {
        conditions.push(eq(verificationDocuments.status, 'approved'));
        conditions.push(
          or(
            isNull(verificationDocuments.expiresOn),
            sql`${verificationDocuments.expiresOn} > ${today}::date`,
          ),
        );
      } else if (query.status) {
        conditions.push(eq(verificationDocuments.status, query.status));
      }
    }
    if (query.expiringWithinDays !== undefined) {
      conditions.push(eq(verificationDocuments.status, 'approved'));
      conditions.push(
        lte(verificationDocuments.expiresOn, addDays(today, query.expiringWithinDays)),
      );
    }
    const rows = await this.rows(this.db)
      .where(and(...conditions))
      .orderBy(desc(verificationDocuments.createdAt), desc(verificationDocuments.id))
      .limit(query.limit + 1);
    const page = paginate(
      rows.map((r) => ({ ...r, createdAt: r.document.createdAt, id: r.document.id })),
      query.limit,
    );
    return {
      data: page.data.map((r) => this.toAdminView(r, today)),
      nextCursor: page.nextCursor,
    };
  }

  async getForAdmin(id: string): Promise<AdminDocument> {
    const [row] = await this.rows(this.db).where(eq(verificationDocuments.id, id)).limit(1);
    if (!row) throw new ApiException('NOT_FOUND', 'Document not found', 404);
    return this.toAdminView(row, colomboDay());
  }

  /** Every admin read of a private file is written to the audit trail (SECURITY_AND_PRIVACY §3.2). */
  async contentForAdmin(
    admin: AuthenticatedUser,
    id: string,
    meta: RequestMeta,
  ): Promise<DocumentContent> {
    const [row] = await this.db
      .select()
      .from(verificationDocuments)
      .where(eq(verificationDocuments.id, id))
      .limit(1);
    if (!row) throw new ApiException('NOT_FOUND', 'Document not found', 404);
    await this.audit.record({
      actorUserId: admin.id,
      actorType: 'admin',
      action: 'document.viewed',
      targetType: 'document',
      targetId: row.id,
      ip: meta.ip ?? null,
      metadata: { providerId: row.providerId, vehicleId: row.vehicleId, type: row.type },
    });
    return this.content(row);
  }

  async approve(
    admin: AuthenticatedUser,
    id: string,
    input: ApproveDocumentRequest,
    meta: RequestMeta,
    now = new Date(),
  ): Promise<AdminDocument> {
    await this.db.transaction(async (tx) => {
      const row = await this.lockCurrent(tx, id);
      if (row.status !== 'pending') {
        throw new ApiException(
          'INVALID_STATE_TRANSITION',
          `Only a pending document can be approved (this one is ${row.status})`,
          409,
        );
      }
      const expiresOn = input.expiresOn === undefined ? row.expiresOn : input.expiresOn;
      await tx
        .update(verificationDocuments)
        .set({
          status: 'approved',
          reviewedBy: admin.id,
          reviewedAt: now,
          reviewReason: null,
          expiresOn,
        })
        .where(eq(verificationDocuments.id, id));
      await this.audit.record(
        this.adminEvent(admin, 'document.approved', row, meta, input.note ?? null, {
          expiresOn,
        }),
        tx,
      );
      await this.notifyProvider(tx, row, {
        type: 'document.approved',
        title: `${await this.labelFor(tx, row)} approved`,
        body: expiresOn
          ? `Our team approved the document; it is valid until ${expiresOn}.`
          : 'Our team approved the document.',
        dedupeKey: `document:${row.id}:approved`,
        email: (base) => documentApprovedEmail({ ...base, expiresOn }),
      });
    });
    return this.getForAdmin(id);
  }

  async reject(
    admin: AuthenticatedUser,
    id: string,
    input: RejectDocumentRequest,
    meta: RequestMeta,
    now = new Date(),
  ): Promise<AdminDocument> {
    await this.db.transaction(async (tx) => {
      const row = await this.lockCurrent(tx, id);
      if (row.status !== 'pending') {
        throw new ApiException(
          'INVALID_STATE_TRANSITION',
          `Only a pending document can be rejected (this one is ${row.status})`,
          409,
        );
      }
      await tx
        .update(verificationDocuments)
        .set({
          status: 'rejected',
          reviewedBy: admin.id,
          reviewedAt: now,
          reviewReason: input.reason,
        })
        .where(eq(verificationDocuments.id, id));
      await this.audit.record(
        this.adminEvent(admin, 'document.rejected', row, meta, input.reason),
        tx,
      );
      await this.notifyProvider(tx, row, {
        type: 'document.rejected',
        title: `${await this.labelFor(tx, row)} not approved`,
        body: `Our team could not approve the document: ${input.reason}`,
        dedupeKey: `document:${row.id}:rejected`,
        email: (base) => documentRejectedEmail({ ...base, reason: input.reason }),
      });
    });
    return this.getForAdmin(id);
  }

  /** Keeps an approved document valid while asking the provider for a newer version. */
  async requestReplacement(
    admin: AuthenticatedUser,
    id: string,
    input: RequestDocumentReplacementRequest,
    meta: RequestMeta,
    now = new Date(),
  ): Promise<AdminDocument> {
    await this.db.transaction(async (tx) => {
      const row = await this.lockCurrent(tx, id);
      if (row.status !== 'approved') {
        throw new ApiException(
          'INVALID_STATE_TRANSITION',
          'A replacement can be requested for an approved document only; reject a pending one instead',
          409,
        );
      }
      await tx
        .update(verificationDocuments)
        .set({ replacementRequestedAt: now, reviewReason: input.reason })
        .where(eq(verificationDocuments.id, id));
      await this.audit.record(
        this.adminEvent(admin, 'document.replacement_requested', row, meta, input.reason),
        tx,
      );
      await this.notifyProvider(tx, row, {
        type: 'document.replacement_requested',
        title: `New ${(await this.labelFor(tx, row)).toLowerCase()} needed`,
        body: `Our team asks for a new version: ${input.reason}`,
        dedupeKey: `document:${row.id}:replacement:${now.getTime()}`,
        email: (base) => documentReplacementRequestedEmail({ ...base, reason: input.reason }),
      });
    });
    return this.getForAdmin(id);
  }

  // -------------------------------------------------------- verification

  async verificationForVehicle(
    vehicleId: string,
    executor: DatabaseExecutor = this.db,
  ): Promise<DocumentVerification> {
    const rows = await executor
      .select()
      .from(verificationDocuments)
      .where(
        and(
          eq(verificationDocuments.vehicleId, vehicleId),
          isNull(verificationDocuments.supersededAt),
        ),
      );
    return vehicleVerification(rows, colomboDay());
  }

  async verificationForProvider(
    provider: Pick<ProviderProfile, 'id' | 'providerType'>,
    executor: DatabaseExecutor = this.db,
  ): Promise<DocumentVerification> {
    const rows = await executor
      .select()
      .from(verificationDocuments)
      .where(
        and(
          eq(verificationDocuments.providerId, provider.id),
          eq(verificationDocuments.scope, 'provider'),
          isNull(verificationDocuments.supersededAt),
        ),
      );
    return providerVerification(provider.providerType, rows, colomboDay());
  }

  /** Current, non-superseded documents of several vehicles (admin lists). */
  async currentForVehicles(
    vehicleIds: readonly string[],
  ): Promise<Map<string, VerificationDocument[]>> {
    const out = new Map<string, VerificationDocument[]>();
    if (vehicleIds.length === 0) return out;
    const rows = await this.db
      .select()
      .from(verificationDocuments)
      .where(
        and(
          inArray(verificationDocuments.vehicleId, [...vehicleIds]),
          isNull(verificationDocuments.supersededAt),
        ),
      );
    for (const row of rows) {
      const list = out.get(row.vehicleId as string) ?? [];
      list.push(row);
      out.set(row.vehicleId as string, list);
    }
    return out;
  }

  // ------------------------------------------------------------- helpers

  private rows(executor: DatabaseExecutor) {
    return executor
      .select({
        document: verificationDocuments,
        provider: {
          id: providerProfiles.id,
          displayName: providerProfiles.displayName,
          status: providerProfiles.status,
          providerType: providerProfiles.providerType,
          userId: providerProfiles.userId,
        },
        vehicle: {
          id: vehicles.id,
          title: vehicles.title,
          make: vehicles.make,
          model: vehicles.model,
          modelYear: vehicles.modelYear,
          status: vehicles.status,
        },
      })
      .from(verificationDocuments)
      .innerJoin(providerProfiles, eq(providerProfiles.id, verificationDocuments.providerId))
      .leftJoin(vehicles, eq(vehicles.id, verificationDocuments.vehicleId))
      .$dynamic();
  }

  private async lockCurrent(tx: DatabaseExecutor, id: string): Promise<VerificationDocument> {
    const [row] = await tx
      .select()
      .from(verificationDocuments)
      .where(eq(verificationDocuments.id, id))
      .for('update');
    if (!row) throw new ApiException('NOT_FOUND', 'Document not found', 404);
    if (row.supersededAt) {
      throw new ApiException(
        'INVALID_STATE_TRANSITION',
        'A newer upload replaced this document; review the current one',
        409,
      );
    }
    return row;
  }

  private async content(row: VerificationDocument): Promise<DocumentContent> {
    const buffer = await this.storage.get('private', row.storageKey);
    if (!buffer) throw new ApiException('NOT_FOUND', 'Document file not found', 404);
    const extension =
      row.mimeType === 'application/pdf' ? 'pdf' : row.mimeType === 'image/png' ? 'png' : 'jpg';
    return { buffer, mimeType: row.mimeType, fileName: `${row.type}.${extension}` };
  }

  /** The owner's projection of a row (no storage key, no reviewer identity). */
  providerView(row: VerificationDocument): ProviderDocument {
    return this.toProviderView(row, colomboDay());
  }

  private toProviderView(row: VerificationDocument, today: string): ProviderDocument {
    return {
      id: row.id,
      scope: row.scope,
      type: DocumentTypeSchema.parse(row.type),
      vehicleId: row.vehicleId,
      status: row.status,
      effectiveStatus: effectiveStatus(row, today),
      mimeType: row.mimeType as ProviderDocument['mimeType'],
      sizeBytes: row.sizeBytes,
      documentNumber: row.documentNumber,
      issuedOn: row.issuedOn,
      expiresOn: row.expiresOn,
      reviewReason: row.reviewReason,
      reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
      replacementRequestedAt: row.replacementRequestedAt
        ? row.replacementRequestedAt.toISOString()
        : null,
      supersededAt: row.supersededAt ? row.supersededAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toAdminView(row: DocumentRowSet, today: string): AdminDocument {
    return {
      ...this.toProviderView(row.document, today),
      provider: {
        id: row.provider.id,
        displayName: row.provider.displayName,
        status: row.provider.status,
      },
      vehicle: row.vehicle
        ? { id: row.vehicle.id, title: vehicleLabel(row.vehicle), status: row.vehicle.status }
        : null,
      uploadedBy: row.document.uploadedBy,
      reviewedBy: row.document.reviewedBy,
      daysUntilExpiry: daysUntilExpiry(row.document, today),
    };
  }

  private adminEvent(
    admin: AuthenticatedUser,
    action: string,
    row: VerificationDocument,
    meta: RequestMeta,
    reason: string | null,
    extra: Record<string, unknown> = {},
  ) {
    return {
      actorUserId: admin.id,
      actorType: 'admin' as const,
      action,
      targetType: 'document',
      targetId: row.id,
      reason,
      ip: meta.ip ?? null,
      metadata: { providerId: row.providerId, vehicleId: row.vehicleId, type: row.type, ...extra },
    };
  }

  /** "Revenue licence of Toyota Aqua 2018" / "Identity document". */
  private async labelFor(executor: DatabaseExecutor, row: VerificationDocument): Promise<string> {
    const base = DOCUMENT_TYPE_LABEL[DocumentTypeSchema.parse(row.type)];
    if (!row.vehicleId) return base;
    const [vehicle] = await executor
      .select({
        title: vehicles.title,
        make: vehicles.make,
        model: vehicles.model,
        modelYear: vehicles.modelYear,
      })
      .from(vehicles)
      .where(eq(vehicles.id, row.vehicleId))
      .limit(1);
    return vehicle ? `${base} of ${vehicleLabel(vehicle)}` : base;
  }

  private async notifyProvider(
    tx: DatabaseExecutor,
    row: VerificationDocument,
    input: {
      type: 'document.approved' | 'document.rejected' | 'document.replacement_requested';
      title: string;
      body: string;
      dedupeKey: string;
      email: (base: {
        to: string;
        fullName: string;
        documentLabel: string;
        link: string;
      }) => Parameters<EmailService['enqueue']>[0];
    },
  ): Promise<void> {
    const [owner] = await tx
      .select({ id: users.id, email: users.email, fullName: users.fullName })
      .from(providerProfiles)
      .innerJoin(users, eq(users.id, providerProfiles.userId))
      .where(eq(providerProfiles.id, row.providerId))
      .limit(1);
    if (!owner) return;
    const link = '/provider/documents';
    const created = await this.notifications.create(tx, {
      userId: owner.id,
      type: input.type,
      title: input.title,
      body: input.body,
      linkPath: link,
      metadata: { documentId: row.id, vehicleId: row.vehicleId },
      dedupeKey: input.dedupeKey,
    });
    if (!created) return;
    await this.email.enqueue(
      input.email({
        to: owner.email,
        fullName: owner.fullName,
        documentLabel: await this.labelFor(tx, row),
        link: `${this.webAppUrl}${link}`,
      }),
      tx,
    );
  }
}
