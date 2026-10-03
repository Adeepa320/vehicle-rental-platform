'use client';

import type { ApproxPoint } from '@vrp/contracts';
import dynamic from 'next/dynamic';

const SearchMap = dynamic(() => import('./search-map').then((m) => m.SearchMap), {
  ssr: false,
  loading: () => <div className="bg-muted h-80 w-full animate-pulse rounded-md" />,
});

/** Approximate pickup area on the public vehicle page (never the exact pin). */
export function DetailMap({
  point,
  title,
  placeName,
}: {
  point: ApproxPoint;
  title: string;
  placeName: string;
}) {
  return (
    <SearchMap
      points={[{ id: 'vehicle', lat: point.lat, lng: point.lng, title, subtitle: placeName }]}
      center={{ lat: point.lat, lng: point.lng }}
      zoom={12}
      note={
        point.source === 'place'
          ? `Shown at the centre of ${placeName}. The exact pickup point is shared after a booking is confirmed.`
          : 'Approximate pickup area (about 500 m). The exact pickup point is shared after a booking is confirmed.'
      }
    />
  );
}
