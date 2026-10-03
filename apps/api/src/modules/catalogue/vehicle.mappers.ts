import {
  CURRENCY,
  vehicleSubmissionIssues,
  type AdminVehicle,
  type AdminVehicleSummary,
  type ProviderLocation as ProviderLocationView,
  type Vehicle as VehicleView,
  type VehicleFields,
  type VehicleHold as VehicleHoldView,
  type VehiclePhoto as VehiclePhotoView,
  type VehicleSummary,
} from '@vrp/contracts';
import type { ProviderLocation, ProviderProfile, User, Vehicle, VehicleHold } from '@vrp/database';

import { canSubmit, editability } from './vehicle.state';

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

/** Nullable camelCase view of the writable fields (input to `vehicleSubmissionIssues`). */
export type VehicleFieldValues = { [K in keyof VehicleFields]: VehicleFields[K] | null };

export function vehicleFields(row: Vehicle): VehicleFieldValues {
  return {
    categoryId: row.categoryId,
    locationId: row.locationId,
    title: row.title,
    internalName: row.internalName,
    make: row.make,
    model: row.model,
    modelYear: row.modelYear,
    transmission: row.transmission,
    fuelType: row.fuelType,
    seats: row.seats,
    doors: row.doors,
    luggageCapacity: row.luggageCapacity,
    engineCc: row.engineCc,
    hasAc: row.hasAc,
    color: row.color,
    registrationNumber: row.registrationNumber,
    description: row.description,
    dailyRate: row.dailyRate,
    weeklyRate: row.weeklyRate,
    monthlyRate: row.monthlyRate,
    securityDeposit: row.securityDeposit,
    includedKmPerDay: row.includedKmPerDay,
    extraKmRate: row.extraKmRate,
    minRentalDays: row.minRentalDays,
    maxRentalDays: row.maxRentalDays,
    minRenterAge: row.minRenterAge,
    minLicenceYears: row.minLicenceYears,
    fuelPolicy: row.fuelPolicy,
    deliveryAvailable: row.deliveryAvailable,
    deliveryFee: row.deliveryFee,
    pickupNotes: row.pickupNotes,
  };
}

/** Provider's own view: full registration number, photos, no admin notes. */
export function toVehicle(row: Vehicle, photos: VehiclePhotoView[]): VehicleView {
  const fields = vehicleFields(row);
  const issues = vehicleSubmissionIssues(fields, { photoCount: photos.length });
  return {
    id: row.id,
    providerId: row.providerId,
    status: row.status,
    slug: row.slug,
    photos,
    ...fields,
    categoryId: row.categoryId,
    hasAc: row.hasAc,
    minRentalDays: row.minRentalDays,
    deliveryAvailable: row.deliveryAvailable,
    currency: CURRENCY,
    reviewReason: row.reviewReason,
    suspensionReason: row.suspensionReason,
    submittedAt: iso(row.submittedAt),
    reviewStartedAt: iso(row.reviewStartedAt),
    changesRequestedAt: iso(row.changesRequestedAt),
    approvedAt: iso(row.approvedAt),
    rejectedAt: iso(row.rejectedAt),
    deactivatedAt: iso(row.deactivatedAt),
    suspendedAt: iso(row.suspendedAt),
    editable: editability(row.status),
    canSubmit: canSubmit(row.status) && issues.length === 0,
    submissionIssues: issues,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toVehicleSummary(row: Vehicle, photos: VehiclePhotoView[]): VehicleSummary {
  return {
    id: row.id,
    status: row.status,
    slug: row.slug,
    photoCount: photos.length,
    thumbnailUrl: photos[0]?.variants.thumb ?? null,
    categoryId: row.categoryId,
    locationId: row.locationId,
    title: row.title,
    make: row.make,
    model: row.model,
    modelYear: row.modelYear,
    registrationNumber: row.registrationNumber,
    dailyRate: row.dailyRate,
    submittedAt: iso(row.submittedAt),
    updatedAt: row.updatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export type OwnerRow = Pick<User, 'id' | 'email' | 'fullName'>;

export function toAdminVehicle(
  row: Vehicle,
  provider: ProviderProfile,
  owner: OwnerRow,
  location: ProviderLocation | null,
  locationVehicleCount: number,
  photos: VehiclePhotoView[],
): AdminVehicle {
  return {
    ...toVehicle(row, photos),
    adminNotes: row.adminNotes,
    reviewedBy: row.reviewedBy,
    reviewedAt: iso(row.reviewedAt),
    provider: {
      id: provider.id,
      displayName: provider.displayName,
      status: provider.status,
      owner: { id: owner.id, email: owner.email, fullName: owner.fullName },
    },
    location: location ? toProviderLocation(location, locationVehicleCount) : null,
  };
}

export function toAdminVehicleSummary(
  row: Vehicle,
  provider: Pick<ProviderProfile, 'id' | 'displayName'>,
  photos: VehiclePhotoView[],
): AdminVehicleSummary {
  return {
    ...toVehicleSummary(row, photos),
    provider: { id: provider.id, displayName: provider.displayName },
  };
}

export function toProviderLocation(
  row: ProviderLocation,
  vehicleCount: number,
): ProviderLocationView {
  return {
    id: row.id,
    providerId: row.providerId,
    name: row.name,
    districtId: row.districtId,
    placeId: row.placeId,
    addressText: row.addressText,
    point: row.geom ? { lat: row.geom.lat, lng: row.geom.lng } : null,
    pickupInstructions: row.pickupInstructions,
    isPrimary: row.isPrimary,
    isActive: row.isActive,
    vehicleCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toHold(row: VehicleHold): VehicleHoldView {
  return {
    id: row.id,
    vehicleId: row.vehicleId,
    kind: row.kind,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    reason: row.blockReason,
    note: row.note,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}
