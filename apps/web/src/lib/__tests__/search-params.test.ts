import { describe, expect, it } from 'vitest';

import {
  parseSearchParams,
  searchHref,
  serializeSearchParams,
  toApiQuery,
  vehicleHref,
} from '../search-params';

const PLACE = '0192f0a0-0000-7000-8000-000000000001';

describe('search URL state', () => {
  it('parses valid parameters and drops malformed ones', () => {
    const state = parseSearchParams(
      new URLSearchParams({
        placeId: PLACE,
        startDate: '2026-11-10',
        endDate: '2026-11-13',
        categoryId: 'car',
        transmission: 'automatic',
        fuelType: 'hybrid',
        minSeats: '4',
        hasAc: 'true',
        deliveryAvailable: 'false',
        minDailyRate: '5000',
        maxDailyRate: 'abc',
        sort: 'price_asc',
      }),
    );
    expect(state).toEqual({
      placeId: PLACE,
      districtId: undefined,
      startDate: '2026-11-10',
      endDate: '2026-11-13',
      categoryId: 'car',
      transmission: 'automatic',
      fuelType: 'hybrid',
      minSeats: 4,
      hasAc: true,
      deliveryAvailable: undefined,
      minDailyRate: '5000',
      maxDailyRate: undefined,
      sort: 'price_asc',
    });
    const junk = parseSearchParams({
      placeId: 'not-a-uuid',
      startDate: '2026-11-13',
      endDate: '2026-11-10',
      sort: 'rating',
      minSeats: '-3',
    });
    expect(junk).toMatchObject({
      placeId: undefined,
      startDate: undefined,
      endDate: undefined,
      sort: 'relevance',
      minSeats: undefined,
    });
  });

  it('serialises only non-default values and round-trips', () => {
    const params = serializeSearchParams({
      placeId: PLACE,
      startDate: '2026-11-10',
      endDate: '2026-11-13',
      hasAc: true,
      sort: 'relevance',
    });
    expect(params.toString()).toBe(
      `placeId=${PLACE}&startDate=2026-11-10&endDate=2026-11-13&hasAc=true`,
    );
    expect(parseSearchParams(params)).toMatchObject({
      placeId: PLACE,
      startDate: '2026-11-10',
      endDate: '2026-11-13',
      hasAc: true,
      sort: 'relevance',
    });
    expect(
      serializeSearchParams({
        startDate: '2026-11-13',
        endDate: '2026-11-10',
        sort: 'price_desc',
      }).toString(),
    ).toBe('sort=price_desc');
    expect(searchHref({ sort: 'relevance' })).toBe('/search');
  });

  it('converts calendar days to Sri Lanka midnight instants for the API', () => {
    const query = toApiQuery(
      parseSearchParams({
        startDate: '2026-11-10',
        endDate: '2026-11-13',
        categoryId: 'car',
        hasAc: 'true',
      }),
      { limit: 20, cursor: 'abc' },
    );
    expect(query).toMatchObject({
      startsAt: '2026-11-10T00:00:00+05:30',
      endsAt: '2026-11-13T00:00:00+05:30',
      categoryId: 'car',
      hasAc: 'true',
      sort: 'relevance',
      limit: 20,
      cursor: 'abc',
    });
    expect(query.deliveryAvailable).toBeUndefined();
  });

  it('keeps the chosen dates on vehicle links', () => {
    expect(
      vehicleHref('toyota-aqua-2018-mirissa-ab12', {
        startDate: '2026-11-10',
        endDate: '2026-11-13',
      }),
    ).toBe('/vehicles/toyota-aqua-2018-mirissa-ab12?startDate=2026-11-10&endDate=2026-11-13');
    expect(vehicleHref('x y')).toBe('/vehicles/x%20y');
  });
});
