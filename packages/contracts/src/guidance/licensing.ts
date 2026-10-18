/**
 * Tourist / renter licensing guidance (Phase 8, PRD FR-T5, TECH_DECISIONS D60).
 *
 * This is informational content shown on listing, booking-request and
 * confirmed-booking pages. It is NOT legal advice and it does not decide
 * eligibility: the provider checks the physical licence at pickup and the
 * customer confirms they hold what the law requires. Items marked
 * `requiresConfirmation` restate widely reported rules that the operator must
 * confirm with counsel / the Department of Motor Traffic before launch
 * (PRODUCT_BRIEF §11, assumption 8). Keep this list conservative; never add a
 * rule here that cannot be sourced.
 */
export interface LicensingGuidanceItem {
  id: string;
  text: string;
  /** True when the statement still needs operator / legal confirmation and is worded as such. */
  requiresConfirmation: boolean;
}

export interface CategoryLicensingGuidance {
  categoryId: string;
  summary: string;
  items: LicensingGuidanceItem[];
}

export const LICENSING_GUIDANCE_DISCLAIMER =
  'Guidance only, not legal advice. Licensing rules in Sri Lanka change and are applied by the Department of Motor Traffic and the police; confirm the current requirements with the provider before you travel. You must hold a licence that is valid for this vehicle class on the day of pickup.';

export const GENERAL_LICENSING_GUIDANCE: LicensingGuidanceItem[] = [
  {
    id: 'valid-licence',
    text: 'Bring the physical driving licence of the person who will drive. The provider checks it at pickup and may refuse the handover if it is missing, expired or not valid for this vehicle class.',
    requiresConfirmation: false,
  },
  {
    id: 'foreign-licence',
    text: 'Foreign licence holders: a licence from your home country alone is generally not accepted for driving in Sri Lanka. Travellers are usually asked for an International Driving Permit (IDP) together with a Sri Lankan recognition permit for it, obtainable in Sri Lanka (Department of Motor Traffic or the Automobile Association of Ceylon). Confirm the current procedure before you travel.',
    requiresConfirmation: true,
  },
  {
    id: 'passport-deposit',
    text: 'Do not hand over your passport as a deposit. The refundable deposit shown on the listing is paid at pickup and returned after the rental.',
    requiresConfirmation: false,
  },
  {
    id: 'insurance',
    text: 'Ask the provider what the vehicle insurance covers for a hired driver and what you are liable for in case of damage; this is agreed between you and the provider.',
    requiresConfirmation: false,
  },
];

export const CATEGORY_LICENSING_GUIDANCE: Record<string, CategoryLicensingGuidance> = {
  car: {
    categoryId: 'car',
    summary: 'A light-vehicle (car) licence class is required.',
    items: [
      {
        id: 'car-class',
        text: 'Your licence must cover light motor cars. Foreign visitors: see the IDP and recognition-permit note above.',
        requiresConfirmation: true,
      },
    ],
  },
  suv: {
    categoryId: 'suv',
    summary: 'A light-vehicle (car) licence class is required.',
    items: [
      {
        id: 'suv-class',
        text: 'Treated like a car for licensing purposes. Foreign visitors: see the IDP and recognition-permit note above.',
        requiresConfirmation: true,
      },
    ],
  },
  van: {
    categoryId: 'van',
    summary:
      'A light-vehicle licence class covering vans is required; larger vans may need a higher class.',
    items: [
      {
        id: 'van-class',
        text: 'Check with the provider whether this van falls under the light-vehicle class on your licence; some larger vans require a different class.',
        requiresConfirmation: true,
      },
    ],
  },
  bike: {
    categoryId: 'bike',
    summary: 'A motorcycle licence class is required; a car licence alone is not sufficient.',
    items: [
      {
        id: 'bike-class',
        text: 'You need a licence class that covers motorcycles of this engine size. Foreign visitors: an IDP that includes the motorcycle category plus the Sri Lankan recognition permit.',
        requiresConfirmation: true,
      },
      {
        id: 'helmet',
        text: 'Helmets are mandatory for the rider and the pillion passenger.',
        requiresConfirmation: true,
      },
    ],
  },
  scooter: {
    categoryId: 'scooter',
    summary: 'A motorcycle licence class is required; a car licence alone is not sufficient.',
    items: [
      {
        id: 'scooter-class',
        text: 'You need a licence class that covers motorcycles / scooters. Foreign visitors: an IDP that includes the motorcycle category plus the Sri Lankan recognition permit.',
        requiresConfirmation: true,
      },
      {
        id: 'scooter-helmet',
        text: 'Helmets are mandatory for the rider and the pillion passenger.',
        requiresConfirmation: true,
      },
    ],
  },
  tuktuk: {
    categoryId: 'tuktuk',
    summary:
      'Three-wheelers need a specific licence class; self-drive by foreign visitors is restricted.',
    items: [
      {
        id: 'tuktuk-foreigners',
        text: 'It has been reported (2025) that the Department of Motor Traffic does not issue three-wheeler licences to foreign visitors. Until this is confirmed, three-wheelers are not offered for self-drive on this platform.',
        requiresConfirmation: true,
      },
    ],
  },
};

/** Guidance for a category, or null when the category has no specific notes. */
export function licensingGuidanceFor(categoryId: string): CategoryLicensingGuidance | null {
  return CATEGORY_LICENSING_GUIDANCE[categoryId] ?? null;
}
