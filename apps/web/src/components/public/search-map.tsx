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
  /** Replaces the map when it cannot load at all. */
  unavailableText?: string;
}

/**
 * Same-origin worker copied by `scripts/copy-maplibre-worker.mjs`: the bundled
 * worker cannot resolve its own `./maplibre-gl-shared.mjs` import (hashed name),
 * and a same-origin URL also avoids MapLibre's blob-wrapper fallback (O12).
 */
const MAPLIBRE_WORKER_PATH = '/maplibre/maplibre-gl-worker.mjs';

function configureSameOriginWorker(): void {
  const url = new URL(MAPLIBRE_WORKER_PATH, window.location.origin).href;
  if (maplibregl.getWorkerUrl() !== url) maplibregl.setWorkerUrl(url);
}

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/**
 * MapLibre map with free/open vector tiles (style URL from `NEXT_PUBLIC_MAP_STYLE_URL`,
 * no API key). The map is a convenience layer only: when the style or the
 * tiles cannot be fetched before the first render it is replaced by an
 * accessible notice; later tile errors keep what rendered and add a note. The
 * list, filters and booking never depend on it (TECH_DECISIONS D46).
 */
export function SearchMap({
  points,
  center,
  zoom = 11,
  className,
  onSelect,
  note,
  unavailableText = 'Map unavailable; results are listed below.',
}: SearchMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  /** Fatal: nothing rendered (style fetch failed, WebGL missing). */
  const [failed, setFailed] = useState<string | null>(null);
  /** Non-fatal: some tiles failed after the map loaded. */
  const [degraded, setDegraded] = useState<string | null>(null);

  useEffect(() => {
    if (!container.current || mapRef.current) return;
    let map: maplibregl.Map;
    try {
      configureSameOriginWorker();
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
    let loaded = false;
    let removed = false;
    const dispose = () => {
      if (removed) return;
      removed = true;
      for (const marker of markersRef.current) marker.remove();
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('load', () => {
      loaded = true;
    });
    map.on('error', (event: { error?: { message?: string } }) => {
      const message = event.error?.message ?? 'Map tiles unavailable';
      if (loaded) {
        // A tile or sprite failed: keep whatever rendered, tell the user, never throw.
        setDegraded(message);
        return;
      }
      // The style (or its first tiles) never arrived: drop the map for the notice.
      dispose();
      setFailed(message);
    });
    mapRef.current = map;
    return dispose;
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
      const element = marker.getElement();
      element.setAttribute('role', 'button');
      element.setAttribute(
        'aria-label',
        `${point.title}${point.subtitle ? `, ${point.subtitle}` : ''}`,
      );
      element.addEventListener('click', () => onSelect?.(point.id));
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
  }, [points, onSelect, zoom, failed]);

  if (failed) {
    return (
      <div className={className}>
        <div
          role="status"
          className="bg-muted text-muted-foreground flex h-24 w-full items-center justify-center rounded-md border px-4 text-center text-sm"
        >
          {unavailableText}
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <div
        ref={container}
        role="region"
        aria-label="Map of approximate pickup areas"
        className="bg-muted h-80 w-full rounded-md"
      />
      {degraded ? (
        <p className="text-muted-foreground mt-2 text-xs" role="status">
          Some map tiles could not load ({degraded}). Results are still listed on this page.
        </p>
      ) : null}
      {note ? <p className="text-muted-foreground mt-2 text-xs">{note}</p> : null}
    </div>
  );
}
