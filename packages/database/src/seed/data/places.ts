import type { GeoPoint } from '../../geo/ewkb';

/**
 * Seed definition for a gazetteer place. `parentSlug` is resolved to an id
 * after the first insert pass.
 */
export interface PlaceSeed {
  slug: string;
  name: string;
  nameSi?: string;
  nameTa?: string;
  aliases?: string[];
  kind: 'city' | 'town' | 'area' | 'landmark' | 'airport';
  districtId: string;
  parentSlug?: string;
  geom: GeoPoint;
  defaultRadiusKm: number;
  isLaunchArea: boolean;
  searchRank: number;
}

/**
 * South Coast launch gazetteer plus the two most common "search from" points
 * (Colombo, the airport). Coordinates are approximate town centres taken from
 * public maps and are good enough for radius search; they should be reviewed
 * against the actual provider locations before launch. Sinhala/Tamil names are
 * provided where the transliteration is well established and left null
 * otherwise, pending review by native speakers.
 */
export const PLACES: PlaceSeed[] = [
  // --- Matara district ---
  {
    slug: 'matara',
    name: 'Matara',
    nameSi: 'මාතර',
    nameTa: 'மாத்தறை',
    aliases: ['Mathara'],
    kind: 'city',
    districtId: 'matara',
    geom: { lat: 5.9549, lng: 80.555 },
    defaultRadiusKm: 12,
    isLaunchArea: true,
    searchRank: 100,
  },
  {
    slug: 'weligama',
    name: 'Weligama',
    nameSi: 'වැලිගම',
    aliases: ['Weligama Bay'],
    kind: 'town',
    districtId: 'matara',
    geom: { lat: 5.9733, lng: 80.4297 },
    defaultRadiusKm: 10,
    isLaunchArea: true,
    searchRank: 95,
  },
  {
    slug: 'mirissa',
    name: 'Mirissa',
    nameSi: 'මිරිස්ස',
    aliases: ['Mirissa Beach'],
    kind: 'town',
    districtId: 'matara',
    geom: { lat: 5.9483, lng: 80.4716 },
    defaultRadiusKm: 8,
    isLaunchArea: true,
    searchRank: 100,
  },
  {
    slug: 'midigama',
    name: 'Midigama',
    nameSi: 'මිදිගම',
    kind: 'area',
    districtId: 'matara',
    parentSlug: 'weligama',
    geom: { lat: 5.963, lng: 80.385 },
    defaultRadiusKm: 6,
    isLaunchArea: true,
    searchRank: 60,
  },
  {
    slug: 'polhena',
    name: 'Polhena',
    nameSi: 'පොල්හේන',
    aliases: ['Polhena Beach'],
    kind: 'area',
    districtId: 'matara',
    parentSlug: 'matara',
    geom: { lat: 5.939, lng: 80.53 },
    defaultRadiusKm: 5,
    isLaunchArea: true,
    searchRank: 40,
  },
  {
    slug: 'dickwella',
    name: 'Dickwella',
    nameSi: 'දික්වැල්ල',
    aliases: ['Dikwella'],
    kind: 'town',
    districtId: 'matara',
    geom: { lat: 5.963, lng: 80.695 },
    defaultRadiusKm: 10,
    isLaunchArea: false,
    searchRank: 50,
  },
  // --- Galle district ---
  {
    slug: 'galle',
    name: 'Galle',
    nameSi: 'ගාල්ල',
    nameTa: 'காலி',
    aliases: ['Galle Fort'],
    kind: 'city',
    districtId: 'galle',
    geom: { lat: 6.0535, lng: 80.221 },
    defaultRadiusKm: 12,
    isLaunchArea: true,
    searchRank: 100,
  },
  {
    slug: 'unawatuna',
    name: 'Unawatuna',
    nameSi: 'උණවටුන',
    kind: 'town',
    districtId: 'galle',
    parentSlug: 'galle',
    geom: { lat: 6.01, lng: 80.2492 },
    defaultRadiusKm: 8,
    isLaunchArea: true,
    searchRank: 95,
  },
  {
    slug: 'ahangama',
    name: 'Ahangama',
    nameSi: 'අහංගම',
    kind: 'town',
    districtId: 'galle',
    geom: { lat: 5.9736, lng: 80.364 },
    defaultRadiusKm: 8,
    isLaunchArea: true,
    searchRank: 70,
  },
  {
    slug: 'koggala',
    name: 'Koggala',
    nameSi: 'කොග්ගල',
    kind: 'area',
    districtId: 'galle',
    geom: { lat: 5.99, lng: 80.329 },
    defaultRadiusKm: 8,
    isLaunchArea: true,
    searchRank: 50,
  },
  {
    slug: 'hikkaduwa',
    name: 'Hikkaduwa',
    nameSi: 'හික්කඩුව',
    kind: 'town',
    districtId: 'galle',
    geom: { lat: 6.1395, lng: 80.1063 },
    defaultRadiusKm: 10,
    isLaunchArea: false,
    searchRank: 60,
  },
  // --- Hambantota district (inactive district; seeded for search suggestions) ---
  {
    slug: 'tangalle',
    name: 'Tangalle',
    nameSi: 'තංගල්ල',
    aliases: ['Tangalla'],
    kind: 'town',
    districtId: 'hambantota',
    geom: { lat: 6.024, lng: 80.794 },
    defaultRadiusKm: 10,
    isLaunchArea: false,
    searchRank: 50,
  },
  // --- Common origin points outside the launch region ---
  {
    slug: 'colombo',
    name: 'Colombo',
    nameSi: 'කොළඹ',
    nameTa: 'கொழும்பு',
    kind: 'city',
    districtId: 'colombo',
    geom: { lat: 6.9271, lng: 79.8612 },
    defaultRadiusKm: 25,
    isLaunchArea: false,
    searchRank: 90,
  },
  {
    slug: 'bandaranaike-international-airport',
    name: 'Bandaranaike International Airport',
    aliases: ['CMB', 'BIA', 'Katunayake Airport', 'Colombo Airport'],
    kind: 'airport',
    districtId: 'gampaha',
    geom: { lat: 7.1808, lng: 79.8841 },
    defaultRadiusKm: 30,
    isLaunchArea: false,
    searchRank: 80,
  },
];
