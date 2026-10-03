import {
  FuelTypeSchema,
  SearchSortSchema,
  TransmissionSchema,
  type FuelType,
  type SearchSort,
  type Transmission,
} from '@vrp/contracts';

import { colomboDateToInstant } from './vehicle-labels';

/**
 * Customer search state as carried in the `/search` URL (shareable, bookmarkable).
 * Dates are calendar days in Sri Lanka time; the API receives instants.
 */
export interface SearchState {
  placeId?: string;
  districtId?: string;
  /** `YYYY-MM-DD` pickup day. */
  startDate?: string;
  /** `YYYY-MM-DD` return day (exclusive end of the rental window). */
  endDate?: string;
  categoryId?: string;
  transmission?: Transmission;
  fuelType?: FuelType;
  minSeats?: number;
  hasAc?: boolean;
  deliveryAvailable?: boolean;
  minDailyRate?: string;
  maxDailyRate?: string;
  sort: SearchSort;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z][a-z0-9-]{0,40}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const AMOUNT = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;

type ParamSource = URLSearchParams | Record<string, string | string[] | undefined>;

function read(source: ParamSource, key: string): string | undefined {
  if (source instanceof URLSearchParams) return source.get(key) ?? undefined;
  const value = source[key];
  return Array.isArray(value) ? value[0] : value;
}

/** Parses URL parameters leniently: anything malformed is dropped, never thrown. */
export function parseSearchParams(source: ParamSource): SearchState {
  const pick = (key: string, test: (v: string) => boolean): string | undefined => {
    const value = read(source, key)?.trim();
    return value && test(value) ? value : undefined;
  };
  const startDate = pick('startDate', (v) => DAY.test(v));
  const endDate = pick('endDate', (v) => DAY.test(v));
  const datesValid = startDate !== undefined && endDate !== undefined && endDate > startDate;
  const seats = read(source, 'minSeats');
  const minSeats =
    seats && /^\d{1,2}$/.test(seats) && Number(seats) >= 1 ? Number(seats) : undefined;
  const sortRaw = read(source, 'sort');
  const sort = SearchSortSchema.safeParse(sortRaw);
  const transmission = TransmissionSchema.safeParse(read(source, 'transmission'));
  const fuelType = FuelTypeSchema.safeParse(read(source, 'fuelType'));
  const flag = (key: string) => (read(source, key) === 'true' ? true : undefined);

  return {
    placeId: pick('placeId', (v) => UUID.test(v)),
    districtId: pick('districtId', (v) => SLUG.test(v)),
    startDate: datesValid ? startDate : undefined,
    endDate: datesValid ? endDate : undefined,
    categoryId: pick('categoryId', (v) => SLUG.test(v)),
    transmission: transmission.success ? transmission.data : undefined,
    fuelType: fuelType.success ? fuelType.data : undefined,
    minSeats,
    hasAc: flag('hasAc'),
    deliveryAvailable: flag('deliveryAvailable'),
    minDailyRate: pick('minDailyRate', (v) => AMOUNT.test(v)),
    maxDailyRate: pick('maxDailyRate', (v) => AMOUNT.test(v)),
    sort: sort.success ? sort.data : 'relevance',
  };
}

/** Only non-default values are written, so URLs stay short and canonical. */
export function serializeSearchParams(state: Partial<SearchState>): URLSearchParams {
  const params = new URLSearchParams();
  const set = (key: string, value: string | number | boolean | undefined) => {
    if (value === undefined || value === '' || value === false) return;
    params.set(key, String(value));
  };
  set('placeId', state.placeId);
  set('districtId', state.districtId);
  if (state.startDate && state.endDate && state.endDate > state.startDate) {
    set('startDate', state.startDate);
    set('endDate', state.endDate);
  }
  set('categoryId', state.categoryId);
  set('transmission', state.transmission);
  set('fuelType', state.fuelType);
  set('minSeats', state.minSeats);
  set('hasAc', state.hasAc);
  set('deliveryAvailable', state.deliveryAvailable);
  set('minDailyRate', state.minDailyRate);
  set('maxDailyRate', state.maxDailyRate);
  if (state.sort && state.sort !== 'relevance') set('sort', state.sort);
  return params;
}

/** The query the API expects (`GET /vehicles/search`), with dates as Sri Lanka midnight instants. */
export function toApiQuery(
  state: SearchState,
  options: { cursor?: string; limit?: number } = {},
): Record<string, string | number | undefined> {
  return {
    placeId: state.placeId,
    districtId: state.districtId,
    startsAt: state.startDate ? colomboDateToInstant(state.startDate) : undefined,
    endsAt: state.endDate ? colomboDateToInstant(state.endDate) : undefined,
    categoryId: state.categoryId,
    transmission: state.transmission,
    fuelType: state.fuelType,
    minSeats: state.minSeats,
    hasAc: state.hasAc ? 'true' : undefined,
    deliveryAvailable: state.deliveryAvailable ? 'true' : undefined,
    minDailyRate: state.minDailyRate,
    maxDailyRate: state.maxDailyRate,
    sort: state.sort,
    limit: options.limit,
    cursor: options.cursor,
  };
}

/** Link to a public vehicle page that keeps the chosen dates. */
export function vehicleHref(
  slug: string,
  state?: Pick<SearchState, 'startDate' | 'endDate'>,
): string {
  const params = new URLSearchParams();
  if (state?.startDate && state?.endDate && state.endDate > state.startDate) {
    params.set('startDate', state.startDate);
    params.set('endDate', state.endDate);
  }
  const query = params.toString();
  return `/vehicles/${encodeURIComponent(slug)}${query ? `?${query}` : ''}`;
}

export function searchHref(state: Partial<SearchState>): string {
  const query = serializeSearchParams(state).toString();
  return `/search${query ? `?${query}` : ''}`;
}
