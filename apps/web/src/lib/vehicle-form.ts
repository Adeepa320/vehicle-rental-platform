import {
  VEHICLE_IDENTITY_FIELDS,
  type FuelPolicy,
  type FuelType,
  type Transmission,
  type Vehicle,
} from '@vrp/contracts';

/** String-based form state for the vehicle listing (controlled inputs). */
export interface VehicleFormState {
  categoryId: string;
  locationId: string;
  title: string;
  internalName: string;
  make: string;
  model: string;
  modelYear: string;
  transmission: '' | Transmission;
  fuelType: '' | FuelType;
  seats: string;
  doors: string;
  luggageCapacity: string;
  engineCc: string;
  hasAc: boolean;
  color: string;
  registrationNumber: string;
  description: string;
  dailyRate: string;
  weeklyRate: string;
  monthlyRate: string;
  securityDeposit: string;
  /** When true, `includedKmPerDay` and `extraKmRate` are sent as null. */
  unlimitedKm: boolean;
  includedKmPerDay: string;
  extraKmRate: string;
  minRentalDays: string;
  maxRentalDays: string;
  minRenterAge: string;
  minLicenceYears: string;
  fuelPolicy: '' | FuelPolicy;
  deliveryAvailable: boolean;
  deliveryFee: string;
  pickupNotes: string;
}

export const EMPTY_VEHICLE_FORM: VehicleFormState = {
  categoryId: '',
  locationId: '',
  title: '',
  internalName: '',
  make: '',
  model: '',
  modelYear: '',
  transmission: '',
  fuelType: '',
  seats: '',
  doors: '',
  luggageCapacity: '',
  engineCc: '',
  hasAc: false,
  color: '',
  registrationNumber: '',
  description: '',
  dailyRate: '',
  weeklyRate: '',
  monthlyRate: '',
  securityDeposit: '',
  unlimitedKm: true,
  includedKmPerDay: '',
  extraKmRate: '',
  minRentalDays: '1',
  maxRentalDays: '',
  minRenterAge: '',
  minLicenceYears: '',
  fuelPolicy: '',
  deliveryAvailable: false,
  deliveryFee: '',
  pickupNotes: '',
};

const str = (value: string | number | null | undefined): string =>
  value === null || value === undefined ? '' : String(value);

export function fromVehicle(v: Vehicle): VehicleFormState {
  return {
    categoryId: v.categoryId,
    locationId: v.locationId ?? '',
    title: v.title ?? '',
    internalName: v.internalName ?? '',
    make: v.make ?? '',
    model: v.model ?? '',
    modelYear: str(v.modelYear),
    transmission: v.transmission ?? '',
    fuelType: v.fuelType ?? '',
    seats: str(v.seats),
    doors: str(v.doors),
    luggageCapacity: str(v.luggageCapacity),
    engineCc: str(v.engineCc),
    hasAc: v.hasAc,
    color: v.color ?? '',
    registrationNumber: v.registrationNumber ?? '',
    description: v.description ?? '',
    dailyRate: v.dailyRate ?? '',
    weeklyRate: v.weeklyRate ?? '',
    monthlyRate: v.monthlyRate ?? '',
    securityDeposit: v.securityDeposit ?? '',
    unlimitedKm: v.includedKmPerDay === null,
    includedKmPerDay: str(v.includedKmPerDay),
    extraKmRate: v.extraKmRate ?? '',
    minRentalDays: str(v.minRentalDays) || '1',
    maxRentalDays: str(v.maxRentalDays),
    minRenterAge: str(v.minRenterAge),
    minLicenceYears: str(v.minLicenceYears),
    fuelPolicy: v.fuelPolicy ?? '',
    deliveryAvailable: v.deliveryAvailable,
    deliveryFee: v.deliveryFee ?? '',
    pickupNotes: v.pickupNotes ?? '',
  };
}

const text = (value: string) => (value.trim() === '' ? undefined : value.trim());
const nullableText = (value: string) => (value.trim() === '' ? null : value.trim());
const int = (value: string) => (value.trim() === '' ? undefined : Number(value));
const nullableInt = (value: string) => (value.trim() === '' ? null : Number(value));

/**
 * Converts the form into the PATCH/POST payload validated by
 * `UpdateVehicleRequestSchema`: required-ish text is omitted when empty,
 * optional fields become `null`, numbers are parsed, money stays a string.
 * Only writable listing fields are ever emitted. With `mode: 'operational'`
 * (approved / inactive vehicles) identity fields are left out entirely.
 */
export function toVehiclePatch(
  form: VehicleFormState,
  mode: 'all' | 'operational' = 'all',
): Record<string, unknown> {
  const full: Record<string, unknown> = {
    categoryId: text(form.categoryId),
    locationId: text(form.locationId),
    title: text(form.title),
    internalName: nullableText(form.internalName),
    make: text(form.make),
    model: text(form.model),
    modelYear: int(form.modelYear),
    transmission: form.transmission === '' ? null : form.transmission,
    fuelType: form.fuelType === '' ? null : form.fuelType,
    seats: nullableInt(form.seats),
    doors: nullableInt(form.doors),
    luggageCapacity: nullableInt(form.luggageCapacity),
    engineCc: nullableInt(form.engineCc),
    hasAc: form.hasAc,
    color: nullableText(form.color),
    registrationNumber: text(form.registrationNumber),
    description: text(form.description),
    dailyRate: text(form.dailyRate),
    weeklyRate: nullableText(form.weeklyRate),
    monthlyRate: nullableText(form.monthlyRate),
    securityDeposit: text(form.securityDeposit),
    includedKmPerDay: form.unlimitedKm ? null : nullableInt(form.includedKmPerDay),
    extraKmRate: form.unlimitedKm ? null : nullableText(form.extraKmRate),
    minRentalDays: int(form.minRentalDays) ?? 1,
    maxRentalDays: nullableInt(form.maxRentalDays),
    minRenterAge: nullableInt(form.minRenterAge),
    minLicenceYears: nullableInt(form.minLicenceYears),
    fuelPolicy: form.fuelPolicy === '' ? null : form.fuelPolicy,
    deliveryAvailable: form.deliveryAvailable,
    deliveryFee: form.deliveryAvailable ? nullableText(form.deliveryFee) : null,
    pickupNotes: nullableText(form.pickupNotes),
  };
  const entries = Object.entries(full).filter(([key, value]) => {
    if (value === undefined) return false;
    if (mode === 'operational' && (VEHICLE_IDENTITY_FIELDS as readonly string[]).includes(key))
      return false;
    return true;
  });
  return Object.fromEntries(entries);
}
