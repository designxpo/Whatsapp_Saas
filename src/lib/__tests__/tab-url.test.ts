// A refresh stays on the section you were in.
//
// The portal kept its section only in React state, so every refresh landed on
// Home. These pin the address-bar half (pure) and the wiring in the shell.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tabFromSearch, searchWithTab } from "../tab-url";

const TABS = ["home", "livechat", "flows", "settings"] as const;

describe("reading the section from the address bar", () => {
  it("opens the section the URL names", () => {
    expect(tabFromSearch("?tab=flows", TABS)).toBe("flows");
    expect(tabFromSearch("?connected=1&tab=settings", TABS)).toBe("settings");
  });

  it("ignores a section that doesn't exist, rather than guessing", () => {
    expect(tabFromSearch("?tab=flowz", TABS)).toBeNull();
    expect(tabFromSearch("?tab=", TABS)).toBeNull();
    expect(tabFromSearch("", TABS)).toBeNull();
    expect(tabFromSearch("?tab=__proto__", TABS)).toBeNull();
  });
});

describe("writing the section to the address bar", () => {
  it("names the section, and leaves Home as the bare address", () => {
    expect(searchWithTab("", "flows", "home")).toBe("?tab=flows");
    expect(searchWithTab("?tab=flows", "home", "home")).toBe("");
  });

  it("keeps every other parameter", () => {
    expect(searchWithTab("?connected=1", "settings", "home")).toBe("?connected=1&tab=settings");
    expect(searchWithTab("?tab=flows&connected=1", "home", "home")).toBe("?connected=1");
  });

  it("is a no-op when already there, so a restore adds no history entry", () => {
    expect(searchWithTab("?tab=flows", "flows", "home")).toBe("?tab=flows");
  });
});

describe("the portal shell", () => {
  const PAGE = readFileSync(join(process.cwd(), "src/app/admin/page.tsx"), "utf8");

  it("keeps its section in the URL", () => {
    expect(PAGE).toMatch(/useTabInUrl\(tab, setTab, ALL_TABS, "home"\)/);
    expect(PAGE).toMatch(/const ALL_TABS = Object\.keys\(TAB_TITLES\) as Tab\[\];/);
  });

  it("still checks plan and role: the URL is a suggestion, not a permission", () => {
    expect(PAGE).toMatch(/if \(ent && !tabAllowed\(tab, ent\)\) setTab\("home"\)/);
    expect(PAGE).toMatch(/const roleBlocked = !!me && !tabRoleAllowed\(tab, me\.role\)/);
  });

  it("the flow editor's Back returns to the flows list, not Home", () => {
    const editor = readFileSync(join(process.cwd(), "src/app/admin/flows/[id]/page.tsx"), "utf8");
    expect(editor).toContain(`router.push("/admin?tab=flows")`);
  });
});
