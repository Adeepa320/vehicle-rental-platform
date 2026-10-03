import type {
  AdminProviderApplication,
  AdminProviderApplicationSummary,
  AdminProviderDetail,
  AdminProviderSummary,
  ProviderApplication as ProviderApplicationView,
  ProviderProfile as ProviderProfileView,
} from '@vrp/contracts';
import type { ProviderApplication, ProviderProfile, User } from '@vrp/database';

import { isEditable } from './provider-application.state';

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

/** Shape the required-field schema validates (camelCase view of the row). */
export function applicationFields(row: ProviderApplication) {
  return {
    displayName: row.displayName ?? undefined,
    providerType: row.providerType ?? undefined,
    contactName: row.contactName ?? undefined,
    phone: row.phoneE164 ?? undefined,
    addressText: row.addressText ?? undefined,
    districtId: row.districtId ?? undefined,
    primaryPlaceId: row.primaryPlaceId ?? undefined,
    description: row.description ?? undefined,
    vehicleCategoryIds: row.vehicleCategoryIds,
  };
}

export function toApplicantApplication(row: ProviderApplication): ProviderApplicationView {
  return {
    id: row.id,
    status: row.status,
    displayName: row.displayName,
    providerType: row.providerType,
    contactName: row.contactName,
    phone: row.phoneE164,
    whatsapp: row.whatsappE164,
    addressText: row.addressText,
    districtId: row.districtId,
    primaryPlaceId: row.primaryPlaceId,
    serviceAreaPlaceIds: row.serviceAreaPlaceIds,
    description: row.description,
    yearsOperating: row.yearsOperating,
    vehicleCategoryIds: row.vehicleCategoryIds,
    fleetSizeEstimate: row.fleetSizeEstimate,
    offersDelivery: row.offersDelivery,
    offersAirportTransfer: row.offersAirportTransfer,
    websiteUrl: row.websiteUrl,
    applicantNotes: row.applicantNotes,
    agreementAcceptedAt: iso(row.agreementAcceptedAt),
    agreementVersion: row.agreementVersion,
    submittedAt: iso(row.submittedAt),
    reviewStartedAt: iso(row.reviewStartedAt),
    changesRequestedAt: iso(row.changesRequestedAt),
    approvedAt: iso(row.approvedAt),
    rejectedAt: iso(row.rejectedAt),
    reviewReason: row.reviewReason,
    canEdit: isEditable(row.status),
    canSubmit: isEditable(row.status),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

type ApplicantRow = Pick<User, 'id' | 'email' | 'fullName' | 'emailVerifiedAt' | 'createdAt'>;

export function toAdminApplication(
  row: ProviderApplication,
  applicant: ApplicantRow,
): AdminProviderApplication {
  return {
    ...toApplicantApplication(row),
    adminNotes: row.adminNotes,
    reviewedBy: row.reviewedBy,
    reviewedAt: iso(row.reviewedAt),
    applicant: {
      id: applicant.id,
      email: applicant.email,
      fullName: applicant.fullName,
      emailVerified: applicant.emailVerifiedAt !== null,
      memberSince: applicant.createdAt.toISOString(),
    },
  };
}

export function toAdminApplicationSummary(
  row: ProviderApplication,
  applicant: Pick<User, 'id' | 'email' | 'fullName'>,
): AdminProviderApplicationSummary {
  return {
    id: row.id,
    status: row.status,
    displayName: row.displayName,
    providerType: row.providerType,
    districtId: row.districtId,
    applicant: { id: applicant.id, email: applicant.email, fullName: applicant.fullName },
    submittedAt: iso(row.submittedAt),
    updatedAt: row.updatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export interface ProfileRelations {
  serviceAreaPlaceIds: string[];
  vehicleCategoryIds: string[];
}

export function toProviderProfile(
  row: ProviderProfile,
  relations: ProfileRelations,
): ProviderProfileView {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.displayName,
    providerType: row.providerType,
    contactName: row.contactName,
    phone: row.phoneE164,
    phoneVerified: row.phoneVerifiedAt !== null,
    whatsapp: row.whatsappE164,
    description: row.description,
    addressText: row.addressText,
    districtId: row.districtId,
    primaryPlaceId: row.primaryPlaceId,
    serviceAreaPlaceIds: relations.serviceAreaPlaceIds,
    vehicleCategoryIds: relations.vehicleCategoryIds,
    yearsOperating: row.yearsOperating,
    fleetSizeEstimate: row.fleetSizeEstimate,
    offersDelivery: row.offersDelivery,
    offersAirportTransfer: row.offersAirportTransfer,
    websiteUrl: row.websiteUrl,
    status: row.status,
    approvedAt: row.approvedAt.toISOString(),
    suspendedAt: iso(row.suspendedAt),
    suspensionReason: row.suspensionReason,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toAdminProviderSummary(
  row: ProviderProfile,
  owner: Pick<User, 'id' | 'email' | 'fullName'>,
): AdminProviderSummary {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.displayName,
    providerType: row.providerType,
    status: row.status,
    districtId: row.districtId,
    approvedAt: row.approvedAt.toISOString(),
    suspendedAt: iso(row.suspendedAt),
    owner: { id: owner.id, email: owner.email, fullName: owner.fullName },
  };
}

export function toAdminProviderDetail(
  row: ProviderProfile,
  relations: ProfileRelations,
  owner: Pick<User, 'id' | 'email' | 'fullName'>,
): AdminProviderDetail {
  return {
    ...toProviderProfile(row, relations),
    owner: { id: owner.id, email: owner.email, fullName: owner.fullName },
    applicationId: row.applicationId,
    approvedBy: row.approvedBy,
  };
}
