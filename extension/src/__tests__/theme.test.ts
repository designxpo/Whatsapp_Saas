import { describe, it, expect } from "vitest";
import { THEMES, DEFAULT_THEME, normalizeTheme, nextTheme, themeTitle, applyTheme } from "../theme.js";

// A stand-in for <html>: applyTheme only ever sets or removes the attribute.
function fakeRoot() {
  const attrs: Record<string, string> = {};
  return {
    attrs,
    setAttribute(k: string, v: string) { attrs[k] = v; },
    removeAttribute(k: string) { delete attrs[k]; },
  };
}

describe("normalizeTheme", () => {
  it("passes the three real modes through", () => {
    for (const m of THEMES) expect(normalizeTheme(m)).toBe(m);
  });

  it("falls back to light for anything else", () => {
    for (const junk of [undefined, null, "", "auto", "Dark", 1, {}]) {
      expect(normalizeTheme(junk)).toBe(DEFAULT_THEME);
    }
  });
});

describe("nextTheme", () => {
  it("cycles light → dark → system → light", () => {
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("system");
    expect(nextTheme("system")).toBe("light");
  });

  it("treats junk as the default before cycling", () => {
    expect(nextTheme("nonsense")).toBe("dark");
  });
});

describe("themeTitle", () => {
  it("says where you are and where a click goes", () => {
    expect(themeTitle("light")).toBe("Theme: Light — switch to Dark");
    expect(themeTitle("system")).toBe("Theme: System — switch to Light");
  });
});

describe("applyTheme", () => {
  it("stamps an explicit choice on the root", () => {
    const root = fakeRoot();
    expect(applyTheme("dark", root)).toBe("dark");
    expect(root.attrs["data-theme"]).toBe("dark");
  });

  it("removes the stamp for system, so prefers-color-scheme decides", () => {
    const root = fakeRoot();
    applyTheme("dark", root);
    expect(applyTheme("system", root)).toBe("system");
    expect(root.attrs["data-theme"]).toBeUndefined();
  });

  it("pins light explicitly — a dark OS must not win over the tenant's choice", () => {
    const root = fakeRoot();
    expect(applyTheme("light", root)).toBe("light");
    expect(root.attrs["data-theme"]).toBe("light");
  });

  it("stores nothing surprising for junk input", () => {
    const root = fakeRoot();
    expect(applyTheme("chartreuse", root)).toBe(DEFAULT_THEME);
    expect(root.attrs["data-theme"]).toBe(DEFAULT_THEME);
  });
});
