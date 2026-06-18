import { describe, it, expect } from "vitest";
import { shouldSpeak } from "../voice";

describe("shouldSpeak", () => {
  it("off never speaks", () => {
    expect(shouldSpeak("off", true)).toBe(false);
    expect(shouldSpeak("off", false)).toBe(false);
  });
  it("always speaks regardless of inbound modality", () => {
    expect(shouldSpeak("always", false)).toBe(true);
    expect(shouldSpeak("always", true)).toBe(true);
  });
  it("mirror speaks only when the customer sent voice", () => {
    expect(shouldSpeak("mirror", true)).toBe(true);
    expect(shouldSpeak("mirror", false)).toBe(false);
  });
});
