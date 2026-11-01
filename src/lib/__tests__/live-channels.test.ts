// The demo workspace was seeded with accounts carrying a placeholder token
// ("demo-…") and made-up ids. Jobs that call Meta or Google for every account
// across workspaces were calling with it on every run — the Instagram token
// refresh, the account-id repair, the reply-history import — and could only
// fail. One rule decides what counts as a real connection, and every
// platform-wide sweep goes through it.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("../supabase", () => ({ db: () => ({}) }));
import { isDemoToken, isLiveChannel } from "../channels";

describe("what counts as a real connection", () => {
  it("a placeholder token is never one", () => {
    expect(isDemoToken("demo-token-instagram")).toBe(true);
    expect(isDemoToken("DEMO_TOKEN")).toBe(true);
    expect(isLiveChannel({ active: true, token: "demo-token-whatsapp" })).toBe(false);
  });
  it("a real token on an active account is; a switched-off or empty one isn't", () => {
    for (const t of ["IGAAKx9", "EAAGm0PX4ZCps", "1//0gLrefresh"]) expect(isLiveChannel({ active: true, token: t })).toBe(true);
    expect(isLiveChannel({ active: false, token: "IGAAKx9" })).toBe(false);
    expect(isLiveChannel({ active: true, token: "" })).toBe(false);
    expect(isDemoToken("IGAAdemo")).toBe(false);   // "demo" inside a real token is not the marker
  });
  it("every sweep across workspaces filters through it", () => {
    const src = (f: string) => readFileSync(join(process.cwd(), "src/lib", f), "utf8");
    for (const f of ["comment-history.ts", "igtokensweep.ts", "reviewpoller.ts", "ytpoller.ts"]) {
      const s = src(f);
      expect(s, f).toMatch(/isLiveChannel\(c\)/);
      expect(s, f).not.toMatch(/listChannels\([^)]*\)\)\.filter\(c => [^)]*c\.active &&/);
    }
    expect(src("channels.ts")).toMatch(/if \(!ch\.token \|\| isDemoToken\(ch\.token\)\) continue;/);
  });
});
