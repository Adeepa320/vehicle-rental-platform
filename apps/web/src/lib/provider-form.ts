import type { ProviderApplication } from '@vrp/contracts';

/** String-based form state for the provider application (controlled inputs). */
export interface FormState {
  displayName: string;
  providerType: '' | 'individual' | 'registered_business';
  contactName: string;
  phone: string;
  whatsapp: string;
  addressText: string;
  districtId: string;
  primaryPlaceId: string;
  serviceAreaPlaceIds: string[];
  description: string;
  yearsOperating: string;
  vehicleCategoryIds: string[];
  fleetSizeEstimate: string;
  offersDelivery: boolean;
  offersAirportTransfer: boolean;
  websiteUrl: string;
  applicantNotes: string;
}

export const EMPTY_FORM: FormState = {
  displayName: '',
  providerType: '',
  contactName: '',
  phone: '',
  whatsapp: '',
  addressText: '',
  districtId: '',
  primaryPlaceId: '',
  serviceAreaPlaceIds: [],
  description: '',
  yearsOperating: '',
  vehicleCategoryIds: [],
  fleetSizeEstimate: '',
  offersDelivery: false,
  offersAirportTransfer: false,
  websiteUrl: '',
  applicantNotes: '',
};

/** Maps the API's application (nullable fields) onto the form state. */
export function fromApplication(app: ProviderApplication | null): FormState {
  if (!app) return EMPTY_FORM;
  return {
    displayName: app.displayName ?? '',
    providerType: app.providerType ?? '',
    contactName: app.contactName ?? '',
    phone: app.phone ?? '',
    whatsapp: app.whatsapp ?? '',
    addressText: app.addressText ?? '',
    districtId: app.districtId ?? '',
    primaryPlaceId: app.primaryPlaceId ?? '',
    serviceAreaPlaceIds: app.serviceAreaPlaceIds,
    description: app.description ?? '',
    yearsOperating: app.yearsOperating === null ? '' : String(app.yearsOperating),
    vehicleCategoryIds: app.vehicleCategoryIds,
    fleetSizeEstimate: app.fleetSizeEstimate === null ? '' : String(app.fleetSizeEstimate),
    offersDelivery: app.offersDelivery,
    offersAirportTransfer: app.offersAirportTransfer,
    websiteUrl: app.websiteUrl ?? '',
    applicantNotes: app.applicantNotes ?? '',
  };
}

/**
 * Converts the form into the draft payload the API validates with
 * `ProviderApplicationDraftSchema`: strings are trimmed, empty required-ish
 * fields are omitted, empty optional fields become `null`, numbers are parsed.
 * Only form fields are ever emitted (no status/role/review keys).
 */
export function toDraft(form: FormState): Record<string, unknown> {
  const text = (value: string) => (value.trim() === '' ? undefined : value.trim());
  const nullable = (value: string) => (value.trim() === '' ? null : value.trim());
  const int = (value: string) => (value.trim() === '' ? null : Number(value));
  return {
    displayName: text(form.displayName),
    providerType: form.providerType === '' ? undefined : form.providerType,
    contactName: text(form.contactName),
    phone: text(form.phone),
    whatsapp: nullable(form.whatsapp),
    addressText: text(form.addressText),
    districtId: text(form.districtId),
    primaryPlaceId: text(form.primaryPlaceId),
    serviceAreaPlaceIds: form.serviceAreaPlaceIds,
    description: text(form.description),
    yearsOperating: int(form.yearsOperating),
    vehicleCategoryIds: form.vehicleCategoryIds,
    fleetSizeEstimate: int(form.fleetSizeEstimate),
    offersDelivery: form.offersDelivery,
    offersAirportTransfer: form.offersAirportTransfer,
    websiteUrl: nullable(form.websiteUrl),
    applicantNotes: nullable(form.applicantNotes),
  };
}
