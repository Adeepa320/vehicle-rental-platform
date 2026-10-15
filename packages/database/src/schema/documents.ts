import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { uuidv7 } from '../ids';
import { auditColumns } from './_types';
import { providerProfiles } from './providers';
import { users } from './users';
import { vehicles } from './vehicles';

const tz = { withTimezone: true } as const;

export const documentScope = pgEnum('document_scope', ['provider', 'vehicle']);
export const documentStatus = pgEnum('document_status', ['pending', 'approved', 'rejected']);

/**
 * Private verification documents (Phase 9, TECH_DECISIONS D61). One table for
 * provider documents (`scope = provider`, `vehicle_id` NULL) and vehicle
 * documents (`scope = vehicle`): ownership is always the provider, so every
 * query is scoped by `provider_id`. The file lives in the **private** bucket
 * under a server-generated key that is never returned by any API; the only
 * reads are the owner's and an audited admin stream. A newer upload of the
 * same type supersedes the previous one (`superseded_at`) instead of
 * overwriting it, so review history survives. `expires_on` on an approved
 * document drives the daily expiry sweep; "expired" is derived, never stored.
 */
export const verificationDocuments = pgTable(
  'verification_documents',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => providerProfiles.id, { onDelete: 'cascade' }),
    vehicleId: uuid('vehicle_id').references(() => vehicles.id, { onDelete: 'cascade' }),
    scope: documentScope('scope').notNull(),
    /** `identity_document | business_registration | other | certificate_of_registration | revenue_licence | insurance_certificate | emission_certificate` (validated by the contracts). */
    type: text('type').notNull(),
    status: documentStatus('status').notNull().default('pending'),
    /** Private-bucket key, e.g. `documents/<providerId>/<documentId>.pdf`; never exposed. */
    storageKey: text('storage_key').notNull(),
    /** Sniffed from the bytes: `application/pdf`, `image/jpeg`, `image/png`. */
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256').notNull(),
    documentNumber: text('document_number'),
    issuedOn: date('issued_on'),
    expiresOn: date('expires_on'),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at', tz),
    /** Shown to the provider (rejection / replacement request). */
    reviewReason: text('review_reason'),
    replacementRequestedAt: timestamp('replacement_requested_at', tz),
    /** Set on the previous upload of the same type when a new one arrives. */
    supersededAt: timestamp('superseded_at', tz),
    ...auditColumns,
  },
  (t) => [
    index('verification_documents_provider_idx').on(t.providerId, t.scope, t.type, t.createdAt),
    index('verification_documents_vehicle_idx').on(t.vehicleId, t.type, t.createdAt),
    index('verification_documents_status_idx')
      .on(t.status, t.createdAt)
      .where(sql`${t.supersededAt} is null`),
    index('verification_documents_expiry_idx')
      .on(t.expiresOn)
      .where(sql`${t.status} = 'approved' and ${t.supersededAt} is null`),
    check(
      'verification_documents_scope_check',
      sql`(${t.scope} = 'vehicle') = (${t.vehicleId} is not null)`,
    ),
    check('verification_documents_size_check', sql`${t.sizeBytes} > 0`),
  ],
);

export type VerificationDocument = typeof verificationDocuments.$inferSelect;
export type NewVerificationDocument = typeof verificationDocuments.$inferInsert;
export type DocumentStatusValue = (typeof documentStatus.enumValues)[number];
