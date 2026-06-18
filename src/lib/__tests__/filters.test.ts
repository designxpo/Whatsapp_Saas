import { describe, it, expect } from "vitest";
import { escapeLike, safeFilterValue, safeAttrKey } from "@/lib/filters";

describe("escapeLike", () => {
  it("escapes LIKE wildcards so they match literally", () => {
    expect(escapeLike("50%off")).toBe("50\\%off");
    expect(escapeLike("a_b")).toBe("a\\_b");
    expect(escapeLike("a\\b")).toBe("a\\\\b");
  });
  it("leaves ordinary text untouched", () => {
    expect(escapeLike("john smith")).toBe("john smith");
  });
});

describe("safeFilterValue (PostgREST .or() hardening)", () => {
  it("escapes wildcards so '%' is not a match-all", () => {
    expect(safeFilterValue("%")).toBe("\\%");
    expect(safeFilterValue("_")).toBe("\\_");
  });
  it("neutralizes the grammar delimiters that could inject conditions", () => {
    // commas, parens and quotes must never survive into the filter string
    expect(safeFilterValue("a,b")).not.toContain(",");
    expect(safeFilterValue("x)or(y")).not.toMatch(/[()]/);
    expect(safeFilterValue('a"b')).not.toContain('"');
  });
  it("collapses an all-special-character term to empty (caller skips the filter)", () => {
    expect(safeFilterValue(',()"')).toBe("");
    expect(safeFilterValue("   ")).toBe("");
  });
  it("preserves a normal search term", () => {
    expect(safeFilterValue("Priya")).toBe("Priya");
  });
});

describe("safeAttrKey", () => {
  it("keeps identifier-safe characters", () => {
    expect(safeAttrKey("plan_tier")).toBe("plan_tier");
    expect(safeAttrKey("city2")).toBe("city2");
  });
  it("drops characters that could break the column reference", () => {
    expect(safeAttrKey("plan->>tier")).toBe("plantier");
    expect(safeAttrKey("a,b)c")).toBe("abc");
    expect(safeAttrKey("")).toBe("");
  });
});
