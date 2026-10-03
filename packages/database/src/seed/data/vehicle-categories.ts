import type { NewVehicleCategory } from '../../schema';

/**
 * MVP categories. `scooter` and `tuktuk` are seeded INACTIVE on purpose: the
 * product/legal decision on launching them (foreigners cannot currently obtain
 * three-wheeler licences per the Department of Motor Traffic) is open — see
 * docs/PRODUCT_BRIEF.md §11 assumption 8. Activation is an admin action, and
 * re-seeding never overwrites `is_active`.
 *
 * `requiresLicenceClass` is informational copy for customers and must be
 * verified against current Department of Motor Traffic licence classes.
 */
export const VEHICLE_CATEGORIES: NewVehicleCategory[] = [
  {
    id: 'car',
    name: 'Car',
    nameSi: 'මෝටර් රථය',
    icon: 'car',
    sortOrder: 10,
    requiresLicenceClass: 'B',
    isActive: true,
  },
  {
    id: 'suv',
    name: 'SUV',
    nameSi: 'එස්.යූ.වී.',
    icon: 'car-front',
    sortOrder: 20,
    requiresLicenceClass: 'B',
    isActive: true,
  },
  {
    id: 'van',
    name: 'Van',
    nameSi: 'වෑන් රථය',
    icon: 'bus',
    sortOrder: 30,
    requiresLicenceClass: null,
    isActive: true,
  },
  {
    id: 'bike',
    name: 'Motorbike',
    nameSi: 'යතුරුපැදිය',
    icon: 'bike',
    sortOrder: 40,
    requiresLicenceClass: 'A',
    isActive: true,
  },
  {
    id: 'scooter',
    name: 'Scooter',
    nameSi: 'ස්කූටර්',
    icon: 'bike',
    sortOrder: 50,
    requiresLicenceClass: 'A',
    isActive: false, // pending product decision
  },
  {
    id: 'tuktuk',
    name: 'Tuk-tuk',
    nameSi: 'ත්‍රිරෝද රථය',
    icon: 'truck',
    sortOrder: 60,
    requiresLicenceClass: 'B1',
    isActive: false, // pending legal/product decision
  },
];
