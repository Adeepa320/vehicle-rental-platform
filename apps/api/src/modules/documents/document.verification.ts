import {
  EXPIRING_VEHICLE_DOCUMENT_TYPES,
  REQUIRED_VEHICLE_DOCUMENT_TYPES,
  requiredProviderDocumentTypes,
  type DocumentEffectiveStatus,
  type DocumentType,
  type DocumentVerification,
} from '@vrp/contracts';
import { verificationDocuments, type VerificationDocument } from '@vrp/database';
import { sql, type SQL } from 'drizzle-orm';

import { addDays, colomboDay, daysBetween } from '../../common/colombo-dates';

/**
 * Derived verification facts (Phase 9, TECH_DECISIONS D61). "Expired" is a
 * function of the Colombo calendar day, never a stored state, so a badge can
 * never lag behind the real validity. The SQL fragments below are used by the
 * public search / detail queries; the TypeScript helpers by the admin and
 * provider views. Both encode the same rule.
 */

export { addDays, colomboDay, daysBetween };

export function effectiveStatus(
  doc: Pick<VerificationDocument, 'status' | 'expiresOn' | 'supersededAt'>,
  today: string,
): DocumentEffectiveStatus {
  if (doc.supersededAt) return 'superseded';
  // PRD FR-V6: the badge is removed on the expiry day itself.
  if (doc.status === 'approved' && doc.expiresOn && doc.expiresOn <= today) return 'expired';
  return doc.status;
}

/** Null without an expiry date; negative once expired. */
export function daysUntilExpiry(
  doc: Pick<VerificationDocument, 'expiresOn'>,
  today: string,
): number | null {
  return doc.expiresOn ? daysBetween(today, doc.expiresOn) : null;
}

function summarise(
  required: readonly DocumentType[],
  current: readonly Pick<VerificationDocument, 'type' | 'status' | 'expiresOn' | 'supersededAt'>[],
  today: string,
): DocumentVerification {
  const byType = new Map<string, DocumentEffectiveStatus>();
  for (const doc of current) {
    if (doc.supersededAt) continue;
    byType.set(doc.type, effectiveStatus(doc, today));
  }
  const missing: DocumentType[] = [];
  const expired: DocumentType[] = [];
  const pending: DocumentType[] = [];
  for (const type of required) {
    const status = byType.get(type);
    if (status === 'approved') continue;
    if (status === 'expired') expired.push(type);
    else if (status === 'pending') pending.push(type);
    if (status !== 'expired') missing.push(type);
  }
  return { verified: missing.length === 0 && expired.length === 0, missing, expired, pending };
}

export function vehicleVerification(
  current: readonly Pick<VerificationDocument, 'type' | 'status' | 'expiresOn' | 'supersededAt'>[],
  today: string,
): DocumentVerification {
  return summarise(REQUIRED_VEHICLE_DOCUMENT_TYPES, current, today);
}

export function providerVerification(
  providerType: 'individual' | 'registered_business',
  current: readonly Pick<VerificationDocument, 'type' | 'status' | 'expiresOn' | 'supersededAt'>[],
  today: string,
): DocumentVerification {
  return summarise(requiredProviderDocumentTypes(providerType), current, today);
}

const COLOMBO_TODAY_SQL = sql`(now() at time zone 'Asia/Colombo')::date`;

/** Correlated boolean: every required vehicle document is approved, current and in date. */
export function vehicleDocumentsVerifiedSql(vehicleIdExpr: SQL): SQL<boolean> {
  const types = sql.join(
    REQUIRED_VEHICLE_DOCUMENT_TYPES.map((t) => sql`${t}`),
    sql`, `,
  );
  return sql<boolean>`((select count(distinct d.type) from ${verificationDocuments} d where d.vehicle_id = ${vehicleIdExpr} and d.status = 'approved' and d.superseded_at is null and (d.expires_on is null or d.expires_on > ${COLOMBO_TODAY_SQL}) and d.type in (${types})) = ${REQUIRED_VEHICLE_DOCUMENT_TYPES.length})`;
}

/** Correlated boolean: identity document approved (plus business registration for registered businesses). */
export function providerDocumentsVerifiedSql(
  providerIdExpr: SQL,
  providerTypeExpr: SQL,
): SQL<boolean> {
  const approved = (type: string) =>
    sql`exists (select 1 from ${verificationDocuments} d where d.provider_id = ${providerIdExpr} and d.scope = 'provider' and d.type = ${type} and d.status = 'approved' and d.superseded_at is null and (d.expires_on is null or d.expires_on > ${COLOMBO_TODAY_SQL}))`;
  return sql<boolean>`(${approved('identity_document')} and (${providerTypeExpr} = 'individual' or ${approved('business_registration')}))`;
}

/** Whether this document type drives the auto-pause rule when it expires. */
export function isExpiringVehicleType(type: string): boolean {
  return (EXPIRING_VEHICLE_DOCUMENT_TYPES as readonly string[]).includes(type);
}

export const DOCUMENT_TYPE_LABEL: Record<DocumentType, string> = {
  identity_document: 'Identity document',
  business_registration: 'Business registration',
  other: 'Other document',
  certificate_of_registration: 'Certificate of registration',
  revenue_licence: 'Revenue licence',
  insurance_certificate: 'Insurance certificate',
  emission_certificate: 'Emission certificate',
};
