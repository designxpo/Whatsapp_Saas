// The homepage "works on every screen" frame: on a wide page it narrows at a
// fixed scale; on a phone it still visibly shrinks but the phone view stays
// readable, and the laptop frame never towers over the page.
import { describe, it, expect } from "vitest";
import { showcaseScale } from "../../app/(site)/_components/responsive-showcase";

describe("responsive showcase scale", () => {
  it("keeps one scale on a wide page, so the frame really narrows", () => {
    expect(showcaseScale(1200, 1280)).toBe(showcaseScale(1200, 390));
  });
  it("never draws the laptop frame larger than 86%", () => {
    expect(showcaseScale(2000, 1280)).toBe(0.86);
  });
  it("on a phone-sized page the phone frame is still about half the width", () => {
    const stage = 358;
    const laptop = 1280 * showcaseScale(stage, 1280);
    const phone = 390 * showcaseScale(stage, 390);
    expect(laptop).toBeLessThanOrEqual(stage);
    expect(phone / stage).toBeGreaterThan(0.4);
    expect(phone).toBeLessThan(laptop);
  });
});
