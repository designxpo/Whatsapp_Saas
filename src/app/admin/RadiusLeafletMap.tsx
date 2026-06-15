"use client";

// Clean, labelled coverage map for radius targeting. Real Leaflet map with CARTO
// Voyager tiles (crisp street/area labels), a true geodesic radius circle, and a
// centre pin. Auto-fits to the circle so you always see the covered area + what's
// just outside it. Loaded client-only (Leaflet needs `window`).

import { MapContainer, TileLayer, Circle, CircleMarker, useMap } from "react-leaflet";
import { useEffect } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Pan/zoom the map to frame the circle (with a little breathing room) whenever
// the point or radius changes.
function FitToRadius({ lat, lng, radius }: { lat: number; lng: number; radius: number }) {
  const map = useMap();
  useEffect(() => {
    const bounds = L.latLng(lat, lng).toBounds(radius * 2 * 1000 * 1.3); // diameter + 30% margin
    map.fitBounds(bounds, { animate: true, padding: [8, 8] });
  }, [lat, lng, radius, map]);
  return null;
}

export default function RadiusLeafletMap({ lat, lng, radius }: { lat: number; lng: number; radius: number }) {
  return (
    <MapContainer center={[lat, lng]} zoom={11} scrollWheelZoom={false} className="w-full h-full" zoomControl>
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        subdomains={["a", "b", "c", "d"]}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
        maxZoom={19}
      />
      <Circle center={[lat, lng]} radius={radius * 1000} pathOptions={{ color: "#0668d6", weight: 2, fillColor: "#0783fd", fillOpacity: 0.12 }} />
      <CircleMarker center={[lat, lng]} radius={5} pathOptions={{ color: "#ffffff", weight: 2, fillColor: "#0553ad", fillOpacity: 1 }} />
      <FitToRadius lat={lat} lng={lng} radius={radius} />
    </MapContainer>
  );
}
