import { describe, it, expect } from "vitest";
import { qrImageUrl, waClickToChatUrl } from "../qrcode";

describe("qrcode helpers", () => {
  it("qrImageUrl encodes data, clamps size, and is empty for blank input", () => {
    const u = qrImageUrl("https://wa.me/919876543210", 300);
    expect(u).toContain("size=300x300");
    expect(u).toContain(encodeURIComponent("https://wa.me/919876543210"));
    expect(qrImageUrl("   ")).toBe("");
    expect(qrImageUrl("x", 5)).toContain("size=80x80");        // clamped to min
    expect(qrImageUrl("x", 9999)).toContain("size=1000x1000"); // clamped to max
  });

  it("waClickToChatUrl builds a wa.me link from digits + optional prefilled text", () => {
    expect(waClickToChatUrl("+91 98765 43210")).toBe("https://wa.me/919876543210");
    expect(waClickToChatUrl("919876543210", "Hi there")).toBe("https://wa.me/919876543210?text=Hi%20there");
    expect(waClickToChatUrl("123")).toBe("");   // too short
  });
});
