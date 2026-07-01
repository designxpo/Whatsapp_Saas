"use client";

// Clean, labelled coverage map for radius targeting. ONE real Leaflet map that
// draws every selected radius area as its own colour-coded circle + centre pin,
// so overlaps between areas are obvious at a glance. CARTO Voyager tiles (crisp
// street/area labels), true geodesic circles, auto-fit to frame every area.
// Loaded client-only (Leaflet needs `window`).

import { MapContainer, TileLayer, Circle, CircleMarker, Tooltip, useMap } from "react-leaflet";
import { Fragment, useEffect } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export type RadiusPoint = { lat: number; lng: number; radius: number; name: string; color?: string };

// Pan/zoom so every circle is in frame (with a little breathing room). Re-fits
// only when the set of points or their radii actually change.
function FitToAll({ points }: { points: RadiusPoint[] }) {
  const map = useMap();
  const sig = points.map(p => `${p.lat},${p.lng},${p.radius}`).join("|");
  useEffect(() => {
    if (!points.length) return;
    const bounds = L.latLngBounds([]);
    for (const p of points) bounds.extend(L.latLng(p.lat, p.lng).toBounds(p.radius * 2 * 1000 * 1.3)); // diameter + 30% margin
    if (bounds.isValid()) map.fitBounds(bounds, { animate: true, padding: [12, 12] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, map]);
  return null;
}

export default function RadiusLeafletMap({ points }: { points: RadiusPoint[] }) {
  const center: [number, number] = points.length ? [points[0].lat, points[0].lng] : [20.5937, 78.9629]; // India fallback
  return (
    <MapContainer center={center} zoom={10} scrollWheelZoom={false} className="w-full h-full" zoomControl>
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        subdomains={["a", "b", "c", "d"]}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
        maxZoom={19}
      />
      {points.map((p, i) => {
        const color = p.color ?? "#2563eb";
        return (
          <Fragment key={i}>
            <Circle center={[p.lat, p.lng]} radius={p.radius * 1000} pathOptions={{ color, weight: 2, fillColor: color, fillOpacity: 0.12 }} />
            <CircleMarker center={[p.lat, p.lng]} radius={5} pathOptions={{ color: "#ffffff", weight: 2, fillColor: color, fillOpacity: 1 }}>
              <Tooltip permanent direction="top" offset={[0, -4]} opacity={1}>{p.name}</Tooltip>
            </CircleMarker>
          </Fragment>
        );
      })}
      <FitToAll points={points} />
    </MapContainer>
  );
}
