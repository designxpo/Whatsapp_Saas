"use client";

// Clean, labelled coverage map for radius targeting. ONE real Leaflet map that
// draws every selected radius area as its own colour-coded circle + centre pin,
// so overlaps between areas are obvious at a glance. CARTO Voyager tiles (crisp
// street/area labels), true geodesic circles, auto-fit to frame every area.
// Loaded client-only (Leaflet needs `window`).
//
// Plain `leaflet` (BSD-2) driven from a ref, not react-leaflet: react-leaflet
// is Hippocratic-licensed (not OSI-approved) and would ship to every browser.

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export type RadiusPoint = { lat: number; lng: number; radius: number; name: string; color?: string };

export default function RadiusLeafletMap({ points }: { points: RadiusPoint[] }) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  // Create the map once; tear it down on unmount so Leaflet releases its DOM
  // listeners (and a remount does not throw "container already initialized").
  useEffect(() => {
    if (!elRef.current) return;
    const first = points[0];
    const center: L.LatLngExpression = first ? [first.lat, first.lng] : [20.5937, 78.9629]; // India fallback
    const map = L.map(elRef.current, { center, zoom: 10, scrollWheelZoom: false, zoomControl: true });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      subdomains: ["a", "b", "c", "d"],
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redraw circles + pins, then pan/zoom so every circle is in frame (with a
  // little breathing room). Re-runs only when the points or their radii change.
  const sig = points.map(p => `${p.lat},${p.lng},${p.radius},${p.name},${p.color ?? ""}`).join("|");
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    for (const p of points) {
      const color = p.color ?? "#2563eb";
      L.circle([p.lat, p.lng], { radius: p.radius * 1000, color, weight: 2, fillColor: color, fillOpacity: 0.12 }).addTo(layer);
      L.circleMarker([p.lat, p.lng], { radius: 5, color: "#ffffff", weight: 2, fillColor: color, fillOpacity: 1 })
        .bindTooltip(p.name, { permanent: true, direction: "top", offset: [0, -4], opacity: 1 })
        .addTo(layer);
    }
    if (!points.length) return;
    const bounds = L.latLngBounds([]);
    for (const p of points) bounds.extend(L.latLng(p.lat, p.lng).toBounds(p.radius * 2 * 1000 * 1.3)); // diameter + 30% margin
    if (bounds.isValid()) map.fitBounds(bounds, { animate: true, padding: [12, 12] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  return <div ref={elRef} className="w-full h-full" />;
}
