// Projection maths for the homepage Earth. The WebGL shader in
// global-conversations.tsx does the inverse of `toView` per pixel, so city
// dots and arcs drawn on top land exactly on the photographed map.
//
// Earth space: y is the north pole, z faces longitude 0, x faces 90°E.
// View space:  x right, y up, z towards the viewer; the globe has radius 1.

export type Vec3 = [number, number, number];

/** How far the north pole leans towards the viewer, in radians. */
export const GLOBE_TILT = 0.32;

export const toRad = (degrees: number) => (degrees * Math.PI) / 180;

/** A latitude/longitude (degrees) as a unit vector in Earth space. */
export function earthVector(lat: number, lon: number): Vec3 {
  const la = toRad(lat), lo = toRad(lon);
  return [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)];
}

/** Earth space → view space for a globe turned so longitude `rot` (radians) faces the viewer. */
export function toView([x, y, z]: Vec3, rot: number, tilt = GLOBE_TILT): Vec3 {
  const c = Math.cos(rot), s = Math.sin(rot);
  const rx = x * c - z * s, rz = x * s + z * c;
  return [rx, y * Math.cos(tilt) - rz * Math.sin(tilt), y * Math.sin(tilt) + rz * Math.cos(tilt)];
}

/** Whether a view-space point is in front of the globe, or beside it (not hidden behind). */
export const isVisible = ([x, y, z]: Vec3) => z > 0 || x * x + y * y > 1;

/** Points along the great circle from `a` to `b`, lifted into an arch above the surface. */
export function arcPoints(a: Vec3, b: Vec3, steps = 64): Vec3[] {
  const dot = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const omega = Math.acos(dot);
  const height = 0.04 + 0.12 * (omega / Math.PI);
  const points: Vec3[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const wa = omega < 1e-6 ? 1 - t : Math.sin((1 - t) * omega) / Math.sin(omega);
    const wb = omega < 1e-6 ? t : Math.sin(t * omega) / Math.sin(omega);
    const lift = 1 + height * Math.sin(Math.PI * t);
    points.push([(a[0] * wa + b[0] * wb) * lift, (a[1] * wa + b[1] * wb) * lift, (a[2] * wa + b[2] * wb) * lift]);
  }
  return points;
}

/** The signed shortest turn from `from` to `to`, in (-π, π]. */
export function shortestTurn(from: number, to: number): number {
  const d = (to - from) % (Math.PI * 2);
  return d > Math.PI ? d - Math.PI * 2 : d <= -Math.PI ? d + Math.PI * 2 : d;
}

/** Texture coordinates of an Earth-space point on an equirectangular map (−180° at the left edge, north at the top). */
export function textureUv([x, y, z]: Vec3): [number, number] {
  const lon = Math.atan2(x, z), lat = Math.asin(Math.max(-1, Math.min(1, y)));
  const u = (lon + Math.PI) / (Math.PI * 2);
  return [u - Math.floor(u), 0.5 - lat / Math.PI];
}
