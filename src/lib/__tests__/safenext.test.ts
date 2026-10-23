// After signing in, ?next= may only lead somewhere on this site (safenext.ts).
import { describe, it, expect } from "vitest";
import { safeNext } from "../safenext";

describe("safeNext", () => {
  it("keeps a path on this site, with its query and fragment", () => {
    expect(safeNext("/support")).toBe("/support");
    expect(safeNext("/admin?tab=inbox#x")).toBe("/admin?tab=inbox#x");
  });

  it("refuses every way of naming another site", () => {
    for (const raw of [
      "//evil.com", "/\\evil.com", "https://evil.com", "evil.com", "javascript:alert(1)",
      "/\t/evil.com", "/\n/evil.com", "/\r/evil.com", "/\t\\evil.com",   // parsers delete tabs and newlines first
    ]) expect(safeNext(raw), JSON.stringify(raw)).toBe("/admin");
  });

  it("falls back when there is nothing to follow", () => {
    expect(safeNext(null)).toBe("/admin");
    expect(safeNext("")).toBe("/admin");
  });
});
