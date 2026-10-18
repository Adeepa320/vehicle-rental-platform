'use client';

import type { ApproxPoint } from '@vrp/contracts';
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState, type RefObject } from 'react';

const MAP_BOX = 'bg-muted h-80 w-full rounded-md';

const SearchMap = dynamic(() => import('./search-map').then((m) => m.SearchMap), {
  ssr: false,
  loading: () => (
    <div className={`${MAP_BOX} animate-pulse`} role="status" aria-label="Loading map" />
  ),
});

/**
 * Mounts the map only once its box is within ~one screen of the viewport, so
 * MapLibre (≈ 270 KB compressed) never competes with the photos and booking
 * panel on first load (risk register O13). The box keeps the map's height, so
 * nothing shifts; without IntersectionObserver the map mounts straight away.
 */
function useNearViewport(): [RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || near) return;
    if (typeof IntersectionObserver === 'undefined') {
      const timer = setTimeout(() => setNear(true), 0);
      return () => clearTimeout(timer);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: '400px 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [near]);
  return [ref, near];
}

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
  const [ref, near] = useNearViewport();
  if (!near) {
    return <div ref={ref} className={MAP_BOX} data-map-placeholder aria-hidden="true" />;
  }
  return (
    <SearchMap
      points={[{ id: 'vehicle', lat: point.lat, lng: point.lng, title, subtitle: placeName }]}
      center={{ lat: point.lat, lng: point.lng }}
      zoom={12}
      unavailableText={`Map unavailable. Pickup is in ${placeName}; the exact point is shared after a booking is confirmed.`}
      note={
        point.source === 'place'
          ? `Shown at the centre of ${placeName}. The exact pickup point is shared after a booking is confirmed.`
          : 'Approximate pickup area (about 500 m). The exact pickup point is shared after a booking is confirmed.'
      }
    />
  );
}
