// The inbox is sized by MEASURING where the phone tab bar starts. The old
// `100dvh - top - 56px - safe area` came out too tall on iPhone Safari, so the
// reply box slid under the tab bar.
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { fitHeight } from "@/app/admin/_tabs/LiveChatTab";

describe("inbox height", () => {
  it("ends exactly where the tab bar starts", () => {
    // inbox starts 109px down, tab bar top at 787px
    expect(fitHeight(109, 0, 787, 844)).toBe(678);
  });
  it("uses the window bottom when there is no tab bar (laptop)", () => {
    expect(fitHeight(120, 0, null, 900)).toBe(780);
  });
  it("is measured from where the inbox sits on screen, even if the page scrolled", () => {
    expect(fitHeight(109, 20, 787, 844)).toBe(698);
  });
  it("never collapses to nothing", () => {
    expect(fitHeight(800, 0, 787, 844)).toBe(240);
  });
});
