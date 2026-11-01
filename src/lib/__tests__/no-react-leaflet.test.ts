// react-leaflet (and @react-leaflet/core) are Hippocratic-2.1: not an
// OSI-approved licence, and the code ships to every visitor's browser. The
// radius map drives plain `leaflet` (BSD-2) from a ref instead; this keeps the
// dependency from creeping back in.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "node_modules" ? [] : sources(p);
    return /\.(tsx?|jsx?|mjs)$/.test(name) ? [p] : [];
  });
}

describe("no Hippocratic-licensed map bindings", () => {
  it("package.json does not depend on react-leaflet", () => {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(Object.keys(deps).filter(d => /react-leaflet/.test(d))).toEqual([]);
    expect(deps.leaflet, "the map still needs plain leaflet").toBeTruthy();
  });

  it("no source file imports react-leaflet", () => {
    const hits = sources(join(ROOT, "src")).filter(f => /from\s+["']@?react-leaflet/.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });

  it("the radius map keeps its contract and cleans up after itself", () => {
    const src = readFileSync(join(ROOT, "src/app/admin/RadiusLeafletMap.tsx"), "utf8");
    expect(src).toMatch(/export default function RadiusLeafletMap\(\{ points \}: \{ points: RadiusPoint\[\] \}\)/);
    expect(src).toMatch(/export type RadiusPoint = /);
    expect(src).toMatch(/map\.remove\(\)/);
  });
});
