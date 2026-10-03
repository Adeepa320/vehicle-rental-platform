import type { NewDistrict } from '../../schema';

/**
 * All 25 districts. Only the South Coast launch districts (Matara, Galle) are
 * active; `is_active` is operational data and is NOT overwritten by re-seeding.
 */
export const DISTRICTS: NewDistrict[] = [
  // Southern Province — launch region
  { id: 'matara', name: 'Matara', province: 'Southern', isActive: true, sortOrder: 1 },
  { id: 'galle', name: 'Galle', province: 'Southern', isActive: true, sortOrder: 2 },
  { id: 'hambantota', name: 'Hambantota', province: 'Southern', isActive: false, sortOrder: 3 },
  // Western
  { id: 'colombo', name: 'Colombo', province: 'Western', isActive: false, sortOrder: 10 },
  { id: 'gampaha', name: 'Gampaha', province: 'Western', isActive: false, sortOrder: 11 },
  { id: 'kalutara', name: 'Kalutara', province: 'Western', isActive: false, sortOrder: 12 },
  // Central
  { id: 'kandy', name: 'Kandy', province: 'Central', isActive: false, sortOrder: 20 },
  { id: 'matale', name: 'Matale', province: 'Central', isActive: false, sortOrder: 21 },
  { id: 'nuwara-eliya', name: 'Nuwara Eliya', province: 'Central', isActive: false, sortOrder: 22 },
  // Sabaragamuwa
  { id: 'ratnapura', name: 'Ratnapura', province: 'Sabaragamuwa', isActive: false, sortOrder: 30 },
  { id: 'kegalle', name: 'Kegalle', province: 'Sabaragamuwa', isActive: false, sortOrder: 31 },
  // Uva
  { id: 'badulla', name: 'Badulla', province: 'Uva', isActive: false, sortOrder: 40 },
  { id: 'monaragala', name: 'Monaragala', province: 'Uva', isActive: false, sortOrder: 41 },
  // North Western
  {
    id: 'kurunegala',
    name: 'Kurunegala',
    province: 'North Western',
    isActive: false,
    sortOrder: 50,
  },
  { id: 'puttalam', name: 'Puttalam', province: 'North Western', isActive: false, sortOrder: 51 },
  // North Central
  {
    id: 'anuradhapura',
    name: 'Anuradhapura',
    province: 'North Central',
    isActive: false,
    sortOrder: 60,
  },
  {
    id: 'polonnaruwa',
    name: 'Polonnaruwa',
    province: 'North Central',
    isActive: false,
    sortOrder: 61,
  },
  // Eastern
  { id: 'trincomalee', name: 'Trincomalee', province: 'Eastern', isActive: false, sortOrder: 70 },
  { id: 'batticaloa', name: 'Batticaloa', province: 'Eastern', isActive: false, sortOrder: 71 },
  { id: 'ampara', name: 'Ampara', province: 'Eastern', isActive: false, sortOrder: 72 },
  // Northern
  { id: 'jaffna', name: 'Jaffna', province: 'Northern', isActive: false, sortOrder: 80 },
  { id: 'kilinochchi', name: 'Kilinochchi', province: 'Northern', isActive: false, sortOrder: 81 },
  { id: 'mannar', name: 'Mannar', province: 'Northern', isActive: false, sortOrder: 82 },
  { id: 'vavuniya', name: 'Vavuniya', province: 'Northern', isActive: false, sortOrder: 83 },
  { id: 'mullaitivu', name: 'Mullaitivu', province: 'Northern', isActive: false, sortOrder: 84 },
];
