import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Resolving the Instagram account after Embedded Signup.
//
// The reported failure: the tenant finished the Meta popup, Meta showed its own
// "connected to Talko.AI" success screen, and the tab still said "No Instagram
// accounts connected yet" with no reason. Two things went wrong at once — the
// error was rendered into an unmounted branch (fixed in InstagramTab), and the
// error itself named the wrong cause. Talko reaches Instagram through the
// linked Facebook Page, and the popup lets you SKIP the Page step; skipping it
// returns zero Pages, which needs a different fix from "the Page has no
// Instagram account linked".

import { resolveInstagramAsset } from "../embeddedsignup";

const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); });

const reply = (body: unknown, ok = true) => fetchMock.mockResolvedValue({ ok, json: async () => body });

describe("resolveInstagramAsset", () => {
  it("returns the Instagram account and its Page", async () => {
    reply({ data: [{ id: "page1", name: "Bolt", instagram_business_account: { id: "ig1" } }] });
    expect(await resolveInstagramAsset("tok")).toEqual({ ok: true, igUserId: "ig1", pageId: "page1" });
  });

  it("skips Pages with no Instagram account and takes the one that has it", async () => {
    reply({ data: [
      { id: "page1", name: "Plain Page" },
      { id: "page2", name: "Bolt", instagram_business_account: { id: "ig2" } },
    ] });
    expect(await resolveInstagramAsset("tok")).toMatchObject({ ok: true, igUserId: "ig2", pageId: "page2" });
  });

  // This is what the tenant in the recording actually hit.
  it("tells the tenant they skipped the Page step when Meta shared no Page", async () => {
    reply({ data: [] });
    const r = await resolveInstagramAsset("tok");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Page/i);
    expect(r.error).toMatch(/skipping/i);
  });

  // Same symptom, opposite fix — so it must not reuse the message above.
  it("names the shared Pages when none of them has Instagram linked", async () => {
    reply({ data: [{ id: "page1", name: "Bolt Fitness" }, { id: "page2", name: "Bolt Taekwondo" }] });
    const r = await resolveInstagramAsset("tok");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Bolt Fitness");
    expect(r.error).toMatch(/Link your Instagram account to the Page/i);
    expect(r.error).not.toMatch(/skipping/i);
  });

  // A large Business Portfolio must not hide the Instagram-linked Page behind
  // Graph's default 25-row page.
  it("asks Meta for more than one page of Pages", async () => {
    reply({ data: [{ id: "p", instagram_business_account: { id: "ig" } }] });
    await resolveInstagramAsset("tok");
    expect(String(fetchMock.mock.calls[0][0])).toContain("limit=100");
  });

  it("surfaces Meta's own error rather than guessing", async () => {
    reply({ error: { message: "Invalid OAuth access token." } }, false);
    expect(await resolveInstagramAsset("tok")).toEqual({ ok: false, error: "Invalid OAuth access token." });
  });

  it("never calls Meta without a token", async () => {
    expect(await resolveInstagramAsset("")).toEqual({ ok: false, error: "Missing token" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
