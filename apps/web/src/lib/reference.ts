'use client';

import type { District, PlaceSummary, VehicleCategory } from '@vrp/contracts';
import { useEffect, useState } from 'react';

import { useAuth } from '@/lib/auth/auth-context';

export interface ReferenceData {
  districts: District[];
  places: PlaceSummary[];
  categories: VehicleCategory[];
}

export type ReferenceState =
  | { status: 'loading' }
  | { status: 'ready'; data: ReferenceData }
  | { status: 'error'; message: string };

/** Loads the public reference lists once per mount (districts, all active places, categories). */
export function useReferenceData(): ReferenceState {
  const { api } = useAuth();
  const [state, setState] = useState<ReferenceState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.reference.districts(),
      api.reference.places(),
      api.reference.vehicleCategories(),
    ])
      .then(([districts, places, categories]) => {
        if (!cancelled) setState({ status: 'ready', data: { districts, places, categories } });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : 'Could not load reference data',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  return state;
}

export function placeName(data: ReferenceData | undefined, id: string | null | undefined): string {
  if (!id) return '—';
  return data?.places.find((p) => p.id === id)?.name ?? id;
}

export function districtName(
  data: ReferenceData | undefined,
  id: string | null | undefined,
): string {
  if (!id) return '—';
  return data?.districts.find((d) => d.id === id)?.name ?? id;
}

export function categoryName(data: ReferenceData | undefined, id: string): string {
  return data?.categories.find((c) => c.id === id)?.name ?? id;
}
