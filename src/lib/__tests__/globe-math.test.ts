// The homepage Earth: city dots must sit on the right place of the real map,
// a city turned to the front must face the viewer, and arcs hide behind the globe.

import { describe, expect, it } from "vitest";
import { arcPoints, earthVector, isVisible, shortestTurn, textureUv, toRad, toView } from "../../app/(site)/_components/globe-math";

const MUMBAI = earthVector(19.076, 72.8777);
const NEW_YORK = earthVector(40.7128, -74.006);

describe("globe maths", () => {
  it("turns the chosen city to face the viewer, only tilted up by the globe's lean", () => {
    const [x, y, z] = toView(MUMBAI, toRad(72.8777));
    expect(x).toBeCloseTo(0, 6);
    expect(z).toBeGreaterThan(0.9);
    expect(y).toBeGreaterThan(0);
    expect(toView(MUMBAI, toRad(72.8777), 0)[1]).toBeCloseTo(Math.sin(toRad(19.076)), 6);
  });

  it("puts cities on the right spot of an equirectangular map", () => {
    const [u, v] = textureUv(MUMBAI);
    expect(u).toBeCloseTo((72.8777 + 180) / 360, 6);
    expect(v).toBeCloseTo((90 - 19.076) / 180, 6);
    expect(textureUv(earthVector(0, -180))[0]).toBeCloseTo(0, 6);
    expect(textureUv(earthVector(89.9, 0))[1]).toBeLessThan(0.01);
  });

  it("hides the far side: New York is behind the globe while Mumbai faces the viewer", () => {
    expect(isVisible(toView(NEW_YORK, toRad(72.8777)))).toBe(false);
    expect(isVisible(toView(NEW_YORK, toRad(-74.006)))).toBe(true);
  });

  it("arches an arc above the surface, starting and ending on the two cities", () => {
    const arc = arcPoints(MUMBAI, NEW_YORK, 32);
    expect(arc[0].map(n => +n.toFixed(6))).toEqual(MUMBAI.map(n => +n.toFixed(6)));
    expect(arc[32].map(n => +n.toFixed(6))).toEqual(NEW_YORK.map(n => +n.toFixed(6)));
    expect(Math.hypot(...arc[16])).toBeGreaterThan(1.1);
  });

  it("turns the short way round", () => {
    expect(shortestTurn(toRad(170), toRad(-170))).toBeCloseTo(toRad(20), 6);
    expect(shortestTurn(toRad(-170), toRad(170))).toBeCloseTo(toRad(-20), 6);
  });
});
