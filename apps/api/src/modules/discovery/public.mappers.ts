import {
  CURRENCY,
  approximatePoint,
  estimateRental,
  metresToKm,
  type ApproxPoint,
  type PublicAvailability,
  type PublicPhoto,
  type PublicPlace,
  type PublicPricing,
  type PublicProviderSummary,
  type PublicVehicleCard,
  type PublicVehicleDetail,
} from '@vrp/contracts';
import type { GeoPoint, ProviderProfile, Vehicle, VehiclePhoto } from '@vrp/database';

/**
 * Customer-safe projections (TECH_DECISIONS D44–D46). Everything here is an
 * explicit allow-list: exact coordinates, addresses, pickup instructions,
 * registration numbers, provider contact details and internal notes are never
 * copied. Public map points are snapped to the grid or fall back to the town.
 */

export interface PublicRow {
  vehicle: Vehicle;
  provider: Pick<ProviderProfile, 'id' | 'slug' | 'displayName'>;
  location: { geom: GeoPoint | null; placeId: string };
  place: { id: string; slug: string; name: string; districtId: string; geom: GeoPoint };
  districtName: string;
  /** Great-circle metres from the searched centre; null without a centre or a pin. */
  distanceM: number | null;
}

export interface SearchWindow {
  startsAt: string;
  endsAt: string;
  days: number;
}

export function approxPointOf(locationGeom: GeoPoint | null, placeGeom: GeoPoint): ApproxPoint {
  if (locationGeom) return { ...approximatePoint(locationGeom), source: 'approximate' };
  return { lat: placeGeom.lat, lng: placeGeom.lng, source: 'place' };
}

export function toPublicPlace(row: PublicRow): PublicPlace {
  return {
    id: row.place.id,
    slug: row.place.slug,
    name: row.place.name,
    districtId: row.place.districtId,
    districtName: row.districtName,
  };
}

export function toPublicPhoto(row: VehiclePhoto, variants: PublicPhoto['variants']): PublicPhoto {
  return {
    id: row.id,
    sortOrder: row.sortOrder,
    width: row.width,
    height: row.height,
    variants,
  };
}

/** Approved listings always carry a daily rate and deposit (enforced at submission/approval). */
export function toPublicPricing(v: Vehicle): PublicPricing {
  return {
    currency: CURRENCY,
    dailyRate: v.dailyRate ?? '0.00',
    weeklyRate: v.weeklyRate,
    monthlyRate: v.monthlyRate,
    securityDeposit: v.securityDeposit ?? '0.00',
    includedKmPerDay: v.includedKmPerDay,
    extraKmRate: v.extraKmRate,
    minRentalDays: v.minRentalDays,
    maxRentalDays: v.maxRentalDays,
  };
}

export function toCard(
  row: PublicRow,
  primaryPhoto: PublicPhoto | null,
  window: SearchWindow | null,
): PublicVehicleCard {
  const v = row.vehicle;
  const pricing = toPublicPricing(v);
  return {
    id: v.id,
    slug: v.slug ?? v.id,
    title: v.title ?? [v.make, v.model, v.modelYear].filter(Boolean).join(' '),
    categoryId: v.categoryId,
    make: v.make ?? '',
    model: v.model ?? '',
    modelYear: v.modelYear ?? 0,
    transmission: v.transmission,
    fuelType: v.fuelType,
    seats: v.seats,
    hasAc: v.hasAc,
    deliveryAvailable: v.deliveryAvailable,
    deliveryFee: v.deliveryAvailable ? v.deliveryFee : null,
    photo: primaryPhoto,
    provider: {
      id: row.provider.id,
      slug: row.provider.slug,
      displayName: row.provider.displayName,
      platformApproved: true,
    },
    place: toPublicPlace(row),
    approxPoint: approxPointOf(row.location.geom, row.place.geom),
    distanceKm: row.distanceM === null ? null : metresToKm(row.distanceM),
    pricing,
    estimate: window
      ? estimateRental(
          {
            dailyRate: pricing.dailyRate,
            weeklyRate: pricing.weeklyRate,
            monthlyRate: pricing.monthlyRate,
          },
          window.days,
        )
      : null,
  };
}

export function toDetail(
  row: PublicRow,
  photos: PublicPhoto[],
  provider: PublicProviderSummary,
  availability: PublicAvailability | null,
): PublicVehicleDetail {
  const { photo: _photo, estimate: _estimate, provider: _badge, ...card } = toCard(row, null, null);
  const v = row.vehicle;
  return {
    ...card,
    description: v.description,
    doors: v.doors,
    luggageCapacity: v.luggageCapacity,
    engineCc: v.engineCc,
    color: v.color,
    photos,
    rules: {
      minRenterAge: v.minRenterAge,
      minLicenceYears: v.minLicenceYears,
      fuelPolicy: v.fuelPolicy,
    },
    provider,
    availability,
  };
}

export function toProviderSummary(
  profile: ProviderProfile,
  primaryPlace: { slug: string; name: string },
  vehicleCount: number,
): PublicProviderSummary {
  return {
    id: profile.id,
    slug: profile.slug,
    displayName: profile.displayName,
    platformApproved: true,
    description: profile.description,
    yearsOperating: profile.yearsOperating,
    approvedSince: profile.approvedAt.toISOString().slice(0, 7),
    primaryPlace,
    districtId: profile.districtId,
    vehicleCount,
  };
}
