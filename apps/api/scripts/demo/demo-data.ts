/**
 * Fictional local demo data for `pnpm demo:seed`. Every business, contact and
 * address is invented; names were checked not to match a business we could
 * find. Phone numbers use the unassignable `+94 11 0000 xxx` range (a Colombo
 * subscriber number never starts with 0), so no real person can be reached.
 * Prices are believable demo values, not market data. Photos: see
 * docs/DEMO_ASSETS.md for the source, photographer and licence of every file.
 */
import type { VehicleFields } from '@vrp/contracts';

/** Accounts are `<provider key>@demo.vrp.invalid` (RFC 2606: `.invalid` never resolves). */
export const DEMO_EMAIL_DOMAIN = 'demo.vrp.invalid';

export interface DemoVehicle {
  /** Stable id inside the demo (also the vehicle's internal name). */
  key: string;
  fields: Omit<VehicleFields, 'locationId'>;
  /** Files in `scripts/demo/photos`, primary first. */
  photos: string[];
}

export interface DemoProvider {
  key: string;
  displayName: string;
  providerType: 'individual' | 'registered_business';
  contactName: string;
  phone: string;
  addressText: string;
  /** Gazetteer slug of the home town (seed place). */
  placeSlug: string;
  placeName: string;
  serviceAreaSlugs: string[];
  /** Fictional pin offset from the town centre (degrees); shown publicly only rounded. */
  pinOffset: [number, number];
  pickupInstructions: string;
  description: string;
  yearsOperating: number;
  vehicleCategoryIds: string[];
  vehicles: DemoVehicle[];
}

type Fields = DemoVehicle['fields'];

/** Shared defaults for a car / SUV / van listing; each vehicle overrides what differs. */
function car(
  fields: Partial<Fields> &
    Pick<
      Fields,
      | 'categoryId'
      | 'title'
      | 'make'
      | 'model'
      | 'modelYear'
      | 'registrationNumber'
      | 'description'
      | 'dailyRate'
    >,
): Fields {
  return {
    internalName: null,
    transmission: 'automatic',
    fuelType: 'petrol',
    seats: 5,
    doors: 5,
    luggageCapacity: 2,
    engineCc: null,
    hasAc: true,
    color: null,
    weeklyRate: null,
    monthlyRate: null,
    securityDeposit: '25000',
    includedKmPerDay: 100,
    extraKmRate: '40',
    minRentalDays: 1,
    maxRentalDays: 30,
    minRenterAge: 21,
    minLicenceYears: 1,
    fuelPolicy: 'full_to_full',
    deliveryAvailable: false,
    deliveryFee: null,
    pickupNotes: null,
    ...fields,
  };
}

function bike(
  fields: Partial<Fields> &
    Pick<
      Fields,
      | 'title'
      | 'make'
      | 'model'
      | 'modelYear'
      | 'registrationNumber'
      | 'description'
      | 'dailyRate'
      | 'engineCc'
    >,
): Fields {
  return {
    categoryId: 'bike',
    internalName: null,
    transmission: 'manual',
    fuelType: 'petrol',
    seats: 2,
    doors: null,
    luggageCapacity: 0,
    hasAc: false,
    color: null,
    weeklyRate: null,
    monthlyRate: null,
    securityDeposit: '10000',
    includedKmPerDay: 120,
    extraKmRate: '15',
    minRentalDays: 2,
    maxRentalDays: 30,
    minRenterAge: 18,
    minLicenceYears: 1,
    fuelPolicy: 'same_to_same',
    deliveryAvailable: false,
    deliveryFee: null,
    pickupNotes: null,
    ...fields,
  };
}

const photos = (key: string): string[] => [1, 2, 3].map((n) => `${key}-${n}.jpg`);

const FICTIONAL_PICKUP =
  'Fictional demo listing: there is no real pickup point. Exact details would be shared here after a confirmed booking.';

export const DEMO_PROVIDERS: DemoProvider[] = [
  {
    key: 'kirala-coast-rentals',
    displayName: 'Kirala Coast Rentals',
    providerType: 'registered_business',
    contactName: 'Kirala Coast bookings desk',
    phone: '+94110000101',
    addressText: 'Fictional demo address, Beach Road, Matara',
    placeSlug: 'matara',
    placeName: 'Matara',
    serviceAreaSlugs: ['polhena', 'mirissa'],
    pinOffset: [0.003, -0.004],
    pickupInstructions: FICTIONAL_PICKUP,
    description:
      'Family-run hire desk in Matara town with economical city cars and comfortable sedans for trips along the southern coast road.',
    yearsOperating: 9,
    vehicleCategoryIds: ['car'],
    vehicles: [
      {
        key: 'kirala-wagon-r',
        photos: photos('suzuki-wagon-r'),
        fields: car({
          categoryId: 'car',
          title: 'Suzuki Wagon R 2020',
          make: 'Suzuki',
          model: 'Wagon R',
          modelYear: 2020,
          fuelType: 'petrol',
          engineCc: 1000,
          color: 'Silver',
          luggageCapacity: 2,
          registrationNumber: 'SP CAX-4821',
          description:
            'Easy-to-park hatchback with air conditioning, ideal for town errands, beach hopping and narrow village roads around Matara.',
          dailyRate: '6800',
          weeklyRate: '40800',
          monthlyRate: '150000',
          securityDeposit: '20000',
          includedKmPerDay: 120,
          extraKmRate: '35',
        }),
      },
      {
        key: 'kirala-corolla',
        photos: photos('toyota-corolla'),
        fields: car({
          categoryId: 'car',
          title: 'Toyota Corolla 2012',
          make: 'Toyota',
          model: 'Corolla',
          modelYear: 2012,
          fuelType: 'petrol',
          engineCc: 1500,
          doors: 4,
          color: 'White',
          luggageCapacity: 3,
          registrationNumber: 'SP CAY-7310',
          description:
            'Reliable automatic sedan with a roomy boot. Comfortable for the drive to Galle Fort, Yala or the airport transfer road.',
          dailyRate: '9000',
          weeklyRate: '54000',
          monthlyRate: '198000',
          securityDeposit: '30000',
          deliveryAvailable: true,
          deliveryFee: '1500',
        }),
      },
    ],
  },
  {
    key: 'palm-shore-auto-hire',
    displayName: 'Palm Shore Auto Hire',
    providerType: 'individual',
    contactName: 'Palm Shore bookings desk',
    phone: '+94110000102',
    addressText: 'Fictional demo address, Harbour Road, Mirissa',
    placeSlug: 'mirissa',
    placeName: 'Mirissa',
    serviceAreaSlugs: ['weligama', 'matara'],
    pinOffset: [0.002, 0.003],
    pickupInstructions: FICTIONAL_PICKUP,
    description:
      'Small owner-operated fleet a short walk from Mirissa harbour. Hybrid and compact cars, delivered to guesthouses along the bay.',
    yearsOperating: 5,
    vehicleCategoryIds: ['car'],
    vehicles: [
      {
        key: 'palm-shore-prius',
        photos: photos('toyota-prius'),
        fields: car({
          categoryId: 'car',
          title: 'Toyota Prius 2023',
          make: 'Toyota',
          model: 'Prius',
          modelYear: 2023,
          fuelType: 'hybrid',
          engineCc: 1800,
          color: 'Teal blue',
          luggageCapacity: 3,
          registrationNumber: 'SP CBA-2264',
          description:
            'Late-model hybrid with very low fuel use, adaptive cruise and a quiet cabin. A relaxed choice for long coastal drives.',
          dailyRate: '11500',
          weeklyRate: '69000',
          monthlyRate: '253000',
          securityDeposit: '40000',
          includedKmPerDay: 150,
          extraKmRate: '45',
          minRenterAge: 23,
          minLicenceYears: 2,
          deliveryAvailable: true,
          deliveryFee: '1000',
        }),
      },
      {
        key: 'palm-shore-swift',
        photos: photos('suzuki-swift'),
        fields: car({
          categoryId: 'car',
          title: 'Suzuki Swift 2014',
          make: 'Suzuki',
          model: 'Swift',
          modelYear: 2014,
          transmission: 'manual',
          fuelType: 'petrol',
          engineCc: 1200,
          color: 'Red',
          registrationNumber: 'SP CBB-5408',
          description:
            'Nimble manual hatchback that is fun on the hill roads inland from Mirissa and easy to park in busy beach towns.',
          dailyRate: '7500',
          weeklyRate: '45000',
          monthlyRate: '165000',
          securityDeposit: '25000',
          minRentalDays: 2,
        }),
      },
    ],
  },
  {
    key: 'lagoon-lane-rentals',
    displayName: 'Lagoon Lane Rentals',
    providerType: 'individual',
    contactName: 'Lagoon Lane bookings desk',
    phone: '+94110000103',
    addressText: 'Fictional demo address, Lagoon Lane, Weligama',
    placeSlug: 'weligama',
    placeName: 'Weligama',
    serviceAreaSlugs: ['midigama', 'mirissa'],
    pinOffset: [-0.002, 0.002],
    pickupInstructions: FICTIONAL_PICKUP,
    description:
      'Motorcycle hire for surfers and travellers in Weligama. Helmets included; bikes are serviced between every rental.',
    yearsOperating: 4,
    vehicleCategoryIds: ['bike'],
    vehicles: [
      {
        key: 'lagoon-pulsar',
        photos: photos('bajaj-pulsar-rs200'),
        fields: bike({
          title: 'Bajaj Pulsar RS200 2022',
          make: 'Bajaj',
          model: 'Pulsar RS200',
          modelYear: 2022,
          engineCc: 199,
          color: 'Black and red',
          registrationNumber: 'SP BKA-3157',
          description:
            'Sporty faired 200 cc motorcycle with ABS, comfortable on the coast road between Weligama, Midigama and Mirissa. Two helmets included.',
          dailyRate: '3800',
          weeklyRate: '22800',
          monthlyRate: '83600',
          securityDeposit: '15000',
          deliveryAvailable: true,
          deliveryFee: '500',
        }),
      },
      {
        key: 'lagoon-cb350',
        photos: photos('honda-cb350'),
        fields: bike({
          title: 'Honda CB350 RS 2023',
          make: 'Honda',
          model: 'CB350 RS',
          modelYear: 2023,
          engineCc: 348,
          color: 'Matte black',
          registrationNumber: 'SP BKB-6620',
          description:
            'Relaxed retro-style 350 cc motorcycle with plenty of low-end torque for two-up rides to the hill country viewpoints.',
          dailyRate: '4500',
          weeklyRate: '27000',
          monthlyRate: '99000',
          securityDeposit: '20000',
          minRenterAge: 21,
          minLicenceYears: 2,
        }),
      },
    ],
  },
  {
    key: 'stilt-point-drive',
    displayName: 'Stilt Point Drive',
    providerType: 'registered_business',
    contactName: 'Stilt Point bookings desk',
    phone: '+94110000104',
    addressText: 'Fictional demo address, Galle Road, Ahangama',
    placeSlug: 'ahangama',
    placeName: 'Ahangama',
    serviceAreaSlugs: ['koggala', 'midigama'],
    pinOffset: [0.002, -0.002],
    pickupInstructions: FICTIONAL_PICKUP,
    description:
      'SUV specialists between Ahangama and Koggala. Higher-clearance vehicles for families, surf boards and trips to the national parks.',
    yearsOperating: 7,
    vehicleCategoryIds: ['suv'],
    vehicles: [
      {
        key: 'stilt-rav4',
        photos: photos('toyota-rav4'),
        fields: car({
          categoryId: 'suv',
          title: 'Toyota RAV4 2021',
          make: 'Toyota',
          model: 'RAV4',
          modelYear: 2021,
          fuelType: 'petrol',
          engineCc: 2500,
          color: 'Blue',
          luggageCapacity: 4,
          registrationNumber: 'SP CBK-9042',
          description:
            'Spacious automatic SUV with a large boot and roof rails, comfortable for families and boards on the drive to Yala or Udawalawe.',
          dailyRate: '16500',
          weeklyRate: '99000',
          monthlyRate: '363000',
          securityDeposit: '50000',
          includedKmPerDay: 150,
          extraKmRate: '60',
          minRenterAge: 25,
          minLicenceYears: 3,
          deliveryAvailable: true,
          deliveryFee: '2000',
        }),
      },
      {
        key: 'stilt-prado',
        photos: photos('toyota-land-cruiser-prado'),
        fields: car({
          categoryId: 'suv',
          title: 'Toyota Land Cruiser Prado 1995',
          make: 'Toyota',
          model: 'Land Cruiser Prado',
          modelYear: 1995,
          transmission: 'manual',
          fuelType: 'diesel',
          engineCc: 3000,
          doors: 3,
          color: 'Brown',
          luggageCapacity: 3,
          registrationNumber: 'SP 64-2871',
          description:
            'Classic three-door 4x4 with a roof rack, well maintained and suited to rough estate roads. Manual gearbox; experienced drivers only.',
          dailyRate: '15000',
          weeklyRate: '90000',
          monthlyRate: '330000',
          securityDeposit: '50000',
          includedKmPerDay: 150,
          extraKmRate: '70',
          minRentalDays: 2,
          minRenterAge: 25,
          minLicenceYears: 3,
          fuelPolicy: 'same_to_same',
        }),
      },
    ],
  },
  {
    key: 'coral-bay-drive',
    displayName: 'Coral Bay Drive Co.',
    providerType: 'registered_business',
    contactName: 'Coral Bay bookings desk',
    phone: '+94110000105',
    addressText: 'Fictional demo address, Beach Road, Unawatuna',
    placeSlug: 'unawatuna',
    placeName: 'Unawatuna',
    serviceAreaSlugs: ['galle'],
    pinOffset: [-0.002, -0.002],
    pickupInstructions: FICTIONAL_PICKUP,
    description:
      'Compact sedans for Unawatuna and Galle with free child seats on request and pickup from guesthouses near the bay.',
    yearsOperating: 6,
    vehicleCategoryIds: ['car'],
    vehicles: [
      {
        key: 'coral-vios',
        photos: photos('toyota-vios'),
        fields: car({
          categoryId: 'car',
          title: 'Toyota Vios 2016',
          make: 'Toyota',
          model: 'Vios',
          modelYear: 2016,
          fuelType: 'petrol',
          engineCc: 1500,
          doors: 4,
          color: 'White',
          luggageCapacity: 3,
          registrationNumber: 'SP CAZ-1188',
          description:
            'Economical automatic sedan with a generous boot, a comfortable choice for day trips to Galle Fort, Hikkaduwa and Koggala.',
          dailyRate: '8500',
          weeklyRate: '51000',
          monthlyRate: '187000',
          securityDeposit: '25000',
          deliveryAvailable: true,
          deliveryFee: null,
        }),
      },
    ],
  },
  {
    key: 'southern-breeze-motors',
    displayName: 'Southern Breeze Motors',
    providerType: 'registered_business',
    contactName: 'Southern Breeze bookings desk',
    phone: '+94110000106',
    addressText: 'Fictional demo address, Matara Road, Galle',
    placeSlug: 'galle',
    placeName: 'Galle',
    serviceAreaSlugs: ['unawatuna', 'koggala'],
    pinOffset: [0.003, 0.003],
    pickupInstructions: FICTIONAL_PICKUP,
    description:
      'Group transport from Galle: high-roof passenger vans for families, surf camps and wedding parties travelling along the south coast.',
    yearsOperating: 11,
    vehicleCategoryIds: ['van'],
    vehicles: [
      {
        key: 'southern-breeze-kdh',
        photos: photos('toyota-hiace'),
        fields: car({
          categoryId: 'van',
          title: 'Toyota KDH High Roof 2018',
          make: 'Toyota',
          model: 'HiAce KDH High Roof',
          modelYear: 2018,
          transmission: 'manual',
          fuelType: 'diesel',
          engineCc: 3000,
          seats: 14,
          doors: 4,
          color: 'Silver',
          luggageCapacity: 8,
          registrationNumber: 'SP PH-5530',
          description:
            'Fourteen-seat high-roof van with rear air conditioning and room for luggage or surf boards. Ideal for groups and airport runs.',
          dailyRate: '19500',
          weeklyRate: '117000',
          monthlyRate: '429000',
          securityDeposit: '40000',
          includedKmPerDay: 200,
          extraKmRate: '75',
          minRentalDays: 2,
          minRenterAge: 25,
          minLicenceYears: 3,
          deliveryAvailable: true,
          deliveryFee: '2500',
        }),
      },
    ],
  },
];
