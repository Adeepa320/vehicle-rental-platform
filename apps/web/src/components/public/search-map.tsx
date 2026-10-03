'use client';

import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';

import { publicEnv } from '@/lib/env';

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  title: string;
  subtitle?: string;
  href?: string;
}

interface SearchMapProps {
  points: MapPoint[];
  /** Fallback centre when there are no points (Sri Lanka south coast). */
  center?: { lat: number; lng: number };
  zoom?: number;
  className?: string;
  /** Called when a marker is clicked (e.g. to highlight the card). */
  onSelect?: (id: string) => void;
  /** Shown under the map; the points are approximate by design. */
  note?: string;
}

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/**
 * MapLibre map with free/open vector tiles (style URL from `NEXT_PUBLIC_MAP_STYLE_URL`,
 * no API key). Any tile or script failure degrades to a text note; the list view
 * never depends on this component (TECH_DECISIONS D46).
 */
export function SearchMap({
  points,
  center,
  zoom = 11,
  className,
  onSelect,
  note,
}: SearchMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!container.current || mapRef.current) return;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: container.current,
        style: publicEnv.NEXT_PUBLIC_MAP_STYLE_URL,
        center: [center?.lng ?? 80.47, center?.lat ?? 5.95],
        zoom,
        attributionControl: { compact: true },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Map could not start';
      // Report asynchronously: no state updates inside the effect body itself.
      const timer = setTimeout(() => setFailed(message), 0);
      return () => clearTimeout(timer);
    }
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('error', (event: { error?: { message?: string } }) => {
      // Tile/style problems: keep whatever rendered, tell the user, never throw.
      setFailed(event.error?.message ?? 'Map tiles unavailable');
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // The map is created once; points are synced in the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const marker of markersRef.current) marker.remove();
    markersRef.current = points.map((point) => {
      const popup = new maplibregl.Popup({ offset: 12, closeButton: false }).setHTML(
        `<strong>${escapeHtml(point.title)}</strong>${
          point.subtitle ? `<br>${escapeHtml(point.subtitle)}` : ''
        }${point.href ? `<br><a href="${escapeHtml(point.href)}">View</a>` : ''}`,
      );
      const marker = new maplibregl.Marker()
        .setLngLat([point.lng, point.lat])
        .setPopup(popup)
        .addTo(map);
      marker.getElement().addEventListener('click', () => onSelect?.(point.id));
      return marker;
    });
    const first = points[0];
    if (points.length === 1 && first) {
      map.easeTo({ center: [first.lng, first.lat], zoom: Math.max(zoom, 12) });
    } else if (points.length > 1) {
      const bounds = new maplibregl.LngLatBounds();
      for (const p of points) bounds.extend([p.lng, p.lat]);
      map.fitBounds(bounds, { padding: 48, maxZoom: 13, duration: 0 });
    }
  }, [points, onSelect, zoom]);

  return (
    <div className={className}>
      <div
        ref={container}
        className="bg-muted h-80 w-full rounded-md"
        aria-label="Map of approximate pickup areas"
      />
      {failed ? (
        <p className="text-muted-foreground mt-2 text-xs">
          The map could not load ({failed}). Results are still listed above.
        </p>
      ) : null}
      {note ? <p className="text-muted-foreground mt-2 text-xs">{note}</p> : null}
    </div>
  );
}
